'use strict';
// Dashboard locale per monitorare l'avanzamento dei 3 scraper ciclismo.info
// in corso (risultati, dewatermark, foto gara) senza dover chiedere ogni
// volta lo stato in chat. Legge i log già scritti dagli scraper stessi,
// nessuna dipendenza esterna (solo moduli nativi Node).
//
// Uso: node scraper-status-server.js
// Poi apri http://localhost:4545 nel browser.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4545;

// Percorsi dei log. Quello dello scraper gare (risultati) è il file di
// output del task in background lanciato da Claude Code in questa sessione
// — se in una sessione futura il task cambia id, basta aggiornare questo
// percorso qui sotto.
const LOGS = {
  risultati: {
    label: 'Risultati (colmatura buchi)',
    file: path.join(__dirname, 'gara_scraper_resume.log'),
    // Righe tipo: (2822/17348) 62 COPPA SAN SABINO [2013]: +4 posizioni recuperate
    re: /\((\d+)\/(\d+)\)/g,
  },
  dewatermark: {
    label: 'Dewatermark foto',
    file: path.join(__dirname, 'dewatermark_resume.log'),
    // Righe tipo: ... 3875/5242 gare | foto rifatte: 923 | errori: 2
    re: /\.\.\.\s*(\d+)\/(\d+) gare/g,
  },
  foto: {
    label: 'Foto gara (nuove)',
    file: path.join(__dirname, 'gara_media_resume.log'),
    // Righe tipo: (604/30477) 23 TROFEO P AVOGARO [2017] …
    re: /\((\d+)\/(\d+)\)/g,
  },
};

// Storico dei campioni (in memoria, si resetta se il dashboard riparte) per
// calcolare una velocità media e stimare il tempo restante.
const history = { risultati: [], dewatermark: [], foto: [] };
const MAX_HISTORY = 30;

function readProgress(key, cfg) {
  let text = '';
  try { text = fs.readFileSync(cfg.file, 'utf8'); }
  catch { return { ok: false, error: 'log non trovato (script fermo o mai avviato)' }; }

  let last = null, m;
  cfg.re.lastIndex = 0;
  while ((m = cfg.re.exec(text))) last = m;
  if (!last) return { ok: false, error: 'nessun progresso ancora nel log' };

  const current = parseInt(last[1], 10);
  const total = parseInt(last[2], 10);
  const done = /\n=== FATTO ===|\[exited with code 0\]/.test(text.slice(-400));
  const errored = /\[exited with code 1\]|ERRORE FATALE/.test(text.slice(-400)) && !done;

  const now = Date.now();
  const hist = history[key];
  hist.push({ t: now, n: current });
  while (hist.length > MAX_HISTORY) hist.shift();

  let ratePerMin = null, etaMin = null;
  if (hist.length >= 2) {
    const first = hist[0], lastS = hist[hist.length - 1];
    const dtMin = (lastS.t - first.t) / 60000;
    const dn = lastS.n - first.n;
    if (dtMin > 0.2 && dn > 0) {
      ratePerMin = dn / dtMin;
      const remaining = total - current;
      etaMin = remaining / ratePerMin;
    }
  }

  return { ok: true, current, total, pct: total ? Math.round((current / total) * 1000) / 10 : 0, done, errored, ratePerMin, etaMin };
}

function fmtEta(mins) {
  if (mins == null) return '—';
  if (mins < 1) return '<1 min';
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  if (h === 0) return `${m} min`;
  return `${h}h ${m}min`;
}

function buildStatus() {
  const out = {};
  for (const [key, cfg] of Object.entries(LOGS)) out[key] = { label: cfg.label, ...readProgress(key, cfg) };
  return out;
}

const PAGE = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>Scraper ICS — stato</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; padding: 40px 20px;
    background: #0b0d12; color: #e8eaed;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .wrap { max-width: 780px; margin: 0 auto; }
  h1 { font-size: 1.5rem; font-weight: 800; margin: 0 0 4px; }
  .sub { color: #8a8f98; font-size: .88rem; margin-bottom: 32px; }
  .card {
    background: #14171e; border: 1px solid #232734; border-radius: 14px;
    padding: 22px 24px; margin-bottom: 16px;
  }
  .card-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; }
  .card-title { font-weight: 700; font-size: 1.05rem; }
  .card-pct { font-weight: 800; font-size: 1.3rem; font-variant-numeric: tabular-nums; }
  .bar-track { height: 10px; border-radius: 6px; background: #1f2330; overflow: hidden; margin-bottom: 14px; }
  .bar-fill { height: 100%; border-radius: 6px; background: linear-gradient(90deg,#ff6b00,#ff9a3c); transition: width .4s ease; }
  .bar-fill.done { background: linear-gradient(90deg,#22c55e,#4ade80); }
  .bar-fill.error { background: linear-gradient(90deg,#ef4444,#f87171); }
  .stats { display: flex; gap: 24px; flex-wrap: wrap; font-size: .82rem; color: #a8adba; }
  .stats b { color: #e8eaed; font-variant-numeric: tabular-nums; }
  .status-tag {
    display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: .72rem;
    font-weight: 700; text-transform: uppercase; letter-spacing: .03em;
  }
  .status-tag.running { background: rgba(255,107,0,0.15); color: #ff9a3c; }
  .status-tag.done { background: rgba(34,197,94,0.15); color: #4ade80; }
  .status-tag.error { background: rgba(239,68,68,0.15); color: #f87171; }
  .empty { color: #8a8f98; font-size: .88rem; }
  footer { text-align: center; color: #5a5f6b; font-size: .75rem; margin-top: 28px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🚴 Scraper ciclismo.info — stato live</h1>
  <div class="sub">Aggiornamento automatico ogni 8 secondi · <span id="clock"></span></div>
  <div id="cards"></div>
  <footer>italiacrit · dashboard locale, non pubblica</footer>
</div>
<script>
function fmtEta(mins) {
  if (mins == null) return '—';
  if (mins < 1) return '&lt;1 min';
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  if (h === 0) return m + ' min';
  return h + 'h ' + m + 'min';
}
function render(data) {
  const cardsEl = document.getElementById('cards');
  cardsEl.innerHTML = Object.values(data).map(s => {
    if (!s.ok) {
      return '<div class="card"><div class="card-head"><div class="card-title">' + s.label + '</div></div><div class="empty">' + s.error + '</div></div>';
    }
    const tag = s.done ? '<span class="status-tag done">Finito</span>' : s.errored ? '<span class="status-tag error">Fermo</span>' : '<span class="status-tag running">In corso</span>';
    const barClass = s.done ? 'done' : s.errored ? 'error' : '';
    return '<div class="card">' +
      '<div class="card-head"><div class="card-title">' + s.label + ' ' + tag + '</div><div class="card-pct">' + s.pct + '%</div></div>' +
      '<div class="bar-track"><div class="bar-fill ' + barClass + '" style="width:' + s.pct + '%"></div></div>' +
      '<div class="stats">' +
        '<span><b>' + s.current.toLocaleString('it-IT') + '</b> / ' + s.total.toLocaleString('it-IT') + '</span>' +
        '<span>Velocità: <b>' + (s.ratePerMin ? s.ratePerMin.toFixed(1) : '—') + '</b> /min</span>' +
        '<span>Stima rimanente: <b>' + fmtEta(s.etaMin) + '</b></span>' +
      '</div>' +
    '</div>';
  }).join('');
}
async function tick() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('it-IT');
  try {
    const r = await fetch('/api/status');
    render(await r.json());
  } catch (e) { /* server locale non raggiungibile, riprova al prossimo giro */ }
}
tick();
setInterval(tick, 8000);
</script>
</body>
</html>`;

http.createServer((req, res) => {
  if (req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(buildStatus()));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(PAGE);
}).listen(PORT, () => {
  console.log(`Dashboard scraper su http://localhost:${PORT}`);
});
