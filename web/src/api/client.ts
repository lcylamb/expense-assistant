/**
 * 与后端说话的**唯一**边界。这个文件之外不该出现 `fetch`。
 *
 * 身份不在这里，也不该在：登录后凭据是浏览器自动带上的 httpOnly cookie，
 * JS 读不到它，请求体里也没有任何身份字段。谁在问，由服务端的会话决定。
 */

import type {
  AskPayload,
  AskResult,
  AssistantEvent,
  ExpensesResponse,
  Me,
} from './types';

/** 带状态码的错误：调用方要能区分 401（回登录页）和其它失败（就地提示）。 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Nest 的错误体：`message` 可能是字符串，也可能是校验失败的字符串数组。 */
async function readMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const message =
    typeof body === 'object' && body !== null && 'message' in body
      ? (body as { message?: unknown }).message
      : undefined;

  if (Array.isArray(message)) return message.join('；');
  if (typeof message === 'string' && message) return message;
  return fallback;
}

async function toJson<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    throw new ApiError(await readMessage(response, fallback), response.status);
  }
  return (await response.json()) as T;
}

/**
 * 登录。成功后服务端在 `Set-Cookie` 里种会话，浏览器自己存。
 *
 * 401 单独翻译：服务端对「没这个账号」和「密码错」给同一句话，
 * 页面也不该替它区分——区分了等于把用户名枚举的结果显示出来。
 */
export async function login(username: string, password: string): Promise<Me> {
  const response = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (response.status === 401) {
    throw new ApiError('用户名或密码不对', 401);
  }

  return toJson<Me>(response, `登录失败（HTTP ${response.status}）`);
}

/** 退出登录。网络失败不抛——页面照常回登录页。 */
export async function logout(): Promise<void> {
  try {
    await fetch('/auth/logout', { method: 'POST' });
  } catch {
    // 断网时清不掉服务端 cookie，但浏览器这边的会话迟早过期。
  }
}

/** 当前登录的是谁。没登录返回 null（不是异常）——调用方本来就要处理「没登录」。 */
export async function whoami(): Promise<Me | null> {
  const response = await fetch('/auth/me');
  return response.ok ? ((await response.json()) as Me) : null;
}

/** 当前账号可见的单据 + 统计。可见范围由服务端判定，前端不带任何参数。 */
export async function listExpenses(signal?: AbortSignal): Promise<ExpensesResponse> {
  const response = await fetch('/assistant/expenses', signal ? { signal } : undefined);
  return toJson<ExpensesResponse>(
    response,
    `单据加载失败（HTTP ${response.status}）`,
  );
}

export interface AskStream {
  /** 服务端给这次请求编的 id。用户报「刚才那次很慢」时，这是唯一能对上日志的东西。 */
  requestId: string | null;
  events: AsyncGenerator<AssistantEvent>;
}

/**
 * 发起一次流式提问。
 *
 * 不在这里消费流：什么时候更新气泡、什么时候记历史，是组件的事。
 * 这一层只保证「字节 → 事件」的翻译是对的。
 */
export async function openAskStream(
  payload: AskPayload,
  signal: AbortSignal,
): Promise<AskStream> {
  const response = await fetch('/assistant/askStream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new ApiError(
      await readMessage(response, `HTTP ${response.status}`),
      response.status,
    );
  }

  return {
    requestId: response.headers.get('x-request-id'),
    events: toAssistantEvents(response.body),
  };
}

/** SSE 帧 → 领域事件。形状不对的帧直接丢，别让一段坏数据把整个流打断。 */
async function* toAssistantEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AssistantEvent> {
  for await (const frame of parseSse(body)) {
    if (frame.name === 'delta' && isRecord(frame.data) && typeof frame.data.text === 'string') {
      yield { type: 'delta', text: frame.data.text };
    } else if (frame.name === 'done' && isAskResult(frame.data)) {
      yield { type: 'done', result: frame.data };
    } else if (frame.name === 'error' && isRecord(frame.data) && typeof frame.data.message === 'string') {
      yield { type: 'error', message: frame.data.message };
    }
  }
}

/**
 * 把 SSE 字节流拆成一帧帧。
 *
 * `{ stream: true }` 不能省：一个多字节字符可能被切在两个 chunk 之间，
 * 不加这个参数，每次 decode 都会把它解成乱码。
 *
 * 一次 `read()` 拿到的**不是**一个完整帧，必须自己按 `\n\n` 切，
 * 并把最后一个不完整的帧留在 buffer 里等下一块。
 */
async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ name: string; data: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      // 换行归一化是给别的 SSE 实现留的余地——我们自己的服务只写 \n\n。
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const parsed = parseFrame(frame);
        // 心跳是注释帧（`: ping`），没有 data。规范要求客户端忽略它：
        // 它的唯一作用是不让代理把「工具轮里几秒没字」当成空闲连接掐掉。
        if (parsed) yield parsed;

        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    // 正常读完时 release 是空操作；中途 return（组件卸载）时靠它把锁放掉。
    reader.releaseLock();
  }
}

function parseFrame(frame: string): { name: string; data: unknown } | null {
  let name = 'message';
  const dataLines: string[] = [];

  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) name = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }

  if (dataLines.length === 0) return null;

  try {
    return { name, data: JSON.parse(dataLines.join('\n')) as unknown };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * `done` 帧的形状守卫。
 *
 * 后端和前端是同一个仓库、同一份类型，理论上不会错。但这条流是
 * 「跨进程的一段文本」，中间可能被代理截断——真截断了就是一段合法 JSON
 * 但缺字段，不校验的话页面会在渲染 `evidence.map` 时崩掉整个组件树。
 */
function isAskResult(value: unknown): value is AskResult {
  if (!isRecord(value)) return false;
  return (
    typeof value.conclusion === 'string' &&
    Array.isArray(value.evidence) &&
    value.evidence.every((field) => typeof field === 'string') &&
    typeof value.insufficient === 'boolean'
  );
}
