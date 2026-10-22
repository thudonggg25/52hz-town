// Hành động lên một phiên bất kỳ (học từ van-phong-claude):
// trả lời (phiên đang mở: đẩy thẳng qua ổ cắm; phiên đã đóng: chạy tiếp bằng CLI), mở đúng phiên,
// bản bàn giao (handoff), compact.
'use strict';
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { spawnSafe, quoteCmd, killTree } = require('./chay-lenh');
const okId = id => /^[\w-]{1,100}$/.test(String(id || ''));
const { P, loadJson, cauHinh, log, oneLine } = require('./util');
const ph = require('./phien');

const DEFAULT_PREFIX = '[Trả lời qua Game Town]';
const claudeBin = () => cauHinh().claude || 'claude';

function createHanhDong(danCu) {
  const replies = danCu.replies;

  function liveOf(sid) {
    const live = ph.liveRecords();
    const reg = ph.appRegistry()[sid];
    return live[sid] || (reg && live[reg.sessionId]) || null;
  }

  // Đẩy tin vào phiên đang mở qua ổ cắm nhắn tin giữa các phiên của Claude Code.
  // Phiên nhận cần bật "crossSessionInbound": "accept" trong settings. Khoá lấy ở ~/.claude/sessions/<pid>.*.key
  function deliverLive(lv, prompt) {
    return new Promise(resolve => {
      let key = null;
      try { key = fs.readdirSync(P.live).find(n => n.startsWith(lv.pid + '.') && n.endsWith('.key')); } catch {}
      const tok = key && (loadJson(path.join(P.live, key)) || {}).peerToken;
      if (!tok || !lv.messagingSocketPath) return resolve(false);
      const frames = [{ type: 'auth', token: tok },
        { type: 'user', message: { content: prompt }, from: 'game-town', from_name: 'Game Town', uuid: crypto.randomUUID(), msg_id: crypto.randomBytes(16).toString('hex') }];
      const s = net.connect(lv.messagingSocketPath);
      const done = ok => { try { s.destroy(); } catch {} resolve(ok); };
      s.setTimeout(5000, () => done(false));
      s.on('error', e => { log('ổ cắm lỗi: ' + e.message); done(false); });
      s.on('connect', () => { s.end(frames.map(f => JSON.stringify(f)).join('\n') + '\n'); });
      s.on('data', () => {});
      s.on('close', () => done(true));
    });
  }

  async function reply(sid, text) {
    if (!okId(sid)) return { ok: false, error: 'Mã phiên không hợp lệ' };
    text = String(text || '').trim();
    if (!text) return { ok: false, error: 'Chưa có nội dung' };
    if ((replies[sid] || {}).state === 'dang-chay') return { ok: false, error: 'Phiên đang chạy tiếp lượt trước, đợi xong rồi gửi lại' };
    const prompt = `${cauHinh().tienToTraLoi || DEFAULT_PREFIX}\n${text}`;
    const lv = liveOf(sid);
    if (lv && lv.messagingSocketPath) {
      const ok = await deliverLive(lv, prompt);
      replies[sid] = { at: Date.now(), state: ok ? 'da-gui' : 'loi', text: text.slice(0, 200), via: 'phiên đang mở' };
      danCu.invalidate();
      if (ok) return { ok: true, via: 'live' };
      return { ok: false, error: 'Gửi vào phiên đang mở không được. Phiên nhận cần bật crossSessionInbound: "accept".' };
    }
    if (lv) return { ok: false, error: 'Phiên đang mở trong cửa sổ khác. Mở phiên đó để trả lời, hoặc đóng nó rồi trả lời từ game.' };
    return resume(sid, prompt, text);
  }

  // Phiên đã đóng: chạy tiếp bằng `claude --resume <id> -p`. Chạy không người trông nên mặc định chỉ quyền thường.
  function resume(sid, prompt, shown) {
    const tpath = ph.transcriptOf(sid);
    const cwd0 = tpath && ph.scanCached(tpath).cwd;
    const cwd = cwd0 && fs.existsSync(cwd0) ? cwd0 : require('os').homedir();
    const mode = cauHinh().quyenTraLoi || 'default';
    replies[sid] = { at: Date.now(), state: 'dang-chay', text: String(shown || prompt).slice(0, 200), via: 'chạy tiếp bằng CLI' };
    danCu.invalidate();
    let p;
    try { p = spawnSafe(claudeBin(), ['--resume', sid, '-p', '--permission-mode', mode], { cwd }); p.stdin.on('error', () => {}); p.stdin.end(prompt); }
    catch (e) { replies[sid] = { ...replies[sid], state: 'loi', error: e.message }; return { ok: false, error: 'Không chạy được claude: ' + e.message }; }
    let err = '';
    const timer = setTimeout(() => killTree(p), 3 * 3600e3);
    p.stderr.on('data', d => { err = (err + d).slice(-600); });
    p.stdout.on('data', () => {});
    p.on('error', e => { err += e.message; });
    p.on('close', code => {
      clearTimeout(timer);
      replies[sid] = { ...replies[sid], at: Date.now(), state: code === 0 ? 'da-xong' : 'loi', error: code === 0 ? '' : oneLine(err, 400) };
      log(`chạy tiếp ${sid.slice(0, 12)}: ${code === 0 ? 'ok' : 'lỗi ' + oneLine(err, 200)}`);
      danCu.invalidate();
    });
    return { ok: true, via: 'resume' };
  }

  // Mở đúng phiên: phiên của app desktop mở bằng link claude://; phiên CLI mở một cửa sổ terminal chạy --resume.
  function open(sid) {
    if (!okId(sid)) return { ok: false, error: 'Mã phiên không hợp lệ' };
    const reg = ph.appRegistry()[sid];
    if (reg && reg.sessionId) return openUrl(`claude://code/continue?session=${encodeURIComponent(reg.sessionId)}`);
    const tpath = ph.transcriptOf(sid);
    const cwd = (tpath && ph.scanCached(tpath).cwd) || require('os').homedir();
    const cmd = `${claudeBin()} --resume ${sid}`;
    try {
      if (process.platform === 'win32') spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `start "" cmd /k "cd /d ${quoteCmd(cwd)} && ${cmd}"`], { detached: true, windowsVerbatimArguments: true });
      else {
        const sh = "cd '" + String(cwd).replace(/'/g, "'\\''") + "' && " + cmd; // bọc nháy đơn kiểu shell
        if (process.platform === 'darwin') spawn('osascript', ['-e', `tell application "Terminal" to do script ${JSON.stringify(sh)}`, '-e', 'tell application "Terminal" to activate'], { detached: true });
        else spawn('x-terminal-emulator', ['-e', 'bash', '-lc', sh + '; exec bash'], { detached: true });
      }
      return { ok: true, via: 'terminal', command: cmd, cwd };
    } catch (e) { return { ok: false, error: e.message, command: cmd, cwd }; }
  }
  function openUrl(url) {
    try {
      if (process.platform === 'win32') spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `start "" ${quoteCmd(url)}`], { detached: true, windowsHide: true, windowsVerbatimArguments: true });
      else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true });
      return { ok: true, via: 'app', url };
    } catch (e) { return { ok: false, error: e.message, url }; }
  }

  // Bản bàn giao Markdown để dán vào phiên mới
  function handoff(sid) {
    const d = danCu.detail(sid);
    if (!d) return { ok: false, error: 'Không thấy phiên' };
    const lines = [`# Bàn giao: ${d.title}`, '', `- Phiên: \`${sid}\``, `- Thư mục: \`${d.cwd || '?'}\``];
    if (d.branch) lines.push(`- Nhánh: \`${d.branch}\``);
    for (const u of d.prs || []) lines.push(`- PR: ${u}`);
    if (d.lastUser) lines.push('', '## Yêu cầu cuối', '', d.lastUser.trim().slice(0, 1500));
    if (d.lastText) lines.push('', '## Trả lời cuối của Claude', '', d.lastText.trim().slice(0, 3000));
    if (d.ask && d.ask.question) lines.push('', '## Đang chờ quyết', '', d.ask.question, ...d.ask.options.map(o => `- ${o.label}${o.description ? ': ' + o.description : ''}`));
    lines.push('', '## Mấy bước gần nhất', '', ...(d.timeline || []).map(t => `- ${t.kind === 'tool' ? '🔧' : t.kind === 'user' ? '🙋' : '💬'} ${oneLine(t.text, 160)}`));
    lines.push('', `Đọc lại phiên cũ nếu cần: \`claude --resume ${sid}\``);
    return { ok: true, markdown: lines.join('\n') };
  }

  // Compact: phiên đang mở thì trả lệnh để bạn dán; phiên đã đóng thì chạy bằng CLI.
  function compact(sid) {
    if (!okId(sid)) return { ok: false, error: 'Mã phiên không hợp lệ' };
    if (liveOf(sid)) return { ok: true, via: 'manual', text: '/compact', note: 'Phiên đang mở: dán /compact vào cửa sổ phiên.' };
    return resume(sid, '/compact', '/compact');
  }

  return { reply, open, openUrl, handoff, compact };
}

module.exports = { createHanhDong };
