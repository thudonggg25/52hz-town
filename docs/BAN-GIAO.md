# Bàn giao Game Town (lõi)

Dành cho người (hoặc phiên Claude) làm tiếp. Đọc cùng `CLAUDE.md`.

## 1. Hyan là ai, Game Town để làm gì

- Hyan (GitHub `thudonggg25`) không chuyên kỹ thuật, dùng Windows. Viết tiếng Việt, câu ngắn, kết quả trước.
- Game Town biến việc làm với Claude thành một game quản lý làng kiểu Manor Lords.
- Mỗi phiên Claude là một người dân. Mỗi khu việc là một công trình.
- Mỗi cú bấm trong game là việc thật: duyệt quyền, chọn phương án, giao việc.

## 2. Ranh giới quan trọng nhất

- Repo này **chỉ có logic**.
- Hyan tự làm và tự chọn toàn bộ hình ảnh: nhân vật, bản đồ, giao diện game.
- Không thêm sprite, ảnh, mô hình hay giao diện đẹp vào repo.
- `bang-thu/` chỉ để kiểm logic, cố ý giữ đơn giản.
- Phần hình nói chuyện với lõi qua `docs/API.md` (WebSocket `/ws` cho Godot, SSE + `/api/hanh-dong` cho web). Đổi giao kèo thì cập nhật `docs/API.md` và test.

## 3. Nguồn gốc

- **hyanaitown** (của Hyan): hooks, duyệt trong game, bảng việc, phòng Calm, demo.
- **van-phong-claude** (Hactory, MIT): quét phiên, trạng thái, tiền/ngữ cảnh/cache, trả lời qua ổ cắm, đánh dấu, tóm tắt, an toàn.
- **Game Town MVP**: khối ```` ```game ````, dựng làng từ mô tả dự án, chạy Claude bằng CLI / Agent SDK / mock.
- Ghi công đầy đủ: `NOTICE.md`.

## 4. Đã có gì

- Toàn bộ bảng "Lõi làm được gì" trong `README.md`.
- `npm test`: 19 test, chạy trên máy giả (`test/lam-du-lieu-gia.js`), không đụng dữ liệu thật.

**Chưa từng chạy trên Windows thật:**
- `chay-thu.bat`, `chay.bat`.
- `tools/cai-hooks.js --ghi` trên `settings.json` thật của Windows.
- Đọc phiên của app Claude desktop trên Windows (đường dẫn `%APPDATA%`).
- Trả lời phiên đang mở qua ổ cắm (named pipe trên Windows).
- Chạy `claude --resume` từ lõi trên Windows.

## 5. Việc tiếp theo (theo thứ tự)

### 5.1 Chạy thử trên Windows

1. Cài Node.js 20+ (https://nodejs.org, bản LTS). Kiểm tra: `node -v`.
2. Tải repo về, giải nén.
3. Bấm đúp `chay-thu.bat`. Trình duyệt mở http://127.0.0.1:4545. Bấm **▶ Tự chạy**.
4. Chạy thật: bấm đúp `chay.bat` (dùng Claude Code đã đăng nhập).
5. Hooks: `node tools\cai-hooks.js` (xem trước), rồi `node tools\cai-hooks.js --ghi`. Gỡ: `--go`.
6. Ghi lại lỗi (chụp cửa sổ đen) để sửa.

### 5.2 Đóng gói thành `.exe`

- Vỏ mỏng tự bật/tắt lõi.
- Chấm đỏ trên biểu tượng theo trạng thái `waiting`.

### 5.3 Đọc phiên Codex

- van-phong-claude đọc `~/.codex/*.sqlite`. Có thể dùng `node:sqlite` để không cần gói ngoài.

### 5.4 Debate

- Cho nhiều phiên Claude tranh luận một phương án, Hyan chọn trong game.

### 5.5 Nhiều làng

- Mỗi dự án một làng, chuyển qua lại được.

## 6. Quy tắc làm việc

- Không phụ thuộc gói ngoài (Agent SDK là tuỳ chọn, nạp động).
- Chỉ ĐỌC file của Claude. Chỉ ghi vào `~/.game-town/`. Ngoại lệ: `tools/cai-hooks.js`.
- Server chỉ nghe 127.0.0.1, kiểm Host/Origin, lệnh ghi cần `X-Game-Town: 1`. Đừng nới lỏng.
- Chạy `npm test` trước mỗi commit.
- Hỏi Hyan trước khi đẩy lên GitHub và trước mọi việc không hoàn tác được (đăng, gửi, xoá).

## 7. Bắt đầu ở acc mới

**Lấy mã:**
- Repo công khai: https://github.com/thudonggg25/52hz-town
- Bản mới nhất nằm ở nhánh `claude/relaxed-hypatia-r4vi6q` (chưa gộp vào `main`).
- Hoặc dùng file zip Hyan mang theo, giải nén ra một thư mục.

**Câu mở đầu dán cho Claude ở acc mới** (nên chạy trên máy Windows của Hyan, không chạy trên đám mây):

> Đọc `CLAUDE.md` và `docs/BAN-GIAO.md` trước. Đây là lõi logic Game Town, mình (Hyan) tự làm phần hình. Chạy `npm test`, rồi làm mục 5.1: chạy thử trên Windows, sửa lỗi gặp được. Trả lời tiếng Việt, câu ngắn. Hỏi mình trước khi đẩy lên GitHub.

## 8. Nhật ký phiên trước (22/10/2026)

- Thêm file này.
- Thêm cờ `--thu` cho `core/server.js`; `npm run thu` giờ chạy được trên Windows.
- `npm test`: 19/19 đạt (trên Linux).
- Chưa làm: chạy thử trên Windows thật (phiên trước chạy trên đám mây nên không với tới máy Hyan).
