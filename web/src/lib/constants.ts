/**
 * 页面文案与枚举映射。
 *
 * 服务端只发枚举原值（`TRAVEL` / `REJECTED`），中文留在这一侧——
 * 换文案不用动后端，也不用跑迁移。
 */

import type { ExpenseCategory, ExpenseStatus, Role } from '../api/types';

/**
 * 演示账号：只是「帮人把表单填上」的便利，不是登录本身。
 *
 * 这些账号在 `prisma/seed.ts` 里真实存在，密码由服务端 scrypt 校验。
 * 点一行把用户名密码填进表单，仍然要按一下「登录」——
 * 页面上没有一条路径能绕过密码，也没有任何地方能声明「我是审批人」。
 */
export interface DemoAccount {
  username: string;
  name: string;
  role: Role;
  department: string;
  note: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { username: 'zhangsan', name: '张三', role: 'applicant', department: '销售部', note: '自己的 2 张单' },
  { username: 'lisi', name: '李四', role: 'applicant', department: '研发部', note: '含 1 张已打款差旅' },
  { username: 'wangwu', name: '王五', role: 'applicant', department: '市场部', note: '含 1 张被驳回' },
  { username: 'zhaoliu', name: '赵六', role: 'applicant', department: '财务部', note: '含 1 张草稿' },
  { username: 'wangjl', name: '王经理', role: 'approver', department: '审批中心', note: '全部已提交的单' },
  { username: 'zhengshi', name: '郑十', role: 'auditor', department: '内审部', note: '含草稿，只读对账' },
];

export const DEMO_PASSWORD = 'demo1234';

export const ROLE_TEXT: Record<Role, string> = {
  applicant: '申请人',
  approver: '审批人',
  auditor: '审计',
};

export const STATUS_TEXT: Record<ExpenseStatus, string> = {
  DRAFT: '草稿',
  SUBMITTED: '待审批',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  PAID: '已打款',
};

/** 状态 → antd Tag 的颜色档位。颜色不写死 hex，换主题时它跟着变。 */
export const STATUS_COLOR: Record<ExpenseStatus, string> = {
  DRAFT: 'default',
  SUBMITTED: 'processing',
  APPROVED: 'blue',
  REJECTED: 'error',
  PAID: 'success',
};

export const CATEGORY_TEXT: Record<ExpenseCategory, string> = {
  TRAVEL: '差旅',
  OFFICE: '办公用品',
  ENTERTAIN: '业务招待',
  TRANSPORT: '市内交通',
  OTHER: '其他',
};

/**
 * 工具名 → 页面上的中文短标签。
 *
 * 长名字（get_expense_summary）挤在那行指标里会把「首字延迟 / 总耗时」顶掉，
 * 而这里要说的只有一件事：它查的是哪一块。
 */
export const TOOL_LABEL: Record<string, string> = {
  get_expense_summary: '表头',
  list_expense_items: '明细',
  get_approval_record: '审批',
};

/** 一轮回答的状态文案。 */
export type TurnStatus = 'pending' | 'streaming' | 'done' | 'insufficient' | 'stopped' | 'error';

export const TURN_STATUS_TEXT: Record<TurnStatus, string> = {
  pending: '生成中…',
  streaming: '生成中…',
  done: '已确认',
  insufficient: '信息不足',
  stopped: '已停止（文字未经最终校验）',
  error: '出错',
};
