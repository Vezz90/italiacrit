'use strict';
// Redazione AI (PRIVATA, solo amministratori): prepara BOZZE di articoli dai dati del sito, dalla ricerca web e da pagine ufficiali indicate a mano.
// Non pubblica niente: le bozze restano in kv_store ('redazione_articoli') finche un admin le rilegge, le corregge e le approva.
//
// Tre tipi: 'gara' (resoconto o anteprima di una gara), 'settimana' (il punto della settimana), 'atleta' (profilo).
// Regole di metodo (vedi REGOLE): nomi/numeri solo dai DATI calcolati qui; il web serve per il contesto e viene riscritto con parole proprie,
// con le fonti elencate; cio che non e sicuro finisce in "da_verificare".
const crypto = require('crypto');
const { rawQuery } = require('./db');
const fs = require('fs');
const path = require('path');

const MODEL = 'claude-sonnet-5';
const KEY = 'redazione_articoli';
const CAT_NOME = { ELI_M: 'Elite/Under 23 uomini', ELI_F: 'Donne Elite', JUN_M: 'Juniores uomini', JUN_F: 'Juniores donne', AL_M: 'Allievi', AL_F: 'Allieve',
  ES1_M: 'Esordienti 1° anno', ES1_F: 'Esordienti 1° anno donne', ES2_M: 'Esordienti 2° anno', ES2_F: 'Esordienti 2° anno donne' };

module.exports = function registerRedazione(app, deps) {
  const { requireAdmin, getSupabase, SITE_URL, fotoPer } = deps;
  const sb = () => { const s = getSupabase(); if (!s) throw new Error('database non disponibile'); return s; };

  // ---------- dati del sito (GitHub Pages, con ripiego sui file del repository) ----------
  const _cache = {};
  async function getData(file) {
    const hit = _cache[file];
    if (hit && Date.now() - hit.ts < 10 * 60 * 1000) return hit.data;
    let data = null;
    try {
      const r = await fetch(`${SITE_URL}/data/${file}`, { signal: AbortSignal.timeout(15000) });
      if (r.ok) data = await r.json();
    } catch (_) { /* ripiego sul file locale */ }
    if (data == null) {
      try { data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', file), 'utf8')); } catch (_) { /* niente */ }
    }
    if (data == null) throw new Error('dati non disponibili: ' + file);
    _cache[file] = { data, ts: Date.now() };
    return data;
  }

  // ---------- archivio bozze ----------
  async function readAll() {
    const { data, error } = await sb().from('kv_store').select('value').eq('key', KEY).maybeSingle();
    if (error) throw new Error('lettura bozze: ' + error.message);           // un errore NON deve sembrare "nessuna bozza"
    return Array.isArray(data && data.value) ? data.value : [];
  }
  let chain = Promise.resolve();
  function mutate(fn) {                                                      // lettura-modifica-scrittura una alla volta
    const run = chain.then(async () => {
      const arr = await readAll();
      const out = await fn(arr);
      const { error } = await sb().from('kv_store').upsert({ key: KEY, value: arr, updated_at: new Date().toISOString() });
      if (error) throw new Error('scrittura bozze: ' + error.message);
      return out;
    });
    chain = run.catch(() => {});
    return run;
  }

  // ---------- utilita ----------
  const up = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const baseName = n => up(n).replace(/[’'`.\-–,;:()"\/#]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\d+\s*[°^ª]?\s*/, '').split(' ').filter(t => t && t !== 'EDIZIONE').join(' ');
  const catOf = r => { const m = String(r.gara_id || '').match(/_(ELI|JUN|AL|ES1|ES2)_([MF])$/); return m ? `${m[1]}_${m[2]}` : null; };
  const fullName = r => `${r.cognome || ''} ${r.nome || ''}`.replace(/\s+/g, ' ').trim();
  const shift = (iso, days) => new Date(Date.parse(iso + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  const today = () => new Date().toISOString().slice(0, 10);

  // albo d'oro della corsa (ultime edizioni): serie precalcolate in data/albo, chiavi "NOME|sesso|fascia"
  const RUMORE = new Set(['ALLIEVI', 'ALLIEVE', 'ALLIEVO', 'JUNIORES', 'JUNIOR', 'DONNE', 'UNDER', 'UNDER23', '23', 'U23', 'ELITE', 'ES', 'ESORDIENTI', 'CAT', 'FEMMINILE', 'MASCHILE', 'UOMINI', 'E']);
  function alboBase(nome) { const t = baseName(nome).split(' '); while (t.length > 2 && RUMORE.has(t[t.length - 1])) t.pop(); return t.join(' '); }
  async function alboFor(nome, categoriaCal, limit = 6) {
    try {
      const idx = await getData('albo/index.json');
      const base = alboBase(nome), cat = String(categoriaCal || '');
      const band = /allie/i.test(cat) ? 'AL' : /junior/i.test(cat) ? 'JUN' : /elite|under|u23/i.test(cat) ? 'ELI' : /esord/i.test(cat) ? 'ES' : '';
      const g = /donn|femmin|allieve/i.test(cat) ? 'F' : 'M';
      const tutte = Object.entries(idx.index || {}).filter(([k]) => k.split('|')[0] === base);
      const stessoSesso = tutte.filter(([k]) => k.split('|')[1] === g);     // mai l'albo maschile per una gara femminile (o viceversa)
      const keys = (band ? stessoSesso.filter(([k]) => k.split('|')[2] === band) : stessoSesso).filter((x, i, a) => a.findIndex(y => y[0] === x[0]) === i).slice(0, 3);
      const out = [];
      for (const [k, sid] of keys) {
        const n = parseInt(sid, 16) % idx.n_shard;
        const sh = await getData(`albo/shard_${String(n).padStart(2, '0')}.json`);
        const s = sh[sid]; if (!s) continue;
        out.push({ serie: k.split('|').slice(1).join(' · '), luogo: s.luogo, edizioni: (s.ed || []).slice(0, limit).map(e => ({ anno: e.y, data: e.d, nome: e.n,
          vincitori: (e.p || []).filter(p => p[1] === 1).map(p => `${p[3]} (${p[4] || 's.t.'}) — ${p[0]}`) })) });
      }
      return out;
    } catch (e) { return []; }
  }

  // ---------- DATI per tipo ----------
  async function albi(c, cal, opts) {
    const voci = opts.tutte ? (cal || []).filter(x => x.data === c.data && alboBase(x.nome) === alboBase(c.nome)).slice(0, 4) : [c];
    const out = [], visti = new Set();
    for (const v of (voci.length ? voci : [c])) for (const a of await alboFor(v.nome, v.categoria)) { if (!visti.has(a.serie)) { visti.add(a.serie); out.push(a); } }
    return out;
  }
  async function factsGara(id, opts = {}) {
    const [cal, raw] = await Promise.all([getData('calendar.json'), getData('results_raw.json')]);
    const c = (cal || []).find(x => x.id === id);
    if (!c) throw new Error('gara non trovata nel calendario: ' + id);
    // la voce di calendario e i risultati hanno id diversi (il calendario non porta la categoria): si abbinano per data, nome e categoria
    const cband = /allie/i.test(c.categoria || '') ? 'AL' : /junior/i.test(c.categoria || '') ? 'JUN' : /elite|under|u23/i.test(c.categoria || '') ? 'ELI' : /esord/i.test(c.categoria || '') ? 'ES' : '';
    const cg = /donn|femmin|allieve/i.test(c.categoria || '') ? 'F' : 'M', cbase = alboBase(c.nome);
    const same = r => r.gara_id === id || String(r.gara_id || '').startsWith(id + '_')
      || (r.data === c.data && alboBase(r.nome_gara) === cbase && (() => { const k = catOf(r); return opts.tutte || !k || !cband || (k.replace(/_[MF]$/, '').replace(/^ES\d$/, 'ES') === cband && k.slice(-1) === cg); })());
    let rows = (raw || []).filter(same);
    try {                                                                    // righe inserite a mano (ordine d'arrivo completo): si aggiungono se mancano
      const { data: man } = await sb().from('manual_results').select('*').eq('data', c.data);
      const have = new Set(rows.map(r => r.gara_id + '|' + r.posizione));
      (man || []).filter(same).forEach(r => { if (!have.has(r.gara_id + '|' + r.posizione)) rows.push(r); });
    } catch (_) { /* solo i dati dello scraper */ }
    const byCat = {};
    rows.forEach(r => { const k = catOf(r) || r.categoria || '?'; (byCat[k] = byCat[k] || []).push(r); });
    const risultati = Object.entries(byCat).map(([k, list]) => ({
      categoria: CAT_NOME[k] || k, codice: k, gara_id: (list[0] || {}).gara_id, partecipanti: list.length,
      top10: list.sort((a, b) => a.posizione - b.posizione).slice(0, 10).map(r => ({ pos: r.posizione, id: r.atleta_id, cognome: r.cognome, atleta: fullName(r), team: r.team, tempo: r.tempo || null, km: r.km || null, media: r.media || null, punti: r.punti_effettivi })),
    }));
    return {
      oggi: today(), stato: rows.length ? 'risultati' : 'anteprima',
      gara: { nome: (opts.tutte && rows.length) ? rows.map(r => r.nome_gara).filter(Boolean).sort((x, y) => x.length - y.length)[0] || c.nome : c.nome, data: c.data, luogo: c.luogo, regione: c.regione,
        categoria_calendario: opts.tutte ? 'tutte le categorie dell evento (vedi risultati)' : c.categoria, tipo: c.tipo, moltiplicatore_punti: c.moltiplicatore,
        campionato_italiano: !!c.campionato_italiano, campionato_regionale: !!c.campionato_regionale },
      risultati, albo_doro: await albi(c, cal, opts),
    };
  }

  async function factsSettimana(fine) {
    const raw = (await getData('results_raw.json')).filter(r => r.data && r.tipo !== 'pista');
    const ultimo = raw.reduce((m, r) => (r.data <= today() && r.data > m ? r.data : m), '');
    const end = fine || ultimo, start = shift(end, -6);
    const cats = {};
    raw.forEach(r => { const k = catOf(r); if (k) (cats[k] = cats[k] || []).push(r); });
    const sommario = [];
    for (const [k, list] of Object.entries(cats)) {
      const win = list.filter(r => r.data >= start && r.data <= end);
      if (!win.length) continue;
      const pts = (rows) => { const m = {}; rows.forEach(r => { const a = m[r.atleta_id] || (m[r.atleta_id] = { atleta: fullName(r), team: r.team, punti: 0, vittorie: 0, podi: 0 }); a.punti += r.punti_effettivi || 0; if (r.posizione === 1) a.vittorie++; if (r.posizione >= 1 && r.posizione <= 3) a.podi++; }); return Object.values(m).sort((a, b) => b.punti - a.punti); };
      const before = pts(list.filter(r => r.data < start)), now = pts(list.filter(r => r.data <= end));
      const inWin = pts(win);
      const gare = {}; win.forEach(r => { gare[r.gara_id] = { nome: r.nome_gara, data: r.data, tipo: r.tipo, moltiplicatore: r.moltiplicatore, regione: r.regione }; });
      sommario.push({
        categoria: CAT_NOME[k] || k, gare_nella_settimana: Object.keys(gare).length,
        gare_principali: Object.values(gare).sort((a, b) => (b.moltiplicatore || 1) - (a.moltiplicatore || 1)).slice(0, 4),
        migliori_della_settimana: inWin.slice(0, 5),
        classifica_ora: now.slice(0, 3).map(a => ({ atleta: a.atleta, team: a.team, punti: a.punti })),
        leader_prima: before[0] ? { atleta: before[0].atleta, punti: before[0].punti } : null,
        cambio_al_comando: !!(before[0] && now[0] && before[0].atleta !== now[0].atleta),
        distacco_primo_secondo: now[1] ? Math.round((now[0].punti - now[1].punti) * 100) / 100 : null,
      });
    }
    if (!sommario.length) throw new Error(`nessuna gara dal ${start} al ${end}`);
    return { periodo: { dal: start, al: end }, categorie: sommario };
  }

  async function factsAtleta(id) {
    const ath = (await getData('athletes.json'))[id];
    if (!ath) throw new Error('atleta non trovato: ' + id);
    const ris = ath.risultati || [];
    const best = [...ris].sort((a, b) => a.posizione - b.posizione || (b.moltiplicatore || 1) - (a.moltiplicatore || 1)).slice(0, 8)
      .map(r => ({ gara: r.nome_gara, data: r.data, posizione: r.posizione, livello: r.tipo, punti: r.punti_effettivi }));
    let carriera = [];
    try {
      const car = await getData('carriere.json'); const a = (car.a || {})[id];
      if (a) carriera = a.s.map(s => ({ anno: s[0], categoria: car.cats[s[1]], posizione_finale: s[2], punti: s[3], team: car.teams[s[4]], vittorie: s[5], podi: s[6] }));
    } catch (_) { /* archivio non disponibile */ }
    let titoli = [];
    try { titoli = ((await getData('titoli_campione.json')).t || []).filter(t => t[4] === id).map(t => ({ anno: t[0], titolo: t[8], posizione: t[9], regione: t[3] })); } catch (_) { /* nessuno */ }
    let pcs = [];
    try {
      const { data } = await sb().from('pcs_results').select('season,posizione').eq('atleta_id', id);
      const m = {}; (data || []).forEach(r => { const s = m[r.season] || (m[r.season] = { stagione: r.season, gare: 0, vittorie: 0, podi: 0 }); s.gare++; if (r.posizione === 1) s.vittorie++; if (r.posizione >= 1 && r.posizione <= 3) s.podi++; });
      pcs = Object.values(m).sort((a, b) => b.stagione - a.stagione);
    } catch (_) { /* nessuno */ }
    return {
      atleta: { nome: fullName(ath), team_attuale: ath.team_attuale, categoria: CAT_NOME[ath.categoria] || ath.categoria, punti_stagione: ath.punti_totali },
      stagione_in_corso: { gare: ris.length, vittorie: ris.filter(r => r.posizione === 1).length, podi: ris.filter(r => r.posizione >= 1 && r.posizione <= 3).length, migliori_risultati: best },
      carriera_archivio_2007_2025: carriera, titoli, risultati_pcs_per_stagione: pcs,
    };
  }

  const CATS_ALL = ['ELI_M', 'ELI_F', 'JUN_M', 'JUN_F', 'AL_M', 'AL_F', 'ES2_M', 'ES2_F', 'ES1_M', 'ES1_F'];
  async function anno() { const raw = await getData('results_raw.json'); return raw.reduce((m, r) => (r.data && r.data.slice(0, 4) > m ? r.data.slice(0, 4) : m), '2000'); }

  // riepilogo di una stagione per una categoria (risultati scraper + inseriti a mano), tutto calcolato qui: l'AI non fa conti
  async function factsStagione(cat) {
    if (!CATS_ALL.includes(cat)) throw new Error('categoria non valida: ' + cat);
    const [raw, teams, car] = await Promise.all([getData('results_raw.json'), getData('teams.json').catch(() => ({})), getData('carriere.json').catch(() => null)]);
    const y = await anno();
    let rows = (raw || []).filter(r => catOf(r) === cat && String(r.data).startsWith(y));
    try {
      const have = new Set(rows.map(r => r.gara_id + '|' + r.posizione));
      for (let from = 0; ; from += 1000) {
        const { data } = await sb().from('manual_results').select('*').gte('data', y + '-01-01').order('id').range(from, from + 999);
        (data || []).filter(r => catOf(r) === cat).forEach(r => { if (!have.has(r.gara_id + '|' + r.posizione)) { have.add(r.gara_id + '|' + r.posizione); rows.push(r); } });
        if (!data || data.length < 1000) break;
      }
    } catch (_) { /* solo scraper */ }
    if (!rows.length) throw new Error(`nessun risultato ${y} per ${CAT_NOME[cat] || cat}`);
    const A = {};
    const add = r => { const k = r.atleta_id || fullName(r); const a = A[k] || (A[k] = { id: r.atleta_id, cognome: r.cognome, atleta: fullName(r), team: r.team, punti: 0, vittorie: 0, podi: 0, gare: 0, ultima: '' }); a.punti += Number(r.punti_effettivi) || 0; a.gare++; if (r.posizione === 1) a.vittorie++; if (r.posizione >= 1 && r.posizione <= 3) a.podi++; if (r.data >= a.ultima) { a.ultima = r.data; a.team = r.team || a.team; } };
    rows.forEach(add);
    const lista = Object.values(A).sort((a, b) => b.punti - a.punti || b.vittorie - a.vittorie);
    const gare = new Set(rows.map(r => r.gara_id));
    const ev = rows.filter(r => r.posizione === 1 && ((r.moltiplicatore || 1) >= 2 || r.campionato_italiano || r.campionato_regionale))
      .sort((a, b) => (b.campionato_italiano ? 1 : 0) - (a.campionato_italiano ? 1 : 0) || (b.moltiplicatore || 1) - (a.moltiplicatore || 1) || String(a.data).localeCompare(b.data))
      .slice(0, 14).map(r => ({ gara: r.nome_gara, data: r.data, vincitore: fullName(r), team: r.team, regione: r.regione || null, moltiplicatore: r.moltiplicatore || 1, titolo: r.campionato_italiano ? 'campionato italiano' : r.campionato_regionale ? 'campionato regionale' : null }));
    const campioni_italiani = rows.filter(r => r.posizione === 1 && r.campionato_italiano).map(r => ({ prova: r.nome_gara, data: r.data, campione: fullName(r), team: r.team }));
    const campioni_regionali = rows.filter(r => r.posizione === 1 && r.campionato_regionale).slice(0, 25).map(r => ({ prova: r.nome_gara, regione: r.regione || null, data: r.data, campione: fullName(r), team: r.team }));
    // classifica ufficiale del sito (stessa della pagina Classifica): atleti e squadre, con i punti che si vedono li'
    let rk = [], rkT = [];
    try { rk = await getData('rankings/' + cat + '.json'); } catch (_) { /* ripiego sul calcolo locale */ }
    try { rkT = await getData('team_rankings/' + cat + '.json'); } catch (_) { /* senza squadre */ }
    if (!Array.isArray(rk) || !rk.length) throw new Error('classifica ufficiale non disponibile per ' + cat);
    const ordinata = rk.slice().sort((x, y) => (x.pos || 999) - (y.pos || 999));
    const classifica = ordinata.slice(0, 10).map(a => ({ pos: a.pos, id: a.atleta_id, cognome: a.cognome, atleta: `${a.cognome} ${a.nome}`.trim(), team: a.team_nome, punti: a.punti, vittorie: a.p1, secondi_posti: a.p2, terzi_posti: a.p3, arrivi_nei_primi_10: a.pout, risultati_registrati: a.gare }));
    const t5 = (Array.isArray(rkT) ? rkT : []).slice().sort((x, y) => (x.pos || 999) - (y.pos || 999)).slice(0, 5).map(t => ({ pos: t.pos, team: t.team_nome, punti: t.punti, vittorie: t.p1, atleti_a_punti: t.n_atleti }));
    const piuVitt = ordinata.slice().sort((x, y) => (y.p1 || 0) - (x.p1 || 0) || (x.pos || 999) - (y.pos || 999)).slice(0, 4).filter(a => a.p1).map(a => ({ atleta: `${a.cognome} ${a.nome}`.trim(), vittorie: a.p1, team: a.team_nome, posizione_in_classifica: a.pos }));
    // materiale per RACCONTARE: per i primi tre le tappe della stagione, e il duello tra primo e secondo
    const gapSec = t => { const m = String(t || '').match(/^a\s*(?:(\d+)')?(\d+)"/); return m ? (+m[1] || 0) * 60 + +m[2] : null; };
    const perGara = {}; rows.forEach(r => { (perGara[r.gara_id] = perGara[r.gara_id] || []).push(r); });
    const top3 = classifica.slice(0, 3);
    const storie = top3.map(c => {
      const mie = rows.filter(r => r.atleta_id === c.id).sort((a, b) => String(a.data).localeCompare(String(b.data)));
      const vitt = mie.filter(r => r.posizione === 1);
      let striscia = 0, cur = 0; mie.forEach(r => { if (r.posizione === 1) { cur++; striscia = Math.max(striscia, cur); } else cur = 0; });
      const mesi = {}; vitt.forEach(r => { const m = String(r.data).slice(0, 7); mesi[m] = (mesi[m] || 0) + 1; });
      const margini = vitt.map(r => { const s2 = (perGara[r.gara_id] || []).find(x => x.posizione === 2); return { gara: r.nome_gara, data: r.data, secondi: s2 ? gapSec(s2.tempo) : null, secondo: s2 ? fullName(s2) : null }; }).filter(m => m.secondi != null);
      const largo = margini.slice().sort((a, b) => b.secondi - a.secondi)[0] || null;
      const pesante = vitt.slice().sort((a, b) => (b.campionato_italiano ? 1 : 0) - (a.campionato_italiano ? 1 : 0) || (b.moltiplicatore || 1) - (a.moltiplicatore || 1))[0];
      const ult = mie[mie.length - 1];
      return {
        atleta: c.atleta, posizione_finale: c.pos,
        prima_vittoria: vitt[0] ? { gara: vitt[0].nome_gara, data: vitt[0].data } : null,
        ultima_vittoria: vitt.length ? { gara: vitt[vitt.length - 1].nome_gara, data: vitt[vitt.length - 1].data } : null,
        vittorie_per_mese: mesi, vittorie_di_fila_tra_le_gare_corse: striscia,
        vittoria_piu_importante: pesante ? { gara: pesante.nome_gara, data: pesante.data, titolo: pesante.campionato_italiano ? 'campionato italiano' : (pesante.moltiplicatore || 1) >= 2 ? 'gara di peso x' + pesante.moltiplicatore : null } : null,
        vittoria_con_il_distacco_piu_largo: largo ? { gara: largo.gara, data: largo.data, secondi_sul_secondo: largo.secondi, secondo: largo.secondo } : null,
        vittorie_con_meno_di_4_secondi_di_margine: margini.filter(m => m.secondi <= 3).length,
        ultimo_risultato_della_stagione: ult ? { data: ult.data, gara: ult.nome_gara, posizione: ult.posizione } : null,
      };
    });
    return {
      nota: 'la classifica e quella UFFICIALE del sito (pagina Classifica): nomi, punti e posizioni vanno usati cosi come sono. "risultati_registrati" NON sono le gare corse dall\'atleta: del sito abbiamo solo i primi 10 di ogni gara.',
      stagione: y, categoria: CAT_NOME[cat] || cat, codice: cat, gare_disputate: gare.size, atleti_in_classifica: rk.length,
      classifica_atleti: classifica, piu_vittorie: piuVitt,
      storie_dei_primi_tre: storie, vittorie_importanti: ev, campioni_italiani, campioni_regionali,
    };
  }

  // articolo a parte sulle squadre di una categoria: classifica ufficiale delle squadre e gli atleti che le hanno portate in alto
  async function factsSquadre(cat) {
    if (!CATS_ALL.includes(cat)) throw new Error('categoria non valida: ' + cat);
    const [rkT, rk] = await Promise.all([getData('team_rankings/' + cat + '.json'), getData('rankings/' + cat + '.json')]);
    if (!Array.isArray(rkT) || !rkT.length) throw new Error('classifica squadre non disponibile per ' + cat);
    const y = await anno();
    const squadre = rkT.slice().sort((x, z) => (x.pos || 999) - (z.pos || 999)).slice(0, 6).map(t => {
      const atl = (rk || []).filter(a => a.team_id === t.team_id).sort((x, z) => (x.pos || 999) - (z.pos || 999));
      const top = atl.slice(0, 3).map(a => ({ atleta: `${a.cognome} ${a.nome}`.trim(), id: a.atleta_id, posizione_in_classifica_atleti: a.pos, punti: a.punti, vittorie: a.p1 }));
      const punta = atl[0];
      return {
        pos: t.pos, team: t.team_nome, punti: t.punti, vittorie: t.p1, secondi_posti: t.p2, terzi_posti: t.p3, atleti_a_punti: t.n_atleti,
        quota_dei_punti_portata_dal_migliore: punta && t.punti ? Math.round(punta.punti / t.punti * 100) + '%' : null,
        atleti_di_punta: top, punta_id: punta && punta.atleta_id, punta: punta && `${punta.cognome} ${punta.nome}`.trim(), punta_cognome: punta && punta.cognome,
      };
    });
    return { nota: 'classifica delle squadre UFFICIALE del sito: nomi, posizioni e punti vanno usati cosi come sono', stagione: y, categoria: CAT_NOME[cat] || cat, codice: cat, squadre_in_classifica: rkT.length, classifica_team: squadre };
  }

  // ---------- foto ----------
  // foto candidate per l'articolo: della gara (caricate, album) e dei primi classificati.
  async function fotoCandidate(tipo, p, facts) {
    if (!fotoPer) return [];
    const garaIds = [], atletaIds = [];
    const blocco = async (t, pp, f) => {
      if (t === 'gara') {
        garaIds.push(pp.id);
        try { const cal = await getData('calendar.json'); const c = cal.find(x => x.id === pp.id); if (c) cal.filter(x => x.data === c.data && alboBase(x.nome) === alboBase(c.nome)).forEach(x => garaIds.push(x.id)); } catch (_) { /* solo l'id indicato */ }
        (f.risultati || []).forEach(r => { if (r.gara_id) garaIds.push(r.gara_id); (r.top10 || []).slice(0, 3).forEach(t2 => t2.id && atletaIds.push(t2.id)); });
      } else if (t === 'atleta') atletaIds.push(pp.id);
      else if (t === 'stagione') (f.classifica_atleti || []).slice(0, 3).forEach(a => a.id && atletaIds.push(a.id));
      else if (t === 'squadre') (f.classifica_team || []).slice(0, 3).forEach(a => a.punta_id && atletaIds.push(a.punta_id));
    };
    if (tipo === 'libero') for (const b of (facts.blocchi || [])) await blocco(b.tipo, b.p || {}, b.dati || {});
    else await blocco(tipo, p, facts);
    const vittorie = {};
    try {
      const set = new Set(atletaIds), righe = [];
      (await getData('results_raw.json')).forEach(r => { if (r.posizione === 1 && set.has(r.atleta_id)) righe.push({ id: r.atleta_id, g: r.gara_id, d: r.data }); });
      try { const { data } = await sb().from('manual_results').select('atleta_id,gara_id,data').eq('posizione', 1).in('atleta_id', [...set].slice(0, 80)); (data || []).forEach(r => righe.push({ id: r.atleta_id, g: r.gara_id, d: String(r.data).slice(0, 10) })); } catch (_) { /* solo scraper */ }
      righe.sort((x, y) => String(y.d).localeCompare(String(x.d))).forEach(r => (vittorie[r.id] = vittorie[r.id] || []).push(r.g));
    } catch (_) { /* senza vittorie */ }
    try { return await fotoPer({ garaIds, atletaIds, vittorie }); } catch (e) { console.warn('[redazione] foto:', e.message); return []; }
  }
  // scelta iniziale: foto della gara (con credito) e, se non ce ne sono, la foto del vincitore
  const sceglie = c => { const g = c.filter(f => f.fonte !== 'profilo').slice(0, 2); return (g.length ? g : c.filter(f => f.fonte === 'profilo').slice(0, 1)).map(f => ({ url: f.url, credito: f.credito, didascalia: f.didascalia })); };

  // testo in blocchi puliti: titoletti '## ' e segnaposto su righe proprie, paragrafi senza a-capo dentro le frasi
  function bloccoDi(corpo) {
    const out = []; let par = [];
    const flush = () => { if (par.length) { out.push({ t: 'p', s: par.join(' ').replace(/\s+/g, ' ').trim() }); par = []; } };
    for (const r0 of String(corpo || '').replace(/\r/g, '').split('\n')) {
      const r = r0.trim();
      if (!r) { flush(); continue; }
      if (/^##\s+/.test(r)) { flush(); out.push({ t: 'h', s: r.replace(/^##\s+/, '').trim() }); continue; }
      if (/^\[\[foto:\d+\]\]$/.test(r)) { flush(); out.push({ t: 'f', s: r }); continue; }
      par.push(r.replace(/\[\[foto:\d+\]\]/g, ''));
    }
    flush();
    return out;
  }
  const bloccoATesto = bl => bl.map(b => (b.t === 'h' ? '## ' + b.s : b.s)).join('\n\n');
  const nomeBello = n => { const t = String(n || '').trim().split(/\s+/); const g = t.length > 1 ? t.slice(-1)[0] + ' ' + t.slice(0, -1).join(' ') : String(n || ''); return g.toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase()); };
  const normN = x => up(x).replace(/[^A-Z ]/g, ' ').split(' ').filter(Boolean).sort().join(' ');

  // gli atleti di cui si parla e quanto sono di spicco (1 = vincitore, 2-3 = podio)
  function atletiDi(facts, out = new Map(), extra = null) {
    const put = (id, nome, cognome, rango) => { if (!id) return; const x = out.get(id); out.set(id, { id, nome, cognome, rango: Math.min(rango, x ? x.rango : 99) }); };
    (facts.risultati || []).forEach(r => (r.top10 || []).forEach(t => put(t.id, t.atleta, t.cognome, t.pos)));
    (facts.classifica_atleti || []).forEach(a => put(a.id, a.atleta, a.cognome, a.pos));
    (facts.classifica_team || []).forEach(t => put(t.punta_id, t.punta, t.punta_cognome, t.pos));
    if (extra && extra.id && facts.atleta) put(extra.id, facts.atleta.nome, String(facts.atleta.nome || '').split(' ')[0], 1);
    (facts.blocchi || []).forEach(b => atletiDi(b.dati || {}, out, b.p));
    return out;
  }
  // foto messe dal sistema: ogni atleta di spicco (podio o leader) che ha una foto viene sotto il paragrafo in cui se ne parla
  function piazzaFotoAuto(corpo, cand, facts, p) {
    const bl = bloccoDi(corpo).filter(b => b.t !== 'f');
    const atleti = atletiDi(facts, new Map(), p);
    const mioId = p && p.id;
    if (mioId && !atleti.has(mioId)) atleti.set(mioId, { id: mioId, nome: '', cognome: '', rango: 1 });
    const migliore = {};
    for (const f of cand) {
      let id = f.atleta_id;
      if (!id && f.fonte === 'caricata') {                                     // foto di gara con didascalia "COGNOME NOME - SQUADRA | GARA"
        const chi = normN(String(f.didascalia || '').split('|')[0].split(' - ')[0]);
        const hit = [...atleti.values()].find(a => a.nome && normN(a.nome) === chi);
        id = hit && hit.id;
      }
      if (!id || !atleti.has(id)) continue;
      const pr = f.fonte === 'caricata' ? 0 : f.fonte === 'tag' ? 1 : f.fonte === 'garavinta' ? 2 : f.fonte === 'profilo' ? 3 : 9;
      if (pr > 3) continue;
      if (!migliore[id] || pr < migliore[id].pr) migliore[id] = { pr, f };
    }
    const haTitoli = bl.some(b => b.t === 'h');
    const sezione = []; let sez = 0;
    bl.forEach(b => { if (b.t === 'h') sez++; sezione.push(sez); });
    const usate = new Set(), inserimenti = {}; let n = 0;
    const tutti = Object.keys(migliore).map(id => atleti.get(id)).sort((a, b) => a.rango - b.rango || migliore[a.id].pr - migliore[b.id].pr);
    const ordine = tutti.filter(a => a.rango <= 3).concat(tutti.filter(a => a.rango > 3)).slice(0, 12);
    for (const a of ordine) {
      if (n >= 6 || (a.rango > 3 && n > 0)) break;
      const cogn = ' ' + normN(a.cognome || (a.nome || '').split(' ')[0]) + ' ';
      if (cogn.trim() === '') continue;
      const i = bl.findIndex((b, k) => b.t === 'p' && (haTitoli ? sezione[k] > 0 : true) && !usate.has(sezione[k]) && (' ' + up(b.s).replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ') + ' ').includes(cogn));
      if (i < 0) continue;
      usate.add(sezione[i]); (inserimenti[i] = inserimenti[i] || []).push(migliore[a.id].f); n++;
    }
    const foto = [], testo = [];
    bl.forEach((b, i) => {
      testo.push(b);
      (inserimenti[i] || []).forEach(f => { const o = foto.length + 1; foto.push({ url: f.url, credito: f.credito, didascalia: nomeBello(atleti.get(f.atleta_id || '') ? atleti.get(f.atleta_id).nome : String(f.didascalia || '').split(' - ')[0]) || f.didascalia }); testo.push({ t: 'f', s: `[[foto:${o}]]` }); });
    });
    return { corpo: testo.map(b => (b.t === 'h' ? '## ' + b.s : b.s)).join('\n\n'), foto };
  }

  // le foto proposte all'AI: una della gara per categoria, qualche foto d'album, i primi classificati; con un'etichetta che dice cosa mostrano
  function proponiFoto(cand, facts) {
    const cat = {}, nome = {};
    const leggi = f => { (f.risultati || []).forEach(r => { cat[r.gara_id] = r.categoria; (r.top10 || []).forEach(t => { if (t.id) nome[t.id] = t.atleta; }); }); (f.classifica_atleti || []).forEach(a => { if (a.id) nome[a.id] = a.atleta; }); if (f.atleta && f.atleta.nome) { /* profilo: nome gia noto all'AI */ } (f.blocchi || []).forEach(b => leggi(b.dati || {})); };
    leggi(facts);
    const pulisci = n => String(n || '').toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
    const girate = n => { const t = String(n || '').trim().split(/\s+/); return pulisci(t.length > 1 ? t.slice(-1)[0] + ' ' + t.slice(0, -1).join(' ') : n); };   // "MILESI NICOLAS" -> "Nicolas Milesi"
    const out = [], perCat = {};
    for (const f of cand.filter(x => x.fonte === 'caricata')) {
      const c = cat[f.gara_id]; if (!c || (perCat[c] || 0) >= 2 || out.length >= 6) continue;
      perCat[c] = (perCat[c] || 0) + 1;
      const chi = String(f.didascalia || '').split('|')[0].split(' - ')[0].trim();            // le didascalie caricate sul sito dicono chi e ritratto: "COGNOME NOME - SQUADRA | GARA"
      out.push({ ...f, etichetta: chi ? `foto di ${girate(chi)} (${c})` : `foto della gara, categoria "${c}"`, didascalia: chi ? girate(chi) : c });
    }
    const visti = new Set();
    for (const f of cand.filter(x => x.fonte === 'tag')) {                    // una foto per atleta, tra quelle taggate sul suo profilo (meglio se di una gara vinta)
      if (!nome[f.atleta_id] || visti.has(f.atleta_id) || out.length >= 10) continue; visti.add(f.atleta_id);
      out.push({ ...f, etichetta: `foto di ${girate(nome[f.atleta_id])}${f.vittoria ? ' (scattata in una gara che ha vinto)' : ''}, dal suo profilo`, didascalia: girate(nome[f.atleta_id]) });
    }
    for (const f of cand.filter(x => x.fonte === 'profilo').slice(0, 4)) if (nome[f.atleta_id]) out.push({ ...f, etichetta: `foto di ${girate(nome[f.atleta_id])} (vincitore o podio)`, didascalia: girate(nome[f.atleta_id]) });
    for (const f of cand.filter(x => x.fonte === 'xpix' || x.fonte === 'ic').slice(0, 2)) out.push({ ...f, etichetta: 'foto d\'album della gara (generica, non attribuibile a un corridore)', didascalia: f.didascalia || '' });
    return out.slice(0, 12);
  }
  // rinumera i segnaposto nell'ordine in cui compaiono e tiene solo le foto davvero usate
  function piazzaFoto(corpo, pron) {
    const mappa = new Map(), foto = [];
    const nuovo = corpo.replace(/\[\[foto:(\d+)\]\]/g, (m, n) => {
      const f = pron[+n - 1]; if (!f) return '';
      if (!mappa.has(+n)) { mappa.set(+n, foto.length + 1); foto.push({ url: f.url, credito: f.credito, didascalia: f.didascalia }); }
      return `[[foto:${mappa.get(+n)}]]`;
    });
    return { corpo: nuovo.replace(/\n{3,}/g, '\n\n').trim(), foto: foto.slice(0, 6) };
  }
  // il titolo deve nominare i vincitori delle categorie piu alte: se manca qualcuno lo si riscrive (una chiamata breve, senza ricerca web)
  async function controllaTitolo(j, tipo, facts) {
    const titolo = String(j.titolo || '');
    if (tipo !== 'gara' && tipo !== 'stagione') return titolo;
    const alte = (facts.risultati || []).filter(r => /^ELI_/.test(r.codice || ''));
    const dovuti = tipo === 'stagione' ? [(facts.classifica_atleti || [])[0], ((facts.campioni_italiani || [])[0] || {}).campione && { cognome: '', atleta: facts.campioni_italiani[0].campione }].filter(x => x && x.atleta)
      : (alte.length ? alte : (facts.risultati || []).slice(0, 1)).map(r => (r.top10 || [])[0]).filter(Boolean);
    const norm = s => up(s).replace(/[^A-Z ]/g, ' ');
    const manca = dovuti.filter(t => t.cognome && !norm(titolo).includes(norm(t.cognome).trim()));
    if (!manca.length) return titolo;
    try {
      const nomi = dovuti.map(t => t.atleta).join(', ');
      const r = await callClaude(`Riscrivi il TITOLO di questo articolo sportivo perche contenga i cognomi di TUTTI questi vincitori: ${nomi} (nei dati il cognome e prima; scrivili come "Nome Cognome" o solo cognome, normali). Titolo attuale: "${titolo}". Sommario: "${j.sommario || ''}". Massimo 120 caratteri, tono giornalistico, niente cliche. Rispondi SOLO cosi:\n===TITOLO===\n(una riga)`, false);
      const t = (sezioni(r.text || '').TITOLO || '').split('\n')[0].trim();
      return t && t.length < 200 ? t : titolo;
    } catch (_) { return titolo; }
  }

  // ---------- pagine ufficiali indicate a mano ----------
  async function leggiLink(urls) {
    const cheerio = require('cheerio');
    const out = [];
    for (const u of urls.slice(0, 5)) {
      try {
        if (!/^https:\/\//i.test(u)) { out.push({ url: u, errore: 'solo indirizzi https' }); continue; }
        const r = await fetch(u, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ICS-Redazione)' } });
        const ct = r.headers.get('content-type') || '';
        if (!r.ok) { out.push({ url: u, errore: 'HTTP ' + r.status }); continue; }
        if (!/html|text/i.test(ct)) { out.push({ url: u, errore: 'formato non leggibile (' + ct.split(';')[0] + '): i PDF per ora vanno riassunti a mano' }); continue; }
        const $ = cheerio.load(await r.text()); $('script,style,nav,footer,noscript').remove();
        out.push({ url: u, titolo: $('title').first().text().trim(), testo: $('body').text().replace(/\s+/g, ' ').trim().slice(0, 6000) });
      } catch (e) { out.push({ url: u, errore: e.message }); }
    }
    return out;
  }

  // ---------- Claude (con ricerca web opzionale) ----------
  // con la ricerca web la risposta e' spezzata in tanti blocchi (uno per citazione): vanno incollati senza a-capo,
  // tranne davanti alle intestazioni delle sezioni (===TITOLO=== ecc.), che devono stare a inizio riga
  function unisciBlocchi(blocks) {
    let out = '';
    for (const t of blocks) { if (/^\s*={3}[A-Z_]+={3}/.test(t) && out && !out.endsWith('\n')) out += '\n'; out += t; }
    return out;
  }
  // ---------- controllo dei costi: interruttori, limite mensile, registro dei consumi ----------
  // Impostazioni in kv_store ('redazione_ai_config'). Prezzi in dollari per milione di token: sono STIME da verificare sul listino Anthropic.
  const CFG_KEY = 'redazione_ai_config';
  const CFG_DEFAULT = { ai_attiva: true, auto_attiva: false, auto_orari: [8, 13, 19], web_auto_da_imp: 0, auto_spunti: true,limite_mensile_usd: 10, prezzo_ricerca_usd: 0.01,
    prezzi: { 'claude-sonnet-5': { in: 3, out: 15 }, 'claude-haiku-4-5-20251001': { in: 1, out: 5 } } };
  let _cfg = null;
  async function getCfg(fresh) {
    if (_cfg && !fresh && Date.now() - _cfg.ts < 20000) return _cfg.v;
    let v = {};
    try { const { data } = await sb().from('kv_store').select('value').eq('key', CFG_KEY).maybeSingle(); v = (data && data.value) || {}; } catch (_) { /* valori predefiniti */ }
    const out = { ...CFG_DEFAULT, ...v, prezzi: { ...CFG_DEFAULT.prezzi, ...(v.prezzi || {}) } };
    _cfg = { v: out, ts: Date.now() };
    return out;
  }
  const meseOra = () => new Date().toISOString().slice(0, 7);
  async function spesaMese() {
    const r = await rawQuery(`SELECT COALESCE(SUM(costo_usd),0)::float AS usd, COUNT(*)::int AS n FROM ai_usage WHERE mese=$1 AND esito='ok'`, [meseOra()]);
    return r.rows[0] || { usd: 0, n: 0 };
  }
  async function consentiChiamata() {                                        // se non e consentito, NON si chiama Claude
    const c = await getCfg();
    if (!c.ai_attiva) throw new Error("AI disattivata dalle impostazioni della Redazione");
    const s = await spesaMese();
    if (s.usd >= c.limite_mensile_usd) throw new Error(`limite mensile raggiunto (${s.usd.toFixed(2)} $ su ${c.limite_mensile_usd} $): alzalo nelle impostazioni per continuare`);
    return c;
  }
  async function registraUso(c, modello, usage, uso, esito) {
    try {
      const u = usage || {}, pr = c.prezzi[modello] || c.prezzi[MODEL] || { in: 3, out: 15 };
      const ricerche = (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
      const tin = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), tout = u.output_tokens || 0;
      const costo = tin / 1e6 * pr.in + tout / 1e6 * pr.out + ricerche * c.prezzo_ricerca_usd;
      await rawQuery(`INSERT INTO ai_usage (mese, modello, uso, token_in, token_out, ricerche, costo_usd, esito) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [meseOra(), modello, String(uso || '').slice(0, 40), tin, tout, ricerche, costo.toFixed(5), esito || 'ok']);
    } catch (e) { console.warn('[redazione] registro consumi:', e.message); }
  }
  async function callClaude(prompt, web, uso, opz) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY non configurata');
    let messages = [{ role: 'user', content: prompt }];
    const body0 = { model: MODEL, max_tokens: web ? 14000 : 6000, thinking: { type: 'disabled' } };
    if (web) body0.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: (opz && opz.maxUses) || 5, ...((opz && opz.regione) ? { user_location: { type: 'approximate', country: 'IT', region: String(opz.regione) } } : {}) }];
    const fonti = new Map(); let texts = [], usage = null, stop = '';
    for (let giro = 0; giro < 4; giro++) {
      const cfg = await consentiChiamata();                                  // prima di OGNI chiamata a pagamento
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ ...body0, messages }), signal: AbortSignal.timeout(170000) });
      const j = await r.json();
      if (!r.ok) { await registraUso(cfg, MODEL, null, uso, 'errore'); throw new Error(`Claude ${r.status}: ${(j.error && j.error.message) || ''}`); }
      await registraUso(cfg, MODEL, j.usage, uso, 'ok');
      usage = j.usage; stop = j.stop_reason;
      for (const b of j.content || []) {
        if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach(x => { if (x.url) fonti.set(x.url, { titolo: x.title || x.url, url: x.url, uso: 'consultata nella ricerca' }); });
        if (b.type === 'text') { texts.push(b.text); (b.citations || []).forEach(c => { if (c.url) fonti.set(c.url, { titolo: c.title || c.url, url: c.url, uso: 'citata nel testo' }); }); }
      }
      if (j.stop_reason !== 'pause_turn') { const intero = unisciBlocchi(texts); return { text: intero, lastText: intero, fonti: [...fonti.values()], usage, stop }; }
      messages = [...messages, { role: 'assistant', content: j.content }]; texts = [];
    }
    throw new Error('la ricerca web non si e conclusa: riprova');
  }
  function sezioni(t) {
    const out = {}; const re = /^={3}([A-Z_]+)={3}[ \t]*$/gm; let m, prev = null, start = 0;
    while ((m = re.exec(t))) { if (prev) out[prev] = t.slice(start, m.index).trim(); prev = m[1]; start = re.lastIndex; }
    if (prev) out[prev] = t.slice(start).trim();
    return out;
  }
  function parseJson(res) {
    const tutti = [res.lastText, res.text, (res.text || '') + '\n' + (res.lastText || '')];
    for (const t of tutti) {
      const x = sezioni(t || '');
      if (x.CORPO && x.CORPO.length > 80) {
        const righe = v => String(v || '').split('\n').map(r => r.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
        return {
          titolo: (x.TITOLO || '').split('\n')[0].trim(), sommario: x.SOMMARIO || '', corpo: x.CORPO,
          fonti: righe(x.FONTI).map(r => { const [titolo, url, uso] = r.split('|').map(q => q.trim()); return /^https?:\/\//i.test(url || '') ? { titolo: titolo || url, url, uso: uso || '' } : null; }).filter(Boolean),
          da_verificare: righe(x.DA_VERIFICARE), tag: String(x.TAG || '').split(',').map(q => q.trim()).filter(Boolean),
        };
      }
    }
    for (const t of [res.lastText, res.text]) {                          // ripiego: se l'AI ha risposto comunque in JSON
      const a = (t || '').indexOf('{'), b = (t || '').lastIndexOf('}');
      if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) { /* niente */ } }
    }
    const e = new Error('risposta dell\'AI non leggibile' + (res.stop === 'max_tokens' ? ' (testo troncato: troppo lungo)' : '') + ' — inizio: ' + String(res.text || '').replace(/\s+/g, ' ').slice(0, 300));
    throw e;
  }

  const REGOLE = `Sei il cronista di italiacyclingstats.com, sito italiano di statistiche del ciclismo giovanile, dilettantistico e under 23/elite. Scrivi un articolo in italiano.

REGOLE DI METODO (obbligatorie):
1. NOMI, NUMERI, POSIZIONI, TEMPI, DATE E PUNTI vengono SOLO dal blocco DATI (o dalle PAGINE UFFICIALI indicate). Non ricalcolarli e non inventarli.
2. La ricerca web (se attiva) e il DOSSIER DEL RICERCATORE (se presente) servono per il CONTESTO: programma e orari, percorso, notizie, cronaca di altre testate, storia della corsa. Riscrivi sempre con parole tue: è vietato copiare frasi, anche brevi, dalle fonti. Quando riporti un'informazione che viene da terzi, NOMINA la fonte nel testo come farebbe un giornalista ("secondo il comitato regionale", "come riferisce Tuttobiciweb", "scrive l'organizzatore"). Elenca ogni fonte usata in "fonti".
3. Usa un'informazione presa dal web solo se la fonte è affidabile (federazione, organizzatore, testata nota) e non contraddice i DATI. Se il web contraddice i DATI vincono i DATI: scrivilo in "da_verificare". Se non sei sicuro di un fatto, non usarlo e mettilo in "da_verificare". Un'informazione che ha UNA SOLA fonte non ufficiale (o solo un social) va in "da_verificare", non nel testo.
4. Notizie e dichiarazioni di terzi si riportano SOLO se sono nel DOSSIER o nelle fonti, in forma indiretta e attribuita ("secondo l'organizzatore..."), mai come citazione testuale tra virgolette e mai inventate. Niente aneddoti privati, niente stati d'animo attribuiti a una persona precisa che non siano nei DATI o nelle fonti. Il RACCONTO pero deve avere ritmo ed emozione: costruiscila con i fatti che i DATI dimostrano (un duello, una striscia di vittorie, una rimonta, un margine di pochi secondi, il giorno del tricolore) e con immagini efficaci. Se mancano dati scrivi un testo piu breve invece di riempire.
5. DATI PERSONALI: per tutti gli atleti, minorenni compresi, si raccontano i fatti sportivi pubblici (nome, squadra, risultati, titoli, carriera, selezioni): sono la ragione d'essere del sito. Non scrivere mai dati personali che non siano sportivi (eta o data di nascita, scuola, residenza, famiglia, salute, social privati) e usa il web solo per contesto sportivo (risultati, squadre, selezioni, programma), mai per notizie sulla persona.
6. NOMI: scrivi sempre "Nome Cognome" in maiuscolo/minuscolo normale (nei DATI il cognome viene prima e spesso e tutto maiuscolo: "MILESI NICOLAS" diventa "Nicolas Milesi"). Usa i nomi delle squadre come sono nei DATI, scritti in modo leggibile.
7. TITOLO: deve contenere i nomi dei vincitori principali. Se l'evento ha piu categorie, nel titolo devono comparire SEMPRE i vincitori delle categorie piu alte presenti (prima Elite/Under 23 uomini e Donne Elite, poi Juniores, poi Allievi), senza dimenticarne nessuno tra Elite/Under 23: se non ci stanno tutti nel titolo, mettili nel sommario e nelle prime righe. Le sezioni dell'articolo vanno dalla categoria piu alta alla piu bassa.
8. CONFRONTI CON GLI ANNI PASSATI: sono benvenuti se sono PERTINENTI e DIMOSTRATI dai DATI (albo d'oro, risultati di oggi). Esempi buoni, sempre nella STESSA categoria e per lo STESSO titolo: un bis o un tris dello stesso atleta o della stessa squadra; un atleta che oggi ritrova il titolo dopo averlo vinto in passato; il vincitore di un'edizione precedente che oggi e presente nei risultati (dove ha chiuso); la media o il distacco confrontati con quelli dei vincitori precedenti; una squadra che torna a vincere. Sono invece VIETATI i confronti non dimostrati o fuori luogo: non dire che qualcuno "ha interrotto il dominio" o "ha preso il posto" di un altro, se quell'atleta non e piu in quella categoria o non ha gareggiato oggi; niente paragoni tra categorie diverse, niente curiosita di contorno, niente deduzioni ("per forza", "segno di un ricambio"). Se un confronto non e chiaro, pertinente e verificabile nei DATI, omettilo.
9. Non inventare ruoli, meriti o giudizi: niente "zona podio ideale", niente "ha confermato la propria autorevolezza" se non e nei DATI. Due atleti sono compagni di squadra solo se hanno la stessa squadra nei DATI.
10. IMPAGINAZIONE: un articolo ordinato e facile da leggere. Apri con un paragrafo che dice subito chi ha vinto (nomi dei vincitori principali), poi una sezione per categoria con sottotitolo '## ' (dalla piu alta alla piu bassa), paragrafi brevi (3-5 righe). Non scrivere "Foto:", segnaposto ne didascalie nel testo: le foto le mette il sistema.
11. STILE: l'articolo deve leggersi come un pezzo di giornale, non come un elenco di risultati. Apri con la storia vera (il fatto piu notevole: un bis, un record, una rimonta, il tricolore dopo una grande delusione), poi organizza per sezioni. Ogni sottotitolo '## ' deve dire qualcosa ("Donne Elite: Longo Borghini, otto tricolori"), non solo il nome della categoria. Per ogni categoria 3-5 frasi: chi ha vinto e come (distacco dal secondo), il podio, un solo dettaglio che conta. La media oraria si cita solo per le categorie principali e mai in ogni paragrafo. Niente elenchi lunghi di nomi: podio e al massimo i primi cinque. Non ripetere la stessa impalcatura di frase in ogni sezione.
12. Mai citazioni tra virgolette prese dal web e mai frasi copiate: riformula con parole tue. Niente a-capo dentro un paragrafo: i paragrafi sono separati da una riga vuota.
13. TONO: la voce di un cronista che ama questo sport e racconta una storia, non quella di un redattore di statistiche. Ritmo, verbi forti, suspense: apri con una scena o con un dato che colpisce, dai a ogni protagonista un'immagine (una frase che lo fa vedere), chiudi con una frase che resta. Alterna frasi brevi e lunghe, usa il presente quando racconta il momento decisivo. Per capire il registro (esempio inventato, NON da copiare): "Tre secondi. Tanto basta per separare un'estate di fatica da una maglia." Vietati i cliche ("saldamente", "da sottolineare", "gran finale", "protagonista assoluto") e l'elenco di numeri senza una storia dentro. Non ripetere due volte la stessa informazione.
14. NIENTE CONFRONTI TESTA A TESTA tra atleti (chi e arrivato davanti a chi nelle gare in comune): i dati non lo permettono. LIMITI DEI DATI: del sito registriamo SOLO i primi 10 di ogni gara, quindi 'risultati_registrati' NON sono le gare corse da un atleta: non scrivere MAI 'N gare disputate' ne rapporti tra vittorie e gare; di' 'N vittorie e M podi'. Il punteggio di un atleta e ESCLUSIVAMENTE il campo 'punti' (lo stesso della classifica che chiude il post): i campi 'punti_di_ritardo_*' sono differenze tra due atleti, non punteggi, e non vanno mai presentati come punti di qualcuno.

FORMATO DELLA RISPOSTA: rispondi SOLO con queste sezioni, ciascuna introdotta dalla sua riga di intestazione, senza altro testo prima o dopo:
===TITOLO===
(una riga)
===SOMMARIO===
(1-2 frasi)
===CORPO===
(paragrafi separati da una riga vuota; eventuali sottotitoli con '## ')
===FONTI===
(una per riga: titolo | indirizzo | cosa ne hai ricavato; lascia vuoto se non hai usato fonti esterne)
===DA_VERIFICARE===
(una per riga, cose che un redattore deve controllare prima della pubblicazione; vuoto se nulla)
===TAG===
(parole chiave separate da virgola)`;

  const ISTRUZIONI = {
    gara: f => f.stato === 'risultati'
      ? `TIPO: RESOCONTO DI GARA (350-600 parole). Racconta chi ha vinto e come (distacchi, tempi, media se presenti), il podio per categoria, e il contesto: edizione, importanza della gara (campionato, moltiplicatore punti) e, quando sono pertinenti e nel rispetto della regola 8, i confronti con le edizioni precedenti dello stesso titolo nella stessa categoria. Se ci sono più categorie, una sezione ciascuna, dalla più alta alla più bassa, e il titolo con i nomi dei vincitori principali (regola 7).`
      : `TIPO: ANTEPRIMA DI GARA (300-500 parole). I risultati non ci sono ancora. Presenta la gara: data, luogo, categorie, programma/orari e percorso (dalle fonti web o ufficiali, se ci sono), albo d'oro delle ultime edizioni dai DATI, cosa c'è in palio (titolo, punti). Non fare pronostici su nomi se i DATI non li supportano.`,
    settimana: () => `TIPO: IL PUNTO DELLA SETTIMANA (450-700 parole). Riepilogo delle gare del periodo: i protagonisti per categoria (punti, vittorie, podi), eventuali cambi al comando delle classifiche e margini sul secondo, le gare più importanti. Struttura: apertura con la notizia principale, poi una sezione per le categorie con più movimento (non tutte se sono molte).`,
    atleta: () => `TIPO: PROFILO DI UN ATLETA (400-600 parole). Racconta la carriera dai dati: dalle categorie giovanili (archivio) alla stagione in corso, titoli, risultati migliori, evoluzione per anno, risultati su PCS. Il web può aggiungere contesto sportivo (squadra, successi noti) ma nessun dato privato.`,
  };

  ISTRUZIONI.stagione = f => `TIPO: RACCONTO DI FINE STAGIONE PER CATEGORIA (600-900 parole), scritto come un racconto, non come un riepilogo. La stagione ${f.stagione} e conclusa: racconta la categoria "${f.categoria}" come una storia: chi l'ha dominata, chi l'ha inseguita, quali giorni l'hanno decisa. Materiale: "storie_dei_primi_tre" (prima e ultima vittoria, vittorie mese per mese, la striscia di successi, la vittoria piu importante, il distacco piu largo, i successi di misura), "vittorie_importanti" e i campioni. REGOLA FERREA sui numeri: la classifica finale e quella UFFICIALE del sito (classifica_atleti): nomi, posizioni e punti si copiano cosi come sono, nello stesso ordine, e non si sostituiscono con numeri tuoi. Il titolo deve nominare il numero uno e, se e un'altra persona, il campione italiano. Struttura con sottotitoli '## ' che dicano qualcosa: apertura narrativa sul protagonista (una scena presa dai dati, poi il quadro: punti, vittorie); la seconda e il terzo della classifica, raccontati ciascuno per la propria stagione (mai confronti testa a testa); "I giorni che hanno deciso la stagione" (vittorie importanti, campioni italiani e regionali, solo se nei DATI); chiusura "Come e finita" con i primi della classifica ufficiale in una frase scorrevole con i punti. NON trattare le squadre (hanno un articolo a parte) e non fare confronti con altre stagioni.`;
  ISTRUZIONI.squadre = f => `TIPO: RACCONTO DI FINE STAGIONE SULLE SQUADRE (500-800 parole) della categoria "${f.categoria}", stagione ${f.stagione}. Racconta le squadre che hanno fatto la stagione: chi ha comandato la classifica, come (una squadra costruita su un solo campione oppure su tanti atleti che portano punti: guarda quota_dei_punti_portata_dal_migliore e atleti_a_punti), chi l'ha inseguita, quali atleti hanno portato in alto ciascuna. La classifica delle squadre e UFFICIALE (classifica_team): nomi, posizioni e punti si copiano cosi come sono, nell'ordine ufficiale. Apri con la squadra prima in classifica e con l'immagine di come ha vinto; sottotitoli '## ' che dicano qualcosa; chiudi con una frase che resta. Non confondere questo articolo con la classifica degli atleti e non fare confronti con altre stagioni.`;
  ISTRUZIONI.libero = f => `TIPO: RICHIESTA LIBERA DELLA REDAZIONE. Realizza esattamente cio che chiede il redattore (vedi INDICAZIONI DEL REDATTORE), usando i DATI. Lunghezza e forma come richiesto; se non le indica, 400-700 parole con titolo e sottotitoli. Se la richiesta chiede cose che non hai nei DATI, non inventarle: scrivilo in "da_verificare". RICHIESTA: ${String(f.richiesta || '').slice(0, 2000)}`;

  // una richiesta scritta a parole: l'AI sceglie quali dati del sito servono, noi li calcoliamo
  async function pianifica(richiesta) {
    const r = await callClaude(`Sei l'assistente di una redazione sportiva (ciclismo giovanile e dilettantistico italiano). Oggi e ${today()}. Data la RICHIESTA, scegli quali DATI del sito servono. Rispondi SOLO con righe nel formato "BLOCCO: tipo | riferimento", massimo 6 righe. Includi TUTTE le categorie che la richiesta nomina o implica: "Esordienti" sono quattro righe (ES1_M ES1_F ES2_M ES2_F), "Allievi" due (AL_M AL_F), "Juniores" due (JUN_M JUN_F), "Elite/Under 23" due (ELI_M ELI_F), a meno che la richiesta indichi solo uomini o solo donne. Tipi: gara (nome della gara come lo scriverebbe il redattore), atleta (nome e cognome), stagione (UN codice tra ${CATS_ALL.join(' ')}), settimana (data AAAA-MM-GG dell'ultimo giorno, oppure "ultima"). Se la richiesta non richiede dati specifici rispondi "BLOCCO: settimana | ultima".\n\nRICHIESTA: ${richiesta.slice(0, 1500)}`, false);
    const out = [];
    for (const m of String(r.text || '').matchAll(/BLOCCO:\s*(gara|atleta|stagione|settimana)\s*\|\s*([^\n]+)/gi)) out.push({ tipo: m[1].toLowerCase(), rif: m[2].trim() });
    return out.slice(0, 6).length ? out.slice(0, 6) : [{ tipo: 'settimana', rif: 'ultima' }];
  }
  const tokensDi = s => up(s).replace(/[^A-Z0-9 ]/g, ' ').split(' ').filter(w => w.length > 2);
  async function risolvi(b) {
    if (b.tipo === 'stagione') { const c = up(b.rif).replace(/[^A-Z0-9_]/g, ''); return { tipo: 'stagione', p: { id: c }, dati: await factsStagione(c) }; }
    if (b.tipo === 'squadre') { const c = up(b.rif).replace(/[^A-Z0-9_]/g, ''); return { tipo: 'squadre', p: { id: c }, dati: await factsSquadre(c) }; }
    if (b.tipo === 'settimana') { const fine = /^\d{4}-\d{2}-\d{2}$/.test(b.rif) ? b.rif : null; return { tipo: 'settimana', p: { fine }, dati: await factsSettimana(fine) }; }
    if (b.tipo === 'atleta') {
      const t = tokensDi(b.rif), ath = Object.values(await getData('athletes.json'));
      const hit = ath.filter(a => { const n = up(fullName(a)); return t.length && t.every(w => n.includes(w)); }).sort((x, y) => (y.punti_totali || 0) - (x.punti_totali || 0))[0];
      if (!hit) throw new Error(`atleta non trovato: ${b.rif}`);
      return { tipo: 'atleta', p: { id: hit.id }, dati: await factsAtleta(hit.id) };
    }
    const t = tokensDi(b.rif), cal = await getData('calendar.json'), oggi = today();
    const punt = g => { const n = new Set(tokensDi(g.nome)); return t.filter(w => n.has(w)).length; };
    const best = cal.filter(g => punt(g) >= Math.min(2, t.length)).sort((x, y) => punt(y) - punt(x) || Math.abs(Date.parse(x.data) - Date.parse(oggi)) - Math.abs(Date.parse(y.data) - Date.parse(oggi)))[0];
    if (!best) throw new Error(`gara non trovata: ${b.rif}`);
    return { tipo: 'gara', p: { id: best.id, tutte: true }, dati: await factsGara(best.id, { tutte: true }) };
  }

  // ---------- DOSSIER: il Ricercatore cerca fuori dal sito, come un giornalista, prima che si scriva ----------
  const DOSSIER_KEY = 'redazione_dossier';
  const TTL_DOSSIER = { gara: 2 * 24 * 3600 * 1000, atleta: 7 * 24 * 3600 * 1000 };
  let dsChain = Promise.resolve();
  async function leggiDossierTutti() {
    const { data, error } = await sb().from('kv_store').select('value').eq('key', DOSSIER_KEY).maybeSingle();
    if (error) throw new Error('lettura dossier: ' + error.message);
    return data && data.value && typeof data.value === 'object' && !Array.isArray(data.value) ? data.value : {};
  }
  function salvaDossier(chiave, d) {
    const run = dsChain.then(async () => {
      const tutti = await leggiDossierTutti();
      tutti[chiave] = d;
      const chiavi = Object.keys(tutti).sort((a, b) => String(tutti[b].creato).localeCompare(String(tutti[a].creato)));
      chiavi.slice(150).forEach(k => delete tutti[k]);                          // si tengono i 150 piu recenti
      const { error } = await sb().from('kv_store').upsert({ key: DOSSIER_KEY, value: tutti, updated_at: new Date().toISOString() });
      if (error) throw new Error('scrittura dossier: ' + error.message);
    });
    dsChain = run.catch(() => {});
    return run;
  }
  const impGara = g => (g.campionato_italiano ? 3 : 0) + (g.campionato_regionale ? 2 : 0) + ((g.moltiplicatore_punti || 1) >= 2 ? 1 : 0) + (g.tipo === 'nazionale' ? 1 : 0);
  function impostaDossier(tipo, facts, p) {
    if (tipo === 'gara') {
      const g = facts.gara, imp = impGara(g), anteprima = facts.stato !== 'risultati';
      const cat = [...new Set((facts.risultati || []).map(r => r.categoria))].join(', ') || g.categoria_calendario;
      const vincitori = (facts.risultati || []).map(r => (r.top10 || [])[0] ? `${r.categoria}: ${r.top10[0].atleta} (${r.top10[0].team || 's.t.'})` : null).filter(Boolean);
      return {
        chiave: `gara|${g.data}|${alboBase(g.nome)}|${facts.stato}`, ttl: TTL_DOSSIER.gara, ricerche: imp >= 3 ? 8 : imp >= 1 ? 5 : 3, regione: g.regione ? tc(g.regione) : '',
        oggetto: `la gara «${g.nome}» del ${g.data}${g.luogo ? ' a ' + g.luogo : ''}${g.regione ? ' (' + tc(g.regione) + ')' : ''}, categorie: ${cat}`,
        cosa: anteprima
          ? 'Cerca: programma e orari, percorso e circuito, organizzatore, iscrizioni, note del comitato regionale o provinciale, articoli di presentazione sulla stampa specializzata e locale, storia della corsa.'
          : 'Cerca: cronaca della gara su altre testate (specializzate e locali), comunicati della federazione e dell\'organizzatore, ordine d\'arrivo ufficiale per confrontarlo con i DATI, condizioni di gara (meteo, percorso), notizie dei giorni prima e dopo.',
        dati: { gara: g.nome, data: g.data, luogo: g.luogo, regione: g.regione, stato: facts.stato, campionato_italiano: g.campionato_italiano, campionato_regionale: g.campionato_regionale, vincitori }
      };
    }
    const a = facts.atleta || {};
    return {
      chiave: `atleta|${(p && p.id) || a.nome}`, ttl: TTL_DOSSIER.atleta, ricerche: 4, regione: '',
      oggetto: `l'atleta ${a.nome || ''}`,
      cosa: 'Cerca SOLO fatti sportivi pubblici: squadra attuale, risultati e vittorie citati dalla stampa specializzata o locale, convocazioni e selezioni, titoli. Nessuna informazione privata.',
      dati: { atleta: a.nome, squadra: a.team_attuale || null, categoria: a.categoria || null }
    };
  }
  function leggiJson(testo) {
    const t = String(testo || ''), i = t.indexOf('{'), j = t.lastIndexOf('}');
    if (i < 0 || j <= i) return null;
    try { return JSON.parse(t.slice(i, j + 1)); } catch (_) { return null; }
  }
  const LIVELLI = ['ufficiale', 'testata', 'locale', 'social'];
  async function ottieniDossier(tipo, facts, p) {
    const im = impostaDossier(tipo, facts, p);
    try {
      const tutti = await leggiDossierTutti(), hit = tutti[im.chiave];
      if (hit && Date.now() - Date.parse(hit.creato) < im.ttl) return { ...hit, dallarchivio: true };       // gia fatto per questa gara/atleta: nessun costo
    } catch (_) { /* si rifa */ }
    const prompt = `Sei il RICERCATORE di una redazione sportiva (ciclismo giovanile e dilettantistico italiano). Prepari un DOSSIER per il cronista: cerchi sul web, come farebbe un giornalista, informazioni su ${im.oggetto}. Oggi e ${today()}.

${im.cosa}
Fai fino a ${im.ricerche} ricerche mirate (nome della gara e anno, organizzatore, località, comitato regionale/provinciale, parole come "risultati", "cronaca", "presentazione"). Cerca in questo ordine di affidabilità: 1) UFFICIALE: Federazione Ciclistica Italiana (nazionale, comitato regionale, provinciale), società organizzatrice; 2) TESTATA: siti e giornali di ciclismo; 3) LOCALE: giornali, siti e portali del territorio; 4) SOCIAL: pagine pubbliche e forum, solo come indizio e mai come fonte unica.

REGOLE:
- Ogni informazione è una voce del dossier, riscritta con parole tue: è vietato copiare frasi dalle fonti.
- Per ogni voce indica ente o testata, indirizzo (https), data della fonte e il livello (ufficiale, testata, locale o social). "conferme" è il numero di fonti DIVERSE che riportano lo stesso fatto.
- I DATI DEL SITO qui sotto prevalgono: se una fonte li contraddice, scrivilo in "contraddizioni".
- Mai dati personali non sportivi (età, scuola, residenza, famiglia, salute, social privati). Per i minorenni solo risultati, squadra, convocazioni.
- Dichiarazioni di persone: solo come sintesi attribuita e solo se scritte in una fonte. Non inventare nulla: ciò che non trovi va in "non_trovato".

Rispondi SOLO con un JSON, senza altro testo:
{"voci":[{"tema":"programma|percorso|cronaca|storia|selezioni|squadra|altro","fatto":"...","fonte":{"nome":"...","url":"https://...","data":"AAAA-MM-GG oppure vuoto","livello":"ufficiale|testata|locale|social"},"conferme":1}],"contraddizioni":["..."],"non_trovato":["..."]}

DATI DEL SITO (riferimento, non da cercare): ${JSON.stringify(im.dati)}`;
    const res = await callClaude(prompt, true, 'dossier', { maxUses: im.ricerche, regione: im.regione });
    const j = leggiJson(res.text) || leggiJson(res.lastText);
    if (!j) throw new Error('dossier non leggibile');
    const voci = (Array.isArray(j.voci) ? j.voci : []).map(v => {
      const f = v && v.fonte || {};
      return { tema: String(v.tema || 'altro').slice(0, 20), fatto: String(v.fatto || '').slice(0, 600), conferme: Math.max(1, Number(v.conferme) || 1),
        fonte: { nome: String(f.nome || '').slice(0, 80), url: String(f.url || ''), data: /^\d{4}-\d{2}-\d{2}$/.test(String(f.data || '')) ? f.data : '', livello: LIVELLI.includes(f.livello) ? f.livello : 'testata' } };
    }).filter(v => v.fatto && /^https?:\/\//i.test(v.fonte.url)).slice(0, 25);        // una voce senza fonte non vale: si scarta
    const d = { chiave: im.chiave, creato: new Date().toISOString(), tipo, oggetto: im.oggetto, ricerche_max: im.ricerche, voci,
      contraddizioni: (Array.isArray(j.contraddizioni) ? j.contraddizioni : []).map(x => String(x).slice(0, 300)).slice(0, 8),
      non_trovato: (Array.isArray(j.non_trovato) ? j.non_trovato : []).map(x => String(x).slice(0, 200)).slice(0, 10) };
    try { await salvaDossier(im.chiave, d); } catch (e) { console.warn('[redazione] salvataggio dossier:', e.message); }
    return d;
  }

  const dichiara = (corpo, nome) => { const n = up(nome).replace(/[^A-Z0-9 ]/g, ' ').trim(); return n.length >= 3 && up(corpo).includes(n); };
  async function genera(tipo, p) {
    let facts, soggetto;
    if (tipo === 'gara') { facts = await factsGara(p.id, { tutte: !!p.tutte }); soggetto = facts.gara.nome; }
    else if (tipo === 'settimana') { facts = await factsSettimana(p.fine); soggetto = `Il punto della settimana (${facts.periodo.dal} – ${facts.periodo.al})`; }
    else if (tipo === 'atleta') { facts = await factsAtleta(p.id); soggetto = facts.atleta.nome; }
    else if (tipo === 'squadre') { facts = await factsSquadre(p.id); soggetto = `Squadre ${facts.stagione}: ${facts.categoria}`; }
    else if (tipo === 'stagione') { facts = await factsStagione(p.id); soggetto = `Stagione ${facts.stagione}: ${facts.categoria}`; }
    else if (tipo === 'libero') {
      const bl = [];
      if (Array.isArray(p.blocchi) && p.blocchi.length) {                      // dati gia scelti (spunti dell'Analista): niente pianificazione con l'AI, un blocco che non si risolve si salta
        for (const b of p.blocchi) { try { bl.push(await risolvi(b)); } catch (e) { console.warn('[redazione] blocco saltato:', e.message); } }
        if (!bl.length) bl.push(await risolvi({ tipo: 'settimana', rif: 'ultima' }));
      } else for (const b of await pianifica(p.richiesta)) bl.push(await risolvi(b));
      facts = { richiesta: p.richiesta, blocchi: bl }; soggetto = String(p.richiesta).replace(/\s+/g, ' ').slice(0, 70); }
    else throw new Error('tipo non valido');
    const link = await leggiLink((p.link || []).filter(Boolean));
    // per i profili di atleti la ricerca web e consentita solo per gli adulti (gia garantito da factsAtleta); per le gare/settimana senza restrizioni
    let dossier = null;
    if (p.web && (tipo === 'gara' || tipo === 'atleta')) { try { dossier = await ottieniDossier(tipo, facts, p); } catch (e) { console.warn('[redazione] dossier:', e.message); } }
    const web = !!p.web && !dossier;                                           // con il dossier lo scrittore non ripete la ricerca
    const prompt = `${REGOLE}\n\n${ISTRUZIONI[tipo](facts)}\n\nRicerca web: ${web ? 'ATTIVA (usala per il contesto, max 5 ricerche)' : 'NON disponibile: usa solo DATI e pagine ufficiali'}.\n\nDATI (JSON):\n${JSON.stringify(facts, null, 1)}\n` +
      (dossier ? `\nDOSSIER DEL RICERCATORE (informazioni prese da altre fonti: ufficiali, testate, giornali locali). Usalo per il contesto e riportalo come farebbe un giornalista: con parole tue e nominando la fonte nel testo. Le voci con livello "social" o con una sola fonte non ufficiale vanno in DA_VERIFICARE, non nel testo. Le fonti che usi vanno in FONTI con il loro indirizzo. Cio che e in non_trovato NON va inventato.\n${JSON.stringify({ voci: dossier.voci, contraddizioni: dossier.contraddizioni, non_trovato: dossier.non_trovato }, null, 1)}\n` : '') +
      (link.length ? `\nPAGINE UFFICIALI INDICATE DALLA REDAZIONE (testo estratto; puoi usarle come fonte, riscrivendo con parole tue):\n${JSON.stringify(link, null, 1)}\n` : '') +
      (p.indicazioni ? `\nINDICAZIONI DEL REDATTORE: ${String(p.indicazioni).slice(0, tipo === 'libero' ? 2500 : 600)}\n` : '');
    const cand = await fotoCandidate(tipo, p, facts);
    const res = await callClaude(prompt, web, 'articolo');
    const j = parseJson(res);
    const piazzata = piazzaFotoAuto(String(j.corpo || ''), cand, facts, p);
    j.corpo = piazzata.corpo;
    j.titolo = await controllaTitolo(j, tipo, facts);
    const fonti = [...(Array.isArray(j.fonti) ? j.fonti : [])];
    link.filter(l => !l.errore).forEach(l => { if (!fonti.some(f => f.url === l.url)) fonti.push({ titolo: l.titolo || l.url, url: l.url, uso: 'pagina ufficiale indicata' }); });
    const dv = Array.isArray(j.da_verificare) ? j.da_verificare : [];
    if (dossier) { dossier.contraddizioni.forEach(x => dv.push('Dal dossier, fonte in contrasto con i dati: ' + x)); dossier.voci.forEach(v => { if (!fonti.some(f => f.url === v.fonte.url) && v.fonte.livello !== 'social' && dichiara(j.corpo, v.fonte.nome)) fonti.push({ titolo: v.fonte.nome || v.fonte.url, url: v.fonte.url, uso: 'dal dossier del Ricercatore (' + v.fonte.livello + ')' }); }); }
    link.filter(l => l.errore).forEach(l => dv.push(`Link non letto (${l.errore}): ${l.url}`));
    return { titolo: String(j.titolo || soggetto), sommario: String(j.sommario || ''), corpo: String(j.corpo || ''), fonti, da_verificare: dv, tag: Array.isArray(j.tag) ? j.tag : [],
      soggetto, dossier: dossier ? { creato: dossier.creato, dallarchivio: !!dossier.dallarchivio, voci: dossier.voci, contraddizioni: dossier.contraddizioni, non_trovato: dossier.non_trovato } : null, foto: piazzata.foto, dati: JSON.stringify(facts).length < 80000 ? facts : { nota: 'dati troppo grandi per essere salvati' }, token: res.usage };
  }

  app.locals.redazione = { factsGara, factsSettimana, factsAtleta, factsStagione, factsSquadre, leggiLink, alboFor };   // per le prove

  // ---------- API ----------
  app.get('/api/admin/redazione/bozze', requireAdmin, async (req, res) => {
    try { res.json({ bozze: (await readAll()).sort((a, b) => String(b.creato).localeCompare(String(a.creato))) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // crea la bozza (in scrittura) e la completa in background: la generazione puo durare 1-2 minuti con la ricerca web
  async function catDiAtleta(id) {
    const raw = await getData('results_raw.json'); let best = null;
    for (const r of raw) if (r.atleta_id === id && catOf(r) && (!best || r.data > best.data)) best = r;
    return best ? catOf(best) : null;
  }
  async function avvia(tipo, p, soggetto) {
    if (tipo === 'atleta' && p.id && !p.cat) { try { p.cat = await catDiAtleta(p.id); } catch (_) { /* senza categoria */ } }
    const id = crypto.randomBytes(6).toString('hex'), now = new Date().toISOString();
    await mutate(arr => { arr.push({ id, tipo, stato: 'in_generazione', soggetto: soggetto || p.id || 'settimana', parametri: p, creato: now, aggiornato: now }); });
    const fine = genera(tipo, p).then(art => mutate(arr => { const x = arr.find(a => a.id === id); if (x) Object.assign(x, art, { stato: 'bozza', aggiornato: new Date().toISOString() }); }))
      .catch(e => { console.warn('[redazione] generazione fallita:', e.message); return mutate(arr => { const x = arr.find(a => a.id === id); if (x) Object.assign(x, { stato: 'errore', errore: e.message, aggiornato: new Date().toISOString() }); }).catch(() => {}); });
    return { id, fine };
  }

  app.post('/api/admin/redazione/genera', requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const tipo = String(b.tipo || '');
      if (!['gara', 'settimana', 'atleta', 'stagione', 'squadre'].includes(tipo)) return res.status(400).json({ error: 'tipo non valido' });
      if ((tipo === 'gara' || tipo === 'atleta' || tipo === 'stagione' || tipo === 'squadre') && !b.id) return res.status(400).json({ error: "scegli la gara o l'atleta" });
      const p = { id: String(b.id || ''), fine: b.fine ? String(b.fine).slice(0, 10) : null, web: !!b.web, tutte: b.tutte !== false, link: Array.isArray(b.link) ? b.link.map(String).slice(0, 5) : [], indicazioni: b.indicazioni || '' };
      const { id } = await avvia(tipo, p);
      res.json({ ok: true, id });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // richiesta scritta a parole dal redattore: l'AI capisce cosa serve, il sito calcola i dati
  app.post('/api/admin/redazione/richiesta', requireAdmin, async (req, res) => {
    try {
      const testo = String((req.body || {}).testo || '').trim();
      if (testo.length < 8) return res.status(400).json({ error: 'scrivi cosa vuoi realizzare (almeno una frase)' });
      const p = { richiesta: testo.slice(0, 2000), indicazioni: testo.slice(0, 2000), web: !!(req.body || {}).web, link: Array.isArray((req.body || {}).link) ? req.body.link.map(String).slice(0, 5) : [] };
      const { id } = await avvia('libero', p, testo.replace(/\s+/g, ' ').slice(0, 70));
      res.json({ ok: true, id });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // gli articoli di fine stagione: uno per categoria, scritti uno alla volta in background
  app.post('/api/admin/redazione/stagione', requireAdmin, async (req, res) => {
    try {
      if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: 'ANTHROPIC_API_KEY non configurata' });
      const kind = (req.body || {}).tipo === 'squadre' ? 'squadre' : 'stagione';
      const y = await anno(), esist = new Set((await readAll()).map(b => b.parametri && b.parametri.chiave).filter(Boolean));
      const web = !!(req.body || {}).web;
      const daFare = CATS_ALL.filter(c => !esist.has(`${kind}|${y}|${c}`));
      res.json({ ok: true, avviati: daFare.length, gia_presenti: CATS_ALL.length - daFare.length });
      (async () => { for (const c of daFare) { try { const { fine } = await avvia(kind, { id: c, web, link: [], indicazioni: '', chiave: `${kind}|${y}|${c}`, auto: false }, `${kind === 'squadre' ? 'Squadre' : 'Stagione'} ${y}: ${CAT_NOME[c]}`); await fine; } catch (e) { console.warn('[redazione]', kind, c, e.message); } } })();
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- articoli automatici: ogni evento importante recente (o imminente) ha gia la sua bozza ----------
  const MAX_PER_GIRO = 4, MAX_AL_GIORNO = 12, GIORNI_INDIETRO = 7;   // una gara senza risultati viene ripresa nelle fasce dei 7 giorni successivi
  let inCorso = false;
  async function autoGenera() {
    if (inCorso) return { avviati: 0, nota: 'gia in corso' };
    if (!process.env.ANTHROPIC_API_KEY) return { avviati: 0, nota: 'ANTHROPIC_API_KEY non configurata' };
    const cfgA = await getCfg();
    if (!cfgA.auto_attiva) return { avviati: 0, nota: 'generazione automatica spenta' };   // spenta di default: la accende l'amministratore
    inCorso = true;
    try {
      const [cal, raw] = await Promise.all([getData('calendar.json'), getData('results_raw.json')]);
      const t = today(), arr = await readAll();
      const chiavi = new Set(arr.map(b => b.parametri && b.parametri.chiave).filter(Boolean));
      const oggiFatte = arr.filter(b => b.parametri && b.parametri.auto && String(b.creato).slice(0, 10) === t).length;
      let manual = [];
      try { const { data } = await sb().from('manual_results').select('gara_id,data,nome_gara,posizione').gte('data', shift(t, -GIORNI_INDIETRO)); manual = data || []; } catch (_) { /* solo scraper */ }
      const righe = (raw || []).filter(r => r.data >= shift(t, -GIORNI_INDIETRO)).concat(manual);
      const vistiEv = new Set(), cand = [];
      for (const c of (cal || [])) {
        if (!c.data || c.data < shift(t, -GIORNI_INDIETRO) || c.data > shift(t, 2) || !c.nome || c.nome.trim() === '-') continue;
        const ev = `${c.data}|${alboBase(c.nome)}`;
        if (vistiEv.has(ev)) continue; vistiEv.add(ev);
        const imp = (c.campionato_italiano ? 3 : 0) + (c.campionato_regionale ? 2 : 0) + ((c.moltiplicatore || 1) >= 2 ? 1 : 0) + (c.tipo === 'nazionale' ? 1 : 0);
        const n = righe.filter(r => r.data === c.data && alboBase(r.nome_gara) === alboBase(c.nome)).length;
        if (c.data <= t && n) cand.push({ c, imp, n, chiave: `gara|risultati|${ev}` });
        else if (c.data > t && imp >= 1) cand.push({ c, imp, n: 0, chiave: `gara|anteprima|${ev}` });
      }
      cand.sort((a, b) => b.imp - a.imp || b.n - a.n);
      const daFare = cand.filter(x => !chiavi.has(x.chiave) && (x.imp >= 1 || x.n > 0)).slice(0, Math.max(0, Math.min(MAX_PER_GIRO, MAX_AL_GIORNO - oggiFatte)));   // i resoconti con risultati valgono anche per le gare minori (la maggior parte)
      const webDa = Number.isFinite(Number(cfgA.web_auto_da_imp)) ? Number(cfgA.web_auto_da_imp) : 0;
      let avviati = 0;
      for (const x of daFare) {
        const { fine } = await avvia('gara', { id: x.c.id, tutte: true, web: x.imp >= webDa, link: [], indicazioni: '', chiave: x.chiave, auto: true }, x.c.nome);
        avviati++; await fine;                                           // una alla volta: niente raffiche di richieste
      }
      // il miglior spunto dell'Analista non ancora usato: una bozza per giro (solo bozza, mai pubblicata)
      if (cfgA.auto_spunti !== false && oggiFatte + avviati < MAX_AL_GIORNO) {
        try {
          const v = await leggiSpunti(), s = v && v.spunti.find(x => x.stato === 'nuovo' && !chiavi.has('spunto|' + x.id));
          if (s) { const r = await avviaDaSpunto(s, false, true); avviati++; await r.fine; }
        } catch (e) { console.warn('[redazione] auto spunto:', e.message); }
      }
      // il punto della settimana: lunedi e martedi, per l'ultima settimana con gare
      const gg = new Date().getUTCDay();
      if ((gg === 1 || gg === 2) && oggiFatte + avviati < MAX_AL_GIORNO) {
        const ultimo = (raw || []).reduce((m, r) => (r.data && r.data <= t && r.data > m ? r.data : m), '');
        const chiave = `settimana|${ultimo}`;
        if (ultimo && !chiavi.has(chiave)) { const { fine } = await avvia('settimana', { fine: ultimo, web: false, link: [], indicazioni: '', chiave, auto: true }, `Il punto della settimana (fino al ${ultimo})`); avviati++; await fine; }
      }
      return { avviati };
    } catch (e) { console.warn('[redazione] auto:', e.message); return { avviati: 0, errore: e.message }; }
    finally { inCorso = false; }
  }
  if (deps._test) deps._test({ callClaude, getCfg, spesaMese });            // solo per le prove automatiche
  // impostazioni e consumi (solo amministratori)
  // ---------- ANALISTA: spunti calcolati dai dati con regole fisse. L'AI non sceglie nulla: al massimo li spiega o li trasforma in bozza ----------
  const SPUNTI_KEY = 'redazione_spunti';
  const tc = s => String(s || '').toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  const nomeAtl = r => `${tc(r.nome)} ${tc(r.cognome)}`.trim();
  const idSpunto = (tipo, chiave, fine) => tipo + '-' + crypto.createHash('sha1').update(`${tipo}|${chiave}|${fine}`).digest('hex').slice(0, 8);
  function calcolaSpunti(raw, fineOpt) {
    const righe = (raw || []).filter(r => r.data && r.tipo !== 'pista' && Number(r.posizione) > 0 && r.atleta_id && catOf(r));
    const fine = fineOpt || righe.reduce((m, r) => (r.data <= today() && r.data > m ? r.data : m), '');
    if (!fine) return { fine: null, spunti: [] };
    const dalA = shift(fine, -27), dalB = shift(fine, -55), alB = shift(fine, -28), dalC = shift(fine, -59);
    const inA = r => r.data >= dalA && r.data <= fine, inB = r => r.data >= dalB && r.data <= alB;
    const pos = r => Number(r.posizione), pt = r => Number(r.punti_effettivi) || 0;
    const gara = r => ({ nome: r.nome_gara, data: r.data, pos: pos(r) });
    const periodo = { dal: dalA, al: fine };
    const ord = (a, b) => a.data.localeCompare(b.data) || (a._scrape_seq || 0) - (b._scrape_seq || 0);
    const cands = [];
    // --- atleti (un solo spunto per atleta e categoria: il migliore)
    const perAtl = new Map();
    for (const r of righe) if (r.data <= fine) { const k = r.atleta_id + '|' + catOf(r); if (!perAtl.has(k)) perAtl.set(k, []); perAtl.get(k).push(r); }
    for (const [k, lista0] of perAtl) {
      const seen = new Set(), lista = lista0.sort(ord).filter(r => !seen.has(r.gara_id) && seen.add(r.gara_id));
      const ultima = lista[lista.length - 1], cat = catOf(ultima), a = { id: ultima.atleta_id, nome: nomeAtl(ultima), team: ultima.team || '' };
      const base = { categoria: CAT_NOME[cat] || cat, codice_categoria: cat, periodo, atleti: [a] }, mie = [];
      const winsA = lista.filter(r => inA(r) && pos(r) === 1);
      if (winsA.length >= 3) mie.push({ ...base, tipo: 'vittorie', score: winsA.length * 10, titolo: `${a.nome} ha vinto ${winsA.length} gare in quattro settimane`, motivo: 'Almeno 3 vittorie in 28 giorni.', gare: winsA.slice(-6).map(gara), dati: { vittorie: winsA.length } });
      let serie = 0; for (let i = lista.length - 1; i >= 0 && pos(lista[i]) <= 3; i--) serie++;
      if (serie >= 3 && ultima.data >= dalA) mie.push({ ...base, tipo: 'podi', score: serie * 8, titolo: `${a.nome} sul podio per ${serie} gare di fila`, motivo: 'Almeno 3 podi consecutivi, l\'ultimo negli ultimi 28 giorni.', gare: lista.slice(-Math.min(serie, 6)).map(gara), dati: { podi_consecutivi: serie } });
      const pA = lista.filter(inA).reduce((s, r) => s + pt(r), 0), pB = lista.filter(inB).reduce((s, r) => s + pt(r), 0);
      if (pA >= 20 && pA >= 2 * pB && pA - pB >= 15) mie.push({ ...base, tipo: 'crescita', score: (pA - pB) / 2, titolo: `${a.nome} accelera: ${pA} punti in quattro settimane contro ${pB} delle precedenti`, motivo: 'Punti almeno doppi rispetto alle 4 settimane prima (minimo 20 punti, +15).', gare: lista.filter(inA).map(gara).slice(-6), dati: { punti_ultime_4_settimane: pA, punti_4_settimane_prima: pB } });
      const gA = lista.filter(inA);
      if (gA.length >= 5 && gA.every(r => pos(r) <= 10)) mie.push({ ...base, tipo: 'costanza', score: gA.length * 4, titolo: `${a.nome}: ${gA.length} gare in quattro settimane, sempre nei primi 10`, motivo: 'Almeno 5 gare in 28 giorni, tutte nei primi 10.', gare: gA.map(gara).slice(-6), dati: { gare: gA.length, miglior_piazzamento: Math.min(...gA.map(pos)) } });
      if (mie.length) cands.push({ ...mie.sort((x, y) => y.score - x.score)[0], _k: k });
    }
    // --- squadre: ogni squadra si valuta per categoria e sesso, cosi ogni addetto ai team vede solo il suo campo
    const perTeam = new Map();
    for (const r of righe) if (r.data <= fine && r.team) { const cat = catOf(r), k = (r.team_id || r.team) + '|' + cat; if (!perTeam.has(k)) perTeam.set(k, { nome: r.team, cat, A: 0, B: 0, vittorie: new Map() }); const t = perTeam.get(k); if (inA(r)) { t.A += pt(r); if (pos(r) === 1) t.vittorie.set(r.gara_id, r); } else if (inB(r)) t.B += pt(r); }
    for (const [k, t] of perTeam) {
      const cat = t.cat, nc = CAT_NOME[cat] || cat, base = { categoria: nc, codice_categoria: cat, periodo, atleti: [], team: t.nome }, mie = [];
      if (t.vittorie.size >= 3) mie.push({ ...base, tipo: 'squadra_vittorie', score: t.vittorie.size * 6, titolo: `${tc(t.nome)}: ${t.vittorie.size} vittorie in quattro settimane (${nc})`, motivo: 'Almeno 3 vittorie di squadra in questa categoria in 28 giorni.', gare: [...t.vittorie.values()].sort(ord).map(gara).slice(-6), dati: { vittorie: t.vittorie.size, punti_ultime_4_settimane: t.A } });
      if (t.A >= 25 && t.A >= 1.5 * t.B && t.A - t.B >= 15) mie.push({ ...base, tipo: 'squadra_crescita', score: (t.A - t.B) / 3, titolo: `${tc(t.nome)} in crescita: ${t.A} punti in quattro settimane contro ${t.B} (${nc})`, motivo: 'Punti di squadra in questa categoria almeno 1,5 volte quelli delle 4 settimane prima (minimo 25, +15).', gare: [], dati: { punti_ultime_4_settimane: t.A, punti_4_settimane_prima: t.B } });
      if (mie.length) cands.push({ ...mie.sort((x, y) => y.score - x.score)[0], _k: 'team|' + k });
    }
    // --- rivalita: due atleti insieme sul podio in almeno 3 gare delle ultime 8 settimane
    const podi = new Map();
    for (const r of righe) if (r.data >= dalC && r.data <= fine && pos(r) <= 3) { if (!podi.has(r.gara_id)) podi.set(r.gara_id, []); podi.get(r.gara_id).push(r); }
    const coppie = new Map();
    for (const lista of podi.values()) for (let i = 0; i < lista.length; i++) for (let j = i + 1; j < lista.length; j++) {
      const [x, y] = [lista[i], lista[j]].sort((p, q) => p.atleta_id.localeCompare(q.atleta_id)), k = x.atleta_id + '|' + y.atleta_id;
      if (!coppie.has(k)) coppie.set(k, { x, y, n: 0, xAvanti: 0, gare: [] });
      const c = coppie.get(k); c.n++; if (pos(x) < pos(y)) c.xAvanti++; c.gare.push({ nome: x.nome_gara, data: x.data, pos: `${nomeAtl(x)} ${pos(x)}°, ${nomeAtl(y)} ${pos(y)}°` });
    }
    for (const [k, c] of coppie) if (c.n >= 3) {
      const cat = catOf(c.x), yAvanti = c.n - c.xAvanti;
      cands.push({ tipo: 'rivalita', _k: 'riv|' + k, categoria: CAT_NOME[cat] || cat, codice_categoria: cat, periodo: { dal: dalC, al: fine }, score: c.n * 7,
        atleti: [{ id: c.x.atleta_id, nome: nomeAtl(c.x), team: c.x.team || '' }, { id: c.y.atleta_id, nome: nomeAtl(c.y), team: c.y.team || '' }],
        titolo: `${nomeAtl(c.x)} e ${nomeAtl(c.y)}: ${c.n} podi insieme in otto settimane`, motivo: 'Due atleti insieme sul podio in almeno 3 gare delle ultime 8 settimane.',
        gare: c.gare.sort((p, q) => p.data.localeCompare(q.data)).slice(-6), dati: { podi_insieme: c.n, [`davanti_${nomeAtl(c.x)}`]: c.xAvanti, [`davanti_${nomeAtl(c.y)}`]: yAvanti } });
    }
    // --- scelta: il migliore per ogni addetto (atleti o team, per categoria e sesso)
    const ruoloDi = c => (/^squadra/.test(c.tipo) ? 'team' : 'atleti'), migliori = new Map();
    for (const c of cands.sort((x, y) => y.score - x.score)) { const k = ruoloDi(c) + '|' + c.codice_categoria; if (!migliori.has(k)) migliori.set(k, c); }
    return { fine, spunti: [...migliori.values()].map(({ _k, ...c }) => ({ id: idSpunto(c.tipo, _k || c.titolo, fine), ...c, ruolo: ruoloDi(c), score: Math.round(c.score * 10) / 10 })) };
  }
  async function leggiSpunti() {
    const { data, error } = await sb().from('kv_store').select('value').eq('key', SPUNTI_KEY).maybeSingle();
    if (error) throw new Error('lettura spunti: ' + error.message);
    return data && data.value && Array.isArray(data.value.spunti) ? data.value : null;
  }
  let spChain = Promise.resolve();
  function mutaSpunti(fn) {
    const run = spChain.then(async () => {
      const v = (await leggiSpunti()) || { generato: null, fine: null, spunti: [] };
      const out = await fn(v);
      const { error } = await sb().from('kv_store').upsert({ key: SPUNTI_KEY, value: v, updated_at: new Date().toISOString() });
      if (error) throw new Error('scrittura spunti: ' + error.message);
      return out;
    });
    spChain = run.catch(() => {});
    return run;
  }
  async function ricalcolaSpunti() {
    const nuovo = calcolaSpunti(await getData('results_raw.json')), attesa = await gareInAttesa();
    return mutaSpunti(v => {
      const vecchi = new Map(v.spunti.map(s => [s.id, s]));
      v.spunti = nuovo.spunti.map(s => { const o = vecchi.get(s.id); return o ? { ...s, spiegazione: o.spiegazione, stato: o.stato || 'nuovo', bozza_id: o.bozza_id } : { ...s, stato: 'nuovo' }; });
      v.fine = nuovo.fine; v.generato = new Date().toISOString(); v.attesa = attesa;
      return v;
    });
  }
  // l'Analista guarda i dati da solo, ogni ora (calcolo gratuito)
  const _tmrAnalista = setInterval(() => { ricalcolaSpunti().catch(e => console.warn('[redazione] analista:', e.message)); }, 60 * 60 * 1000);
  if (_tmrAnalista.unref) _tmrAnalista.unref();
  // i dati dell'articolo li sceglie il codice (non l'AI): atleti dello spunto, oppure le squadre della categoria
  function blocchiSpunto(s) {
    const bl = /^squadra/.test(s.tipo) ? [] : (s.atleti || []).slice(0, 2).map(a => ({ tipo: 'atleta', rif: a.nome }));
    if (!bl.length && s.codice_categoria) bl.push({ tipo: 'squadre', rif: s.codice_categoria });
    return bl.length ? bl : [{ tipo: 'settimana', rif: 'ultima' }];
  }
  async function avviaDaSpunto(s, web, auto) {
    const ruolo = /^squadra/.test(s.tipo) ? `Sei l'addetto ai team della categoria ${s.categoria}: parla solo di squadre di questa categoria, non di altre categorie.` : `Sei l'addetto agli atleti della categoria ${s.categoria}: parla solo di atleti di questa categoria, non di altre categorie.`;
    const richiesta = `${ruolo} Scrivi un articolo su questo spunto dell'Analista: ${s.titolo}. Categoria: ${s.categoria}. Periodo: dal ${s.periodo.dal} al ${s.periodo.al}. ${s.motivo} Usa i dati del sito per i dettagli (gare, risultati, classifiche) e non inventare nulla.`;
    const indicazioni = JSON.stringify({ titolo: s.titolo, atleti: s.atleti, squadra: s.team, gare: s.gare, dati: s.dati }).slice(0, 2400);
    const { id, fine } = await avvia('libero', { richiesta, indicazioni, blocchi: blocchiSpunto(s), web: !!web, link: [], auto: !!auto, chiave: 'spunto|' + s.id }, s.titolo.slice(0, 70));
    await mutaSpunti(x => { const t = x.spunti.find(z => z.id === s.id); if (t) { t.stato = 'usato'; t.bozza_id = id; } });
    return { id, fine };
  }
  // gare passate senza risultati nel sito (ultimi 7 giorni): servono a sapere cosa si sta aspettando
  async function gareInAttesa() {
    try {
      const [cal, raw] = await Promise.all([getData('calendar.json'), getData('results_raw.json')]);
      const t = today(), da = shift(t, -GIORNI_INDIETRO), visti = new Set(), out = [];
      const con = new Set(raw.filter(r => r.data >= da).map(r => `${r.data}|${alboBase(r.nome_gara)}`));
      for (const c of (cal || [])) {
        if (!c.data || c.data < da || c.data > t || !c.nome || c.nome.trim() === '-') continue;
        const k = `${c.data}|${alboBase(c.nome)}`;
        if (visti.has(k)) continue; visti.add(k);
        if (!con.has(k)) out.push({ nome: c.nome, data: c.data, regione: c.regione || '' });
      }
      return out.sort((a, b) => b.data.localeCompare(a.data)).slice(0, 12);
    } catch (_) { return []; }
  }
  app.locals.redazione = Object.assign(app.locals.redazione || {}, { calcolaSpunti, blocchiSpunto });
  app.get('/api/admin/redazione/spunti', requireAdmin, async (req, res) => {
    try {
      let v = await leggiSpunti();
      if (!v || !v.generato || !v.attesa || Date.now() - Date.parse(v.generato) > 3 * 3600 * 1000) v = await ricalcolaSpunti();
      const bz = new Map((await readAll()).map(b => [b.id, b.stato]));       // uno spunto la cui bozza e fallita o stata cancellata torna disponibile
      if (v.spunti.some(s => s.stato === 'usato' && s.bozza_id && (!bz.has(s.bozza_id) || bz.get(s.bozza_id) === 'errore')))
        v = await mutaSpunti(x => { x.spunti.forEach(s => { if (s.stato === 'usato' && s.bozza_id && (!bz.has(s.bozza_id) || bz.get(s.bozza_id) === 'errore')) { s.stato = 'nuovo'; delete s.bozza_id; } }); return x; });   // il calcolo e gratuito: nessuna chiamata a Claude
      res.json(v);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/admin/redazione/spunti/calcola', requireAdmin, async (req, res) => {
    try { res.json(await ricalcolaSpunti()); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/admin/redazione/spunti/:id/stato', requireAdmin, async (req, res) => {
    try {
      const stato = String((req.body || {}).stato || '');
      if (!['nuovo', 'scartato'].includes(stato)) return res.status(400).json({ error: 'stato non valido' });
      const ok = await mutaSpunti(v => { const s = v.spunti.find(x => x.id === req.params.id); if (!s) return false; s.stato = stato; return true; });
      res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: 'spunto non trovato' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/admin/redazione/spunti/:id/spiega', requireAdmin, async (req, res) => {   // una chiamata breve a Claude, senza ricerca web
    try {
      const v = await leggiSpunti(), s = v && v.spunti.find(x => x.id === req.params.id);
      if (!s) return res.status(404).json({ error: 'spunto non trovato' });
      const dati = JSON.stringify({ titolo: s.titolo, categoria: s.categoria, periodo: s.periodo, atleti: s.atleti, squadra: s.team, gare: s.gare, dati: s.dati, perche_scelto: s.motivo });
      const r = await callClaude(`Sei l'analista di una redazione di ciclismo giovanile e dilettantistico italiano. Spiega a un redattore, in 3 frasi al massimo, perche questo spunto e interessante da raccontare. Usa SOLO i numeri e i nomi dei DATI: non inventare niente, non aggiungere contesto esterno. Rispondi solo con il testo, senza titoli ne elenchi.\n\nDATI: ${dati}`, false, 'spunto');
      const testo = String(r.text || '').trim().slice(0, 1200);
      if (!testo) throw new Error('risposta vuota');
      await mutaSpunti(x => { const t = x.spunti.find(z => z.id === s.id); if (t) t.spiegazione = testo; });
      res.json({ ok: true, spiegazione: testo });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/admin/redazione/spunti/:id/articolo', requireAdmin, async (req, res) => {   // trasforma lo spunto in una bozza (richiesta libera)
    try {
      const v = await leggiSpunti(), s = v && v.spunti.find(x => x.id === req.params.id);
      if (!s) return res.status(404).json({ error: 'spunto non trovato' });
      res.json({ ok: true, id: (await avviaDaSpunto(s, !!(req.body || {}).web, false)).id });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/admin/redazione/costi', requireAdmin, async (req, res) => {
    try {
      const c = await getCfg(true), s = await spesaMese();
      const ultime = (await rawQuery(`SELECT ts, modello, uso, token_in, token_out, ricerche, costo_usd::float AS costo_usd, esito FROM ai_usage ORDER BY ts DESC LIMIT 30`)).rows;
      const mesi = (await rawQuery(`SELECT mese, COUNT(*)::int AS richieste, COALESCE(SUM(token_in),0)::int AS token_in, COALESCE(SUM(token_out),0)::int AS token_out, COALESCE(SUM(costo_usd),0)::float AS costo_usd FROM ai_usage WHERE esito='ok' GROUP BY mese ORDER BY mese DESC LIMIT 6`)).rows;
      res.json({ config: c, modello: MODEL, chiave: !!process.env.ANTHROPIC_API_KEY, mese: meseOra(), spesa_mese: s.usd, richieste_mese: s.n, ultime, mesi });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.put('/api/admin/redazione/config', requireAdmin, async (req, res) => {
    try {
      const b = req.body || {}, c = await getCfg(true), nuovo = { ...c };
      if (typeof b.ai_attiva === 'boolean') nuovo.ai_attiva = b.ai_attiva;
      if (typeof b.auto_attiva === 'boolean') nuovo.auto_attiva = b.auto_attiva;
      if (b.limite_mensile_usd != null) { const n = Number(b.limite_mensile_usd); if (!(n >= 0 && n <= 1000)) return res.status(400).json({ error: 'limite non valido (0-1000 $)' }); nuovo.limite_mensile_usd = n; }
      if (b.web_auto_da_imp != null) { const n = Number(b.web_auto_da_imp); if (![0, 1, 3, 99].includes(n)) return res.status(400).json({ error: 'soglia ricerca web non valida' }); nuovo.web_auto_da_imp = n; }
      if (b.prezzi && typeof b.prezzi === 'object') for (const [m, p] of Object.entries(b.prezzi)) if (p && p.in >= 0 && p.out >= 0) nuovo.prezzi[m] = { in: Number(p.in), out: Number(p.out) };
      const { error } = await sb().from('kv_store').upsert({ key: CFG_KEY, value: nuovo, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      _cfg = null;
      res.json({ ok: true, config: await getCfg(true) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/admin/redazione/auto', requireAdmin, async (req, res) => {
    if (inCorso) return res.json({ ok: true, nota: 'sto gia scrivendo' });
    autoGenera().catch(() => {});                                        // in background: la pagina vede le bozze comparire
    res.json({ ok: true });
  });
  // fasce orarie (ora italiana): di default mattina, pranzo e sera. Un controllo ogni 5 minuti; ogni fascia parte una volta al giorno.
  // Se il server si riavvia durante la fascia, il secondo giro non trova gare nuove da scrivere (le chiavi gia presenti vengono saltate).
  const _fasceFatte = new Set();
  if (process.env.ANTHROPIC_API_KEY) setInterval(async () => {
    try {
      const c = await getCfg();
      if (!c.auto_attiva) return;
      const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(new Date());
      const g = Object.fromEntries(f.map(p => [p.type, p.value])), giorno = `${g.year}-${g.month}-${g.day}`, ora = Number(g.hour) % 24;
      for (const h of (c.auto_orari || [])) {
        const k = giorno + '|' + h;
        if (ora === Number(h) && !_fasceFatte.has(k)) { _fasceFatte.add(k); if (_fasceFatte.size > 20) _fasceFatte.delete(_fasceFatte.values().next().value); await autoGenera(); }
      }
    } catch (e) { console.warn('[redazione] fasce auto:', e.message); }
  }, 5 * 60 * 1000);

  app.put('/api/admin/redazione/bozze/:id', requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const out = await mutate(arr => {
        const x = arr.find(a => a.id === req.params.id); if (!x) return null;
        ['titolo', 'sommario', 'corpo'].forEach(k => { if (typeof b[k] === 'string') x[k] = b[k]; });
        if (['bozza', 'approvata', 'scartata'].includes(b.stato)) x.stato = b.stato;
        if (Array.isArray(b.foto)) x.foto = b.foto.filter(f => f && /^https?:\/\//i.test(f.url || '')).slice(0, 6).map(f => ({ url: String(f.url), credito: String(f.credito || '').slice(0, 120), didascalia: String(f.didascalia || '').slice(0, 200) }));
        x.aggiornato = new Date().toISOString(); _pubMemo.t = 0;
        return x;
      });
      if (!out) return res.status(404).json({ error: 'bozza non trovata' });
      res.json({ ok: true, bozza: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // elenco delle foto disponibili per una bozza (per sceglierle nell'editor)
  app.get('/api/admin/redazione/foto/:id', requireAdmin, async (req, res) => {
    try {
      const b = (await readAll()).find(a => a.id === req.params.id);
      if (!b) return res.status(404).json({ error: 'bozza non trovata' });
      res.json({ foto: await fotoCandidate(b.tipo, b.parametri || {}, b.dati || {}) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });


  // ---------- pubblicazione sulle pagine dei corridori ----------
  const slugify = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
  const escH = t => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let _pubMemo = { t: 0, v: [] };
  async function pubblicati() {
    if (Date.now() - _pubMemo.t < 20000) return _pubMemo.v;
    const v = (await readAll()).filter(b => b.stato === 'pubblicata' && b.slug).sort((a, b) => String(b.pubblicata_il).localeCompare(String(a.pubblicata_il)));
    _pubMemo = { t: Date.now(), v }; return v;
  }
  const nomeDi = async id => { try { const a = (await getData('athletes.json'))[id]; return a ? nomeBello(fullName(a)) : nomeBello(String(id).split('_').reverse().join(' ')); } catch (_) { return nomeBello(String(id).split('_').reverse().join(' ')); } };
  async function pubblico(b, completo) {
    const atleti = await Promise.all((b.atleti_ids || []).slice(0, 60).map(async id => ({ id, nome: await nomeDi(id) })));
    const o = { slug: b.slug, titolo: b.titolo, sommario: b.sommario, foto: (b.foto || []).slice(0, 6), pubblicata_il: b.pubblicata_il, tipo: b.tipo, atleti };
    if (completo) { o.corpo = b.corpo; o.tag = b.tag || []; o.aggiornata_il = b.aggiornato; }
    return o;
  }
  // meta per Google/Facebook sull'indirizzo /articolo/<slug>
  async function articoloMeta(slug) {
    const b = (await pubblicati()).find(x => x.slug === slug); if (!b) return null;
    const canonical = `${SITE_URL}/articolo/${b.slug}`, img = ((b.foto || [])[0] || {}).url || '';
    const ogImage = /^https:\/\/[^/]*supabase\.co\//.test(img) ? img : `${SITE_URL}/assets/og-default.png`;
    const blocchi = bloccoDi(b.corpo).filter(x => x.t !== 'f');
    return {
      title: `${b.titolo} | ICS`, desc: String(b.sommario || '').slice(0, 300), canonical, ogImage,
      noscript: `<article><h1>${escH(b.titolo)}</h1><p>${escH(b.sommario)}</p>${blocchi.map(x => x.t === 'h' ? `<h2>${escH(x.s)}</h2>` : `<p>${escH(x.s)}</p>`).join('')}</article>`,
      jsonld: [{ '@context': 'https://schema.org', '@type': 'NewsArticle', headline: b.titolo, description: b.sommario, datePublished: b.pubblicata_il, dateModified: b.aggiornato || b.pubblicata_il, mainEntityOfPage: canonical,
        image: [ogImage], author: { '@type': 'Organization', name: 'Italia Cycling Stats' }, publisher: { '@type': 'Organization', name: 'Italia Cycling Stats', url: SITE_URL } }],
    };
  }
  app.locals.redazionePub = { pubblicati, articoloMeta };

  app.get('/api/articoli', async (req, res) => {
    try { const l = (await pubblicati()).slice(0, 60); res.json({ articoli: await Promise.all(l.map(b => pubblico(b, false))) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/articoli/atleta/:id', async (req, res) => {
    try { const l = (await pubblicati()).filter(b => (b.atleti_ids || []).includes(req.params.id)).slice(0, 12); res.json({ articoli: await Promise.all(l.map(b => pubblico(b, false))) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/articoli/:slug', async (req, res) => {
    try { const b = (await pubblicati()).find(x => x.slug === req.params.slug); if (!b) return res.status(404).json({ error: 'articolo non trovato' }); res.json(await pubblico(b, true)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // i corridori di cui parla la bozza, per scegliere sulle cui pagine pubblicarla
  app.get('/api/admin/redazione/atleti/:id', requireAdmin, async (req, res) => {
    try {
      const b = (await readAll()).find(a => a.id === req.params.id); if (!b) return res.status(404).json({ error: 'bozza non trovata' });
      const m = atletiDi(b.dati || {}, new Map(), b.parametri || {});
      const testo = ' ' + up((b.titolo || '') + ' ' + (b.sommario || '') + ' ' + (b.corpo || '')).replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ') + ' ';
      const out = [...m.values()].map(a => {
        const cogn = up(a.cognome || '').replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
        return { id: a.id, nome: nomeBello(a.nome || String(a.id).split('_').reverse().join(' ')), rango: a.rango, nel_testo: !!cogn && testo.includes(' ' + cogn + ' ') };
      }).sort((x, y) => (y.nel_testo ? 1 : 0) - (x.nel_testo ? 1 : 0) || x.rango - y.rango).slice(0, 60);
      res.json({ atleti: out, scelti: b.atleti_ids || null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/admin/redazione/pubblica/:id', requireAdmin, async (req, res) => {
    try {
      const ids = (Array.isArray((req.body || {}).atleti) ? req.body.atleti : []).map(String).filter(x => /^[A-Za-z0-9_]{3,120}$/.test(x)).slice(0, 60);
      const out = await mutate(arr => {
        const x = arr.find(a => a.id === req.params.id); if (!x) return { err: 'bozza non trovata' };
        if (x.stato === 'in_generazione' || x.stato === 'errore') return { err: 'la bozza non e pronta' };
        if (!String(x.titolo || '').trim() || String(x.corpo || '').trim().length < 80) return { err: 'titolo o testo mancanti' };
        x.stato = 'pubblicata'; x.slug = x.slug || (slugify(x.titolo) + '-' + String(x.id).slice(0, 4)); x.atleti_ids = ids;
        x.pubblicata_il = x.pubblicata_il || new Date().toISOString(); x.aggiornato = new Date().toISOString();
        return { slug: x.slug };
      });
      if (out.err) return res.status(400).json({ error: out.err });
      _pubMemo.t = 0; res.json({ ok: true, slug: out.slug, url: `${SITE_URL}/articolo/${out.slug}` });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/admin/redazione/ritira/:id', requireAdmin, async (req, res) => {
    try {
      const ok = await mutate(arr => { const x = arr.find(a => a.id === req.params.id); if (!x) return false; x.stato = 'bozza'; x.aggiornato = new Date().toISOString(); return true; });
      _pubMemo.t = 0; res.json({ ok });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/admin/redazione/bozze/:id', requireAdmin, async (req, res) => {
    try { await mutate(arr => { const i = arr.findIndex(a => a.id === req.params.id); if (i >= 0) arr.splice(i, 1); }); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ricerca per il selettore: gare recenti/prossime del calendario, atleti
  app.get('/api/admin/redazione/cerca', requireAdmin, async (req, res) => {
    try {
      const q = up(req.query.q || '').trim();
      if (req.query.tipo === 'stagione' || req.query.tipo === 'squadre') return res.json({ risultati: CATS_ALL.map(c => ({ id: c, titolo: CAT_NOME[c] || c, dettaglio: 'riepilogo di fine stagione' })) });
      if (req.query.tipo === 'atleta') {
        const ath = await getData('athletes.json');
        const list = Object.values(ath).filter(a => (!q || up(fullName(a)).includes(q)))
          .sort((a, b) => (b.punti_totali || 0) - (a.punti_totali || 0)).slice(0, 20)
          .map(a => ({ id: a.id, titolo: fullName(a), dettaglio: `${CAT_NOME[a.categoria] || a.categoria} · ${a.team_attuale || ''} · ${a.punti_totali || 0} pt` }));
        return res.json({ risultati: list });
      }
      const cal = await getData('calendar.json');
      const da = shift(today(), -60), a2 = shift(today(), 5);
      const list = cal.filter(g => g.data >= da && g.data <= a2 && (!q || up(g.nome).includes(q) || up(g.luogo).includes(q)))
        .sort((x, y) => y.data.localeCompare(x.data)).slice(0, 25)
        .map(g => ({ id: g.id, titolo: g.nome, dettaglio: `${g.data} · ${g.luogo || g.regione || ''} · ${g.categoria || ''}` }));
      res.json({ risultati: list });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
