import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { TurnView } from './TurnView';
import type { BotTurn } from './useAskStream';

afterEach(cleanup);

const answer: BotTurn = {
  id: 'bot-1',
  role: 'assistant',
  status: 'done',
  text: '这张单共 3150.00 元，包含三项。',
  evidence: ['amount', 'items[0].name', 'items[0].amount'],
  trace: [],
  metrics: null,
  requestId: null,
  firstDeltaMs: 120,
  deltaChars: 18,
  totalMs: 900,
  stoppedAtMs: null,
};

describe('回答气泡', () => {
  it('正文只说「依据几处」，字段路径不下沉到界面', () => {
    render(<TurnView turn={answer} />);

    expect(screen.getByText(/依据/)).toHaveTextContent('依据 3 处');
    // 这一条是回归点：之前 `items[0].name` 是被当成 Tag 摊在正文里的。
    expect(document.body.textContent).not.toContain('items[');
    expect(screen.queryByText('amount')).toBeNull();
  });

  it('点开依据才看到明细：人话在前，原路径在旁', async () => {
    const user = userEvent.setup();
    render(<TurnView turn={answer} />);

    await user.click(screen.getByRole('button', { name: '依据 3 处' }));

    expect(await screen.findByText('明细第 1 项 · 名称')).toBeInTheDocument();
    expect(screen.getByText('明细第 1 项 · 金额')).toBeInTheDocument();
    expect(screen.getByText('金额')).toBeInTheDocument();
    // 原路径留着，核对的人要顺着它去查库里的字段。
    expect(screen.getByText('items[0].name')).toBeInTheDocument();
  });

  it('没有依据字段时不渲染入口', () => {
    render(<TurnView turn={{ ...answer, evidence: [] }} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('失败的轮次不摆字数和 token —— 那些是给成功答案的', () => {
    render(
      <TurnView
        turn={{
          ...answer,
          status: 'error',
          text: '没有找到编号为 BX-9999-9999 的报销单',
          metrics: null,
          trace: [],
        }}
      />,
    );

    expect(screen.getByText('出错')).toBeInTheDocument();
    expect(screen.getByText(/总耗时/)).toBeInTheDocument();
    // 回归点：错误气泡里曾显示「增量 0 字 · 最终 12 字」，对失败毫无意义。
    expect(document.body.textContent).not.toContain('增量');
    expect(document.body.textContent).not.toContain('tokens');
  });
});
