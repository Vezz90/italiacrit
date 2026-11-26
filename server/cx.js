// Ciclocross lato server (articoli di gara e disciplina parallela).
// Le righe di data/ciclocross vengono portate nello stesso formato di results_raw.json, con le STESSE regole di ciclocross.js:
// stesso gara_id, Esordienti con la posizione della propria categoria, 1° e 2° anno delle altre categorie in un'unica classifica.
'use strict';

const CAT_LABEL = { ELI: 'Elite-Under23', JUN: 'Juniores', AL: 'Allievi', ES1: 'Esordienti 1° Anno', ES2: 'Esordienti 2° Anno' };
const slug = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

function buildCx(cal, res) {
  const gare = {};
  for (const g of cal || []) gare[g.fci_id] = g;
  const list = (res || []).map(r => ({ ...r, _pc: 0 }));
  const gruppi = (soloEs) => {
    const m = {};
    for (const r of list) { if (parseInt(r.pos, 10) >= 1 && /^ES[12]_/.test(r.cat) === soloEs) ((m[r.gara + '|' + r.cat] ||= {})[r.gruppo] ||= []).push(r); }
    return Object.values(m).map(g => Object.values(g));
  };
  for (const gs of gruppi(true)) {
    const all = gs.flat();
    const disjoint = gs.length > 1 && new Set(all.map(x => parseInt(x.pos, 10))).size === all.length;
    for (const unit of (disjoint ? [all] : gs)) {
      const ps = [...new Set(unit.map(x => parseInt(x.pos, 10)))].sort((a, b) => a - b);
      for (const x of unit) x._pc = ps.indexOf(parseInt(x.pos, 10)) + 1;
    }
  }
  for (const gs of gruppi(false)) {
    const all = gs.flat();
    if (gs.length < 2 || new Set(all.map(x => parseInt(x.pos, 10))).size === all.length) continue;
    const yr = (x) => parseInt((String(x.gruppo).match(/(\d)\s*$/) || [0, 0])[1], 10) || 0;
    all.sort((a, b) => (parseInt(a.pos, 10) - parseInt(b.pos, 10)) || (yr(b) - yr(a))).forEach((x, i) => { x._pc = i + 1; });
  }
  const rows = [], calendar = [], seen = new Set();
  for (const r of list) {
    const g = gare[r.gara]; if (!g || !g.data) continue;
    const pos = r._pc || parseInt(r.pos, 10); if (!(pos >= 1)) continue;
    const calId = `${slug(g.nome)}_${g.data}`;
    const base = r.cat.replace(/_[MF]$/, ''), genere = r.cat.endsWith('_F') ? 'F' : 'M';
    const parts = String(r.nome || '').trim().split(/\s+/);
    const campReg = /campionato regionale/i.test(g.nome), campIt = /campionato italiano/i.test(g.nome) && !/societ/i.test(g.nome);
    if (!seen.has(calId)) {
      seen.add(calId);
      calendar.push({ id: calId, nome: g.nome, data: g.data, tipo: String(g.geo || 'Regionale').toLowerCase(), regione: String(g.regione || '').toUpperCase(), luogo: g.luogo || '', categoria: g.categorie_ammesse || g.classe || '' });
    }
    rows.push({ _cx: true, gara_id: `${calId}_${r.cat}`, nome_gara: g.nome, data: g.data, categoria: CAT_LABEL[base] || base, genere,
      tipo: String(g.geo || 'Regionale').toLowerCase(), campionato_regionale: campReg, campionato_italiano: campIt, regione: String(g.regione || '').toUpperCase(),
      posizione: pos, cognome: parts.shift() || '', nome: parts.join(' '), atleta_id: r.atleta_id, team: r.club || '', team_id: slug(r.club), tempo: '', km: '', media: '' });
  }
  return { rows, calendar };
}

// Riassunto di una stagione (fino a una data compresa) a partire da righe {data, posizione, gara, campionato}
function riassunto(disciplina, stagione, righe) {
  const r = (righe || []).filter(x => x.posizione >= 1);
  if (!r.length) return null;
  const conta = (f) => r.filter(f).length;
  const recenti = [...r].sort((a, b) => String(b.data).localeCompare(String(a.data)));
  const migliori = [...recenti].sort((a, b) => a.posizione - b.posizione);
  return { disciplina, stagione, vittorie: conta(x => x.posizione === 1), podi: conta(x => x.posizione <= 3), piazzamenti_nei_primi_10: conta(x => x.posizione <= 10),
    miglior_piazzamento: migliori[0].posizione, risultati_migliori: migliori.slice(0, 5), ultimo_risultato: recenti[0] };
}

// La stessa cosa in una riga di testo (racconto senza AI)
function frase(nome, s) {
  const pl = (n, uno, tanti) => `${n} ${n === 1 ? uno : tanti}`;
  const dove = s.disciplina === 'strada' ? `su strada nel ${s.stagione}` : `nel ciclocross ${s.stagione}`;
  const cosa = s.podi ? [s.vittorie ? pl(s.vittorie, 'vittoria', 'vittorie') : '', pl(s.podi, 'podio', 'podi')].filter(Boolean).join(' e ') : `miglior piazzamento ${s.miglior_piazzamento}° posto`;
  return `${nome}, ${dove}: ${cosa}.`;
}

module.exports = { buildCx, riassunto, frase, slug };
