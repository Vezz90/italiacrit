@echo off
cd /d "%~dp0server"
start "" "http://localhost:8002/#/admin"
node server.js
pause
