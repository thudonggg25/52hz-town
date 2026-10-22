// Dựng một "máy giả" (thư mục nhà giả) với vài phiên Claude để kiểm thử, không đụng dữ liệu thật.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function lamMayGia() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-test-'));
  const home = path.join(root, 'home');
  const proj = path.join(home, '.claude', 'projects', '-home-hyan-du-an-a');
  fs.mkdirSync(proj, { recursive: true });
  fs.mkdirSync(path.join(home, '.claude', 'sessions'), { recursive: true });
  const cwd = path.join(home, 'du-an-a');
  fs.mkdirSync(cwd, { recursive: true });
  const t = m => new Date(Date.now() - m * 60e3).toISOString();
  const usage = (o = {}) => ({ input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 20000, cache_creation_input_tokens: 4000, cache_creation: { ephemeral_1h_input_tokens: 4000 }, ...o });
  const write = (id, rows) => fs.writeFileSync(path.join(proj, id + '.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

  // 1. Phiên đang chạy (file sessions/<pid>.json với pid còn sống = chính tiến trình test)
  write('s-dang-lam', [
    { type: 'user', timestamp: t(5), cwd, gitBranch: 'tinh-nang-x', message: { role: 'user', content: 'Sửa lỗi đăng nhập' } },
    { type: 'assistant', timestamp: t(4), cwd, message: { id: 'm1', model: 'claude-sonnet-4-6', usage: usage(), content: [{ type: 'tool_use', id: 'tu1', name: 'Edit', input: { file_path: '/x/src/login.ts' } }] } },
  ]);
  fs.writeFileSync(path.join(home, '.claude', 'sessions', process.pid + '.json'), JSON.stringify({ pid: process.pid, sessionId: 's-dang-lam', status: 'busy' }));

  // 2. Phiên đang hỏi bạn bằng AskUserQuestion (chưa có câu trả lời)
  write('s-cho-ban', [
    { type: 'user', timestamp: t(30), cwd, message: { role: 'user', content: 'Làm trang chủ' } },
    { type: 'assistant', timestamp: t(29), cwd, message: { id: 'm2', model: 'claude-opus-4-6', usage: usage(), content: [{ type: 'tool_use', id: 'ask1', name: 'AskUserQuestion', input: { questions: [{ question: 'Màu chủ đạo?', options: [{ label: 'Xanh' }, { label: 'Cam' }] }] } }] } },
  ]);

  // 3. Phiên đã đóng, lượt cuối có khối game "xong" (chưa xem) -> "xem"
  write('s-xong', [
    { type: 'custom-title', customTitle: 'Viết bài blog' },
    { type: 'user', timestamp: t(120), cwd, message: { role: 'user', content: 'Viết bài' } },
    { type: 'assistant', timestamp: t(119), cwd, message: { id: 'm3', model: 'claude-haiku-4-5', usage: usage({ cache_creation: {} }), content: [{ type: 'text', text: 'Xong bài.\n\n```game\n{"status":"xong","summary":"Đã viết 800 chữ","progress":100}\n```' }] } },
  ]);

  // 4. Phiên đã đóng bình thường
  write('s-nghi', [
    { type: 'user', timestamp: t(200), cwd, message: { role: 'user', content: 'Chào' } },
    { type: 'assistant', timestamp: t(199), cwd, message: { id: 'm4', model: 'claude-sonnet-4-6', usage: usage(), content: [{ type: 'text', text: 'Chào bạn.' }] } },
  ]);

  // Danh sách phiên của app desktop: phiên s-nghi là phiên app, có tiêu đề riêng
  const reg = path.join(root, 'appsupport', 'Claude', 'claude-code-sessions', 'acc', 'org');
  fs.mkdirSync(reg, { recursive: true });
  fs.writeFileSync(path.join(reg, 'local_abc.json'), JSON.stringify({ sessionId: 'local_abc', cliSessionId: 's-nghi', title: 'Phiên trong app', cwd, lastActivityAt: Date.now() - 199 * 60e3 }));

  const data = path.join(root, 'data');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'lang.json'), JSON.stringify({
    title: 'Làng thử', approvalHoldSeconds: 1, taskPrefix: 'GT',
    boss: { id: 'calm', name: 'Calm' }, agents: [{ id: 'xuong', name: 'Xưởng' }, { id: 'kiem-tra', name: 'Kiểm tra' }], buildings: [],
  }));
  return { root, home, data, cwd, appSupport: path.join(root, 'appsupport') };
}

module.exports = { lamMayGia };
