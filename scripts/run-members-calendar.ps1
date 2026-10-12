# Controllo settimanale del calendario Strada contro members.federciclismo.it (task "ItaliaCrit-MembersCalendar", giovedi mattina).
# Aggiunge le gare nuove, toglie quelle sparite/annullate (mai quelle con risultati), poi fa commit + push.
$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo
$logDir = Join-Path $repo "server\logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir ("members-calendar-" + (Get-Date -Format "yyyy-MM-dd_HHmm") + ".log")
& python "scripts\members_calendar_sync.py" --apply *> $logFile
Get-ChildItem $logDir -Filter "members-calendar-*.log" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 12 | Remove-Item -Force
