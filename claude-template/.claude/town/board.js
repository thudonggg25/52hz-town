#!/usr/bin/env node
// Lệnh nhỏ để Claude (Calm và các agent) nói chuyện với Game Town đang chạy ở localhost:4545.
//
//   node .claude/town/board.js duyet "Tiêu đề" --agent kiem-tra [--cong gop-main] [--note "..."] [--no-wait]
//       Gửi việc chờ bạn duyệt. Không --no-wait thì đứng chờ: thoát 0 = duyệt, 2 = từ chối, 3 = hết giờ, 1 = lỗi.
//       --cong: cổng duyệt (nhan-lam | gop-main | dang-ban) để game hiện đúng biểu tượng.
//   node .claude/town/board.js hoi "Câu hỏi" --agent calm [--ve GT-010]   Hỏi bạn, không đứng chờ.
//   node .claude/town/board.js cho <MÃ>     Chờ tiếp một việc đã gửi.
//   node .claude/town/board.js xem <MÃ>     Xem trạng thái một việc.
//   node .claude/town/board.js ds           Việc đang chờ duyệt / vừa duyệt / bị từ chối.
//   node .claude/town/board.js ghi "Nội dung" --agent xuong [--bubble "chữ trên đầu"]
'use strict';
const BASE = process.env.GAME_TOWN_URL || 'http://127.0.0.1:4545';
const args = process.argv.slice(2);
const cmd = args.shift();
const opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const flag = n => { const i = args.indexOf('--' + n); if (i >= 0) { args.splice(i, 1); return true; } return false; };

async function call(method, path, body, action) {
  const headers = { 'Content-Type': 'application/json' };
  if (action) headers['X-Game-Town'] = '1';
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

async function waitFor(id, maxMin = 9) {
  const end = Date.now() + maxMin * 60e3;
  process.stdout.write(`Đang chờ bạn duyệt ${id} trong Game Town`);
  while (Date.now() < end) {
    const t = await call('GET', `/api/bang/${id}`);
    if (t.status === 'approved') { console.log(`\nĐÃ DUYỆT ${id}.${t.note ? ' Ghi chú: ' + t.note : ''}`); return 0; }
    if (t.status === 'rejected') { console.log(`\nBỊ TỪ CHỐI ${id}.${t.note ? ' Lý do: ' + t.note : ''} Dừng lại và báo Calm.`); return 2; }
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log(`\nHết giờ chờ ${id}. Chạy lại: node .claude/town/board.js cho ${id}`);
  return 3;
}

(async () => {
  try {
    if (cmd === 'duyet') {
      const agent = opt('agent'), note = opt('note'), gate = opt('cong'), noWait = flag('no-wait');
      const t = await call('POST', '/api/bang', { title: args.join(' ') || 'Việc cần duyệt', agent, note, gate, status: 'waiting_approval' });
      console.log(`Đã gửi ${t.id}: ${t.title}`);
      process.exit(noWait ? 0 : await waitFor(t.id));
    } else if (cmd === 'hoi') {
      const agent = opt('agent') || 'calm', ref = opt('ve');
      const question = args.join(' ');
      const t = await call('POST', '/api/bang', { title: ref ? `Câu hỏi về ${ref}` : question.slice(0, 80), question, ref, agent, status: 'waiting_approval' });
      console.log(`Đã hỏi (${t.id}). Câu trả lời sẽ ghi vào lich/tra-loi.md trong thư mục đội.`);
    } else if (cmd === 'cho') {
      process.exit(await waitFor(args[0]));
    } else if (cmd === 'xem') {
      const t = await call('GET', `/api/bang/${args[0]}`);
      console.log(`${t.id} [${t.status}] ${t.title}${t.note ? ' · ' + t.note : ''}`);
    } else if (cmd === 'ds') {
      const s = await call('GET', '/api/lang');
      const rows = s.board.filter(t => ['waiting_approval', 'approved', 'rejected', 'answered'].includes(t.status));
      if (!rows.length) console.log('Không có việc nào chờ duyệt.');
      for (const t of rows) console.log(`${t.id} [${t.status}] ${t.title}${t.note ? ' · ' + t.note : ''}`);
    } else if (cmd === 'ghi') {
      const agent = opt('agent'), bubble = opt('bubble');
      await call('POST', '/api/hanh-dong', { ten: 'nhat-ky.ghi', agent, text: args.join(' '), bubble }, true);
      console.log('Đã ghi.');
    } else {
      console.log('Dùng: duyet "Tiêu đề" --agent <id> [--cong gop-main] [--no-wait] | hoi "Câu hỏi" [--ve MÃ] | cho <MÃ> | xem <MÃ> | ds | ghi "Nội dung" --agent <id>');
      process.exit(1);
    }
  } catch (e) {
    console.log(`Không nối được Game Town (${e.message}). Có thể game chưa chạy.`);
    process.exit(1);
  }
})();
