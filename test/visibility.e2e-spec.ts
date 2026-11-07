import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { applyGlobalSetup } from '../src/app-setup.js';
import { loginCookie } from './support/session.js';

/**
 * 身份可见性的 e2e —— 走真实 HTTP、真实数据库、真实登录。
 *
 * 单测（viewer.spec.ts）钉住规则函数；这里钉的是**接线**：
 *   · 身份真的来自登录态（cookie），不是请求体 —— 换个 cookie 就是换个人；
 *   · 列表接口按身份收窄集合，而不是把全量发回去由前端装样子；
 *   · ask 带上越权单号时被拦下，且错误和「单子不存在」**同一个**；
 *   · 没有登录态 → 401；想在请求体里声明身份 → 400（DTO 里根本没有这个字段）。
 *
 * 需要数据库在跑且已经 seed 过（`npm run db:up && npm run db:seed`）。
 * seed 数据的归属（见 prisma/seed.ts）：
 *   张三 → 0001/0004，李四 → 0002/0006，王五 → 0003/0008，
 *   赵六 → 0005/0009（0005 是 DRAFT），孙七 → 0007/0010（0007 是 SUBMITTED）。
 */
describe('身份可见性 (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    applyGlobalSetup(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const listAs = (cookie: string, query = '') =>
    request(app.getHttpServer())
      .get(`/assistant/expenses${query}`)
      .set('Cookie', cookie);

  describe('没登录', () => {
    it('列表和提问一律 401 —— 默认要求登录，不是「默认全量」', async () => {
      await request(app.getHttpServer()).get('/assistant/expenses').expect(401);
      await request(app.getHttpServer())
        .post('/assistant/ask')
        .send({ code: 'BX-2026-0001', question: '一共多少钱？' })
        .expect(401);
    });

    it('伪造的 cookie 也是 401（签名不对）', async () => {
      await request(app.getHttpServer())
        .get('/assistant/expenses')
        .set('Cookie', 'ea_session=not-a-real-token')
        .expect(401);
    });
  });

  describe('GET /assistant/expenses', () => {
    it('申请人张三：只见自己的 2 张，统计跟着收窄', async () => {
      const cookie = await loginCookie(app, 'zhangsan');
      const res = await listAs(cookie).expect(200);

      expect(res.body.viewer).toEqual({ name: '张三', role: 'applicant' });
      expect(res.body.expenses).toHaveLength(2);
      for (const expense of res.body.expenses) {
        expect(expense.applicant).toBe('张三');
      }
      // 张三的两张：0001 已打款、0004 待审批 —— 没有驳回。
      expect(res.body.summary.byStatus).toEqual({
        PAID: 1,
        SUBMITTED: 1,
      });
      expect(res.body.summary.rejectedCount).toBe(0);
    });

    it('审批人：8 张（草稿不在其中），统计里没有 DRAFT', async () => {
      const cookie = await loginCookie(app, 'wangjl');
      const res = await listAs(cookie).expect(200);

      expect(res.body.expenses).toHaveLength(8);
      expect(res.body.summary.byStatus.DRAFT).toBeUndefined();
      // 非草稿里两位申请人被驳回：0003（王五）、0009（赵六）。
      expect(res.body.summary.rejectedCount).toBe(2);
    });

    it('审计：10 张全见，含草稿', async () => {
      const cookie = await loginCookie(app, 'zhengshi');
      const res = await listAs(cookie).expect(200);

      expect(res.body.expenses).toHaveLength(10);
      expect(res.body.summary.byStatus.DRAFT).toBeGreaterThan(0);
      expect(res.body.viewer.role).toBe('auditor');
    });

    it('category 过滤生效：审批人 + TRAVEL 只剩差旅单', async () => {
      const cookie = await loginCookie(app, 'wangjl');
      const res = await listAs(cookie, '?category=TRAVEL').expect(200);

      expect(res.body.expenses.length).toBeGreaterThan(0);
      for (const expense of res.body.expenses) {
        expect(expense.category).toBe('TRAVEL');
      }
    });

    it('非法分类被校验拦下（400）', async () => {
      const cookie = await loginCookie(app, 'zhangsan');
      await listAs(cookie, '?category=FOOD').expect(400);
    });
  });

  describe('ask 的可见性拦截', () => {
    const askAs = (cookie: string, body: object) =>
      request(app.getHttpServer())
        .post('/assistant/ask')
        .set('Cookie', cookie)
        .send(body);

    it('申请人查别人的单：404，与「单子不存在」同一个错误（防枚举）', async () => {
      // 0003 是王五的单。张三去查，拿到的错误必须和不存在的 9999 一模一样。
      const cookie = await loginCookie(app, 'zhangsan');
      const forbidden = await askAs(cookie, {
        code: 'BX-2026-0003',
        question: '这张单子为什么被驳回了？',
      });
      const missing = await askAs(cookie, {
        code: 'BX-9999-9999',
        question: '这张单子为什么被驳回了？',
      });

      expect(forbidden.status).toBe(404);
      expect(missing.status).toBe(404);
      // 消息里必然带单号（否则用户不知道是哪张），所以比的是**去掉单号后的模板**：
      // 两者逐字一致，外部无从分辨「有权但不存在」和「存在但无权」。
      const template = (message: string) =>
        message.replace('BX-2026-0003', 'CODE').replace('BX-9999-9999', 'CODE');
      expect(template(forbidden.body.message)).toBe(
        template(missing.body.message),
      );
    });

    it('申请人查自己的单：正常进入问答流程（mock provider 出答案）', async () => {
      const cookie = await loginCookie(app, 'zhangsan');
      const res = await askAs(cookie, {
        code: 'BX-2026-0001',
        question: '一共多少钱？',
      });
      expect(res.status).toBe(200);
      expect(res.body.conclusion).toBeTruthy();
    });

    it('审批人查草稿单：同样 404 —— 草稿没提交，不在审批人的世界里', async () => {
      const cookie = await loginCookie(app, 'wangjl');
      await askAs(cookie, {
        code: 'BX-2026-0005',
        question: '审批意见是什么？',
      }).expect(404);
    });

    it('请求体里带 viewer：400 —— 身份不是入参，DTO 里没有这个字段', async () => {
      // 这是这次改造最关键的一条：旧版本 `viewer` 是 body 里的合法字段，
      // 一句 curl 就能当审批人。现在它只会被 whitelist 打回来。
      const cookie = await loginCookie(app, 'zhangsan');
      await askAs(cookie, {
        code: 'BX-2026-0001',
        question: '一共多少钱？',
        viewer: { name: '王经理', role: 'approver' },
      }).expect(400);
    });
  });
});
