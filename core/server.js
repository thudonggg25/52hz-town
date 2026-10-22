// Lõi Game Town: một server nhỏ chạy trên máy bạn, không cần cài gói nào (chỉ Node.js 20+).
//   POST /hook               nhận sự kiện hooks của Claude Code (xin quyền thì giữ chờ bạn bấm)
//   GET  /api/...            đọc trạng thái (xem docs/API.md)
//   POST /api/hanh-dong      mọi hành động của người chơi: {"ten": "...", ...tham số}
//   GET  /events             đẩy thay đổi qua Server-Sent Events (cho giao diện web)
//   GET  /ws                 WebSocket (cho Godot): nhận cùng sự kiện, gửi {"ten": ...} để hành động
// Giao diện (hình ảnh, nhân vật, bản đồ) là phần riêng, chỉ cần nói chuyện qua các cổng trên.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { ROOT, P, ensureDir, cauHinh, townConfig, log } = require('./util');
const { createLang } = require('./lang');
const { createDanCu } = require('./dan-cu');
const { createHanhDong } = require('./hanh-dong');
const { createCalm } = require('./phong-calm');
const { createCongTrinh } = require('./cong-trinh');
const { acceptUpgrade } = require('./ws');
const { runDemo } = require('./demo');
const runner = require('./chay-claude');

const VERSION = '0.1.0';

function createServer({ port } = {}) {
  ensureDir(P.data);
  const PORT = Number(port || process.env.PORT || cauHinh().cong || townConfig().port || 4545);
  const sse = new Set();
  const sockets = new Set();
  function broadcast(type, data) {
    const s = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sse) res.write(s);
    for (const c of sockets) c.send({ type, data });
  }

  const lang = createLang();
  const danCu = createDanCu(lang);
  const hd = createHanhDong(danCu);
  const calm = createCalm(lang, ev => broadcast('chat', ev));
  const ct = createCongTrinh(lang);
  let demo = { on: false, stop: null };

  // Số việc chờ bạn: dùng cho chấm đỏ trên biểu tượng game
  function waiting() {
    const s = lang.snapshot();
    return (danCu.waitingCached() || 0) + s.approvals.length + s.board.filter(t => t.status === 'waiting_approval').length;
  }
  const langState = () => ({ ...lang.snapshot(), tienDo: ct.tienDo(), calm: calm.status(), waiting: waiting(), demo: demo.on });
  // Hooks đổi trạng thái: chỉ tính lại khi có giao diện đang nối vào (không thì khỏi quét đĩa)
  lang.bus.on('change', () => {
    danCu.invalidate();
    if (!sse.size && !sockets.size) return;
    try { broadcast('lang', langState()); } catch (e) { log('đẩy trạng thái lỗi: ' + e.stack); }
  });
  lang.bus.on('log', e => broadcast('nhat-ky', e));

  // Dân cư thay đổi theo file trên đĩa: quét lại mỗi 2 giây, chỉ đẩy khi khác lần trước
  let lastDan = '';
  const danTimer = setInterval(() => {
    if (!sse.size && !sockets.size) return;
    try {
      const d = danCu.state();
      const key = JSON.stringify(d.projects) + d.waiting;
      if (key !== lastDan) { lastDan = key; broadcast('dan-cu', d); }
    } catch (e) { log('quét phiên lỗi: ' + e.message); }
  }, 2000);

  // ---------- hành động (dùng chung cho REST và WebSocket) ----------
  const A = {
    'quyet': a => lang.decide(a.id, !!a.duyet, a.ghiChu),
    'tra-loi-viec': a => {
      const r = lang.answer(a.id, a.text);
      if (r.ok && a.chayTiep) {
        const t = r.task;
        if (t.building && t.buildingTask) r.run = ct.giaoViec(t.building, t.buildingTask, a.text);
        else r.run = calm.send(`Trả lời về ${t.id} ("${t.title}")${t.question ? `\nCâu hỏi: ${t.question}` : ''}\nTrả lời: ${a.text}`);
      }
      return r;
    },
    'bang.them': a => lang.boardPost(a),
    'nhat-ky.ghi': a => { const id = lang.ensureAgent(a.agent); if (a.text) lang.addLog(id, a.text); if (a.bubble) lang.setAgent(id, { bubble: a.bubble }); lang.changed(); return { ok: true }; },
    'phien.chi-tiet': a => danCu.detail(a.id) || { ok: false, error: 'Không thấy phiên' },
    'phien.tra-loi': a => hd.reply(a.id, a.text),
    'phien.mo': a => hd.open(a.id),
    'phien.ban-giao': a => hd.handoff(a.id),
    'phien.compact': a => hd.compact(a.id),
    'phien.tom-tat': a => danCu.summarize(a.id, !!a.lamLai),
    'phien.danh-dau': a => danCu.setMarks([].concat(a.ids || a.id || []), a.kind || null),
    'phien.hoan-tac': a => danCu.undo(a.before),
    'phien.don': a => danCu.sweep(a.duAn),
    'phien.da-xem': a => { danCu.markSeen(a.id); return { ok: true }; },
    'man-hinh.luu': a => danCu.saveViews(a.views),
    'calm.gui': a => calm.send(a.text),
    'calm.chon': a => calm.choose(a.label),
    'calm.dung': () => calm.stop(),
    'calm.moi': () => calm.newSession(),
    'calm.thu-muc': a => calm.setDir(a.dir),
    'lang.lap': a => ct.lapLang(a.moTa),
    'lang.giao': a => ct.giaoViec(a.building, a.task, a.answer),
    'lang.dung': a => ct.dungViec(a.building),
    'lang.tai-lai': () => { lang.reload(); return { ok: true }; },
    'lang.xoa-bang': a => { if (a.xacNhan !== true) return { ok: false, error: 'Cần xacNhan: true' }; lang.clear(); return { ok: true }; },
    'demo': a => {
      demo.on = !!a.bat;
      if (demo.stop) { demo.stop(); demo.stop = null; }
      if (demo.on) demo.stop = runDemo(lang, () => demo.on);
      lang.changed();
      return { ok: true, on: demo.on };
    },
  };
  async function act(body) {
    const fn = A[body && body.ten];
    if (!fn) return { ok: false, error: 'Không có hành động: ' + (body && body.ten) };
    try { return await fn(body); } catch (e) { log(`hành động ${body.ten} lỗi: ${e.stack}`); return { ok: false, error: e.message }; }
  }

  // ---------- an toàn ----------
  // Chỉ nghe 127.0.0.1; Host phải là máy này (chống DNS rebinding); trang web lạ không được gọi
  // (lệnh ghi cần Content-Type JSON + header X-Game-Town, trình duyệt sẽ phải hỏi CORS mà server không trả lời).
  const okHost = h => new RegExp(`^(127\\.0\\.0\\.1|localhost|\\[::1\\]):${PORT}$`).test(String(h || ''));
  const okOrigin = o => !o || new RegExp(`^http://(127\\.0\\.0\\.1|localhost):${PORT}$`).test(o);

  function sendJson(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  }
  function readBody(req, limit = 4e6) {
    return new Promise(resolve => {
      const chunks = []; let size = 0;
      req.on('data', c => { size += c.length; if (size > limit) { req.destroy(); resolve(null); } else chunks.push(c); });
      req.on('end', () => { const s = Buffer.concat(chunks).toString('utf8'); try { resolve(s ? JSON.parse(s) : {}); } catch { resolve(null); } });
    });
  }
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
    '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
  // Giao diện web: mặc định là bảng thử; khai "giaoDien": "đường/dẫn" để dùng giao diện của bạn
  const WEB = () => cauHinh().giaoDien || path.join(ROOT, 'bang-thu');

  const server = http.createServer(async (req, res) => {
    if (!okHost(req.headers.host) || !okOrigin(req.headers.origin)) return sendJson(res, 403, { error: 'Không cho phép' });
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return sendJson(res, 400, { error: 'Địa chỉ hỏng' }); }
    const q = url.searchParams;
    const route = `${req.method} ${url.pathname}`;
    try {
      if (req.method === 'POST') {
        if (!/application\/json/.test(req.headers['content-type'] || '')) return sendJson(res, 415, { error: 'Cần Content-Type: application/json' });
        if (url.pathname !== '/hook' && url.pathname !== '/api/bang' && req.headers['x-game-town'] !== '1') return sendJson(res, 403, { error: 'Thiếu header X-Game-Town: 1' });
        const body = await readBody(req);
        if (body === null) return sendJson(res, 400, { error: 'JSON hỏng' });
        if (url.pathname === '/hook') {
          if (body.hook_event_name === 'PermissionRequest') {
            // (Claude Code bỏ cuộc hoặc bạn trả lời trong terminal thì kết nối đóng: gỡ thẻ, không trả lời nữa)
            // Không ai đang mở game (không có giao diện nối vào) hoặc đã tắt giữ quyền: trả ngay để Claude Code hỏi như thường
            if ((!sse.size && !sockets.size && !process.env.GT_GIU_QUYEN) || cauHinh().giuQuyen === false) return sendJson(res, 200, {});
            const finish = lang.holdPermission(body, out => { if (!res.writableEnded && !res.destroyed) sendJson(res, 200, out); });
            res.on('close', () => { if (!res.writableEnded) finish(null, null, true); });
            return;
          }
          return sendJson(res, 200, lang.handleHook(body) || {});
        }
        if (url.pathname === '/api/bang') return sendJson(res, 200, lang.boardPost(body));
        if (url.pathname === '/api/hanh-dong') return sendJson(res, 200, await act(body));
        return sendJson(res, 404, { error: 'Không có' });
      }
      if (route === 'GET /events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(`event: lang\ndata: ${JSON.stringify(langState())}\n\n`);
        res.write(`event: dan-cu\ndata: ${JSON.stringify(danCu.state(q.get('gio') || 24))}\n\n`);
        sse.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 20000);
        req.on('close', () => { sse.delete(res); clearInterval(ping); });
        return;
      }
      if (route === 'GET /api/state') return sendJson(res, 200, { version: VERSION, lang: langState(), danCu: danCu.state(q.get('gio') || 24) });
      if (route === 'GET /api/lang') return sendJson(res, 200, langState());
      if (route === 'GET /api/dan-cu') return sendJson(res, 200, danCu.state(q.get('gio') || 24));
      if (route === 'GET /api/tai-nguyen') return sendJson(res, 200, danCu.resources());
      if (route === 'GET /api/man-hinh') return sendJson(res, 200, danCu.views());
      if (route === 'GET /api/chat') return sendJson(res, 200, { status: calm.status(), messages: calm.history(Number(q.get('truoc')) || 0, Number(q.get('soLuong')) || 300) });
      if (route === 'GET /api/ke-hoach') return sendJson(res, 200, ct.ke());
      if (route === 'GET /api/phien-ban') return sendJson(res, 200, { version: VERSION, cachChay: runner.cachChay(), port: PORT });
      let m = url.pathname.match(/^\/api\/phien\/([\w.-]+)$/);
      if (req.method === 'GET' && m) { const d = danCu.detail(m[1]); return d ? sendJson(res, 200, d) : sendJson(res, 404, { error: 'Không thấy phiên' }); }
      m = url.pathname.match(/^\/api\/bang\/([\w-]+)$/);
      if (req.method === 'GET' && m) { const t = lang.task(m[1]); return t ? sendJson(res, 200, t) : sendJson(res, 404, { error: 'Không thấy việc' }); }
      if (req.method === 'GET') {
        const root = path.resolve(WEB());
        const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
        if (!file.startsWith(root + path.sep) && file !== root) return sendJson(res, 403, { error: 'Không cho phép' });
        return fs.readFile(file, (err, data) => {
          if (err) return sendJson(res, 404, { error: 'Không có' });
          res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
          res.end(data);
        });
      }
      sendJson(res, 405, { error: 'Không hỗ trợ' });
    } catch (e) {
      log(`lỗi ${route}: ${e.stack}`);
      sendJson(res, 500, { error: e.message });
    }
  });

  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
    if (url.pathname !== '/ws' || !okHost(req.headers.host) || !okOrigin(req.headers.origin)) { socket.destroy(); return; }
    const c = acceptUpgrade(req, socket, head, async (msg, client) => {
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return client.send({ type: 'loi', error: 'Tin phải là một đối tượng JSON' });
      if (msg.ten === 'trang-thai') return client.send({ type: 'trang-thai', id: msg.id, data: { lang: langState(), danCu: danCu.state(msg.gio || 24) } });
      if (msg.ten === 'tai-nguyen') return client.send({ type: 'ket-qua', id: msg.id, data: danCu.resources() });
      client.send({ type: 'ket-qua', id: msg.id, data: await act(msg) });
    });
    if (!c) return;
    sockets.add(c);
    c.onclose = () => sockets.delete(c);
    c.send({ type: 'lang', data: langState() });
    c.send({ type: 'dan-cu', data: danCu.state() });
  });

  return {
    PORT, server, lang, danCu, calm, ct, act,
    listen() { return new Promise(r => server.listen(PORT, '127.0.0.1', () => r(PORT))); },
    close() { clearInterval(danTimer); for (const c of sockets) c.close(); for (const r of sse) r.end(); return new Promise(r => server.close(() => r())); },
  };
}

if (require.main === module) {
  // Lưới cuối: lỗi lạ chỉ ghi nhật ký, không làm sập game
  process.on('unhandledRejection', e => log('unhandledRejection: ' + (e && e.stack || e)));
  process.on('uncaughtException', e => log('uncaughtException: ' + (e && e.stack || e)));
  const portArg = process.argv.indexOf('--port');
  const s = createServer({ port: portArg > 0 ? process.argv[portArg + 1] : undefined });
  s.server.on('error', e => {
    if (e.code === 'EADDRINUSE') console.log(`Cổng ${s.PORT} đang bận: có thể Game Town đã chạy rồi.`);
    else console.error(e);
    process.exit(1);
  });
  s.listen().then(p => console.log(`Game Town ${VERSION} chạy ở http://127.0.0.1:${p}  (cách chạy Claude: ${runner.cachChay()}, dữ liệu: ${P.data})`));
}

module.exports = { createServer, VERSION };
