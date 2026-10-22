#!/usr/bin/env bash
# Chạy lõi Game Town. Thêm --thu để dùng chế độ thử (không gọi Claude thật).
cd "$(dirname "$0")"
[ "$1" = "--thu" ] && export GT_RUNNER=mock
( sleep 1; (command -v open >/dev/null && open http://127.0.0.1:4545) || (command -v xdg-open >/dev/null && xdg-open http://127.0.0.1:4545) ) >/dev/null 2>&1 &
exec node core/server.js
