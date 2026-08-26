'use strict';
// Import storico ciclismo.info per UN SOLO atleta (prova pilota, non massiva).
// Scarica tutte le stagioni disponibili dell'atleta e le scrive su Supabase
// (ciclismo_athletes + ciclismo_results), collegate all'atleta_id italiacrit.
//
// Uso: node ciclismo-import-single.js <ciclismoId> <slug> <subdomain> <atleta_id_italiacrit>
// Esempio: node ciclismo-import-single.js 21541 manenti_marco elite-under23 MANENTI_MARCO

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
const { fetchDecoded, parseAthletePage } = require('./ciclismo-info-test.js');

const SUPABASE_URL = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta SUPABASE_SECRET in server/.env.local'); process.exit(1); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const [ciclismoId, slug, subdomain, atletaId] = process.argv.slice(2);
  if (!ciclismoId || !slug || !subdomain || !atletaId) {
    console.error('Uso: node ciclismo-import-single.js <ciclismoId> <slug> <subdomain> <atleta_id_italiacrit>');
    process.exit(1);
  }

  const ws = require('ws');
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  const url0 = `http://${subdomain}.ciclismo.info/scheda_corridore_risultati_gare_${ciclismoId}_${slug}_2025.htm`;
  const html0 = await fetchDecoded(url0);
  const data0 = parseAthletePage(html0, url0);
  const anni = data0.anniDisponibili;
  console.log(`Anni disponibili: ${anni.join(', ')}`);

  let totRisultati = 0;
  let natoIl = null;

  for (const anno of anni) {
    const url = `http://${subdomain}.ciclismo.info/scheda_corridore_risultati_gare_${ciclismoId}_${slug}_${anno}.htm`;
    let data;
    try {
      const html = await fetchDecoded(url);
      data = parseAthletePage(html, url);
    } catch (e) {
      console.error(`  ${anno}: errore fetch — ${e.message}`);
      continue;
    }
    if (data.natoIl) natoIl = data.natoIl;

    const rows = data.piazzamenti.map(p => ({
      ciclismo_id: ciclismoId,
      atleta_id: atletaId,
      stagione: anno,
      categoria: data.categoria,
      team: data.team,
      posizione: p.posizione,
      data: p.data,
      regione: p.regione,
      luogo: p.luogo,
      nome_gara: p.nomeGara,
      gara_ciclismo_url: p.garaUrl,
      km: p.km,
    }));

    if (rows.length) {
      const { error } = await sb.from('ciclismo_results').upsert(rows, { onConflict: 'ciclismo_id,stagione,data,nome_gara' });
      if (error) console.error(`  ${anno}: errore upsert — ${error.message}`);
      else { console.log(`  ${anno}: ${rows.length} risultati (team: ${data.team})`); totRisultati += rows.length; }
    } else {
      console.log(`  ${anno}: 0 risultati (team: ${data.team})`);
    }
    await sleep(300);
  }

  const { error: errAth } = await sb.from('ciclismo_athletes').upsert({
    ciclismo_id: ciclismoId,
    atleta_id: atletaId,
    nome_completo: data0.nomeCompleto,
    data_nascita: natoIl,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'ciclismo_id' });
  if (errAth) console.error('Errore upsert ciclismo_athletes:', errAth.message);

  console.log(`\nFATTO. Totale risultati importati: ${totRisultati}. Data di nascita: ${natoIl}`);
}

main().catch(e => { console.error('ERRORE FATALE:', e); process.exit(1); });
