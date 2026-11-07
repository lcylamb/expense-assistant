import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer';

afterEach(cleanup);

function setup(value = '', busy = false) {
  const onChange = vi.fn();
  const onSend = vi.fn();
  const onStop = vi.fn();
  const user = userEvent.setup();
  render(
    <Composer
      value={value}
      onChange={onChange}
      busy={busy}
      onSend={onSend}
      onStop={onStop}
      focusTick={0}
    />,
  );
  const textarea = screen.getByPlaceholderText(/问一句/);
  const send = screen.getByRole('button', { name: '发送' });
  return { onChange, onSend, onStop, user, textarea, send };
}

describe('输入区', () => {
  it('输入上限是 200 字，和服务端 DTO 一致', () => {
    const { textarea } = setup('a'.repeat(200));
    expect(textarea).toHaveAttribute('maxlength', '200');
  });

  it('一个字发不出去：服务端要求至少 2 字，不该让用户收 400', () => {
    const { send, onSend } = setup('钱');
    expect(send).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('够长的问题能发：清空输入框、交给 onSend', async () => {
    const { user, textarea, send, onSend, onChange } = setup('这张单多少钱？');
    await user.click(send);
    expect(onSend).toHaveBeenCalledWith('这张单多少钱？');
    expect(onChange).toHaveBeenCalledWith('');
    expect(textarea).toBeEnabled();
  });

  it('Shift + Enter 是换行不是发送', async () => {
    const { user, textarea, onSend } = setup('第一行');
    await user.type(textarea, '{Shift>}{Enter}{/Shift}');
    expect(onSend).not.toHaveBeenCalled();
  });
});
