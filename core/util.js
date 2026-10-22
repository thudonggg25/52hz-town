// Đồ dùng chung: đường dẫn theo hệ điều hành, đọc/ghi JSON, cấu hình, nhật ký lỗi.
// Không dùng gói ngoài: chỉ cần Node.js 20+.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Thư mục nhà có thể đổi bằng biến môi trường GT_HOME (dùng khi kiểm thử với dữ liệu giả).
function home() { return process.env.GT_HOME || os.homedir(); }

const P = {
  get claude() { return path.join(home(), '.claude'); },
  get projects() { return path.join(home(), '.claude', 'projects'); },     // nhật ký phiên CLI + app
  get live() { return path.join(home(), '.claude', 'sessions'); },          // phiên đang mở: <pid>.json
  get claudeSettings() { return path.join(home(), '.claude', 'settings.json'); },
  // Dữ liệu riêng của Game Town (không nằm trong repo): đánh dấu, màn hình, tóm tắt, bảng việc, nhật ký…
  get data() { return process.env.GT_DATA || path.join(home(), '.game-town'); },
  // Nơi app Claude desktop lưu danh sách phiên Code (mỗi bản app một thư mục Claude / Claude-NN)
  appSupportDirs() {
    const h = home();
    if (process.env.GT_APP_SUPPORT) return [process.env.GT_APP_SUPPORT];
    if (process.platform === 'darwin') return [path.join(h, 'Library', 'Application Support')];
    if (process.platform === 'win32') return [process.env.APPDATA || path.join(h, 'AppData', 'Roaming')];
    return [path.join(h, '.config')];
  },
};

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); return d; }

function loadJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return fallback; } // bỏ BOM (Notepad/PowerShell)
}

// Ghi file tạm rồi đổi tên: không bao giờ để lại file JSON hỏng nửa chừng.
function saveJson(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  const text = JSON.stringify(data, null, 1);
  fs.writeFileSync(tmp, text);
  try { fs.renameSync(tmp, file); }
  catch { fs.writeFileSync(file, text); try { fs.unlinkSync(tmp); } catch {} } // Windows: file đang bị giữ (diệt virus, trình soạn thảo)
}

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  try { ensureDir(P.data); fs.appendFileSync(path.join(P.data, 'log.txt'), line); } catch {}
  if (process.env.GT_DEBUG) process.stderr.write(line);
}

// Cấu hình riêng từng máy: ~/.game-town/cau-hinh.json (mẫu: cau-hinh.mau.json trong repo).
let _cfg = { at: 0, data: {} };
function cauHinh() {
  if (Date.now() - _cfg.at > 3000) _cfg = { at: Date.now(), data: loadJson(path.join(P.data, 'cau-hinh.json'), {}) || {} };
  return _cfg.data;
}

// Cấu hình làng: town.config.json trong repo (hoặc ~/.game-town/lang.json do bộ lập kế hoạch tạo ra).
function townConfig() {
  const own = loadJson(path.join(P.data, 'lang.json'));
  if (own && own.boss) return own;
  return loadJson(path.join(ROOT, 'town.config.json'), {}) || {};
}

const isoMs = s => { const t = Date.parse(s || ''); return Number.isFinite(t) ? t : 0; };
const clip = (v, n) => { const t = typeof v === 'string' ? v : JSON.stringify(v ?? '', null, 1); return t.length > n ? t.slice(0, n) + '\n…(còn nữa)' : t; };
const oneLine = (v, n = 80) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try { process.kill(n, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

module.exports = { ROOT, P, home, ensureDir, loadJson, saveJson, log, cauHinh, townConfig, isoMs, clip, oneLine, pidAlive };
