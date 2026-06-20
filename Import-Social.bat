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
echo Aggiornamento SOLO social (Instagram, Twitter, Facebook, Strava, sito web)
echo per atleti e team -- le foto NON vengono toccate.
echo Si aprono due tab nel browser (PCS + First Cycling in parallelo).
echo.
node run-import.js --social
pause
