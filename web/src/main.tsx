import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import 'antd/dist/reset.css';
import { App, AppProviders } from './App';
import './styles.css';

/**
 * 入口只做两件环境的事：挂载点、路由历史。
 * 主题和语言在 `AppProviders` 里，测试渲染应用时用的是同一份。
 *
 * 用 HashRouter 是因为生产环境由 Nest 的 `useStaticAssets` 托管 `public/`，
 * 它没有配 SPA 回退 —— `/chat/BX-2026-0001` 这种深链接会 404。
 * 哈希路由把路径留在 `#` 后面，服务端永远只看到 `/`。
 */
const container = document.getElementById('root');
if (!container) throw new Error('找不到挂载点 #root');

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <HashRouter>
        <App />
      </HashRouter>
    </AppProviders>
  </StrictMode>,
);
