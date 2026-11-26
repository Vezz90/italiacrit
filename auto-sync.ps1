# auto-sync.ps1 — fetch + commit + push automatico per italiacrit
# Registrato come Windows Scheduled Task (ogni 30 minuti)

$repo = "C:\Users\vezza\.gemini\antigravity\scratch\italiacrit"
$log  = "$repo\auto-sync.log"

function Log($msg) { Add-Content $log "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg" }

Set-Location $repo

# Se c'e' un'operazione git lasciata a meta', o non si e' su main, non si tocca nulla: va sistemata a mano
if ((Test-Path .git\rebase-merge) -or (Test-Path .git\rebase-apply) -or (Test-Path .git\MERGE_HEAD)) {
    Log "FERMO: c'e' un rebase o un merge a meta' nella cartella, la pubblicazione automatica e' sospesa"
    exit 1
}
$branch = git branch --show-current
if ($branch -ne 'main') { Log "FERMO: la cartella non e' sul ramo main ($branch)"; exit 1 }

git fetch -q origin 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Log "ERRORE: fetch non riuscito"; exit 1 }

# 1) commit delle modifiche locali
if (git status --porcelain) {
    git add -A 2>&1 | Out-Null
    $rotti = git diff --cached --name-only -G "^(<<<<<<< |>>>>>>> )"
    if ($rotti) { git reset -q; Log "FERMO: segni di conflitto non risolto in $($rotti -join ', ')"; exit 1 }
    git commit -q -m "auto: aggiornamento $(Get-Date -Format 'dd/MM/yyyy HH:mm')" 2>&1 | Out-Null
}

# 2) allineamento con il sito: se qualcun altro ha pubblicato, i commit locali si rimettono sopra
$behind = [int](git rev-list --count HEAD..origin/main)
$ahead  = [int](git rev-list --count origin/main..HEAD)
if ($behind -gt 0) {
    if ($ahead -eq 0) { $out = git merge -q --ff-only origin/main 2>&1 } else { $out = git rebase -q origin/main 2>&1 }
    if ($LASTEXITCODE -ne 0) {
        if ($ahead -gt 0) { git rebase --abort 2>&1 | Out-Null }
        Log "ERRORE allineamento (conflitto da risolvere a mano): $out"
        exit 1
    }
    Log "pull: $behind commit recenti da remote"
}

# 3) pubblicazione
if ($ahead -gt 0) {
    $push = git push -q origin main 2>&1
    if ($LASTEXITCODE -eq 0) { Log "push OK ($ahead commit)" } else { Log "ERRORE push: $push"; exit 1 }
}
