@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Can cai Node.js 20+ truoc: https://nodejs.org & pause & exit /b 1)
start "" http://127.0.0.1:4545
node core\server.js
pause
