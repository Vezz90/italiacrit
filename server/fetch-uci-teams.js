'use strict';
/**
 * Scarica l'elenco ufficiale delle squadre UCI (road, tutte le categorie:
 * WTT/WTW/PRT/PRW/CTM/CTW) da un'API pubblica del sito uci.org e lo salva
 * in uci_teams — usato per distinguere una vera squadra Continental UCI
 * (es. "Bahrain Victorious Development Team") da un semplice club
 * dilettanti italiano che PCS etichetta comunque "CT" nella cronologia
 * squadre di un atleta (segnalato dal vivo dall'utente su Lorello
 * Riccardo / S.C. Padovani: PCS non distingue i due casi, l'elenco
 * ufficiale UCI sì).
 *
 * Fonte: https://www.uci.org/api/teams/ROA/{anno}?page=N (nessun
 * anti-bot, nessun browser necessario — solo fetch diretto, verificato
 * dal vivo su più stagioni, 2008-2026).
 *
 * Uso:
 *   $env:SUPABASE_SECRET = "..."
 *   node fetch-uci-teams.js [--from=2007] [--to=2027]
 */
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

const SUPABASE_URL    = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta $env:SUPABASE_SECRET o crea server/.env.local'); process.exit(1); }

const args = process.argv.slice(2);
const FROM = parseInt((args.find(a => a.startsWith('--from=')) || '').split('=')[1] || '') || 2007;
const TO   = parseInt((args.find(a => a.startsWith('--to=')) || '').split('=')[1] || '') || new Date().getFullYear() + 1;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchSeasonTeams(season) {
  const teams = [];
  let page = 1;
  for (;;) {
    const res = await fetch(`https://www.uci.org/api/teams/ROA/${season}?page=${page}`);
    if (!res.ok) break;
    const j = await res.json();
    for (const t of (j.items || [])) {
      teams.push({
        season, team_name: t.teamName, team_code: t.teamCode || null,
        country_code: t.countryCode || null, category: t.categoryName,
        uci_url: t.url ? `https://www.uci.org${t.url}` : null,
      });
    }
    const totalPages = Math.ceil((j.totalItems || 0) / (j.pageSize || 25));
    if (page >= totalPages || !(j.items || []).length) break;
    page++;
    await sleep(200);
  }
  return teams;
}

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  console.log(`=== Elenco squadre UCI ufficiale (${FROM}-${TO}) ===\n`);
  let totalSaved = 0;
  for (let season = FROM; season <= TO; season++) {
    const teams = await fetchSeasonTeams(season);
    if (!teams.length) { console.log(`${season}: nessuna squadra (stagione non disponibile su UCI)`); continue; }
    const { error } = await sb.from('uci_teams').upsert(teams, { onConflict: 'season,team_name,category' });
    if (error) { console.log(`${season}: ERRORE — ${error.message}`); continue; }
    totalSaved += teams.length;
    console.log(`${season}: ${teams.length} squadre salvate`);
    await sleep(300);
  }
  console.log(`\n=== Completato: ${totalSaved} righe salvate/aggiornate ===`);
})().catch(e => { console.error(e); process.exit(1); });
