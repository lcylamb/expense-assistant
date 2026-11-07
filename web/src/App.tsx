/**
 * 应用根：主题 / 语言 / 全局容器配置，加路由表。
 *
 * 配置放在这里而不是入口文件：测试渲染整个应用时，拿到的就是线上那套
 * 主题和语言，不会出现「测试里是默认主题、线上是定制主题」的两份配置。
 */

import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoutes } from './components/ProtectedRoutes';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';

/**
 * `AntApp` 提供 message / notification 的上下文 —— 静态方法拿不到主题，
 * 在 React 18 的并发渲染下还会警告。
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      // 两个字的中文按钮（登录 / 停止 / 发送）antd 默认会插一个空格，这里不需要。
      button={{ autoInsertSpace: false }}
      theme={{
        // 打开 CSS 变量：styles.css 里那几条手写样式可以直接引 `--ant-color-*`，
        // 不用把主色、文字色、边框色在 JS 和 CSS 里各存一份 hex。
        cssVar: true,
        token: {
          colorPrimary: '#2f6fed',
          borderRadius: 8,
          fontSize: 14,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
        },
      }}
    >
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  );
}

/**
 * 只有两页：登录、列表（问答在列表的抽屉里）。
 * 设计说明写在 README，不占一个页面 —— 那是给看仓库的人看的，不是给用演示的人看的。
 */
export function App() {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<ProtectedRoutes />}>
            <Route index element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<OverviewPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </AuthProvider>
  );
}
