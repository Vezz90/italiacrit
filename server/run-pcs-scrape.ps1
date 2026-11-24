# Rilancio dello scraper PCS atleti — ogni 2 giorni (task "ItaliaCrit-PCS-Scrape",
# prima era settimanale ma un'intera passata su ~2100 atleti richiede circa
# 20-24h (ritardo umano ~40s/atleta): con cadenza settimanale e un limite di
# esecuzione di 6h il task veniva ucciso a circa 1/4 della lista ogni volta,
# quindi la coda (in ordine alfabetico/per team) non veniva MAI raggiunta.
# Il limite di esecuzione è stato rimosso (nessun timeout) e la cadenza
# portata a 2 giorni, che lascia margine per completare l'intera passata.
# Foto/social vengono saltati se già presenti, ma i risultati vengono SEMPRE
# ricontrollati per intercettare nuovi piazzamenti/vittorie all'estero.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$env:NODE_EXTRA_CA_CERTS = Join-Path $PSScriptRoot "norton-root.pem"

$stamp   = Get-Date -Format "yyyy-MM-dd_HHmm"
$logDir  = Join-Path $PSScriptRoot "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir "pcs-scrape-$stamp.log"

# Di norma solo gli atleti attivi (--only-active: salta i verosimilmente
# ritirati, vedi classifyActivity in pcs-athlete-import.js). Ogni ~180 giorni
# giro COMPLETO senza filtro, come rete di sicurezza per chi fosse sfuggito
# (data dell'ultimo giro completo in logs\last-full-scrape.txt).
$fullMarker = Join-Path $PSScriptRoot "logs\last-full-scrape.txt"
$fullDue = $false
if (Test-Path $fullMarker) { $fullDue = ((Get-Date) - (Get-Item $fullMarker).LastWriteTime).TotalDays -ge 180 }
if ($fullDue) {
    & node "pcs-athlete-import.js" --include-phantoms *> $logFile
    Set-Content -Path $fullMarker -Value (Get-Date -Format "o")
} else {
    & node "pcs-athlete-import.js" --include-phantoms --only-active *> $logFile
}

# Tiene solo gli ultimi 20 log (circa 40 giorni di storico con cadenza 2gg)
Get-ChildItem $logDir -Filter "pcs-scrape-*.log" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 20 | Remove-Item -Force
Get-ChildItem $logDir -Filter "pcs-weekly-*.log" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 8 | Remove-Item -Force
