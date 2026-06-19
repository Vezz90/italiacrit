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
echo Avvio import PCS (foto + social atleti e team)...
echo Si apre Brave -- non chiuderlo finche non ha finito.
echo.
node run-import.js
pause
