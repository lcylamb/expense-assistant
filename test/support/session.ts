import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../../src/modules/auth/auth.service.js';

/**
 * e2e 的登录辅助。
 *
 * 登录守卫是全局的（app.module.ts 的 APP_GUARD），所以除了 `/health`、`/auth/login`，
 * 每个用例都得先拿到一张会话 cookie。集中在这里的两个函数覆盖两种发请求的姿势：
 *   · `loginCookie`    —— supertest（不监听端口）；
 *   · `loginCookieAt`  —— 原生 fetch（用例自己 `app.listen(0)` 拿了 baseUrl）。
 *
 * 密码是 seed 里的公开演示密码（见 prisma/seed.ts）。这不是在测试里放宽安全策略 ——
 * 它走的就是真实登录端点，服务端照样 scrypt 校验一遍。
 */

export const DEMO_PASSWORD = 'demo1234';

/**
 * 默认用审计：多数用例只关心「登录之后能调通」，而审计看得见全部（含草稿）。
 *
 * 用审批人当默认会在草稿用例上翻车 —— 那不是可见性坏了，是用例挑错了身份：
 * 「问草稿单答信息不足」和「审批人看不见草稿」是两件事，各有各的用例
 * （见 visibility.e2e-spec.ts）。
 */
export const DEFAULT_USER = 'zhengshi';

/** 从 Set-Cookie 里挑出会话那一张，组成可以直接塞进 `Cookie` 头的字符串。 */
export function cookieHeader(
  setCookie: string | string[] | undefined,
): string {
  const list = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];

  const session = list.find((cookie) => cookie.startsWith('ea_session='));
  if (!session) {
    throw new Error('登录成功但响应里没有 ea_session cookie');
  }
  return session.split(';')[0];
}

/** 用 supertest 登录一次，返回 `Cookie` 头的值。 */
export async function loginCookie(
  app: INestApplication,
  username: string = DEFAULT_USER,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ username, password: DEMO_PASSWORD })
    .expect(200);

  return cookieHeader(response.headers['set-cookie']);
}

/** 用原生 fetch 登录一次（测试已经 listen 到某个端口时用）。 */
export async function loginCookieAt(
  baseUrl: string,
  username: string = DEFAULT_USER,
): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: DEMO_PASSWORD }),
  });

  if (!response.ok) {
    throw new Error(`登录失败（${username}）：HTTP ${response.status}`);
  }

  return cookieHeader(response.headers.getSetCookie());
}

/**
 * 不走 HTTP 的会话：直接向 AuthService 要一张令牌。
 *
 * 为什么需要它：登录端点和提问端点共用一个「按 IP」的额度（见 ip-throttler.guard.ts），
 * 所以「登录一次」会吃掉一次请求配额。限流用例把额度压到 3 来测边界，
 * 登录这一下会把边界挪掉 —— 而那个文件要测的不是登录，是限流。
 *
 * 它依然过密码校验、依然由服务端签发，只是不经过 HTTP 那一层。
 */
export async function sessionCookieDirect(
  app: INestApplication,
  username: string = DEFAULT_USER,
): Promise<string> {
  const auth = app.get(AuthService);
  const account = await auth.login(username, DEMO_PASSWORD);
  return `ea_session=${await auth.issueToken(account.id)}`;
}
