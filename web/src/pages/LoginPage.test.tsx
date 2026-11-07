import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderApp } from '../test-utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('登录页', () => {
  it('列出全部演示账号，但不预填密码', async () => {
    mockFetch({ '/auth/me': () => ({ status: 401 }) });
    renderApp({ route: '/login' });

    for (const name of ['张三', '李四', '王五', '赵六', '王经理', '郑十']) {
      expect(await screen.findByText(name)).toBeInTheDocument();
    }
    expect(screen.getByLabelText('密码')).toHaveValue('');
  });

  it('点演示账号只是填表，不发起登录请求', async () => {
    const fetchMock = mockFetch({ '/auth/me': () => ({ status: 401 }) });
    const user = userEvent.setup();
    renderApp({ route: '/login' });

    await user.click(await screen.findByText('张三'));

    expect(screen.getByLabelText('用户名')).toHaveValue('zhangsan');
    expect(screen.getByLabelText('密码')).toHaveValue('demo1234');
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/auth/login'),
      expect.anything(),
    );
  });

  it('密码错了显示服务端那句话，不区分「没这个账号」', async () => {
    mockFetch({
      '/auth/me': () => ({ status: 401 }),
      '/auth/login': () => ({ status: 401, body: { message: '用户名或密码不对' } }),
    });
    const user = userEvent.setup();
    renderApp({ route: '/login' });

    await user.type(screen.getByLabelText('用户名'), 'zhangsan');
    await user.type(screen.getByLabelText('密码'), 'wrong');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('用户名或密码不对');
  });

  it('没登录直接打受保护地址，会被送回登录页', async () => {
    mockFetch({ '/auth/me': () => ({ status: 401 }) });
    renderApp({ route: '/overview' });

    expect(await screen.findByRole('button', { name: '登录' })).toBeInTheDocument();
  });
});
