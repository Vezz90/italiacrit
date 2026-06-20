# auto-sync.ps1 — fetch + commit + push automatico per italiacrit
# Registrato come Windows Scheduled Task (ogni 30 minuti)

$repo = "C:\Users\vezza\.gemini\antigravity\scratch\italiacrit"
$log  = "$repo\auto-sync.log"
$ts   = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Set-Location $repo

# Fetch remoto
git fetch origin 2>&1 | Out-Null

# Controlla se ci sono modifiche da committare
$status = git status --porcelain 2>&1
if (-not $status) {
    # Nessuna modifica locale — controlla solo se siamo indietro sul remote
    $behind = git rev-list --count HEAD..origin/main 2>&1
    if ($behind -gt 0) {
        git pull origin main --ff-only 2>&1 | Out-Null
        Add-Content $log "[$ts] pull: $behind commit recenti da remote"
    }
    exit 0
}

# Commit e push
git add -A 2>&1 | Out-Null
$msg = "auto: aggiornamento $((Get-Date -Format 'dd/MM/yyyy HH:mm'))"
git commit -m $msg 2>&1 | Out-Null
$push = git push origin main 2>&1
$exitCode = $LASTEXITCODE

if ($exitCode -eq 0) {
    Add-Content $log "[$ts] push OK — $msg"
} else {
    Add-Content $log "[$ts] ERRORE push: $push"
}
