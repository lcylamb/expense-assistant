/**
 * 测试辅助。
 *
 * 两件事：
 *   1. `fetch` 换成一张路由表。不去 mock 我们自己的 `api/client.ts` ——
 *      那样测的是「组件会不会调用某个函数」，而真正会出问题的地方是
 *      「请求带没带 cookie、401 之后有没有回登录页」。从 fetch 这一层截，
 *      这两件事才在测试范围里。
 *   2. 渲染整个应用（连路由带 provider），而不是单个页面组件 ——
 *      页面已经不接 `onOpen` 这类回调了，跳转由路由负责，只有把路由一起
 *      渲出来才测得到。
 */

import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { App, AppProviders } from './App';

export interface Reply {
  status?: number;
  body?: unknown;
}

type Routes = Record<string, (init?: RequestInit) => Reply>;

/** 把一个普通对象伪装成 `Response`。测试里用不到流，只用到 status / json / headers。 */
function toResponse({ status = 200, body = {} }: Reply): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

/**
 * 装上假 fetch，返回那个 mock 本身（用来断言「没有发请求」这类事）。
 *
 * 匹配规则是「URL 里包含这个路径」，因为代码里写的是相对路径，
 * 而 fetch 收到的可能是 `http://localhost/auth/me` 这种绝对地址。
 */
export function mockFetch(routes: Routes) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    // 三种入参形态都要接：字符串、URL 对象、Request。
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = Object.keys(routes).find((candidate) => url.includes(candidate));
    if (!path) {
      throw new Error(`测试没有为这个请求准备响应：${url}`);
    }
    return toResponse(routes[path]!(init));
  });

  vi.stubGlobal('fetch', mock);
  return mock;
}

/** 从某个路由进站，整个应用一起渲染（主题、语言、路由都用线上那一套）。 */
export function renderApp({ route = '/' }: { route?: string } = {}) {
  return render(
    <AppProviders>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </AppProviders>,
  );
}
