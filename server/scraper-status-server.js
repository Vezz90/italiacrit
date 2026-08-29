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
  pcsStorico: {
    label: 'PCS storico — principale (2007→oggi)',
    file: path.join(__dirname, 'pcs_storico_full.log'),
    // Righe tipo: (123/16214) COGNOME Nome [slug] … ✓ ...
    re: /\((\d+)\/(\d+)\)/g,
  },
  fillGaps: {
    label: 'PCS storico — colma buchi (anni mancanti)',
    file: path.join(__dirname, 'pcs_fillgaps.log'),
    re: /\((\d+)\/(\d+)\)/g,
  },
  fixTeamHistory: {
    label: 'PCS storico — squadre vuote (bug selettore)',
    file: path.join(__dirname, 'pcs_fix_teamhistory.log'),
    re: /\((\d+)\/(\d+)\)/g,
  },
  ciclismoRefill: {
    label: 'ciclismo.info — recupero piazzamenti persi (bug parser)',
    file: path.join(__dirname, 'ciclismo_refill_missed.log'),
    // Righe tipo: [7600/52394] pagine ok, righe upsertate finora: 56295, ...
    re: /\[(\d+)\/(\d+)\]/g,
  },
};

// Storico dei campioni (in memoria, si resetta se il dashboard riparte) per
// calcolare una velocità media e stimare il tempo restante.
const history = { pcsStorico: [], fillGaps: [], fixTeamHistory: [], ciclismoRefill: [] };
const lastTotal = { pcsStorico: null, fillGaps: null, fixTeamHistory: null, ciclismoRefill: null };
const MAX_HISTORY = 30;

function readProgress(key, cfg) {
  let text = '';
  try { text = fs.readFileSync(cfg.file, 'utf8'); }
  catch { return { ok: false, error: 'log non trovato (script fermo o mai avviato)' }; }

  // Il MASSIMO visto nel file, non l'ultima riga — con più elementi in
  // parallelo (--concurrency), uno più lento può finire e scrivere la sua
  // riga di log DOPO uno più veloce partito più tardi, quindi l'ultima riga
  // del file a volte mostra un numero più basso di uno già visto poco prima.
  // Prendendo solo l'ultima riga, questo veniva letto come "riavvio" (il
  // contatore torna indietro) e resettava lo storico ad ogni giro, dando una
  // stima di velocità/tempo rimanente ballerina (osservato dal vivo).
  let current = null, total = null, m;
  cfg.re.lastIndex = 0;
  while ((m = cfg.re.exec(text))) {
    const n = parseInt(m[1], 10);
    if (current === null || n > current) { current = n; total = parseInt(m[2], 10); }
  }
  if (current === null) return { ok: false, error: 'nessun progresso ancora nel log' };
  const done = /\n=== FATTO ===|\n=== Completato ===|\[exited with code 0\]/.test(text.slice(-400));
  const errored = /\[exited with code 1\]|ERRORE FATALE/.test(text.slice(-400)) && !done;

  const now = Date.now();
  const hist = history[key];
  // Uno script rilanciato (log troncato, totale diverso o contatore tornato
  // indietro) rende inutilizzabili i campioni precedenti — altrimenti la
  // velocità restava "—" per minuti finché i vecchi campioni non uscivano
  // dalla finestra, o peggio usciva un delta negativo (osservato dal vivo
  // dopo il riavvio dei due scraper per il fix del timeout di rete).
  const restarted = lastTotal[key] != null && (lastTotal[key] !== total || (hist.length && current < hist[hist.length - 1].n));
  if (restarted) hist.length = 0;
  lastTotal[key] = total;
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

// Avanzamento per anno dello scraper PCS storico (dal 2025 a scendere fino
// al 2007, vedi pcs-athlete-import-storico.js) — il log dà solo un indice
// globale (123/16619), non l'anno di chi si sta processando ora. Il file
// pcs_storico_year_breakdown.json (generato a parte con
// pcs-storico-year-breakdown.js, rilancialo per aggiornarlo) elenca quanti
// atleti hanno ciascun anno come "ultimo noto" e a quale intervallo di
// indici corrispondono, nell'ordine in cui lo scraper li visita davvero.
// Il totale calcolato lì può differire leggermente da quello nel log (il
// database continua a crescere mentre entrambi girano) — riscalato in
// proporzione così le barre restano sensate anche con un po' di deriva.
function readYearBreakdown(current, liveTotal) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'pcs_storico_year_breakdown.json'), 'utf8')); }
  catch { return null; }
  if (!raw?.breakdown?.length) return null;
  const scale = (liveTotal && raw.totalAtleti) ? liveTotal / raw.totalAtleti : 1;
  const currentUnscaled = scale ? current / scale : current;
  return raw.breakdown.map(b => {
    const doneInBucket = Math.max(0, Math.min(b.count, Math.round(currentUnscaled - b.startIndex + 1)));
    return { year: b.year, count: b.count, done: doneInBucket, pct: b.count ? Math.round((doneInBucket / b.count) * 1000) / 10 : 0 };
  });
}

function buildStatus() {
  const out = {};
  for (const [key, cfg] of Object.entries(LOGS)) out[key] = { label: cfg.label, ...readProgress(key, cfg) };
  if (out.pcsStorico?.ok) out.pcsStorico.byYear = readYearBreakdown(out.pcsStorico.current, out.pcsStorico.total);
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
  .years { display: flex; flex-direction: column; gap: 5px; margin-top: 16px; padding-top: 14px; border-top: 1px solid #232734; }
  .year-row { display: grid; grid-template-columns: 44px 1fr 70px; align-items: center; gap: 10px; font-size: .74rem; }
  .year-row .yr { color: #a8adba; font-variant-numeric: tabular-nums; }
  .year-row .ybar-track { height: 6px; border-radius: 4px; background: #1f2330; overflow: hidden; }
  .year-row .ybar-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg,#ff6b00,#ff9a3c); transition: width .4s ease; }
  .year-row .ybar-fill.done { background: linear-gradient(90deg,#22c55e,#4ade80); }
  .year-row .ycount { color: #6b7280; text-align: right; font-variant-numeric: tabular-nums; }
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
    const yearsHtml = (s.byYear && s.byYear.length) ? (
      '<div class="years">' +
      s.byYear.map(y => {
        const yDone = y.pct >= 100;
        return '<div class="year-row">' +
          '<div class="yr">' + y.year + '</div>' +
          '<div class="ybar-track"><div class="ybar-fill' + (yDone ? ' done' : '') + '" style="width:' + y.pct + '%"></div></div>' +
          '<div class="ycount">' + y.done.toLocaleString('it-IT') + ' / ' + y.count.toLocaleString('it-IT') + '</div>' +
        '</div>';
      }).join('') +
      '</div>'
    ) : '';
    return '<div class="card">' +
      '<div class="card-head"><div class="card-title">' + s.label + ' ' + tag + '</div><div class="card-pct">' + s.pct + '%</div></div>' +
      '<div class="bar-track"><div class="bar-fill ' + barClass + '" style="width:' + s.pct + '%"></div></div>' +
      '<div class="stats">' +
        '<span><b>' + s.current.toLocaleString('it-IT') + '</b> / ' + s.total.toLocaleString('it-IT') + '</span>' +
        '<span>Velocità: <b>' + (s.ratePerMin ? s.ratePerMin.toFixed(1) : '—') + '</b> /min</span>' +
        '<span>Stima rimanente: <b>' + fmtEta(s.etaMin) + '</b></span>' +
      '</div>' +
      yearsHtml +
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
