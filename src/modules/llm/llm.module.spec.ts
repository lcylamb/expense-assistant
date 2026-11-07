import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ConfigService } from '@nestjs/config';
import { createLlmProvider } from './llm.module.js';
import { MockLlmProvider } from './mock-llm.provider.js';
import { OpenAiCompatibleProvider } from './openai-compatible.provider.js';

/**
 * provider 工厂的配置校验。
 *
 * 这几条规则有一个共同点：它们只在**启动时**生效，一旦写错，最坏的结果不是报错，
 * 而是「以为接了真模型，其实一直在跑规则表」—— 所有测试照样绿、所有答案照样像模像样。
 * 所以每一条都必须以「启动失败」收场，而且错误里要点名是哪个变量。
 *
 * 直接调工厂，不搭 Nest 容器：这三个分支和容器没有关系，搭容器只会让测试更慢、
 * 更像是「框架在测框架」。
 */
function makeConfig(values: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

const OPENAI = {
  LLM_PROVIDER: 'openai',
  LLM_API_KEY: 'test-key',
  LLM_BASE_URL: 'https://example.invalid/v1',
  LLM_MODEL: 'test-model',
};

describe('createLlmProvider', () => {
  it('没配 LLM_PROVIDER → 默认 mock（仓库 clone 下来就能跑）', () => {
    expect(createLlmProvider(makeConfig())).toBeInstanceOf(MockLlmProvider);
  });

  it("显式 'mock' → 规则表", () => {
    expect(
      createLlmProvider(makeConfig({ LLM_PROVIDER: 'mock' })),
    ).toBeInstanceOf(MockLlmProvider);
  });

  it("'openai' + 三项必填 → 真 provider", () => {
    expect(createLlmProvider(makeConfig(OPENAI))).toBeInstanceOf(
      OpenAiCompatibleProvider,
    );
  });

  it('不认识的取值 → 启动失败，不悄悄退回 mock', () => {
    expect(() =>
      createLlmProvider(makeConfig({ LLM_PROVIDER: 'deepseek' })),
    ).toThrow(/不支持的 LLM_PROVIDER：deepseek/);
  });

  it('openai 缺密钥 / 地址 / 模型 → 启动失败，并点名缺哪个', () => {
    for (const missing of ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL']) {
      const values = { ...OPENAI, [missing]: '' };
      expect(() => createLlmProvider(makeConfig(values)), missing).toThrow(missing);
    }
  });

  it('超时 / 输出上限 / 重试次数不是正数 → 启动失败，不退回默认值', () => {
    expect(() =>
      createLlmProvider(makeConfig({ ...OPENAI, LLM_TIMEOUT_MS: 'abc' })),
    ).toThrow(/LLM_TIMEOUT_MS/);

    expect(() =>
      createLlmProvider(makeConfig({ ...OPENAI, LLM_MAX_TOKENS: '0' })),
    ).toThrow(/LLM_MAX_TOKENS/);

    // 0 次尝试没有意义，写成 1 才是「关掉重试」。
    expect(() =>
      createLlmProvider(makeConfig({ ...OPENAI, LLM_MAX_ATTEMPTS: '0' })),
    ).toThrow(/LLM_MAX_ATTEMPTS/);
  });

  it('思考模式默认关，只有显式写 enabled 才开', async () => {
    // 这里要断言的是「配置 → 请求体」的映射，所以真的发一次请求看厂商收到什么。
    // 只断言「构造没炸」等于没断言 —— 那条路径上 thinking 的值根本没被读。
    const seen: Record<string, unknown>[] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        seen.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ model: 'test-model', choices: [{ message: { content: 'ok' } }] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const base = { ...OPENAI, LLM_BASE_URL: `http://127.0.0.1:${port}/v1` };

    try {
      await createLlmProvider(makeConfig(base)).complete([
        { role: 'user', content: 'hi' },
      ]);
      // 默认：写明 disabled。
      expect(seen[0].thinking).toEqual({ type: 'disabled' });

      await createLlmProvider(makeConfig({ ...base, LLM_THINKING: 'enabled' })).complete([
        { role: 'user', content: 'hi' },
      ]);
      // 显式开：不带这个字段，让厂商用它自己的默认值。
      expect(seen[1]).not.toHaveProperty('thinking');

      // 拼错的枚举按「关」处理 —— 不因为写错就启动失败，
      // 但也绝不会因为拼错而意外打开了思考模式（那会破掉注入防线）。
      await createLlmProvider(makeConfig({ ...base, LLM_THINKING: 'true' })).complete([
        { role: 'user', content: 'hi' },
      ]);
      expect(seen[2].thinking).toEqual({ type: 'disabled' });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
