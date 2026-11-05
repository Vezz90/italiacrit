'use strict';
// Valuta se più schede ciclismo.info sotto lo stesso atleta_id sono la stessa
// persona (schede doppie della federazione) o persone diverse (omonimi).
// Solo funzioni pure: i dati li carica chi chiama (server.js o gli script).
//
// Indizi usati, tutti ricavati dai risultati:
//  - stessa gara (data + nome) presente in due schede → persone diverse: una
//    persona non compare due volte nella stessa classifica;
//  - anno di nascita di ciclismo.info (±1 = stessa persona, come deciso);
//  - età stimata dalla categoria del primo anno di gare;
//  - le stagioni si susseguono senza sovrapposizione e la categoria non scende;
//  - stessa squadra in stagioni vicine.

const AGE = { ESORDIENTI1: 12, ESORDIENTI2: 13, ALLIEVI: 15, ALLIEVI1: 14, ALLIEVI2: 15, JUNIORES: 17, ELITE_UNDER23: 19 };
const RANK = { ESORDIENTI1: 1, ESORDIENTI2: 1, ALLIEVI: 2, ALLIEVI1: 2, ALLIEVI2: 2, JUNIORES: 3, ELITE_UNDER23: 4 };

const norm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();

// results: righe ciclismo_results della scheda. anno: anno di nascita noto o null.
function riassumiScheda(cid, results, anno) {
  const ys = results.map(r => +r.stagione).filter(Boolean);
  const first = ys.length ? Math.min(...ys) : null, last = ys.length ? Math.max(...ys) : null;
  const rowFirst = results.find(r => +r.stagione === first);
  const teams = {};
  const teamBySeason = {};
  for (const r of results) {
    teams[r.team] = (teams[r.team] || 0) + 1;
    (teamBySeason[r.stagione] = teamBySeason[r.stagione] || new Set()).add(norm(r.team));
  }
  const races = new Set(results.map(r => (r.data || r.stagione) + '|' + norm(r.nome_gara)));
  const pos = new Map(results.map(r => [(r.data || r.stagione) + '|' + norm(r.nome_gara), r.posizione]));
  const days = new Set(results.map(r => r.data).filter(Boolean));
  const cats = [...new Set(results.map(r => r.categoria))];
  const maxRank = Math.max(0, ...results.map(r => RANK[r.categoria] || 0));
  const minRank = results.length ? Math.min(...results.map(r => RANK[r.categoria] || 9)) : 0;
  return {
    cid, anno: anno || null, gare: results.length, da: first, a: last, cats,
    teams: Object.entries(teams).sort((x, y) => y[1] - x[1]).slice(0, 3).map(x => x[0]),
    stimaNascita: first && rowFirst && AGE[rowFirst.categoria] ? first - AGE[rowFirst.categoria] : null,
    _races: races, _pos: pos, _days: days, _teamBySeason: teamBySeason, _minRank: minRank, _maxRank: maxRank,
    _firstRank: rowFirst ? (RANK[rowFirst.categoria] || 0) : 0,
  };
}

// Confronto fra due schede: punteggio > 0 = stessa persona, < 0 = diverse.
function confronta(A, B) {
  let score = 0; const motivi = [];
  const add = (p, t) => { score += p; motivi.push({ p, t }); };

  // Gara presente in entrambe le schede: se il piazzamento è lo stesso è la
  // stessa riga duplicata (la federazione ha due schede per la stessa persona);
  // se è diverso sono due persone nella stessa classifica.
  let uguali = 0, diversi = 0;
  for (const k of A._races) if (B._races.has(k)) { if (A._pos.get(k) === B._pos.get(k)) uguali++; else diversi++; }
  if (diversi) add(-6, `${diversi} ${diversi === 1 ? 'gara compare' : 'gare compaiono'} in entrambe le schede con piazzamenti diversi: sono due persone nella stessa classifica`);
  if (uguali) add(Math.min(4, uguali + 1), `${uguali} ${uguali === 1 ? 'gara compare' : 'gare compaiono'} in entrambe le schede con lo stesso piazzamento: è la stessa persona con due schede`);
  const comuni = uguali + diversi;
  if (!comuni && A.gare && B.gare) add(1, 'nessuna gara in comune');

  let stessoGiorno = 0; for (const d of A._days) if (B._days.has(d)) stessoGiorno++;
  if (stessoGiorno && !comuni) add(-2, `${stessoGiorno} ${stessoGiorno === 1 ? 'giorno' : 'giorni'} con gare diverse nelle due schede`);

  if (A.anno && B.anno) {
    const d = Math.abs(A.anno - B.anno);
    if (d === 0) add(2, `stesso anno di nascita (${A.anno})`);
    else if (d === 1) add(1, `anni di nascita ${A.anno} e ${B.anno}, differenza di un anno`);
    else add(-4, `anni di nascita ${A.anno} e ${B.anno}`);
  }

  if (A.gare && B.gare) {
    if (A.stimaNascita && B.stimaNascita) {
      const g = Math.abs(A.stimaNascita - B.stimaNascita);
      if (g >= 3) add(-2, `dalla categoria risultano nati a ${g} anni di distanza (~${A.stimaNascita} e ~${B.stimaNascita})`);
    }
    const [P, Q] = A.da <= B.da ? [A, B] : [B, A];
    const sov = P.a >= Q.da;
    if (!sov) {
      const buco = Q.da - P.a;
      if (Q._minRank >= P._maxRank && buco <= 2) add(2, `le stagioni si susseguono (${P.da}–${P.a}, poi ${Q.da}–${Q.a}) con categoria che non scende`);
      else if (Q._minRank < P._maxRank) add(-3, `dopo ${P.a} la categoria torna più bassa nel ${Q.da}: non è la stessa carriera`);
    } else {
      add(-1, `stagioni sovrapposte (${P.da}–${P.a} e ${Q.da}–${Q.a})`);
    }
    // stessa squadra in stagioni vicine
    let team = null;
    for (const sA of Object.keys(A._teamBySeason)) for (const sB of Object.keys(B._teamBySeason)) {
      if (Math.abs(sA - sB) <= 1) for (const t of A._teamBySeason[sA]) if (t && B._teamBySeason[sB].has(t)) team = team || t;
    }
    if (team) add(2, 'stessa squadra in stagioni vicine');
  }
  return { score, motivi };
}

// schede: array di riassumiScheda(). Restituisce verdetto del gruppo e
// suddivisione suggerita (componenti connesse delle coppie non "diverse").
function valutaGruppo(schede) {
  const coppie = [];
  const con = schede.filter(s => s.gare);
  for (let i = 0; i < schede.length; i++) for (let j = i + 1; j < schede.length; j++) {
    const A = schede[i], B = schede[j];
    if (!A.gare && !B.gare) continue;
    const r = confronta(A, B);
    coppie.push({ a: A.cid, b: B.cid, score: r.score, motivi: r.motivi });
  }
  const diversa = c => c.score <= -3;
  const stessa = c => c.score >= 2;
  // componenti: unisco le schede NON dimostrabilmente diverse
  const parent = new Map(schede.map(s => [s.cid, s.cid]));
  const find = x => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  for (const c of coppie) if (!diversa(c)) parent.set(find(c.a), find(c.b));
  const comp = {};
  for (const s of schede) (comp[find(s.cid)] = comp[find(s.cid)] || []).push(s.cid);
  const gruppi = Object.values(comp);
  let verdetto;
  if (!coppie.length) verdetto = 'stessa';
  else if (coppie.every(stessa)) verdetto = 'stessa';
  else if (coppie.some(diversa)) verdetto = 'diverse';
  else verdetto = 'dubbio';
  return { verdetto, coppie, gruppi: gruppi.length > 1 ? gruppi : null, conGare: con.length };
}

module.exports = { riassumiScheda, confronta, valutaGruppo };
