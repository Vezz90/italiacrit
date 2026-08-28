'use strict';
// Calcola, per ogni "anno più recente noto" (lastYear), quanti atleti storici
// ci sono e a quale intervallo di indici corrispondono nell'ordine ESATTO
// con cui pcs-athlete-import-storico.js li processa (stesso calcolo di
// loadAtletiStorici lì — ordinati per lastYear decrescente, 2025→2007).
// Usato solo dal dashboard locale (scraper-status-server.js) per mostrare
// l'avanzamento spezzato per anno, non dallo scraper stesso.
//
// Uso: node pcs-storico-year-breakdown.js
// Scrive pcs_storico_year_breakdown.json

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

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const SUPABASE_URL = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta SUPABASE_SECRET in server/.env.local'); process.exit(1); }

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('ciclismo_results')
      .select('atleta_id, stagione').not('atleta_id', 'is', null).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  const lastYearByAtleta = new Map();
  for (const r of rows) {
    const y = parseInt(r.stagione, 10);
    if (!lastYearByAtleta.has(r.atleta_id) || y > lastYearByAtleta.get(r.atleta_id)) lastYearByAtleta.set(r.atleta_id, y);
  }

  // Stesso filtro --skip-complete usato dallo scraper in corso: senza,
  // gli indici qui calcolati non corrisponderebbero a quelli del log reale
  // (che gira sulla lista GIÀ filtrata, non su tutti gli atleti).
  const { data: doneOv } = await sb.from('entity_overrides').select('entity_id')
    .eq('entity_type', 'atleta').eq('field', 'pcs_slug').not('new_value', 'is', null);
  const done = new Set((doneOv || []).map(r => r.entity_id));
  for (const id of done) lastYearByAtleta.delete(id);

  const sorted = [...lastYearByAtleta.values()].sort((a, b) => b - a);
  const counts = new Map();
  for (const y of sorted) counts.set(y, (counts.get(y) || 0) + 1);

  let idx = 0;
  const breakdown = [...counts.entries()].sort((a, b) => b[0] - a[0]).map(([year, count]) => {
    const startIndex = idx + 1;
    idx += count;
    return { year, count, startIndex, endIndex: idx };
  });

  const out = { totalAtleti: sorted.length, generatedAt: new Date().toISOString(), breakdown };
  fs.writeFileSync(path.join(__dirname, 'pcs_storico_year_breakdown.json'), JSON.stringify(out, null, 2));
  console.log(`Totale atleti: ${sorted.length}`);
  for (const b of breakdown) console.log(`  ${b.year}: ${b.count} (indici ${b.startIndex}-${b.endIndex})`);
}

main().catch(e => { console.error('ERRORE FATALE', e); process.exit(1); });
