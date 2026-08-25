# Rilancio giornaliero dello scraper "elenco arrivo completo" delle gare PCS
# extra (fuori dal circuito FCI) — task "ItaliaCrit-PCS-RaceFullResults".
# Stesso ritmo prudente (~40s/pagina) dello scraper atleti per non farsi
# bloccare da PCS: una passata completa sulle gare esistenti richiede circa
# 5-6 ore la prima volta, poi solo le gare nuove (poche a settimana).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$stamp   = Get-Date -Format "yyyy-MM-dd_HHmm"
$logDir  = Join-Path $PSScriptRoot "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir "pcs-racefull-$stamp.log"

& node "pcs-race-fullresults-import.js" *> $logFile

# Tiene solo gli ultimi 20 log
Get-ChildItem $logDir -Filter "pcs-racefull-*.log" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 20 | Remove-Item -Force
