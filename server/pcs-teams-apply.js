'use strict';
// Usa le rose raccolte da PCS (pcs-teams-harvest.json) per:
//  A) storico squadra per atleta: per ogni corridore in rosa con slug noto, aggiunge (atleta, stagione, squadra PCS) a pcs_team_history
//     solo dove manca (non sovrascrive niente);
//  B) collegamenti storici tra nomi diversi della stessa squadra: per ogni coppia di anni consecutivi, trova con che nome comparivano
//     in rosa i nostri atleti (ciclismo.info) e, se il nome cambia, propone team_lineage (anno A -> anno B). PCS dice gia che e la stessa
//     squadra; il collegamento si conferma da solo se almeno 2 atleti sono passati da un nome all'altro, altrimenti resta "pending".
// Solo database, nessuna richiesta a PCS.   node pcs-teams-apply.js [--apply]
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8').split('\n').forEach(l => { const m = l.match(/^([^#=\s]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2'); });
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const APPLY = process.argv.includes('--apply');
const sb = createClient('https://aqqsstsbgpapzoxllosh.supabase.co', process.env.SUPABASE_SECRET, { realtime: { transport: ws } });
const idPart = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/['’`´]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

(async () => {
  const harvest = JSON.parse(fs.readFileSync(path.join(__dirname, 'pcs-teams-harvest.json'), 'utf8'));
  const teams = Object.entries(harvest).filter(([, d]) => d.status === 'ok');
  console.log(`squadre raccolte: ${teams.length}`);

  // slug PCS -> atleta
  const idOf = new Map();
  for (let from = 0; ; from += 1000) {
    const q = await sb.from('entity_overrides').select('entity_id,new_value').eq('entity_type', 'atleta').eq('field', 'pcs_slug').order('id').range(from, from + 999);
    if (q.error) throw q.error; q.data.forEach(x => idOf.set(x.new_value, x.entity_id)); if (q.data.length < 1000) break;
  }
  // (atleta|stagione) -> nome squadra nei nostri dati (il piu frequente)
  const cnt = new Map(), nameOf = new Map();
  for (let last = 0, fails = 0; ;) {
    const q = await sb.from('ciclismo_results').select('id,atleta_id,stagione,team').gt('id', last).order('id').limit(500);
    if (q.error) { if (++fails > 8) throw q.error; await new Promise(r => setTimeout(r, 3000)); continue; } fails = 0;
    if (!q.data.length) break;
    for (const x of q.data) { const t = String(x.team || '').trim(); if (!t) continue; const k = x.atleta_id + '|' + x.stagione; const m = cnt.get(k) || cnt.set(k, new Map()).get(k); m.set(t, (m.get(t) || 0) + 1); }
    last = q.data[q.data.length - 1].id; if (q.data.length < 500) break;
  }
  for (const [k, m] of cnt) nameOf.set(k, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  console.log(`atleti con slug: ${idOf.size} · coppie atleta/stagione con squadra: ${nameOf.size}`);

  // storico gia presente
  const have = new Set();
  for (let from = 0; ; from += 1000) { const q = await sb.from('pcs_team_history').select('atleta_id,season').order('atleta_id').order('season').range(from, from + 999); if (q.error) throw q.error; q.data.forEach(x => have.add(x.atleta_id + '|' + x.season)); if (q.data.length < 1000) break; }

  const histRows = [], lin = [];
  for (const [ourName, d] of teams) {
    const years = Object.keys(d.seasons).map(Number).sort((a, b) => a - b);
    const perYear = {};   // anno -> { teamName(nostro) -> Set(atleti) }
    for (const y of years) {
      const s = d.seasons[y], byTeam = new Map();
      for (const r of s.roster) {
        const aid = idOf.get(r.slug); if (!aid) continue;
        if (!have.has(aid + '|' + y)) { histRows.push({ atleta_id: aid, season: y, team: s.name, team_pcs_slug: s.url }); have.add(aid + '|' + y); }
        const tn = nameOf.get(aid + '|' + y); if (!tn) continue;
        (byTeam.get(tn) || byTeam.set(tn, new Set()).get(tn)).add(aid);
      }
      perYear[y] = byTeam;
    }
    for (const y of years) {
      if (!perYear[y + 1]) continue;
      for (const [tA, setA] of perYear[y]) for (const [tB, setB] of perYear[y + 1]) {
        if (idPart(tA) === idPart(tB)) continue;
        const common = [...setA].filter(a => setB.has(a)).length;
        if (!common) continue;
        const total = Math.min(setA.size, setB.size);
        lin.push({ team_id_from: idPart(tA), team_from: tA, season_from: String(y), team_id_to: idPart(tB), team_to: tB, season_to: String(y + 1), common_riders: common, overlap_ratio: +(common / total).toFixed(2), pcs: d.pcs });
      }
    }
  }
  // deduplica coppie
  const uniq = new Map(); for (const l of lin) { const k = [l.team_id_from, l.season_from, l.team_id_to, l.season_to].join('|'); if (!uniq.has(k) || uniq.get(k).common_riders < l.common_riders) uniq.set(k, l); }
  const cands = [...uniq.values()];

  // gia presenti in team_lineage
  const existing = new Map();
  for (let from = 0; ; from += 1000) { const q = await sb.from('team_lineage').select('id,team_id_from,season_from,team_id_to,season_to,status').order('id').range(from, from + 999); if (q.error) throw q.error; q.data.forEach(x => existing.set([x.team_id_from, x.season_from, x.team_id_to, x.season_to].join('|'), x)); if (q.data.length < 1000) break; }
  const isStrong = l => l.common_riders >= 2;   // un solo atleta in comune non basta per confermare da soli: resta in attesa di revisione
  const nuovi = cands.filter(l => !existing.has([l.team_id_from, l.season_from, l.team_id_to, l.season_to].join('|')));
  const daConfermare = cands.filter(l => { const e = existing.get([l.team_id_from, l.season_from, l.team_id_to, l.season_to].join('|')); return e && e.status === 'pending' && isStrong(l); });
  const giaConf = cands.filter(l => { const e = existing.get([l.team_id_from, l.season_from, l.team_id_to, l.season_to].join('|')); return e && e.status === 'confirmed'; });
  console.log(`\nA) storico squadra per atleta: righe da aggiungere ${histRows.length}`);
  console.log(`B) collegamenti trovati ${cands.length}: nuovi ${nuovi.length} (da confermare subito ${nuovi.filter(isStrong).length}) · in attesa che diventano confermati ${daConfermare.length} · gia confermati ${giaConf.length}`);
  nuovi.filter(isStrong).slice(0, 12).forEach(l => console.log(`   ${l.team_from} ${l.season_from} -> ${l.team_to} ${l.season_to} · ${l.common_riders} atleti (${l.overlap_ratio})`));
  fs.writeFileSync(path.join(__dirname, 'pcs-teams-apply-plan.json'), JSON.stringify({ histRows: histRows.length, nuovi, daConfermare }));
  if (!APPLY) return console.log('\n(prova: nessuna scrittura, usa --apply)');

  for (let i = 0; i < histRows.length; i += 500) { const r = await sb.from('pcs_team_history').upsert(histRows.slice(i, i + 500), { onConflict: 'atleta_id,season', ignoreDuplicates: true }); if (r.error) console.log('ERRORE storico', r.error.message); }
  const rows = nuovi.map(l => ({ team_id_from: l.team_id_from, team_from: l.team_from, season_from: l.season_from, team_id_to: l.team_id_to, team_to: l.team_to, season_to: l.season_to, common_riders: l.common_riders, overlap_ratio: l.overlap_ratio, status: isStrong(l) ? 'confirmed' : 'pending', reviewed_at: isStrong(l) ? new Date().toISOString() : null }));
  for (let i = 0; i < rows.length; i += 200) { const r = await sb.from('team_lineage').insert(rows.slice(i, i + 200)); if (r.error) console.log('ERRORE lineage', r.error.message); }
  for (const l of daConfermare) { const e = existing.get([l.team_id_from, l.season_from, l.team_id_to, l.season_to].join('|')); await sb.from('team_lineage').update({ status: 'confirmed', reviewed_at: new Date().toISOString() }).eq('id', e.id); }
  console.log(`\nscritto: storico ${histRows.length} · collegamenti nuovi ${rows.length} · confermati dalla coda ${daConfermare.length}`);
})().catch(e => { console.error('ERRORE FATALE', e); process.exit(1); });
