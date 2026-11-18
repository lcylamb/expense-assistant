/**
 * 首屏引导：把「问一问」这个入口指出来。
 *
 * 为什么放在列表页而不是抽屉里：抽屉打开的时候人已经找到了入口，
 * 再讲一遍是废话。真正需要解释的时刻是「站在列表前，不知道这一列链接能干什么」。
 *
 * 只出现一次（记在 localStorage）。第二遍出现就变成挡路的东西了 ——
 * 这个页面是给人看单据的，不是给人看说明书的。
 */

import { CloseOutlined, MessageOutlined } from '@ant-design/icons';
import { Button, Typography } from 'antd';
import { useState } from 'react';

/** 带版本号：以后想再引导一轮，改 key 即可，不用猜旧值。 */
const STORAGE_KEY = 'expense.ask-intro.v1';

function alreadySeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'done';
  } catch {
    // 无痕模式下访问 localStorage 会抛。为了一个提示把整页搞崩不值得，
    // 当作「看过了」直接不显示。
    return true;
  }
}

function markSeen() {
  try {
    localStorage.setItem(STORAGE_KEY, 'done');
  } catch {
    // 同上：写不进去就算了，最多下次再看一遍。
  }
}

interface Props {
  /** 拿哪张单做示范。空数组时不出引导 —— 没单可问，指了也没用。 */
  firstCode: string | undefined;
  onTry: (code: string) => void;
}

export function AskIntro({ firstCode, onTry }: Props) {
  const [hidden, setHidden] = useState(alreadySeen);

  if (hidden || !firstCode) return null;

  function close() {
    markSeen();
    setHidden(true);
  }

  return (
    <div className="ask-intro">
      <span className="ask-intro-icon" aria-hidden>
        <MessageOutlined />
      </span>

      <div className="ask-intro-body">
        <div className="ask-intro-head">
          <Typography.Text strong>这些单据可以直接问</Typography.Text>
          <Button
            className="ask-intro-close"
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={close}
            aria-label="关闭引导"
          />
        </div>
        <Typography.Text type="secondary" className="ask-intro-text">
          点右侧「问一问」，就这张单提问：为什么被驳回、谁批的、钱花在哪。
          答案只取本单记录，不足时会明确说明。
        </Typography.Text>

        <div className="ask-intro-actions">
          <Button
            type="primary"
            size="small"
            onClick={() => {
              close();
              onTry(firstCode);
            }}
          >
            拿 {firstCode} 试一下
          </Button>
        </div>
      </div>
    </div>
  );
}
