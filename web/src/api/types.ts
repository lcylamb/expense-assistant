/**
 * 后端契约的前端副本。
 *
 * 为什么不从 `src/` 直接 import 后端的类型：那样前端会顺着类型链
 * 把 Nest、Prisma 的装饰器和依赖拖进浏览器构建里。这里手写一份，
 * 边界上有重复，但重复的是**协议**——协议本来就该两边各写一份，
 * 谁也改不动谁，改了要一起改。
 *
 * 对应后端：`src/modules/assistant/ask.types.ts`、`src/modules/auth/auth.service.ts`。
 */

export type Role = 'applicant' | 'approver' | 'auditor';

/** `GET /auth/me`、`POST /auth/login` 的返回。刻意不含 id 和密码哈希。 */
export interface Me {
  username: string;
  name: string;
  role: Role;
  department: string;
}

export type ExpenseStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PAID';

export type ExpenseCategory = 'TRAVEL' | 'OFFICE' | 'ENTERTAIN' | 'TRANSPORT' | 'OTHER';

/** 列表里的一行。`amount` 是十进制**字符串** —— 金额不进 JS 浮点。 */
export interface Expense {
  code: string;
  title: string;
  applicant: string;
  department: string;
  category: ExpenseCategory;
  status: ExpenseStatus;
  amount: string;
  submittedAt: string;
}

export interface ExpensesSummary {
  count: number;
  byStatus: Partial<Record<ExpenseStatus, number>>;
  totalAmount: string;
  rejectedCount: number;
}

/** `GET /assistant/expenses`：列表与统计一次给，不出现两个真相。 */
export interface ExpensesResponse {
  expenses: Expense[];
  summary: ExpensesSummary;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface AskMetrics {
  elapsedMs: number;
  ttftMs: number | null;
  modelCalls: number;
  toolMs: number;
  /** 厂商报的用量；任一轮没报就是 null —— 0 不代表「没花钱」。 */
  usage: LlmUsage | null;
}

/** 一次工具调用。只有名字和成败，参数与结果不进响应。 */
export interface AgentStep {
  tool: string;
  ok: boolean;
}

export interface AskResult {
  conclusion: string;
  evidence: string[];
  insufficient: boolean;
  trace: AgentStep[];
  metrics: AskMetrics;
}

/** 回传给服务端的一轮历史：只带被校验过的结论，不带原文。 */
export interface HistoryTurn {
  question: string;
  conclusion: string;
  evidence: string[];
  insufficient: boolean;
}

export interface AskPayload {
  code: string;
  question: string;
  history?: HistoryTurn[];
}

/**
 * 流式端点的事件。
 *
 * 判别联合，不是「一堆可空字段的对象」：消费方在 `switch (frame.type)` 里
 * 被编译器逼着处理 `done` 和 `error`，而「流断了没人管」正是流式接口最常见的坑。
 */
export type AssistantEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; result: AskResult }
  | { type: 'error'; message: string };
