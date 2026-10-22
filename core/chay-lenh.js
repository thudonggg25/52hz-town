// Chạy một chương trình an toàn trên cả Windows lẫn Mac/Linux.
// Windows: `claude` cài bằng npm là file .cmd, phải chạy qua cmd.exe, mà cmd.exe hiểu sai chữ có dấu cách,
// dấu ngoặc kép hay xuống dòng. Nên: tìm đúng file bằng `where`; file .exe thì chạy thẳng (an toàn);
// file .cmd/.bat thì chạy qua cmd với từng tham số được bọc ngoặc kép. Nội dung dài (lời nhắn) luôn đưa qua stdin.
'use strict';
const { spawn, execFileSync } = require('child_process');

const _where = new Map();
function resolveWin(cmd) {
  if (/[\\/]/.test(cmd) || /\.(exe|com|cmd|bat)$/i.test(cmd)) return cmd;
  if (_where.has(cmd)) return _where.get(cmd);
  let hit = cmd;
  try {
    const list = execFileSync('where', [cmd], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).filter(Boolean);
    hit = list.find(p => /\.exe$/i.test(p)) || list.find(p => /\.(cmd|bat)$/i.test(p)) || list[0] || cmd;
  } catch {}
  _where.set(cmd, hit);
  return hit;
}
// Bọc tham số cho cmd.exe: bỏ xuống dòng, nhân đôi ngoặc kép, bọc trong ngoặc kép.
const quoteCmd = a => '"' + String(a).replace(/\r?\n/g, ' ').replace(/"/g, '""') + '"';

function spawnSafe(cmd, args = [], opts = {}) {
  const base = { windowsHide: true, ...opts };
  if (process.platform !== 'win32') return spawn(cmd, args, base);
  const file = resolveWin(cmd);
  // Windows không chạy thẳng được file .js (lỗi EFTYPE): chạy qua chính Node
  if (/\.[cm]?js$/i.test(file)) return spawn(process.execPath, [file, ...args], base);
  if (/\.(cmd|bat)$/i.test(file)) {
    const line = [quoteCmd(file), ...args.map(quoteCmd)].join(' ');
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...base, windowsVerbatimArguments: true });
  }
  return spawn(file, args, base);
}

// Dừng cả cây tiến trình: trên Windows, kill() chỉ giết cmd.exe còn Claude (tiến trình cháu) vẫn chạy.
function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32' && proc.pid) {
    try { spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true }); return; } catch {}
  }
  try { proc.kill(); } catch {}
}

module.exports = { spawnSafe, resolveWin, quoteCmd, killTree };
