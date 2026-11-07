import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { User } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { toViewerRole, type ViewerRole } from '../assistant/viewer.js';
import { hashPassword, verifyPassword } from './password.js';
import { signSession, verifySession } from './session.js';

/** 返回给前端的账号画像。故意**不含** passwordHash。 */
export interface SessionUser {
  username: string;
  name: string;
  role: ViewerRole;
  department: string;
}

/** 服务端手里的账号 = 画像 + 主键。id 只用于权限判定，不进响应体。 */
export interface SessionAccount extends SessionUser {
  id: string;
}

/**
 * 登录与会话。
 *
 * ── 这个类只做三件事 ──
 *
 * 1. 校验用户名密码，对不上就抛 401；
 * 2. 签发 / 校验会话令牌（细节在 session.ts）；
 * 3. 按令牌里的 id 把账号查出来 —— 每次请求都查，不缓存。
 *
 * ── 为什么每次都查库 ──
 *
 * 把姓名和角色写进令牌，确实能省一次查询。但那样「把某人从审批人改成申请人」
 * 要等令牌过期（最长 8 小时）才生效 —— 权限变更的窗口期是最不该省的那点开销。
 * 这条查询走主键，代价是一次索引命中的事。
 */
@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 登录。
   *
   * ⚠️ 账号不存在和密码错误返回**同一个** 401、同一句话。分开写看起来更友好，
   * 实际上是一个用户名枚举接口：'张三' 有账号、'李四' 没账号，这件事本身就是
   * 信息。登录接口被枚举之后，撞库只要针对存在的那些账号跑。
   */
  async login(username: string, password: string): Promise<SessionAccount> {
    const user = await this.prisma.user.findUnique({ where: { username } });

    // 账号不存在时也跑一遍哈希校验：直接 return 会让响应时间差出约 40ms，
    // 那 40ms 就是「这个用户名存在」的另一种说法。
    const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash()));

    if (!user || !ok) {
      throw new UnauthorizedException('用户名或密码不对');
    }

    return toSessionAccount(user);
  }

  /** 签发会话令牌。入参是 user id，不是整个对象 —— 令牌里也只放 id。 */
  async issueToken(userId: string): Promise<string> {
    return signSession(userId);
  }

  /** 校验令牌并取账号。令牌无效、过期、账号已删，一律 null。 */
  async resolve(token: string): Promise<SessionAccount | null> {
    const userId = await verifySession(token);
    if (!userId) return null;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return user ? toSessionAccount(user) : null;
  }
}

export function toSessionAccount(user: User): SessionAccount {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: toViewerRole(user.role),
    department: user.department,
  };
}

/** 去掉内部主键，得到可以直接发给浏览器的画像。 */
export function toSessionUser(account: SessionAccount): SessionUser {
  const { username, name, role, department } = account;
  return { username, name, role, department };
}

let cachedDummyHash: string | undefined;

/** 一个永远匹配不上的哈希，用来让「账号不存在」这条路也付出同样的计算成本。 */
async function dummyHash(): Promise<string> {
  cachedDummyHash ??= await hashPassword('not-a-real-password');
  return cachedDummyHash;
}
