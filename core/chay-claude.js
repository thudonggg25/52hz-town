// Một cửa duy nhất để game tự chạy Claude. Chọn cách chạy trong cau-hinh.json mục "cachChay":
//   "cli"  : Claude Code đã đăng nhập trên máy (claude -p --output-format stream-json)   [mặc định]
//   "sdk"  : Claude Agent SDK với API key (cần `npm i @anthropic-ai/claude-agent-sdk`)
//   "mock" : chế độ thử, không gọi Claude thật
// Mọi cách đều phát ra cùng một kiểu sự kiện: text · tool · tool-result · result.
'use strict';
const { spawnSafe, killTree } = require('./chay-lenh');
const { cauHinh, clip } = require('./util');
const { moTaCongCu, LOI_DAN_KHOI_GAME } = require('./ngon-ngu');

function cachChay() { return process.env.GT_RUNNER || cauHinh().cachChay || 'cli'; }

// run({ prompt, cwd, resume, model, permissionMode, appendSystem, onEvent }) -> { stop(), done: Promise<{sessionId, text, isError, error}> }
function run(opts) {
  const mode = cachChay();
  if (mode === 'mock') return runMock(opts);
  if (mode === 'sdk') return runSdk(opts);
  return runCli(opts);
}

function normalize(ev, emit, state) {
  if (ev.session_id) state.sessionId = ev.session_id;
  if (ev.type === 'assistant') {
    for (const c of (ev.message || {}).content || []) {
      if (c.type === 'text' && c.text.trim()) { state.text.push(c.text); emit({ type: 'text', text: c.text }); }
      if (c.type === 'tool_use') emit({ type: 'tool', id: c.id, name: c.name, text: moTaCongCu(c.name, c.input), input: clip(c.input, 3000) });
    }
  } else if (ev.type === 'user') {
    for (const c of (ev.message || {}).content || []) {
      if (c.type !== 'tool_result') continue;
      const out = Array.isArray(c.content) ? c.content.map(x => x.text || '').join('\n') : c.content;
      emit({ type: 'tool-result', id: c.tool_use_id, output: clip(out || '', 6000), error: !!c.is_error });
    }
  } else if (ev.type === 'result') {
    state.gotResult = true;
    state.isError = !!ev.is_error;
    state.cost = ev.total_cost_usd;
    state.durationMs = ev.duration_ms;
    if (ev.is_error && ev.result) state.error = String(ev.result);
    emit({ type: 'result', isError: !!ev.is_error, durationMs: ev.duration_ms || 0, cost: ev.total_cost_usd || null, sessionId: state.sessionId });
  }
}

function runCli({ prompt, cwd, resume, model, permissionMode, appendSystem = LOI_DAN_KHOI_GAME, onEvent = () => {} }) {
  // Lời nhắn đưa qua stdin (an toàn với dấu cách, ngoặc kép, xuống dòng trên Windows)
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  if (appendSystem) args.push('--append-system-prompt', appendSystem);
  if (resume) args.push('--resume', resume);
  if (model) args.push('--model', model);
  if (permissionMode) args.push('--permission-mode', permissionMode);
  const state = { text: [], sessionId: resume || null };
  let proc, stopped = false;
  const done = new Promise(resolve => {
    try { proc = spawnSafe(cauHinh().claude || 'claude', args, { cwd }); proc.stdin.on('error', () => {}); proc.stdin.end(prompt); }
    catch (e) { return resolve({ isError: true, error: 'Không chạy được Claude Code: ' + e.message, text: '', sessionId: null }); }
    let buf = '', err = '';
    proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8'); // không cắt đôi chữ có dấu giữa hai khúc
    proc.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line) { try { normalize(JSON.parse(line), onEvent, state); } catch {} }
      }
    });
    proc.stderr.on('data', d => { err = (err + d).slice(-4000); });
    proc.on('error', e => { err += e.message; });
    proc.on('close', code => {
      const failed = (code && !state.gotResult) || state.isError;
      resolve({ sessionId: state.sessionId, text: state.text.join('\n\n'), isError: !!failed && !stopped, stopped,
        error: failed && !stopped ? (state.error || `Claude dừng giữa chừng (mã ${code}). ${err.trim().slice(-1500)}`) : '', cost: state.cost });
    });
  });
  return { stop() { stopped = true; killTree(proc); }, done };
}

function runSdk({ prompt, cwd, resume, model, permissionMode, appendSystem = LOI_DAN_KHOI_GAME, onEvent = () => {} }) {
  const ac = new AbortController();
  const state = { text: [], sessionId: resume || null };
  const done = (async () => {
    let sdk;
    try { sdk = await import('@anthropic-ai/claude-agent-sdk'); }
    catch { return { isError: true, error: 'Chưa cài Agent SDK. Chạy: npm i @anthropic-ai/claude-agent-sdk (và đặt biến môi trường ANTHROPIC_API_KEY)', text: '' }; }
    try {
      const options = { cwd, abortController: ac, systemPrompt: { type: 'preset', preset: 'claude_code', append: appendSystem || '' } };
      if (resume) options.resume = resume;
      if (model) options.model = model;
      if (permissionMode) options.permissionMode = permissionMode;
      for await (const msg of sdk.query({ prompt, options })) normalize(msg, onEvent, state);
      return { sessionId: state.sessionId, text: state.text.join('\n\n'), isError: !!state.isError, error: state.error || '', cost: state.cost };
    } catch (e) {
      if (ac.signal.aborted) return { stopped: true, sessionId: state.sessionId, text: state.text.join('\n\n') };
      return { isError: true, error: 'Agent SDK lỗi: ' + e.message, text: state.text.join('\n\n'), sessionId: state.sessionId };
    }
  })();
  return { stop() { ac.abort(); }, done };
}

// Chế độ thử: giả một lượt làm việc có 1 bước công cụ và một thẻ câu hỏi.
function runMock({ prompt, resume, onEvent = () => {} }) {
  const sid = resume || 'mock-' + Date.now().toString(36);
  let stopped = false;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const done = (async () => {
    const speed = Number(process.env.GT_MOCK_MS || 400);
    await wait(speed); if (stopped) return { stopped: true, sessionId: sid, text: '' };
    onEvent({ type: 'tool', id: 't1', name: 'Read', text: 'Đọc README.md', input: '{"file_path":"README.md"}' });
    await wait(speed);
    onEvent({ type: 'tool-result', id: 't1', output: '(nội dung giả)', error: false });
    const chosen = /^Mình chọn:/.test(prompt);
    const text = chosen
      ? `Đã làm theo lựa chọn của bạn.\n\n\`\`\`game\n{"status":"xong","summary":"Xong việc (chế độ thử).","progress":100,"question":"","options":[],"outputs":[]}\n\`\`\``
      : `Mình đã xem yêu cầu: "${String(prompt).slice(0, 80)}".\n\n\`\`\`game\n{"status":"cho","summary":"Có 2 hướng làm.","progress":40,"question":"Bạn muốn làm theo hướng nào?","options":[{"label":"Làm nhanh","description":"Xong trong hôm nay","recommended":true},{"label":"Làm kỹ","description":"Thêm kiểm thử"}],"allow_free_text":true,"outputs":[]}\n\`\`\``;
    await wait(speed);
    onEvent({ type: 'text', text });
    onEvent({ type: 'result', isError: false, durationMs: speed * 3, cost: 0, sessionId: sid });
    return { sessionId: sid, text, isError: false, cost: 0 };
  })();
  return { stop() { stopped = true; }, done };
}

module.exports = { run, cachChay };
