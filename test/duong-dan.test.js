'use strict';
// Tên dự án lấy từ thư mục làm việc, với đường dẫn kiểu Windows (ổ đĩa, dấu \, chữ có dấu).
const test = require('node:test');
const assert = require('node:assert');

process.env.GT_HOME = 'C:\\Users\\An';
const { projectOf } = require('../core/phien');

test('tên dự án từ đường dẫn Windows', () => {
  const p = c => projectOf(c).project;
  assert.strictEqual(p('C:\\Users\\An'), '~');
  assert.strictEqual(p('C:\\Users\\An\\Làng Thử'), 'Làng Thử');
  assert.strictEqual(p('C:\\Users\\An\\Documents\\du-an\\src'), 'du-an');
  assert.strictEqual(p('F:\\AITown'), 'AITown');
  assert.strictEqual(p('F:\\AITown\\.claude\\worktrees\\vui-ve-1a2b'), 'AITown');
  assert.deepStrictEqual(projectOf('F:\\AITown\\.claude\\worktrees\\vui-ve-1a2b'), { project: 'AITown', worktree: 'vui-ve-1a2b' });
  // Thư mục ẩn và thư mục hệ thống không thành tên làng
  assert.strictEqual(p('C:\\Users\\An\\.codex\\.chatgpt-projects\\g-p-abc\\output\\app-helper'), 'app-helper');
  assert.strictEqual(p('C:\\Users\\An\\AppData\\Local\\Temp\\thu-nghiem'), 'thu-nghiem');
  // Phiên nháp của app desktop gom chung
  assert.strictEqual(p('C:\\Users\\An\\AppData\\Roaming\\Claude\\scratch-workspaces\\1\\2\\scratch-2026-10-02-1ac24b'), 'Nháp');
  assert.strictEqual(p(''), '?');
});
