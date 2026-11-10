'use strict';
// Funzioni pure della Redazione: dati sportivi uniformi, tutela dei minorenni, titoli regionali, controlli sui fatti.
// Niente rete e niente database qui dentro: si provano da sole (vedi test-redazione-dati.js).

// ---------- numeri e righe di risultato ----------
const numero = v => { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).trim().replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const tondo = (n, d = 2) => { const k = Math.pow(10, d); return Math.round(numero(n) * k) / k; };
// una riga con numeri sicuri: posizione, punti e moltiplicatore sono sempre numeri (mai stringhe da concatenare), la data e sempre AAAA-MM-GG
function normalizzaRiga(r) {
  return { ...r, data: String(r.data == null ? '' : r.data).slice(0, 10), posizione: numero(r.posizione), punti_effettivi: numero(r.punti_effettivi), punti_base: numero(r.punti_base), moltiplicatore: numero(r.moltiplicatore) };
}
const compatta = s => String(s == null ? '' : s).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '');
// scraper + risultati inseriti a mano: la riga dello scraper vince. Stessa riga = stessa gara e stessa posizione, oppure stesso atleta nella stessa gara (stesso giorno e nome)
function uniscRisultati(scraper, manuali) {
  const out = [], primarie = new Set(), secondarie = new Set();
  const chiavi = r => [r.gara_id + '|' + r.posizione, r.atleta_id ? r.data + '|' + r.atleta_id + '|' + compatta(r.nome_gara) : null];
  const aggiungi = (r, origine) => {
    const n = normalizzaRiga(r), [p, s] = chiavi(n);
    if (primarie.has(p) || (s && secondarie.has(s))) return;
    primarie.add(p); if (s) secondarie.add(s);
    out.push(origine ? { ...n, _origine: origine } : n);
  };
  (scraper || []).forEach(r => aggiungi(r, null));
  (manuali || []).forEach(r => aggiungi(r, 'manuale'));
  return out;
}

// ---------- minorenni ----------
// Esordienti, Allievi e Juniores sono minorenni; Elite/Under 23 no. Nel dubbio (categoria sconosciuta) si e prudenti: minorenne.
const GIOVANILI = /^(ES1|ES2|AL|JUN)_[MF]$/;
const ADULTI = /^ELI_[MF]$/;
const minorenneDaCodice = cod => !ADULTI.test(String(cod || ''));
const codiceGiovanile = cod => GIOVANILI.test(String(cod || ''));
// i dati di un articolo toccano dei minorenni? (qualunque categoria giovanile o sconosciuta, o un atleta segnato come minorenne)
function contieneMinorenni(facts) {
  const s = JSON.stringify(facts == null ? {} : facts);
  return /"(?:codice|codice_categoria|categoria_codice|cat)":"(?:ES1|ES2|AL|JUN)_[MF]"/.test(s) || /_(?:ES1|ES2|AL|JUN)_[MF]"/.test(s)
    || /"codice":"\?"/.test(s) || /"minorenne":true/.test(s);
}
const fraseNorm = t => ' ' + String(t || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z]+/g, ' ').trim() + ' ';
// indice cognome -> atleti minorenni (nome e cognome in parole), per riconoscerli in un testo libero
function indiceMinorenni(athletes) {
  const m = new Map();
  for (const a of Object.values(athletes || {})) {
    if (!a || !minorenneDaCodice(a.categoria)) continue;
    const cog = fraseNorm(a.cognome).trim().split(' ').filter(Boolean), nom = fraseNorm(a.nome).trim().split(' ').filter(Boolean);
    if (!cog.length || !nom.length) continue;
    const k = cog.slice().sort((x, y) => y.length - x.length)[0];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push([...cog, ...nom]);
  }
  return m;
}
// il testo nomina (nome e cognome insieme) un atleta minorenne?
function testoNominaMinori(testo, indice) {
  const parole = new Set(fraseNorm(testo).trim().split(' ').filter(Boolean));
  for (const w of parole) { const l = indice.get(w); if (l && l.some(tok => tok.every(t => parole.has(t)))) return true; }
  return false;
}

// ---------- titoli regionali assegnati dal pannello admin ----------
// titoli: righe di regional_champion_titles; flag: campioni ricavati dai flag delle righe di risultato
function unisciCampioniRegionali(flag, titoli, { garaNome = {}, garaData = {} } = {}) {
  const out = [...flag], visti = new Set(flag.map(c => (c.gara_id || '') + '|' + (c.atleta_id || compatta(c.campione))));
  for (const t of titoli || []) {
    const k = (t.gara_id || '') + '|' + (t.atleta_id || compatta(t.atleta_nome));
    if (visti.has(k)) { const e = out.find(c => (c.gara_id || '') + '|' + (c.atleta_id || compatta(c.campione)) === k); if (e && !e.regione && t.regione) e.regione = t.regione; continue; }
    visti.add(k);
    out.push({ prova: garaNome[t.gara_id] || 'campionato regionale', regione: t.regione || null, data: garaData[t.gara_id] || null, campione: t.atleta_nome || null, atleta_id: t.atleta_id || null, gara_id: t.gara_id || null,
      fascia: t.fascia === 'UNDER23' ? 'Under 23' : t.fascia === 'ELITE' ? 'Elite' : null, disciplina: t.disciplina && t.disciplina !== 'STRADA' ? String(t.disciplina).toLowerCase() : null, assegnato_dalla_redazione: true });
  }
  return out;
}

// ---------- controlli sui fatti ----------
const NUMERI_PAROLE = { UN: 1, UNO: 1, UNA: 1, DUE: 2, TRE: 3, QUATTRO: 4, CINQUE: 5, SEI: 6, SETTE: 7, OTTO: 8, NOVE: 9, DIECI: 10 };
const ORDINALI = { PRIMO: 1, PRIMA: 1, SECONDO: 2, SECONDA: 2, TERZO: 3, TERZA: 3, QUARTO: 4, QUARTA: 4, QUINTO: 5, QUINTA: 5 };
const parole = t => fraseNorm(t).trim().split(' ').filter(Boolean);
// gli atleti presenti nei dati con i loro numeri: punti, posizioni, vittorie, podi
function atletiDaFatti(facts) {
  const mappa = new Map();
  const voce = (nome, cognome) => {
    const tok = parole(nome); if (tok.length < 1) return null;
    const k = tok.slice().sort().join(' ');
    if (!mappa.has(k)) mappa.set(k, { nome: String(nome), tok, cog: cognome ? parole(cognome) : null, punti: new Set(), pos: new Set(), vittorie: new Set(), podi: new Set() });
    const e = mappa.get(k); if (cognome && !e.cog) e.cog = parole(cognome); return e;
  };
  const aggiungi = (e, o) => {
    if (!e) return;
    for (const c of ['punti', 'punti_stagione']) if (o[c] != null && o[c] !== '') e.punti.add(tondo(o[c]));
    for (const c of ['pos', 'posizione', 'posizione_finale', 'posizione_in_classifica_atleti', 'posizione_in_classifica']) if (o[c] != null && Number(o[c]) > 0) e.pos.add(Number(o[c]));
    if (o.vittorie != null && o.vittorie !== '') e.vittorie.add(numero(o.vittorie));
    if (o.podi != null && o.podi !== '') e.podi.add(numero(o.podi));
  };
  const visita = o => {
    if (Array.isArray(o)) return o.forEach(visita);
    if (!o || typeof o !== 'object') return;
    if (typeof o.atleta === 'string' && o.atleta.trim()) aggiungi(voce(o.atleta, o.cognome), o);
    else if (o.cognome && o.nome && typeof o.nome === 'string') aggiungi(voce(`${o.cognome} ${o.nome}`, o.cognome), o);
    Object.values(o).forEach(visita);
  };
  visita(facts);
  const a = facts && facts.atleta;                                    // profilo di un atleta: i suoi numeri stanno in due blocchi
  if (a && typeof a === 'object' && a.nome) {
    const e = voce(a.nome, null);
    aggiungi(e, a);
    const s = facts.stagione_in_corso; if (s && e) { if (s.vittorie != null) e.vittorie.add(numero(s.vittorie)); if (s.podi != null) e.podi.add(numero(s.podi)); }
  }
  return [...mappa.values()];
}
const uguali = (a, b) => Math.abs(a - b) < 0.051;
const fraseSenzaPunteggiatura = t => String(t).replace(/\s+/g, ' ');
// affermazioni verificabili dentro una singola frase che nomina UN solo atleta dei dati: punti, vittorie, podi, "ha vinto", posizione
function verificaAffermazioni(testo, facts) {
  const atleti = atletiDaFatti(facts), problemi = [];
  if (!atleti.length) return problemi;
  const cogUnici = atleti.filter(e => e.cog && e.cog.length && atleti.filter(x => x !== e && x.cog && x.cog.every(c => e.cog.includes(c)) && e.cog.every(c => x.cog.includes(c))).length === 0);
  const frasi = String(testo || '').split(/(?<=[.!?])\s+|\n+/).map(fraseSenzaPunteggiatura).filter(f => f.length > 8);
  const visti = new Set();
  const segnala = (gravita, tipo, msg) => { if (!visti.has(msg)) { visti.add(msg); problemi.push({ tipo, gravita, testo: msg }); } };
  for (const f of frasi) {
    const pw = new Set(parole(f));
    const trovati = atleti.filter(e => e.tok.every(t => pw.has(t)) || (cogUnici.includes(e) && e.cog.every(t => pw.has(t))));
    // se un atleta e contenuto nel nome di un altro (stesso cognome) si tiene il piu specifico
    const unici = trovati.filter(e => !trovati.some(x => x !== e && e.tok.every(t => x.tok.includes(t)) && x.tok.length > e.tok.length));
    if (unici.length !== 1) continue;                                 // frase con piu atleti: l'attribuzione non e certa, non si giudica
    const e = unici[0], nome = e.nome;
    const num = s => { const w = String(s).toUpperCase(); return NUMERI_PAROLE[w] != null ? NUMERI_PAROLE[w] : numero(s); };
    for (const m of f.matchAll(/(\d+(?:[.,]\d+)?)\s+punti\b(?!\s+(?:di\s+(?:ritardo|distacco|vantaggio|margine|differenza)|in\s+(?:piu|più|meno)|sul|dal|dietro|davanti))/gi)) {
      const v = numero(m[1]);
      if (e.punti.size && ![...e.punti].some(p => uguali(p, v))) segnala('alta', 'fatto', `Punti attribuiti a ${nome}: ${m[1]}; nei dati risultano ${[...e.punti].join(', ')}`);
    }
    for (const m of f.matchAll(/\b(\d+|un[ao]?|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\s+(?:vittori[ae]|affermazion[ie]|success[oi])\b/gi)) {
      const v = num(m[1]);
      if (e.vittorie.size && ![...e.vittorie].includes(v)) segnala('alta', 'fatto', `Vittorie attribuite a ${nome}: ${v}; nei dati risultano ${[...e.vittorie].join(', ')}`);
    }
    for (const m of f.matchAll(/\b(\d+|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\s+podi\b/gi)) {
      const v = num(m[1]);
      if (e.podi.size && ![...e.podi].includes(v)) segnala('alta', 'fatto', `Podi attribuiti a ${nome}: ${v}; nei dati risultano ${[...e.podi].join(', ')}`);
    }
    if (/\b(ha vinto|vince|vinse|si impone|s'impone|trionfa|ha trionfato|conquista la vittoria)\b/i.test(f) && e.pos.size && !e.pos.has(1) && ![...e.vittorie].some(v => v > 0))
      segnala('media', 'fatto', `${nome} e indicato come vincitore, ma nei dati non risulta primo (posizioni: ${[...e.pos].join(', ')})`);
    for (const m of f.matchAll(/\b(?:(?:al|il|in)\s+)?(primo|prima|secondo|seconda|terzo|terza|quarto|quarta|quinto|quinta)\s+(?:posto|posizione)\b|\b(\d+)\s*[°ºª]\s*(?:posto|posizione)?/gi)) {
      const v = m[2] ? numero(m[2]) : ORDINALI[String(m[1]).toUpperCase()];
      if (v && e.pos.size && !e.pos.has(v) && v <= 10) segnala('media', 'fatto', `${nome} e collocato al ${v}° posto, ma nei dati le posizioni sono ${[...e.pos].join(', ')}`);
    }
  }
  return problemi;
}
// nomi "Nome Cognome" in cui UNA parte e di un atleta dei dati e l'altra no (cognome giusto, nome sbagliato o viceversa)
function nomiParziali(testo, facts, noti, stop) {
  const tokAtl = new Set(); atletiDaFatti(facts).forEach(e => e.tok.forEach(t => tokAtl.add(t)));
  const out = [], visti = new Set(), re = /([A-ZÀ-Ý][a-zà-ÿ'’]{2,})\s+([A-ZÀ-Ý][a-zà-ÿ'’]{2,})/g; let m;
  const up = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  while ((m = re.exec(testo))) {
    const pre = testo.slice(Math.max(0, m.index - 4), m.index);
    if (m.index === 0 || /[.!?:]\s*$|\n\s*$/.test(pre)) continue;
    const a = up(m[1]), b = up(m[2]);
    if (stop.has(a) || stop.has(b)) continue;
    const ka = noti.has(a), kb = noti.has(b);
    if (ka === kb) continue;                                          // entrambe note, o entrambe ignote (gia segnalato dal controllo principale)
    const nota = ka ? a : b;
    if (!tokAtl.has(nota)) continue;                                  // la parte nota deve essere di un atleta dei dati
    const k = a + ' ' + b; if (visti.has(k)) continue; visti.add(k);
    out.push({ tipo: 'nome', gravita: 'media', testo: `Il nome «${m[1]} ${m[2]}» e solo in parte nei dati: «${(ka ? m[1] : m[2])}» c'e, «${(ka ? m[2] : m[1])}» no` });
  }
  return out;
}
// numeri piccoli (2-9) seguiti da una grandezza ("5 punti", "3 gare"): se non compaiono nei dati vanno segnalati
function numeriPiccoliNonVerificati(testo, ok) {
  const nonVer = new Set();
  for (const m of String(testo).matchAll(/\b([2-9])\s+(punti|vittori[ae]|podi|gare|atleti|corridori|squadre|partecipanti|arrivati|chilometri|km|secondi|minuti|edizioni)\b/gi)) if (!ok.has(m[1])) nonVer.add(`${m[1]} ${m[2].toLowerCase()}`);
  return [...nonVer];
}

module.exports = { numero, tondo, normalizzaRiga, uniscRisultati, minorenneDaCodice, codiceGiovanile, contieneMinorenni, indiceMinorenni, testoNominaMinori, unisciCampioniRegionali, atletiDaFatti, verificaAffermazioni, nomiParziali, numeriPiccoliNonVerificati };
