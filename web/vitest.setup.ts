// `toBeInTheDocument` 这类断言来自 jest-dom，必须在每个测试文件之前注册。
// 新版本把入口放在 `/vitest` 上，挂的是 vitest 的 expect，不是 jest 的。
import '@testing-library/jest-dom/vitest';

/**
 * antd 5 的响应式组件（Grid、Table 的固列）会问 `window.matchMedia`，
 * jsdom 里没有这个 API —— 不打桩的话，一 import 到这些组件就抛错，
 * 而报错位置和真正的原因隔着好几层。
 */
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** 同理，`ResizeObserver` 是 Table / Typography 的 ellipsis 依赖。 */
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
