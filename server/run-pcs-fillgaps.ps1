# Recupero degli anni PCS mancanti (server/pcs-storico-fill-gaps.js), a oltranza: se lo script si ferma (browser chiuso, rete, ecc.) riparte da solo
# da dove era arrivato (gli anni gia' visitati sono in pcs-fillgaps-state.json). Si ferma quando non resta piu' nulla da recuperare.
#   powershell -File server\run-pcs-fillgaps.ps1 [-Workers 2]
param([int]$Workers = 2)
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
$logDir = Join-Path $PSScriptRoot "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
for ($giro = 1; $giro -le 200; $giro++) {
  $stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
  $logFile = Join-Path $logDir "pcs-fillgaps-run-$stamp.log"
  & node "pcs-storico-fill-gaps.js" "--workers=$Workers" *> $logFile
  $codice = $LASTEXITCODE
  $ultima = Get-Content $logFile -Tail 3 -ErrorAction SilentlyContinue | Out-String
  if ($codice -eq 0 -and $ultima -match "Completato" -and $ultima -match "atleti: 0/0") { break }
  Start-Sleep -Seconds 20
}
