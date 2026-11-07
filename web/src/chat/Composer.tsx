/**
 * 输入区。
 *
 * 高度交给 antd 的 `autoSize`：`minRows` / `maxRows` 就是上下限，
 * 不需要在 effect 里读 `scrollHeight` 再写内联样式 —— 那种写法会
 * 「先按旧高度画一帧再跳」，而且上限值会在 JS 和 CSS 里各存一份。
 *
 * 生成中时那颗按钮是「停止」，不是「发送」：同一个位置两个动作，由 `busy`
 * 决定，而不是并排放两个按钮让人挑。
 */

import { SendOutlined, StopOutlined } from '@ant-design/icons';
import { Button, Input } from 'antd';
import { useEffect, useRef, type ComponentRef, type KeyboardEvent } from 'react';

interface Props {
  /** 受控：空状态里的例子 chip 要把问题填进来，所以草稿不能由输入框自己藏着。 */
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  onSend: (question: string) => void;
  onStop: () => void;
  /** 每加一，就把焦点收回输入框。焦点是命令式的，只能用 ref。 */
  focusTick: number;
}

export function Composer({ value, onChange, busy, onSend, onStop, focusTick }: Props) {
  const input = useRef<ComponentRef<typeof Input.TextArea>>(null);

  useEffect(() => {
    if (focusTick > 0) input.current?.focus();
  }, [focusTick]);

  function submit() {
    const question = value.trim();
    // 服务端 DTO 要 2~200 字。在输入框这一侧就拦住，比发出去收一个
    // 400 的错误气泡体面 —— 用户不该替服务端当校验报错的观众。
    if (!question || question.length < 2 || busy) return;
    onChange('');
    onSend(question);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    // ⚠️ 中文输入法选词也是回车。不判 isComposing 的话，每次选字都会把半截问题发出去。
    if (event.nativeEvent.isComposing) return;

    event.preventDefault();
    if (!busy) submit();
  }

  return (
    <div className="composer">
      <div className="composer-inner">
        <div className="composer-box">
          <Input.TextArea
            ref={input}
            variant="borderless"
            autoSize={{ minRows: 1, maxRows: 5 }}
            maxLength={200}
            placeholder="问一句…（Enter 发送，Shift + Enter 换行）"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button
            type="primary"
            shape="circle"
            aria-label={busy ? '停止' : '发送'}
            icon={busy ? <StopOutlined /> : <SendOutlined />}
            onClick={busy ? onStop : submit}
            disabled={!busy && value.trim().length < 2}
          />
        </div>
      </div>
    </div>
  );
}
