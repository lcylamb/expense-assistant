import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

/**
 * 密码怎么存。
 *
 * ── 三个决定 ──
 *
 * 1. **用 scrypt，不自己发明。** 它是 Node 内置的、专为「存密码」设计的
 *    内存硬（memory-hard）算法：算一次要几十毫秒和一块内存，所以拿到库的人
 *    想拿字典暴力撞，成本是逐个试的几十毫秒乘上去。参数用 Node 的默认值
 *    （N=16384, r=8, p=1，单次约 40ms）—— 对演示账号够用，写死在代码里而不是
 *    从环境变量读：密码哈希参数一旦上线就不能随便调，调了所有人得重设密码。
 *
 * 2. **每个密码一份随机盐。** 没有盐的话，两个用同一个密码的账号哈希值相同，
 *    彩虹表也能一次撞一片。盐和哈希一起存在同一个字段里（`scrypt$盐$哈希`），
 *    因为它们是**一次计算结果的两个部分**，分两个字段存只会多出一种
 *    「盐有了哈希没了」的坏状态。
 *
 * 3. **比对用 `timingSafeEqual`。** 普通 `===` 在第一个不同的字节就返回，
 *    用时随「猜对了几个字节」变化。理论上能靠计时差一个字节一个字节地试出哈希。
 *    这个攻击对 HTTP 上的登录并不总是可行，但代价只是一个函数名，没理由不加。
 */

/** 派生密钥长度。64 字节 = 512 bit，比需要的长，代价可以忽略。 */
const KEY_LENGTH = 64;

/** 盐长度。16 字节是常见选择：足够避免碰撞，又不至于让字段太长。 */
const SALT_LENGTH = 16;

const SCHEME = 'scrypt';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/** 把明文密码变成可入库的字符串。格式：`scrypt$<盐 base64>$<派生值 base64>`。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `${SCHEME}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

/**
 * 校验明文密码。
 *
 * 任何形如「存的不是我们认得的格式」的情况都返回 false 而不是抛异常 ——
 * 库里被人手改坏一行，不该让整个登录端点 500。
 * 长度不同也要先判：`timingSafeEqual` 对长度不同的输入直接抛错。
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, saltBase64, hashBase64] = stored.split('$');
  if (scheme !== SCHEME || !saltBase64 || !hashBase64) return false;

  const salt = Buffer.from(saltBase64, 'base64');
  const expected = Buffer.from(hashBase64, 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  const actual = await scrypt(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
