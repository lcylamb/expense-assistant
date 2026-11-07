/**
 * 问答视图本体：对话 + 输入框。
 *
 * 它不知道自己在哪儿（抽屉里），单号由外面传进来 —— 面板标题上写的就是这张单，
 * 所以这里不再放单号选择器：换单回列表点另一行，这里只负责把它问清楚。
 */

import { useEffect, useRef, useState } from 'react';
import { useExpenses } from '../data/ExpensesContext';
import { useAsk } from './AskProvider';
import { Composer } from './Composer';
import { EmptyState, PresetChips } from './EmptyState';
import { TurnView } from './TurnView';

interface Props {
  code: string;
}

export function ChatView({ code }: Props) {
  const { code: sessionCode, select, turns, busy, send, stop } = useAsk();
  const { expenses } = useExpenses();

  const [draft, setDraft] = useState('');
  const [focusTick, setFocusTick] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  // 视图上的单号 → 会话。同一个单号不重复设，否则每渲染一次就 reset 一次对话。
  useEffect(() => {
    if (code !== sessionCode) select(code);
  }, [code, sessionCode, select]);

  // 换单号必须把没发出去的草稿一起丢掉 —— 输入框是共享的，
  // 留着的话，给 A 写了半截的问题会被原样发给 B。会话按单号分桶了，
  // 输入框没有理由不分。
  useEffect(() => {
    setDraft('');
  }, [code]);

  const current = expenses.find((expense) => expense.code === code);

  // 贴着底就跟着滚。用户自己往上翻着看的时候，别硬把他拽回来。
  // 这是唯一非做不可的 DOM 读取：滚动位置在 CSS 里没有等价物。
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const gap = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (gap < 80) node.scrollTop = node.scrollHeight;
  }, [turns]);

  // 点例子只是把问题放进输入框，发不发由人决定 —— 顺手聚焦，少一次点击。
  function pick(question: string) {
    setDraft(question);
    setFocusTick((tick) => tick + 1);
  }

  return (
    <>
      <div className="chat" ref={scroller}>
        {turns.length === 0 ? (
          <EmptyState expense={current} onPick={pick} />
        ) : (
          turns.map((turn) => <TurnView key={turn.id} turn={turn} />)
        )}
      </div>

      {/* 对话开始后例子不消失，压成一行留在输入框上方 —— 想问下一句时有东西可点。 */}
      {turns.length > 0 ? (
        <div className="quick-ask">
          <PresetChips expense={current} onPick={pick} inline />
        </div>
      ) : null}

      <Composer
        value={draft}
        onChange={setDraft}
        busy={busy}
        onSend={send}
        onStop={stop}
        focusTick={focusTick}
      />
    </>
  );
}
