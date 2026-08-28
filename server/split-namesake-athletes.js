'use strict';
// Separa i "falsi omonimi": atleti diversi che ciclismo.info/il nostro
// import hanno unito sotto lo stesso atleta_id solo perché condividono lo
// stesso nome normalizzato (bug scoperto dall'utente su RINALDI_LUCA — due
// persone reali, una 2008-2010 Juniores→Elite, una 2017-2025
// Esordienti→Elite, impossibile che sia la stessa persona).
//
// PASSO 1 — clustering: per ogni atleta_id condiviso da più ciclismo_id,
// ordina i ciclismo_id per primo anno e raggruppali in "cluster"
// cronologicamente coerenti (una persona che avanza di categoria negli
// anni). Quando un ciclismo_id successivo nel tempo mostra una categoria
// molto più giovane di quella già raggiunta da un cluster precedente, è
// un'altra persona: apre un nuovo cluster.
//
// PASSO 2 — righe "orfane" (senza ciclismo_id, solo atleta_id: PCS,
// entity_overrides, manual_results, athlete_profiles...): si prova ad
// assegnarle al cluster giusto usando data di nascita (ciclismo_athletes.
// data_nascita) e sovrapposizione di anni (season/data). Se il segnale è
// chiaro per UN solo cluster, la riga viene spostata sul nuovo atleta_id
// insieme al resto del cluster; se resta ambigua, il gruppo NON viene
// diviso in automatico ed è elencato come "da rivedere a mano".
// athlete_follows non ha nessun dato utile a capire la persona giusta, ma
// non blocca lo split: resta semplicemente attaccato all'atleta_id
// "canonico" (nessuna perdita di dati, solo eventualmente un follow che
// resta sulla persona sbagliata, recuperabile a mano).
//
// Il cluster con più risultati totali resta sull'atleta_id originale
// (identità "canonica"); gli altri ricevono un nuovo atleta_id con
// suffisso (stesso schema usato a mano per Rinaldi Luca: RINALDI_LUCA_2008).
//
// Uso:
//   node split-namesake-athletes.js            → solo report (dry-run)
//   node split-namesake-athletes.js --apply     → applica gli split sicuri

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
const ws = require('ws');

const SUPABASE_URL = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta SUPABASE_SECRET in server/.env.local'); process.exit(1); }

const APPLY = process.argv.includes('--apply');

const CAT_RANK = {
  ESORDIENTI1: 1, ESORDIENTI2: 1, ESORDIENTI: 1,
  ALLIEVI1: 2, ALLIEVI2: 2, ALLIEVI: 2,
  JUNIORES: 3,
  ELITE_UNDER23: 4, UNDER23: 4, ELITE: 4, 'ELITE-U23': 4, ELITE_ORDER23: 4,
};
function rankOf(cat) { return CAT_RANK[(cat || '').toUpperCase()] ?? 3; }
// Età tipica al primo anno in cui si vede quella categoria (usata per stimare
// l'anno di nascita implicito di un cluster quando manca data_nascita reale).
const TYPICAL_AGE_AT_RANK = { 1: 13, 2: 15, 3: 17, 4: 20 };

// orderCol: colonna stabile per paginare — senza, PostgREST non garantisce
// pagine stabili se la tabella viene modificata da altri script MENTRE la si
// scansiona (righe saltate silenziosamente, successo dal vivo su un altro
// script gemello — segnalato dall'utente). Va indicata per ogni tabella che
// viene letta mentre qualche scraper può starci scrivendo sopra.
async function fetchAll(sb, table, select, extra, orderCol) {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(select);
    if (orderCol) q = q.order(orderCol);
    q = q.range(from, from + PAGE - 1);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

function yearOf(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  console.log('Carico ciclismo_athletes…');
  const athletes = await fetchAll(sb, 'ciclismo_athletes', 'ciclismo_id, nome_completo, atleta_id, data_nascita', null, 'ciclismo_id');

  const byAtletaId = new Map();
  const dobByCiclismoId = new Map();
  for (const a of athletes) {
    if (!byAtletaId.has(a.atleta_id)) byAtletaId.set(a.atleta_id, []);
    byAtletaId.get(a.atleta_id).push(a.ciclismo_id);
    const y = yearOf(a.data_nascita);
    if (y) dobByCiclismoId.set(a.ciclismo_id, y);
  }
  const sharedAtletaIds = [...byAtletaId.entries()].filter(([, ids]) => new Set(ids).size > 1).map(([id]) => id);
  console.log(`atleta_id condivisi da più ciclismo_id: ${sharedAtletaIds.length}\n`);

  console.log('Carico ciclismo_results per quei ciclismo_id…');
  const relevantCiclismoIds = new Set(sharedAtletaIds.flatMap(id => byAtletaId.get(id)));
  const results = await fetchAll(sb, 'ciclismo_results', 'ciclismo_id, atleta_id, stagione, categoria',
    q => q.in('atleta_id', sharedAtletaIds), 'id');

  const perId = new Map(); // ciclismo_id -> {firstYear, lastYear, minRank, maxRank, nGare}
  for (const r of results) {
    if (!relevantCiclismoIds.has(r.ciclismo_id)) continue;
    const y = parseInt(r.stagione, 10);
    const rk = rankOf(r.categoria);
    let e = perId.get(r.ciclismo_id);
    if (!e) { e = { firstYear: y, lastYear: y, minRank: rk, maxRank: rk, nGare: 0 }; perId.set(r.ciclismo_id, e); }
    e.firstYear = Math.min(e.firstYear, y);
    e.lastYear = Math.max(e.lastYear, y);
    e.minRank = Math.min(e.minRank, rk);
    e.maxRank = Math.max(e.maxRank, rk);
    e.nGare++;
  }

  console.log('Carico righe "orfane" collegate solo per atleta_id (PCS, override, manuali…)…');
  const [overrides, follows, profiles, pcsResults, pcsTeam, pcsGara, pcsFull, manualRes] = await Promise.all([
    fetchAll(sb, 'entity_overrides', 'id, entity_id, field, new_value', q => q.eq('entity_type', 'atleta').in('entity_id', sharedAtletaIds)),
    fetchAll(sb, 'athlete_follows', 'atleta_id', q => q.in('atleta_id', sharedAtletaIds)),
    fetchAll(sb, 'athlete_profiles', 'id, atleta_id, birth_year, team', q => q.in('atleta_id', sharedAtletaIds)),
    fetchAll(sb, 'pcs_results', 'id, atleta_id, season', q => q.in('atleta_id', sharedAtletaIds)),
    fetchAll(sb, 'pcs_team_history', 'atleta_id, season', q => q.in('atleta_id', sharedAtletaIds)),
    fetchAll(sb, 'pcs_gara_results', 'id, atleta_id, season', q => q.in('atleta_id', sharedAtletaIds)),
    fetchAll(sb, 'pcs_race_full_results', 'id, atleta_id, season', q => q.in('atleta_id', sharedAtletaIds)),
    fetchAll(sb, 'manual_results', 'id, atleta_id, data, categoria', q => q.in('atleta_id', sharedAtletaIds)),
  ]);

  const plan = [];
  let nBlocked = 0, nNoConflict = 0;
  const blockedReport = [];

  for (const atletaId of sharedAtletaIds.sort()) {
    const ids = [...new Set(byAtletaId.get(atletaId))];
    const recs = ids.map(id => ({ id, ...(perId.get(id) || { firstYear: 9999, lastYear: 9999, minRank: 3, maxRank: 3, nGare: 0 }) }))
      .sort((a, b) => a.firstYear - b.firstYear);

    // Clustering cronologico greedy.
    const clusters = [];
    for (const r of recs) {
      let placed = false;
      for (const c of clusters) {
        const conflict = r.firstYear > c.lastYear && r.minRank < c.maxRank - 1;
        if (!conflict) {
          c.ids.push(r.id);
          c.firstYear = Math.min(c.firstYear, r.firstYear);
          c.lastYear = Math.max(c.lastYear, r.lastYear);
          c.minRank = Math.min(c.minRank, r.minRank);
          c.maxRank = Math.max(c.maxRank, r.maxRank);
          c.nGare += r.nGare;
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push({ ids: [r.id], firstYear: r.firstYear, lastYear: r.lastYear, minRank: r.minRank, maxRank: r.maxRank, nGare: r.nGare });
    }
    if (clusters.length < 2) { nNoConflict++; continue; }

    // Anno di nascita per cluster: media delle data_nascita reali note; se
    // nessuna, stima dall'età tipica alla categoria del primo anno.
    for (const c of clusters) {
      const dobs = c.ids.map(id => dobByCiclismoId.get(id)).filter(Boolean);
      c.dob = dobs.length ? Math.round(dobs.reduce((a, b) => a + b, 0) / dobs.length) : (c.firstYear - TYPICAL_AGE_AT_RANK[c.minRank]);
      c.dobReal = dobs.length > 0;
    }

    // Il cluster "canonico" (resta sull'atleta_id originale, nessuna riga
    // orfana va spostata per lui) va deciso PRIMA di risolvere le righe
    // orfane: se una riga è compatibile anche solo alla pari col canonico,
    // il default sicuro è lasciarla dov'è (nessuno spostamento, nessun
    // blocco) — bloccare serve solo quando bisogna DAVVERO spostarla su un
    // cluster "scisso" e non è chiaro quale.
    const clustersSorted = [...clusters].sort((a, b) => (b.nGare - a.nGare) || (b.lastYear - a.lastYear));
    const keepCluster = clustersSorted[0];

    // Prova ad assegnare ogni riga orfana al cluster giusto.
    const moves = []; // { table, idField, idValue, newAtletaId }
    const unresolved = [];

    function assign(dists, label, idFor, table, idField) {
      // dists: [{c, d}] già ordinato per distanza crescente.
      if (dists[0].c === keepCluster) return; // resta com'è, nessun blocco.
      if (dists.length >= 2 && dists[0].d < dists[1].d) {
        moves.push({ table, idField, idValue: idFor, cluster: dists[0].c });
      } else {
        unresolved.push(`${label} (ambiguo tra più cluster non canonici)`);
      }
    }

    function resolveByYear(rows, table, idField, yearFn, label) {
      for (const row of rows.filter(r => r.entity_id === atletaId || r.atleta_id === atletaId)) {
        const y = yearFn(row);
        const rid = row.id ?? row.entity_id ?? atletaId;
        if (!y) { unresolved.push(`${label} id=${rid} (nessun anno leggibile)`); continue; }
        // range accettato per cluster: [firstYear, lastYear+3] con qualche
        // tolleranza, per coprire una carriera pro iniziata subito dopo
        // l'ultimo anno amatoriale noto.
        const matches = clusters.filter(c => y >= c.firstYear - 1 && y <= c.lastYear + 3);
        if (matches.some(c => c === keepCluster)) continue; // ok anche per il canonico, non serve spostare.
        if (matches.length === 1) {
          moves.push({ table, idField, idValue: rid, cluster: matches[0] });
        } else if (matches.length === 0) {
          unresolved.push(`${label} id=${rid} anno=${y} (fuori da ogni cluster)`);
        } else {
          unresolved.push(`${label} id=${rid} anno=${y} (ambiguo tra ${matches.length} cluster)`);
        }
      }
    }

    // entity_overrides anno_nascita → confronta con dob di ogni cluster.
    for (const row of overrides.filter(r => r.entity_id === atletaId && r.field === 'anno_nascita')) {
      const val = parseInt(row.new_value, 10);
      if (!val) { unresolved.push(`entity_overrides id=${row.id} valore non numerico`); continue; }
      const dists = clusters.map(c => ({ c, d: Math.abs(c.dob - val) })).sort((a, b) => a.d - b.d);
      assign(dists, `entity_overrides id=${row.id} anno_nascita=${val}`, row.id, 'entity_overrides', 'id');
    }

    resolveByYear(pcsResults, 'pcs_results', 'id', r => r.season, 'pcs_results');
    resolveByYear(pcsTeam.map((r, i) => ({ ...r, id: `${r.atleta_id}|${r.season}` })), 'pcs_team_history', 'atleta_id_season', r => r.season, 'pcs_team_history');
    resolveByYear(pcsGara, 'pcs_gara_results', 'id', r => r.season, 'pcs_gara_results');
    resolveByYear(pcsFull, 'pcs_race_full_results', 'id', r => r.season, 'pcs_race_full_results');
    resolveByYear(manualRes, 'manual_results', 'id', r => yearOf(r.data) || rankOf(r.categoria) && null, 'manual_results');

    // athlete_profiles: prova birth_year, poi non blocca comunque (vedi sotto)
    // athlete_follows: mai bloccante, nessun dato da spostare.
    const profileRows = profiles.filter(r => r.atleta_id === atletaId);
    for (const row of profileRows) {
      if (row.birth_year) {
        const dists = clusters.map(c => ({ c, d: Math.abs(c.dob - row.birth_year) })).sort((a, b) => a.d - b.d);
        assign(dists, `athlete_profiles id=${row.id} birth_year=${row.birth_year}`, row.id, 'athlete_profiles', 'id');
      } else {
        unresolved.push(`athlete_profiles id=${row.id} (profilo utente reale senza anno di nascita — richiede conferma)`);
      }
    }

    if (unresolved.length) {
      nBlocked++;
      blockedReport.push({ atletaId, clusters, unresolved });
      continue;
    }

    // Tutto risolto (o non c'era nulla da risolvere): procedi con lo split.
    const keep = keepCluster;
    const splits = clusters.filter(c => c !== keep).map(c => ({
      newId: `${atletaId}_${c.firstYear}`, cluster: c, ids: c.ids, firstYear: c.firstYear, lastYear: c.lastYear, dob: c.dob, dobReal: c.dobReal,
    }));
    const movesForSplit = moves.filter(m => splits.some(s => s.cluster === m.cluster))
      .map(m => ({ ...m, newId: splits.find(s => s.cluster === m.cluster).newId }));

    plan.push({ atletaId, keep, splits, moves: movesForSplit });
  }

  console.log(`\n=== Casi bloccati (richiedono revisione manuale) ===`);
  for (const b of blockedReport) {
    console.log(`\n⚠️  ${b.atletaId}`);
    for (const c of b.clusters) console.log(`     cluster ${c.firstYear}-${c.lastYear} (rank ${c.minRank}-${c.maxRank}, ${c.nGare} gare, nato~${c.dob}${c.dobReal ? '' : ' stimato'}): ${c.ids.join(', ')}`);
    for (const u of b.unresolved) console.log(`     ✗ ${u}`);
  }

  console.log(`\n=== Piano split automatici ===`);
  console.log(`Gruppi senza conflitto reale: ${nNoConflict}`);
  console.log(`Gruppi bloccati (sopra): ${nBlocked}`);
  console.log(`Gruppi da dividere in automatico: ${plan.length}\n`);
  for (const p of plan) {
    console.log(`${p.atletaId}: resta su [${p.keep.ids.join(',')}] (${p.keep.firstYear}-${p.keep.lastYear}, ${p.keep.nGare} gare)`);
    for (const s of p.splits) console.log(`   → nuovo id ${s.newId} per [${s.ids.join(',')}] (${s.firstYear}-${s.lastYear})`);
    for (const m of p.moves) console.log(`   → sposto ${m.table}#${m.idValue} su ${m.newId}`);
  }

  if (!APPLY) { console.log(`\n(dry-run — rilancia con --apply per applicare davvero)`); return; }

  console.log(`\n=== Applico ===`);
  let done = 0;
  for (const p of plan) {
    for (const s of p.splits) {
      const { error: e1 } = await sb.from('ciclismo_athletes').update({ atleta_id: s.newId }).in('ciclismo_id', s.ids);
      if (e1) { console.log(`  ✗ ${s.newId} ciclismo_athletes: ${e1.message}`); continue; }
      const { error: e2 } = await sb.from('ciclismo_results').update({ atleta_id: s.newId }).in('ciclismo_id', s.ids);
      if (e2) { console.log(`  ✗ ${s.newId} ciclismo_results: ${e2.message}`); continue; }
      const { error: e3 } = await sb.from('ciclismo_gara_media').update({ atleta_id: s.newId }).in('ciclismo_id', s.ids);
      if (e3) console.log(`  ⚠ ${s.newId} ciclismo_gara_media: ${e3.message}`);
      done++;
      console.log(`  ✓ ${p.atletaId} → ${s.newId} (ciclismo_id ${s.ids.join(',')})`);
    }
    for (const m of p.moves) {
      if (m.table === 'pcs_team_history') {
        const [aId, season] = String(m.idValue).split('|');
        const { error } = await sb.from('pcs_team_history').update({ atleta_id: m.newId }).eq('atleta_id', aId).eq('season', season);
        if (error) console.log(`  ⚠ pcs_team_history ${m.idValue} → ${m.newId}: ${error.message}`);
        else console.log(`  ✓ pcs_team_history ${m.idValue} → ${m.newId}`);
        continue;
      }
      const idField = 'id';
      const updateField = m.table === 'entity_overrides' ? { entity_id: m.newId } : { atleta_id: m.newId };
      const { error } = await sb.from(m.table).update(updateField).eq(idField, m.idValue);
      if (error) console.log(`  ⚠ ${m.table}#${m.idValue} → ${m.newId}: ${error.message}`);
      else console.log(`  ✓ ${m.table}#${m.idValue} → ${m.newId}`);
    }
  }
  console.log(`\n=== FATTO === split applicati: ${done}`);
}

main().catch(e => { console.error('ERRORE FATALE', e); process.exit(1); });
