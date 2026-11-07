import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service.js';
import { IS_PUBLIC, type AuthenticatedRequest } from './authenticated.decorator.js';
import { readCookie, SESSION_COOKIE } from './session.js';

/**
 * 登录守卫 —— 全局注册（app.module.ts 的 APP_GUARD），默认每个端点都要登录。
 *
 * ── 为什么是全局而不是逐个路由 @UseGuards ──
 *
 * 逐个挂靠自觉。这个项目已经有过一次教训的形状：限流如果逐路由挂，
 * 新加一个端点就可能安静地敞着，而「敞着」不会有任何报错。
 * 反过来，默认要求登录 + 少数 `@Public()` 显式开口，漏掉的后果是
 * 「新端点 401」—— 一个立刻会被发现的错。
 *
 * ── 它只回答一个问题：这是谁 ──
 *
 * 「这个人能不能看这张单」不在这里判。守卫负责认证（Authentication），
 * 可见性在 service / tools 里判（Authorization）—— 两层分开，才不会出现
 * 「守卫放行了，业务就默认全都能看」。
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (!token) {
      throw new UnauthorizedException('请先登录');
    }

    const account = await this.auth.resolve(token);
    if (!account) {
      // 令牌过期、签名不对、账号已被删除，三种情况对用户是同一件事：重新登录。
      // 区分它们只会让攻击者知道「这个账号曾经存在」。
      throw new UnauthorizedException('登录已失效，请重新登录');
    }

    request.account = account;
    request.viewer = {
      id: account.id,
      name: account.name,
      role: account.role,
    };
    return true;
  }
}
