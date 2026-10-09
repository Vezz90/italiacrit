#!/usr/bin/env node
/**
 * Elenco delle schede atleta DOPPIE: profili creati in passato da importazioni PCS (extra_roster / pcs_atleta)
 * che corrispondono a un atleta "vero" gia' presente (FCI 2026 o archivio ciclismo.info). Non modifica nulla.
 *   node scripts/schede_doppie.js [file.csv]
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
(async () => {
  const idx = await buildIndex(sb);
  const ath = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'athletes.json'), 'utf8'));
  const prof = new Map();   // id -> {nome, team, categoria}
  try { for (const [tid, b] of Object.entries(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'extra_roster.json'), 'utf8')))) for (const a of (b.atleti || [])) prof.set(a.atleta_id, { nome: `${a.cognome} ${a.nome}`.trim(), team: b.nome || tid, cat: a.categoria }); } catch (_) {}
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('entity_overrides').select('entity_id,new_value').eq('entity_type', 'pcs_atleta').eq('field', 'profile').range(from, from + 999);
    if (error) throw error;
    for (const r of data || []) { try { const v = JSON.parse(r.new_value); if (!prof.has(r.entity_id)) prof.set(r.entity_id, { nome: `${v.cognome} ${v.nome}`.trim(), team: v.team_nome, cat: v.categoria }); } catch (_) {} }
    if (!data || data.length < 1000) break;
  }
  const rows = [];
  for (const [id, p] of prof) {
    if (ath[id]) continue;                                  // e' gia' un atleta FCI
    const best = idx.match(p.nome, 2);
    if (best && best !== id) rows.push({ doppia: id, nome: p.nome, team_doppia: p.team, cat_doppia: p.cat, vera: best, fonte: ath[best] ? 'FCI 2026' : 'archivio' , team_vera: ath[best] ? ath[best].team_attuale : '' });
  }
  console.log(`Profili creati da PCS: ${prof.size} · schede doppie trovate: ${rows.length}`);
  rows.slice(0, 25).forEach(r => console.log(`  ${r.doppia.padEnd(34)} -> ${r.vera.padEnd(36)} [${r.fonte}] ${r.team_doppia || ''} / ${r.team_vera || ''}`));
  const out = process.argv[2];
  if (out) { fs.writeFileSync(out, 'scheda_doppia;nome;team_doppia;categoria;scheda_vera;fonte;team_vera\n' + rows.map(r => [r.doppia, r.nome, r.team_doppia, r.cat_doppia, r.vera, r.fonte, r.team_vera].map(x => String(x ?? '').replace(/;/g, ',')).join(';')).join('\n'), 'utf8'); console.log('\nFile: ' + out); }
})().catch(e => { console.error('ERRORE:', e.message); process.exit(1); });
