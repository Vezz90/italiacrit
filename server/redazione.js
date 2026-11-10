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
  const CFG_DEFAULT = { ai_attiva: true, auto_attiva: false, auto_orari: [8, 13, 19], web_auto_da_imp: 0, auto_spunti: true, auto_gare: true, auto_default: false, auto_ordini: true, tech_attivo: true, tech_auto: true, tech_limite_mensile_usd: 3, tech_max_settimana: 2, limite_mensile_usd: 10, prezzo_ricerca_usd: 0.01,
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
15. MAI GERGO INTERNO: nel testo non nominare il materiale di lavoro. Vietato scrivere "i DATI", "i dati del sito", "dossier", "JSON", "blocco", "le fonti del sistema" o frasi come "i dati non riportano". Se un'informazione manca, taci oppure scrivi in modo naturale che non e ancora nota; i dubbi vanno solo in DA_VERIFICARE.

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
  ISTRUZIONI.tech = () => '';
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

  // ---------- RADAR: segue senza AI federazione, testate e giornali locali e aggancia le notizie a gare e atleti ----------
  const RADAR_KEY = 'redazione_radar';
  const FEED_FISSI = [
    { nome: 'Federazione Ciclistica Italiana', url: 'https://www.federciclismo.it/feed/' },
    { nome: 'CiclismoWeb', url: 'https://www.ciclismoweb.net/feed' },
    { nome: 'Cicloweb', url: 'https://www.cicloweb.it/feed' }
  ];
  const RE_TESTATE = /tuttobiciweb|bicisport|bici\.pro|bicitv|cyclingpro|oasport|ciclismoweb|cicloweb|cyclingnews|sprintcycling|bikechannel|tuttobici|spazioc|gazzetta|sky\s?sport|eurosport|raiplay|rai\s?sport|corriere|repubblica|ansa|sportmediaset/i;
  const livelloDa = dom => (/federciclismo\.it|uci\.org|coni\.it|fci[a-z]*\.(it|org)/i.test(dom) ? 'ufficiale' : RE_TESTATE.test(dom) ? 'testata' : 'locale');
  const NOISE_GARA = new Set([...RUMORE, 'COPPA', 'TROFEO', 'MEMORIAL', 'GRAN', 'PREMIO', 'GARA', 'CAMPIONATO', 'ITALIANO', 'REGIONALE', 'PROVINCIALE', 'EDIZIONE', 'DEL', 'DELLA', 'DELLE', 'DEI', 'DEGLI', 'DELL', 'GIRO', 'CITTA', 'CICLISTICA', 'CICLISTICO', 'CICLISMO', 'CIRCUITO', 'NAZIONALE', 'INTERNAZIONALE']);
  const nomePulito = n => String(n || '').replace(/^\s*\d+\s*[°^ªoa]?\s*/i, '').replace(/\s+/g, ' ').trim();
  const tokenGara = n => { const t = up(nomePulito(n)).split(/[^A-Z0-9]+/).filter(w => w.length >= 3); const d = t.filter(w => !NOISE_GARA.has(w)); return d.length ? d : t; };
  const decodificaHtml = t => String(t || '').replace(/<[^>]*>/g, ' ').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  function leggiRss(xml, fonteFissa) {
    const out = [];
    for (const m of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const b = m[1], pick = tag => { const r = b.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>')); return r ? r[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '') : ''; };
      const src = b.match(/<source[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/);
      const fonte = decodificaHtml(src ? src[2] : fonteFissa || ''), dom = (src ? src[1] : '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      let titolo = decodificaHtml(pick('title')); if (fonte && titolo.endsWith(' - ' + fonte)) titolo = titolo.slice(0, -(fonte.length + 3)).trim();
      const url = decodificaHtml(pick('link')), t = Date.parse(pick('pubDate'));
      if (!titolo || !/^https?:\/\//.test(url)) continue;
      out.push({ id: crypto.createHash('sha1').update(url).digest('hex').slice(0, 12), titolo: titolo.slice(0, 220), url, fonte: fonte || dom, dominio: dom,
        livello: fonteFissa === 'Federazione Ciclistica Italiana' ? 'ufficiale' : livelloDa(dom + ' ' + fonte), data: Number.isFinite(t) ? new Date(t).toISOString() : null,
        descr: decodificaHtml(pick('description')).slice(0, 240) });
    }
    return out;
  }
  async function scaricaTesto(url) {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; ICSbot/1.0; +https://italiacyclingstats.com)', accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }
  const urlGoogleNews = q => 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=it&gl=IT&ceid=IT:it';
  let rdChain = Promise.resolve();
  async function leggiRadar() {
    const { data, error } = await sb().from('kv_store').select('value').eq('key', RADAR_KEY).maybeSingle();
    if (error) throw new Error('lettura radar: ' + error.message);
    const v = data && data.value && typeof data.value === 'object' && !Array.isArray(data.value) ? data.value : {};
    return { aggiornato: v.aggiornato || null, query: v.query || {}, items: Array.isArray(v.items) ? v.items : [] };
  }
  function mutaRadar(fn) {
    const run = rdChain.then(async () => {
      const v = await leggiRadar(); const out = await fn(v);
      v.items.sort((a, b) => String(b.data || b.trovato).localeCompare(String(a.data || a.trovato)));
      const limite = new Date(Date.now() - 30 * 86400000).toISOString();
      v.items = v.items.filter(x => String(x.data || x.trovato) >= limite).slice(0, 400);
      Object.keys(v.query).forEach(k => { if (v.query[k] < limite) delete v.query[k]; });
      const { error } = await sb().from('kv_store').upsert({ key: RADAR_KEY, value: v, updated_at: new Date().toISOString() });
      if (error) throw new Error('scrittura radar: ' + error.message);
      return out;
    });
    rdChain = run.catch(() => {});
    return run;
  }
  // gli atleti con risultati recenti, per riconoscerli nei titoli (nome e cognome devono comparire insieme)
  async function mappaAtleti() {
    const raw = await getData('results_raw.json'), da = shift(today(), -60), m = new Map(), visti = new Set();
    for (const r of raw) {
      if (!r.data || r.data < da || !r.atleta_id || visti.has(r.atleta_id)) continue; visti.add(r.atleta_id);
      const cog = up(r.cognome).split(/[^A-Z]+/).filter(Boolean), nom = up(r.nome).split(/[^A-Z]+/).filter(Boolean);
      if (!cog.length || !nom.length) continue;
      const chiave = cog.sort((a, b) => b.length - a.length)[0];
      if (!m.has(chiave)) m.set(chiave, []);
      m.get(chiave).push({ id: r.atleta_id, tok: [...cog, ...nom] });
    }
    return m;
  }
  function atletiCitati(testo, mappa) {
    const parole = new Set(up(testo).split(/[^A-Z]+/).filter(Boolean)), out = [];
    for (const w of parole) { const l = mappa.get(w); if (l) for (const a of l) if (a.tok.every(t => parole.has(t))) out.push(a.id); }
    return [...new Set(out)].slice(0, 6);
  }
  // una notizia riguarda la gara se compare il nome completo, oppure almeno due parole distintive del nome (con una sola parola distintiva non basta)
  const normFrase = t => ' ' + up(t).replace(/[^A-Z0-9]+/g, ' ').trim() + ' ';
  const garaTocca = (testo, tokens, nome) => {
    const u = normFrase(testo), frase = nome ? normFrase(nomePulito(nome)) : '';
    if (frase.trim().length >= 6 && u.includes(frase)) return true;
    const comp = x => up(x).replace(/[^A-Z0-9]+/g, ''), fc = nome ? comp(nomePulito(nome)) : '';   // «G.P. D'Autunno» e «GP d'Autunno» sono la stessa corsa
    if (fc.length >= 8 && comp(testo).includes(fc)) return true;
    return tokens.length >= 2 && tokens.filter(t => u.includes(' ' + t)).length >= Math.min(3, tokens.length) - (tokens.length >= 3 ? 1 : 0);
  };
  // le gare da seguire: da una settimana fa a tre giorni avanti, le piu importanti per prime
  async function gareDaSeguire() {
    const cal = await getData('calendar.json'), t = today(), da = shift(t, -GIORNI_INDIETRO), a = shift(t, 3), visti = new Set(), out = [];
    for (const c of (cal || [])) {
      if (!c.data || c.data < da || c.data > a || !c.nome || c.nome.trim() === '-') continue;
      const key = `${c.data}|${alboBase(c.nome)}`; if (visti.has(key)) continue; visti.add(key);
      out.push({ key, nome: nomePulito(c.nome), data: c.data, tokens: tokenGara(c.nome), imp: (c.campionato_italiano ? 3 : 0) + (c.campionato_regionale ? 2 : 0) + ((c.moltiplicatore || 1) >= 2 ? 1 : 0) + (c.tipo === 'nazionale' ? 1 : 0) });
    }
    return out.sort((x, y) => y.imp - x.imp || y.data.localeCompare(x.data));
  }
  function codiciCalendario(cat) {
    const t = up(cat), out = new Set();
    const sessi = /M\/F|MULTICATEGORIA|PROMISCUA/.test(t) ? ['M', 'F'] : /DONN|FEMMIN|ALLIEVE/.test(t) ? ['F'] : ['M'];
    const bande = [];
    if (/MULTICATEGORIA DA ESORD/.test(t)) bande.push('ES1', 'ES2', 'AL', 'JUN', 'ELI');
    else if (/MULTICATEGORIA DA ELITE/.test(t)) bande.push('ELI');
    else {
      if (/ALLIEV|\bALL\b/.test(t)) bande.push('AL');
      if (/JUNIOR|\bJUN\b/.test(t)) bande.push('JUN');
      if (/ELITE|UNDER|U23|UN23|OPEN/.test(t)) bande.push('ELI');
      if (/ESORD/.test(t)) { const u = /1/.test(t), d = /2/.test(t); if (u || !d) bande.push('ES1'); if (d || !u) bande.push('ES2'); }
    }
    for (const b of bande) for (const x of sessi) out.add(b + '_' + x);
    return [...out];
  }
  async function codiciEventi() {                                                       // evento (data|nome) -> reparti coinvolti
    const m = new Map();
    for (const c of ((await getData('calendar.json')) || [])) {
      if (!c.data || !c.nome) continue;
      const k = `${c.data}|${alboBase(c.nome)}`; if (!m.has(k)) m.set(k, new Set());
      codiciCalendario(c.categoria).forEach(x => m.get(k).add(x));
    }
    return m;
  }
  async function codiciAtleti() {                                                       // atleta -> reparto (dall'ultima gara registrata)
    const m = new Map(), ultimo = new Map();
    for (const r of await getData('results_raw.json')) { const c = catOf(r); if (r.atleta_id && c && (!ultimo.has(r.atleta_id) || r.data > ultimo.get(r.atleta_id))) { ultimo.set(r.atleta_id, r.data); m.set(r.atleta_id, c); } }
    return m;
  }
  async function annotaRadar(items) {
    const [ev, at] = await Promise.all([codiciEventi(), codiciAtleti()]);
    return items.map(x => ({ ...x, reparti: [...new Set([...(x.gare || []).flatMap(k => [...(ev.get(k) || [])]), ...(x.atleti || []).map(id => at.get(id)).filter(Boolean)])] }));
  }
  const pausa = ms => new Promise(r => setTimeout(r, ms));
  let radarInCorso = null;
  function aggiornaRadar() {
    if (radarInCorso) return radarInCorso;
    radarInCorso = (async () => {
      const nuovi = [], errori = [], trovati = new Map();
      const aggiungi = it => { const k = it.id; if (!trovati.has(k)) trovati.set(k, { ...it, gare: [], atleti: [] }); return trovati.get(k); };
      try {
        const [gare, mappa, stato] = await Promise.all([gareDaSeguire(), mappaAtleti(), leggiRadar()]);
        for (const f of FEED_FISSI) {                                                     // 1) i feed fissi: federazione e testate di ciclismo
          try { for (const it of leggiRss(await scaricaTesto(f.url), f.nome)) { const x = aggiungi(it); x.atleti = atletiCitati(it.titolo + ' ' + it.descr, mappa); gare.forEach(g => { if (garaTocca(it.titolo + ' ' + it.descr, g.tokens, g.nome)) x.gare.push(g.key); }); } }
          catch (e) { errori.push(f.nome + ': ' + e.message); }
        }
        const tocca = gare.filter(g => !stato.query[g.key] || Date.now() - stato.query[g.key] > 3 * 3600 * 1000).slice(0, 12), interrogate = {};
        for (const g of tocca) {                                                          // 2) giornali locali e altre testate: una ricerca per gara, via Google News
          try {
            const minimo = new Date(Date.parse(g.data + 'T00:00:00Z') - 10 * 86400000).toISOString();
            for (const it of leggiRss(await scaricaTesto(urlGoogleNews('"' + g.nome + '" ciclismo')))) {
              if (it.data && it.data < minimo) continue;
              if (!garaTocca(it.titolo + ' ' + it.descr, g.tokens, g.nome)) continue;
              const x = aggiungi(it); x.gare.push(g.key); x.atleti = atletiCitati(it.titolo + ' ' + it.descr, mappa);
            }
            interrogate[g.key] = Date.now();
          } catch (e) { errori.push(g.nome + ': ' + e.message); }
          await pausa(900);
        }
        const gia = new Set(stato.items.map(x => x.id));
        await mutaRadar(v => {
          const per = new Map(v.items.map(x => [x.id, x]));
          for (const it of trovati.values()) {
            if (!it.gare.length && !it.atleti.length) continue;                          // solo notizie agganciate a una gara o a un atleta
            const o = per.get(it.id);
            if (o) { o.gare = [...new Set([...(o.gare || []), ...it.gare])]; o.atleti = [...new Set([...(o.atleti || []), ...it.atleti])]; }
            else { const n = { ...it, trovato: new Date().toISOString() }; v.items.push(n); per.set(it.id, n); if (!gia.has(it.id)) nuovi.push(n); }
          }
          Object.assign(v.query, interrogate); v.aggiornato = new Date().toISOString();
        });
      } catch (e) { errori.push(e.message); }
      return { nuovi: nuovi.length, errori };
    })().finally(() => { radarInCorso = null; });
    return radarInCorso;
  }
  // le notizie utili per un dossier: quelle gia nel radar, piu una ricerca al momento (gratis) se serve
  async function pisteRadar(tipo, facts, p) {
    try {
      if (tipo === 'gara') {
        const g = facts.gara, key = `${g.data}|${alboBase(g.nome)}`, tokens = tokenGara(g.nome);
        let st = await leggiRadar(), items = st.items.filter(x => (x.gare || []).includes(key));
        if (items.length < 3 && (!st.query[key] || Date.now() - st.query[key] > 3 * 3600 * 1000)) {
          const minimo = new Date(Date.parse(g.data + 'T00:00:00Z') - 10 * 86400000).toISOString(), nuovi = [];
          for (const it of leggiRss(await scaricaTesto(urlGoogleNews('"' + nomePulito(g.nome) + '" ciclismo')))) if ((!it.data || it.data >= minimo) && garaTocca(it.titolo + ' ' + it.descr, tokens, g.nome)) nuovi.push({ ...it, gare: [key], atleti: [], trovato: new Date().toISOString() });
          await mutaRadar(v => { const per = new Set(v.items.map(x => x.id)); nuovi.forEach(n => { if (!per.has(n.id)) v.items.push(n); }); v.query[key] = Date.now(); });
          st = await leggiRadar(); items = st.items.filter(x => (x.gare || []).includes(key));
        }
        return items.slice(0, 10);
      }
      if (tipo === 'atleta') {
        const nome = (facts.atleta && facts.atleta.nome) || '', tok = up(nome).split(/[^A-Z]+/).filter(w => w.length >= 2);
        if (tok.length < 2) return [];
        const out = [];
        for (const it of leggiRss(await scaricaTesto(urlGoogleNews('"' + nome + '" ciclismo')))) { const u = up(it.titolo + ' ' + it.descr); if (tok.every(w => u.includes(w))) out.push({ ...it, gare: [], atleti: [p.id], trovato: new Date().toISOString() }); }
        if (out.length) await mutaRadar(v => { const per = new Set(v.items.map(x => x.id)); out.forEach(n => { if (!per.has(n.id)) v.items.push(n); }); });
        return out.slice(0, 8);
      }
    } catch (e) { console.warn('[redazione] radar per dossier:', e.message); }
    return [];
  }
  const _tmrRadar = setInterval(() => { aggiornaRadar().then(r => { if (r.errori.length) console.warn('[redazione] radar:', r.errori.join(' | ')); }).catch(e => console.warn('[redazione] radar:', e.message)); }, 60 * 60 * 1000);
  if (_tmrRadar.unref) _tmrRadar.unref();
  app.get('/api/admin/redazione/radar', requireAdmin, async (req, res) => {
    try {
      let v = await leggiRadar();
      if (!v.aggiornato || Date.now() - Date.parse(v.aggiornato) > 90 * 60 * 1000) { await aggiornaRadar(); v = await leggiRadar(); }
      res.json({ aggiornato: v.aggiornato, items: await annotaRadar(v.items.slice(0, 40)), totale: v.items.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/admin/redazione/radar/aggiorna', requireAdmin, async (req, res) => {
    try { const r = await aggiornaRadar(), v = await leggiRadar(); res.json({ ok: true, nuovi: r.nuovi, errori: r.errori, aggiornato: v.aggiornato, items: await annotaRadar(v.items.slice(0, 40)), totale: v.items.length }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  // «Segnala una notizia»: per cio che non e raggiungibile da solo (per esempio un post sui social): si incolla il testo
  app.post('/api/admin/redazione/radar/segnala', requireAdmin, async (req, res) => {
    try {
      const testo = String((req.body || {}).testo || '').trim().slice(0, 1500), url = String((req.body || {}).url || '').trim().slice(0, 400);
      if (testo.length < 15) return res.status(400).json({ error: 'scrivi o incolla il testo della notizia (almeno una frase)' });
      const [gare, mappa] = await Promise.all([gareDaSeguire(), mappaAtleti()]);
      const it = { id: crypto.createHash('sha1').update(testo + url).digest('hex').slice(0, 12), titolo: testo.slice(0, 160), url: /^https?:\/\//.test(url) ? url : '', fonte: 'Segnalata dalla redazione', dominio: '', livello: 'segnalata', data: new Date().toISOString(), descr: testo,
        gare: gare.filter(g => garaTocca(testo, g.tokens, g.nome)).map(g => g.key), atleti: atletiCitati(testo, mappa), trovato: new Date().toISOString() };
      await mutaRadar(v => { if (!v.items.some(x => x.id === it.id)) v.items.push(it); });
      res.json({ ok: true, agganciata_a: { gare: it.gare.length, atleti: it.atleti.length } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

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
    const piste = await pisteRadar(tipo, facts, p);                              // notizie gia trovate dal radar (gratis): servono da piste e fanno risparmiare ricerche
    if (piste.length >= 4) im.ricerche = Math.max(2, im.ricerche - 2);
    const bloccoPiste = piste.length ? `NOTIZIE GIA TROVATE DAL RADAR (titolo | testata | livello | data | indirizzo). Sono PISTE, non fatti verificati: aprile con la ricerca, verifica cosa dicono davvero, riassumile con parole tue e inseriscile nelle voci con l'indirizzo reale della pagina. Se una conferma o smentisce i DATI, scrivilo.\n${piste.map(x => `- ${x.titolo} | ${x.fonte} | ${x.livello} | ${String(x.data || '').slice(0, 10)} | ${x.url}`).join('\n')}\n\n` : '';
    const prompt = `Sei il RICERCATORE di una redazione sportiva (ciclismo giovanile e dilettantistico italiano). Prepari un DOSSIER per il cronista: cerchi sul web, come farebbe un giornalista, informazioni su ${im.oggetto}. Oggi e ${today()}.

${im.cosa}
Fai fino a ${im.ricerche} ricerche mirate (nome della gara e anno, organizzatore, località, comitato regionale/provinciale, parole come "risultati", "cronaca", "presentazione"). Cerca in questo ordine di affidabilità: 1) UFFICIALE: Federazione Ciclistica Italiana (nazionale, comitato regionale, provinciale), società organizzatrice; 2) TESTATA: siti e giornali di ciclismo; 3) LOCALE: giornali, siti e portali del territorio; 4) SOCIAL: pagine pubbliche e forum, solo come indizio e mai come fonte unica.

REGOLE:
- Ogni informazione è una voce del dossier, riscritta con parole tue: è vietato copiare frasi dalle fonti.
- Per ogni voce indica ente o testata, indirizzo (https), data della fonte e il livello (ufficiale, testata, locale o social). "conferme" è il numero di fonti DIVERSE che riportano lo stesso fatto.
- I DATI DEL SITO qui sotto prevalgono: se una fonte li contraddice, scrivilo in "contraddizioni".
- Mai dati personali non sportivi (età, scuola, residenza, famiglia, salute, social privati). Per i minorenni solo risultati, squadra, convocazioni.
- Dichiarazioni di persone: solo come sintesi attribuita e solo se scritte in una fonte. Non inventare nulla: ciò che non trovi va in "non_trovato".

${bloccoPiste}Rispondi SOLO con un JSON, senza altro testo:
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
    const d = { chiave: im.chiave, creato: new Date().toISOString(), tipo, oggetto: im.oggetto, ricerche_max: im.ricerche, radar: piste.length, voci,
      contraddizioni: (Array.isArray(j.contraddizioni) ? j.contraddizioni : []).map(x => String(x).slice(0, 300)).slice(0, 8),
      non_trovato: (Array.isArray(j.non_trovato) ? j.non_trovato : []).map(x => String(x).slice(0, 200)).slice(0, 10) };
    try { await salvaDossier(im.chiave, d); } catch (e) { console.warn('[redazione] salvataggio dossier:', e.message); }
    return d;
  }

  // ---------- RESPONSABILE DI REPARTO: controlla senza AI numeri, nomi, citazioni e vincitori; se trova problemi seri chiede UNA correzione ----------
  const REP_NOME = { ELI: 'Elite/U23', JUN: 'Juniores', AL: 'Allievi', ES2: 'Esord. 2°', ES1: 'Esord. 1°' };
  function responsabileDi(tipo, p) {
    const cod = tipo === 'atleta' ? p.cat : (tipo === 'stagione' || tipo === 'squadre') ? p.id : p.cod;
    const m = String(cod || '').match(/^(ELI|JUN|AL|ES1|ES2)_([MF])$/);
    return m ? { cod, nome: `Responsabile ${REP_NOME[m[1]]} ${m[2]}` } : { cod: null, nome: 'Capo servizio' };
  }
  const STOP_NOMI = new Set(['GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO', 'LUGLIO', 'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE', 'LUNEDI', 'MARTEDI', 'MERCOLEDI', 'GIOVEDI', 'VENERDI', 'SABATO', 'DOMENICA',
    'ITALIA', 'ITALIANO', 'ITALIANA', 'ITALIANI', 'VALLE', 'VAL', 'MONTE', 'MONTI', 'LAGO', 'PASSO', 'COLLE', 'SAN', 'SANTA', 'SANTO', 'PORTA', 'PONTE', 'CASTEL', 'CASTELLO', 'COPPA', 'TROFEO', 'GRAN', 'PREMIO', 'MEMORIAL', 'GIRO', 'FEDERAZIONE', 'COMITATO', 'REGIONALE', 'PROVINCIALE', 'ELITE', 'UNDER', 'JUNIORES', 'ALLIEVI', 'ALLIEVE', 'ESORDIENTI', 'DONNE', 'UOMINI', 'CAMPIONATO', 'CAMPIONI', 'EUROPA', 'MONDIALE', 'MONDIALI', 'EUROPEI']);
  const pulisciTesto = t => String(t || '').replace(/\[\[foto:\d+\]\]/g, ' ').replace(/^#+\s*/gm, '');
  function controlliTesto(titolo, sommario, corpo, facts, dossier, tipo) {
    const testo = pulisciTesto(titolo + '\n' + sommario + '\n' + corpo), problemi = [];
    const sorgente = JSON.stringify(facts) + (dossier ? JSON.stringify(dossier.voci) : '');
    const noti = new Set(up(sorgente + ' ' + titolo.length).split(/[^A-Z]+/).filter(w => w.length >= 3));
    // 1) nomi: due parole con la maiuscola, in mezzo alla frase, che non compaiono ne nei dati ne nel dossier
    const re = /([A-ZÀ-Ý][a-zà-ÿ'’]{2,})\s+([A-ZÀ-Ý][a-zà-ÿ'’]{2,})/g; let m; const visti = new Set();
    while ((m = re.exec(testo))) {
      const pre = testo.slice(Math.max(0, m.index - 4), m.index);
      if (m.index === 0 || /[.!?:]\s*$|\n\s*$/.test(pre)) continue;                      // a inizio frase la maiuscola non dice niente
      const a = up(m[1]), b = up(m[2]);
      if (noti.has(a) || noti.has(b) || STOP_NOMI.has(a) || STOP_NOMI.has(b)) continue;
      const k = a + ' ' + b; if (visti.has(k)) continue; visti.add(k);
      problemi.push({ tipo: 'nome', gravita: 'alta', testo: `Il nome «${m[1]} ${m[2]}» non compare nei dati ne nel dossier` });
    }
    // 2) citazioni testuali tra virgolette (regola 12)
    const q = testo.match(/«[^»\n]{25,}»|“[^”\n]{25,}”|(?:^|[\s(])"[A-Za-zÀ-ÿ][^"\n]{24,}"(?=[\s.,;:!?)]|$)/gm) || [];     // i secondi (53") non sono virgolette: l'apertura deve seguire uno spazio
    q.filter(x => x.split(/\s+/).length >= 5).slice(0, 3).forEach(x => problemi.push({ tipo: 'citazione', gravita: 'alta', testo: `Citazione tra virgolette: ${x.slice(0, 80)}` }));
    // 2b) gergo interno uscito dal materiale di lavoro ("i DATI del sito", "dossier")
    const interno = testo.match(/\bDATI\b|\bdossier\b|\bJSON\b/) || testo.match(/\bi dati (?:ufficiali )?del sito\b/i);
    if (interno) problemi.push({ tipo: 'interno', gravita: 'alta', testo: `Il testo cita il materiale di lavoro («${interno[0]}»): va riscritto in modo naturale` });
    // 3) il protagonista deve esserci: vincitore delle categorie piu alte, primo della classifica, atleta del profilo
    const maius = up(testo);
    const dovuti = tipo === 'gara' ? (((facts.risultati || []).filter(r => /^ELI_/.test(r.codice || ''))).length ? (facts.risultati || []).filter(r => /^ELI_/.test(r.codice || '')) : (facts.risultati || []).slice(0, 1)).map(r => (r.top10 || [])[0]).filter(Boolean)
      : tipo === 'stagione' ? [(facts.classifica_atleti || [])[0]].filter(Boolean) : [];
    dovuti.filter(t => t.cognome && !maius.includes(up(t.cognome).replace(/[^A-Z ]/g, ' ').trim())).forEach(t => problemi.push({ tipo: 'vincitore', gravita: 'alta', testo: `Nel testo manca il nome di ${t.atleta || t.cognome}, ${tipo === 'gara' ? 'vincitore di una categoria alta' : 'primo in classifica'}` }));
    // 4) numeri che non risultano ne dai dati ne dal dossier (gli anni e i numeri piccoli non si controllano)
    const ok = new Set();
    (sorgente.match(/\d+(?:[.,]\d+)?/g) || []).forEach(n => { ok.add(n.replace(',', '.')); ok.add(String(parseFloat(n.replace(',', '.')))); });
    const nonVer = [...new Set((testo.match(/\d+(?:[.,]\d+)?/g) || []).map(n => n.replace(',', '.')))].filter(n => { const v = parseFloat(n); return v >= 10 && !(v >= 1900 && v <= 2100) && !ok.has(n) && !ok.has(String(v)); });
    if (nonVer.length) problemi.push({ tipo: 'numeri', gravita: nonVer.length >= 4 ? 'alta' : 'media', testo: `Numeri non presenti nei dati: ${nonVer.slice(0, 8).join(', ')}` });
    if (testo.split(/\s+/).filter(Boolean).length < 120) problemi.push({ tipo: 'lunghezza', gravita: 'bassa', testo: 'Il testo e molto corto (meno di 120 parole)' });
    return problemi;
  }
  const marcatoriFoto = t => (String(t || '').match(/\[\[foto:\d+\]\]/g) || []).sort().join();
  async function revisiona({ tipo, p, facts, j, dossier }) {
    const resp = responsabileDi(tipo, p), ts = new Date().toISOString();
    let iniziali = [];
    try { iniziali = controlliTesto(String(j.titolo || ''), String(j.sommario || ''), String(j.corpo || ''), facts, dossier, tipo); }
    catch (e) { return { revisione: { responsabile: resp.nome, reparto: resp.cod, esito: 'segnalata', problemi: [], correzioni: [], errore: 'controllo non eseguito: ' + e.message, ts }, dv: [] }; }
    const gravi = iniziali.filter(x => x.gravita === 'alta');
    const rev = { responsabile: resp.nome, reparto: resp.cod, esito: 'confermata', problemi: iniziali, correzioni: [], ts };
    if (!gravi.length) return { revisione: rev, dv: iniziali.filter(x => x.gravita === 'media').map(x => 'Il responsabile segnala: ' + x.testo) };
    // un solo tentativo di correzione, con l'elenco preciso di cio che non torna
    try {
      const orig = { titolo: String(j.titolo || ''), sommario: String(j.sommario || ''), corpo: String(j.corpo || '') };
      const prompt = `Sei il RESPONSABILE DI REPARTO (${resp.nome}) di una redazione sportiva (ciclismo giovanile e dilettantistico italiano). Controlla questo articolo scritto da un tuo addetto e correggilo SOLO dove serve.

SEGNALAZIONI DEL CONTROLLO AUTOMATICO:
${iniziali.map(x => '- ' + x.testo).join('\n')}

REGOLE: nomi, numeri, posizioni, tempi e punti solo dai DATI (o dal DOSSIER, nominando la fonte nel testo). Se un numero e un calcolo corretto fatto sui DATI, lascialo; se non e verificabile, toglilo o riscrivi la frase senza. Nessuna citazione tra virgolette: riformula in forma indiretta e attribuita. Non inventare niente. Mantieni stile, lunghezza e sezioni; non toccare i marcatori [[foto:N]] e i sottotitoli con '## ' se non servono.

FORMATO: rispondi SOLO con queste sezioni:
===TITOLO===
(una riga)
===SOMMARIO===
(1-2 frasi)
===CORPO===
(l'articolo completo corretto)
===CORREZIONI===
(una per riga: cosa hai cambiato e perche; scrivi "nessuna" se era tutto corretto)

ARTICOLO DA CONTROLLARE:
TITOLO: ${orig.titolo}
SOMMARIO: ${orig.sommario}
CORPO:
${orig.corpo}

DATI (JSON): ${JSON.stringify(facts).slice(0, 40000)}
${dossier ? 'DOSSIER: ' + JSON.stringify({ voci: dossier.voci, contraddizioni: dossier.contraddizioni }).slice(0, 12000) : ''}`;
      const r = await callClaude(prompt, false, 'revisione');
      const x = sezioni(r.text || '');
      const nuovo = { titolo: (x.TITOLO || '').split('\n')[0].trim(), sommario: x.SOMMARIO || '', corpo: x.CORPO || '' };
      const valido = nuovo.corpo.length >= orig.corpo.length * 0.6 && nuovo.titolo && marcatoriFoto(nuovo.corpo) === marcatoriFoto(orig.corpo);
      if (!valido) throw new Error('la correzione non era utilizzabile: si tiene il testo originale');
      j.titolo = nuovo.titolo; j.sommario = nuovo.sommario || orig.sommario; j.corpo = nuovo.corpo;
      rev.correzioni = String(x.CORREZIONI || '').split('\n').map(q => q.replace(/^[-*•]\s*/, '').trim()).filter(q => q && !/^nessuna\.?$/i.test(q));
      rev.esito = 'corretta';
    } catch (e) { rev.errore = e.message; rev.esito = 'segnalata'; }
    let residui = [];
    try { residui = controlliTesto(String(j.titolo || ''), String(j.sommario || ''), String(j.corpo || ''), facts, dossier, tipo); } catch (_) { residui = rev.esito === 'segnalata' ? iniziali : []; }
    rev.residui = residui;
    if (residui.some(x => x.gravita === 'alta')) rev.esito = 'segnalata';
    return { revisione: rev, dv: residui.filter(x => x.gravita !== 'bassa').map(x => 'Il responsabile segnala: ' + x.testo) };
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
    else if (tipo === 'tech') {
      const c = await getCfg(true);
      if (c.tech_attivo === false) throw new Error('il reparto Tech e spento nelle impostazioni');
      const usd = await spesaTech();
      if (usd >= Number(c.tech_limite_mensile_usd)) throw new Error(`limite mensile del reparto Tech raggiunto (${usd.toFixed(2)} $ su ${c.tech_limite_mensile_usd} $)`);
      const radar = await leggiTech(), voci = (p.ids || []).map(i => radar.items.find(x => x.id === i)).filter(Boolean), notizie = [];
      for (const v of voci.slice(0, 3)) {
        try { const a = await leggiArticoloTech(v.url); notizie.push({ fonte: v.fonte, url: v.url, data: v.data, titolo: v.titolo, anteprima: v.descr, testo: a.testo }); }
        catch (e) { notizie.push({ fonte: v.fonte, url: v.url, data: v.data, titolo: v.titolo, anteprima: v.descr, testo: '', nota: 'pagina non leggibile: ' + e.message }); }
      }
      facts = { argomento: p.argomento || (voci[0] && voci[0].titolo) || '', notizie };
      soggetto = String(facts.argomento || 'Novità tecniche').slice(0, 90);
      if (!notizie.length && !p.web) throw new Error('nessuna notizia di partenza: scegli una notizia dal radar Tech o attiva la ricerca web');
    }
    else throw new Error('tipo non valido');
    const link = await leggiLink((p.link || []).filter(Boolean));
    // per i profili di atleti la ricerca web e consentita solo per gli adulti (gia garantito da factsAtleta); per le gare/settimana senza restrizioni
    let dossier = null;
    if (p.web && (tipo === 'gara' || tipo === 'atleta')) { try { dossier = await ottieniDossier(tipo, facts, p); } catch (e) { console.warn('[redazione] dossier:', e.message); } }
    const web = !!p.web && !dossier;                                           // con il dossier lo scrittore non ripete la ricerca
    let prompt = `${REGOLE}\n\n${ISTRUZIONI[tipo](facts)}\n\nRicerca web: ${web ? 'ATTIVA (usala per il contesto, max 5 ricerche)' : 'NON disponibile: usa solo DATI e pagine ufficiali'}.\n\nDATI (JSON):\n${JSON.stringify(facts, null, 1)}\n` +
      (dossier ? `\nDOSSIER DEL RICERCATORE (informazioni prese da altre fonti: ufficiali, testate, giornali locali). Usalo per il contesto e riportalo come farebbe un giornalista: con parole tue e nominando la fonte nel testo. Le voci con livello "social" o con una sola fonte non ufficiale vanno in DA_VERIFICARE, non nel testo. Le fonti che usi vanno in FONTI con il loro indirizzo. Cio che e in non_trovato NON va inventato.\n${JSON.stringify({ voci: dossier.voci, contraddizioni: dossier.contraddizioni, non_trovato: dossier.non_trovato }, null, 1)}\n` : '') +
      (link.length ? `\nPAGINE UFFICIALI INDICATE DALLA REDAZIONE (testo estratto; puoi usarle come fonte, riscrivendo con parole tue):\n${JSON.stringify(link, null, 1)}\n` : '') +
      (p.indicazioni ? `\nINDICAZIONI DEL REDATTORE: ${String(p.indicazioni).slice(0, tipo === 'libero' ? 2500 : 600)}\n` : '');
    if (tipo === 'tech') prompt = `${REGOLE_TECH}\n\nOGGI: ${today()}. Ricerca web: ${web ? 'ATTIVA (massimo 3 ricerche, solo siti di tecnica e delle aziende)' : 'NON disponibile: usa solo le FONTI'}.\n\nARGOMENTO: ${facts.argomento}\n\nFONTI (JSON):\n${JSON.stringify(facts, null, 1)}`;
    const cand = tipo === 'tech' ? [] : await fotoCandidate(tipo, p, facts);
    const res = await callClaude(prompt, web, tipo === 'tech' ? 'tech' : 'articolo', tipo === 'tech' ? { maxUses: 3 } : undefined);
    const j = parseJson(res);
    const piazzata = tipo === 'tech' ? { corpo: String(j.corpo || ''), foto: [] } : piazzaFotoAuto(String(j.corpo || ''), cand, facts, p);
    j.corpo = piazzata.corpo;
    j.titolo = await controllaTitolo(j, tipo, facts);
    const rev = await revisiona({ tipo, p, facts, j, dossier });                // il responsabile controlla e, se serve, corregge una volta
    const fonti = [...(Array.isArray(j.fonti) ? j.fonti : [])];
    link.filter(l => !l.errore).forEach(l => { if (!fonti.some(f => f.url === l.url)) fonti.push({ titolo: l.titolo || l.url, url: l.url, uso: 'pagina ufficiale indicata' }); });
    const dv = Array.isArray(j.da_verificare) ? j.da_verificare : [];
    rev.dv.forEach(x => dv.push(x));
    if (dossier) { dossier.contraddizioni.forEach(x => dv.push('Dal dossier, fonte in contrasto con i dati: ' + x)); dossier.voci.forEach(v => { if (!fonti.some(f => f.url === v.fonte.url) && v.fonte.livello !== 'social' && dichiara(j.corpo, v.fonte.nome)) fonti.push({ titolo: v.fonte.nome || v.fonte.url, url: v.fonte.url, uso: 'dal dossier del Ricercatore (' + v.fonte.livello + ')' }); }); }
    link.filter(l => l.errore).forEach(l => dv.push(`Link non letto (${l.errore}): ${l.url}`));
    return { titolo: String(j.titolo || soggetto), sommario: String(j.sommario || ''), corpo: String(j.corpo || ''), fonti, da_verificare: dv, tag: Array.isArray(j.tag) ? j.tag : [],
      soggetto, revisione: rev.revisione, dossier: dossier ? { creato: dossier.creato, dallarchivio: !!dossier.dallarchivio, radar: dossier.radar || 0, voci: dossier.voci, contraddizioni: dossier.contraddizioni, non_trovato: dossier.non_trovato } : null, foto: piazzata.foto, dati: JSON.stringify(facts).length < 80000 ? facts : { nota: 'dati troppo grandi per essere salvati' }, token: res.usage };
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
      let soggetto;
      if (tipo === 'gara') {
        const f = await factsGara(p.id, { tutte: p.tutte });
        if (f.stato !== 'risultati' && f.gara.data < today()) return res.status(409).json({ error: `La gara «${f.gara.nome}» si è corsa il ${f.gara.data} ma nel sito non ci sono ancora i risultati: non scrivo una presentazione di una gara già passata. Riprova quando i risultati vengono importati.` });
        soggetto = f.gara.nome;
      } else if (tipo === 'atleta') { try { soggetto = (await factsAtleta(p.id)).atleta.nome; } catch (_) { /* resta il codice */ } }
      const { id } = await avvia(tipo, p, soggetto);
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
  const MAX_PER_GIRO = 4, MAX_ORDINI = 3, MAX_BILANCI = 3, MAX_AL_GIORNO = 12, GIORNI_INDIETRO = 7;   // una gara senza risultati viene ripresa nelle fasce dei 7 giorni successivi
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
      const daFare = cfgA.auto_gare === false ? [] : cand.filter(x => !chiavi.has(x.chiave) && (x.imp >= 1 || x.n > 0)).slice(0, Math.max(0, Math.min(MAX_PER_GIRO, MAX_AL_GIORNO - oggiFatte)));   // i resoconti con risultati valgono anche per le gare minori (la maggior parte)
      const webDa = Number.isFinite(Number(cfgA.web_auto_da_imp)) ? Number(cfgA.web_auto_da_imp) : 0;
      let avviati = 0;
      for (const x of daFare) {
        const { fine } = await avvia('gara', { id: x.c.id, tutte: true, web: x.imp >= webDa, link: [], indicazioni: '', chiave: x.chiave, auto: true }, x.c.nome);
        avviati++; await fine;                                           // una alla volta: niente raffiche di richieste
      }
      // il direttore: se c'e una linea editoriale fissa decide lui cosa scrivere al posto delle regole automatiche
      let dirDecide = false;
      if (cfgA.auto_ordini !== false && oggiFatte + avviati < MAX_AL_GIORNO) {
        try { const g = await giroDirettore(Math.min(MAX_ORDINI, MAX_AL_GIORNO - oggiFatte - avviati)); dirDecide = g.attivo; avviati += g.avviati; }
        catch (e) { console.warn('[redazione] direttore:', e.message); dirDecide = true; }
      }
      // reparto Tech: una novita per giro, al massimo tech_max_settimana alla settimana, dentro il suo tetto mensile
      if (cfgA.tech_auto !== false && cfgA.tech_attivo !== false && oggiFatte + avviati < MAX_AL_GIORNO) {
        try {
          const nSett = arr.filter(b => b.tipo === 'tech' && b.parametri && b.parametri.auto && Date.parse(b.creato) > Date.now() - 7 * 86400000).length;
          if (nSett < (Number.isFinite(Number(cfgA.tech_max_settimana)) ? Number(cfgA.tech_max_settimana) : 2) && await spesaTech() < Number(cfgA.tech_limite_mensile_usd)) {
            const usati = new Set(); arr.forEach(b => ((b.parametri && b.parametri.ids) || []).forEach(i => usati.add(i)));
            const sc = sceltaTech((await leggiTech()).items, usati);
            if (sc) { const r = await avvia('tech', { ids: [sc.x.id, ...sc.amici.map(a => a.id)], argomento: '', web: false, link: [], indicazioni: '', chiave: 'tech|' + sc.x.id, auto: true }, sc.x.titolo.slice(0, 90)); avviati++; await r.fine; }
          }
        } catch (e) { console.warn('[redazione] auto tech:', e.message); }
      }
      // fuori stagione (nessuna gara da raccontare e l'ultima corsa e vecchia di oltre 14 giorni): si passa ai bilanci dell'anno,
      // atleti (stagione) e squadre, categoria per categoria, MAX_BILANCI per giro; finiti quelli, si torna a riposo
      const ultimaGara = (raw || []).reduce((m, r) => (r.data && r.data <= t && r.data > m ? r.data : m), '');
      const fuoriStagione = !daFare.length && (!ultimaGara || ultimaGara < shift(t, -14));
      if (fuoriStagione && !dirDecide && cfgA.auto_default === true && cfgA.auto_bilanci !== false) {
        try {
          const y = await anno();
          const coda = [];
          for (const kind of ['stagione', 'squadre']) for (const c of CATS_ALL) if (!chiavi.has(`${kind}|${y}|${c}`)) coda.push({ kind, c });
          for (const x of coda.slice(0, Math.max(0, Math.min(MAX_BILANCI, MAX_AL_GIORNO - oggiFatte - avviati)))) {
            const { fine } = await avvia(x.kind, { id: x.c, web: false, link: [], indicazioni: '', chiave: `${x.kind}|${y}|${x.c}`, auto: true }, `${x.kind === 'squadre' ? 'Squadre' : 'Stagione'} ${y}: ${CAT_NOME[x.c]}`);
            avviati++; await fine;
          }
        } catch (e) { console.warn('[redazione] auto bilanci:', e.message); }
      }
      // il miglior spunto dell'Analista non ancora usato: una bozza per giro (solo bozza, mai pubblicata); fuori stagione i suoi spunti sono vecchi
      if (cfgA.auto_default === true && cfgA.auto_spunti !== false && !fuoriStagione && !dirDecide && oggiFatte + avviati < MAX_AL_GIORNO) {
        try {
          const v = await leggiSpunti(), s = v && v.spunti.find(x => x.stato === 'nuovo' && !chiavi.has('spunto|' + x.id));
          if (s) { const r = await avviaDaSpunto(s, false, true); avviati++; await r.fine; }
        } catch (e) { console.warn('[redazione] auto spunto:', e.message); }
      }
      // il punto della settimana: lunedi e martedi, per l'ultima settimana con gare
      const gg = new Date().getUTCDay();
      if (cfgA.auto_default === true && (gg === 1 || gg === 2) && oggiFatte + avviati < MAX_AL_GIORNO) {
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
    const { id, fine } = await avvia('libero', { richiesta, indicazioni, blocchi: blocchiSpunto(s), cod: s.codice_categoria, web: !!web, link: [], auto: !!auto, chiave: 'spunto|' + s.id }, s.titolo.slice(0, 70));
    await mutaSpunti(x => { const t = x.spunti.find(z => z.id === s.id); if (t) { t.stato = 'usato'; t.bozza_id = id; } });
    return { id, fine };
  }
  // gare passate senza risultati nel sito (ultimi 7 giorni): servono a sapere cosa si sta aspettando
  async function gareInAttesa() {
    try {
      const [cal, raw] = await Promise.all([getData('calendar.json'), getData('results_raw.json')]);
      const t = today(), da = shift(t, -GIORNI_INDIETRO), eventi = new Map();
      const con = new Set(raw.filter(r => r.data >= da).map(r => `${r.data}|${alboBase(r.nome_gara)}`));
      for (const c of (cal || [])) {
        if (!c.data || c.data < da || c.data > t || !c.nome || c.nome.trim() === '-') continue;
        const k = `${c.data}|${alboBase(c.nome)}`;
        if (!eventi.has(k)) eventi.set(k, { nome: c.nome, data: c.data, regione: c.regione || '', cods: new Set() });
        codiciCalendario(c.categoria).forEach(x => eventi.get(k).cods.add(x));
      }
      return [...eventi.entries()].filter(([k]) => !con.has(k)).map(([, e]) => ({ nome: e.nome, data: e.data, regione: e.regione, cods: [...e.cods] })).sort((a, b) => b.data.localeCompare(a.data)).slice(0, 12);
    } catch (_) { return []; }
  }
  // ---------- REPARTO TECH: radar gratuito dei siti di tecnica e articoli sulle novita di materiali, componenti e bici ----------
  const TECH_KEY = 'redazione_tech_radar';
  const FEED_TECH = [                                                   // tutto:true = il feed parla solo di tecnica, niente filtro
    { nome: 'BikeRumor', url: 'https://www.bikerumor.com/feed', tutto: true },
    { nome: 'Cyclingnews', url: 'https://www.cyclingnews.com/feeds.xml' },
    { nome: 'CyclingTips', url: 'https://cyclingtips.com/feed' },
    { nome: 'DC Rainmaker', url: 'https://www.dcrainmaker.com/feed', tutto: true },
    { nome: 'The Inner Ring', url: 'https://inrng.com/feed' },
    { nome: 'Aerogeeks', url: 'https://aerogeeks.com/feed', tutto: true },
    { nome: 'Bicycle Design', url: 'https://bicycledesign.net/feed', tutto: true },
    { nome: 'Bici.PRO Tecnica', url: 'https://bici.pro/tecnica/feed', tutto: true },
    { nome: 'Bici.PRO', url: 'https://bici.pro/feed' },
    { nome: 'BDC Tech', url: 'https://www.bdc-mag.com/category/mag/tech/feed', tutto: true },
    { nome: 'BDC', url: 'https://www.bdc-mag.com/feed' }
  ];
  const RE_TECH_FORTE = /\b(groupset|drivetrain|derailleurs?|chainrings?|cassettes?|wheelsets?|wheels|tyres?|tires?|handlebars?|saddles?|power meters?|bike computers?|helmets?|disc brakes?|firmware|frameset|shimano|sram|campagnolo|zipp|enve|fulcrum|vittoria|continental|pirelli|garmin|wahoo|hammerhead|rotor|quarq|favero|assioma|gruppo|ruote|copertoni?|telaio|manubrio|sella|pedali|guarnitura|ciclocomputer|casco|cambio elettronico|freni a disco|aerodinamic\w*|misuratore di potenza)\b/gi;
  const RE_TECH_NOVITA = /launch|unveil|introduc|announc|new|present|lanci|nuov|debutt|update|aggiorn/i;
  const STOP_TECH = new Set(['WITH', 'FROM', 'THAT', 'THIS', 'YOUR', 'AFTER', 'REVIEW', 'FIRST', 'BEST', 'HERE', 'THEIR', 'MORE', 'WHAT', 'WILL', 'HAVE', 'BEEN', 'ABOUT', 'TOUR', 'RACE', 'STAGE', 'BIKE', 'BIKES', 'CYCLING', 'NEWS', 'PER', 'NUOVO', 'NUOVA', 'DELLA', 'DELLE', 'NELLA']);
  const tokTech = s => up(s).replace(/[^A-Z0-9 ]/g, ' ').split(' ').filter(w => w.length >= 4 && !STOP_TECH.has(w));
  const nForti = s => (String(s || '').match(RE_TECH_FORTE) || []).length;
  let techChain = Promise.resolve();
  async function leggiTech() {
    const { data, error } = await sb().from('kv_store').select('value').eq('key', TECH_KEY).maybeSingle();
    if (error) throw new Error('lettura radar tech: ' + error.message);
    const v = data && data.value && typeof data.value === 'object' && !Array.isArray(data.value) ? data.value : {};
    return { aggiornato: v.aggiornato || null, items: Array.isArray(v.items) ? v.items : [] };
  }
  function aggiornaTech() {
    const run = techChain.then(async () => {
      const vecchio = await leggiTech(), per = new Map(vecchio.items.map(x => [x.id, x]));
      const esiti = await Promise.all(FEED_TECH.map(async f => {
        try { return leggiRss(await scaricaTesto(f.url), f.nome).filter(x => f.tutto || nForti(x.titolo + ' ' + x.descr) > 0).map(x => ({ ...x, fonte: f.nome, livello: 'testata' })); }
        catch (e) { console.warn('[redazione] feed tech', f.nome, e.message); return []; }
      }));
      let nuovi = 0; for (const x of esiti.flat()) if (!per.has(x.id)) { per.set(x.id, x); nuovi++; }
      const limite = Date.now() - 21 * 86400000;
      const items = [...per.values()].filter(x => !x.data || Date.parse(x.data) >= limite).sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))).slice(0, 300);
      const v = { aggiornato: new Date().toISOString(), items };
      const { error } = await sb().from('kv_store').upsert({ key: TECH_KEY, value: v, updated_at: new Date().toISOString() });
      if (error) throw new Error('scrittura radar tech: ' + error.message);
      return { ...v, nuovi };
    });
    techChain = run.catch(() => {});
    return run;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const _t1 = setTimeout(() => { aggiornaTech().catch(e => console.warn('[redazione] radar tech:', e.message)); }, 90 * 1000);
    const _t2 = setInterval(() => { aggiornaTech().catch(e => console.warn('[redazione] radar tech:', e.message)); }, 3 * 3600 * 1000);
    if (_t1.unref) _t1.unref(); if (_t2.unref) _t2.unref();
  }
  async function spesaTech() {
    const r = await rawQuery(`SELECT COALESCE(SUM(costo_usd),0)::float AS usd FROM ai_usage WHERE mese=$1 AND esito='ok' AND uso='tech'`, [meseOra()]);
    return (r.rows[0] || {}).usd || 0;
  }
  // la notizia piu interessante tra quelle non ancora usate: parole tecniche forti, novita, e la stessa notizia su piu testate
  function sceltaTech(items, usati) {
    const t0 = Date.now() - 6 * 86400000;
    const fresche = items.filter(x => !usati.has(x.id) && (!x.data || Date.parse(x.data) >= t0));
    let best = null;
    for (const x of fresche) {
      const tk = new Set(tokTech(x.titolo));
      const amici = fresche.filter(y => y.id !== x.id && y.fonte !== x.fonte && tokTech(y.titolo).filter(w => tk.has(w)).length >= 2);
      const score = nForti(x.titolo) * 2 + (RE_TECH_NOVITA.test(x.titolo) ? 2 : 0) + new Set(amici.map(a => a.fonte)).size * 3;
      if (score >= 4 && (!best || score > best.score)) best = { x, amici: amici.slice(0, 2), score };
    }
    return best;
  }
  async function leggiArticoloTech(url) {
    const cheerio = require('cheerio');
    const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ICS-Redazione)' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const $ = cheerio.load(await r.text()); $('script,style,nav,footer,noscript,aside,form,header').remove();
    const blocco = $('article').first().text() || $('main').first().text() || $('body').text();
    return { titolo: $('title').first().text().trim().slice(0, 200), testo: blocco.replace(/\s+/g, ' ').trim().slice(0, 6000) };
  }
  const REGOLE_TECH = `Sei il redattore tecnico di italiacyclingstats.com, sito italiano di statistiche del ciclismo giovanile e dilettantistico. Scrivi in italiano un articolo breve di NOVITA TECNICHE (materiali, componenti, biciclette, aziende) per ciclisti, famiglie e squadre.

REGOLE (obbligatorie):
1. Ogni fatto (nomi di prodotti e aziende, specifiche, pesi, misure, prezzi, date di uscita, disponibilita) viene SOLO dalle FONTI qui sotto. Niente dalla tua memoria. Se un dato manca, non scriverlo. Prezzi e pesi: solo se ci sono, e attribuiti.
2. Riscrivi con parole tue: e vietato copiare frasi, anche brevi. Nessuna citazione tra virgolette. Le fonti sono spesso in inglese: traduci il senso, non le parole.
3. Nomina la fonte nel testo come farebbe un giornalista ("scrive BikeRumor", "secondo Cyclingnews"). Un dato che ha una sola fonte va attribuito a quella fonte; se due fonti si contraddicono usa il dato piu prudente e scrivilo in DA_VERIFICARE.
4. NON abbiamo provato nessun prodotto: niente impressioni di guida, niente "abbiamo testato", niente giudizi sulle prestazioni che non siano dichiarati dalla fonte e attribuiti a chi li dichiara ("dichiara l'azienda").
5. Nessuna pubblicita: tono neutro e informativo. Spiega perche la novita puo interessare a chi pedala, in una frase concreta, senza inventare.
6. MAI GERGO INTERNO: non nominare "le fonti fornite", "il materiale", "dossier", "JSON", "blocco".
7. 300-500 parole, titolo specifico (nome del prodotto o dell'azienda), 2-3 sottotitoli con '## ', paragrafi brevi separati da una riga vuota.
8. Nessun dato personale.

${REGOLE.slice(REGOLE.indexOf('FORMATO DELLA RISPOSTA'))}`;

  // ---------- ORDINI DEL DIRETTORE: scrive l'amministratore, il Caporedattore li trasforma in incarichi precisi per i reparti ----------
  const ORD_KEY = 'redazione_ordini';
  let ordChain = Promise.resolve();
  async function leggiOrdini() {
    const { data, error } = await sb().from('kv_store').select('value').eq('key', ORD_KEY).maybeSingle();
    if (error) throw new Error('lettura ordini: ' + error.message);
    const v = data && data.value && typeof data.value === 'object' && !Array.isArray(data.value) ? data.value : {};
    return { fissi: Array.isArray(v.fissi) ? v.fissi : [], piani: Array.isArray(v.piani) ? v.piani : [] };
  }
  function mutaOrdini(fn) {
    const run = ordChain.then(async () => {
      const v = await leggiOrdini(), out = await fn(v);
      const { error } = await sb().from('kv_store').upsert({ key: ORD_KEY, value: v, updated_at: new Date().toISOString() });
      if (error) throw new Error('scrittura ordini: ' + error.message);
      return out;
    });
    ordChain = run.catch(() => {});
    return run;
  }
  const sha = s => crypto.createHash('sha1').update(String(s)).digest('hex');
  async function contestoDirettore() {
    const [cal, raw, arr, tech, ath] = await Promise.all([getData('calendar.json'), getData('results_raw.json'), readAll(), leggiTech().catch(() => ({ items: [] })), getData('athletes.json')]);
    const t = today(), da = shift(t, -21), con = new Set(raw.filter(r => r.data >= da).map(r => `${r.data}|${alboBase(r.nome_gara)}`));
    const gare = [], visti = new Set();
    for (const c of (cal || [])) {
      if (!c.data || c.data < da || c.data > t || !c.nome || c.nome.trim() === '-') continue;
      const k = `${c.data}|${alboBase(c.nome)}`; if (!con.has(k) || visti.has(k)) continue; visti.add(k);
      gare.push({ id: c.id, nome: c.nome, data: c.data, categoria: c.categoria || '' });
    }
    gare.sort((a, b) => b.data.localeCompare(a.data));
    const ultimo = raw.reduce((m, r) => (r.data && r.data <= t && r.data > m ? r.data : m), '');
    const usati = new Set(); arr.forEach(b => (b.parametri && b.parametri.ids || []).forEach(i => usati.add(i)));
    return { anno: await anno(), gare: gare.slice(0, 25), ultimo, atleti: Object.values(ath || {}), techItems: tech.items, techIds: new Set(tech.items.map(x => x.id)), techUsati: usati,
      fatti: new Set(arr.map(b => b.parametri && b.parametri.chiave).filter(Boolean)),
      recenti: arr.filter(b => b.stato !== 'errore' && Date.parse(b.creato) > Date.now() - 30 * 86400000).map(b => String(b.titolo || b.soggetto || '').slice(0, 90)).filter(Boolean).slice(-30) };
  }
  async function validaIncarichi(lista, ctx) {
    const out = [], y = ctx.anno, sett = shift(today(), 0).slice(0, 7);
    for (const a of (Array.isArray(lista) ? lista : []).slice(0, 12)) {
      const tipo = String(a.tipo || '').toLowerCase(), cat = String(a.cat || '').toUpperCase();
      const base = { id: crypto.randomBytes(4).toString('hex'), tipo, motivo: String(a.perche || '').slice(0, 220), stato: 'proposto' };
      const dup = ch => ctx.fatti.has(ch) || out.some(o => o.chiave === ch);
      if (tipo === 'stagione' || tipo === 'squadre') {
        if (!CATS_ALL.includes(cat)) continue;
        const chiave = `${tipo}|${y}|${cat}`; if (dup(chiave)) continue;
        out.push({ ...base, cat, chiave, titolo: `${tipo === 'squadre' ? 'Squadre' : 'Stagione'} ${y}: ${CAT_NOME[cat]}` });
      } else if (tipo === 'gara') {
        const g = ctx.gare.find(x => x.id === a.id); if (!g) continue;
        const chiave = `gara|risultati|${g.data}|${alboBase(g.nome)}`; if (dup(chiave)) continue;
        out.push({ ...base, rif: g.id, chiave, titolo: g.nome });
      } else if (tipo === 'atleta') {
        const t = tokensDi(a.nome || ''); if (!t.length) continue;
        const hit = ctx.atleti.filter(x => { const n = up(fullName(x)); return t.every(w => n.includes(w)); }).sort((p, q) => (q.punti_totali || 0) - (p.punti_totali || 0))[0];
        if (!hit) continue;
        const chiave = `atleta|${hit.id}|${y}`; if (dup(chiave)) continue;
        out.push({ ...base, rif: hit.id, chiave, titolo: fullName(hit) });
      } else if (tipo === 'settimana') {
        if (!ctx.ultimo) continue;
        const chiave = `settimana|${ctx.ultimo}`; if (dup(chiave)) continue;
        out.push({ ...base, rif: ctx.ultimo, chiave, titolo: `Il punto della settimana (fino al ${ctx.ultimo})` });
      } else if (tipo === 'libero') {
        const richiesta = String(a.richiesta || '').replace(/\s+/g, ' ').slice(0, 400), ruolo = a.ruolo === 'team' ? 'team' : 'atleti';
        if (!CATS_ALL.includes(cat) || richiesta.length < 8) continue;
        const chiave = 'ordine|' + sha(cat + ruolo + richiesta + sett).slice(0, 10); if (dup(chiave)) continue;
        out.push({ ...base, cat, ruolo, richiesta, chiave, titolo: richiesta.slice(0, 70) });
      } else if (tipo === 'tech') {
        const ids = (Array.isArray(a.ids) ? a.ids : []).filter(i => ctx.techIds.has(i)).slice(0, 3), argomento = String(a.argomento || '').replace(/\s+/g, ' ').slice(0, 200);
        if (!ids.length && argomento.length < 8) continue;
        const chiave = 'tech|' + (ids[0] || sha(argomento).slice(0, 8)); if (dup(chiave) || ids.some(i => ctx.techUsati.has(i))) continue;
        const prima = ctx.techItems.find(x => x.id === ids[0]);
        out.push({ ...base, ids, argomento, chiave, titolo: (argomento || (prima && prima.titolo) || 'Novità tecniche').slice(0, 90) });
      }
    }
    return out;
  }
  async function pianificaOrdine(testo, fissi, max) {
    const ctx = await contestoDirettore();
    const prompt = `Sei il CAPOREDATTORE di una redazione sportiva (ciclismo giovanile e dilettantistico italiano, sito italiacyclingstats.com). Oggi e ${today()}. Il direttore ti ha dato un ORDINE: trasformalo in incarichi precisi per i reparti.

TIPI DI INCARICO:
- stagione: bilancio dell'anno degli atleti di una categoria (campo cat)
- squadre: bilancio dell'anno delle squadre di una categoria (campo cat)
- gara: resoconto di una gara GIA CORSA: scegli l'id SOLO dall'elenco GARE CON RISULTATI
- atleta: profilo di un atleta (campo nome = Nome Cognome)
- settimana: il punto dell'ultima settimana di gare
- libero: articolo su misura di un reparto (campi cat, ruolo = atleti o team, richiesta = cosa scrivere in una frase)
- tech: novita di materiali, componenti, aziende e bici: ids scelti dall'elenco NOTIZIE TECH (anche piu notizie sullo stesso tema, massimo 3) e argomento (una frase)
CATEGORIE: ${CATS_ALL.map(c => c + ' = ' + CAT_NOME[c]).join('; ')}

REGOLE: al massimo ${max} incarichi. Non ripetere cio che e gia stato fatto (vedi GIA FATTI e ARTICOLI RECENTI). Se l'ordine chiede qualcosa che i dati non permettono (per esempio una gara senza risultati), ignoralo e spiegalo in "nota". Se l'ordine e vago, scegli tu i pezzi piu sensati e utili. Rispondi SOLO con un JSON, senza altro testo:
{"riassunto":"una frase su come hai capito l'ordine","nota":"cio che non hai potuto fare, oppure vuoto","incarichi":[{"tipo":"...","cat":"...","id":"...","nome":"...","ids":["..."],"ruolo":"...","argomento":"...","richiesta":"...","perche":"una frase"}]}

ORDINE DEL DIRETTORE: ${String(testo).slice(0, 1500)}
${fissi.length ? 'LINEA EDITORIALE FISSA (vale sempre):\n' + fissi.map(f => '- ' + String(f.testo).slice(0, 500)).join('\n') : ''}
GARE CON RISULTATI (id | nome | data | categoria): ${JSON.stringify(ctx.gare)}
GIA FATTI (chiavi): ${JSON.stringify([...ctx.fatti].filter(k => /^(stagione|squadre|settimana|atleta)\|/.test(k)).slice(-60))}
ARTICOLI RECENTI (titoli): ${JSON.stringify(ctx.recenti)}
NOTIZIE TECH: ${JSON.stringify(ctx.techItems.slice(0, 15).map(x => ({ id: x.id, titolo: x.titolo, fonte: x.fonte, data: String(x.data || '').slice(0, 10) })))}`;
    const res = await callClaude(prompt, false, 'ordine');
    const m = String(res.text || '').match(/\{[\s\S]*\}/);
    let j = {}; try { j = JSON.parse(m ? m[0] : '{}'); } catch (_) { throw new Error("il Caporedattore non ha risposto in modo leggibile: riprova con parole piu semplici"); }
    return { riassunto: String(j.riassunto || '').slice(0, 400), nota: String(j.nota || '').slice(0, 400), incarichi: (await validaIncarichi(j.incarichi, ctx)).slice(0, max) };
  }
  async function lanciaIncarico(inc, auto) {
    const cfg = await getCfg(), comune = { link: [], indicazioni: '', chiave: inc.chiave, auto: !!auto };
    switch (inc.tipo) {
      case 'stagione': case 'squadre': return avvia(inc.tipo, { ...comune, id: inc.cat, web: false }, inc.titolo);
      case 'gara': return avvia('gara', { ...comune, id: inc.rif, tutte: true, web: Number(cfg.web_auto_da_imp) !== 99 }, inc.titolo);
      case 'atleta': return avvia('atleta', { ...comune, id: inc.rif, web: false }, inc.titolo);
      case 'settimana': return avvia('settimana', { ...comune, fine: inc.rif, web: false }, inc.titolo);
      case 'libero': return avvia('libero', { ...comune, richiesta: `Sei l'addetto ${inc.ruolo === 'team' ? 'ai team' : 'agli atleti'} della categoria ${CAT_NOME[inc.cat]}: ${inc.richiesta}. Usa i dati del sito e non inventare nulla.`, indicazioni: inc.richiesta,
        blocchi: [inc.ruolo === 'team' ? { tipo: 'squadre', rif: inc.cat } : { tipo: 'stagione', rif: inc.cat }], cod: inc.cat, ruolo: inc.ruolo, web: false }, inc.titolo);
      case 'tech': return avvia('tech', { ...comune, ids: inc.ids || [], argomento: inc.argomento || '', web: !(inc.ids || []).length }, inc.titolo);
      default: throw new Error('tipo di incarico non valido');
    }
  }
  // esegue gli incarichi approvati uno alla volta, senza raffiche
  async function eseguiIncarichi(pid, iids, auto) {
    for (const iid of iids) {
      let inc = null;
      await mutaOrdini(o => { const p = o.piani.find(x => x.id === pid), i = p && p.incarichi.find(x => x.id === iid); if (i && i.stato === 'proposto') { i.stato = 'in_corso'; inc = { ...i }; } });
      if (!inc) continue;
      try {
        const r = await lanciaIncarico(inc, auto);
        await mutaOrdini(o => { const p = o.piani.find(x => x.id === pid), i = p && p.incarichi.find(x => x.id === iid); if (i) { i.stato = 'avviato'; i.bozza_id = r.id; } });
        await r.fine;
      } catch (e) {
        console.warn('[redazione] incarico:', e.message);
        await mutaOrdini(o => { const p = o.piani.find(x => x.id === pid), i = p && p.incarichi.find(x => x.id === iid); if (i) { i.stato = 'errore'; i.errore = String(e.message).slice(0, 200); } });
        if (/limite mensile|AI disattivata/.test(e.message)) break;
      }
    }
  }
  // giro automatico: il Caporedattore applica la linea editoriale fissa e lancia gli incarichi (max n)
  async function giroDirettore(n) {
    const o = await leggiOrdini(); if (!o.fissi.length) return { avviati: 0, attivo: false };
    const pr = await pianificaOrdine('Applica la linea editoriale fissa a questo giro: scegli solo incarichi davvero utili adesso.', o.fissi, n);
    if (!pr.incarichi.length) return { avviati: 0, attivo: true };
    const rec = { id: crypto.randomBytes(5).toString('hex'), testo: 'Giro automatico (linea editoriale fissa)', fisso: false, auto: true, creato: new Date().toISOString(), riassunto: pr.riassunto, nota: pr.nota, incarichi: pr.incarichi, stato: 'avviato' };
    await mutaOrdini(x => { x.piani.unshift(rec); x.piani = x.piani.slice(0, 20); });
    await eseguiIncarichi(rec.id, rec.incarichi.map(i => i.id), true);
    return { avviati: rec.incarichi.length, attivo: true };
  }
  app.get('/api/admin/redazione/ordini', requireAdmin, async (req, res) => {
    try { res.json(await leggiOrdini()); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/admin/redazione/ordini', requireAdmin, async (req, res) => {
    try {
      const testo = String((req.body || {}).testo || '').replace(/\s+/g, ' ').trim(), fisso = !!(req.body || {}).fisso;
      if (testo.length < 8) return res.status(400).json({ error: 'scrivi cosa vuoi dal direttore (almeno una frase)' });
      if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: 'ANTHROPIC_API_KEY non configurata' });
      const o = await leggiOrdini(), pr = await pianificaOrdine(testo, o.fissi, 8);
      const rec = { id: crypto.randomBytes(5).toString('hex'), testo: testo.slice(0, 1500), fisso, creato: new Date().toISOString(), riassunto: pr.riassunto, nota: pr.nota, incarichi: pr.incarichi, stato: pr.incarichi.length ? 'proposto' : 'vuoto' };
      await mutaOrdini(x => { x.piani.unshift(rec); x.piani = x.piani.slice(0, 20); if (fisso) { x.fissi.push({ id: rec.id, testo: rec.testo, creato: rec.creato }); x.fissi = x.fissi.slice(-10); } });
      res.json({ ok: true, piano: rec });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/admin/redazione/ordini/:id/avvia', requireAdmin, async (req, res) => {
    try {
      const pid = req.params.id, voluti = Array.isArray((req.body || {}).inc) ? req.body.inc.map(String) : null;
      let iids = [];
      await mutaOrdini(o => { const p = o.piani.find(x => x.id === pid); if (!p) return; iids = p.incarichi.filter(i => i.stato === 'proposto' && (!voluti || voluti.includes(i.id))).map(i => i.id); if (iids.length) p.stato = 'avviato'; });
      if (!iids.length) return res.status(404).json({ error: 'nessun incarico da avviare' });
      res.json({ ok: true, avviati: iids.length });
      eseguiIncarichi(pid, iids, false).catch(e => console.warn('[redazione] ordini:', e.message));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/admin/redazione/ordini/:id/inc/:iid/togli', requireAdmin, async (req, res) => {
    try { await mutaOrdini(o => { const p = o.piani.find(x => x.id === req.params.id), i = p && p.incarichi.find(x => x.id === req.params.iid); if (i && i.stato === 'proposto') i.stato = 'tolto'; }); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/admin/redazione/ordini/:id/togli', requireAdmin, async (req, res) => {          // toglie un ordine fisso (e scarta il piano non ancora avviato)
    try { await mutaOrdini(o => { o.fissi = o.fissi.filter(f => f.id !== req.params.id); const p = o.piani.find(x => x.id === req.params.id); if (p && p.stato === 'proposto') p.stato = 'scartato'; }); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/admin/redazione/tech/radar', requireAdmin, async (req, res) => {
    try { const v = await leggiTech(); res.json({ aggiornato: v.aggiornato, totale: v.items.length, items: v.items.slice(0, 60), spesa: await spesaTech(), fonti: FEED_TECH.map(f => f.nome) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/admin/redazione/tech/radar/aggiorna', requireAdmin, async (req, res) => {
    try { const v = await aggiornaTech(); res.json({ aggiornato: v.aggiornato, totale: v.items.length, nuovi: v.nuovi, items: v.items.slice(0, 60), spesa: await spesaTech() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/admin/redazione/tech/scrivi', requireAdmin, async (req, res) => {
    try {
      if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: 'ANTHROPIC_API_KEY non configurata' });
      const v = await leggiTech(), ids = (Array.isArray((req.body || {}).ids) ? req.body.ids : []).map(String).filter(i => v.items.some(x => x.id === i)).slice(0, 3);
      const argomento = String((req.body || {}).argomento || '').slice(0, 200);
      if (!ids.length && argomento.length < 8) return res.status(400).json({ error: 'scegli una notizia dal radar oppure scrivi l\'argomento' });
      const prima = v.items.find(x => x.id === ids[0]);
      const { id } = await avvia('tech', { ids, argomento, web: !ids.length, link: [], indicazioni: '', chiave: 'tech|' + (ids[0] || sha(argomento).slice(0, 8)), auto: false }, (argomento || (prima && prima.titolo) || 'Novità tecniche').slice(0, 90));
      res.json({ ok: true, id });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.locals.redazione = Object.assign(app.locals.redazione || {}, { calcolaSpunti, blocchiSpunto, controlliTesto, leggiRss, tokenGara, garaTocca, aggiornaRadar, codiciCalendario, gareInAttesa });
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
      res.json({ config: c, modello: MODEL, chiave: !!process.env.ANTHROPIC_API_KEY, mese: meseOra(), spesa_mese: s.usd, richieste_mese: s.n, spesa_tech: await spesaTech().catch(() => 0), ultime, mesi });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.put('/api/admin/redazione/config', requireAdmin, async (req, res) => {
    try {
      const b = req.body || {}, c = await getCfg(true), nuovo = { ...c };
      if (typeof b.ai_attiva === 'boolean') nuovo.ai_attiva = b.ai_attiva;
      if (typeof b.auto_attiva === 'boolean') nuovo.auto_attiva = b.auto_attiva;
      if (typeof b.tech_attivo === 'boolean') nuovo.tech_attivo = b.tech_attivo;
      if (typeof b.tech_auto === 'boolean') nuovo.tech_auto = b.tech_auto;
      if (b.tech_limite_mensile_usd != null) { const n = Number(b.tech_limite_mensile_usd); if (!(n >= 0 && n <= 100)) return res.status(400).json({ error: 'limite Tech non valido (0-100 $)' }); nuovo.tech_limite_mensile_usd = n; }
      if (b.tech_max_settimana != null) { const n = Number(b.tech_max_settimana); if (!(Number.isInteger(n) && n >= 0 && n <= 14)) return res.status(400).json({ error: 'articoli Tech a settimana non validi (0-14)' }); nuovo.tech_max_settimana = n; }
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
