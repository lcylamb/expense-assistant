/**
 * 路由守卫。
 *
 * 三件事按顺序发生，缺一件都会出现「页面先画了一半再跳走」：
 *   1. 还在问 `/auth/me` 时不渲染任何业务内容（只给一个 loading）；
 *   2. 没登录直接 replace 到登录页，浏览器后退回不到受保护页面；
 *   3. 登录之后才挂数据层和会话层 —— 匿名状态下这两层根本不存在。
 *
 * `key={me.username}`：换人就把整棵子树连单据列表、对话、筛选一起丢掉。
 * 比在十几个地方逐个 reset 更可靠，漏一个就是「上一个人的数据跟着过来了」。
 */

import { Space, Spin, Typography } from 'antd';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AskProvider } from '../chat/AskProvider';
import { ExpensesProvider } from '../data/ExpensesContext';
import { AppLayout } from './AppLayout';

export function ProtectedRoutes() {
  const { phase, me } = useAuth();

  if (phase === 'booting') {
    return (
      <div className="booting">
        <Space direction="vertical" align="center" size={12}>
          <Spin size="large" />
          <Typography.Text type="secondary">正在确认登录状态…</Typography.Text>
        </Space>
      </div>
    );
  }

  if (!me) return <Navigate to="/login" replace />;

  return (
    <ExpensesProvider key={me.username}>
      <AskProvider>
        <AppLayout />
      </AskProvider>
    </ExpensesProvider>
  );
}
