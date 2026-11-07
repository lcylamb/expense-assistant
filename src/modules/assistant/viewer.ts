import {
  ExpenseStatus,
  UserRole,
  type Prisma,
} from '../../generated/prisma/client.js';

/**
 * 阅视者（viewer）——「我是谁」的服务端表达。
 *
 * ── 身份从哪来 ──
 *
 * 不是请求体，是**登录态**：`POST /auth/login` 校验密码后种一个 httpOnly cookie，
 * 里面的签名令牌只带 user id；之后每个请求由 SessionGuard 解出 id、查库、
 * 把这个人挂到 `req.viewer` 上。客户端能声明的只有「用户名和密码」，
 * 声明不了「我是审批人」。
 *
 * 这一层改过一次：早先 viewer 是 body 里的 `{ name, role }`，可见性规则再严密，
 * 也只是在验证一句自称 —— 一句 curl 就能当审批人。规则没变，凭据变了。
 *
 * ── 三条可见性规则（刻意简单，但都是真实规则的形状）──
 *
 *   · applicant —— 只能看到归属人是自己的单（`applicantId === viewer.id`）；
 *   · approver  —— 能看到所有**非 DRAFT** 的单。草稿还没提交，审批人本就不该看到，
 *     这条规则不是这个 demo 发明的，是 schema 注释里 DRAFT 的定义自带的；
 *   · auditor   —— 只读全部，含草稿。内审/财务复核要能对账，看不到未提交的单
 *     就没法发现「月底突击报销」这类问题。
 *
 * ⚠️ 归属判定认 `applicantId`，不认姓名。姓名是快照，只用于展示 ——
 * 拿姓名当键，公司里两个张三就能互相看见对方的单。
 */

export type ViewerRole = 'applicant' | 'approver' | 'auditor';

export const VIEWER_ROLES: readonly ViewerRole[] = [
  'applicant',
  'approver',
  'auditor',
];

/** 登录用户在本系统里的最小画像。id 是权限判定的唯一依据。 */
export interface Viewer {
  id: string;
  name: string;
  role: ViewerRole;
}

/**
 * 账号角色（DB 枚举，大写）→ 可见性角色（小写）。
 *
 * 两套写法并存是历史原因：viewer.ts 先于账号表存在，规则和测试都按小写写。
 * 转换只放在这里一处，避免每个调用点各写一遍 `toLowerCase()`。
 */
export function toViewerRole(role: UserRole): ViewerRole {
  switch (role) {
    case UserRole.APPLICANT:
      return 'applicant';
    case UserRole.APPROVER:
      return 'approver';
    case UserRole.AUDITOR:
      return 'auditor';
  }
}

/**
 * 可见性对应的 Prisma 过滤条件。null = 不限（只有审计角色会走到）。
 *
 * 返回**条件**而不是 boolean：调用方把它拼进自己的 where 里 ——
 * 列表接口用它查「可见的集合」，工具层用它防「绑定的单子越过了可见性」，
 * 同一条规则只有一个出处。
 *
 * `viewer` 可选，只为 MCP 那条路留的：MCP 的调用者是操作者本人、跑在本机，
 * 等同于直接开 psql 读库（见 tools.ts 的注释）。HTTP 这条路上它一定存在 ——
 * 没有登录态根本进不到 controller。
 */
export function visibilityWhere(
  viewer?: Viewer,
): Prisma.ExpenseWhereInput | null {
  if (!viewer) return null;

  switch (viewer.role) {
    case 'applicant':
      return { applicantId: viewer.id };
    case 'approver':
      // 草稿还没提交，不在审批人的世界里。
      return { status: { not: ExpenseStatus.DRAFT } };
    case 'auditor':
      return null;
  }
}

/**
 * 单条可见性判断。与 `visibilityWhere` 同一条规则的两面：
 * where 给查询用，这个给「已经查出来的行」用 —— 规则改了必须两处同步，
 * 所以它们靠互相注释锚定，改一处必看另一处。
 */
export function visibleToViewer(
  row: { applicantId: string; status: ExpenseStatus },
  viewer?: Viewer,
): boolean {
  if (!viewer) return true;

  switch (viewer.role) {
    case 'applicant':
      return row.applicantId === viewer.id;
    case 'approver':
      return row.status !== ExpenseStatus.DRAFT;
    case 'auditor':
      return true;
  }
}
