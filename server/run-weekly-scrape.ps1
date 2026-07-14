# Rilancio settimanale (martedì) dello scraper PCS atleti.
# Foto/social vengono saltati se già presenti, ma i risultati vengono SEMPRE
# ricontrollati per intercettare nuovi piazzamenti/vittorie all'estero.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$env:NODE_EXTRA_CA_CERTS = Join-Path $PSScriptRoot "norton-root.pem"

$stamp   = Get-Date -Format "yyyy-MM-dd_HHmm"
$logDir  = Join-Path $PSScriptRoot "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir "pcs-weekly-$stamp.log"

& node "pcs-athlete-import.js" --include-phantoms *> $logFile

# Tiene solo gli ultimi 8 log (circa 2 mesi di storico)
Get-ChildItem $logDir -Filter "pcs-weekly-*.log" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 8 | Remove-Item -Force
