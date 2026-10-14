#!/usr/bin/env node
/**
 * Pagina locale con l'avanzamento del recupero PCS (server/pcs-storico-fill-gaps.js).
 *   node scripts/pcs_avanzamento/server.js        poi apri http://localhost:8770
 * Legge server/logs/fillgaps-progress.json (scritto dallo script) e l'ultima parte del log. Nessuna dipendenza, sola lettura.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..', 'server');
const PROGRESS = path.join(ROOT, 'logs', 'fillgaps-progress.json');
const STATE = path.join(ROOT, 'pcs-fillgaps-state.json');
const LOGS = path.join(ROOT, 'logs');
const PORT = 8770;

function lastLog() {
  try {
    const files = fs.readdirSync(LOGS).filter(f => /^pcs-fillgaps-run.*\.log$/.test(f)).map(f => ({ f, t: fs.statSync(path.join(LOGS, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    if (!files.length) return { file: '', lines: [] };
    const txt = fs.readFileSync(path.join(LOGS, files[0].f), 'utf8');
    return { file: files[0].f, lines: txt.split(/\r?\n/).filter(Boolean).slice(-14) };
  } catch (_) { return { file: '', lines: [] }; }
}
function stateCounts() {
  try { const s = JSON.parse(fs.readFileSync(STATE, 'utf8')); const c = { ok: 0, empty: 0, fail: 0 }; for (const v of Object.values(s)) c[v.r] = (c[v.r] || 0) + 1; return c; }
  catch (_) { return null; }
}

http.createServer((req, res) => {
  if (req.url.startsWith('/progress.json')) {
    let p = null; try { p = JSON.parse(fs.readFileSync(PROGRESS, 'utf8')); } catch (_) {}
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ progress: p, log: lastLog(), state: stateCounts(), now: new Date().toISOString() }));
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
}).listen(PORT, '127.0.0.1', () => console.log(`Avanzamento PCS: http://localhost:${PORT}`));
