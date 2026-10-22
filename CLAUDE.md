# Game Town (lõi): ghi chú cho Claude làm tiếp

Người dùng: Hyan (GitHub thudonggg25), không chuyên kỹ thuật. Viết tiếng Việt, câu ngắn, kết quả trước. Máy Windows.

## Phạm vi repo

- Repo này CHỈ là logic. Hyan tự làm và tự chọn toàn bộ hình ảnh (nhân vật, bản đồ, giao diện game). Không thêm sprite, ảnh, mô hình hay giao diện đẹp vào đây. `bang-thu/` chỉ để kiểm logic, cố ý giữ đơn giản.
- Phần hình nói chuyện với lõi qua `docs/API.md` (WebSocket `/ws` cho Godot, SSE + `/api/hanh-dong` cho web). Đổi giao kèo thì cập nhật `docs/API.md` và test.

## Nguồn gốc

Gộp từ hyanaitown (của Hyan: hooks, duyệt trong game, bảng việc, phòng Calm, demo) và van-phong-claude (Hactory, MIT: quét phiên, trạng thái, tiền/ngữ cảnh/cache, trả lời qua ổ cắm, đánh dấu, tóm tắt, an toàn). Cộng thêm từ Game Town MVP: khối ```game, dựng làng từ mô tả dự án, chạy Claude bằng CLI / Agent SDK / mock. Xem `NOTICE.md`.

## Quy tắc

- Không phụ thuộc gói ngoài (Agent SDK là tuỳ chọn, nạp động). Hyan chỉ cần Node là chạy được.
- Chỉ ĐỌC file của Claude (`~/.claude/...`, thư mục app). Chỉ ghi vào `~/.game-town/`. Ngoại lệ duy nhất là `tools/cai-hooks.js` (người dùng tự chạy, có sao lưu).
- Server chỉ nghe 127.0.0.1, kiểm Host/Origin, lệnh ghi cần `X-Game-Town: 1`. Đừng nới lỏng.
- Xin quyền: chỉ giữ khi có giao diện đang nối vào; luôn có hạn giờ để Claude Code không bao giờ kẹt.
- Mọi thay đổi chạy `npm test` (máy giả trong `test/lam-du-lieu-gia.js`, không đụng dữ liệu thật).
- Việc không hoàn tác được (đăng, gửi, xoá) phải hỏi Hyan.

## Việc tiếp theo (gợi ý)

1. Hyan chạy thử trên Windows: `chay-thu.bat`, rồi `chay.bat` + `node tools/cai-hooks.js --ghi`.
2. Nối phần hình Godot của Hyan vào `/ws` theo `docs/API.md`.
3. Phiên Codex (van-phong-claude đọc `~/.codex/*.sqlite`), có thể dùng `node:sqlite`.
4. Lịch chạy việc `repeat: daily/weekly` của công trình (Task Scheduler / scheduled tasks).
5. Đóng gói app PC: vỏ mỏng tự bật/tắt lõi, chấm đỏ trên biểu tượng theo `waiting`.
