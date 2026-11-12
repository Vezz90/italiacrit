'use strict';
// Esporta in data/team_lineage.json i collegamenti tra squadre CONFERMATI dall'admin (tabella team_lineage).
// Lo legge scripts/build_almanacco.py per trattare come una sola squadra i nomi collegati (cambi di sponsor e di sigla),
// cosi dinastie, record e storico non si spezzano a ogni cambio di nome.
// Uso (dalla cartella che ha server/.env.local e node_modules):
//   cd server && node --env-file=.env.local ../scripts/esporta_team_lineage.js
const fs = require('fs'), path = require('path');
const ws = require('ws');
const { createClient } = require('@supabase/supabase-js');

(async () => {
  if (!process.env.SUPABASE_SECRET) throw new Error('SUPABASE_SECRET non impostato');
  const sb = createClient('https://aqqsstsbgpapzoxllosh.supabase.co', process.env.SUPABASE_SECRET, { realtime: { transport: ws } });
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('team_lineage').select('id, team_from, season_from, team_to, season_to').eq('status', 'confirmed').order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const out = rows.map(r => [String(r.team_from).trim(), String(r.season_from), String(r.team_to).trim(), String(r.season_to)]);
  const dest = path.join(__dirname, '..', 'data', 'team_lineage.json');
  fs.writeFileSync(dest, JSON.stringify(out) + '\n');
  console.log('collegamenti confermati esportati:', out.length, '->', dest);
})().catch(e => { console.error(e.message); process.exit(1); });
