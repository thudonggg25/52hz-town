@echo off
chcp 65001 >nul
cd /d "%~dp0"
set GT_RUNNER=mock
start "" http://127.0.0.1:4545
node core\server.js
pause
