// Trạng thái của làng: người trong các nhà (đội agent), bảng việc, việc chờ duyệt, nhật ký.
// Nhận sự kiện hooks của Claude Code (học từ hyanaitown) và giữ thêm lớp "hooks theo phiên"
// để phien.js chấm trạng thái mọi phiên ngay tức thì.
'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { P, ensureDir, loadJson, townConfig, clip, oneLine } = require('./util');
const { moTaCongCu } = require('./ngon-ngu');

const now = () => new Date().toISOString();

function createLang() {
  const bus = new EventEmitter();
  ensureDir(P.data);
  const FILES = { board: path.join(P.data, 'bang-viec.json'), log: path.join(P.data, 'nhat-ky.jsonl') };
  let cfg = townConfig();
  const agents = {};
  const hookBySession = {};   // session_id -> { state, at, bubble, stopAt, permission, cwd, agentType }
  const approvals = [];       // yêu cầu xin quyền đang giữ
  const recentStops = {};     // agentId -> lúc vừa xong (để vẽ cảnh bàn giao)
  const running = {};         // agentId -> việc đang chạy
  let board = loadJson(FILES.board, []) || [];
  const log = [];
  try { for (const l of fs.readFileSync(FILES.log, 'utf8').trim().split('\n').slice(-300)) { try { if (l) log.push(JSON.parse(l)); } catch {} } } catch {}

  const bossId = () => (cfg.boss && cfg.boss.id) || 'calm';
  const prefix = () => cfg.taskPrefix || 'GT';
  let seq = board.reduce((m, t) => { const x = String(t.id).match(/-(\d+)$/); return x && String(t.id).startsWith(prefix() + '-') ? Math.max(m, Number(x[1])) : m; }, 0);

  function makeAgent(def, isBoss = false, isGuest = false) {
    return { id: def.id, name: def.name || def.id, role: def.role || '', color: def.color || '#888', skills: def.skills || [],
      files: [...(def.files || [])], building: def.building || def.id, isBoss, isGuest, home: def.id, at: def.id,
      state: 'idle', bubble: 'Chờ việc', task: null, tools: [], session: null, updatedAt: now() };
  }
  function loadAgents() {
    for (const k of Object.keys(agents)) delete agents[k];
    agents[bossId()] = makeAgent(cfg.boss || { id: 'calm', name: 'Calm', role: 'Điều phối' }, true);
    for (const a of cfg.agents || []) agents[a.id] = makeAgent(a);
  }
  loadAgents();

  // Agent lạ (Explore, general-purpose…) làm khách ở quảng trường
  function ensureAgent(id) {
    if (!id) return bossId();
    if (agents[id]) return id;
    const pal = ['#8d99ae', '#a3b18a', '#cdb4db', '#b5838d', '#6d6875'];
    const g = makeAgent({ id, name: id, role: 'Khách (không có nhà riêng)', color: pal[Object.keys(agents).length % pal.length] }, false, true);
    g.home = g.at = bossId();
    agents[id] = g;
    return id;
  }
  function setAgent(id, patch) { if (agents[id]) Object.assign(agents[id], patch, { updatedAt: now() }); }

  function addLog(agent, text, kind = 'info', extra = {}) {
    const e = { ts: now(), agent, text, kind, ...extra };
    log.push(e);
    if (log.length > 500) log.shift();
    fs.appendFile(FILES.log, JSON.stringify(e) + '\n', () => {});
    bus.emit('log', e);
    return e;
  }
  let saveT = null;
  const saveBoard = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.writeFile(FILES.board, JSON.stringify(board, null, 1), () => {}), 200); };

  // Mã việc: ưu tiên mã có sẵn trong tiêu đề (GT-010, mã Linear HP-152…), không có thì tự đánh số.
  function findCode(...texts) {
    const s = texts.filter(Boolean).join('\n');
    const own = s.match(new RegExp(`\\b${prefix()}-\\d+\\b`));
    if (own) return own[0];
    const lp = (cfg.linearPrefixes || []).join('|');
    const lin = lp && s.match(new RegExp(`\\b(?:${lp})-\\d+\\b`));
    return lin ? lin[0] : null;
  }
  function newTask(title, agentId, status = 'queued', hint = '', extra = {}) {
    let id = findCode(title, hint);
    if (id && board.some(x => x.id === id)) { let n = 2; while (board.some(x => x.id === `${id}-${n}`)) n++; id = `${id}-${n}`; }
    if (!id) { seq += 1; id = `${prefix()}-${String(seq).padStart(3, '0')}`; }
    const t = { id, title: oneLine(title, 140), agent: agentId, status, note: '', createdAt: now(), updatedAt: now(), ...extra };
    board.push(t);
    if (board.length > 500) board.shift();
    saveBoard();
    return t;
  }
  function setTask(t, status, note) { if (!t) return; t.status = status; t.updatedAt = now(); if (note !== undefined) t.note = note; saveBoard(); }

  let pushT = null;
  const changed = () => { if (pushT) return; pushT = setTimeout(() => { pushT = null; bus.emit('change'); }, 60); };

  // ---------- hooks ----------
  const agentOf = ev => ev.agent_type ? ensureAgent(ev.agent_type) : bossId();
  function overlay(ev, patch) {
    if (!ev.session_id) return;
    const h = hookBySession[ev.session_id] ||= { state: 'ranh', at: 0, bubble: '', stopAt: 0, permission: '', cwd: '' };
    Object.assign(h, patch, { at: Date.now(), cwd: ev.cwd || h.cwd });
  }

  function handleHook(ev) {
    let reply = {};
    const name = ev.hook_event_name;
    const boss = bossId();
    const mine = !cfg.teamDir || !ev.cwd || norm(ev.cwd).startsWith(norm(cfg.teamDir)); // chỉ phiên của đội mới điều khiển nhân vật
    switch (name) {
      case 'SessionStart':
        overlay(ev, { state: 'ranh', bubble: 'Mở phiên' });
        if (mine) { setAgent(boss, { state: 'idle', bubble: 'Mở ca làm việc', session: ev.session_id }); addLog(boss, 'Bắt đầu phiên làm việc'); }
        break;
      case 'UserPromptSubmit': {
        if (/^\s*<task-notification/.test(ev.prompt || '')) break;
        const p = oneLine(ev.prompt, 80);
        overlay(ev, { state: 'lam', bubble: 'Nhận yêu cầu: ' + p, stopAt: 0 });
        if (mine) { setAgent(boss, { state: 'working', bubble: 'Nhận yêu cầu: ' + p }); addLog(boss, 'Nhận yêu cầu: ' + p); }
        break;
      }
      case 'PreToolUse': {
        const input = ev.tool_input || {};
        const text = moTaCongCu(ev.tool_name, input);
        overlay(ev, { state: 'lam', bubble: text });
        if (!mine) break;
        if ((ev.tool_name === 'Task' || ev.tool_name === 'Agent') && !ev.agent_type) {
          const target = ensureAgent(input.subagent_type || 'general-purpose');
          const t = newTask(input.description || oneLine(input.prompt, 60) || 'Việc mới', target, 'running', input.prompt, { session: ev.session_id });
          t.brief = clip(input.prompt || '', 12000);
          running[target] = t;
          setAgent(target, { task: t.id });
          setAgent(boss, { state: 'working', bubble: `Giao ${t.id} cho ${agents[target].name}` });
          addLog(boss, `Giao ${t.id} "${t.title}" cho ${agents[target].name}`, 'handoff', { task: t.id, to: target });
          break;
        }
        const id = agentOf(ev), a = agents[id];
        a.tools.unshift({ ts: now(), text });
        a.tools.length = Math.min(a.tools.length, 10);
        const f = input.file_path && String(input.file_path).replace(/\\/g, '/').split('/').slice(-2).join('/');
        if (f && !a.files.includes(f)) { a.files.push(f); if (a.files.length > 12) a.files.shift(); }
        const rt = running[id];
        if (rt && ev.agent_type) { (rt.steps ||= []).push({ ts: now(), text }); if (rt.steps.length > 300) rt.steps.shift(); }
        setAgent(id, { state: 'working', bubble: text });
        break;
      }
      case 'PostToolUseFailure':
        overlay(ev, { bubble: `Lỗi khi dùng ${ev.tool_name}` });
        if (mine) { const id = agentOf(ev); setAgent(id, { bubble: `Lỗi khi dùng ${ev.tool_name}` }); addLog(id, `Lỗi khi dùng ${ev.tool_name}`, 'error'); }
        break;
      case 'PostToolUse':
        if (mine && (ev.tool_name === 'Task' || ev.tool_name === 'Agent') && !ev.agent_type) {
          const t = running[(ev.tool_input || {}).subagent_type];
          if (t && t.status === 'running') setTask(t, 'done');
        }
        break;
      case 'SubagentStart': {
        if (!mine) break;
        const id = ensureAgent(ev.agent_type);
        const t = running[id];
        // Ai vừa xong việc trong 25 giây qua thì mang kết quả sang nhà này (cảnh bàn giao)
        for (const [from, ts] of Object.entries(recentStops)) {
          if (from !== id && Date.now() - ts < 25000 && agents[from] && !agents[from].isGuest) {
            delete recentStops[from];
            setAgent(from, { at: agents[id].home, state: 'working', bubble: `Mang kết quả sang ${agents[id].name}` });
            addLog(from, `Bàn giao kết quả cho ${agents[id].name}`, 'handoff', { to: id });
            setTimeout(() => { const a = agents[from]; if (a) { setAgent(from, { at: a.home, state: 'idle', bubble: 'Xong, về nhà' }); changed(); } }, 7000);
          }
        }
        setAgent(id, { state: 'working', at: agents[id].home, bubble: t ? `Nhận ${t.id}: ${t.title}` : 'Nhận việc mới', task: t ? t.id : null });
        addLog(id, t ? `Bắt đầu ${t.id}: ${t.title}` : 'Bắt đầu việc mới', 'start', t ? { task: t.id } : {});
        if (t) reply = { hookSpecificOutput: { hookEventName: 'SubagentStart',
          additionalContext: `Mã việc của bạn trên bảng Game Town: ${t.id} ("${t.title}"). Ghi mã này ở đầu file kết quả.` } };
        break;
      }
      case 'SubagentStop': {
        if (!mine) break;
        const id = ensureAgent(ev.agent_type);
        const t = running[id];
        if (t) { if (ev.last_assistant_message) t.result = clip(ev.last_assistant_message, 30000); setTask(t, 'done'); delete running[id]; }
        recentStops[id] = Date.now();
        setAgent(id, { state: 'done', bubble: t ? `Xong ${t.id}` : 'Xong việc' });
        addLog(id, t ? `Xong ${t.id}: ${t.title}` : 'Xong việc', 'done', t ? { task: t.id } : {});
        setTimeout(() => { const a = agents[id]; if (a && a.state === 'done') { setAgent(id, { state: 'idle', bubble: 'Chờ việc', at: a.home }); changed(); } }, 20000);
        break;
      }
      case 'Notification':
        overlay(ev, { state: 'cho', bubble: oneLine(ev.message || 'Đang chờ bạn', 70) });
        if (mine) setAgent(boss, { state: 'waiting', bubble: oneLine(ev.message || 'Đang chờ bạn', 70) });
        break;
      case 'Stop':
        overlay(ev, { state: 'ranh', bubble: 'Xong lượt', stopAt: Date.now() });
        if (mine) { setAgent(boss, { state: 'idle', bubble: 'Xong lượt, chờ việc' }); addLog(boss, 'Xong một lượt làm việc', 'done', { session: ev.session_id }); }
        bus.emit('stop', ev);
        break;
      case 'StopFailure':
        overlay(ev, { state: 'loi', bubble: 'Gặp lỗi, dừng lại', stopAt: Date.now() });
        if (mine) { setAgent(boss, { state: 'error', bubble: 'Gặp lỗi, dừng lại' }); addLog(boss, 'Lượt làm việc bị lỗi', 'error'); }
        break;
      case 'SessionEnd':
        overlay(ev, { state: 'nghi', bubble: 'Đóng phiên' });
        break;
    }
    if (name === 'UserPromptSubmit' || name === 'Stop') bus.emit('hook-chat', ev);
    changed();
    return reply;
  }

  // Xin quyền: giữ lại tới khi bạn bấm trong game; quá giờ trả rỗng để Claude Code hỏi như thường (không bao giờ kẹt).
  function holdPermission(ev, respond) {
    const id = agentOf(ev);
    const input = ev.tool_input || {};
    const item = { id: 'Q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), agent: id, session: ev.session_id || '',
      tool: ev.tool_name, summary: moTaCongCu(ev.tool_name, input), detail: clip(input, 600), ts: now(),
      expiresAt: Date.now() + (cfg.approvalHoldSeconds || 60) * 1000 };
    overlay(ev, { permission: item.summary, bubble: 'Giơ tay xin quyền: ' + item.summary });
    setAgent(id, { state: 'waiting', bubble: 'Giơ tay xin quyền: ' + item.summary });
    addLog(id, 'Xin quyền: ' + item.summary, 'approval', { session: item.session });
    let done = false;
    const finish = (behavior, message, gone) => {
      if (done) return; done = true;
      clearTimeout(item.timer);
      const i = approvals.indexOf(item); if (i >= 0) approvals.splice(i, 1);
      overlay(ev, { permission: '' });
      if (behavior) {
        setAgent(id, { state: 'working', bubble: behavior === 'allow' ? 'Được duyệt, làm tiếp' : 'Bị từ chối' });
        addLog(id, (behavior === 'allow' ? 'Được duyệt: ' : 'Bị từ chối: ') + item.summary, 'approval');
        const decision = behavior === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: message || 'Người dùng từ chối trong Game Town' };
        respond({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } });
      } else {
        overlay(ev, { state: 'cho', bubble: 'Chờ bạn trả lời trong cửa sổ Claude' });
        setAgent(id, { bubble: 'Chờ bạn trả lời trong cửa sổ Claude' });
        if (!gone) respond({});
      }
      changed();
    };
    item.resolve = finish;
    item.timer = setTimeout(() => finish(null), (cfg.approvalHoldSeconds || 60) * 1000);
    approvals.push(item);
    changed();
    return finish;
  }

  // ---------- bảng việc ----------
  function decide(id, approve, note) {
    const q = approvals.find(x => x.id === id);
    if (q) { q.resolve(approve ? 'allow' : 'deny', note); return { ok: true, kind: 'quyen' }; }
    const t = board.find(x => x.id === id);
    if (t && t.status === 'waiting_approval') {
      setTask(t, approve ? 'approved' : 'rejected', note || '');
      addLog(t.agent, `${approve ? 'Bạn đã duyệt' : 'Bạn đã từ chối'} ${t.id}: ${t.title}`, 'approval', { task: t.id });
      setAgent(t.agent, { state: approve ? 'working' : 'idle', bubble: approve ? `${t.id} được duyệt, làm tiếp` : `${t.id} bị trả lại` });
      changed();
      return { ok: true, kind: 'viec' };
    }
    return { ok: false, error: 'Không tìm thấy' };
  }
  function boardPost({ title, agent, status, note, question, ref, gate }) {
    const id = ensureAgent(agent || bossId());
    const old = ref && board.find(x => x.id === ref);
    if (question && old) {
      old.question = question; setTask(old, 'waiting_approval');
      setAgent(id, { state: 'waiting', bubble: `Hỏi bạn về ${old.id}` });
      addLog(id, `Hỏi bạn về ${old.id}: ${question}`, 'approval', { task: old.id });
      changed(); return old;
    }
    const t = newTask(title || question || 'Việc mới', id, status || 'waiting_approval', [ref, note].join(' '));
    if (note) t.note = note;
    if (question) t.question = question;
    if (gate) t.gate = gate; // cổng duyệt: nhan-lam | gop-main | dang-ban
    if (t.status === 'waiting_approval') {
      setAgent(id, { state: 'waiting', bubble: `Chờ bạn duyệt ${t.id}` });
      addLog(id, `Gửi ${t.id} "${t.title}" chờ bạn duyệt`, 'approval', { task: t.id });
    } else addLog(id, `Thêm việc ${t.id}: ${t.title}`);
    changed();
    return t;
  }
  function answer(id, text) {
    const t = board.find(x => x.id === id);
    const ans = String(text || '').trim();
    if (!t || !ans) return { ok: false, error: 'Thiếu việc hoặc câu trả lời' };
    (t.answers ||= []).push({ ts: now(), text: ans });
    if (t.status === 'waiting_approval' && t.question) setTask(t, 'answered'); else saveBoard();
    addLog(t.agent, `Bạn trả lời về ${t.id}: ${oneLine(ans, 120)}`, 'approval', { task: t.id });
    // Ghi vào thư mục của đội để lượt chạy sau đọc được (học từ hyanaitown)
    let saved = false;
    if (cfg.teamDir && fs.existsSync(cfg.teamDir)) {
      try {
        ensureDir(path.join(cfg.teamDir, 'lich'));
        fs.appendFileSync(path.join(cfg.teamDir, 'lich', 'tra-loi.md'),
          `\n## ${now()} · ${t.id} · CHƯA XỬ LÝ\n**Việc:** ${t.title}\n` + (t.question ? `**Câu hỏi:** ${t.question}\n` : '') + `**Trả lời:** ${ans}\n`);
        saved = true;
      } catch {}
    }
    changed();
    return { ok: true, saved, task: t };
  }

  function snapshot() {
    return {
      title: cfg.title || 'Game Town', subtitle: cfg.subtitle || '', goal: cfg.goal || '', type: cfg.type || 'project',
      boss: bossId(), buildings: cfg.buildings || [], rooms: Object.values(agents).filter(a => !a.isGuest).map(a => a.id),
      agents: Object.values(agents),
      board: board.slice(-120).map(({ brief, result, steps, ...t }) => ({ ...t, detail: !!(brief || result || steps) })),
      approvals: approvals.map(({ resolve, timer, ...r }) => r),
      log: log.slice(-150),
    };
  }

  return {
    bus, handleHook, holdPermission, decide, boardPost, answer, snapshot, addLog, setAgent, ensureAgent, newTask, setTask, changed,
    hookOf: sid => hookBySession[sid], hookSessions: () => hookBySession,
    task: id => board.find(t => t.id === id), board: () => board, agents: () => agents, config: () => cfg,
    reload() { cfg = townConfig(); loadAgents(); changed(); },
    clear() { board = []; seq = 0; log.length = 0; saveBoard(); fs.writeFile(FILES.log, '', () => {}); loadAgents(); changed(); },
  };
}
const norm = p => String(p || '').replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();

module.exports = { createLang };
