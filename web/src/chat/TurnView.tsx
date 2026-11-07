import { Popover, Typography } from 'antd';
import type { BotTurn, Turn } from './useAskStream';
import { TOOL_LABEL, TURN_STATUS_TEXT } from '../lib/constants';
import { describeField } from '../lib/evidence';
import { elapsed } from '../lib/format';

/**
 * 一条消息。
 *
 * 气泡是自己画的，没用组件库：聊天气泡的排版（贴边、圆角方向、流式光标）
 * 没有通用组件的形状，antd 里也没有对应物。但气泡里的依据清单是 Popover、
 * 正文是 Typography —— 这些有现成的就用现成的。
 *
 * 用户消息把单号一起留在气泡上方：后面换过单号之后，回头看也知道
 * 当时问的是哪张单子。
 */
export function TurnView({ turn }: { turn: Turn }) {
  if (turn.role === 'user') {
    return (
      <div className="turn user">
        <div className="stack">
          <Typography.Text type="secondary" className="turn-code">
            {turn.code}
          </Typography.Text>
          <div className="bubble">
            <p>{turn.question}</p>
          </div>
        </div>
      </div>
    );
  }

  return <AssistantTurn turn={turn} />;
}

function AssistantTurn({ turn }: { turn: BotTurn }) {
  const streaming = turn.status === 'streaming';
  const pending = turn.status === 'pending';

  const bubbleClass = ['bubble', pending ? 'pending' : '', streaming ? 'streaming' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={turn.status === 'error' ? 'turn bot error' : 'turn bot'}>
      <div className="avatar" aria-hidden="true">
        AI
      </div>
      <div className="stack">
        <div className={bubbleClass}>
          <p>{turn.text}</p>
        </div>

        <div className="meta">
          <span className={`status ${turn.status}`}>
            {pending || streaming ? <i className="dot" /> : null}
            {TURN_STATUS_TEXT[turn.status]}
          </span>
          <Evidence fields={turn.evidence} />
        </div>

        <Metrics turn={turn} />
      </div>
    </div>
  );
}

/**
 * 依据字段。
 *
 * 正文只写「依据几处」，具体是哪几个字段收进悬停层 —— 这不是藏，
 * 而是分层：报销人要的是「这句结论有出处」，字段路径是给核对的人看的。
 * 之前它把 `items[0].name` 直接打成 Tag 摊在正文里，等于把给模型的协议
 * 漏给了终端用户。
 *
 * 悬停层里人话和原路径并排，谁都不得罪：看得懂，也查得到。
 */
function Evidence({ fields }: { fields: readonly string[] }) {
  if (fields.length === 0) return null;

  return (
    <Popover
      placement="topLeft"
      trigger={['hover', 'click']}
      title="这条结论用到的字段"
      content={
        <ul className="evidence-list">
          {fields.map((field) => {
            const { label, raw, known } = describeField(field);
            return (
              <li key={field}>
                <span>{label}</span>
                {/* 翻译不了就只显示一遍，不摆两条一样的字。 */}
                {known ? <code>{raw}</code> : null}
              </li>
            );
          })}
        </ul>
      }
    >
      <button type="button" className="evidence-trigger">
        依据 {fields.length} 处
      </button>
    </Popover>
  );
}

/**
 * 指标行。
 *
 * 用 JSX 而不是拼 `innerHTML` —— 这一行里混着服务端来的字符串（工具名、请求 id），
 * 「服务端的东西不当 HTML 解析」这条规矩在这里最容易破例，所以它必须由 React 拼。
 */
function Metrics({ turn }: { turn: BotTurn }) {
  if (turn.status === 'stopped') {
    return (
      <div className="metrics">
        {turn.stoppedAtMs === null ? '已停止' : `已收 ${turn.stoppedAtMs} ms 后停止`}
      </div>
    );
  }

  if (turn.status === 'pending') return <div className="metrics" />;

  const usage = turn.metrics?.usage ?? null;
  const trace = turn.trace.map((step) =>
    step.ok ? (TOOL_LABEL[step.tool] ?? step.tool) : `${TOOL_LABEL[step.tool] ?? step.tool}（失败）`,
  );

  // 失败的那轮没有「答案」，字数和 token 都没意义；总耗时和请求 id 是
  // 报障时唯一有用的信息，所以只留这两个（外加失败的工具轨迹）。
  if (turn.status === 'error') {
    return (
      <div className="metrics">
        总耗时 <b>{elapsed(turn.totalMs)}</b>
        {trace.length > 0 ? <span>　·　查了 {trace.join(' → ')}</span> : null}
        {turn.requestId ? <span>　·　请求 {turn.requestId}</span> : null}
      </div>
    );
  }

  return (
    <div className="metrics">
      首字延迟 <b>{elapsed(turn.firstDeltaMs)}</b>
      　·　总耗时 <b>{elapsed(turn.totalMs)}</b>
      　·　
      {usage ? (
        <>
          <b>{usage.promptTokens + usage.completionTokens}</b> tokens
        </>
      ) : (
        <>
          tokens <b>未报</b>
        </>
      )}
      　·　增量 <b>{turn.deltaChars}</b> 字　·　最终 <b>{turn.text.length}</b> 字
      {trace.length > 0 ? <span>　·　查了 {trace.join(' → ')}</span> : null}
      {turn.requestId ? <span>　·　请求 {turn.requestId}</span> : null}
    </div>
  );
}
