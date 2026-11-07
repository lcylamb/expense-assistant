/**
 * 单据数据层：**当前账号能看到的单据 + 统计**。
 *
 * 列表和统计来自同一份响应（`GET /assistant/expenses`），所以它们住在一个
 * context 里 —— 分开放就会出现「表格 4 行、卡片写 10 张」的两个真相。
 *
 * 挂在路由守卫里面，且按用户名 key 住：换人即重建，不需要在十几个地方
 * 逐个 reset。没登录的时候这一层根本不存在，也就没有「匿名用户的空列表」
 * 这种中间状态要处理。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, listExpenses } from '../api/client';
import type { Expense, ExpensesSummary } from '../api/types';
import { useAuth } from '../auth/AuthContext';

interface ExpensesValue {
  expenses: Expense[];
  summary: ExpensesSummary | null;
  loading: boolean;
  /** 加载失败的文案；非空时表格里显示它。 */
  error: string;
  reload: () => void;
}

const ExpensesContext = createContext<ExpensesValue | null>(null);

export function ExpensesProvider({ children }: { children: ReactNode }) {
  const { expire } = useAuth();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpensesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 组件卸载后别再 setState。请求是自己发出去的，卸载时它们还在飞。
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // 上一次还没回来的请求。连点刷新、或者路由重进都会再发一次，
  // 不取消的话两个响应会按到达顺序互相覆盖 —— 先发的后到，就把新的盖成旧的。
  const inflight = useRef<AbortController | null>(null);
  useEffect(() => () => inflight.current?.abort(), []);

  const reload = useCallback(async () => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;

    setLoading(true);
    setError('');

    try {
      const data = await listExpenses(controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      setExpenses(data.expenses);
      setSummary(data.summary);
    } catch (cause) {
      // 主动取消不是失败：它连 401 都不该触发，更不该把列表清空。
      if (!alive.current || controller.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) {
        expire();
        return;
      }
      setExpenses([]);
      setSummary(null);
      setError(`${cause instanceof Error ? cause.message : String(cause)} —— 刷新页面重试`);
    } finally {
      // 只有「还是我这次请求」才收掉 loading：被取代的那次不能把新请求的 loading 关掉。
      if (inflight.current === controller) {
        inflight.current = null;
        if (alive.current) setLoading(false);
      }
    }
  }, [expire]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<ExpensesValue>(
    () => ({ expenses, summary, loading, error, reload: () => void reload() }),
    [expenses, summary, loading, error, reload],
  );

  return <ExpensesContext.Provider value={value}>{children}</ExpensesContext.Provider>;
}

export function useExpenses(): ExpensesValue {
  const value = useContext(ExpensesContext);
  if (!value) throw new Error('useExpenses 必须在 ExpensesProvider 里使用');
  return value;
}
