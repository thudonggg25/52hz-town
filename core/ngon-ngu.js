// Dịch việc Claude đang làm sang câu tiếng Việt ngắn (bong bóng trên đầu người dân),
// và tách "khối game" Claude để lại cuối câu trả lời thành thẻ câu hỏi / phương án.
'use strict';
const { oneLine } = require('./util');

const base = p => String(p || '').replace(/\\/g, '/').split('/').filter(Boolean).slice(-1)[0] || '';

function moTaCongCu(name, input) {
  const i = input || {};
  switch (name) {
    case 'Bash': case 'PowerShell': return 'Chạy lệnh: ' + oneLine(i.description || i.command, 60);
    case 'Read': return 'Đọc ' + base(i.file_path);
    case 'Write': return 'Viết ' + base(i.file_path);
    case 'Edit': case 'MultiEdit': return 'Sửa ' + base(i.file_path);
    case 'NotebookEdit': return 'Sửa ' + base(i.notebook_path);
    case 'Grep': case 'Glob': return 'Tìm: ' + oneLine(i.pattern, 50);
    case 'WebSearch': return 'Tra web: ' + oneLine(i.query, 60);
    case 'WebFetch': return 'Đọc trang ' + oneLine(i.url, 60);
    case 'Task': case 'Agent': return `Giao việc cho ${i.subagent_type || 'agent'}: ${oneLine(i.description, 50)}`;
    case 'Skill': return 'Dùng kỹ năng /' + oneLine(i.skill || i.name, 40);
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': return 'Cập nhật danh sách việc';
    case 'AskUserQuestion': return 'Hỏi bạn một câu';
    default:
      if (String(name).startsWith('mcp__')) {
        const parts = String(name).split('__');
        return `Gọi ${parts[1] || 'MCP'}: ${parts[parts.length - 1]}`;
      }
      return String(name || 'Làm việc');
  }
}

// Khối Claude đặt ở cuối câu trả lời để game hiện thành thẻ. Nhận cả 2 kiểu:
//   ```game {"status","summary","progress","question","options":[{"label","description","recommended"}],"allow_free_text","outputs"}
//   ```lua-chon {"cau_hoi","lua_chon":[{"nhan","mo_ta","khuyen_dung"}]}   (kiểu cũ của hyanaitown)
const BLOCK_RE = /```(game|lua-chon)\s*\n([\s\S]*?)```/g;

function tachKhoiGame(text) {
  const src = String(text || '');
  let last = null;
  for (const m of src.matchAll(BLOCK_RE)) last = m;
  if (!last) return { text: src, block: null };
  let raw;
  try { raw = JSON.parse(last[2]); } catch { return { text: src, block: null }; }
  const clean = (src.slice(0, last.index) + src.slice(last.index + last[0].length)).trim();
  return { text: clean, block: chuanHoaKhoi(last[1], raw) };
}

function chuanHoaKhoi(kind, raw) {
  if (kind === 'lua-chon') {
    return {
      status: 'cho', summary: '', progress: null, question: String(raw.cau_hoi || ''),
      options: (raw.lua_chon || []).slice(0, 6).map(o => ({ label: String(o.nhan || ''), description: String(o.mo_ta || ''), recommended: !!o.khuyen_dung })),
      allowFreeText: true, outputs: [],
    };
  }
  const st = String(raw.status || '').toLowerCase();
  const status = { waiting: 'cho', needs_input: 'cho', cho: 'cho', done: 'xong', complete: 'xong', xong: 'xong', working: 'lam', lam: 'lam', error: 'loi', loi: 'loi' }[st] || (raw.question ? 'cho' : 'xong');
  return {
    status,
    summary: String(raw.summary || ''),
    progress: Number.isFinite(Number(raw.progress)) ? Math.max(0, Math.min(100, Number(raw.progress))) : null,
    question: String(raw.question || ''),
    options: (raw.options || []).slice(0, 6).map(o => typeof o === 'string' ? { label: o, description: '', recommended: false }
      : { label: String(o.label || ''), description: String(o.description || ''), recommended: !!o.recommended }),
    allowFreeText: raw.allow_free_text !== false,
    outputs: Array.isArray(raw.outputs) ? raw.outputs.map(String).slice(0, 20) : [],
  };
}

// Lời dặn gắn thêm khi game tự chạy Claude, để Claude trả lời kèm khối game.
const LOI_DAN_KHOI_GAME = [
  'Bạn đang làm việc qua game Game Town. Câu trả lời hiện đầy đủ, có Markdown.',
  'Kết thúc MỖI lượt bằng đúng một khối như sau (JSON hợp lệ, tiếng Việt):',
  '```game',
  '{"status": "xong | cho | loi", "summary": "1-2 câu kết quả", "progress": 0-100, "question": "câu hỏi nếu cần người dùng quyết, không thì để trống", "options": [{"label": "Tên phương án", "description": "Chọn thì điều gì xảy ra", "recommended": true}], "allow_free_text": true, "outputs": ["đường dẫn file đã tạo"]}',
  '```',
  'Tối đa 3 phương án. Người dùng bấm phương án nào thì tin tiếp theo là "Mình chọn: <label>".',
].join('\n');

module.exports = { moTaCongCu, tachKhoiGame, chuanHoaKhoi, LOI_DAN_KHOI_GAME };
