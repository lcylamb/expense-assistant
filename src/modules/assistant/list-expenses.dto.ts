import { IsIn, IsOptional } from 'class-validator';

/**
 * GET /assistant/expenses 的查询参数。
 *
 * ── 只剩一个字段 ──
 *
 * 早先这里有 `name` / `role` 两个参数，把身份**写在查询串里**
 * （`?name=张三&role=applicant`）。那等于把权限的钥匙挂在 URL 上：
 * 换个参数就是另一个人，日志里还留着。现在身份从登录态来，
 * 这两个字段整个删掉了 —— 少一个能声明的入口，就少一条要守的边界。
 *
 * category 直接用枚举字符串校验：它来自 schema 的 enum，取值空间是封死的，
 * 「白名单校验」比「长度校验」便宜也更准。
 */
export class ListExpensesDto {
  @IsOptional()
  @IsIn(['TRAVEL', 'OFFICE', 'ENTERTAIN', 'TRANSPORT', 'OTHER'], {
    message: '分类取值：TRAVEL / OFFICE / ENTERTAIN / TRANSPORT / OTHER',
  })
  category?: string;
}
