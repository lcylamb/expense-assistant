import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { applyGlobalSetup } from '../src/app-setup.js';
import { DEMO_PASSWORD, loginCookie } from './support/session.js';

/**
 * 登录与会话的 e2e。
 *
 * 这一组存在的理由很具体：可见性规则写得再对，只要「你是谁」可以被客户端声明，
 * 整套权限就只是装饰。所以这里钉四件事：
 *   · 密码对了才发会话，密码错了和账号不存在给**同一句**话（防用户名枚举）；
 *   · 会话是 httpOnly cookie，响应体里没有密码哈希；
 *   · 没有会话 / 伪造会话 → 401；
 *   · 退出之后浏览器那侧确实清掉了（服务端无状态，令牌本身仍然有效到期，
 *     这个取舍写在 auth.controller.ts）。
 *
 * 需要数据库在跑且已经 seed 过（`npm run db:up && npm run db:seed`）。
 */
describe('登录与会话 (e2e)', () => {
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

  const login = (username: string, password: string) =>
    request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password });

  it('密码正确：200 + httpOnly 会话 cookie，响应体里没有密码哈希', async () => {
    const response = await login('zhangsan', DEMO_PASSWORD).expect(200);

    expect(response.body).toEqual({
      username: 'zhangsan',
      name: '张三',
      role: 'applicant',
      department: '销售部',
    });
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');

    const cookies = response.headers['set-cookie'] as unknown as string[];
    const session = cookies.find((cookie) => cookie.startsWith('ea_session='));
    expect(session).toBeDefined();
    // JS 读不到它 —— 这是「不把令牌放进 localStorage」的物理保证。
    expect(session).toContain('HttpOnly');
    expect(session).toContain('SameSite=Lax');
    expect(session).toContain('Path=/');
  });

  it('密码错与账号不存在：同一个 401、同一句话（不做用户名枚举）', async () => {
    const wrongPassword = await login('zhangsan', 'wrong-password').expect(401);
    const noSuchUser = await login('nobody-here', DEMO_PASSWORD).expect(401);

    expect(wrongPassword.body.message).toBe(noSuchUser.body.message);
    expect(wrongPassword.body.statusCode).toBe(noSuchUser.body.statusCode);
  });

  it('入参缺字段：400，而不是「当成空密码去校验」', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'zhangsan' })
      .expect(400);
  });

  it('GET /auth/me：带会话返回本人，不带返回 401', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);

    const cookie = await loginCookie(app, 'wangjl');
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookie)
      .expect(200);

    expect(me.body).toEqual({
      username: 'wangjl',
      name: '王经理',
      role: 'approver',
      department: '审批中心',
    });
  });

  it('伪造会话：401 —— 签名不对，改一个字符就穿帮', async () => {
    const cookie = await loginCookie(app);
    const tampered = `${cookie.slice(0, -2)}xx`;

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', tampered)
      .expect(401);
  });

  it('退出：204，并把同名同路径的 cookie 置空', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/logout')
      .expect(204);

    const cookies = response.headers['set-cookie'] as unknown as string[];
    const cleared = cookies.find((cookie) => cookie.startsWith('ea_session='));
    expect(cleared).toBeDefined();
    // express 的 clearCookie 写的是空值 + 过期时间——浏览器收到就删。
    expect(cleared).toMatch(/ea_session=;/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('/health 不需要登录 —— 探针没有账号，也不该为了探活去申请一个', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
  });
});
