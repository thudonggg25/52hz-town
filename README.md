# Game Town (lõi)

Lõi logic của Game Town: biến việc làm với Claude thành một game quản lý làng. Mỗi phiên Claude là một người dân, mỗi khu việc là một công trình. Bạn duyệt, chọn phương án và giao việc ngay trong game, và mỗi cú bấm là việc thật.

Repo này **chỉ có logic**. Hình ảnh, nhân vật, bản đồ là phần riêng, bạn tự làm. Phần đó nói chuyện với lõi qua [docs/API.md](docs/API.md). Trong repo có sẵn một "bảng thử" xấu xí để kiểm logic khi chưa có hình.

Chỉ cần **Node.js 20+**, không cài thêm gói nào.

## Chạy thử ngay

- Windows: bấm đúp `chay-thu.bat`. Chế độ thử không gọi Claude thật.
- Mac/Linux: `bash chay.sh --thu`

Trình duyệt sẽ mở http://127.0.0.1:4545. Bấm **▶ Tự chạy** để xem một vòng làm việc mẫu, hoặc gõ việc vào Phòng Calm.

Chạy thật: `chay.bat` / `bash chay.sh` (dùng Claude Code đã đăng nhập trên máy).

## Nối với Claude thật

1. **Thấy mọi phiên ngay tức thì:** chạy `node tools/cai-hooks.js` để xem sẽ đổi gì, rồi `node tools/cai-hooks.js --ghi`. Lệnh này thêm hooks vào `~/.claude/settings.json` và sao lưu bản cũ; gỡ ra bằng `--go`. Không cài hooks thì game vẫn thấy phiên qua nhật ký, chỉ chậm hơn vài giây.
2. **Đội của làng:** chép `claude-template/` vào thư mục làm việc của đội. Bản chép gồm `CLAUDE.md` cho Calm, `.claude/settings.json` (hooks và rào an toàn) và `.claude/town/board.js`. Sau đó điền `"teamDir"` vào `town.config.json`.
3. **Dựng làng từ dự án:** ở bảng thử, mở "Dựng làng từ mô tả dự án", dán bản mô tả rồi bấm Dựng làng.
4. **Cấu hình máy** (tuỳ chọn): chép `cau-hinh.mau.json` thành `~/.game-town/cau-hinh.json`. Ở đây bạn chọn cách chạy Claude (`cli` / `sdk` / `mock`), bộ tóm tắt, ngân sách, tên dự án…

## Lõi làm được gì

| Phần | Làm gì | Học từ |
|---|---|---|
| Dân cư | Thấy mọi phiên Claude trên máy (CLI, app desktop, nhiều bản app). Chấm 5 trạng thái: chờ bạn · đang làm · xong cần xem · rảnh · đã đóng | van-phong-claude |
| "Chờ bạn" không sót | Xin quyền, AskUserQuestion chưa trả lời, lượt cuối bị chặn hoặc kết bằng câu hỏi, khối `game` | cả hai |
| Hooks tức thời | Bong bóng tiếng Việt, giao việc có mã (GT-001), cảnh bàn giao giữa các nhà | hyanaitown |
| Duyệt trong game | Giữ xin quyền 60 giây chờ bạn bấm, quá giờ thì Claude Code tự hỏi. Chỉ giữ khi game đang mở | hyanaitown |
| Bảng việc + cổng duyệt | `board.js duyet/hoi --no-wait`, cổng nhan-lam / gop-main / dang-ban | hyanaitown |
| Trả lời mọi phiên | Phiên đang mở thì đẩy thẳng qua ổ cắm; phiên đã đóng thì `claude --resume` | van-phong-claude |
| Phòng Calm | Giao việc, Calm trả lời kèm thẻ phương án, bấm chọn là làm tiếp, có hàng đợi | hyanaitown |
| Dựng làng | Bản mô tả dự án → công trình → việc, tiến độ từng công trình và cả làng | Game Town MVP |
| Tài nguyên thật | Tiền phiên, % ngữ cảnh, cache còn ấm, lượng dùng 5 giờ / 7 ngày, ngân sách tự đặt | van-phong-claude |
| Quản lý | Cất / ẩn có hoàn tác, dọn cả làng, màn hình lưu sẵn, tóm tắt có cache, bản bàn giao, compact, mở đúng phiên | van-phong-claude |
| Ba cách chạy Claude | Claude Code CLI · Agent SDK (API key) · chế độ thử | Game Town MVP |
| An toàn | Chỉ nghe 127.0.0.1, kiểm Host/Origin, lệnh ghi cần header riêng, chỉ đọc file của Claude | van-phong-claude |
| Tự chạy | Demo bằng đúng sự kiện hooks thật | hyanaitown |

## Cấu trúc

```
core/            lõi (server.js là cửa vào)
  phien.js       tìm và chấm trạng thái phiên
  dan-cu.js      danh sách dân cư, đánh dấu, tóm tắt, tài nguyên
  lang.js        đội, hooks, xin quyền, bảng việc, nhật ký
  hanh-dong.js   trả lời, mở phiên, bàn giao, compact
  phong-calm.js  phòng Calm
  cong-trinh.js  dựng làng, giao việc theo công trình
  chay-claude.js chạy Claude (cli / sdk / mock)
  tai-nguyen.js  giá, tiền, ngữ cảnh, cache, vòng 5 giờ / 7 ngày
  ngon-ngu.js    câu tiếng Việt cho công cụ, khối game
  ws.js          WebSocket cho Godot
bang-thu/        bảng thử (không phải giao diện game)
claude-template/ mẫu cho thư mục đội
tools/cai-hooks.js
docs/API.md      giao kèo cho phần hình
test/            kiểm thử với máy giả: npm test
```

## Dữ liệu

Lõi chỉ **đọc** file Claude tự ghi. Lõi chỉ **ghi** vào `~/.game-town/` (bảng việc, nhật ký, đánh dấu, tóm tắt, phòng Calm, làng). Có một ngoại lệ: `tools/cai-hooks.js`, và lệnh này chỉ chạy khi bạn gõ.

Ghi công: xem [NOTICE.md](NOTICE.md).
