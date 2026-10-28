/**
 * expense-assistant MCP Server —— 把 Web 版的三个只读工具协议化。
 *
 * 与 Web 版的关系：
 * - 查询逻辑和返回形状**完全复用** src/modules/assistant/tools.ts 背后的同一批
 *   Prisma 查询与 expense-context.ts 的 payload 构造函数，两边不会各改各的。
 * - 传输用 stdio（本地进程，最通用的 MCP 传输方式），启动：npm run mcp。
 *   任何 MCP 客户端（Claude Code、Cursor、WorkBuddy 等）都能把这套报销数据
 *   查询能力挂进自己的工具箱。
 *
 * ⚠️ 安全边界与 Web 版不同，这是有意的，不是松懈：
 * - Web 版把 expenseId 锁在服务端（模型不能选单子），防的是「被注入的提问
 *   读任意数据」—— 那里的不可信主体是**模型**。
 * - MCP 版的调用者是操作者本人（本机进程、本机数据库），等同直接查库的权限，
 *   所以这里提供 code 参数和 list_expenses —— 没有发现单号的能力，工具没法用。
 * - 不变的两条：**全部只读**（没有任何写操作），工具不接自由 SQL、不接受
 *   「按条件搜全表」以外的模糊查询面。
 */

import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  buildApprovalRecord,
  buildExpenseHeader,
  buildExpenseItems,
} from '../src/modules/assistant/expense-context.js';

// .env 按模块自身位置找，不按 cwd —— MCP 客户端拉起子进程时的工作目录不可控
config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

// ---- 数据库：直连，启动时用 select 1 真正证伪（$connect 是惰性的，不作数）----

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
});

async function assertDb(): Promise<void> {
  try {
    await prisma.$queryRaw`select 1`;
  } catch (error) {
    throw new Error(
      `连不上数据库：${error instanceof Error ? error.message : String(error)}\n` +
        '  起库：npm run db:up\n' +
        '  建表与造数：npm run db:migrate && npm run db:seed',
    );
  }
}

/** 统一出口：payload 序列化成 JSON 文本；错误折叠成结构化结果，不让协议层崩 */
function out(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

async function call(fn: () => Promise<unknown>) {
  try {
    return out(await fn());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return out({ error: message });
  }
}

/** Web 版工具遇到「单子没了」返回业务结果而非报错，这里保持同一语义 */
async function byCode<T>(code: string, select: T) {
  const expense = await prisma.expense.findUnique({ where: { code }, select });
  if (!expense) return { error: '这张报销单不存在' };
  return expense;
}

const codeArg = { code: z.string().describe('报销单号，如 BX-2026-0003。先用 list_expenses 拿到可用单号') };

const server = new McpServer(
  { name: 'expense-assistant', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.tool(
  'list_expenses',
  '列出报销单（单号、标题、申请人、金额、状态）。先用它发现可以进一步查询的单号。',
  {
    status: z
      .enum(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAID'])
      .optional()
      .describe('按状态过滤，不传返回全部状态'),
    limit: z.number().int().min(1).max(50).default(20).describe('最多返回条数，默认 20'),
  },
  (a) =>
    call(async () => {
      const expenses = await prisma.expense.findMany({
        where: a.status ? { status: a.status } : undefined,
        orderBy: { submittedAt: 'desc' },
        take: a.limit,
        select: {
          code: true,
          title: true,
          applicant: true,
          department: true,
          category: true,
          amount: true,
          status: true,
          submittedAt: true,
        },
      });
      return { count: expenses.length, expenses };
    }),
);

server.tool(
  'get_expense_summary',
  '查一张报销单的表头：单号、标题、申请人、部门、分类、总额、当前状态、提交时间。不含明细和审批意见。',
  codeArg,
  (a) =>
    call(async () => {
      const e = await byCode(a.code, {
        code: true,
        title: true,
        applicant: true,
        department: true,
        category: true,
        amount: true,
        status: true,
        submittedAt: true,
      });
      return 'error' in e ? e : buildExpenseHeader(e);
    }),
);

server.tool(
  'list_expense_items',
  '列一张报销单的全部费用明细：名称、分类、金额、费用发生日（spentOn）与合计。费用发生日与提交日期是两回事。',
  codeArg,
  (a) =>
    call(async () => {
      const e = await byCode(a.code, {
        code: true,
        amount: true,
        items: {
          orderBy: [{ spentOn: 'asc' }, { name: 'asc' }],
          select: { name: true, category: true, amount: true, spentOn: true, note: true },
        },
      });
      return 'error' in e ? e : buildExpenseItems(e);
    }),
);

server.tool(
  'get_approval_record',
  '查一张报销单的审批记录：当前状态、决策时间（decidedAt）、驳回原因（rejectReason）。草稿/待审批的单子没有决策信息，字段缺省表示数据不足，不是出错。',
  codeArg,
  (a) =>
    call(async () => {
      const e = await byCode(a.code, {
        code: true,
        status: true,
        decidedAt: true,
        rejectReason: true,
      });
      return 'error' in e ? e : buildApprovalRecord(e);
    }),
);

async function main(): Promise<void> {
  await assertDb();
  await server.connect(new StdioServerTransport());
  // stdio 协议进程不能往 stdout 打日志（会污染协议流），一律走 stderr
  console.error('[expense-mcp] server ready: 4 tools on stdio');
}

main().catch((err) => {
  console.error('[expense-mcp] 启动失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
