@echo off
echo Avvio server ItaliacritAuth su http://localhost:8002
cd /d "%~dp0"
set NODE_TLS_REJECT_UNAUTHORIZED=0
node server.js
pause
