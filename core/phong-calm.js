// Phòng Calm (boss của làng): bạn gõ việc trong game, Calm làm và trả lời kèm thẻ phương án.
// Học từ hyanaitown: nối tiếp cùng một cuộc trò chuyện (--resume), hàng đợi khi Calm bận,
// ghi cả các lượt bạn gõ thẳng trong Claude Code (qua hooks UserPromptSubmit + Stop).
'use strict';
const fs = require('fs');
const path = require('path');
const { P, loadJson, saveJson, townConfig, log } = require('./util');
const { tachKhoiGame } = require('./ngon-ngu');
const runner = require('./chay-claude');

function createCalm(lang, emit) {
  const FILE = path.join(P.data, 'tro-chuyen.jsonl');
  const STATE = path.join(P.data, 'phong-calm.json');
  let msgs = [];
  try { for (const l of fs.readFileSync(FILE, 'utf8').split('\n')) { try { if (l.trim()) msgs.push(JSON.parse(l)); } catch {} } msgs = msgs.slice(-2000); } catch {}
  let seq = msgs.reduce((m, x) => Math.max(m, x.id || 0), 0);
  let st = { session: null, dir: null, ...(loadJson(STATE, {}) || {}) };
  const save = () => saveJson(STATE, st);
  const dir = () => st.dir || townConfig().teamDir || null;
  let cur = null, lastRun = null;
  const queue = [];

  function add(m) {
    const e = { id: ++seq, ts: new Date().toISOString(), ...m };
    msgs.push(e);
    if (msgs.length > 3000) msgs = msgs.slice(-2000);
    fs.appendFile(FILE, JSON.stringify(e) + '\n', () => {});
    emit({ type: 'msg', msg: e });
    return e;
  }
  const status = () => ({ running: !!cur, queue: queue.length, session: st.session, dir: dir(), startedAt: cur ? cur.startedAt : null, cachChay: runner.cachChay() });
  const emitStatus = () => emit({ type: 'status', status: status() });

  function start(text) {
    const cwd = dir();
    if (runner.cachChay() !== 'mock' && (!cwd || !fs.existsSync(cwd))) {
      add({ role: 'system', text: 'Chưa chọn thư mục làm việc của đội (hoặc thư mục không có). Đặt "teamDir" trong cấu hình làng.' });
      return next();
    }
    const cfg = townConfig().calm || {};
    const steps = {};
    cur = { startedAt: new Date().toISOString(), session: st.session };
    cur.job = runner.run({ prompt: text, cwd, resume: st.session, model: cfg.model, permissionMode: cfg.permissionMode,
      onEvent: ev => {
        if (ev.sessionId && ev.sessionId !== st.session) { st.session = ev.sessionId; save(); }
        if (ev.type === 'text') {
          const { text: body, block } = tachKhoiGame(ev.text);
          add({ role: 'calm', text: body, card: block, source: 'game' });
        } else if (ev.type === 'tool') {
          steps[ev.id] = add({ role: 'step', text: ev.text, tool: ev.name, input: ev.input }).id;
        } else if (ev.type === 'tool-result') {
          const m = msgs.find(x => x.id === steps[ev.id]);
          if (m) { m.output = ev.output; m.error = ev.error; }
          emit({ type: 'step-result', stepId: steps[ev.id], output: ev.output, error: ev.error });
        } else if (ev.type === 'result') {
          add({ role: 'end', text: `Xong lượt · ${Math.round((ev.durationMs || 0) / 1000)} giây`, cost: ev.cost });
        }
      } });
    emitStatus();
    cur.job.done.then(r => {
      if (r.sessionId && r.sessionId !== st.session) { st.session = r.sessionId; save(); }
      if (r.isError) add({ role: 'system', text: r.error || 'Calm gặp lỗi.' });
      lastRun = { session: st.session, endedAt: Date.now() };
      cur = null; emitStatus(); next();
    }).catch(e => { log('phòng Calm lỗi: ' + e.stack); cur = null; emitStatus(); next(); });
  }
  function next() { if (!cur && queue.length) start(queue.shift()); }

  // Lượt bạn gõ thẳng trong Claude Code (hoặc chạy theo lịch) ở thư mục đội cũng hiện trong phòng
  lang.bus.on('hook-chat', ev => {
    const d = dir();
    if (!d || !ev.cwd || !String(ev.cwd).replace(/\\/g, '/').toLowerCase().startsWith(String(d).replace(/\\/g, '/').toLowerCase())) return;
    if (cur && (ev.session_id === cur.session || !cur.session)) return;
    if (lastRun && ev.session_id === lastRun.session && Date.now() - lastRun.endedAt < 15000) return;
    if (ev.hook_event_name === 'UserPromptSubmit') {
      const p = String(ev.prompt || '');
      if (p.trim() && !/^\s*<task-notification/.test(p)) add({ role: 'nguoi-dung', text: p, source: 'claude-code' });
    } else if (ev.hook_event_name === 'Stop' && ev.last_assistant_message) {
      const { text, block } = tachKhoiGame(ev.last_assistant_message);
      add({ role: 'calm', text, card: block, source: 'claude-code' });
    }
  });

  return {
    status,
    history: (before = 0, limit = 300) => (before ? msgs.filter(m => m.id < before) : msgs).slice(-limit),
    send(text) {
      text = String(text || '').trim();
      if (!text) return { ok: false, error: 'Chưa có nội dung' };
      add({ role: 'nguoi-dung', text, source: 'game' });
      if (cur) { queue.push(text); emitStatus(); return { ok: true, queued: true }; }
      start(text);
      return { ok: true };
    },
    choose(label) { return this.send(`Mình chọn: ${label}`); },
    stop() {
      queue.length = 0;
      if (cur) { cur.job.stop(); add({ role: 'system', text: 'Bạn đã dừng Calm.' }); }
      emitStatus();
      return { ok: true };
    },
    newSession() {
      if (cur) return { ok: false, error: 'Calm đang làm, dừng trước đã' };
      st.session = null; save();
      add({ role: 'system', text: 'Bắt đầu cuộc trò chuyện mới.' });
      emitStatus();
      return { ok: true };
    },
    setDir(d) {
      d = String(d || '').trim();
      if (!d || !fs.existsSync(d)) return { ok: false, error: 'Không thấy thư mục này trên máy' };
      st.dir = d; st.session = null; save(); emitStatus();
      return { ok: true };
    },
  };
}

module.exports = { createCalm };
