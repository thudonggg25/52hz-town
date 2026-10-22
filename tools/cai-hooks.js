#!/usr/bin/env node
// Cài hooks Game Town vào ~/.claude/settings.json để MỌI phiên Claude Code trên máy báo về game ngay tức thì.
// Đây là lệnh DUY NHẤT của Game Town có ghi vào file của Claude, và chỉ chạy khi bạn gõ nó:
//   node tools/cai-hooks.js          xem sẽ đổi gì (không ghi)
//   node tools/cai-hooks.js --ghi    ghi thật (sao lưu bản cũ thành settings.json.truoc-game-town-<giờ>)
//   node tools/cai-hooks.js --go     gỡ hooks Game Town ra
// Không có game chạy thì hooks báo lỗi kết nối và Claude Code vẫn làm việc bình thường.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT || 4545);
const URL = `http://localhost:${PORT}/hook`;
const FILE = path.join(process.env.GT_HOME || os.homedir(), '.claude', 'settings.json');
const EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'SubagentStart', 'SubagentStop', 'Notification', 'Stop', 'StopFailure', 'PermissionRequest'];
const write = process.argv.includes('--ghi') || process.argv.includes('--go');
const remove = process.argv.includes('--go');

let s = {};
try { s = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') { console.log('settings.json đang hỏng, không dám sửa: ' + e.message); process.exit(1); } }
s.hooks = s.hooks || {};
const isOurs = h => h && h.type === 'http' && String(h.url || '').endsWith(`:${PORT}/hook`);
const changes = [];
for (const ev of EVENTS) {
  const groups = (s.hooks[ev] || []).map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !isOurs(h)) })).filter(g => g.hooks.length);
  if (!remove) groups.push({ matcher: '*', hooks: [{ type: 'http', url: URL, timeout: ev === 'PermissionRequest' ? 70 : 5 }] });
  if (JSON.stringify(groups) !== JSON.stringify(s.hooks[ev] || [])) changes.push(ev);
  if (groups.length) s.hooks[ev] = groups; else delete s.hooks[ev];
}
if (!Object.keys(s.hooks).length) delete s.hooks;
if (!changes.length) { console.log('Không có gì cần đổi.'); process.exit(0); }
console.log(`${remove ? 'Gỡ' : 'Cài'} hooks Game Town (${URL}) cho: ${changes.join(', ')}`);
if (!write) { console.log('\nChưa ghi. Chạy lại với --ghi để ghi thật.'); process.exit(0); }
if (fs.existsSync(FILE)) fs.copyFileSync(FILE, `${FILE}.truoc-game-town-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(path.dirname(FILE), { recursive: true });
fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
console.log(`Đã ghi ${FILE} (có sao lưu bản cũ). Mở lại các phiên Claude Code để nhận hooks mới.`);
