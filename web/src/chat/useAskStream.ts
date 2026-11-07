/**
 * 一轮问答的状态机。
 *
 * 这里是「流式」真正落地的地方：一条回答从 `pending`（还没吐字）走到
 * `streaming`（一个字一个字往外冒），最后落在四个终态之一。
 *
 * 终态只有四种，而且**必须**落进其中一种：
 *   · done / insufficient —— 收到 `done` 帧，用最终结果覆盖增量文本；
 *   · stopped —— 用户点了停止，已经吐出来的字留着，但标明没经过最终校验；
 *   · error —— 服务端 `error` 帧、网络断了、或者流 EOF 却没等到终态帧。
 *
 * 最后那种（EOF 没终态）最容易被漏掉：页面会永远停在「生成中」，
 * 看起来像慢，其实连接早就断了。
 *
 * **对话按单号分开存。** 问过 A 再去看 B、然后又回到 A，A 的问答还在原处。
 * 清单和上下文也各存一份：把 A 的结论带进 B 的问题里是最难查的串台，
 * 服务端会按单号重查数据，但历史里的数字是上一张单的，模型照样会说出口。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, openAskStream } from '../api/client';
import type { AgentStep, AskMetrics, AskResult, HistoryTurn } from '../api/types';
import type { TurnStatus } from '../lib/constants';

export interface UserTurn {
  id: string;
  role: 'user';
  code: string;
  question: string;
}

export interface BotTurn {
  id: string;
  role: 'assistant';
  status: TurnStatus;
  text: string;
  evidence: string[];
  trace: AgentStep[];
  metrics: AskMetrics | null;
  requestId: string | null;
  /** 首字到达耗时。还没吐字时是 null —— 0 和「没到」必须分开。 */
  firstDeltaMs: number | null;
  /** 增量阶段一共收了多少字。和最终字数对照着看，才知道校验改了多少。 */
  deltaChars: number;
  /** 客户端实测的总耗时。服务端也报一份，那是它自己算的，两者不一定相等。 */
  totalMs: number | null;
  /** 停止时已经收了多少毫秒——用来告诉用户「这些字只写到这里」。 */
  stoppedAtMs: number | null;
}

export type Turn = UserTurn | BotTurn;

export interface AskState {
  /** 当前这张单的对话。别的单的留在各自那一格，不在这里。 */
  turns: Turn[];
  /** 只在「当前这张单有请求在飞」时为 true。 */
  busy: boolean;
  send: (question: string) => void;
  stop: () => void;
}

const EMPTY_ASSISTANT = {
  status: 'pending' as TurnStatus,
  text: '',
  evidence: [] as string[],
  trace: [] as AgentStep[],
  metrics: null,
  requestId: null,
  firstDeltaMs: null,
  deltaChars: 0,
  totalMs: null,
  stoppedAtMs: null,
};

/**
 * 轮次 id。不用 `crypto.randomUUID()`：它只在安全上下文里有，
 * 而这个页面可能被部署在 http 的内网地址上——那时整个应用会白屏，
 * 只因为生成不了 id。
 */
let sequence = 0;
const nextId = (prefix: string): string => `${prefix}-${++sequence}`;

/**
 * 记一轮历史。只在 `done` 帧上记，而且只记被校验过的三个字段。
 *
 * 流被中断时不记：屏幕上那些字没经过服务端的 `parseAnswer`，
 * 把它当上下文带回下一轮，等于让一段没校验的文本影响后面的答案。
 *
 * 长度在这里裁到 DTO 的上限。服务端不限制 `conclusion` 的长度，
 * 但历史里的结论超过 500 字，下一次请求就会被 DTO 以 400 拒掉 ——
 * 用户看到的是「追问突然失败」，而不是「上一轮答得太长」。
 */
function remember(history: HistoryTurn[], question: string, result: AskResult): void {
  history.push({
    question: question.slice(0, 200),
    conclusion: result.conclusion.slice(0, 500),
    evidence: result.evidence.slice(0, 16).map((field) => field.slice(0, 64)),
    insufficient: result.insufficient,
  });
  if (history.length > 3) history.splice(0, history.length - 3);
}

export function useAskStream(code: string, onUnauthorized: () => void): AskState {
  /** 单号 → 这串对话。空串是「还没选单」，也会有自己的一格（一般是空的）。 */
  const [sessions, setSessions] = useState<Record<string, Turn[]>>({});
  /** 哪个单号有请求在飞。用单号而不是 bool：切到别的单时，那一边不该显示「生成中」。 */
  const [runningCode, setRunningCode] = useState<string | null>(null);

  /** 单号 → 服务端要的多轮上下文。与 sessions 同步分格，不能混用。 */
  const histories = useRef<Record<string, HistoryTurn[]>>({});
  const controller = useRef<{ code: string; ac: AbortController } | null>(null);

  const patch = useCallback((target: string, id: string, next: (turn: BotTurn) => BotTurn) => {
    setSessions((prev) => {
      const list = prev[target];
      if (!list) return prev;
      return {
        ...prev,
        [target]: list.map((turn) =>
          turn.id === id && turn.role === 'assistant' ? next(turn) : turn,
        ),
      };
    });
  }, []);

  const append = useCallback((target: string, user: UserTurn, bot: BotTurn) => {
    setSessions((prev) => ({ ...prev, [target]: [...(prev[target] ?? []), user, bot] }));
  }, []);

  /**
   * 换单号：只掐断正在飞的那一轮，**不删记录**。
   *
   * 那条回答会被 catch 标成「已停止」，字留在它自己的那一格里。
   * 回头看这张单，还是走的时候那个样子 —— 而不是空白重来。
   */
  useEffect(() => {
    const running = controller.current;
    if (!running || running.code === code) return;
    running.ac.abort();
    controller.current = null;
    setRunningCode(null);
  }, [code]);

  const send = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question || !code || controller.current) return;

      const userId = nextId('u');
      const botId = nextId('b');

      append(
        code,
        { id: userId, role: 'user', code, question },
        { id: botId, role: 'assistant', ...EMPTY_ASSISTANT },
      );

      const ac = new AbortController();
      controller.current = { code, ac };
      setRunningCode(code);

      const history = histories.current[code] ?? [];
      const startedAt = performance.now();
      let firstDeltaAt: number | null = null;
      let deltaChars = 0;
      // 快照：请求飞出去之后 history 还可能被改掉，而这次请求该带的是
      // 「发出去那一刻」的上下文。
      const carried = history.slice(-3);

      let settled = false;

      try {
        // 请求体里**没有**身份：谁在问由服务端会话决定，页面说不了。
        const { requestId, events } = await openAskStream(
          carried.length > 0 ? { code, question, history: carried } : { code, question },
          ac.signal,
        );

        patch(code, botId, (turn) => ({ ...turn, requestId }));

        for await (const event of events) {
          if (event.type === 'delta') {
            if (firstDeltaAt === null) firstDeltaAt = performance.now();
            deltaChars += event.text.length;
            patch(code, botId, (turn) => ({
              ...turn,
              status: 'streaming',
              text: turn.text + event.text,
              firstDeltaMs: firstDeltaAt === null ? null : Math.round(firstDeltaAt - startedAt),
              deltaChars,
            }));
          } else if (event.type === 'done') {
            settled = true;
            const result = event.result;
            // 用最终结果**覆盖**增量阶段吐出来的文本，而不是接着写。
            // 两者理论上一模一样，但最终结果经过服务端的 trim / 去重 ——
            // 页面上显示的那一份，永远是被校验过的那一份。
            patch(code, botId, (turn) => ({
              ...turn,
              status: result.insufficient ? 'insufficient' : 'done',
              text: result.conclusion,
              evidence: result.evidence,
              trace: result.trace ?? [],
              metrics: result.metrics,
              firstDeltaMs: firstDeltaAt === null ? null : Math.round(firstDeltaAt - startedAt),
              deltaChars,
              totalMs: Math.round(performance.now() - startedAt),
            }));
            const bucket = (histories.current[code] ??= []);
            remember(bucket, question, result);
          } else {
            settled = true;
            patch(code, botId, (turn) => ({
              ...turn,
              status: 'error',
              text: event.message,
              totalMs: Math.round(performance.now() - startedAt),
            }));
          }
        }

        if (!settled) {
          patch(code, botId, (turn) => ({
            ...turn,
            status: 'error',
            text: '连接提前结束了，这次回答不完整，请重试',
            totalMs: Math.round(performance.now() - startedAt),
          }));
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          // done 已经落过盘的轮次不能再被标成「已停止」—— abort 可能晚于
          // 终态帧半步到达（流还没关），那不是用户真的中途叫停。
          if (!settled) {
            patch(code, botId, (turn) => ({
              ...turn,
              status: 'stopped',
              stoppedAtMs: Math.round(performance.now() - startedAt),
            }));
          }
        } else if (error instanceof ApiError && error.status === 401) {
          // 会话在提问途中过期：这不是「这次提问失败了」，是「你不该还在这页上」。
          onUnauthorized();
        } else {
          patch(code, botId, (turn) => ({
            ...turn,
            status: 'error',
            text: error instanceof Error ? error.message : String(error),
            totalMs: Math.round(performance.now() - startedAt),
          }));
        }
      } finally {
        // 只在「还是我这次请求」时复位：切单号会先 abort 再发新请求，
        // 旧请求的 finally 晚到一步，不能把新请求的状态抹掉。
        if (controller.current?.ac === ac) {
          controller.current = null;
          setRunningCode(null);
        }
      }
    },
    [append, code, onUnauthorized, patch],
  );

  const stop = useCallback(() => controller.current?.ac.abort(), []);

  return {
    turns: sessions[code] ?? [],
    busy: runningCode === code,
    send: (question) => void send(question),
    stop,
  };
}
