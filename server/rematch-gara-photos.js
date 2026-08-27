'use strict';
// Ri-abbina TUTTE le foto gara ciclismo.info già scaricate (photo_url già
// in ciclismo_gara_media) al vincitore effettivo, indipendentemente dalla
// didascalia — la foto pubblicata da ciclismo.info per una gara è (quasi)
// sempre quella del 1° classificato, e provare ad abbinare per parole in
// comune con la didascalia poteva assegnarla al 2° se il testo nominava
// anche lui (es. "Sprint di X che precede Y" — bug reale osservato dal
// vivo, gara CIC_6348: foto del vincitore Amicabile assegnata a Guardini,
// arrivato 2° e solo citato come "battuto"). Corregge anche i casi senza
// nessuna didascalia (mai potuti abbinare prima) e quelli non abbinati
// perché il vincitore non era ancora tra i risultati noti della gara al
// momento dello scraping foto (il "buco" appena colmato da
// ciclismo-gara-scraper.js). Nessuna richiesta di rete: rilegge solo i
// dati già in database.
//
// Uso: node rematch-gara-photos.js

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

const SUPABASE_URL = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta SUPABASE_SECRET in server/.env.local'); process.exit(1); }

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('ciclismo_gara_media')
      .select('id, gara_ciclismo_url, stagione, atleta_id, ciclismo_id')
      .not('photo_url', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  console.log(`Foto totali da (ri)controllare: ${rows.length}\n`);

  // Una sola query per gara (chiave url+stagione), non per riga — molte
  // righe condividono la stessa gara.
  const byGara = new Map();
  for (const r of rows) {
    const key = `${r.gara_ciclismo_url}|${r.stagione}`;
    if (!byGara.has(key)) byGara.set(key, []);
    byGara.get(key).push(r);
  }
  console.log(`Gare distinte: ${byGara.size}\n`);

  let cambiate = 0, giaCorrette = 0, senzaVincitoreNoto = 0, errori = 0;
  let i = 0;
  for (const [key, garaRows] of byGara) {
    i++;
    const [url, stagione] = [garaRows[0].gara_ciclismo_url, garaRows[0].stagione];
    try {
      const { data: partecipanti } = await sb.from('ciclismo_results')
        .select('ciclismo_id, atleta_id, team, posizione')
        .eq('gara_ciclismo_url', url).eq('stagione', stagione).eq('posizione', 1);
      const winner = (partecipanti || [])[0];
      if (!winner) { senzaVincitoreNoto += garaRows.length; continue; }

      for (const row of garaRows) {
        if (row.ciclismo_id === winner.ciclismo_id) { giaCorrette++; continue; }
        const { error: updErr } = await sb.from('ciclismo_gara_media').update({
          ciclismo_id: winner.ciclismo_id, atleta_id: winner.atleta_id, team: winner.team, posizione: 1,
        }).eq('id', row.id);
        if (updErr) { errori++; continue; }
        cambiate++;
      }
      if (i % 200 === 0) console.log(`... ${i}/${byGara.size} gare | cambiate: ${cambiate} | già corrette: ${giaCorrette} | senza vincitore noto: ${senzaVincitoreNoto} | errori: ${errori}`);
    } catch (e) {
      errori += garaRows.length;
      console.log(`(${i}/${byGara.size}) ERRORE ${url}: ${e.message}`);
    }
  }

  console.log(`\n=== FATTO === gare processate: ${byGara.size} | foto riassegnate: ${cambiate} | già corrette: ${giaCorrette} | senza vincitore noto in ciclismo_results: ${senzaVincitoreNoto} | errori: ${errori}`);
}

main().catch(e => { console.error('ERRORE FATALE:', e); process.exit(1); });
