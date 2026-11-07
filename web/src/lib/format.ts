/**
 * 展示用的格式化。
 *
 * 金额从后端来的是十进制**字符串**（`"1234.50"`），这里只在最后一步转成数字，
 * 而且只用于显示 —— 任何累加都在服务端按分做完了。
 */

export function money(amount: string): string {
  return `¥${Number(amount).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** ISO 时间 → `2026-08-14`。列表里只关心日期，时分秒是噪声。 */
export function day(iso: string): string {
  return iso.slice(0, 10);
}

/** 耗时显示：没过 1 秒给毫秒，过了给秒。`null`（还没到）显示破折号。 */
export function elapsed(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}
