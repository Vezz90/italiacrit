# Rilancio giornaliero dell'import automatico "Tipo Pista su strada" da
# members.federciclismo.it (task "ItaliaCrit-TipoPista-Auto"). I risultati
# non sono garantiti disponibili subito dopo la gara: lo script scansiona
# una finestra mobile di date passate e, per ogni gara ancora senza
# classifiche pubblicate, riprova al giro successivo — senza bisogno di
# nessun intervento manuale. Vedi pista-auto-import.js per i dettagli
# della regola "sicuro da scrivere in automatico" vs "in revisione".
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$stamp   = Get-Date -Format "yyyy-MM-dd_HHmm"
$logDir  = Join-Path $PSScriptRoot "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir "pista-auto-$stamp.log"

& node "pista-auto-import.js" *> $logFile

# Tiene solo gli ultimi 30 log (circa un mese di storico con cadenza giornaliera)
Get-ChildItem $logDir -Filter "pista-auto-*.log" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item -Force
