// WebSocket tối giản (RFC 6455, chỉ khung chữ) để Godot nối vào mà không cần gói ngoài.
'use strict';
const crypto = require('crypto');

function acceptUpgrade(req, socket, head, onMessage) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return null; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0); // byte tới cùng gói bắt tay
  let frag = [], fragSize = 0;
  const client = {
    open: true,
    send(obj) {
      if (!client.open) return;
      const data = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj));
      let head;
      if (data.length < 126) head = Buffer.from([0x81, data.length]);
      else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(data.length, 2); }
      else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
      socket.write(Buffer.concat([head, data]));
    },
    close() { if (client.open) { client.open = false; try { socket.end(Buffer.from([0x88, 0])); } catch {} } },
    onclose: null,
  };
  const onData = chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin = (buf[0] & 0x80) !== 0, op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 8e6) { socket.destroy(); return; }
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let payload = buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) { const m = buf.subarray(off, off + 4); payload = Buffer.from(payload.map((b, i) => b ^ m[i % 4])); }
      buf = buf.subarray(need);
      if (op >= 0x8 && (!fin || len > 125)) { socket.destroy(); return; } // khung điều khiển sai luật
      if (op === 0x8) { client.close(); socket.destroy(); return; }
      if (op === 0x9) { socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; } // ping -> pong
      if (op === 0xa) continue;
      if (op === 0x1 || op === 0x2 || op === 0x0) {
        frag.push(payload); fragSize += payload.length;
        if (fragSize > 8e6) { socket.destroy(); return; }
        if (fin) {
          const text = Buffer.concat(frag).toString('utf8'); frag = []; fragSize = 0;
          let msg;
          try { msg = JSON.parse(text); } catch { client.send({ type: 'loi', error: 'Tin không phải JSON' }); continue; }
          Promise.resolve().then(() => onMessage(msg, client)).catch(e => { try { client.send({ type: 'loi', error: String(e && e.message || e) }); } catch {} });
        }
      }
    }
  };
  socket.on('data', onData);
  if (buf.length) { const first = buf; buf = Buffer.alloc(0); onData(first); }
  const end = () => { if (client.open) { client.open = false; } if (client.onclose) client.onclose(); };
  socket.on('close', end);
  socket.on('error', end);
  return client;
}

module.exports = { acceptUpgrade };
