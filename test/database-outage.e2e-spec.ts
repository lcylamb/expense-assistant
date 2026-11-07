import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { applyGlobalSetup } from '../src/app-setup.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  LLM_PROVIDER,
  type LlmCompletion,
  type LlmProvider,
  type LlmStream,
  type LlmToolCall,
} from '../src/modules/llm/llm.types.js';
import { parseSse } from './support/sse.js';

/**
 * 服务**起来之后**数据库挂了，用户看到什么。
 *
 * ── 为什么不并进 assistant-failure ──
 *
 * 那个文件测的是「模型那侧出错」。这里是另一条完全不同的故障链：库连不上。
 * 两者的错误码、话术、以及「还能不能继续跑」的判断都不一样，混在一个 describe 里
 * 只会让每个用例的前置条件都变得可疑。
 *
 * ── 这一组盯的是两件事 ──
 *
 * 1. **状态码**：库连不上是 503（基础设施问题，稍后重试有意义），不是 500
 *    （500 的意思是「我写错了」，会把人引去翻代码）。
 * 2. **不能降级成「信息不足」**：工具查询失败时如果只是让模型「换个方式或直接说
 *    信息不足」，用户会拿到一个 200 + 「查不到」的答案 —— 而真相是整张单子都读不了。
 *    这种「看起来成功的错误答案」比 503 危险，因为它和「数据里确实没有」
 *    在响应里完全没法区分。
 *
 * 数据库和模型都换成桩：要复现的是**连不上库**这一种状态，不是真的去拔网线。
 * 启动时的连接检查（PrismaService.onModuleInit）在桩上不会跑 —— 这正是重点：
 * 服务是「起来之后」才发现库没了的。
 */

const CODE = 'BX-2026-0003';
const UNAVAILABLE = '数据库暂时不可用，请稍后重试';

function p1001(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Invalid `prisma.expense.findUnique()` invocation\n\nCan't reach database server at db:5432",
    { code: 'P1001', clientVersion: '7.10.1' },
  );
}

/**
 * 只实现被用到的那一个方法。
 *
 * `where: prepare` —— 取单号时就挂；`where: tool` —— 取数成功，工具查询时挂。
 * 用 `select.id` 区分：prepare 只查 id，三个工具的 select 都不含 id。
 */
function outagePrisma(where: 'prepare' | 'tool'): PrismaService {
  return {
    // 探活走 `$queryRaw`。不管挂在哪个阶段，库都是同一个库，
    // 所以这里也抛 P1001 —— 『探活会跟着一起红』本身就是这条用例要证明的事。
    $queryRaw: async () => {
      throw p1001();
    },
    expense: {
      findUnique: async ({ select }: { select?: Record<string, boolean> }) => {
        if (where === 'prepare' || !select?.id) throw p1001();
        return { id: 'exp_1' };
      },
    },
  } as unknown as PrismaService;
}

/** 只会要工具、不会自己作答的模型 —— 逼着请求走进工具那一步。 */
class ToolCallingProvider implements LlmProvider {
  readonly name = 'stub-tool-calling';

  private call(): LlmToolCall {
    return { id: 'call_1', name: 'get_expense_summary', arguments: '{}' };
  }

  async complete(): Promise<LlmCompletion> {
    return { text: '', model: 'stub', toolCalls: [this.call()] };
  }

  async stream(): Promise<LlmStream> {
    return {
      model: 'stub',
      events: (async function* () {
        yield {
          type: 'tool_call' as const,
          call: { id: 'call_1', name: 'get_expense_summary', arguments: '{}' },
        };
      })(),
    };
  }
}

async function boot(
  where: 'prepare' | 'tool',
): Promise<NestExpressApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(LLM_PROVIDER)
    .useValue(new ToolCallingProvider())
    // 库都连不上了，登录也无从谈起 —— 所以这一组用例把「会话解析」也换成桩：
    // 它们要测的是故障链（503 / error 帧），不是认证。身份给一个审计视角，
    // 免得「可见性」在故障之外又插一脚进来。
    .overrideProvider(AuthService)
    .useValue({
      resolve: async () => ({
        id: 'u-zhengshi',
        username: 'zhengshi',
        name: '郑十',
        role: 'auditor',
        department: '内审部',
      }),
    })
    .overrideProvider(PrismaService)
    .useValue(outagePrisma(where))
    .compile();

  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  applyGlobalSetup(app);
  await app.init();
  return app;
}

const body = { code: CODE, question: '这张单子一共多少钱？' };

describe('取单号时库连不上 (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await boot('prepare');
  });

  afterAll(async () => {
    await app.close();
  });

  it('非流式 → 503，不是 500', async () => {
    const response = await request(app.getHttpServer())
      .post('/assistant/ask').set('Cookie', 'ea_session=stub')
      .send(body)
      .expect(503);

    expect(response.body.message).toBe(UNAVAILABLE);
  });

  it('流式 → 还是普通的 JSON 503：这时响应头还没发出去', async () => {
    // prepare 在 flushHeaders 之前跑。所以库在这一步就挂掉时，流式端点
    // 仍然有能力返回一个**正常的 HTTP 错误** —— 而不是已经 200 了再塞一帧 error。
    // 这个顺序是刻意排的：能在写头之前发现的问题，就不该用流的语义去表达。
    const response = await request(app.getHttpServer())
      .post('/assistant/askStream').set('Cookie', 'ea_session=stub')
      .send(body)
      .expect(503);

    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body.message).toBe(UNAVAILABLE);
  });

  it('探活也跟着红：库连不上时 /health 必须 503', async () => {
    // 这条和上面两条测的是同一次故障的不同读者：上面是用户，这里是平台。
    // 探活如果只回 `ok`，平台永远看不到这次故障 —— 监控全绿、用户全在报错。
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(503);

    expect(response.body.status).toBe('error');
    expect(response.body.db).toBe('down');
    // 带上原因：处置方式取决于故障类型（连不上 vs 缺表），不该让人猜。
    expect(response.body.problem).toContain('db:5432');
  });
});

describe('生产库停在旧迁移：表缺了 (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    // 这是真实发生过的状态：托管平台不跑迁移，部署了新代码但生产库还停在
    // 旧迁移。于是 `select 1` 成功、页面能打开，第一条业务查询就报
    // relation does not exist。
    //
    // 桩要模拟的是这个：**连得上**，但表不全。
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthService)
      .useValue({
        resolve: async () => ({
          id: 'u-zhengshi',
          username: 'zhengshi',
          name: '郑十',
          role: 'auditor',
          department: '内审部',
        }),
      })
      .overrideProvider(PrismaService)
      .useValue({
        // `select 1` 成功 —— 这正是它有欺骗性的地方。
        $queryRaw: async () => [{ '?column?': 1 }],
        // 缺表这件事由 PrismaService.missingTables() 负责判断，
        // 这里直接给结果 —— 控制器只负责把「缺了什么」报出去。
        missingTables: async () => ['users'],
        expense: {
          findUnique: async () => {
            throw new Error('relation "expenses" does not exist');
          },
        },
      } as unknown as PrismaService)
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    applyGlobalSetup(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('探活必须红：select 1 成功但表不全，不能算健康', async () => {
    // 只发 `select 1` 的话这里会返回 200 —— 平台看到「健康」，
    // 不重启实例、不提醒任何人，用户却拿到 500。
    const response = await request(app.getHttpServer()).get('/health').expect(503);

    expect(response.body.status).toBe('error');
    expect(response.body.db).toBe('down');
  });

  it('响应里说清缺了什么表、该做什么', async () => {
    // 「不健康」还不够 —— 处置方式不一样：连不上是环境问题，
    // 缺表是「忘了跑 migrate deploy」。这句提示是唯一能让人立刻对症下药的地方。
    const response = await request(app.getHttpServer()).get('/health').expect(503);

    expect(response.body.problem).toContain('users');
    expect(response.body.problem).toContain('migrate deploy');
  });
});

describe('工具查询时库连不上 (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await boot('tool');
  });

  afterAll(async () => {
    await app.close();
  });

  it('非流式 → 503，而不是 200 +「信息不足」', async () => {
    const response = await request(app.getHttpServer())
      .post('/assistant/ask').set('Cookie', 'ea_session=stub')
      .send(body)
      .expect(503);

    expect(response.body.message).toBe(UNAVAILABLE);
    // 说清楚它**不是**什么：降级成 200 的话，body 里会有一个 insufficient:true，
    // 和「这张单子确实查不到」长得一模一样。
    expect(response.body.insufficient).toBeUndefined();
  });

  it('流式 → 200 + error 帧，连接正常结束', async () => {
    // 走到这里时响应头早就发出去了（prepare 成功后立刻 flush），
    // 所以唯一能表达失败的通道是流里的 error 帧。直接抛的后果是连接断在半路，
    // 页面上的字永远停在「生成中」。
    const response = await request(app.getHttpServer())
      .post('/assistant/askStream').set('Cookie', 'ea_session=stub')
      .send(body)
      .expect(200);

    const frames = parseSse(response.text);
    expect(frames.map((frame) => frame.event)).toEqual(['error']);
    expect(frames[0].data.message).toBe(UNAVAILABLE);
  });
});
