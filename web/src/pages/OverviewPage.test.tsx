import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderApp } from '../test-utils';
import type { ExpensesResponse, Me } from '../api/types';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const me: Me = { username: 'zhangsan', name: '张三', role: 'applicant', department: '销售部' };

/**
 * 一份「申请人视角」的响应：只有他自己的两张单。
 * 页面拿到的就是这么点数据 —— 别人的单是在服务端被筛掉的，不是在这里被隐藏的。
 */
const mine: ExpensesResponse = {
  expenses: [
    {
      code: 'BX-2026-0001',
      title: '上海出差',
      applicant: '张三',
      department: '销售部',
      category: 'TRAVEL',
      status: 'SUBMITTED',
      amount: '2380.00',
      submittedAt: '2026-08-12T09:00:00.000Z',
    },
    {
      code: 'BX-2026-0004',
      title: '客户晚餐',
      applicant: '张三',
      department: '销售部',
      category: 'ENTERTAIN',
      status: 'REJECTED',
      amount: '860.50',
      submittedAt: '2026-08-14T09:00:00.000Z',
    },
  ],
  summary: {
    count: 2,
    byStatus: { SUBMITTED: 1, REJECTED: 1 },
    totalAmount: '3240.50',
    rejectedCount: 1,
  },
};

function stubSession(data: ExpensesResponse = mine) {
  return mockFetch({
    '/auth/me': () => ({ body: me }),
    '/assistant/expenses': () => ({ body: data }),
  });
}

describe('概览页', () => {
  it('只显示服务端给回来的那两张单', async () => {
    stubSession();
    renderApp({ route: '/overview' });

    expect(await screen.findByText('上海出差')).toBeInTheDocument();
    expect(screen.getByText('客户晚餐')).toBeInTheDocument();
    expect(screen.getByText('BX-2026-0001')).toBeInTheDocument();
    // 金额是服务端给的字符串，页面不做二次计算。
    expect(screen.getByText('¥2,380.00')).toBeInTheDocument();
    expect(screen.getByText('金额合计')).toBeInTheDocument();
  });

  it('类型筛选只筛显示层', async () => {
    stubSession();
    const user = userEvent.setup();
    renderApp({ route: '/overview' });

    await screen.findByText('上海出差');
    // Segmented 的每一项是 radio；表格里也有「业务招待」这四个字，不能用文本选。
    // 那个 input 被 antd 藏起来了（pointer-events: none），要点外面那层 label。
    const option = screen.getByRole('radio', { name: '业务招待' });
    await user.click(option.closest('label') ?? option);

    await waitFor(() => expect(screen.queryByText('上海出差')).not.toBeInTheDocument());
    expect(screen.getByText('客户晚餐')).toBeInTheDocument();
  });

  it('点整行和点「问一问」是同一个动作：开抽屉', async () => {
    stubSession();
    const user = userEvent.setup();
    renderApp({ route: '/overview' });

    await user.click(await screen.findByText('客户晚餐'));

    expect(await screen.findByPlaceholderText(/问一句/)).toBeInTheDocument();
    // 面板标题上写的就是这张单：单号 / 申请人 / 金额那一行。
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText(/BX-2026-0004/)).toBeInTheDocument();
  });

  it('点「问一问」在旁边开抽屉，列表不离开视线', async () => {
    stubSession();
    const user = userEvent.setup();
    renderApp({ route: '/overview' });

    const buttons = await screen.findAllByRole('button', { name: /问一问/ });
    await user.click(buttons[0]!);

    // 抽屉里就是问答本尊：输入框在，单号是这一行的。
    expect(await screen.findByPlaceholderText(/问一句/)).toBeInTheDocument();
    // 列表还在背后 —— 这正是抽屉相对整页跳转的意义。
    expect(screen.getByText('客户晚餐')).toBeInTheDocument();
    // 面板标题写的是这一行的单号，不是永远第一张。
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText(/BX-2026-0001/)).toBeInTheDocument();
  });

  it('抽屉里的单号跟着行号走，不是永远第一张', async () => {
    stubSession();
    const user = userEvent.setup();
    renderApp({ route: '/overview' });

    const buttons = await screen.findAllByRole('button', { name: /问一问/ });
    await user.click(buttons[1]!);

    expect(await screen.findByPlaceholderText(/问一句/)).toBeInTheDocument();
    // 面板标题上写的就是这张单：单号 / 申请人 / 金额那一行。
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText(/BX-2026-0004/)).toBeInTheDocument();
  });

  it('换单号丢掉没发出去的草稿：给 A 写的半截话不能发给 B', async () => {
    stubSession();
    const user = userEvent.setup();
    renderApp({ route: '/overview' });

    const buttons = await screen.findAllByRole('button', { name: /问一问/ });
    await user.click(buttons[0]!);
    const textarea = await screen.findByPlaceholderText(/问一句/);
    await user.type(textarea, '先问一下这张');

    // 关掉再开另一张 —— 草稿必须留在上一张单那边。
    await user.keyboard('{Escape}');
    await user.click(buttons[1]!);
    const again = await screen.findByPlaceholderText(/问一句/);
    expect(again).toHaveValue('');
  });

  it('列表加载失败时把原因写在页面上，而不是空白', async () => {
    mockFetch({
      '/auth/me': () => ({ body: me }),
      '/assistant/expenses': () => ({ status: 503, body: { message: '数据库暂时不可用' } }),
    });
    renderApp({ route: '/overview' });

    expect(await screen.findByText(/数据库暂时不可用/)).toBeInTheDocument();
  });
});
