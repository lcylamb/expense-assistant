// MCP stdio 冒烟测试：initialize → tools/list → tools/call（list_expenses / get_approval_record）
import { spawn } from 'node:child_process';

const proc = spawn('npx', ['tsx', 'mcp/server.ts'], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const pending = new Map();
let nextId = 1;

proc.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));
proc.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch { /* 忽略非 JSON 行 */ }
  }
});

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout: ' + method)); } }, 30000);
  });
}

try {
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke-test', version: '0.0.0' },
  });
  console.log('== initialize ok, server:', init.result?.serverInfo);
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const tools = await rpc('tools/list', {});
  console.log('== tools:', tools.result.tools.map((t) => t.name).join(', '));

  const list = await rpc('tools/call', { name: 'list_expenses', arguments: { limit: 3 } });
  const listData = JSON.parse(list.result.content[0].text);
  console.log('== list_expenses:', listData.count, '条 ->', listData.expenses?.map((e) => `${e.code}(${e.status})`).join(' '));

  const code = listData.expenses?.[0]?.code ?? 'BX-2026-0003';
  const summary = await rpc('tools/call', { name: 'get_expense_summary', arguments: { code } });
  console.log('== get_expense_summary(' + code + '):', JSON.parse(summary.result.content[0].text));

  const approval = await rpc('tools/call', { name: 'get_approval_record', arguments: { code } });
  console.log('== get_approval_record(' + code + '):', JSON.parse(approval.result.content[0].text));

  const bad = await rpc('tools/call', { name: 'get_expense_summary', arguments: { code: 'BX-0000-9999' } });
  console.log('== 不存在的单号:', JSON.parse(bad.result.content[0].text));

  console.log('== ALL PASS');
} catch (e) {
  console.error('== FAIL:', e.message);
  process.exitCode = 1;
} finally {
  proc.kill('SIGTERM');
}
