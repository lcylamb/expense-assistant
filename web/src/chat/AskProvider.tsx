/**
 * 问答会话：**当前这张单 + 这串对话**。
 *
 * 提到路由层而不是放在 ChatPage 里 —— 切到概览再回来，对话得还在。
 * ChatPage 只是这个会话的一个视图，它可以挂载、卸载，会话不该跟着走。
 *
 * 单号的唯一真相是 URL（`/chat/:code`）。这里的 `code` 是从路由同步过来的
 * 副本，作用只有一个：让 `useAskStream` 知道「话题变了」。
 */

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '../auth/AuthContext';
import { useAskStream, type AskState } from './useAskStream';

interface AskValue extends AskState {
  code: string;
  /** 换话题。由路由变化驱动，页面不直接调用。 */
  select: (code: string) => void;
}

const AskContext = createContext<AskValue | null>(null);

export function AskProvider({ children }: { children: ReactNode }) {
  const { expire } = useAuth();
  const [code, setCode] = useState('');

  // 换单号会 abort 掉正在跑的那一轮，并清空历史 —— 见 useAskStream 里的说明。
  const ask = useAskStream(code, expire);

  const value = useMemo<AskValue>(
    () => ({ ...ask, code, select: setCode }),
    [ask, code],
  );

  return <AskContext.Provider value={value}>{children}</AskContext.Provider>;
}

export function useAsk(): AskValue {
  const value = useContext(AskContext);
  if (!value) throw new Error('useAsk 必须在 AskProvider 里使用');
  return value;
}
