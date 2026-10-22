// Tài nguyên thật cho nền kinh tế của làng (học từ van-phong-claude):
// tiền phiên quy đổi giá API, ngữ cảnh đã dùng, cache còn ấm, và lượng dùng theo vòng 5 giờ / 7 ngày.
'use strict';
const fs = require('fs');
const path = require('path');
const { P, loadJson, isoMs, cauHinh } = require('./util');

// Giá API theo triệu token: [tiền tố model, vào, ra, đọc cache (tham khảo), cửa sổ ngữ cảnh].
// Bảng theo giá công bố 10/2026 (chép từ van-phong-claude). Tiền tố dài xếp trước.
// Đổi/thêm giá trong ~/.game-town/cau-hinh.json mục "gia": [["claude-x", 3, 15, 0.3, 200000], …]
const PRICES = [
  ['claude-fable-5-1', 10, 50, 0.25, 1_000_000], ['claude-fable-5', 10, 50, 1.0, 1_000_000],
  ['claude-opus-5-5', 4, 20, 0.20, 1_000_000], ['claude-opus-5', 5, 25, 0.5, 1_000_000],
  ['claude-opus-4-8', 5, 25, 0.5, 1_000_000], ['claude-opus-4-7', 5, 25, 0.5, 1_000_000],
  ['claude-opus-4-6', 5, 25, 0.5, 1_000_000], ['claude-opus-4-5', 5, 25, 0.5, 200_000],
  ['claude-opus-4', 15, 75, 1.5, 200_000],
  ['claude-sonnet-5-5', 2, 10, 0.2, 1_000_000], ['claude-sonnet-5', 2, 10, 0.2, 1_000_000],
  ['claude-sonnet-4-6', 3, 15, 0.3, 1_000_000], ['claude-sonnet-4', 3, 15, 0.3, 200_000],
  ['claude-haiku-5-5', 0.1, 0.5, 0.01, 1_000_000], ['claude-haiku-4-5', 1, 5, 0.1, 200_000],
];

function priceOf(model) {
  const list = [...(cauHinh().gia || []), ...PRICES];
  return list.find(p => String(model || '').startsWith(p[0])) || null;
}

// Cách cộng giống Claude Code: ghi cache ×1,25 giá vào, đọc cache ×0,1, chế độ nhanh ×2.
function costOf(model, u) {
  const p = priceOf(model);
  if (!p) return null;
  const [, inp, out] = p;
  const mult = u.speed === 'fast' ? 2 : 1;
  return mult * ((u.input_tokens || 0) * inp + (u.cache_creation_input_tokens || 0) * inp * 1.25
    + (u.cache_read_input_tokens || 0) * inp * 0.1 + (u.output_tokens || 0) * out) / 1e6;
}

// Cộng dồn một nhật ký. Mỗi tin của Claude bị ghi lặp vài dòng nên đếm theo message.id.
class UsageAcc {
  constructor() { this.msgs = new Map(); this.lastOther = 0; this.reqStart = 0; this.ttl = 0; this.ctx = 0; this.model = ''; this.unpriced = new Set(); }
  feed(e) {
    const ts = isoMs(e.timestamp);
    if (e.type !== 'assistant') { if (ts) this.lastOther = ts; return; }
    const m = e.message || {}, u = m.usage;
    if (!u) return;
    const mid = m.id || e.uuid;
    const model = m.model || '';
    const c = costOf(model, u);
    if (c === null && model && !model.startsWith('<')) this.unpriced.add(model);
    const isNew = !this.msgs.has(mid);
    this.msgs.set(mid, { cost: c || 0, input: u.input_tokens || 0, output: u.output_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, model, ts });
    if (e.isSidechain) return;
    if (isNew) this.reqStart = this.lastOther || ts;
    const cc = u.cache_creation || {};
    if (cc.ephemeral_1h_input_tokens) this.ttl = 3600; else if (cc.ephemeral_5m_input_tokens) this.ttl = 300;
    this.ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
    this.model = model || this.model;
  }
  summary() {
    const t = { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const m of this.msgs.values()) for (const k of Object.keys(t)) t[k] += m[k];
    t.cost = Math.round(t.cost * 1e4) / 1e4;
    return { ...t, calls: this.msgs.size, ctx: this.ctx, window: (priceOf(this.model) || [])[4] || 0, model: this.model, unpriced: [...this.unpriced] };
  }
  cache() { return this.reqStart ? { start: this.reqStart, ttl: this.ttl || 3600, known: !!this.ttl } : null; }
}

// Nhật ký chỉ ghi thêm, nên đọc nối tiếp từ chỗ đã đọc lần trước.
const _usage = new Map(); // path -> { off, acc }
function usageOf(file) {
  let size;
  try { size = fs.statSync(file).size; } catch { return new UsageAcc(); }
  let c = _usage.get(file);
  if (!c || size < c.off) c = { off: 0, acc: new UsageAcc() };
  if (size > c.off) {
    // Đọc từng khúc 4 MB để nhật ký to không làm đứng server
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      while (c.off < size) {
        const buf = Buffer.alloc(Math.min(4 << 20, size - c.off));
        const n = fs.readSync(fd, buf, 0, buf.length, c.off);
        const cut = buf.subarray(0, n).lastIndexOf(10);
        if (cut < 0) break; // dòng chưa ghi xong (hoặc dòng dài hơn 4 MB): đợi lần sau
        for (const line of buf.subarray(0, cut + 1).toString('utf8').split('\n')) {
          if (!line) continue;
          try { c.acc.feed(JSON.parse(line)); } catch {}
        }
        c.off += cut + 1;
      }
    } catch {} finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
  }
  _usage.set(file, c);
  return c.acc;
}

const subagentLogs = tpath => {
  const dir = path.join(tpath.replace(/\.jsonl$/, ''), 'subagents');
  try { return fs.readdirSync(dir).filter(n => /^agent-.*\.jsonl$/.test(n)).map(n => path.join(dir, n)); } catch { return []; }
};

let _moc = { at: 0, v: null };
function ctxMoc() {
  if (Date.now() - _moc.at > 10e3) {
    const v = (loadJson(P.claudeSettings, {}) || {}).autoCompactWindow;
    _moc = { at: Date.now(), v: Number(v) > 0 ? Number(v) : null };
  }
  return _moc.v;
}

// Tiền cả phiên (phiên chính + subagent), ngữ cảnh và cache của phiên chính.
function sessionUsage(tpath) {
  if (!tpath) return null;
  const main = usageOf(tpath);
  const out = main.summary();
  let sub = 0;
  for (const f of subagentLogs(tpath)) { const s = usageOf(f).summary(); sub += s.cost; out.unpriced = [...new Set([...out.unpriced, ...s.unpriced])]; }
  out.subCost = Math.round(sub * 1e4) / 1e4;
  out.total = Math.round((out.cost + sub) * 1e4) / 1e4;
  out.cache = main.cache();
  out.mocCompact = ctxMoc();
  out.moc = out.mocCompact || out.window;
  out.ctxPct = out.moc ? Math.round(out.ctx / out.moc * 100) : null;
  return out;
}

// Lượng dùng theo vòng: cộng mọi lượt gọi có mốc giờ trong 5 giờ / 7 ngày qua, trên mọi nhật ký.
// Đây là số ƯỚC TÍNH từ máy này (không phải số quota Anthropic báo). Muốn số thật, khai
// "quota": {"lenh": ["lệnh", "in", "JSON"]} trong cau-hinh.json, game sẽ chạy lệnh đó (xem docs/API.md).
function usageWindows(tpaths, now = Date.now()) {
  const W = { h5: 5 * 3600e3, d7: 7 * 86400e3 };
  const out = { h5: { cost: 0, output: 0, calls: 0, oldest: 0 }, d7: { cost: 0, output: 0, calls: 0, oldest: 0 }, byModel: {} };
  for (const t of tpaths) {
    for (const f of [t, ...subagentLogs(t)]) {
      for (const m of usageOf(f).msgs.values()) {
        for (const k of ['h5', 'd7']) {
          if (!m.ts || now - m.ts > W[k]) continue;
          const o = out[k];
          o.cost += m.cost; o.output += m.output; o.calls += 1;
          if (!o.oldest || m.ts < o.oldest) o.oldest = m.ts;
          if (k === 'd7') { const b = out.byModel[m.model || '?'] ||= { cost: 0, calls: 0 }; b.cost += m.cost; b.calls += 1; }
        }
      }
    }
  }
  for (const k of ['h5', 'd7']) {
    out[k].cost = Math.round(out[k].cost * 100) / 100;
    out[k].resetAt = out[k].oldest ? out[k].oldest + W[k] : null; // lượt cũ nhất rơi khỏi vòng lúc này
  }
  return out;
}

module.exports = { PRICES, priceOf, costOf, UsageAcc, usageOf, sessionUsage, usageWindows, subagentLogs };
