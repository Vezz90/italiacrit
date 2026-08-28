'use strict';
// Guardia anti-omonimia, da richiamare OGNI VOLTA che uno scraper scopre/
// aggiorna la data di nascita di un ciclismo_id (ciclismo-backfill.js,
// ciclismo-import-single.js) — cioè il momento esatto in cui poteva
// nascere un caso come RINALDI_LUCA: due persone reali diverse unite sotto
// lo stesso atleta_id perché condividono il nome normalizzato, scoperto
// SOLO dopo che uno dei due mostrava una carriera cronologicamente
// impossibile (Juniores 2008, poi di nuovo Esordiente nel 2017).
//
// A differenza di split-namesake-athletes.js (bonifica una tantum, scansiona
// TUTTO il database), questo modulo è scoped a UN SOLO atleta_id e pensato
// per girare inline dentro gli scraper mentre lavorano: costa una manciata
// di query, non un giro completo su 20mila righe. Stessa identica logica di
// clustering/risoluzione, solo applicata subito invece che aspettare la
// prossima bonifica manuale — e crea anche il profilo manual_athletes per
// l'eventuale nuovo id scisso, cosa che la prima volta avevo dimenticato di
// fare (causa del 404 su RINALDI_LUCA_2008 scoperto dall'utente).
//
// Uso: const { checkAndSplitAtleta } = require('./namesake-guard');
//      await checkAndSplitAtleta(sb, atletaId).catch(() => {}); // mai bloccante

const fs = require('fs');
const path = require('path');

const CAT_RANK = {
  ESORDIENTI1: 1, ESORDIENTI2: 1, ESORDIENTI: 1,
  ALLIEVI1: 2, ALLIEVI2: 2, ALLIEVI: 2,
  JUNIORES: 3,
  ELITE_UNDER23: 4, UNDER23: 4, ELITE: 4, 'ELITE-U23': 4, ELITE_ORDER23: 4,
};
function rankOf(cat) { return CAT_RANK[(cat || '').toUpperCase()] ?? 3; }
const TYPICAL_AGE_AT_RANK = { 1: 13, 2: 15, 3: 17, 4: 20 };
const CAT_MAP = {
  ESORDIENTI1: 'ES1_M', ESORDIENTI2: 'ES2_M', ALLIEVI: 'AL_M', JUNIORES: 'JUN_M', ELITE_UNDER23: 'ELI_M',
  DONNE_ESORDIENTI: 'AL_F', DONNE_ALLIEVE: 'AL_F', DONNE_JUNIORES: 'JUN_F',
};

function yearOf(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

let _teamIdByName = null;
function teamIdFor(teamName) {
  if (!teamName) return null;
  if (!_teamIdByName) {
    try {
      const teams = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'teams.json'), 'utf8'));
      _teamIdByName = new Map(Object.values(teams).map(t => [String(t.nome || '').trim().toUpperCase(), t.id]));
    } catch { _teamIdByName = new Map(); }
  }
  const key = teamName.trim().toUpperCase();
  return _teamIdByName.get(key)
    || key.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Controlla se atletaId nasconde più persone reali (stesso schema di
 * split-namesake-athletes.js: clustering cronologico per categoria/anno,
 * poi conferma via data di nascita quando nota) e, se sì, separa subito i
 * cluster non ambigui creando un nuovo atleta_id con suffisso "_ANNO" — il
 * cluster più corposo resta sull'id originale. Casi ambigui (dati che non
 * distinguono chiaramente le persone) NON vengono toccati: restano per la
 * prossima bonifica con split-namesake-athletes.js.
 *
 * @returns {Promise<string[]>} nuovi atleta_id creati (vuoto se nessuno split)
 */
async function checkAndSplitAtleta(sb, atletaId) {
  if (!atletaId) return [];

  const { data: athletes, error: eAth } = await sb.from('ciclismo_athletes')
    .select('ciclismo_id, nome_completo, data_nascita').eq('atleta_id', atletaId);
  if (eAth || !athletes || athletes.length < 2) return []; // niente da controllare

  const { data: results, error: eRes } = await sb.from('ciclismo_results')
    .select('ciclismo_id, stagione, categoria').eq('atleta_id', atletaId);
  if (eRes) return [];

  const perId = new Map();
  for (const r of results || []) {
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

  const recs = athletes.map(a => ({ id: a.ciclismo_id, ...(perId.get(a.ciclismo_id) || { firstYear: 9999, lastYear: 9999, minRank: 3, maxRank: 3, nGare: 0 }) }))
    .sort((a, b) => a.firstYear - b.firstYear);

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
  if (clusters.length < 2) return []; // un solo cluster: nessuna omonimia rilevata

  const dobByCiclismoId = new Map(athletes.map(a => [a.ciclismo_id, yearOf(a.data_nascita)]).filter(([, y]) => y));
  for (const c of clusters) {
    const dobs = c.ids.map(id => dobByCiclismoId.get(id)).filter(Boolean);
    c.dob = dobs.length ? Math.round(dobs.reduce((a, b) => a + b, 0) / dobs.length) : (c.firstYear - TYPICAL_AGE_AT_RANK[c.minRank]);
    c.dobReal = dobs.length > 0;
  }

  // Conferma via data di nascita quando nota su ALMENO due cluster: se
  // discordano di pochi anni può essere solo imprecisione della fonte, non
  // due persone — richiediamo un divario netto prima di agire in automatico
  // e senza supervisione.
  const withRealDob = clusters.filter(c => c.dobReal);
  if (withRealDob.length >= 2) {
    const spread = Math.max(...withRealDob.map(c => c.dob)) - Math.min(...withRealDob.map(c => c.dob));
    if (spread < 4) return []; // troppo vicine per essere sicuri: lascia stare
  }
  // Se nessun cluster ha una data di nascita reale, il solo salto di
  // categoria/anno (già filtrato dal clustering sopra) resta un indizio più
  // debole: procede comunque, stessa soglia già usata nella bonifica di
  // stanotte (rank differisce di 2+ con anni non sovrapposti).

  // Righe "orfane" (solo atleta_id, non ciclismo_id) che potrebbero riguardare
  // uno dei cluster non canonici: se ce ne sono e sono ambigue, meglio non
  // toccare nulla e lasciare il caso alla prossima bonifica completa.
  const [overrides, profiles, pcsResults, pcsTeam, manualRes] = await Promise.all([
    sb.from('entity_overrides').select('id, field, new_value').eq('entity_type', 'atleta').eq('entity_id', atletaId).then(r => r.data || []),
    sb.from('athlete_profiles').select('id, birth_year').eq('atleta_id', atletaId).then(r => r.data || []),
    sb.from('pcs_results').select('id, season').eq('atleta_id', atletaId).then(r => r.data || []),
    sb.from('pcs_team_history').select('season').eq('atleta_id', atletaId).then(r => r.data || []),
    sb.from('manual_results').select('id, data').eq('atleta_id', atletaId).then(r => r.data || []),
  ]);

  clusters.sort((a, b) => (b.nGare - a.nGare) || (b.lastYear - a.lastYear));
  const keep = clusters[0];
  const splits = clusters.slice(1);

  function belongsElsewhere(year) {
    if (!year) return null; // nessun anno leggibile: non blocca, semplicemente non si sposta nulla
    if (year >= keep.firstYear - 1 && year <= keep.lastYear + 3) return 'keep';
    const matches = splits.filter(c => year >= c.firstYear - 1 && year <= c.lastYear + 3);
    if (matches.length === 1) return matches[0];
    return 'ambiguous';
  }

  let ambiguous = false;
  const moves = [];
  for (const o of overrides) {
    if (o.field !== 'anno_nascita') continue;
    const val = parseInt(o.new_value, 10);
    if (!val) continue;
    const dists = clusters.map(c => ({ c, d: Math.abs(c.dob - val) })).sort((a, b) => a.d - b.d);
    if (dists[0].c === keep) continue;
    if (dists.length >= 2 && dists[0].d < dists[1].d) moves.push({ table: 'entity_overrides', id: o.id, field: 'entity_id', cluster: dists[0].c });
    else ambiguous = true;
  }
  for (const p of profiles) {
    if (!p.birth_year) { ambiguous = true; continue; }
    const dists = clusters.map(c => ({ c, d: Math.abs(c.dob - p.birth_year) })).sort((a, b) => a.d - b.d);
    if (dists[0].c === keep) continue;
    if (dists.length >= 2 && dists[0].d < dists[1].d) moves.push({ table: 'athlete_profiles', id: p.id, field: 'atleta_id', cluster: dists[0].c });
    else ambiguous = true;
  }
  for (const r of pcsResults) {
    const target = belongsElsewhere(r.season);
    if (target === 'ambiguous') ambiguous = true;
    else if (target && target !== 'keep') moves.push({ table: 'pcs_results', id: r.id, field: 'atleta_id', cluster: target });
  }
  for (const r of manualRes) {
    const target = belongsElsewhere(yearOf(r.data));
    if (target === 'ambiguous') ambiguous = true;
    else if (target && target !== 'keep') moves.push({ table: 'manual_results', id: r.id, field: 'atleta_id', cluster: target });
  }
  if (ambiguous) return []; // lascia il caso intero alla prossima bonifica manuale

  const createdIds = [];
  for (const c of splits) {
    const newId = `${atletaId}_${c.firstYear}`;
    await sb.from('ciclismo_athletes').update({ atleta_id: newId }).in('ciclismo_id', c.ids);
    await sb.from('ciclismo_results').update({ atleta_id: newId }).in('ciclismo_id', c.ids);
    await sb.from('ciclismo_gara_media').update({ atleta_id: newId }).in('ciclismo_id', c.ids);
    for (const m of moves.filter(m => m.cluster === c)) {
      await sb.from(m.table).update({ [m.field]: newId }).eq('id', m.id);
    }

    // Profilo manual_athletes per il nuovo id — senza, la scheda profilo dà
    // 404 (bug reale scoperto la prima volta su RINALDI_LUCA_2008).
    const { data: lastResult } = await sb.from('ciclismo_results')
      .select('team, categoria, stagione').eq('atleta_id', newId).order('stagione', { ascending: false }).limit(1).maybeSingle();
    const nomeCompleto = athletes.find(a => c.ids.includes(a.ciclismo_id))?.nome_completo || atletaId.replace(/_/g, ' ');
    const nomeParts = String(nomeCompleto).trim().split(/\s+/);
    const cognome = nomeParts[0] || nomeCompleto;
    const nome = nomeParts.slice(1).join(' ') || '-';
    const catRaw = (lastResult && lastResult.categoria) || '';
    const genere = /DONNE/i.test(catRaw) ? 'F' : 'M';
    const categoria = CAT_MAP[catRaw] || (genere === 'F' ? 'AL_F' : 'AL_M');
    const team = (lastResult && lastResult.team) || null;
    await sb.from('manual_athletes').upsert({
      atleta_id: newId, cognome, nome, team_id: teamIdFor(team), team, categoria, genere,
      created_by: null, source: 'ciclismo_info',
    }, { onConflict: 'atleta_id', ignoreDuplicates: true });

    createdIds.push(newId);
    console.log(`  [namesake-guard] omonimia separata: ${atletaId} → ${newId} (ciclismo_id ${c.ids.join(',')})`);
  }
  return createdIds;
}

module.exports = { checkAndSplitAtleta };
