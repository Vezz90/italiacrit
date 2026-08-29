'use strict';
// Backfill MIRATO per il bug del parser corretto in ciclismo-info-test.js
// (regex "gara ... di Km." che scartava in silenzio ogni piazzamento con un
// descrittore diverso da vuoto/"Linea", es. "In Linea", "A Tappe" — vedi
// commento nel parser). Non riparte da zero come ciclismo-backfill.js:
// riusa esattamente le coppie (ciclismo_id, stagione) GIÀ presenti in
// ciclismo_results (= pagine profilo già visitate con successo in passato),
// ririlegge quella singola pagina col parser corretto e fa upsert di TUTTI i
// piazzamenti trovati — idempotente grazie alla stessa chiave di conflitto
// usata da ciclismo-backfill.js (ciclismo_id,stagione,data,nome_gara): le
// righe già corrette non cambiano, solo quelle mancanti vengono aggiunte.
//
// Uso: node ciclismo-refill-missed-results.js [--limit=N] [--concurrency=N]

(() => {
  const fs = require('fs'), path = require('path');
  const p = path.join(__dirname, '.env.local');
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }
})();

const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const { fetchDecoded, parseAthletePage } = require('./ciclismo-info-test.js');

const SUPABASE_URL = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta SUPABASE_SECRET in server/.env.local'); process.exit(1); }

const LIMIT = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '0', 10) || Infinity;
const CONCURRENCY = parseInt((process.argv.find(a => a.startsWith('--concurrency=')) || '').split('=')[1] || '8', 10);
const DELAY_MS = 300;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function slugify(nome) {
  return String(nome || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const ITEM_TIMEOUT_MS = 30000;
async function runPool(items, limit, worker) {
  let idx = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      try {
        await Promise.race([
          worker(items[i], i),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout (30s)')), ITEM_TIMEOUT_MS)),
        ]);
      } catch (e) {
        console.log(`  (pool) saltato: ${e.message}`);
      }
    }
  });
  await Promise.all(runners);
}

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  console.log('Carico le coppie (atleta, stagione) già note...');
  // Un campione di gara_ciclismo_url + punti_stagione per coppia — paginato,
  // PostgREST tronca sempre a 1000 righe senza .range() (bug noto in questo
  // repo, vedi commenti analoghi altrove).
  const pairs = new Map(); // key "ciclismoId|stagione" -> {ciclismoId, stagione, origin, punti}
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await sb.from('ciclismo_results')
      .select('ciclismo_id, stagione, gara_ciclismo_url, punti_stagione')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error('Errore caricamento pagina', from, error.message); break; }
    if (!data || !data.length) break;
    for (const r of data) {
      if (!r.ciclismo_id || !r.stagione) continue;
      const key = `${r.ciclismo_id}|${r.stagione}`;
      if (!pairs.has(key)) {
        let origin = null;
        try { origin = new URL(r.gara_ciclismo_url).origin; } catch {}
        pairs.set(key, { ciclismoId: r.ciclismo_id, stagione: r.stagione, origin, punti: r.punti_stagione ?? null });
      }
    }
    from += PAGE;
    if (data.length < PAGE) break;
  }
  console.log(`Coppie distinte trovate: ${pairs.size}`);

  console.log('Carico nome_completo e atleta_id per gli atleti coinvolti...');
  const ciclismoIds = [...new Set([...pairs.values()].map(p => p.ciclismoId))];
  const athleteById = new Map();
  for (let i = 0; i < ciclismoIds.length; i += 500) {
    const chunk = ciclismoIds.slice(i, i + 500);
    const { data, error } = await sb.from('ciclismo_athletes').select('ciclismo_id, nome_completo, atleta_id').in('ciclismo_id', chunk);
    if (error) { console.error('Errore ciclismo_athletes', error.message); continue; }
    for (const a of (data || [])) athleteById.set(a.ciclismo_id, a);
  }
  console.log(`Atleti caricati: ${athleteById.size}`);

  let items = [...pairs.values()].map(p => ({ ...p, athlete: athleteById.get(p.ciclismoId) })).filter(x => x.athlete && x.athlete.nome_completo && x.origin);
  if (LIMIT < items.length) items = items.slice(0, LIMIT);
  console.log(`Da ricontrollare: ${items.length}\n`);

  let checked = 0, pageErrori = 0, righeUpsertate = 0, righeAggiunteStimate = 0;
  const t0 = Date.now();

  await runPool(items, CONCURRENCY, async (it) => {
    const slug = slugify(it.athlete.nome_completo);
    const url = `${it.origin}/scheda_corridore_risultati_gare_tb_${it.ciclismoId}_${slug}_${it.stagione}.htm`;
    let html;
    try {
      html = await fetchDecoded(url);
    } catch (e) {
      pageErrori++;
      await sleep(DELAY_MS);
      return;
    }
    if (!html || html.length < 200) { pageErrori++; await sleep(DELAY_MS); return; }

    let scheda;
    try { scheda = parseAthletePage(html, url); } catch (e) { pageErrori++; await sleep(DELAY_MS); return; }

    checked++;
    if (scheda.piazzamenti && scheda.piazzamenti.length) {
      const rows = scheda.piazzamenti.map(pl => ({
        ciclismo_id: it.ciclismoId,
        atleta_id: it.athlete.atleta_id,
        stagione: it.stagione,
        categoria: scheda.categoria,
        team: scheda.team,
        posizione: pl.posizione,
        punti_stagione: it.punti,
        data: pl.data,
        regione: pl.regione,
        luogo: pl.luogo,
        nome_gara: pl.nomeGara,
        gara_ciclismo_url: pl.garaUrl,
        km: pl.km,
      })).filter(r => r.data && r.nome_gara);
      if (rows.length) {
        const { error } = await sb.from('ciclismo_results').upsert(rows, { onConflict: 'ciclismo_id,stagione,data,nome_gara' });
        if (error) { pageErrori++; }
        else righeUpsertate += rows.length;
      }
    }

    if (checked % 200 === 0) {
      const rate = (checked / ((Date.now() - t0) / 60000)).toFixed(1);
      console.log(`[${checked}/${items.length}] pagine ok, righe upsertate finora: ${righeUpsertate}, errori pagina: ${pageErrori} — ${rate}/min`);
    }
    await sleep(DELAY_MS);
  });

  console.log(`\n=== FATTO === pagine controllate: ${checked} | righe upsertate: ${righeUpsertate} | errori pagina: ${pageErrori}`);
}

main().catch(e => { console.error('\nERRORE FATALE:', e?.message || e, '\n', e?.stack || ''); process.exit(1); });
