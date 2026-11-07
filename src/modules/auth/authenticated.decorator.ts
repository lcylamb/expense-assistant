import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Viewer } from '../assistant/viewer.js';
import type { SessionAccount } from './auth.service.js';

/**
 * 在请求上挂登录态的请求类型。
 *
 * 两个字段刻意分开：
 *   · `account` —— 完整账号（含 username、department），给 /auth/me 用；
 *   · `viewer`  —— 权限判定要的那两个半字段（id + role）加一个展示名，
 *     下发给 service 的是它，而不是整个账号 —— service 不该拿到 passwordHash
 *     所在的那个对象的全部字段。
 */
export interface AuthenticatedRequest extends Request {
  account?: SessionAccount;
  viewer?: Viewer;
}

/** 路由元数据：这个端点不需要登录。 */
export const IS_PUBLIC = 'auth:public';

/**
 * 标记公开端点。
 *
 * 只有三个地方该用它：登录（还没有身份）、探活（调用方是平台探针，
 * 它没有账号也不该有）、以及静态页（不经过 Nest 路由，用不上）。
 *
 * 其余一律默认要登录 —— 和限流同一个道理：默认开着，才不会出现
 * 「新加了一个端点，忘了保护」。
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * 取当前登录的 viewer。
 *
 * `req.viewer` 是 SessionGuard 挂上去的，不是从请求体里读的 ——
 * 这个装饰器存在的意义就是让 controller 里**没有别的路**能拿到身份。
 */
export const CurrentViewer = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Viewer => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.viewer) {
      // 能走到这里说明守卫没挂上或被 @Public() 放过了 —— 是配置错误，不是运行时状态。
      throw new Error('CurrentViewer 用在了没有登录守卫的路由上');
    }
    return request.viewer;
  },
);

/** 取当前登录账号（含 username / department），只给 /auth/me 用。 */
export const CurrentAccount = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionAccount => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.account) {
      throw new Error('CurrentAccount 用在了没有登录守卫的路由上');
    }
    return request.account;
  },
);
