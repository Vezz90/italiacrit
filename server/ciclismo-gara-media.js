'use strict';
// Scarica le foto pubblicate sulle pagine GARA di ciclismo.info (non le foto
// profilo — quelle le gestisce ciclismo-backfill.js) e le attribuisce
// all'atleta/team giusto confrontando la didascalia con i partecipanti già
// noti di quella gara (dai risultati già importati in ciclismo_results).
// Una gara può avere più di una foto: tutte scaricate, una riga per foto.
// Ripartibile: salta le gare già controllate (presenti in
// ciclismo_gara_media, anche con photo_url null se non c'era nessuna foto).
//
// Uso: node ciclismo-gara-media.js [--atleta-id=X]   (limita alle gare di un
// singolo atleta, per un test mirato prima del giro completo)

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
const { fetchDecoded, parseGaraPhoto } = require('./ciclismo-info-test.js');

const SUPABASE_URL = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta SUPABASE_SECRET in server/.env.local'); process.exit(1); }

const ONLY_ATLETA = (process.argv.find(a => a.startsWith('--atleta-id=')) || '').split('=')[1] || null;
const DELAY_MS = 300;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizeStr(s) {
  return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Trova il partecipante il cui nome ha più parole in comune con la didascalia.
function matchPartecipante(caption, partecipanti) {
  const capWords = new Set(normalizeStr(caption).split(' ').filter(w => w.length > 2));
  let best = null, bestScore = 0;
  for (const p of partecipanti) {
    const nameWords = normalizeStr(p.nome_completo).split(' ').filter(w => w.length > 2);
    if (!nameWords.length) continue;
    const score = nameWords.reduce((s, w) => s + (capWords.has(w) ? 1 : 0), 0);
    if (score >= 2 && score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  const { data: already } = await sb.from('ciclismo_gara_media').select('gara_ciclismo_url, stagione');
  const doneSet = new Set((already || []).map(r => `${r.gara_ciclismo_url}|${r.stagione}`));

  const garaSet = new Map(); // key -> { gara_ciclismo_url, stagione, nome_gara, categoria, data }
  let q = sb.from('ciclismo_results').select('gara_ciclismo_url, stagione, nome_gara, categoria, data, atleta_id').not('gara_ciclismo_url', 'is', null);
  if (ONLY_ATLETA) q = q.eq('atleta_id', ONLY_ATLETA);
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    for (const r of data) {
      const key = `${r.gara_ciclismo_url}|${r.stagione}`;
      if (!doneSet.has(key) && !garaSet.has(key)) garaSet.set(key, r);
    }
    if (data.length < PAGE) break;
    if (ONLY_ATLETA) break; // singolo atleta, poche righe, niente paginazione
  }
  console.log(`Gare da controllare per foto: ${garaSet.size} (già fatte: ${doneSet.size})${ONLY_ATLETA ? ' — solo ' + ONLY_ATLETA : ''}\n`);

  let checked = 0, foundGare = 0, foundFoto = 0, matched = 0, errori = 0;
  for (const [key, gara] of garaSet) {
    checked++;
    console.log(`(${checked}/${garaSet.size}) ${gara.nome_gara} [${gara.stagione}] … `);
    try {
      const html = await fetchDecoded(gara.gara_ciclismo_url);
      const photos = parseGaraPhoto(html);
      if (!photos.length) {
        await sb.from('ciclismo_gara_media').upsert({
          gara_ciclismo_url: gara.gara_ciclismo_url, stagione: gara.stagione, categoria: gara.categoria,
          nome_gara: gara.nome_gara, data: gara.data, photo_url: null, foto_index: 1,
        }, { onConflict: 'gara_ciclismo_url,stagione,foto_index' });
        console.log('  nessuna foto');
        await sleep(DELAY_MS);
        continue;
      }
      foundGare++;

      // Partecipanti noti di questa gara/stagione, per attribuire ogni foto
      const { data: partecipanti } = await sb.from('ciclismo_results')
        .select('ciclismo_id, atleta_id, team')
        .eq('gara_ciclismo_url', gara.gara_ciclismo_url).eq('stagione', gara.stagione);
      let candidati = [];
      if (partecipanti && partecipanti.length) {
        const { data: athInfo } = await sb.from('ciclismo_athletes')
          .select('ciclismo_id, nome_completo')
          .in('ciclismo_id', partecipanti.map(p => p.ciclismo_id));
        const nomeById = new Map((athInfo || []).map(a => [a.ciclismo_id, a.nome_completo]));
        candidati = partecipanti.map(p => ({ ...p, nome_completo: nomeById.get(p.ciclismo_id) || '' })).filter(p => p.nome_completo);
      }

      const urlObj = new URL(gara.gara_ciclismo_url);
      let idx = 0;
      for (const photo of photos) {
        idx++;
        foundFoto++;
        let photoUrl = null;
        try {
          const originalUrl = urlObj.origin + photo.original;
          const photoRes = await fetch(originalUrl);
          if (photoRes.ok) {
            const buf = Buffer.from(await photoRes.arrayBuffer());
            if (buf.length > 500) {
              const rawSlug = gara.gara_ciclismo_url.split('/').pop().replace(/\.htm$/, '');
              const storagePath = `gare/ciclismo/${gara.stagione}_${rawSlug}_${idx}.jpg`.replace(/[^a-zA-Z0-9/_.-]/g, '_');
              const { error: upErr } = await sb.storage.from('photos').upload(storagePath, buf, { contentType: 'image/jpeg', upsert: true });
              if (!upErr) photoUrl = `/photos/${storagePath}`;
            }
          }
        } catch { /* singola foto, non bloccare le altre */ }

        const best = matchPartecipante(photo.caption, candidati);
        if (best) matched++;

        const { error: insErr } = await sb.from('ciclismo_gara_media').upsert({
          gara_ciclismo_url: gara.gara_ciclismo_url, stagione: gara.stagione, foto_index: idx,
          categoria: gara.categoria, nome_gara: gara.nome_gara, data: gara.data,
          caption: photo.caption, photo_url: photoUrl,
          ciclismo_id: best ? best.ciclismo_id : null, atleta_id: best ? best.atleta_id : null, team: best ? best.team : null,
        }, { onConflict: 'gara_ciclismo_url,stagione,foto_index' });
        if (insErr) errori++;
        console.log(`  foto ${idx}: ${photoUrl ? 'OK' : 'errore upload'} — ${best ? best.atleta_id || best.ciclismo_id : 'non attribuita'} — "${photo.caption.slice(0,60)}"`);
      }
    } catch (e) { errori++; console.log('  ERRORE:', e.message); }
    await sleep(DELAY_MS);
  }

  console.log(`\n=== FATTO === gare controllate: ${checked} | gare con foto: ${foundGare} | foto totali: ${foundFoto} | attribuite ad atleta: ${matched} | errori: ${errori}`);
}

main().catch(e => { console.error('ERRORE FATALE:', e); process.exit(1); });
