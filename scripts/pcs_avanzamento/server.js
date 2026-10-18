#!/usr/bin/env node
/**
 * Cruscotto locale dei lavori PCS: retry profili, raccolta squadre, controllo gare pro, recupero anni, foto.
 *   node scripts/pcs_avanzamento/server.js     poi apri http://localhost:8770
 * Sola lettura: legge i registri in server/ e server/logs/. Nessuna dipendenza.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..', 'server'), LOGS = path.join(ROOT, 'logs');
const PORT = 8770;

const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch (_) { return ''; } };
const mtime = f => { try { return fs.statSync(f).mtimeMs; } catch (_) { return 0; } };
const lines = (f, n = 8) => read(f).split(/\r?\n/).filter(Boolean).slice(-n);
const newest = (dir, re) => { try { return fs.readdirSync(dir).filter(x => re.test(x)).map(x => path.join(dir, x)).sort((a, b) => mtime(b) - mtime(a))[0] || ''; } catch (_) { return ''; } };
const lastProgress = txt => { const m = (txt.match(/\((\d+)\/(\d+)\)/g) || []).pop(), mm = m && m.match(/\((\d+)\/(\d+)\)/); return mm ? { done: +mm[1], total: +mm[2] } : { done: 0, total: 0 }; };

// ogni lavoro ha: titolo, file di registro e una funzione che ricava i numeri dal testo
function logJob(title, file, parse) {
  const txt = read(file), t = mtime(file);
  const base = { title, file: path.basename(file || ''), updated: t, running: !!t && Date.now() - t < 4 * 60e3, last: lines(file) };
  return Object.assign(base, parse(txt));
}

function retry() {
  return logJob('Collegamento profili a PCS (retry)', path.join(ROOT, '_retry-full.log'), txt => {
    const found = (txt.match(/→ [^\s]+ ✓/g) || []).length, none = (txt.match(/: non su PCS/g) || []).length;
    const warn = (txt.match(/scartato|candidati possibili/g) || []).length;
    return { ...lastProgress(txt), stats: [['collegati', found], ['non su PCS', none], ['omonimi scartati/dubbi', warn]] };
  });
}
function teams() {
  let data = {}; try { data = JSON.parse(read(path.join(ROOT, 'pcs-teams-harvest.json'))); } catch (_) {}
  const c = Object.values(data).reduce((a, d) => (a[d.status] = (a[d.status] || 0) + 1, a), {});
  return logJob('Squadre da PCS (rose e anni)', path.join(ROOT, '_team-test.log'), txt => {
    const p = lastProgress(txt), tot = p.total || +((txt.match(/da fare: (\d+)/) || [])[1] || 0);
    return { done: p.done, total: tot, stats: [['trovate', c.ok || 0], ['non su PCS', c['non trovata'] || 0]] };
  });
}
function proOggi() {
  const f = path.join(LOGS, 'pcs-pro-oggi.log'), oggi = new Date().toLocaleDateString('it-IT');
  const n = read(f).split(/\r?\n/).filter(l => l.includes('[' + oggi)).length;
  const r = logJob('Gare pro: controllo ogni 30 minuti', f, () => ({ done: 0, total: 0, stats: [['controlli oggi', n]] }));
  r.running = !!mtime(f) && Date.now() - mtime(f) < 70 * 60e3;
  return r;
}
function fillGaps() {
  let p = null; try { p = JSON.parse(read(path.join(LOGS, 'fillgaps-progress.json'))); } catch (_) {}
  const r = logJob('Recupero degli anni mancanti', newest(LOGS, /^pcs-fillgaps-run.*\.log$/), () => p ? ({ done: p.yearsDone, total: p.yearsTotal, stats: [['anni con risultati', p.yearsWithResults], ['anni vuoti', p.yearsEmpty], ['falliti', p.yearsFailed], ['righe salvate', p.rows]] }) : { done: 0, total: 0, stats: [] });
  if (p) r.running = !p.finished && Date.now() - Date.parse(p.updated) < 4 * 60e3;
  return r;
}
function photos() {
  const f = path.join(ROOT, 'pcs-photo-refresh-state.json'); let n = 0; try { n = Object.keys(JSON.parse(read(f))).length; } catch (_) {}
  return { title: 'Foto profilo da PCS', file: 'pcs-photo-refresh-state.json', updated: mtime(f), running: false, last: [], done: 0, total: 0, stats: [['profili controllati', n]] };
}

function payload() {
  const jobs = [retry(), teams(), fillGaps(), proOggi(), photos()];
  const b = mtime(path.join(ROOT, 'pcs-blocked.flag'));
  return { now: Date.now(), jobs, blocked: b && Date.now() - b < 6 * 3600e3 ? b : null };
}

const HTML = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Avanzamento PCS</title>
<style>
:root{--bg:#0d1520;--card:#142133;--line:#223552;--tx:#e6edf6;--mut:#8aa0ba;--run:#4aa3ff;--bad:#ef5a5a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.45 system-ui,Segoe UI,sans-serif;padding:20px;max-width:1100px;margin-inline:auto}
h1{font-size:1.25rem;margin:0 0 4px}.sub{color:var(--mut);margin-bottom:18px;font-size:.85rem}
.banner{background:#3a1d1d;border:1px solid var(--bad);color:#ffd3d3;padding:10px 14px;border-radius:8px;margin-bottom:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;min-width:0}
.hd{display:flex;align-items:center;gap:10px;margin-bottom:8px}.hd b{font-size:1rem}
.pill{font-size:.72rem;padding:2px 9px;border-radius:99px;border:1px solid var(--line);color:var(--mut)}
.pill.run{color:var(--run);border-color:var(--run)}
.bar{height:9px;background:#0b1320;border-radius:99px;overflow:hidden;margin:6px 0 4px}.bar i{display:block;height:100%;background:var(--run);transition:width .5s}
.num{display:flex;justify-content:space-between;color:var(--mut);font-size:.8rem}
.stats{display:flex;flex-wrap:wrap;gap:6px 18px;margin:10px 0}.stats b{display:block;font-size:1.15rem;font-variant-numeric:tabular-nums}.stats span{color:var(--mut);font-size:.75rem}
pre{margin:8px 0 0;background:#0b1320;border-radius:7px;padding:8px 10px;font:11.5px/1.5 ui-monospace,Consolas,monospace;color:#b9c8da;overflow:auto;max-height:150px;white-space:pre-wrap}
.age{color:var(--mut);font-size:.75rem}
</style></head><body>
<h1>Avanzamento PCS</h1><div class="sub" id="sub">caricamento…</div><div id="ban"></div><div class="grid" id="g"></div>
<script>
const ago=ms=>{if(!ms)return'mai';const s=Math.round((Date.now()-ms)/1000);return s<90?s+' s fa':s<5400?Math.round(s/60)+' min fa':Math.round(s/3600)+' h fa'};
const esc=t=>String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;');
async function tick(){
 try{const r=await (await fetch('/api?'+Date.now())).json();
  document.getElementById('sub').textContent='aggiornato '+new Date(r.now).toLocaleTimeString('it-IT')+' · si rinnova ogni 5 secondi';
  document.getElementById('ban').innerHTML=r.blocked?'<div class="banner">PCS ha bloccato '+ago(r.blocked)+': i controlli automatici sono in pausa.</div>':'';
  document.getElementById('g').innerHTML=r.jobs.map(j=>{
   const pc=j.total?Math.min(100,Math.round(j.done/j.total*100)):0;
   return '<div class="card"><div class="hd"><b>'+j.title+'</b><span class="pill '+(j.running?'run':'')+'">'+(j.running?'in corso':'ferma')+'</span></div>'
   +(j.total?'<div class="bar"><i style="width:'+pc+'%"></i></div><div class="num"><span>'+j.done.toLocaleString('it-IT')+' / '+j.total.toLocaleString('it-IT')+'</span><span>'+pc+'%</span></div>':'')
   +'<div class="stats">'+j.stats.map(s=>'<div><b>'+Number(s[1]).toLocaleString('it-IT')+'</b><span>'+s[0]+'</span></div>').join('')+'</div>'
   +'<div class="age">ultimo aggiornamento '+ago(j.updated)+'</div>'
   +(j.last.length?'<pre>'+j.last.map(esc).join('\\n')+'</pre>':'')+'</div>'}).join('');
 }catch(e){document.getElementById('sub').textContent='server non raggiungibile'}
}
tick();setInterval(tick,5000);
</script></body></html>`;

http.createServer((req, res) => {
  if (req.url.startsWith('/api')) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify(payload())); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(HTML);
}).listen(PORT, '127.0.0.1', () => console.log(`Avanzamento PCS: http://localhost:${PORT}`));
