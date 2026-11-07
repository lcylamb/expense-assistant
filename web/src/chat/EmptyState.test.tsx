import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState } from './EmptyState';
import type { Expense } from '../api/types';

afterEach(cleanup);

function expense(overrides: Partial<Expense>): Expense {
  return {
    code: 'BX-2026-0001',
    title: '上海出差',
    applicant: '张三',
    department: '销售部',
    category: 'TRAVEL',
    status: 'SUBMITTED',
    amount: '2380.00',
    submittedAt: '2026-08-12T09:00:00.000Z',
    ...overrides,
  };
}

describe('问答页空状态', () => {
  it('例子跟着单子的状态走：驳回的第一颗是「为什么被驳回」', () => {
    render(
      <EmptyState
        expense={expense({ code: 'BX-2026-0004', status: 'REJECTED' })}
        onPick={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: '为什么被驳回' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '问审批意见' })).not.toBeInTheDocument();
  });

  it('非驳回的单子问审批意见', () => {
    render(<EmptyState expense={expense({})} onPick={() => {}} />);

    expect(screen.getByRole('button', { name: '问审批意见' })).toBeInTheDocument();
  });

  it('点例子只把问题交出去，不带单号 —— 换单在列表里做', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<EmptyState expense={expense({})} onPick={onPick} />);

    await user.click(screen.getByRole('button', { name: '问金额' }));

    expect(onPick).toHaveBeenCalledWith('一共多少钱？');
  });

  it('单号不在库里时不给例子，只说回去换一张', () => {
    render(<EmptyState expense={undefined} onPick={() => {}} />);

    expect(screen.getByText('这张单号在库里不存在')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
