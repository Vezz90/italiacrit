'use strict';
// Genera l'ids-file per pcs-athlete-import.js: tutti gli atleti che hanno
// già risultati PCS ma zero righe in pcs_team_history (buco dovuto al bug
// di --skip-complete corretto in pcs-athlete-import.js).
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

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  // 1. tutti gli atleta_id distinti in pcs_results (paginato)
  const withResults = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('pcs_results').select('atleta_id').range(from, from + 999);
    if (error) throw error;
    if (!data.length) break;
    for (const r of data) withResults.add(r.atleta_id);
    if (data.length < 1000) break;
  }

  // 2. tutti gli atleta_id distinti in pcs_team_history (paginato)
  const withTeam = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('pcs_team_history').select('atleta_id').range(from, from + 999);
    if (error) throw error;
    if (!data.length) break;
    for (const r of data) withTeam.add(r.atleta_id);
    if (data.length < 1000) break;
  }

  const missing = [...withResults].filter(id => !withTeam.has(id));

  // 3. slug PCS già noto per ciascuno (entity_overrides, paginato)
  const slugMap = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('entity_overrides')
      .select('entity_id, new_value')
      .eq('entity_type', 'atleta').eq('field', 'pcs_slug')
      .not('new_value', 'is', null)
      .range(from, from + 999);
    if (error) throw error;
    if (!data.length) break;
    for (const r of data) slugMap.set(r.entity_id, r.new_value);
    if (data.length < 1000) break;
  }

  const out = missing.map(id => ({ atleta_id: id, slug: slugMap.get(id) || undefined }));
  const outPath = path.join(__dirname, 'team-history-backfill-ids.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 0));
  console.log(`Scritti ${out.length} atleti (${out.filter(o=>o.slug).length} con slug già noto) in ${outPath}`);
})().catch(e => { console.error(e); process.exit(1); });
