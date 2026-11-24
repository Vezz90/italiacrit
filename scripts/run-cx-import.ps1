# Import automatico del CICLOCROSS da federciclismo.it (task "ItaliaCrit-CX-Import", ogni giorno alle 6:45, tutto l'anno come la strada).
# La stagione ciclocross va da settembre a gennaio e si chiama "2026/27" (cambio il 1 luglio), ma il controllo gira sempre:
# fuori stagione trova poche gare e non cambia nulla; a luglio-agosto prende il calendario della nuova stagione.
# Rilegge i risultati solo delle gare recenti (le vecchie restano quelle gia' salvate). I file vanno in data/ciclocross/
# e li pubblica l'auto-sync (italiacrit-auto-sync) insieme al resto.
$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo
$logDir = Join-Path $repo "server\logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir ("cx-import-" + (Get-Date -Format "yyyy-MM-dd_HHmm") + ".log")
& python "scraper\cx_import.py" *> $logFile
Get-ChildItem $logDir -Filter "cx-import-*.log" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 14 | Remove-Item -Force
