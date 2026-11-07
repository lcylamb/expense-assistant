/**
 * 这一层是整套前端里唯一有「状态机」的地方，也最容易出错：
 * 一条流可能正常结束、可能中途报错、可能 EOF 却没有终态、可能被人点了停止。
 * 四种结局都得落进明确的终态，否则页面会永远停在「生成中」。
 *
 * 不 mock 自己的 client —— 直接给一条假的 `Response`，让 SSE 解析、事件分派、
 * 状态收敛全都真跑一遍。
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAskStream } from './useAskStream';

afterEach(() => {
  vi.unstubAllGlobals();
});

const encoder = new TextEncoder();
const DELTA = '一共 2380.00 元，其中交通 1200';

function frame(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

const RESULT = {
  conclusion: '一共 2380.00 元，其中交通 1200、住宿 1180。',
  evidence: ['amount', 'items'],
  insufficient: false,
  metrics: { promptTokens: 100, completionTokens: 50, latencyMs: 800 },
  trace: [{ tool: 'get_expense_summary', ok: true }],
};

/** 一条能手动往里推帧的流。 */
function openStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start: (c) => {
      controller = c;
    },
  });

  const response = {
    ok: true,
    status: 200,
    body,
    headers: new Headers({ 'x-request-id': 'req-test' }),
  } as unknown as Response;

  return {
    response,
    push: (chunk: string) => controller.enqueue(encoder.encode(chunk)),
    end: () => controller.close(),
    fail: (error: Error) => controller.error(error),
  };
}

function stubFetch(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

function assistantOf(turns: ReturnType<typeof useAskStream>['turns']) {
  const bot = turns.find((turn) => turn.role === 'assistant');
  if (!bot || bot.role !== 'assistant') throw new Error('没有生成助手消息');
  return bot;
}

describe('问答流状态机', () => {
  it('正常结束：用最终结果覆盖增量文本，而不是接着写', async () => {
    const stream = openStream();
    stubFetch(async () => stream.response);

    const { result } = renderHook(() => useAskStream('BX-2026-0001', () => {}));
    act(() => result.current.send('一共多少钱？'));

    act(() => stream.push(frame('delta', { text: DELTA })));
    act(() => {
      stream.push(frame('done', RESULT));
      stream.end();
    });

    await waitFor(() => expect(result.current.busy).toBe(false));

    const bot = assistantOf(result.current.turns);
    expect(bot.status).toBe('done');
    // 最终文本来自 done 帧（服务端校验过的那份），不是增量拼起来的那份。
    expect(bot.text).toBe(RESULT.conclusion);
    expect(bot.evidence).toEqual(RESULT.evidence);
    expect(bot.requestId).toBe('req-test');
    // 增量阶段收了多少字要留着：和最终字数对照，才知道校验改了多少。
    expect(bot.deltaChars).toBe(DELTA.length);
  });

  it('服务端 error 帧：落 error，文案照抄服务端那句', async () => {
    const stream = openStream();
    stubFetch(async () => stream.response);

    const { result } = renderHook(() => useAskStream('BX-2026-0001', () => {}));
    act(() => result.current.send('一共多少钱？'));

    act(() => {
      stream.push(frame('error', { message: '模型超时' }));
      stream.end();
    });

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(assistantOf(result.current.turns).status).toBe('error');
    expect(assistantOf(result.current.turns).text).toBe('模型超时');
  });

  it('流断了却没等到终态：不能永远停在生成中', async () => {
    const stream = openStream();
    stubFetch(async () => stream.response);

    const { result } = renderHook(() => useAskStream('BX-2026-0001', () => {}));
    act(() => result.current.send('一共多少钱？'));

    act(() => {
      stream.push(frame('delta', { text: '一共' }));
      stream.end(); // 没有 done，直接 EOF
    });

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(assistantOf(result.current.turns).status).toBe('error');
    expect(assistantOf(result.current.turns).text).toContain('连接提前结束');
  });

  it('用户点停止：已收到的字留着，但标明没经过最终校验', async () => {
    const stream = openStream();
    stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          resolve(stream.response);
        }),
    );

    const { result } = renderHook(() => useAskStream('BX-2026-0001', () => {}));
    act(() => result.current.send('一共多少钱？'));
    await waitFor(() => expect(result.current.turns).toHaveLength(2));

    act(() => stream.push(frame('delta', { text: DELTA })));
    await waitFor(() => expect(assistantOf(result.current.turns).text).toBe(DELTA));

    // abort 之后浏览器会让正在读的流以 AbortError 结束 —— 这里手工模拟那一下。
    act(() => result.current.stop());
    act(() => stream.fail(new DOMException('aborted', 'AbortError')));

    await waitFor(() => expect(result.current.busy).toBe(false));
    const bot = assistantOf(result.current.turns);
    expect(bot.status).toBe('stopped');
    // 用户已经看到过的字不能凭空消失。
    expect(bot.text).toBe(DELTA);
    expect(bot.stoppedAtMs).not.toBeNull();
  });

  it('对话按单号分开存：切走再回来，之前问过的还在', async () => {
    const stream = openStream();
    stubFetch(async () => stream.response);

    const { result, rerender } = renderHook(({ code }) => useAskStream(code, () => {}), {
      initialProps: { code: 'BX-2026-0001' },
    });

    act(() => result.current.send('一共多少钱？'));
    act(() => {
      stream.push(frame('done', RESULT));
      stream.end();
    });
    await waitFor(() => expect(result.current.turns).toHaveLength(2));

    // 换一张单：这一格是空的，不是把上一张清掉。
    rerender({ code: 'BX-2026-0002' });
    await waitFor(() => expect(result.current.turns).toHaveLength(0));

    // 再回来：原来的问答还在原处。
    rerender({ code: 'BX-2026-0001' });
    await waitFor(() => expect(result.current.turns).toHaveLength(2));
    expect(assistantOf(result.current.turns).text).toBe(RESULT.conclusion);
  });

  it('问 A 问到一半切去 B：A 那一轮被标停止，字留着；两边的记录互不污染', async () => {
    const stream = openStream();
    stubFetch(async () => stream.response);

    const { result, rerender } = renderHook(({ code }) => useAskStream(code, () => {}), {
      initialProps: { code: 'BX-2026-0001' },
    });

    act(() => result.current.send('这笔钱花在哪？'));
    act(() => stream.push(frame('delta', { text: DELTA })));
    await waitFor(() => expect(assistantOf(result.current.turns).text).toBe(DELTA));

    // 切单号会 abort 在飞的那一轮，浏览器随后让它以 AbortError 结束。
    rerender({ code: 'BX-2026-0002' });
    act(() => stream.fail(new DOMException('aborted', 'AbortError')));

    // B 这张单干干净净，没有 A 的问题和答案。
    await waitFor(() => expect(result.current.turns).toHaveLength(0));

    rerender({ code: 'BX-2026-0001' });
    await waitFor(() => expect(result.current.turns).toHaveLength(2));
    const bot = assistantOf(result.current.turns);
    expect(bot.status).toBe('stopped');
    expect(bot.text).toBe(DELTA);
  });
});
