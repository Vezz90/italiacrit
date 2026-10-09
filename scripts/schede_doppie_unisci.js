#!/usr/bin/env node
/**
 * Unisce le schede atleta doppie verificate (schede_doppie_verifica.json): sposta i risultati sulla scheda vera,
 * toglie la scheda doppia e registra un alias (data/atleti_alias.json) cosi' i vecchi link continuano a funzionare.
 *
 * Si unisce solo se c'e' una prova forte che sia la STESSA persona:
 *   - almeno 3 risultati identici (stessa data e stessa posizione), oppure
 *   - stessa squadra + stesso cognome principale (primo cognome uguale)
 * Tutto il resto resta com'e' (e va controllato a mano).
 *
 *   node scripts/schede_doppie_unisci.js           anteprima
 *   node scripts/schede_doppie_unisci.js --apply   esegue
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
const APPLY = process.argv.includes('--apply');

const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'schede_doppie_verifica.json'), 'utf8'));
const first = id => String(id).split('_')[0];
const ok = [], no = [];
for (const r of rows) {
  const strong = r.overlap >= 3 || (r.team === true && first(r.dup) === first(r.vera));
  (strong ? ok : no).push(r);
}
console.log(`Da unire: ${ok.length} · lasciate fuori: ${no.length}`);
console.log('\nLasciate fuori (non abbastanza prove):');
no.forEach(r => console.log(`  ${r.dup} -> ${r.vera} | squadra ${r.team} | in comune ${r.overlap}/${r.risultatiDup}`));

(async () => {
  if (!APPLY) { console.log('\nAnteprima: nulla modificato. Aggiungi --apply.'); return; }
  const aliasPath = path.join(ROOT, 'data', 'atleti_alias.json');
  let alias = {}; try { alias = JSON.parse(fs.readFileSync(aliasPath, 'utf8')); } catch (_) {}
  const rosterPath = path.join(ROOT, 'data', 'extra_roster.json');
  const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
  const stats = { pcs_results: 0, pcs_gara_results: 0, manual_results: 0, profili: 0, roster: 0 };
  for (const r of ok) {
    // pcs_results: unico per (atleta, stagione, gara) -> le righe gia' presenti sulla scheda vera si scartano
    const { data: pr } = await sb.from('pcs_results').select('id,season,pcs_race_slug').eq('atleta_id', r.dup).limit(5000);
    for (const x of pr || []) {
      const { data: ex } = await sb.from('pcs_results').select('id').eq('atleta_id', r.vera).eq('season', x.season).eq('pcs_race_slug', x.pcs_race_slug).limit(1);
      if (ex && ex.length) await sb.from('pcs_results').delete().eq('id', x.id);
      else { const { error } = await sb.from('pcs_results').update({ atleta_id: r.vera }).eq('id', x.id); if (error) throw error; stats.pcs_results++; }
    }
    const { error: e2, count: c2 } = await sb.from('pcs_gara_results').update({ atleta_id: r.vera }, { count: 'exact' }).eq('atleta_id', r.dup);
    if (e2) throw e2; stats.pcs_gara_results += c2 || 0;
    const { data: mr } = await sb.from('manual_results').select('id,gara_id,posizione').eq('atleta_id', r.dup).limit(500);
    for (const x of mr || []) {
      const { data: ex } = await sb.from('manual_results').select('id').eq('atleta_id', r.vera).eq('gara_id', x.gara_id).eq('posizione', x.posizione).limit(1);
      if (ex && ex.length) await sb.from('manual_results').delete().eq('id', x.id);
      else { const { error } = await sb.from('manual_results').update({ atleta_id: r.vera }).eq('id', x.id); if (error) throw error; stats.manual_results++; }
    }
    const { count: c4 } = await sb.from('entity_overrides').delete({ count: 'exact' }).eq('entity_type', 'pcs_atleta').eq('field', 'profile').eq('entity_id', r.dup);
    stats.profili += c4 || 0;
    for (const b of Object.values(roster)) { const n = (b.atleti || []).length; b.atleti = (b.atleti || []).filter(a => a.atleta_id !== r.dup); stats.roster += n - b.atleti.length; }
    alias[r.dup] = r.vera;
    console.log(`  unita ${r.dup} -> ${r.vera}`);
  }
  fs.writeFileSync(aliasPath, JSON.stringify(alias, null, 1));
  fs.writeFileSync(rosterPath, JSON.stringify(roster, null, 2));
  console.log('\nFatto:', stats);
})().catch(e => { console.error('ERRORE:', e.message); process.exit(1); });
