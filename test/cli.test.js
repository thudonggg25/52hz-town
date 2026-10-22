'use strict';
// Kiểm cách chạy "cli" bằng một chương trình claude giả: lời nhắn phải đi qua stdin, đọc đúng stream-json.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cli-'));
const fake = path.join(dir, 'claude-gia.js');
fs.writeFileSync(fake, `#!/usr/bin/env node
let s = ''; process.stdin.on('data', d => s += d); process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  const out = o => process.stdout.write(JSON.stringify(o) + '\\n');
  out({ type: 'system', session_id: 'phien-gia' });
  out({ type: 'assistant', session_id: 'phien-gia', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { description: 'Liệt kê file' } }] } });
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a.txt' }] } });
  out({ type: 'assistant', session_id: 'phien-gia', message: { content: [{ type: 'text', text: 'Nhận: ' + s + ' | resume=' + (args.includes('--resume') ? args[args.indexOf('--resume') + 1] : '') }] } });
  out({ type: 'result', is_error: false, duration_ms: 12, total_cost_usd: 0.01, session_id: 'phien-gia' });
});
`);
fs.chmodSync(fake, 0o755);
process.env.GT_DATA = dir;
process.env.GT_RUNNER = 'cli';
fs.writeFileSync(path.join(dir, 'cau-hinh.json'), JSON.stringify({ claude: fake }));
const runner = require('../core/chay-claude');

test('chạy CLI: lời nhắn qua stdin (có dấu cách, ngoặc kép, xuống dòng), đọc stream-json, nối tiếp phiên', async () => {
  const evs = [];
  const prompt = 'Làm "trang chủ"\nrồi & báo lại';
  const r = await runner.run({ prompt, cwd: dir, resume: 'cu-123', onEvent: e => evs.push(e) }).done;
  assert.strictEqual(r.isError, false);
  assert.strictEqual(r.sessionId, 'phien-gia');
  assert.strictEqual(r.text, `Nhận: ${prompt} | resume=cu-123`);
  assert.deepStrictEqual(evs.map(e => e.type), ['tool', 'tool-result', 'text', 'result']);
  assert.strictEqual(evs[0].text, 'Chạy lệnh: Liệt kê file');
});

test('chạy CLI: chương trình không có thì báo lỗi, không sập', async () => {
  fs.writeFileSync(path.join(dir, 'cau-hinh.json'), JSON.stringify({ claude: path.join(dir, 'khong-co') }));
  await new Promise(r => setTimeout(r, 3100)); // cấu hình được đọc lại sau 3 giây
  const r = await runner.run({ prompt: 'x', cwd: dir }).done;
  assert.strictEqual(r.isError, true);
});
