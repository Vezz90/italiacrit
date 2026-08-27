'use strict';
// Toglie retroattivamente il watermark dalle foto GARA già scaricate da
// ciclismo.info (ciclismo_gara_media) — richiesta esplicita dell'utente.
// Ri-scarica l'originale dalla pagina gara (sempre nota via
// gara_ciclismo_url) e lo ri-carica SOPRA lo stesso storage path, senza
// passare da _watermarkPhoto. Le foto profilo atleta NON sono coperte da
// questo script: non abbiamo salvato da nessuna parte l'URL della scheda
// corridore usata al momento dello scraping (solo il ciclismo_id), quindi
// non c'è modo affidabile di risalire all'originale senza ri-scrapare da
// zero le classifiche — costoso, da fare solo se richiesto esplicitamente.
//
// Uso: node dewatermark-gara-photos.js

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

const DELAY_MS = 300;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('ciclismo_gara_media')
      .select('gara_ciclismo_url, stagione, foto_index, photo_url')
      .not('photo_url', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  console.log(`Foto gara da rimarchiare: ${rows.length}\n`);

  // Raggruppa per gara (una fetch della pagina serve per tutte le foto di quella gara)
  const byGara = new Map();
  for (const r of rows) {
    const key = `${r.gara_ciclismo_url}|${r.stagione}`;
    if (!byGara.has(key)) byGara.set(key, []);
    byGara.get(key).push(r);
  }

  // Ripresa da un'esecuzione interrotta: salta le prime N gare (stesso
  // ordine di iterazione della query, senza ORDER BY esplicito — non
  // garantito identico al 100% tra run, ma l'upload è idempotente
  // (upsert sullo stesso storage path), quindi rifare qualche gara già
  // fatta non è un problema, evita solo di ripartire sempre da zero.
  const skipN = parseInt(process.argv[2] || '0', 10) || 0;
  if (skipN) console.log(`Ripresa: salto le prime ${skipN} gare già processate in precedenza.\n`);

  let gareOk = 0, foteOk = 0, errori = 0;
  let i = 0;
  for (const [key, foto] of byGara) {
    i++;
    if (i <= skipN) continue;
    const garaUrl = foto[0].gara_ciclismo_url;
    try {
      const html = await fetchDecoded(garaUrl);
      const photos = parseGaraPhoto(html);
      if (!photos.length) { console.log(`(${i}/${byGara.size}) nessuna foto trovata ora su ${garaUrl}`); await sleep(DELAY_MS); continue; }
      const urlObj = new URL(garaUrl);

      for (const r of foto) {
        const idx = r.foto_index;
        const photo = photos[idx - 1];
        if (!photo) { errori++; continue; }
        try {
          const originalUrl = urlObj.origin + photo.original;
          const photoRes = await fetch(originalUrl);
          if (!photoRes.ok) { errori++; continue; }
          const buf = Buffer.from(await photoRes.arrayBuffer());
          if (buf.length < 500) { errori++; continue; }
          const storagePath = r.photo_url.replace(/^\/photos\//, '');
          const { error: upErr } = await sb.storage.from('photos').upload(storagePath, buf, { contentType: 'image/jpeg', upsert: true });
          if (upErr) { errori++; continue; }
          foteOk++;
        } catch { errori++; }
        await sleep(DELAY_MS);
      }
      gareOk++;
      if (i % 25 === 0) console.log(`... ${i}/${byGara.size} gare | foto rifatte: ${foteOk} | errori: ${errori}`);
    } catch (e) { errori += foto.length; console.log(`(${i}/${byGara.size}) ERRORE ${garaUrl}: ${e.message}`); }
    await sleep(DELAY_MS);
  }

  console.log(`\n=== FATTO === gare processate: ${gareOk}/${byGara.size} | foto senza watermark: ${foteOk} | errori: ${errori}`);
}

main().catch(e => { console.error('ERRORE FATALE:', e); process.exit(1); });
