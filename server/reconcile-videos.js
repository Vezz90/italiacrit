'use strict';
// Giro manuale una tantum di _reconcilePendingStageVideos (vedi server.js):
// sposta le dirette caricate in anticipo (chiave sintetica "calId::data" o
// doppioni calendario senza risultati) sul gara_id reale, senza aspettare
// il prossimo scraping automatico. Usa il service key Supabase direttamente
// (stesso livello di fiducia del server), non serve un login admin.

const fs = require('fs');
const path = require('path');

(function loadEnv() {
  const p = path.join(__dirname, '.env.local');
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  });
})();

const SUPABASE_URL = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta SUPABASE_SECRET in server/.env.local'); process.exit(1); }

// REST diretto (PostgREST) invece del client @supabase/supabase-js: evita la
// dipendenza dal modulo realtime, che su Node 20 richiede "ws" non installato
// e non serve per due semplici select+upsert.
const REST_HEADERS = {
  apikey: SUPABASE_SECRET,
  Authorization: `Bearer ${SUPABASE_SECRET}`,
  'Content-Type': 'application/json',
};
async function kvGet(key) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}&select=value`, { headers: REST_HEADERS });
  if (!r.ok) throw new Error(`kv_store read HTTP ${r.status}`);
  const rows = await r.json();
  return rows[0]?.value;
}
async function kvSet(key, value) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?on_conflict=key`, {
    method: 'POST',
    headers: { ...REST_HEADERS, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`kv_store write HTTP ${r.status}: ${await r.text()}`);
}

const DATA_DIR = path.join(__dirname, '..', 'data');
function readDataJson(file) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); } catch { return null; }
}

function _findRealGaraIdForPendingVideo(gid) {
  const idx = gid.lastIndexOf('::');
  if (idx === -1) return null;
  const calId = gid.slice(0, idx);
  const stageDate = gid.slice(idx + 2);
  const tourPrefix = calId.replace(/_\d{4}-\d{2}-\d{2}$/, '');
  const calendar = readDataJson('calendar.json') || [];
  const candidates = calendar.filter(c => c.data === stageDate && c.id.startsWith(tourPrefix));
  if (!candidates.length) return null;
  const resultsRaw = readDataJson('results_raw.json') || [];
  const resultedIds = new Set(resultsRaw.map(r => r.gara_id));
  for (const c of candidates) {
    const withCat = [...resultedIds].find(rid => rid.startsWith(c.id + '_'));
    if (withCat) return withCat;
  }
  return null;
}

function _normVideoName(s) {
  return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ').trim();
}

function _findRealGaraIdForOrphanCalendarVideo(gid) {
  if (gid.includes('::')) return null;
  const calendar = readDataJson('calendar.json') || [];
  const own = calendar.find(c => c.id === gid);
  if (!own) return null;
  const resultsRaw = readDataJson('results_raw.json') || [];
  const resultedIds = new Set(resultsRaw.map(r => r.gara_id));
  if ([...resultedIds].some(rid => rid === gid || rid.startsWith(gid + '_'))) return null;
  const ownWords = new Set(_normVideoName(own.nome).split(' ').filter(w => w.length > 4));
  if (!ownWords.size) return null;
  let best = null, bestScore = 0;
  for (const c of calendar) {
    if (c.id === gid || c.data !== own.data) continue;
    const withCat = [...resultedIds].find(rid => rid.startsWith(c.id + '_'));
    if (!withCat) continue;
    const cWords = new Set(_normVideoName(c.nome).split(' ').filter(w => w.length > 4));
    let score = 0;
    for (const w of ownWords) if (cWords.has(w)) score++;
    if (score > bestScore) { bestScore = score; best = withCat; }
  }
  return bestScore >= 2 ? best : null;
}

(async () => {
  let videos;
  try { videos = (await kvGet('videos')) || {}; }
  catch (e) { console.error('Errore lettura videos:', e.message); process.exit(1); }
  let changed = false;
  for (const gid of Object.keys(videos)) {
    const realId = gid.includes('::')
      ? _findRealGaraIdForPendingVideo(gid)
      : _findRealGaraIdForOrphanCalendarVideo(gid);
    if (!realId) continue;
    const arr = videos[gid] || [];
    if (!videos[realId]) videos[realId] = [];
    const existingUrls = new Set(videos[realId].map(v => v.url));
    for (const v of arr) { if (!existingUrls.has(v.url)) videos[realId].push(v); }
    delete videos[gid];
    changed = true;
    console.log(`riconciliata: ${gid} -> ${realId}`);
  }
  if (!changed) { console.log('Nessuna diretta da riconciliare.'); process.exit(0); }
  try { await kvSet('videos', videos); }
  catch (e) { console.error('Errore scrittura videos:', e.message); process.exit(1); }
  console.log('Salvato.');
})();
