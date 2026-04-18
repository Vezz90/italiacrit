@echo off
echo =============================================
echo  ItaliacritResultati - Setup Windows
echo =============================================
echo.
echo [1/3] Installazione dipendenze Python...
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo ERRORE: pip install fallito. Assicurati di avere Python 3.11+ installato.
    pause
    exit /b 1
)

echo.
echo [2/3] Installazione Chromium per Playwright...
playwright install chromium
if %errorlevel% neq 0 (
    echo ERRORE: playwright install fallito.
    pause
    exit /b 1
)

echo.
echo [3/3] Generazione dati seed (demo)...
python scraper/main.py --seed
if %errorlevel% neq 0 (
    echo ATTENZIONE: generazione seed fallita, puoi riprovare manualmente con:
    echo   python scraper/main.py --seed
)

echo.
echo =============================================
echo  Setup completato! Per avviare lo scraper:
echo    python scraper/main.py
echo  Per vedere il sito apri index.html nel browser
echo =============================================
pause
