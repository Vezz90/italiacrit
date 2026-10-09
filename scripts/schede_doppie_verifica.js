#!/usr/bin/env node
/**
 * Verifica le coppie "scheda doppia -> scheda vera" di schede_doppie.csv: stessa squadra? stessi risultati?
 * Non modifica nulla. Scrive schede_doppie_verifica.json con l'esito di ogni coppia.
 *   node scripts/schede_doppie_verifica.js
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
const squash = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const words = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 5 && !/^(team|club|cycling|ciclismo|racing|ciclistica|junior|juniores|under|development|academy)$/.test(w));
const sameTeam = (a, b) => {
  const x = squash(a), y = squash(b);
  if (!x || !y) return null;                       // squadra sconosciuta da una parte
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const wa = new Set(words(a)); return words(b).some(w => wa.has(w));
};

(async () => {
  const lines = fs.readFileSync(path.join(ROOT, 'schede_doppie.csv'), 'utf8').trim().split(/\r?\n/).slice(1);
  const ath = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'athletes.json'), 'utf8'));
  const out = [];
  for (const ln of lines) {
    const [dup, nome, teamDup, cat, vera, fonte, teamVera] = ln.split(';');
    const refs = {};
    const cnt = async (t) => { const { count } = await sb.from(t).select('*', { count: 'exact', head: true }).eq('atleta_id', dup); return count || 0; };
    refs.pcs_results = await cnt('pcs_results'); refs.pcs_gara_results = await cnt('pcs_gara_results'); refs.manual_results = await cnt('manual_results');
    // risultati: (data, posizione) della scheda doppia
    const A = new Set();
    const { data: pr } = await sb.from('pcs_results').select('data,posizione').eq('atleta_id', dup).limit(2000);
    for (const r of pr || []) A.add(`${r.data}|${r.posizione}`);
    const { data: mr } = await sb.from('manual_results').select('data,posizione').eq('atleta_id', dup).limit(500);
    for (const r of mr || []) A.add(`${String(r.data).slice(0, 10)}|${r.posizione}`);
    // risultati e squadre della scheda vera
    const B = new Set(); const teamsVera = new Set(teamVera ? [teamVera] : []);
    const { data: cr } = await sb.from('ciclismo_results').select('data,posizione,team').eq('atleta_id', vera).order('data', { ascending: false }).limit(1000);
    for (const r of cr || []) { B.add(`${String(r.data).slice(0, 10)}|${r.posizione}`); if (r.team && teamsVera.size < 8) teamsVera.add(r.team); }
    const { data: pr2 } = await sb.from('pcs_results').select('data,posizione').eq('atleta_id', vera).limit(2000);
    for (const r of pr2 || []) B.add(`${r.data}|${r.posizione}`);
    for (const rr of (ath[vera]?.risultati || [])) B.add(`${String(rr.data).slice(0, 10)}|${rr.posizione}`);
    let overlap = 0; for (const k of A) if (B.has(k)) overlap++;
    let team = null; for (const tv of teamsVera) { const s = sameTeam(teamDup, tv); if (s === true) { team = true; break; } if (s === false) team = team === null ? false : team; }
    const verdict = (team === true && overlap >= 1) ? 'sicura' : (team === true || overlap >= 2) ? 'probabile' : 'DA CONTROLLARE';
    out.push({ dup, vera, nome, teamDup, teamVera: [...teamsVera].slice(0, 3).join(' | '), team, overlap, risultatiDup: A.size, refs, verdict });
  }
  fs.writeFileSync(path.join(ROOT, 'schede_doppie_verifica.json'), JSON.stringify(out, null, 1));
  const by = {}; out.forEach(o => { by[o.verdict] = (by[o.verdict] || 0) + 1; });
  console.log('Esito:', by);
  for (const v of ['DA CONTROLLARE', 'probabile']) {
    console.log(`\n── ${v} ──`);
    out.filter(o => o.verdict === v).forEach(o => console.log(`  ${o.dup} -> ${o.vera} | team: ${o.teamDup || '-'} / ${o.teamVera || '-'} | squadra ${o.team} | risultati in comune ${o.overlap}/${o.risultatiDup}`));
  }
})().catch(e => { console.error('ERRORE:', e.message); process.exit(1); });
