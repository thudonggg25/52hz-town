// Dựng làng từ bản mô tả dự án (từ Game Town MVP) và giao việc theo công trình (từ hyanaitown).
//   lapLang(moTa)    -> Claude lập kế hoạch: tên làng, mục tiêu, các công trình, việc trong từng công trình
//   giaoViec(b, t)   -> chạy một việc của công trình; mỗi công trình chỉ chạy một việc cùng lúc
// Tiến độ công trình = số việc xong / tổng số việc; tiến độ làng = trung bình các công trình.
'use strict';
const fs = require('fs');
const path = require('path');
const { P, loadJson, saveJson, townConfig, oneLine, clip } = require('./util');
const { tachKhoiGame } = require('./ngon-ngu');
const runner = require('./chay-claude');

const PLAN_PROMPT = `Bạn là người lập kế hoạch cho game quản lý làng "Game Town". Người dùng gửi bản mô tả dự án.
Biến dự án thành một làng: mỗi khu vực công việc là một công trình, mỗi việc cụ thể là một nhiệm vụ trong công trình.
Dự án có đích đến rõ thì type = "project"; việc lặp lại hằng ngày/tuần (làm content, báo cáo…) thì type = "routine".
Trả về DUY NHẤT một JSON hợp lệ, tiếng Việt, không giải thích:
{"name": "Tên làng", "goal": "Mục tiêu một câu", "type": "project|routine",
 "buildings": [{"id": "chu-thuong-khong-dau", "name": "Tên công trình", "kind": "xuong|nha|kho|cho|thap|dinh", "description": "Làm gì",
   "tasks": [{"id": "ma-ngan", "title": "Tên việc", "prompt": "Lời dặn đầy đủ để Claude tự làm việc này", "repeat": "none|daily|weekly"}]}]}
3 đến 7 công trình, mỗi công trình 1 đến 6 việc, sắp theo thứ tự nên làm.

Bản mô tả dự án:
`;

const MOCK_PLAN = { name: 'Làng thử', goal: 'Chạy thử Game Town', type: 'project', buildings: [
  { id: 'nghien-cuu', name: 'Thư viện', kind: 'thap', description: 'Tìm hiểu', tasks: [{ id: 'doc', title: 'Đọc tài liệu', prompt: 'Đọc README', repeat: 'none' }] },
  { id: 'xuong', name: 'Xưởng', kind: 'xuong', description: 'Làm sản phẩm', tasks: [{ id: 'lam', title: 'Làm bản đầu', prompt: 'Làm bản đầu', repeat: 'none' }, { id: 'sua', title: 'Sửa lỗi', prompt: 'Sửa lỗi', repeat: 'none' }] },
] };

function slug(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'x';
}

// Kiểm và sửa kế hoạch Claude trả về để game không bao giờ nhận dữ liệu hỏng.
function chuanHoaKeHoach(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Kế hoạch không phải JSON');
  const used = new Set();
  const uniq = s => { let id = slug(s), n = 2; while (used.has(id)) id = `${slug(s)}-${n++}`; used.add(id); return id; };
  const buildings = (Array.isArray(raw.buildings) ? raw.buildings : []).slice(0, 12).map(b => {
    const tUsed = new Set();
    return {
      id: uniq(b.id || b.name), name: oneLine(b.name || 'Công trình', 40), kind: oneLine(b.kind || 'nha', 12), description: oneLine(b.description, 200),
      tasks: (Array.isArray(b.tasks) ? b.tasks : []).slice(0, 12).map(t => {
        let id = slug(t.id || t.title), n = 2; while (tUsed.has(id)) id = `${slug(t.id || t.title)}-${n++}`; tUsed.add(id);
        return { id, title: oneLine(t.title || 'Việc', 80), prompt: String(t.prompt || t.title || ''), repeat: ['daily', 'weekly'].includes(t.repeat) ? t.repeat : 'none', status: 'chua', session: null, lastRun: null };
      }),
    };
  });
  if (!buildings.length) throw new Error('Kế hoạch không có công trình nào');
  return { name: oneLine(raw.name || 'Làng mới', 60), goal: oneLine(raw.goal, 200), type: raw.type === 'routine' ? 'routine' : 'project', buildings };
}

// Kế hoạch -> cấu hình làng (boss + mỗi công trình một "nhà" có người phụ trách)
function keHoachThanhLang(plan, base = {}) {
  const colors = ['#5b8def', '#f2b134', '#3fb68b', '#9b6bdf', '#e86f6f', '#4bb3c4', '#d68c45'];
  return {
    ...base, title: plan.name, subtitle: plan.goal, goal: plan.goal, type: plan.type, taskPrefix: base.taskPrefix || 'GT',
    boss: base.boss || { id: 'calm', name: 'Calm', role: 'Điều phối cả làng', color: '#3fb68b' },
    agents: plan.buildings.map((b, i) => ({ id: b.id, name: b.name, role: b.description, color: colors[i % colors.length], building: b.id })),
    buildings: plan.buildings,
  };
}

function createCongTrinh(lang) {
  const running = {}; // buildingId -> { job, taskId }

  let dangLap = false;
  async function lapLang(moTa) {
    if (dangLap) return { ok: false, error: 'Đang dựng làng, đợi chút' };
    dangLap = true;
    try { return await lapLang1(moTa); } finally { dangLap = false; }
  }
  async function lapLang1(moTa) {
    moTa = String(moTa || '').trim();
    if (!moTa) return { ok: false, error: 'Chưa có bản mô tả dự án' };
    let plan;
    if (runner.cachChay() === 'mock') plan = MOCK_PLAN;
    else {
      const job = runner.run({ prompt: PLAN_PROMPT + moTa, cwd: townConfig().teamDir || require('os').homedir(), appendSystem: '' });
      const r = await job.done;
      if (r.isError) return { ok: false, error: r.error };
      const m = String(r.text).match(/\{[\s\S]*\}/);
      try { plan = JSON.parse(m ? m[0] : r.text); } catch { return { ok: false, error: 'Claude không trả kế hoạch JSON hợp lệ', raw: clip(r.text, 2000) }; }
    }
    let norm;
    try { norm = chuanHoaKeHoach(plan); } catch (e) { return { ok: false, error: e.message }; }
    const cfg = keHoachThanhLang(norm, townConfig());
    saveJson(path.join(P.data, 'lang.json'), cfg);
    fs.writeFileSync(path.join(P.data, 'mo-ta-du-an.md'), moTa);
    lang.reload();
    lang.addLog(cfg.boss.id, `Dựng làng "${cfg.title}" với ${norm.buildings.length} công trình`, 'notify');
    return { ok: true, plan: norm };
  }

  const cfg = () => loadJson(path.join(P.data, 'lang.json'), null) || townConfig();
  const saveCfg = c => { saveJson(path.join(P.data, 'lang.json'), c); };

  function tienDo() {
    const bs = cfg().buildings || [];
    const per = bs.map(b => {
      b.tasks = b.tasks || [];
      const total = b.tasks.length, done = b.tasks.filter(t => t.status === 'xong').length;
      return { id: b.id, name: b.name, total, done, pct: total ? Math.round(done / total * 100) : 0, running: running[b.id] ? running[b.id].taskId : null,
        waiting: b.tasks.filter(t => t.status === 'cho').length };
    });
    return { buildings: per, pct: per.length ? Math.round(per.reduce((s, b) => s + b.pct, 0) / per.length) : 0 };
  }

  // Chạy một việc của công trình. answer: câu trả lời cho lượt trước (nối tiếp phiên của việc đó).
  function giaoViec(buildingId, taskId, answer) {
    const c = cfg();
    const b = (c.buildings || []).find(x => x.id === buildingId);
    const t = b && (b.tasks || []).find(x => x.id === taskId);
    if (!t) return { ok: false, error: 'Không thấy công trình hoặc việc này' };
    if (running[b.id]) return { ok: false, error: `${b.name} đang làm việc khác` };
    const cwd = c.teamDir || require('os').homedir();
    if (runner.cachChay() !== 'mock' && !fs.existsSync(cwd)) return { ok: false, error: 'Thư mục đội không có trên máy' };
    const bt = lang.newTask(`${t.title} (${b.name})`, b.id, 'running', '', { building: b.id, buildingTask: t.id });
    bt.brief = t.prompt;
    t.status = 'lam'; saveCfg(c);
    lang.setAgent(b.id, { state: 'working', task: bt.id, bubble: `Làm ${bt.id}: ${t.title}` });
    lang.addLog(b.id, `Bắt đầu ${bt.id}: ${t.title}`, 'start', { task: bt.id });
    const job = runner.run({ prompt: answer ? String(answer) : t.prompt, cwd, resume: answer ? t.session : null,
      permissionMode: c.dispatchPermissionMode || 'acceptEdits',
      onEvent: ev => {
        if (ev.type === 'tool') { (bt.steps ||= []).push({ ts: new Date().toISOString(), text: ev.text }); lang.setAgent(b.id, { bubble: ev.text }); lang.changed(); }
      } });
    running[b.id] = { job, taskId: t.id };
    lang.changed();
    job.done.then(r => {
      delete running[b.id];
      const c2 = cfg();
      const t2 = ((c2.buildings || []).find(x => x.id === b.id) || { tasks: [] }).tasks.find(x => x.id === t.id);
      const { text, block } = tachKhoiGame(r.text);
      bt.result = clip(text, 20000);
      if (block) bt.card = block;
      let st = r.isError ? 'loi' : (block && block.status === 'cho') ? 'cho' : 'xong';
      if (r.stopped) st = 'chua';
      if (t2) { t2.status = st === 'xong' && t2.repeat !== 'none' ? 'chua' : st; t2.session = r.sessionId || t2.session; t2.lastRun = Date.now(); saveCfg(c2); }
      lang.setTask(bt, st === 'xong' ? 'done' : st === 'cho' ? 'waiting_approval' : st === 'loi' ? 'error' : 'queued', oneLine(block ? block.summary : (r.error || text), 140));
      if (st === 'cho' && block) bt.question = block.question;
      lang.setAgent(b.id, { state: st === 'xong' ? 'done' : st === 'cho' ? 'waiting' : st === 'loi' ? 'error' : 'idle', bubble: st === 'xong' ? `Xong ${bt.id}` : st === 'cho' ? `Hỏi bạn về ${bt.id}` : st === 'loi' ? `${bt.id} lỗi` : 'Chờ việc' });
      lang.addLog(b.id, `${{ xong: 'Xong', cho: 'Hỏi bạn về', loi: 'Lỗi', chua: 'Dừng' }[st]} ${bt.id}: ${t.title}`, st === 'loi' ? 'error' : st === 'cho' ? 'approval' : 'done', { task: bt.id });
      lang.changed();
    }).catch(e => { delete running[b.id]; lang.setTask(bt, 'error', 'Lỗi: ' + e.message); lang.setAgent(b.id, { state: 'error', bubble: `${bt.id} lỗi` }); lang.changed(); });
    return { ok: true, task: bt.id };
  }
  function dungViec(buildingId) { const r = running[buildingId]; if (!r) return { ok: false, error: 'Công trình không chạy việc nào' }; r.job.stop(); return { ok: true }; }

  return { lapLang, tienDo, giaoViec, dungViec, ke: cfg };
}

module.exports = { createCongTrinh, chuanHoaKeHoach, keHoachThanhLang, slug };
