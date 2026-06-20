@echo off
cd /d "%~dp0server"
:: Legge SUPABASE_SECRET da .env.local
for /f "usebackq tokens=1,* delims==" %%A in (".env.local") do (
  if /i "%%A"=="SUPABASE_SECRET" set SUPABASE_SECRET=%%B
)
if "%SUPABASE_SECRET%"=="" (
  echo ERRORE: SUPABASE_SECRET non trovato in server\.env.local
  pause & exit /b 1
)
echo Importazione loghi e social TEAM (PCS + First Cycling in parallelo, PCS prioritario).
echo Salta i team che hanno gia un logo. Usa --force per reimportare tutto.
echo.
node run-import.js --teams
pause
