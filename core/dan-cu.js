// Dân cư: danh sách mọi phiên Claude trên máy (học từ van-phong-claude), gộp với lớp hooks tức thời.
// Kèm đánh dấu Xong/Ẩn (có Hoàn tác), "đã xem", màn hình đã lưu, tóm tắt có cache.
'use strict';
const path = require('path');
const { spawnSafe, killTree } = require('./chay-lenh');
const { P, loadJson, saveJson, cauHinh, oneLine } = require('./util');
const ph = require('./phien');
const { usageWindows } = require('./tai-nguyen');

const ORDER = { cho: 0, lam: 1, xem: 2, ranh: 3, nghi: 4 };
const MARK_GRACE_MS = 60e3; // có hoạt động mới quá mốc này sau lúc đánh dấu thì phiên tự hiện lại

function createDanCu(lang) {
  const F = {
    marks: path.join(P.data, 'danh-dau.json'),
    views: path.join(P.data, 'man-hinh.json'),
    seen: path.join(P.data, 'da-xem.json'),
    sum: path.join(P.data, 'tom-tat'),
  };
  const replies = {}; // sid -> trạng thái lần trả lời gần nhất

  const marks = () => loadJson(F.marks, {}) || {};
  const seen = () => loadJson(F.seen, {}) || {};

  // ---------- danh sách phiên ----------
  const cache = new Map(); // số giờ -> { at, data }
  function build(hours = 24) {
    const live = ph.liveRecords();
    const reg = ph.appRegistry();
    const mk = marks(), sn = seen();
    const hooks = lang.hookSessions();
    const list = ph.transcripts(hours);
    const ids = new Set(list.map(t => t.id));
    // Phiên đang mở nhưng chưa ghi gì trong khung giờ vẫn phải hiện
    for (const d of Object.values(live)) if (d.sessionId && !ids.has(d.sessionId)) {
      const p = ph.transcriptOf(d.sessionId);
      if (p) { list.push({ id: d.sessionId, path: p, mtime: 0 }); ids.add(d.sessionId); }
    }
    const sessions = [];
    for (const t of list) {
      const r = reg[t.id];
      if (r && r.isArchived) continue;
      const lv = live[t.id] || (r && live[r.sessionId]) || null;
      const scan = ph.scanCached(t.path);
      const hook = hooks[t.id];
      const st = ph.statusOf({ live: lv, reg: r, scan, hook, seenAt: sn[t.id] });
      const { project, worktree } = ph.projectOf((r && (r.originCwd || r.cwd)) || scan.cwd || (hook && hook.cwd));
      const subs = ph.subagentsOf(t.path);
      const shown = subs.filter(s => s.active || Date.now() - s.at < ph.SUB_SHOW_MS).slice(0, 8);
      const lastAt = Math.max(t.mtime, scan.lastAt, (r && r.lastActivityAt) || 0, (hook && hook.at) || 0);
      let mark = mk[t.id] || null;
      if (mark && (st === 'lam' || st === 'cho') && lastAt - mark.at > MARK_GRACE_MS) mark = null; // có việc mới: tự hiện lại
      sessions.push({
        id: t.id, local: r ? r.sessionId : null, source: r ? 'app' : 'cli', app: r ? r.app : '',
        title: (r && r.title) || scan.title || ph.firstPrompt(t.path) || project,
        project, worktree, branch: scan.branch, cwd: scan.cwd || (r && r.cwd) || '',
        status: st, live: !!lv, routine: (r && r.scheduledTaskId) || '',
        activity: st === 'lam' ? ((hook && hook.bubble) || scan.activity) : '',
        needs: ph.needsOf({ live: lv, reg: r, scan, hook }),
        ask: st === 'cho' ? scan.ask : null,
        progress: scan.ask && scan.ask.progress,
        detail: ((r && r.postTurnSummary) || {}).status_detail || (scan.ask && scan.ask.summary) || '',
        lastActivityAt: lastAt,
        subs: shown, subActive: subs.filter(s => s.active).length, subTotal: subs.length,
        parent: r && r.spawnedFrom ? r.spawnedFrom.sessionId : null,
        reply: replies[t.id] || null, mark: mark ? mark.kind : null,
        usage: quickUsage(t.path),
      });
    }
    // Gom theo dự án (mỗi dự án = một làng/khu), dự án có việc gấp lên trước
    const projects = {};
    const names = cauHinh().duAn || {};
    for (const s of sessions) {
      const p = projects[s.project] ||= { key: s.project, name: (names[s.project] || {}).ten || s.project, icon: (names[s.project] || {}).bieuTuong || '', sessions: [] };
      p.sessions.push(s);
    }
    for (const p of Object.values(projects)) {
      p.sessions.sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || (b.lastActivityAt - a.lastActivityAt));
      p.score = Math.min(...p.sessions.map(s => ORDER[s.status]));
    }
    const counts = Object.fromEntries(Object.keys(ORDER).map(k => [k, sessions.filter(s => s.status === k && !s.mark).length]));
    return { at: Date.now(), hours, counts, waiting: counts.cho, projects: Object.values(projects).sort((a, b) => (a.score - b.score) || (b.sessions.length - a.sessions.length)) };
  }
  function state(hours = 24) {
    hours = Math.max(1, Math.min(Number(hours) || 24, 24 * 14));
    const c = cache.get(hours);
    if (c && Date.now() - c.at < 1500) return c.data;
    const data = build(hours);
    cache.set(hours, { at: Date.now(), data });
    return data;
  }
  // Số đang chờ: dùng bản đã tính gần nhất (tối đa 5 giây), không bắt quét lại
  function waitingCached() {
    const c = cache.get(24);
    return c && Date.now() - c.at < 5000 ? c.data.counts.cho : state().counts.cho;
  }
  const invalidate = () => { for (const c of cache.values()) c.at = 0; };

  // Số gọn cho danh sách: tiền + ngữ cảnh + cache (chi tiết đầy đủ ở detail())
  function quickUsage(tpath) {
    const u = ph.sessionUsage(tpath);
    return u && { total: u.total, ctx: u.ctx, ctxPct: u.ctxPct, cache: u.cache };
  }

  // ---------- chi tiết một phiên ----------
  function detail(sid) {
    const tpath = ph.transcriptOf(sid);
    if (!tpath) return null;
    const find = h => state(h).projects.flatMap(p => p.sessions).find(x => x.id === sid);
    const s = find(24) || find(24 * 14) || {};
    const scan = ph.scanCached(tpath, 400_000);
    const r = ph.appRegistry()[sid];
    const cached = loadJson(path.join(F.sum, sid + '.json'));
    markSeen(sid);
    return { ...s, id: sid, cliId: sid, local: r ? r.sessionId : null, model: r && r.model, appSummary: (r && r.postTurnSummary) || {},
      lastText: scan.lastText.slice(-4000), lastUser: scan.lastUser.slice(-1500), timeline: scan.timeline, prs: scan.prs.slice(-5),
      ask: scan.ask, subs: ph.subagentsOf(tpath).slice(0, 30), usage: ph.sessionUsage(tpath),
      aiSummary: cached && cached.key === scan.lastAt ? cached.result : null, canSummarize: !!cauHinh().tomTat, reply: replies[sid] || null };
  }
  function markSeen(sid) { const s = seen(); s[sid] = Date.now(); saveJson(F.seen, s); invalidate(); }

  // ---------- đánh dấu (Xong / Ẩn) có Hoàn tác ----------
  // Trả về "before" để trang gọi lại undo(before) nếu bấm Hoàn tác.
  function setMarks(ids, kind) {
    const m = marks();
    const before = Object.fromEntries(ids.map(id => [id, m[id] || null]));
    for (const id of ids) { if (kind) m[id] = { kind, at: Date.now() }; else delete m[id]; }
    saveJson(F.marks, m); invalidate();
    return { ok: true, before };
  }
  function undo(before) {
    const m = marks();
    for (const [id, v] of Object.entries(before || {})) { if (v) m[id] = v; else delete m[id]; }
    saveJson(F.marks, m); invalidate();
    return { ok: true };
  }
  // Dọn: đánh dấu Xong mọi phiên đã đóng trong một dự án (hoặc cả làng)
  function sweep(project) {
    const ids = state().projects.filter(p => !project || p.key === project).flatMap(p => p.sessions).filter(s => s.status === 'nghi' && !s.mark).map(s => s.id);
    return { ...setMarks(ids, 'xong'), count: ids.length };
  }

  // ---------- màn hình đã lưu (bộ lọc có tên) ----------
  const DEFAULT_VIEWS = [
    { id: 'cho-ban', ten: 'Chờ bạn', loc: { status: ['cho'] } },
    { id: 'dang-lam', ten: 'Đang làm', loc: { status: ['lam'] } },
    { id: 'toan-canh', ten: 'Toàn cảnh 24 giờ', loc: {}, macDinh: true },
  ];
  const views = () => loadJson(F.views, null) || DEFAULT_VIEWS;
  const saveViews = v => { if (!Array.isArray(v)) return { ok: false }; saveJson(F.views, v.slice(0, 50)); return { ok: true }; };

  // ---------- tóm tắt bằng model rẻ, cache theo lượt cuối ----------
  const SUMMARY_PROMPT = 'Tóm tắt phiên làm việc của trợ lý AI cho người dùng không chuyên kỹ thuật, tiếng Việt, câu ngắn.\n' +
    'Trả về DUY NHẤT JSON: {"title": "...", "summary": "2-3 câu", "decisions": ["việc người dùng cần quyết"], "needs_reply": true|false}\n\n' +
    'Yêu cầu cuối của người dùng:\n{user}\n\nTrả lời cuối của trợ lý:\n{last}';
  function summarize(sid, force = false) {
    const t = cauHinh().tomTat;
    if (!t || !Array.isArray(t.lenh)) return Promise.resolve({ error: 'Chưa khai bộ tóm tắt (mục "tomTat" trong ~/.game-town/cau-hinh.json)' });
    const tpath = ph.transcriptOf(sid);
    if (!tpath) return Promise.resolve({ error: 'Không thấy phiên' });
    const scan = ph.scanCached(tpath, 400_000);
    const file = path.join(F.sum, sid + '.json');
    const cached = loadJson(file);
    if (cached && cached.key === scan.lastAt && !force) return Promise.resolve(cached.result);
    if (!scan.lastText.trim()) return Promise.resolve({ title: '', summary: 'Phiên chưa có lời nào của trợ lý.', decisions: [], needs_reply: false });
    const prompt = SUMMARY_PROMPT.replace('{user}', scan.lastUser.slice(-2000)).replace('{last}', scan.lastText.slice(-8000));
    return runText(t.lenh, prompt, 180e3).then(out => {
      const m = out.match(/\{[\s\S]*\}/);
      let res; try { res = JSON.parse(m ? m[0] : out); } catch { return { error: 'Bộ tóm tắt không trả JSON' }; }
      res.via = t.ten || path.basename(t.lenh[0]);
      saveJson(file, { key: scan.lastAt, at: Date.now(), result: res });
      return res;
    }, e => ({ error: 'Bộ tóm tắt lỗi: ' + e.message }));
  }

  // ---------- tài nguyên toàn làng ----------
  function resources() {
    const tp = ph.transcripts(24 * 7).map(t => t.path);
    const w = usageWindows(tp);
    const q = cauHinh().quota;
    return { estimated: w, external: q && Array.isArray(q.lenh) ? externalQuota(q.lenh) : null, gioiHan: (cauHinh().gioiHan || null) };
  }
  let ext = { at: 0, data: null, busy: false };
  function externalQuota(cmd) {
    if (!ext.busy && Date.now() - ext.at > 10 * 60e3) {
      ext.busy = true;
      runText(cmd, '', 60e3).then(o => { try { ext.data = JSON.parse(o); } catch { ext.data = { error: 'Lệnh quota không trả JSON' }; } })
        .catch(e => { ext.data = { error: e.message }; }).finally(() => { ext.busy = false; ext.at = Date.now(); });
    }
    return ext.data;
  }

  return { state, waitingCached, invalidate, detail, markSeen, setMarks, undo, sweep, views, saveViews, summarize, resources, replies };
}

// Chạy một lệnh, đưa input vào stdin, lấy stdout.
function runText(cmd, input, timeout) {
  return new Promise((resolve, reject) => {
    let p;
    try { p = spawnSafe(cmd[0], cmd.slice(1)); } catch (e) { return reject(e); }
    p.stdin.on('error', () => {});
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
    let out = '', err = '';
    const timer = setTimeout(() => { killTree(p); reject(new Error('quá giờ')); }, timeout);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err = (err + d).slice(-2000); });
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`mã ${code}: ${oneLine(err, 300)}`)); });
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

module.exports = { createDanCu, runText, ORDER };
