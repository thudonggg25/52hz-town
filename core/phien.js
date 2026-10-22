// Tìm mọi phiên Claude trên máy và chấm trạng thái từng phiên (mỗi phiên = một người dân).
// Gộp 3 nguồn, chỉ ĐỌC, không sửa file nào của Claude:
//   1. Nhật ký phiên ~/.claude/projects/<thư mục>/<mã>.jsonl  (CLI và tab Code của app đều ghi)
//   2. Phiên đang mở ~/.claude/sessions/<pid>.json             (busy / idle / waiting, ổ cắm nhắn tin)
//   3. Danh sách phiên của app desktop (tiêu đề, tóm tắt cuối lượt, đã lưu trữ) nếu có
// cộng với lớp "hooks" (sự kiện tức thời từ Claude Code, xem hooks.js).
'use strict';
const fs = require('fs');
const path = require('path');
const { P, home, loadJson, isoMs, oneLine, pidAlive, cauHinh } = require('./util');
const { moTaCongCu, tachKhoiGame } = require('./ngon-ngu');
const { sessionUsage } = require('./tai-nguyen');

const SUB_STALE_MS = 15 * 60e3;   // subagent chưa báo xong mà im quá 15 phút coi như đã dừng
const SUB_SHOW_MS = 15 * 60e3;    // subagent xong trong 15 phút gần nhất vẫn đứng cạnh người dân chính

// ---------- nguồn 2: phiên đang mở ----------
function liveRecords() {
  const out = {};
  let names = [];
  try { names = fs.readdirSync(P.live).filter(n => n.endsWith('.json')); } catch { return out; }
  for (const n of names) {
    const d = loadJson(path.join(P.live, n));
    if (!d || !pidAlive(d.pid)) continue;
    for (const k of [d.sessionId, d.hostSessionId]) if (k) out[k] = d;
  }
  return out;
}

// ---------- nguồn 3: danh sách phiên của app desktop ----------
const REG_KEYS = ['sessionId', 'cliSessionId', 'title', 'cwd', 'originCwd', 'lastActivityAt', 'isArchived',
  'postTurnSummary', 'model', 'scheduledTaskId', 'spawnedFrom'];
const _reg = new Map(); // file -> { mtimeMs, rec }
function appRegistry() {
  const byCli = {};
  const seen = new Set();
  for (const root of P.appSupportDirs()) {
    let apps = [];
    try { apps = fs.readdirSync(root).filter(n => /^Claude(-\d\d)?$/.test(n) || (cauHinh().banApp || {})[n]); } catch { continue; }
    for (const app of apps) {
      const base = path.join(root, app, 'claude-code-sessions');
      for (const acc of safeList(base)) for (const org of safeList(path.join(base, acc))) {
        const dir = path.join(base, acc, org);
        for (const n of safeList(dir)) {
          if (!/^local_.*\.json$/.test(n)) continue;
          const f = path.join(dir, n);
          seen.add(f);
          let st; try { st = fs.statSync(f); } catch { continue; }
          let c = _reg.get(f);
          if (!c || c.mtimeMs !== st.mtimeMs) {
            const d = loadJson(f);
            if (!d) continue;
            const rec = Object.fromEntries(REG_KEYS.map(k => [k, d[k]]));
            rec.app = app === 'Claude' ? '01' : ((cauHinh().banApp || {})[app] || app.slice(-2));
            c = { mtimeMs: st.mtimeMs, rec };
            _reg.set(f, c);
          }
          if (c.rec.cliSessionId) byCli[c.rec.cliSessionId] = c.rec;
        }
      }
    }
  }
  for (const f of _reg.keys()) if (!seen.has(f)) _reg.delete(f);
  return byCli;
}
function safeList(d) { try { return fs.readdirSync(d); } catch { return []; } }

// ---------- nguồn 1: nhật ký phiên ----------
// Liệt kê nhật ký có hoạt động trong khung giờ (bỏ qua nhật ký subagent nằm trong thư mục con).
function transcripts(hours) {
  const since = Date.now() - hours * 3600e3;
  const out = [];
  for (const d of safeList(P.projects)) {
    const dir = path.join(P.projects, d);
    for (const n of safeList(dir)) {
      if (!n.endsWith('.jsonl')) continue;
      const f = path.join(dir, n);
      let st; try { st = fs.statSync(f); } catch { continue; }
      if (st.mtimeMs >= since) out.push({ id: n.slice(0, -6), path: f, mtime: st.mtimeMs });
    }
  }
  return out;
}
const _tpath = new Map();
function transcriptOf(cliId) {
  if (!cliId) return null;
  const hit = _tpath.get(cliId);
  if (hit && fs.existsSync(hit)) return hit;
  for (const d of safeList(P.projects)) {
    const f = path.join(P.projects, d, cliId + '.jsonl');
    if (fs.existsSync(f)) { _tpath.set(cliId, f); return f; }
  }
  return null;
}

function readTail(file, nbytes) {
  let buf, size;
  try {
    size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    try {
      const start = Math.max(0, size - nbytes);
      buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
    } finally { fs.closeSync(fd); }
  } catch { return []; }
  let lines = buf.toString('utf8').split('\n');
  if (size > nbytes) lines = lines.slice(1); // dòng đầu có thể bị cắt ngang
  const out = [];
  for (const l of lines) { if (!l) continue; try { out.push(JSON.parse(l)); } catch {} }
  return out;
}

const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x && x.type === 'text').map(x => x.text || '').join('\n') : '';
function isHumanPrompt(e) {
  if (e.type !== 'user' || e.isMeta || e.isSidechain) return false;
  const c = (e.message || {}).content;
  if (Array.isArray(c) && c.some(x => x && x.type === 'tool_result')) return false;
  const t = textOf(c).trim();
  return !!t && !t.startsWith('<');
}

// Hộp "bước tiếp" của app desktop (tool wrap_up): câu hỏi + tối đa 3 nút.
const APP_ACTIONS = { commit: 'Commit', create_pr: 'Tạo PR', merge: 'Merge', fix_ci: 'Sửa CI', address_comments: 'Xử lý góp ý',
  resolve_conflicts: 'Gỡ xung đột', verify: 'Kiểm tra', archive: 'Lưu trữ phiên', new_session: 'Phiên mới' };
function wrapUpAsk(inp) {
  inp = inp && typeof inp === 'object' ? inp : {};
  const ask = String(inp.ask || '').trim();
  if (!ask) return null;
  let acts = inp.actions || [];
  if (typeof acts === 'string') { try { acts = JSON.parse(acts); } catch { acts = []; } }
  const options = (Array.isArray(acts) ? acts : []).filter(a => a && (a.label || a.action)).slice(0, 3)
    .map(a => ({ label: String(a.label || APP_ACTIONS[a.action] || a.action), description: String(a.message || ''), recommended: false }));
  return { status: 'cho', summary: '', progress: null, question: ask, options, allowFreeText: true, outputs: [] };
}

// Đọc đuôi nhật ký: việc đang làm, lời Claude cuối, câu hỏi đang chờ, nhánh git, PR, dòng thời gian.
function scanTranscript(file, nbytes = 200_000) {
  const r = { activity: '', activityAt: 0, lastText: '', lastUser: '', branch: '', title: '', cwd: '', timeline: [], prs: [],
    ask: null, pendingTool: null, lastAt: 0, lastType: '' };
  if (!file) return r;
  const entries = readTail(file, nbytes);
  const pending = new Map(); // tool_use id -> tên (chưa có kết quả)
  for (const e of entries) {
    const ts = e.timestamp;
    if (e.cwd) r.cwd = e.cwd;
    if (e.gitBranch && e.gitBranch !== 'HEAD') r.branch = e.gitBranch;
    if (e.type === 'custom-title' || e.type === 'ai-title') r.title = e.customTitle || e.aiTitle || r.title;
    else if (e.type === 'summary' && e.summary && !r.title) r.title = e.summary;
    else if (e.type === 'pr-link') { const u = e.prUrl || e.url; if (u && !r.prs.includes(u)) r.prs.push(u); }
    if (isHumanPrompt(e)) {
      r.ask = null; // người dùng đã trả lời: câu hỏi cũ hết hiệu lực
      const t = textOf((e.message || {}).content).trim();
      r.timeline.push({ at: ts, kind: 'user', text: t.slice(0, 220) });
    }
    if (e.type === 'user' && Array.isArray((e.message || {}).content)) {
      for (const b of e.message.content) if (b && b.type === 'tool_result') pending.delete(b.tool_use_id);
    }
    if (e.type === 'assistant' && !e.isSidechain) {
      for (const b of (e.message || {}).content || []) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'tool_use') {
          const name = b.name || '';
          pending.set(b.id, { name, input: b.input });
          if (name === 'mcp__ccd_turn__wrap_up') { r.ask = wrapUpAsk(b.input); continue; }
          if (name.startsWith('mcp__ccd_turn__') || name === 'TodoWrite') continue;
          r.timeline.push({ at: ts, kind: 'tool', text: moTaCongCu(name, b.input) });
        } else if (b.type === 'text' && (b.text || '').trim()) {
          const { text, block } = tachKhoiGame(b.text);
          if (block) r.ask = block;
          if (text) r.timeline.push({ at: ts, kind: 'say', text: text.slice(0, 220) });
        }
      }
    }
    if ((e.type === 'user' || e.type === 'assistant') && !e.isSidechain) { r.lastAt = isoMs(ts) || r.lastAt; r.lastType = e.type; }
  }
  // Công cụ hỏi người dùng (AskUserQuestion) chưa có câu trả lời = đang chờ bạn
  for (const [, t] of pending) {
    if (t.name === 'AskUserQuestion') {
      const q = ((t.input || {}).questions || [])[0] || {};
      r.ask = { status: 'cho', summary: '', progress: null, question: String(q.question || 'Claude đang hỏi bạn'),
        options: (q.options || []).slice(0, 4).map(o => ({ label: String(o.label || ''), description: String(o.description || ''), recommended: false })),
        allowFreeText: true, outputs: [] };
    }
    r.pendingTool = t.name;
  }
  // Lời Claude sau tin cuối của người dùng
  const last = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (isHumanPrompt(e)) { r.lastUser = textOf(e.message.content); break; }
    if (e.type === 'assistant' && !e.isSidechain) { const t = textOf((e.message || {}).content).trim(); if (t) last.push(t); }
  }
  r.lastText = last.slice(0, 3).reverse().join('\n\n');
  for (let i = r.timeline.length - 1; i >= 0; i--) if (r.timeline[i].kind === 'tool') { r.activity = r.timeline[i].text; r.activityAt = isoMs(r.timeline[i].at); break; }
  r.timeline = r.timeline.slice(-14);
  return r;
}
const _scan = new Map();
function scanCached(file, nbytes = 120_000) {
  if (!file) return scanTranscript(null);
  let st; try { st = fs.statSync(file); } catch { return scanTranscript(null); }
  const k = file + '|' + nbytes;
  const c = _scan.get(k);
  if (c && c.m === st.mtimeMs && c.s === st.size) return c.r;
  const r = scanTranscript(file, nbytes);
  _scan.set(k, { m: st.mtimeMs, s: st.size, r });
  return r;
}

// Tiêu đề khi không có tiêu đề nào khác: câu đầu tiên người dùng gõ.
const _first = new Map();
function firstPrompt(file) {
  if (_first.has(file)) return _first.get(file);
  let t = '';
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(40000);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    for (const l of buf.subarray(0, n).toString('utf8').split('\n')) {
      try { const e = JSON.parse(l); if (isHumanPrompt(e)) { t = oneLine(textOf(e.message.content), 60); break; } } catch {}
    }
  } catch {}
  _first.set(file, t);
  return t;
}

// ---------- subagent ----------
function subagentsOf(tpath) {
  if (!tpath) return [];
  const dir = path.join(tpath.replace(/\.jsonl$/, ''), 'subagents');
  const now = Date.now();
  const out = [];
  for (const n of safeList(dir)) {
    if (!/^agent-.*\.jsonl$/.test(n)) continue;
    const f = path.join(dir, n);
    let mt; try { mt = fs.statSync(f).mtimeMs; } catch { continue; }
    const meta = loadJson(f.replace(/\.jsonl$/, '.meta.json'), {}) || {};
    out.push({ id: n.slice(6, -6), desc: meta.description || meta.agentType || 'Subagent', type: meta.agentType || '',
      model: meta.model || '', active: !meta.finished && now - mt < SUB_STALE_MS, at: Math.round(mt) });
  }
  return out.sort((a, b) => (b.active - a.active) || (b.at - a.at));
}

// ---------- dự án từ thư mục làm việc ----------
function projectOf(cwd) {
  const c = String(cwd || '').replace(/\\/g, '/').replace(/\/$/, '');
  let m = c.match(/\/([^/]+)\/\.claude\/worktrees\/([^/]+)/);
  if (m) return { project: m[1], worktree: m[2] };
  m = c.match(/\/worktrees\/([^/]+)\/([^/]+)/);
  if (m) return { project: m[1], worktree: m[2] };
  const h = home().replace(/\\/g, '/').replace(/\/$/, '');
  if (c.toLowerCase() === h.toLowerCase()) return { project: '~', worktree: '' };
  if (c.toLowerCase().startsWith(h.toLowerCase() + '/')) {
    const rest = c.slice(h.length + 1).split('/');
    // Thư mục "gom" (Documents, Projects…) thì lấy cấp sâu hơn một bậc
    const gom = ['documents', 'projects', 'code', 'src', 'repos', 'dev', 'desktop', 'github'];
    if (rest.length > 1 && gom.includes(rest[0].toLowerCase())) return { project: rest[1], worktree: rest.slice(2).join('/') };
    return { project: rest[0], worktree: rest.slice(1).join('/') };
  }
  return { project: c.split('/').filter(Boolean).pop() || '?', worktree: '' };
}

// ---------- chấm trạng thái ----------
// lam (đang làm) · cho (chờ bạn) · xem (xong, cần xem) · ranh (mở, rảnh) · nghi (đã đóng)
function statusOf({ live, reg, scan, hook, seenAt }) {
  if (hook && hook.permission) return 'cho';                       // đang xin quyền (giữ trên game)
  if (live && live.status === 'waiting') return 'cho';             // app đang mở hộp hỏi
  if (live && live.status === 'busy') return 'lam';
  if (hook && hook.state === 'cho' && Date.now() - hook.at < 30 * 60e3) return 'cho';  // Notification / hết giờ giữ quyền
  if (hook && hook.state === 'lam' && Date.now() - hook.at < 120e3) return 'lam';
  const s = (reg && reg.postTurnSummary) || {};
  if (s.status_category === 'blocked' || String(s.needs_action || '').trim()) return 'cho';
  if (scan.ask && scan.ask.status === 'cho' && (scan.ask.question || scan.ask.options.length)) return 'cho';
  if (s.status_category === 'review_ready') return 'xem';
  if (scan.ask && scan.ask.status === 'xong' && scan.lastAt > (seenAt || 0)) return 'xem';
  if (hook && hook.stopAt && hook.stopAt > (seenAt || 0)) return 'xem';  // xong lượt khi bạn chưa xem
  return live ? 'ranh' : 'nghi';
}
function needsOf({ live, reg, scan, hook }) {
  if (hook && hook.permission) return 'Xin quyền: ' + hook.permission;
  if (hook && hook.state === 'cho' && Date.now() - hook.at < 30 * 60e3) return hook.bubble || 'Đang chờ bạn';
  if (live && live.status === 'waiting') return 'App đang mở hộp hỏi, chờ bạn bấm';
  const s = (reg && reg.postTurnSummary) || {};
  return String(s.needs_action || '').trim() || (scan.ask && scan.ask.question) || '';
}

module.exports = { liveRecords, appRegistry, transcripts, transcriptOf, readTail, scanTranscript, scanCached, firstPrompt,
  subagentsOf, projectOf, statusOf, needsOf, isHumanPrompt, textOf, sessionUsage, SUB_SHOW_MS };
