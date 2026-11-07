import { Logger } from '@nestjs/common';
import type { Response } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { randomBytes } from 'node:crypto';

/**
 * 会话令牌 —— 登录之后「我还是我」的凭据。
 *
 * ── 为什么是「cookie 里的签名令牌」而不是「服务端 session 表」──
 *
 * 这个服务是无状态部署的（Render 上重启就换实例），存 session 表意味着每次
 * 请求多一次查库、还要处理过期清理。用签名令牌，服务端只存一个密钥：
 * 令牌自己带着「谁的会话、什么时候过期」，签名保证它没被改过。
 *
 * 选 jose 而不是手搓 HMAC：JWT 的坑（算法混淆、base64url 细节、exp 校验）
 * 都是「看起来能跑但少校验了一处」的那种坑，手写一遍得不到任何好处。
 *
 * ── 为什么放 httpOnly cookie，不放 localStorage ──
 *
 * localStorage 里的令牌任何一段页面脚本都能读走（XSS 一次，令牌就永久泄露）。
 * httpOnly 的 cookie 对 JS 不可见，页面被注入也偷不走。代价是要处理 CSRF ——
 * 这里靠 `SameSite=Lax`：跨站的 POST 不会带上这个 cookie，而这个服务的
 * 所有写操作都是 POST。
 *
 * ⚠️ 别把 Secure 关掉当默认：本地是 http，线上是 https。所以按环境判断，
 * 而不是写死 —— 写死 true 本地登录不上，写死 false 线上会明文传输。
 */

export const SESSION_COOKIE = 'ea_session';

/** 会话有效期。8 小时 = 一个工作日，过期后回登录页。 */
const SESSION_TTL_SECONDS = 8 * 60 * 60;

const ISSUER = 'expense-assistant';
const AUDIENCE = 'web';

const logger = new Logger('Session');

let cachedKey: Uint8Array | undefined;

/**
 * 取签名密钥。
 *
 * 生产环境应当由平台注入 `SESSION_SECRET`（≥32 字符）。缺了不会崩 ——
 * 而是**每次启动随机生成一把**，并记一条 warn：服务照常能用，代价是重启后
 * 所有人重新登录。这是刻意选的降级方式：让演示环境能直接跑起来，
 * 又不会在日志里假装一切正常。
 *
 * ⚠️ 随机密钥意味着多实例之间互不认账 —— 多实例部署必须配 `SESSION_SECRET`。
 */
export function sessionKey(): Uint8Array {
  if (cachedKey) return cachedKey;

  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv && fromEnv.length >= 32) {
    cachedKey = new TextEncoder().encode(fromEnv);
    return cachedKey;
  }

  cachedKey = randomBytes(32);
  logger.warn(
    fromEnv
      ? 'SESSION_SECRET 短于 32 字符，本次启动改用随机密钥（重启后会话全部失效）'
      : '未配置 SESSION_SECRET，本次启动使用随机密钥（重启后会话全部失效）',
  );
  return cachedKey;
}

/** 签发一张令牌。只放 user id —— 名字和角色每次从库里读，改权限不用等令牌过期。 */
export async function signSession(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(sessionKey());
}

/**
 * 校验令牌，返回 user id。任何不合法（签名不对、过期、被改过）都返回 null。
 *
 * 返回值只有 id：调用方还得去库里确认这个账号还在、角色是什么。
 * 把角色写进令牌会让「改了权限但对方还拿着旧令牌」变成一段隐蔽的窗口期。
 */
export async function verifySession(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, sessionKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

/** 种 cookie。`res.cookie` 由 express 提供，不额外装 cookie-parser。 */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000,
    secure: cookieSecure(),
  });
}

/** 退出登录：把同一路径上的 cookie 清掉，属性必须和种下去时一致。 */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: cookieSecure(),
  });
}

/**
 * 读某一个 cookie。
 *
 * 自己解析而不是装 cookie-parser：这里只读一个我们自己的、值里不可能出现
 * `;` 和 `=` 的令牌。为一个函数装一个中间件，不如把这十行读明白。
 */
export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }

  return undefined;
}

/**
 * cookie 要不要带 Secure 标记。
 *
 * 生产默认开（HTTPS 下必须开，否则浏览器会拒收）；本地 http 要关，否则登录
 * 成功但 cookie 存不下来 —— 表现为「点登录没反应」，极难查。
 * `COOKIE_SECURE` 留给反向代理终止 TLS 又在 http 里跑应用的部署形态。
 */
function cookieSecure(): boolean {
  const explicit = process.env.COOKIE_SECURE?.trim();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return process.env.NODE_ENV === 'production';
}
