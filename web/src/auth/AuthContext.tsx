/**
 * 身份层：**当前是谁**。
 *
 * 只管一件事，不管任何业务数据。数据在后端按身份筛完才发过来，
 * 所以「换人」和「重拉数据」是两件事，由两处各自负责 ——
 * 合成一个 context 会让「换了人还留着上一个人的列表」这种 bug 变得可能。
 *
 * 身份的唯一来源是 `GET /auth/me`（也就是服务端会话）。页面不存 token、
 * 不把姓名角色塞进 localStorage —— 刷新之后向服务端重新问一次。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { login, logout, whoami } from '../api/client';
import type { Me } from '../api/types';

export type AuthPhase = 'booting' | 'anonymous' | 'ready';

interface AuthValue {
  me: Me | null;
  phase: AuthPhase;
  /** 登录页顶部的一次性提示（会话过期之类）。 */
  notice: string;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** 任何请求拿到 401 时调用：清空身份，路由守卫会把人送回登录页。 */
  expire: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [phase, setPhase] = useState<AuthPhase>('booting');
  const [notice, setNotice] = useState('');

  // 启动：问一次「这个 cookie 还算数吗」。算数就直接进系统，刷新不用重新登录。
  useEffect(() => {
    let cancelled = false;

    void whoami()
      .catch(() => null)
      .then((user) => {
        if (cancelled) return;
        if (user) {
          setMe(user);
          setPhase('ready');
        } else {
          setPhase('anonymous');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const user = await login(username, password);
    setNotice('');
    setMe(user);
    setPhase('ready');
  }, []);

  const signOut = useCallback(async () => {
    await logout();
    setMe(null);
    setPhase('anonymous');
    setNotice('');
  }, []);

  const expire = useCallback(() => {
    setMe(null);
    setPhase('anonymous');
    setNotice('登录已失效，请重新登录');
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ me, phase, notice, signIn, signOut, expire }),
    [me, phase, notice, signIn, signOut, expire],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth 必须在 AuthProvider 里使用');
  return value;
}
