#!/usr/bin/env node
/**
 * Collega ai profili ICS le righe di pcs_gara_results rimaste senza atleta_id (corridori PCS non riconosciuti
 * per nome, es. "Gaggioli Luciano" -> GAGGIOLI_LUCIANO_WILLIAM). Non crea profili nuovi.
 *   node scripts/pcs_rilega_atleti.js            anteprima
 *   node scripts/pcs_rilega_atleti.js --apply    scrive
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..'), SERVER = path.join(ROOT, 'server');
for (const line of fs.readFileSync(path.join(SERVER, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require(path.join(SERVER, 'node_modules', '@supabase', 'supabase-js'));
const ws = require(path.join(SERVER, 'node_modules', 'ws'));
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET, { realtime: { transport: ws } });
const { buildIndex } = require('./lib_atleti');
const APPLY = process.argv.includes('--apply');

(async () => {
  const idx = await buildIndex(sb);
  console.log(`Atleti noti: ${idx.size}`);
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('pcs_gara_results').select('id,gara_id,rider_name').is('atleta_id', null).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  console.log(`Righe senza profilo: ${rows.length}`);
  const byId = new Map(), cache = new Map(), sample = [];
  let found = 0;
  for (const r of rows) {
    if (!cache.has(r.rider_name)) cache.set(r.rider_name, idx.match(r.rider_name));
    const id = cache.get(r.rider_name);
    if (!id) continue;
    found++;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(r.id);
    if (sample.length < 14 && !sample.some(s => s[1] === id)) sample.push([r.rider_name, id]);
  }
  console.log(`Riconosciuti: ${found} righe (${byId.size} atleti diversi) · restano senza profilo: ${rows.length - found}`);
  sample.forEach(s => console.log(`   ${s[0].padEnd(30)} -> ${s[1]}`));
  if (!APPLY) { console.log('\nAnteprima: nulla scritto. Aggiungi --apply.'); return; }
  let done = 0;
  for (const [id, ids] of byId) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await sb.from('pcs_gara_results').update({ atleta_id: id }).in('id', ids.slice(i, i + 200));
      if (error) throw error;
      done += Math.min(200, ids.length - i);
    }
  }
  console.log(`Aggiornate ${done} righe.`);
})().catch(e => { console.error('ERRORE:', e.message); process.exit(1); });
