'use strict';
// Lista degli atleti gia' tracciati (pcs_team_history) ma senza ancora il
// livello squadra (tier IS NULL) -- vedi commit 07385996. Genera
// l'ids-file per pcs-athlete-import.js --ids-file=..., stesso schema del
// backfill team-history gia' fatto in precedenza. Riusabile per ripulire
// i residui (nuovi atleti importati prima del fix, sfide anti-bot non
// superate al primo giro, ecc.) senza dover ricostruire lo script da zero.
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

  // 1. atleti con almeno una riga tier IS NULL
  const withoutTier = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('pcs_team_history').select('atleta_id').is('tier', null).range(from, from + 999);
    if (error) throw error;
    if (!data.length) break;
    for (const r of data) withoutTier.add(r.atleta_id);
    if (data.length < 1000) break;
  }

  // 2. slug PCS gia' noto per ciascuno
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

  const out = [...withoutTier].map(id => ({ atleta_id: id, slug: slugMap.get(id) || undefined }));
  const outPath = path.join(__dirname, 'tier-backfill-ids.json');
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log(`Scritti ${out.length} atleti (${out.filter(o=>o.slug).length} con slug gia' noto) in ${outPath}`);
})().catch(e => { console.error(e); process.exit(1); });
