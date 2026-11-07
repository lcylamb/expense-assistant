import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';

/**
 * 应用必需的表。缺任何一张，这个服务就没有一条业务路径能工作。
 *
 * 放在这里而不是各查各的：启动检查和探活要问同一个问题 ——
 * 两处各写一份清单，迟早会漂移，漂移之后启动会放过「探活却报红」的状态，
 * 或者反过来。
 */
export const REQUIRED_TABLES = ['expenses', 'expense_items', 'users'] as const;

/**
 * Prisma 客户端。
 *
 * ⚠️ Prisma 7 和 5/6 有两处写法不同，照着老教程写会直接跑不起来：
 *
 *   1. 连接串不再从 schema 读，而是通过一个 **driver adapter**（`new PrismaPg`）传进来。
 *      构造时不给 adapter 会直接抛「Pass a driver adapter to the PrismaClient constructor」。
 *   2. 生成的 client 不在 `@prisma/client` 里了，在 `src/generated/prisma`，用相对路径 import。
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: config.getOrThrow<string>('DATABASE_URL'),
      }),
    });
  }

  /**
   * 启动时确认数据库真的连得上，**而且表是齐的**。
   *
   * ⚠️ 光调 `$connect()` 是**不够**的。换成 driver adapter 之后 `$connect()` 变成了
   * 纯粹的惰性初始化 —— 它不建立任何连接、也不校验可达性，数据库根本不在也照样「成功」。
   * 所以必须自己发一条 `select 1` 才能真正证伪。
   *
   * ⚠️ `select 1` 也只证伪了「连着一个 Postgres」，没证伪「连着的是**这个应用**的库」。
   * 托管平台不替你跑迁移，所以「代码更新了、生产库还停在旧迁移」是很现实的一种状态：
   * 服务照常启动、页面能打开、`/health` 报 ok，而第一条业务查询就报
   * `relation "users" does not exist`。
   *
   * 所以这里额外查一遍必需的表。缺表时**启动失败**：比起带着一个必然 500 的服务
   * 假装健康，不如立刻停下并说清要跑什么。
   *
   * 连不上就让启动失败：没有数据库的接口没有一个能用，与其带病启动、把错误推迟到
   * 第一个请求，不如立刻停下并说清怎么办。
   */
  async onModuleInit(): Promise<void> {
    await this.$connect();
    try {
      await this.$queryRaw`select 1`;
    } catch (error) {
      throw new Error(
        `连不上数据库：${error instanceof Error ? error.message : String(error)}\n` +
          '  起库：npm run db:up\n' +
          '  建表与造数：npm run db:migrate && npm run db:seed',
      );
    }

    const missing = await this.missingTables();
    if (missing.length > 0) {
      throw new Error(
        `数据库缺表：${missing.join(', ')}\n` +
          '  生产库还没跑最新迁移。托管平台不会替你执行迁移，必须手动跑：\n' +
          '    DATABASE_URL=<生产库连接串> npx prisma migrate deploy\n' +
          '  症状是「页面能打开、一登录就 500（relation does not exist）」—— ' +
          '不是代码的问题。',
      );
    }

    this.logger.log('数据库已连接，必需的表都在');
  }

  /**
   * 列出应用必需的、但库里没有的表。
   *
   * 查 `information_schema` 而不是逐个 `select`：一次查询拿全，
   * 而且不依赖表的列结构 —— 缺表和「表在但少一列」是两种不同的病。
   */
  async missingTables(): Promise<string[]> {
    const rows = await this.$queryRaw<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = current_schema()
        and table_name in (${Prisma.join(REQUIRED_TABLES)})
    `;
    const present = new Set(rows.map((r) => r.table_name));
    return REQUIRED_TABLES.filter((t) => !present.has(t));
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    // 打这一行是为了让优雅退出**可观测**。
    //
    // 否则「到底有没有走完 $disconnect」在日志里没有任何痕迹，而这条日志的有无
    // 正是排查「明明没有请求，数据库连接数却下不去」时的第一个分叉点：
    //   看得到 → 钩子跑了，连接是数据库那边回收慢；
    //   看不到 → 信号根本没到应用（最常见的原因：CMD 写成了 shell 形式，
    //            SIGTERM 被 shell 吃掉，node 从头到尾没收到）。
    this.logger.log('收到退出信号，数据库连接已释放');
  }
}
