// Nút "Tự chạy": diễn một vòng làm việc bằng ĐÚNG các sự kiện hooks thật (học từ hyanaitown),
// nên demo chạy được thì phần thật cũng chạy được. Không gọi Claude.
'use strict';

function runDemo(lang, isOn) {
  const sid = 'demo-' + Date.now().toString(36);
  const cfg = lang.config();
  const houses = (cfg.agents || []).map(a => a.id);
  const [a1 = 'nghien-cuu', a2 = 'xuong', a3 = 'kiem-tra'] = houses;
  const h = ev => lang.handleHook({ session_id: sid, cwd: cfg.teamDir || '', ...ev });
  const steps = [
    [0, () => h({ hook_event_name: 'SessionStart' })],
    [800, () => h({ hook_event_name: 'UserPromptSubmit', prompt: 'Làm tính năng đăng nhập bằng email' })],
    [1500, () => h({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: a1, description: 'Tìm hiểu cách đăng nhập hiện tại', prompt: 'Đọc code đăng nhập' } })],
    [2200, () => h({ hook_event_name: 'SubagentStart', agent_type: a1 })],
    [3000, () => h({ hook_event_name: 'PreToolUse', agent_type: a1, tool_name: 'Read', tool_input: { file_path: 'src/auth/login.ts' } })],
    [4200, () => h({ hook_event_name: 'PreToolUse', agent_type: a1, tool_name: 'Grep', tool_input: { pattern: 'signIn' } })],
    [5500, () => h({ hook_event_name: 'SubagentStop', agent_type: a1, last_assistant_message: 'Đã tìm ra 3 chỗ cần sửa.' })],
    [6200, () => h({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { subagent_type: a1 } })],
    [6800, () => h({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: a2, description: 'Viết form đăng nhập email', prompt: 'Viết form' } })],
    [7300, () => h({ hook_event_name: 'SubagentStart', agent_type: a2 })],
    [8200, () => h({ hook_event_name: 'PreToolUse', agent_type: a2, tool_name: 'Edit', tool_input: { file_path: 'src/auth/EmailForm.tsx' } })],
    [9400, () => h({ hook_event_name: 'PreToolUse', agent_type: a2, tool_name: 'Bash', tool_input: { description: 'Chạy kiểm thử' } })],
    [10600, () => h({ hook_event_name: 'SubagentStop', agent_type: a2, last_assistant_message: 'Form đã xong, test đạt.' })],
    [11200, () => h({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: a3, description: 'Kiểm tra trước khi gộp', prompt: 'Kiểm tra' } })],
    [11700, () => h({ hook_event_name: 'SubagentStart', agent_type: a3 })],
    [13000, () => lang.boardPost({ title: 'Gộp tính năng đăng nhập email vào main', agent: a3, gate: 'gop-main', note: 'Test đạt 12/12' })],
    [13600, () => h({ hook_event_name: 'SubagentStop', agent_type: a3, last_assistant_message: 'Đã gửi chờ duyệt gộp.' })],
    [14200, () => h({ hook_event_name: 'Stop', last_assistant_message: 'Xong, chờ bạn duyệt gộp.' })],
  ];
  const timers = steps.map(([ms, fn]) => setTimeout(() => { if (isOn()) fn(); }, ms));
  return () => timers.forEach(clearTimeout);
}

module.exports = { runDemo };
