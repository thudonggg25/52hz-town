'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const crypto = require('crypto');
const { lamMayGia } = require('./lam-du-lieu-gia');

const may = lamMayGia();
process.env.GT_HOME = may.home;
process.env.GT_DATA = may.data;
process.env.GT_APP_SUPPORT = may.appSupport;
process.env.GT_RUNNER = 'mock';
process.env.GT_MOCK_MS = '30';
process.env.GT_GIU_QUYEN = '1'; // test không mở giao diện nào nhưng vẫn muốn giữ quyền

const { createServer } = require('../core/server');
const { tachKhoiGame } = require('../core/ngon-ngu');
const { chuanHoaKeHoach } = require('../core/cong-trinh');

const PORT = 46000 + Math.floor(Math.random() * 2000);
let S;
const base = `http://127.0.0.1:${PORT}`;
const get = p => fetch(base + p).then(r => r.json());
const act = (ten, args = {}) => fetch(base + '/api/hanh-dong', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Game-Town': '1' }, body: JSON.stringify({ ten, ...args }) }).then(r => r.json());
const hook = ev => fetch(base + '/hook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev) }).then(r => r.json());
const sleep = ms => new Promise(r => setTimeout(r, ms));
const allSessions = d => d.projects.flatMap(p => p.sessions);

test.before(async () => { S = createServer({ port: PORT }); await S.listen(); });
test.after(async () => { await S.close(); });

test('tách khối game và khối lua-chon', () => {
  const a = tachKhoiGame('Chào\n```game\n{"status":"cho","question":"Chọn?","options":["A",{"label":"B","recommended":true}],"progress":150}\n```');
  assert.strictEqual(a.text, 'Chào');
  assert.strictEqual(a.block.status, 'cho');
  assert.strictEqual(a.block.progress, 100);
  assert.deepStrictEqual(a.block.options.map(o => o.label), ['A', 'B']);
  const b = tachKhoiGame('x\n```lua-chon\n{"cau_hoi":"Q","lua_chon":[{"nhan":"Một","khuyen_dung":true}]}\n```');
  assert.strictEqual(b.block.question, 'Q');
  assert.strictEqual(b.block.options[0].recommended, true);
  assert.strictEqual(tachKhoiGame('```game\n{hỏng}\n```').block, null);
});

test('kế hoạch làng hỏng được sửa lại, id không trùng', () => {
  const p = chuanHoaKeHoach({ name: 'L', buildings: [{ name: 'Xưởng Đồ' , tasks: [{ title: 'A' }, { title: 'A' }] }, { name: 'Xưởng Đồ' }] });
  assert.deepStrictEqual(p.buildings.map(b => b.id), ['xuong-do', 'xuong-do-2']);
  assert.deepStrictEqual(p.buildings[0].tasks.map(t => t.id), ['a', 'a-2']);
  assert.throws(() => chuanHoaKeHoach({ buildings: [] }));
});

test('tìm mọi phiên và chấm đúng trạng thái', async () => {
  const d = await get('/api/dan-cu?gio=24');
  const by = Object.fromEntries(allSessions(d).map(s => [s.id, s]));
  assert.strictEqual(by['s-dang-lam'].status, 'lam');
  assert.strictEqual(by['s-dang-lam'].activity, 'Sửa login.ts');
  assert.strictEqual(by['s-dang-lam'].branch, 'tinh-nang-x');
  assert.strictEqual(by['s-cho-ban'].status, 'cho');
  assert.strictEqual(by['s-cho-ban'].ask.question, 'Màu chủ đạo?');
  assert.strictEqual(by['s-xong'].status, 'xem');
  assert.strictEqual(by['s-xong'].title, 'Viết bài blog');
  assert.strictEqual(by['s-nghi'].status, 'nghi');
  assert.strictEqual(by['s-nghi'].title, 'Phiên trong app');
  assert.strictEqual(by['s-nghi'].source, 'app');
  assert.strictEqual(d.counts.cho, 1);
  assert.strictEqual(allSessions(d)[0].project, 'du-an-a');
});

test('tiền phiên, ngữ cảnh, cache', async () => {
  const d = await get('/api/phien/s-dang-lam');
  // sonnet-4-6: 3$/15$; 1000*3 + 4000*3*1.25 + 20000*3*0.1 + 500*15 = 3000+15000+6000+7500 = 31500 / 1e6
  assert.strictEqual(d.usage.total, 0.0315);
  assert.strictEqual(d.usage.ctx, 25500);
  assert.strictEqual(d.usage.cache.ttl, 3600);
  const r = await get('/api/tai-nguyen');
  assert.ok(r.estimated.h5.cost > 0);
  assert.ok(r.estimated.h5.calls >= 3);
});

test('xem chi tiết thì phiên "xem" thành đã xem', async () => {
  await get('/api/phien/s-xong');
  S.danCu.invalidate();
  const d = await get('/api/dan-cu');
  assert.strictEqual(allSessions(d).find(s => s.id === 's-xong').status, 'nghi');
});

test('đánh dấu xong rồi hoàn tác', async () => {
  const r = await act('phien.danh-dau', { ids: ['s-nghi'], kind: 'xong' });
  assert.ok(r.ok);
  let d = await get('/api/dan-cu');
  assert.strictEqual(allSessions(d).find(s => s.id === 's-nghi').mark, 'xong');
  await act('phien.hoan-tac', { before: r.before });
  d = await get('/api/dan-cu');
  assert.strictEqual(allSessions(d).find(s => s.id === 's-nghi').mark, null);
});

test('bản bàn giao có yêu cầu cuối và lệnh mở lại', async () => {
  const r = await act('phien.ban-giao', { id: 's-cho-ban' });
  assert.ok(r.markdown.includes('Làm trang chủ'));
  assert.ok(r.markdown.includes('claude --resume s-cho-ban'));
  assert.ok(r.markdown.includes('Màu chủ đạo?'));
});

test('hooks: giao việc, gắn mã việc cho subagent, trạng thái tức thời theo phiên', async () => {
  await hook({ hook_event_name: 'UserPromptSubmit', session_id: 's-nghi', prompt: 'Làm tiếp' });
  await hook({ hook_event_name: 'PreToolUse', session_id: 's-nghi', tool_name: 'Agent', tool_input: { subagent_type: 'xuong', description: 'Làm form', prompt: 'Làm form' } });
  const r = await hook({ hook_event_name: 'SubagentStart', session_id: 's-nghi', agent_type: 'xuong' });
  assert.match(r.hookSpecificOutput.additionalContext, /GT-\d{3}/);
  S.danCu.invalidate();
  const d = await get('/api/dan-cu');
  assert.strictEqual(allSessions(d).find(s => s.id === 's-nghi').status, 'lam');
  const L = await get('/api/lang');
  assert.strictEqual(L.agents.find(a => a.id === 'xuong').state, 'working');
  await hook({ hook_event_name: 'SubagentStop', session_id: 's-nghi', agent_type: 'xuong', last_assistant_message: 'xong' });
  await hook({ hook_event_name: 'Stop', session_id: 's-nghi' });
  S.danCu.invalidate();
  const d2 = await get('/api/dan-cu');
  assert.strictEqual(allSessions(d2).find(s => s.id === 's-nghi').status, 'xem');
});

test('xin quyền: giữ chờ bấm, bấm cho phép thì trả allow', async () => {
  const p = hook({ hook_event_name: 'PermissionRequest', session_id: 's-x', tool_name: 'Bash', tool_input: { command: 'rm -rf build' } });
  await sleep(100);
  const L = await get('/api/lang');
  assert.strictEqual(L.approvals.length, 1);
  assert.ok(L.waiting >= 1);
  await act('quyet', { id: L.approvals[0].id, duyet: true });
  const out = await p;
  assert.strictEqual(out.hookSpecificOutput.decision.behavior, 'allow');
});

test('xin quyền: quá giờ thì trả rỗng để Claude Code tự hỏi', async () => {
  const out = await hook({ hook_event_name: 'PermissionRequest', session_id: 's-y', tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.deepStrictEqual(out, {});
});

test('bảng việc: gửi duyệt (cổng), duyệt, trả lời câu hỏi', async () => {
  const t = await fetch(base + '/api/bang', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Gộp vào main', agent: 'kiem-tra', gate: 'gop-main' }) }).then(r => r.json());
  assert.strictEqual(t.status, 'waiting_approval');
  assert.strictEqual(t.gate, 'gop-main');
  await act('quyet', { id: t.id, duyet: true, ghiChu: 'ok' });
  assert.strictEqual((await get('/api/bang/' + t.id)).status, 'approved');
  const q = await fetch(base + '/api/bang', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Ưu tiên gì?', agent: 'calm' }) }).then(r => r.json());
  const a = await act('tra-loi-viec', { id: q.id, text: 'Làm A trước' });
  assert.strictEqual(a.task.status, 'answered');
});

test('an toàn: thiếu header, sai Host, nguồn lạ đều bị chặn', async () => {
  let r = await fetch(base + '/api/hanh-dong', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"ten":"calm.moi"}' });
  assert.strictEqual(r.status, 403);
  r = await fetch(base + '/hook', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.strictEqual(r.status, 415);
  r = await fetch(base + '/api/hanh-dong', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Game-Town': '1', Origin: 'https://evil.example' }, body: '{"ten":"calm.moi"}' });
  assert.strictEqual(r.status, 403);
  const status = await new Promise(res => {
    const s = net.connect(PORT, '127.0.0.1', () => s.write(`GET /api/lang HTTP/1.1\r\nHost: evil.example:${PORT}\r\nConnection: close\r\n\r\n`));
    let d = ''; s.on('data', c => { d += c; }); s.on('end', () => res(d.split(' ')[1]));
  });
  assert.strictEqual(status, '403');
  r = await fetch(base + '/../core/server.js');
  assert.notStrictEqual(r.status, 200);
});

test('phòng Calm (chế độ thử): trả lời kèm thẻ phương án, bấm chọn thì làm tiếp', async () => {
  await act('calm.gui', { text: 'Làm trang giới thiệu' });
  await sleep(400);
  let h = await get('/api/chat');
  const card = h.messages.filter(m => m.card).pop();
  assert.strictEqual(card.card.question, 'Bạn muốn làm theo hướng nào?');
  assert.ok(!card.text.includes('```game'));
  await act('calm.chon', { label: 'Làm nhanh' });
  await sleep(400);
  h = await get('/api/chat');
  assert.strictEqual(h.messages.filter(m => m.card).pop().card.status, 'xong');
  assert.ok(h.status.session && h.status.session.startsWith('mock-'));
});

test('dựng làng (chế độ thử), giao việc công trình, trả lời thẻ thì xong', async () => {
  const r = await act('lang.lap', { moTa: 'Làm web bán bánh' });
  assert.ok(r.ok);
  let L = await get('/api/lang');
  assert.strictEqual(L.tienDo.buildings.length, 2);
  const g = await act('lang.giao', { building: 'xuong', task: 'lam' });
  assert.ok(g.ok);
  assert.strictEqual((await act('lang.giao', { building: 'xuong', task: 'sua' })).ok, false); // một công trình một việc
  await sleep(400);
  const t = await get('/api/bang/' + g.task);
  assert.strictEqual(t.status, 'waiting_approval');
  assert.strictEqual(t.card.options.length, 2);
  const a = await act('tra-loi-viec', { id: g.task, text: 'Mình chọn: Làm nhanh', chayTiep: true });
  assert.ok(a.run.ok);
  await sleep(400);
  L = await get('/api/lang');
  const b = L.tienDo.buildings.find(x => x.id === 'xuong');
  assert.strictEqual(b.done, 1);
  assert.strictEqual(b.pct, 50);
});

test('WebSocket cho Godot: nhận trạng thái và chạy hành động', async () => {
  const msgs = await new Promise((resolve, reject) => {
    const s = net.connect(PORT, '127.0.0.1');
    const key = crypto.randomBytes(16).toString('base64');
    let buf = Buffer.alloc(0), upgraded = false;
    const got = [];
    const sendFrame = obj => {
      const data = Buffer.from(JSON.stringify(obj)), mask = crypto.randomBytes(4);
      const head = data.length < 126 ? Buffer.from([0x81, 0x80 | data.length]) : Buffer.from([0x81, 0x80 | 126, data.length >> 8, data.length & 255]);
      s.write(Buffer.concat([head, mask, Buffer.from(data.map((b, i) => b ^ mask[i % 4]))]));
    };
    s.on('connect', () => s.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    s.on('data', c => {
      buf = Buffer.concat([buf, c]);
      if (!upgraded) { const i = buf.indexOf('\r\n\r\n'); if (i < 0) return; upgraded = true; buf = buf.subarray(i + 4); sendFrame({ ten: 'phien.ban-giao', id: 's-cho-ban', id_: 1 }); }
      while (buf.length >= 2) {
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        got.push(JSON.parse(buf.subarray(off, off + len).toString()));
        buf = buf.subarray(off + len);
        if (got.some(m => m.type === 'ket-qua')) { s.destroy(); resolve(got); }
      }
    });
    s.on('error', reject);
    setTimeout(() => reject(new Error('quá giờ')), 4000);
  });
  assert.ok(msgs.some(m => m.type === 'lang'));
  assert.ok(msgs.some(m => m.type === 'dan-cu'));
  assert.ok(msgs.find(m => m.type === 'ket-qua').data.markdown.includes('Bàn giao'));
});

test('tự chạy (demo) dùng đúng sự kiện hooks', async () => {
  await act('demo', { bat: true });
  await sleep(2600);
  const L = await get('/api/lang');
  assert.ok(L.log.some(e => /Giao GT-\d+/.test(e.text)));
  await act('demo', { bat: false });
});

test('xin quyền: Claude Code bỏ cuộc (đóng kết nối) thì thẻ tự gỡ', async () => {
  const ac = new AbortController();
  fetch(base + '/hook', { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: 's-z', tool_name: 'Bash', tool_input: { command: 'ls' } }) }).catch(() => {});
  await sleep(100);
  assert.strictEqual((await get('/api/lang')).approvals.length, 1);
  ac.abort();
  await sleep(150);
  assert.strictEqual((await get('/api/lang')).approvals.length, 0);
});
