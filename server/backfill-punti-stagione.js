'use strict';
// Recupera punti_stagione per TUTTI gli anni già scrapati — non serve
// ri-scaricare la scheda di ogni atleta (migliaia di richieste), il punteggio
// sta già nella pagina CLASSIFICA (una per anno+categoria, ~150 richieste
// totali invece di decine di migliaia): la si rilegge e si aggiornano in blocco
// tutte le righe ciclismo_results di quell'atleta in quella stagione.
//
// Uso: node backfill-punti-stagione.js [annoInizio] [annoFine]

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
const iconvLite = (() => { try { return require('iconv-lite'); } catch { return null; } })();
const { parseClassificaPage } = require('./ciclismo-info-test.js');

const SUPABASE_URL = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta SUPABASE_SECRET in server/.env.local'); process.exit(1); }

const CATEGORIE = [
  { domain: 'donne-esordienti', slug: 'donne-esordienti', label: 'donne-esordienti' },
  { domain: 'donne-allieve',    slug: 'donne-allieve',    label: 'donne-allieve' },
  { domain: 'donne-juniores',   slug: 'donne-juniores',   label: 'donne-juniores' },
  { domain: 'esordienti',       slug: 'esordienti',              label: 'esordienti' },
  { domain: 'esordienti',       slug: 'esordienti_primo_anno',   label: 'esordienti-1anno' },
  { domain: 'allievi',          slug: 'allievi',          label: 'allievi' },
  { domain: 'juniores',         slug: 'juniores',         label: 'juniores' },
  { domain: 'elite-under23',    slug: 'elite-under23',    label: 'elite-under23' },
];
const DELAY_MS = 300;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchDecodedSafe(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return { status: res.status, html: null };
    const buf = Buffer.from(await res.arrayBuffer());
    const html = iconvLite ? iconvLite.decode(buf, 'win1252') : buf.toString('latin1');
    return { status: res.status, html };
  } catch (e) { return { status: 0, html: null, error: e.message }; }
}

async function main() {
  const annoInizio = parseInt(process.argv[2]) || 2007;
  const annoFine = parseInt(process.argv[3]) || new Date().getFullYear();
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  console.log(`=== Backfill punti_stagione: ${annoInizio}-${annoFine} ===\n`);

  let totCategorie = 0, totAtleti = 0, totRighe = 0, errori = 0;

  for (let anno = annoFine; anno >= annoInizio; anno--) {
    for (const { domain, slug, label } of CATEGORIE) {
      const classUrl = `http://${domain}.ciclismo.info/classifica_${slug}_${anno}.htm`;
      const { html } = await fetchDecodedSafe(classUrl);
      await sleep(DELAY_MS);
      if (!html) { console.log(`[${anno}_${label}] HTTP errore, salto`); continue; }
      const { classifica } = parseClassificaPage(html);
      if (!classifica.length) { console.log(`[${anno}_${label}] 0 atleti`); continue; }
      totCategorie++;

      let aggiornati = 0;
      for (const a of classifica) {
        if (!a.ciclismoId || a.punti == null) continue;
        const { error, count } = await sb.from('ciclismo_results')
          .update({ punti_stagione: a.punti }, { count: 'exact' })
          .eq('ciclismo_id', a.ciclismoId)
          .eq('stagione', String(anno));
        if (error) { errori++; continue; }
        totAtleti++;
        totRighe += (count || 0);
        aggiornati++;
      }
      console.log(`[${anno}_${label}] ${classifica.length} atleti in classifica, ${aggiornati} aggiornati | totali: categorie=${totCategorie} atleti=${totAtleti} righe=${totRighe} errori=${errori}`);
    }
  }

  console.log(`\n=== FATTO === categorie processate: ${totCategorie} | atleti aggiornati: ${totAtleti} | righe toccate: ${totRighe} | errori: ${errori}`);
}

main().catch(e => { console.error('ERRORE FATALE:', e); process.exit(1); });
