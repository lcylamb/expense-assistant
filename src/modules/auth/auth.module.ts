import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

/**
 * 认证模块。
 *
 * 只有两个 provider，但 SessionGuard 在 AppModule 里注册成了全局守卫 ——
 * 所以别处要用 AuthService 时，必须 import 这个模块（守卫是 APP_GUARD，
 * 由 Nest 在自己的注入上下文里解析，不受模块边界影响）。
 *
 * 导出 AuthService：e2e 里要拿它直接签发会话（见 test/support/session.ts），
 * 也为将来「改密码」「刷新令牌」这类端点留口子。
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
