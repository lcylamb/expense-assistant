import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { LoginDto } from './auth.dto.js';
import {
  AuthService,
  toSessionUser,
  type SessionUser,
} from './auth.service.js';
import {
  CurrentAccount,
  Public,
} from './authenticated.decorator.js';
import type { SessionAccount } from './auth.service.js';
import { clearSessionCookie, setSessionCookie } from './session.js';
import type { Response } from 'express';

/**
 * 认证端点。
 *
 * 三个路由的分工很小，但每个都有一处不能省的东西：
 *   · login  —— 校验密码、种 cookie；
 *   · logout —— 清 cookie（服务端没有会话表，也就没有「吊销」这一步，见下）；
 *   · me     —— 刷新页面后靠它恢复「我是谁」，页面不再自己记身份。
 *
 * ── 关于「退出登录之后令牌还能用吗」──
 *
 * 还能用，直到过期。因为令牌是自证的，服务端没有一张表可以划掉它。
 * 这是无状态会话的固有代价，写在这里而不是假装不存在：
 * 要真正吊销，得加一张「已注销令牌」表或把版本号写进令牌 —— 那是另一层复杂度，
 * 这个项目的取舍是「8 小时 TTL + httpOnly，不额外维护吊销列表」。
 * 页面上点退出，浏览器里的 cookie 立刻没了；攻击者若已拿到令牌副本，
 * 它还能用到过期 —— 这也是为什么令牌不能进 localStorage（拿不到副本）。
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * 登录。
   *
   * 显式 200：POST 默认 201，但这里没有创建资源（会话不是资源，
   * 它是一个 cookie）—— 201 会让调用方以为响应里多了个东西。
   *
   * 限流不豁免：登录是最该限流的端点（撞库）。它和提问共用同一个 IP 额度，
   * 撞库脚本撞几次就会被 429 挡住 —— 代价是正常用户也可能被同一个 IP 的
   * 脚本连累，这个取舍写在 app.module.ts 的限流那段。
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionUser> {
    const account = await this.auth.login(dto.username, dto.password);
    setSessionCookie(res, await this.auth.issueToken(account.id));
    return toSessionUser(account);
  }

  /**
   * 退出。
   *
   * 204 而不是 200：没有内容可返回，也不该要求调用方解析 body。
   * `@Public()` 是刻意的 —— 令牌过期之后再点退出，不该弹「请先登录」，
   * 清 cookie 这件事永远应该成功。
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response): void {
    clearSessionCookie(res);
  }

  /** 当前登录的是谁。页面每次加载都调它，不再从 sessionStorage 里读身份。 */
  @Get('me')
  me(@CurrentAccount() account: SessionAccount): SessionUser {
    return toSessionUser(account);
  }
}
