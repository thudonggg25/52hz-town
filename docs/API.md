# Giao kèo giữa lõi và phần hình (API)

Lõi Game Town lo **logic**. Phần hình (Godot, web, gì cũng được) chỉ cần:

1. Nối vào lõi ở `127.0.0.1:4545` (WebSocket `/ws` cho Godot, hoặc SSE `/events` cho web).
2. Vẽ theo dữ liệu nhận được.
3. Khi người chơi bấm gì đó, gửi một **hành động**.

Phần hình không bao giờ phải đọc file của Claude hay chạy lệnh nào.

## 1. Nối vào

### Godot (WebSocket)

```gdscript
var ws := WebSocketPeer.new()
func _ready(): ws.connect_to_url("ws://127.0.0.1:4545/ws")
func _process(_d):
    ws.poll()
    while ws.get_available_packet_count() > 0:
        var msg = JSON.parse_string(ws.get_packet().get_string_from_utf8())
        match msg.type:
            "lang": _ve_lang(msg.data)       # đội, bảng việc, xin quyền, nhật ký, tiến độ
            "dan-cu": _ve_dan_cu(msg.data)   # mọi phiên Claude trên máy
            "chat": _phong_calm(msg.data)    # tin mới trong phòng Calm
            "nhat-ky": _them_nhat_ky(msg.data)
            "ket-qua": _ket_qua(msg.id, msg.data)  # trả lời cho hành động bạn gửi
            "loi": push_error(msg.error)            # tin gửi sai
func gui(ten: String, thamSo := {}):
    thamSo["ten"] = ten
    thamSo["id"] = str(Time.get_ticks_msec())
    ws.send_text(JSON.stringify(thamSo))
```

Gửi `{"ten": "trang-thai"}` để xin toàn bộ trạng thái bất cứ lúc nào.

### Web (SSE + fetch)

```js
const es = new EventSource('http://127.0.0.1:4545/events');
es.addEventListener('lang', e => veLang(JSON.parse(e.data)));
es.addEventListener('dan-cu', e => veDanCu(JSON.parse(e.data)));
es.addEventListener('chat', e => phongCalm(JSON.parse(e.data)));
const act = (ten, args) => fetch('/api/hanh-dong', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Game-Town': '1' }, body: JSON.stringify({ ten, ...args }) }).then(r => r.json());
```

Trang web phải được phục vụ từ chính lõi (khai `"giaoDien": "đường/dẫn/thư/mục"` trong cấu hình). Trang ở nơi khác bị chặn để chống trang lạ điều khiển máy bạn.

## 2. Dữ liệu nhận được

### `dan-cu`: mọi phiên Claude (mỗi phiên = một người dân)

```jsonc
{ "at": 0, "hours": 24, "waiting": 1,
  "counts": { "cho": 1, "lam": 2, "xem": 1, "ranh": 0, "nghi": 5 },
  "projects": [ {                      // mỗi dự án = một khu / một làng
    "key": "web-ban-banh", "name": "Web bán bánh", "icon": "🍰", "score": 0,
    "sessions": [ {
      "id": "<mã phiên CLI>", "source": "cli | app", "title": "Sửa lỗi đăng nhập",
      "status": "cho | lam | xem | ranh | nghi",
      "activity": "Sửa login.ts",       // bong bóng khi đang làm
      "needs": "Màu chủ đạo?",          // câu "cần bạn" khi status = cho
      "ask": { "question": "", "options": [{ "label": "", "description": "", "recommended": true }], "progress": 40, "summary": "" },
      "progress": 40, "branch": "tinh-nang-x", "live": true, "routine": "",
      "subs": [{ "id": "", "desc": "", "type": "", "active": true, "at": 0 }], "subActive": 1, "subTotal": 3,
      "usage": { "total": 0.42, "ctx": 51000, "ctxPct": 26, "cache": { "start": 0, "ttl": 3600, "known": true } },
      "mark": null, "reply": null, "lastActivityAt": 0 } ] } ] }
```

Ý nghĩa trạng thái:

| status | Nghĩa | Gợi ý hình |
|---|---|---|
| `cho` | Claude chờ bạn: xin quyền, đang hỏi, lượt cuối bị chặn hoặc kết bằng câu hỏi | giơ tay, dấu `!` đỏ |
| `lam` | đang chạy một lượt | đang làm việc, bong bóng `activity` |
| `xem` | xong lượt mà bạn chưa xem | dấu ✓ vàng |
| `ranh` | đang mở, không chạy | ngồi chơi / đi dạo |
| `nghi` | đã đóng | về nhà ngủ / mờ |

`mark` là `xong` (đã cất lên kệ) hoặc `an` (đã ẩn). Phần hình thường không vẽ những phiên này.

### `lang`: đội trong làng, bảng việc, tiến độ

```jsonc
{ "title": "", "goal": "", "type": "project | routine", "boss": "calm", "waiting": 3, "demo": false,
  "agents": [{ "id": "xuong", "name": "Xưởng", "color": "#f2b134", "home": "xuong", "at": "kiem-tra",
               "state": "idle | working | waiting | done | error", "bubble": "Sửa form", "task": "GT-004", "isBoss": false, "isGuest": false }],
  "buildings": [{ "id": "xuong", "name": "Xưởng", "kind": "xuong", "tasks": [{ "id": "lam", "title": "", "status": "chua | lam | cho | xong | loi", "repeat": "none" }] }],
  "tienDo": { "pct": 50, "buildings": [{ "id": "xuong", "done": 1, "total": 2, "pct": 50, "running": null, "waiting": 0 }] },
  "board": [{ "id": "GT-004", "title": "", "agent": "xuong", "status": "queued | running | waiting_approval | approved | rejected | answered | done | error",
              "gate": "nhan-lam | gop-main | dang-ban", "question": "", "card": { }, "note": "" }],
  "approvals": [{ "id": "Q…", "agent": "xuong", "session": "", "tool": "Bash", "summary": "Chạy lệnh: …", "expiresAt": 0 }],
  "log": [{ "ts": "", "agent": "", "text": "", "kind": "info | start | done | handoff | approval | error | notify" }],
  "calm": { "running": false, "queue": 0, "session": "", "dir": "", "cachChay": "cli" } }
```

- Khi `agent.at` khác `agent.home`, nhân vật đang đi sang nhà khác (cảnh bàn giao). Khoảng 7 giây sau nó tự về.
- `approvals[].expiresAt`: quá mốc này mà bạn chưa bấm thì Claude Code tự hỏi trong cửa sổ của nó.

### `chat`: phòng Calm

- `{"type": "msg", "msg": {"id", "role": "nguoi-dung | calm | step | system | end", "text", "card"?}}`
- `{"type": "status", "status": {...}}`
- `{"type": "step-result", "stepId", "output", "error"}`

`card` có cùng dạng `ask` ở trên: `status, summary, progress, question, options[], allowFreeText, outputs[]`.

## 3. Hành động

Gửi `{"ten": "<tên>", ...tham số}`. REST dùng `POST /api/hanh-dong`, WebSocket thì gửi thẳng.

| Tên | Tham số | Làm gì |
|---|---|---|
| `quyet` | `id, duyet: bool, ghiChu?` | Duyệt / từ chối một yêu cầu xin quyền (`Q…`) hoặc một việc trên bảng |
| `tra-loi-viec` | `id, text, chayTiep?` | Trả lời câu hỏi trên bảng; `chayTiep` thì cho Claude làm tiếp luôn |
| `phien.chi-tiet` | `id` | Chi tiết một phiên: lời cuối, dòng thời gian, tiền, ngữ cảnh. Đồng thời tính là "đã xem" |
| `phien.tra-loi` | `id, text` | Trả lời một phiên bất kỳ: đang mở thì đẩy thẳng vào, đã đóng thì chạy tiếp |
| `phien.mo` | `id` | Mở đúng phiên (app desktop hoặc cửa sổ terminal) |
| `phien.ban-giao` | `id` | Trả `markdown`: bản bàn giao để dán vào phiên mới |
| `phien.compact` | `id` | Compact phiên |
| `phien.tom-tat` | `id, lamLai?` | Tóm tắt bằng model rẻ (cần khai `tomTat`) |
| `phien.danh-dau` | `ids[], kind: "xong" | "an" | null` | Cất / ẩn. Trả `before` để hoàn tác |
| `phien.hoan-tac` | `before` | Hoàn tác lần đánh dấu |
| `phien.don` | `duAn?` | Cất mọi phiên đã đóng (cả làng hoặc một dự án) |
| `man-hinh.luu` | `views[]` | Lưu các bộ lọc có tên |
| `calm.gui` / `calm.chon` | `text` / `label` | Giao việc cho Calm / bấm một phương án |
| `calm.dung` / `calm.moi` / `calm.thu-muc` | `- / - / dir` | Dừng / cuộc trò chuyện mới / đổi thư mục đội |
| `lang.lap` | `moTa` | Dựng làng từ bản mô tả dự án |
| `lang.giao` | `building, task, answer?` | Chạy một việc của công trình |
| `lang.dung` | `building` | Dừng việc đang chạy ở công trình |
| `demo` | `bat: bool` | Tự chạy một vòng mẫu bằng sự kiện hooks thật |

Đọc thêm: `GET /api/tai-nguyen` (tài nguyên), `GET /api/phien/<id>`, `GET /api/bang/<id>`, `GET /api/chat`, `GET /api/ke-hoach`, `GET /api/man-hinh`.

### Tài nguyên (`GET /api/tai-nguyen` hoặc `{"ten": "tai-nguyen"}`)

```jsonc
{ "estimated": { "h5": { "cost": 3.2, "calls": 120, "resetAt": 0 }, "d7": { }, "byModel": { "claude-opus-4-6": { "cost": 1, "calls": 9 } } },
  "gioiHan": { "h5": 20, "d7": 150 },   // ngân sách bạn tự đặt để vẽ thanh
  "external": null }                    // số quota thật nếu bạn khai lệnh "quota"
```

Tiền là **quy đổi theo giá API**, gói đăng ký không trả theo token. Đây là số ước tính, đếm từ nhật ký trên máy này.

## 4. Khối game

Khi lõi tự chạy Claude, nó dặn Claude kết thúc mỗi lượt bằng một khối:

````
```game
{"status": "xong | cho | loi", "summary": "...", "progress": 60, "question": "...", "options": [{"label": "...", "description": "...", "recommended": true}], "allow_free_text": true, "outputs": []}
```
````

Lõi tách khối này ra thành `card` hoặc `ask`, và bỏ nó khỏi chữ hiển thị. Kiểu cũ ```` ```lua-chon ```` của hyanaitown vẫn đọc được.
