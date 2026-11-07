/**
 * 「问一问」抽屉：在列表旁边直接问，不用离开这一屏。
 *
 * 开关状态放在 URL 的查询参数里（`/overview?ask=BX-...`），不是组件 state。
 * 理由和单号进路径一样：刷新、后退、把链接发给别人，抽屉都还开着；
 * 而且「哪张单在问」只有一份真相，不会出现 URL 说 A、界面在问 B。
 *
 * 里面就是 `ChatView` —— 抽屉和整页共用同一份代码，行为不可能走偏。
 *
 * 这里没有「换一张单」的下拉：单号是点行带进来的，换单就回去点另一行。
 * 面板顶上那块标题写的正是这张单本身，所以不需要第二个地方再选一次。
 */

import { Drawer, Space, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useExpenses } from '../data/ExpensesContext';
import { STATUS_COLOR, STATUS_TEXT } from '../lib/constants';
import { money } from '../lib/format';
import { ChatView } from './ChatView';

export function AskDrawer() {
  const [params, setParams] = useSearchParams();
  const { expenses } = useExpenses();

  const asked = params.get('ask') ?? '';

  /**
   * 关的时候参数立刻没了，但面板还有 0.3s 的滑出动画。
   * 直接按 `asked` 渲染，滑出去的会是一块空白 —— 所以留住最后一个单号，
   * 等下一次打开再换掉。这不影响会话：「关掉再打开同一张单」对话还在。
   */
  const [shown, setShown] = useState(asked);
  useEffect(() => {
    if (asked) setShown(asked);
  }, [asked]);

  function close() {
    const next = new URLSearchParams(params);
    next.delete('ask');
    // replace 而不是 push：开关抽屉是轻交互，不该在历史里堆一层。
    setParams(next, { replace: true });
  }

  const expense = expenses.find((item) => item.code === shown);

  return (
    <Drawer
      open={asked !== ''}
      onClose={close}
      width={720}
      className="ask-drawer"
      // 标题写这张单本身：谁报的、多少钱、什么状态。之前这里只有「问一问」三个字，
      // 看的人得回头看列表才知道自己在问哪一张。
      title={
        expense ? (
          <div className="ask-title">
            <Space size={8} align="center">
              <Typography.Text strong>{expense.title}</Typography.Text>
              <Tag color={STATUS_COLOR[expense.status]}>{STATUS_TEXT[expense.status]}</Tag>
            </Space>
            <Typography.Text type="secondary" className="ask-title-meta">
              {expense.code} · {expense.applicant} · {money(expense.amount)}
            </Typography.Text>
          </div>
        ) : (
          <Typography.Text type="secondary">{shown}</Typography.Text>
        )
      }
    >
      {shown ? <ChatView code={asked || shown} /> : null}
    </Drawer>
  );
}
