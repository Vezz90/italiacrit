/* ============================================================
   Italia Cycling Stats — ciclocross.js
   Specialità Ciclocross (stagione ottobre→gennaio, es. "2026/27").
   Aperto a tutti (CX_PUBLIC): per tornare a "solo admin" basta mettere CX_PUBLIC = false.

   Come funziona: i dati ciclocross (data/ciclocross/<stagione>/, creati da
   scraper/cx_import.py) vengono convertiti al formato della stagione su strada
   e messi al posto di globalData, come fa setSeason() per le stagioni passate.
   Così Home, Risultati, Classifica, Atleti, Team, schede e gare usano le STESSE
   pagine e la STESSA grafica della strada. Stessa scala punti (BASEPTS ×
   moltiplicatore: regionale 1, nazionale 2, internazionale 3) e stesse 10 categorie.
   Il team del ciclocross sta sulla riga del risultato: non cambia il team su strada.

   Interruttore: voce "Strada | Ciclocross" nel menu, e in ogni scheda
   atleta/team, subito prima dei risultati.
   ============================================================ */
(function () {
  'use strict';

  // Visibilità: true = ciclocross aperto a tutti gli utenti; false = solo admin (come la pista quando era in lavorazione)
  const CX_PUBLIC = true;
  const isAdmin = () => { if (CX_PUBLIC) return true; try { return (JSON.parse(localStorage.getItem('italiacrit-user') || 'null') || {}).role === 'admin'; } catch (e) { return false; } };
  const MULT = { regionale: 1, nazionale: 2, internazionale: 3 };
  const CAT_LABEL = { ELI: 'Elite-Under23', JUN: 'Juniores', AL: 'Allievi', ES1: 'Esordienti 1° Anno', ES2: 'Esordienti 2° Anno' };
  const MODE_KEY = 'ics-disciplina';
  const slug = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const normClub = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(A\.?S\.?D\.?|S\.?S\.?D\.?|A\.?S\.?|S\.?R\.?L\.?|S\.?P\.?A\.?|ASD|SSD|TEAM|CICLISMO|ASS\.?)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ').trim();

  let mode = 'strada';          // 'strada' | 'ciclocross'
  let live = null;              // globalData della strada (live) mentre si guarda il ciclocross
  let cxData = null;            // dati ciclocross grezzi { key, cal, res }
  let cxAth = null;             // atleta_id con risultati ciclocross
  let cxGd = null;              // globalData costruito dal ciclocross
  let cxTeams = null;
  let cxRank = { ath: {}, team: {} };   // classifiche ciclocross per categoria           // team_id con risultati ciclocross

  async function getJson(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }
  async function loadRaw() {
    if (cxData) return cxData;
    const idx = await getJson('/data/ciclocross/index.json');
    const key = idx.current;
    const [cal, res] = await Promise.all([getJson(`/data/ciclocross/${key}/calendar.json`), getJson(`/data/ciclocross/${key}/results.json`)]);
    return (cxData = { key, cal, res });
  }

  // ── Conversione nel formato della stagione su strada ─────────────
  function build(liveGd) {
    const { cal, res } = cxData;
    const gare = {};
    for (const g of cal) gare[g.fci_id] = g;
    // team del ciclocross → id del team su strada quando il nome coincide
    const roadTeamByNorm = {};
    for (const t of Object.values((liveGd && liveGd.teams) || {})) { const n = normClub(t.nome); if (n && !roadTeamByNorm[n]) roadTeamByNorm[n] = t; }
    const teamOf = (club) => { const t = roadTeamByNorm[normClub(club)]; return t ? { id: t.id, nome: t.nome } : { id: slug(club) || 'SENZA_TEAM', nome: club || '' }; };
    const roadAth = (liveGd && liveGd.athletes) || {};

    const calendar = [], seenCal = {};
    const isSoc = (n) => /societ/i.test(n);                       // "Campionato italiano di società": non è un titolo individuale
    const flags = (g) => ({ cr: /campionato regionale/i.test(g.nome), ci: /campionato italiano/i.test(g.nome) && !isSoc(g.nome) });
    const calEntry = (g) => {
      const tipo = String(g.geo || 'Regionale').toLowerCase(), f = flags(g), calId = `${slug(g.nome)}_${g.data}`;
      if (!seenCal[calId]) {
        seenCal[calId] = 1;
        calendar.push({ id: calId, nome: g.nome, data: g.data, tipo, moltiplicatore: MULT[tipo] || 1, campionato_regionale: f.cr, campionato_italiano: f.ci,
          regione: String(g.regione || '').toUpperCase(), categoria: g.categorie_ammesse || g.classe || '', luogo: g.luogo || '', fci_id: g.fci_id });
      }
      return calId;
    };
    for (const g of cal) if (g.data) calEntry(g);                  // tutto il calendario, anche le gare future senza risultati
    const resultsRaw = [];
    const athletes = {}, teams = {};
    let seq = 0;
    // Gare congiunte, SOLO ESORDIENTI: la FCI dà la posizione della classifica GENERALE (un Esordiente 1° anno può essere 11° assoluto perché davanti
    // ci sono altre categorie). Ogni esordiente prende la posizione (e i punti) della SUA categoria.
    // Se i gruppi della stessa categoria sono fette della stessa generale (posizioni mai ripetute) si riordinano insieme;
    // se ognuno parte da 1 (classifiche separate) si riordina ciascuno per conto suo.
    for (const r of res) r._pc = 0;
    const byKey = {};
    for (const r of res) { const q = parseInt(r.pos, 10); if (q >= 1 && /^ES[12]_/.test(r.cat)) ((byKey[r.gara + '|' + r.cat] ||= {})[r.gruppo] ||= []).push(r); }   // solo Esordienti: Allievi, Juniores ed Elite/U23 tengono la posizione 1-10 della gara, qualunque sia l'anno
    for (const grp of Object.values(byKey)) {
      const gs = Object.values(grp);
      const all = gs.flat();
      const disjoint = gs.length > 1 && new Set(all.map(x => parseInt(x.pos, 10))).size === all.length;
      for (const unit of (disjoint ? [all] : gs)) {
        const ps = [...new Set(unit.map(x => parseInt(x.pos, 10)))].sort((a, b) => a - b);
        const rank = {}; ps.forEach((v, i) => { rank[v] = i + 1; });
        for (const x of unit) x._pc = rank[parseInt(x.pos, 10)];
      }
    }
    // Allievi, Juniores, Elite/U23: 1° e 2° anno sono UNA sola classifica (un solo 1°, 2°, 3°...). Se la FCI le pubblica come due
    // classifiche separate (ognuna parte da 1) le si intreccia per posizione, con l'anno più alto davanti a parità, senza doppioni.
    const byKey2 = {};
    for (const r of res) { const q = parseInt(r.pos, 10); if (q >= 1 && !/^ES[12]_/.test(r.cat)) ((byKey2[r.gara + '|' + r.cat] ||= {})[r.gruppo] ||= []).push(r); }
    for (const grp of Object.values(byKey2)) {
      const gs = Object.values(grp), all = gs.flat();
      if (gs.length < 2 || new Set(all.map(x => parseInt(x.pos, 10))).size === all.length) continue;   // una sola classifica, o già fette di una generale: posizioni della gara
      const yr = (x) => parseInt((String(x.gruppo).match(/(\d)\s*$/) || [0, 0])[1], 10) || 0;
      all.slice().sort((a, b) => (parseInt(a.pos, 10) - parseInt(b.pos, 10)) || (yr(b) - yr(a))).forEach((x, i) => { x._pc = i + 1; });
    }
    for (const r of res) {
      const g = gare[r.gara]; if (!g) continue;
      const pos = r._pc || parseInt(r.pos, 10); if (!(pos >= 1)) continue;
      const tipo = String(g.geo || 'Regionale').toLowerCase();
      const mult = MULT[tipo] || 1;
      const calId = `${slug(g.nome)}_${g.data}`;
      const code = r.cat;                                   // es. ES2_M
      const base = code.replace(/_[MF]$/, ''), gen = code.endsWith('_F') ? 'F' : 'M';
      const isCR = flags(g).cr, isCI = flags(g).ci;
      calEntry(g);
      // "COGNOME NOME" → cognome/nome (riusa la scheda su strada se c'è)
      const known = roadAth[r.atleta_id];
      let cognome, nome;
      if (known && known.cognome) { cognome = known.cognome; nome = known.nome || ''; }
      else {
        const parts = String(r.nome || '').trim().split(/\s+/);
        cognome = parts.shift() || ''; nome = parts.join(' ');
        if (typeof fixCompoundSurname === 'function') { const f = fixCompoundSurname(cognome, nome); cognome = f.cognome; nome = f.nome; }
      }
      const tm = teamOf(r.club);
      const pb = (typeof BASEPTS !== 'undefined' && BASEPTS[pos]) || 0;
      const row = { gara_id: `${calId}_${code}`, nome_gara: g.nome, data: g.data, categoria: CAT_LABEL[base] || base, genere: gen, tipo,
        moltiplicatore: mult, campionato_regionale: isCR, campionato_italiano: isCI,
        regione: String(g.regione || '').toUpperCase(), posizione: pos, cognome, nome, atleta_id: r.atleta_id,
        team: tm.nome, team_id: tm.id, tempo: '', km: '', media: '', punti_base: pb, punti_effettivi: pb * mult, _scrape_seq: ++seq };
      resultsRaw.push(row);

      const a = athletes[r.atleta_id] ||= { id: r.atleta_id, nome, cognome, team_attuale: tm.nome, team_id: tm.id, categoria: code, genere: gen, punti_totali: 0, risultati: [], _last: '' };
      const entry = { gara_id: row.gara_id, nome_gara: row.nome_gara, data: row.data, posizione: pos, punti_effettivi: row.punti_effettivi, team: tm.nome,
        moltiplicatore: mult, tipo, regione: row.regione, km: '', media: '' };
      a.risultati.push(entry); a.punti_totali += row.punti_effettivi;
      if (row.data >= a._last) { a._last = row.data; a.team_attuale = tm.nome; a.team_id = tm.id; a.categoria = code; a.genere = gen; }

      const t = teams[tm.id] ||= { id: tm.id, nome: tm.nome, punti_totali: 0, atleti: [], risultati: [], punti_per_cat: {} };
      if (!t.atleti.includes(r.atleta_id)) t.atleti.push(r.atleta_id);
      t.risultati.push({ ...entry, atleta_id: r.atleta_id, atleta_cognome: cognome, atleta_nome: nome });
      t.punti_totali += row.punti_effettivi;
      t.punti_per_cat[code] = (t.punti_per_cat[code] || 0) + row.punti_effettivi;
    }
    for (const a of Object.values(athletes)) delete a._last;
    // classifiche per categoria nel formato dei file data/rankings e data/team_rankings della strada
    const rk = { ath: {}, team: {} };
    for (const r of resultsRaw) {
      const code = r.gara_id.match(/_([A-Z0-9]+_[MF])$/)[1];
      const A = ((rk.ath[code] ||= {})[r.atleta_id] ||= { atleta_id: r.atleta_id, cognome: r.cognome, nome: r.nome, team_id: r.team_id, team_nome: r.team, punti: 0, vittorie: 0, gare: 0, p1: 0, p2: 0, p3: 0, pout: 0, trend: 0 });
      const T = ((rk.team[code] ||= {})[r.team_id] ||= { team_id: r.team_id, team_nome: r.team, punti: 0, vittorie: 0, p1: 0, p2: 0, p3: 0, pout: 0, _a: new Set() });
      for (const X of [A, T]) { X.punti += r.punti_effettivi; if (r.posizione === 1) { X.vittorie++; X.p1++; } else if (r.posizione === 2) X.p2++; else if (r.posizione === 3) X.p3++; else if (r.posizione <= 10) X.pout++; }
      A.gare++; A.team_id = r.team_id; A.team_nome = r.team; T._a.add(r.atleta_id);
    }
    const fin = (m, team) => Object.fromEntries(Object.entries(m).map(([code, o]) => {
      const l = Object.values(o).sort((x, y) => y.punti - x.punti || y.vittorie - x.vittorie || y.p2 - x.p2 || y.p3 - x.p3);
      l.forEach((x, i) => { x.pos = i + 1; if (team) { x.n_atleti = x._a.size; delete x._a; } });
      return [code, l];
    }));
    cxRank = { ath: fin(rk.ath, false), team: fin(rk.team, true) };
    cxAth = new Set(Object.keys(athletes)); cxTeams = new Set(Object.keys(teams));
    const meta = { ...((liveGd && liveGd.meta) || {}), disciplina: 'ciclocross', stagione: String(cxData.key).replace('-', '/') };
    return cxGd = processLoadedData({ calendar, resultsRaw, athletes, teams, meta, raceDetails: (liveGd && liveGd.raceDetails) || {}, videos: (liveGd && liveGd.videos) || {}, extraRoster: {} });
  }

  // processLoadedData() lascia in variabili dell'app lo stato dell'ULTIMO dataset elaborato (categoria di appartenenza
  // degli atleti): dopo ogni cambio va riallineato a quello che si sta guardando, altrimenti la strada perde la posizione.
  function syncGlobals() { try { if (typeof _buildAthleteHomeCats === 'function' && globalData) _buildAthleteHomeCats(globalData.resultsRaw); } catch (e) {} }

  // ── Cambio di specialità ─────────────────────────────────────────
  async function setMode(m, opts) {
    opts = opts || {};
    if (!isAdmin()) m = 'strada';
    if (m === mode && !opts.force) return;
    if (m === 'ciclocross') {
      try { await loadRaw(); } catch (e) { console.warn('[ciclocross] dati non disponibili', e); return; }
      if (mode !== 'ciclocross') live = globalData;
      globalData = build(live);
    } else {
      if (live) globalData = live;
      live = null;
    }
    mode = m;
    syncGlobals(); setAlboProve();
    try { localStorage.setItem(MODE_KEY, m); } catch (e) {}
    document.body.classList.toggle('disc-cx', m === 'ciclocross');
    if (typeof invalidatePhotoCache === 'function') invalidatePhotoCache();
    if (opts.go) location.hash = '#' + opts.go;
    route();
  }
  window.cxSetMode = setMode;

  // ── Selettore "Strada | Ciclocross" nelle pagine, prima di Uomini/Donne ──
  // Stesso componente del sito (.hx-seg): sta nella barra dei filtri, quindi si vede anche da mobile.
  function addSegs() {
    if (!isAdmin()) return;
    document.querySelectorAll('.hx-seg').forEach(g => {
      if (g.dataset.cx || g.classList.contains('cx-seg')) return;
      const lab = (g.getAttribute('aria-label') || '') + ' ' + g.textContent;
      if (!/(Uomini|Donne)/i.test(lab) || /Specialit/i.test(lab)) return;
      g.dataset.cx = '1';
      const prev = g.previousElementSibling;
      if (prev && prev.classList.contains('cx-seg')) return;
      const s = document.createElement('div');
      s.className = 'hx-seg cx-seg'; s.setAttribute('role', 'group'); s.setAttribute('aria-label', 'Specialità'); s.style.marginRight = '8px';
      s.innerHTML = `<button type="button" data-m="strada" aria-pressed="${mode === 'strada'}">Strada</button><button type="button" data-m="ciclocross" aria-pressed="${mode === 'ciclocross'}">Ciclocross</button>`;
      s.onclick = (e) => { const b = e.target.closest('button[data-m]'); if (b && b.dataset.m !== mode) setMode(b.dataset.m); };
      g.parentElement.insertBefore(s, g);
    });
  }
  function renderNavSwitch() { addSegs(); }

  // ── Selettore dentro scheda atleta / team (prima dei risultati) ──
  function selectorHtml() {
    return `<div class="section-header cx-pick" style="margin-top:28px;align-items:center">
      <div class="tab-group" role="tablist" style="display:flex;gap:8px">
        <button type="button" class="tab-btn ${mode === 'strada' ? 'active-cat' : ''}" data-m="strada">Strada</button>
        <button type="button" class="tab-btn ${mode === 'ciclocross' ? 'active-cat' : ''}" data-m="ciclocross">Ciclocross</button>
      </div><span class="section-line"></span><span class="section-subtitle">Specialità</span></div>`;
  }
  function placePicker(anchor) {
    if (!anchor || document.querySelector('.cx-pick')) return;
    anchor.insertAdjacentHTML('beforebegin', selectorHtml());
    const p = document.querySelector('.cx-pick');
    p.onclick = (e) => { const b = e.target.closest('button[data-m]'); if (b && b.dataset.m !== mode) setMode(b.dataset.m, { force: true }); };
  }
  const otherHas = (kind, id) => {
    if (mode === 'strada') return kind === 'atleta' ? !!(cxAth && cxAth.has(id)) : !!(cxTeams && cxTeams.has(id));
    const g = live || {};
    return kind === 'atleta' ? !!(g.athletes && g.athletes[id] && (g.athletes[id].risultati || []).length) : !!(g.teams && g.teams[id] && (g.teams[id].risultati || []).length);
  };


  // ── Striscia in alto: posizione e punti in entrambe le specialità ──
  async function statOf(D, kind, id, isCx) {
    if (!D) return null;
    if (kind === 'atleta') {
      const a = D.athletes && D.athletes[id]; if (!a || !(a.risultati || []).length) return null;
      const pts = a.punti_totali || 0, code = a.categoria;
      let pos = 0;
      try {
        // stessa fonte della scheda: classifica per categoria (strada: file precalcolato; ciclocross: calcolata)
        const code2 = (typeof getRankingFileCode === 'function' && getRankingFileCode(code)) || code;
        const list = isCx ? (cxRank.ath[code2] || []) : await window.__roadLoadRanking(code2);
        const f = list.find(x => x.atleta_id === id); if (f) pos = f.pos;
      } catch (e) {}
      if (!pos) pos = 1 + Object.values(D.athletes).filter(x => x.categoria === code && (x.punti_totali || 0) > pts).length;
      return { pts, pos, label: typeof catLabel === 'function' ? catLabel(code) : code };
    }
    const t = D.teams && D.teams[id]; if (!t || !(t.risultati || []).length) return null;
    const ppc = t.punti_per_cat || {}; const cat = Object.keys(ppc).sort((x, y) => ppc[y] - ppc[x])[0];
    const pts = cat ? ppc[cat] : (t.punti_totali || 0);
    const pos = cat ? 1 + Object.values(D.teams).filter(x => ((x.punti_per_cat || {})[cat] || 0) > pts).length : 1 + Object.values(D.teams).filter(x => (x.punti_totali || 0) > pts).length;
    return { pts, pos, label: cat && typeof catLabel === 'function' ? catLabel(cat) : '' };
  }
  async function placeStrip(kind, id, anchor) {
    if (!anchor || document.querySelector('.cx-strip')) return;
    const road = await statOf(mode === 'strada' ? globalData : live, kind, id, false), cx = await statOf(mode === 'ciclocross' ? globalData : cxGd, kind, id, true);
    if (!road || !cx || document.querySelector('.cx-strip') || !anchor.isConnected) return;
    const season = (cxData && String(cxData.key).replace('-', '/')) || '';
    const chip = (m, name, s, on) => `<button type="button" data-m="${m}" class="cx-chip" style="flex:1 1 200px;text-align:left;cursor:pointer;padding:10px 14px;border-radius:12px;border:1px solid ${on ? 'var(--red-hot,#e8001d)' : 'var(--border-subtle,#ccc)'};background:var(--bg-card,transparent);color:inherit;font:inherit">
      <span style="display:block;font-size:.7rem;font-weight:800;letter-spacing:.06em;opacity:.7">${name}</span>
      <span style="font-size:1.15rem;font-weight:800">${s.pos}°</span> <span style="opacity:.8">${s.label ? E(s.label) + ' · ' : ''}${s.pts} punti</span></button>`;
    const el = document.createElement('div');
    el.className = 'cx-strip'; el.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin:12px 0';
    el.innerHTML = chip('strada', 'STRADA ' + (typeof _loadedSeasonYear === 'function' ? _loadedSeasonYear() : ''), road, mode === 'strada') + chip('ciclocross', 'CICLOCROSS ' + season, cx, mode === 'ciclocross');
    el.onclick = (e) => { const b = e.target.closest('button[data-m]'); if (b && b.dataset.m !== mode) setMode(b.dataset.m, { force: true }); };
    anchor.insertAdjacentElement('afterend', el);
  }
  const E = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));


  const isCxGd = () => !!(typeof globalData !== 'undefined' && globalData && globalData.meta && globalData.meta.disciplina === 'ciclocross');
  // Albo d'oro, scheda "Campioni": in ciclocross esiste solo la specialità Ciclocross
  const PROVE_STRADA = ['STRADA', 'CRONOMETRO', 'CRONOMETRO A SQUADRE', 'CRONOSCALATA'];
  function setAlboProve() {
    try { if (typeof ALBO_PROVE === 'undefined') return; ALBO_PROVE.length = 0; (mode === 'ciclocross' ? ['CICLOCROSS'] : PROVE_STRADA).forEach(x => ALBO_PROVE.push(x)); } catch (e) {}
  }
  const hasRace = (gd, id) => !!(gd && ((gd.garaToCalId && gd.garaToCalId[id] != null) || (gd.resultsRaw || []).some(r => r.gara_id === id) || (gd.calendar || []).some(g => g.id === id)));
  // Un link a una gara dell'altra specialità (titoli, ecc.): prima si passa a quella specialità, poi si apre la gara
  function onLinkClick(e) {
    if (!isAdmin()) return;
    const a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
    const m = (a.getAttribute('href') || '').match(/\/gara\/([^?#]+)/); if (!m) return;
    const id = decodeURIComponent(m[1]);
    let to = null;
    if (mode === 'ciclocross') { if (/^CIC_/.test(id) || (!hasRace(globalData, id) && hasRace(live, id))) to = 'strada'; }
    else if (!hasRace(globalData, id) && cxGd && hasRace(cxGd, id)) to = 'ciclocross';
    if (!to) return;
    e.preventDefault(); e.stopPropagation();
    setMode(to, { go: '/gara/' + id });
  }

  function wrap(name, after) {
    const orig = window[name];
    if (typeof orig !== 'function' || orig.__cx) return;
    const w = async function () {
      const r = await orig.apply(this, arguments);
      if (isAdmin()) { try { await after.apply(this, arguments); } catch (e) { console.warn('[ciclocross]', e); } }
      return r;
    };
    w.__cx = true; window[name] = w;
  }
  // in modalità strada serve conoscere chi ha risultati ciclocross (un solo calcolo)
  async function ensureIds() {
    if (cxAth) return true;
    try { await loadRaw(); cxGd = build(globalData); syncGlobals(); return true; } catch (e) { return false; }
  }

  function init() {
    // Caricamenti di fondo (retry/aggiornamenti): la strada resta il "live", il ciclocross si ricostruisce da lì
    const origLoadAll = window.loadAll;
    if (typeof origLoadAll === 'function' && !origLoadAll.__cx) {
      const w = async function () {
        const gd = await origLoadAll.apply(this, arguments);
        if (mode !== 'ciclocross' || !cxData) return gd;
        live = gd; return build(live);
      };
      w.__cx = true; window.loadAll = w;
    }

    // Funzioni dell'app che nel ciclocross devono dare risposte diverse
    window.__roadLoadRanking = window.loadRanking;
    const sw = (name, fn) => { const o = window[name]; if (typeof o === 'function' && !o.__cx) { const w = fn(o); w.__cx = true; window[name] = w; } };
    sw('championDisciplina', (o) => function (n) { return isCxGd() ? 'CICLOCROSS' : o.apply(this, arguments); });
    sw('collectChampions', (o) => function () {
      const out = o.apply(this, arguments);
      return isCxGd() ? out.filter(c => !(c.kind === 'it' && /societ/i.test(c.nome_gara || ''))) : out;   // niente "Campionato italiano di società" come titolo
    });
    sw('loadRanking', (o) => async function (code) { return isCxGd() ? (cxRank.ath[code] || []).map(x => ({ ...x })) : o.apply(this, arguments); });
    sw('loadTeamRanking', (o) => async function (code) { return isCxGd() ? (cxRank.team[code] || []).map(x => ({ ...x })) : o.apply(this, arguments); });
    // Albo e statistiche del ciclocross partono da quest'anno: niente storico della strada
    sw('loadJson', (o) => function (path) {
      if (isCxGd() && /^data\/(almanacco|carriere|ciclismo-storico|albo|titoli_stagioni|seasons\/\d)/.test(String(path))) return Promise.reject(new Error('non disponibile per il ciclocross'));
      return o.apply(this, arguments);
    });
    // Albo d'oro: solo la stagione ciclocross in corso (podio della classifica), nessuno storico
    sw('_alboDoroRows', (o) => async function (code, isTeam) {
      if (!isCxGd()) return o.apply(this, arguments);
      const top = ((isTeam ? cxRank.team : cxRank.ath)[code] || []).slice(0, 3).map(x => ({ ...x }));
      return top.length ? [{ year: cxData ? String(cxData.key).replace('-', '/') : '2026/27', isCur: true, podium: top }] : [];
    });
    // Gare professionistiche (PCS, solo strada): nel ciclocross non ci sono
    if (window.ProRaces && typeof window.ProRaces.events === 'function' && !window.ProRaces.events.__cx) {
      const oe = window.ProRaces.events;
      window.ProRaces.events = function () { return isCxGd() ? Promise.resolve([]) : oe.apply(this, arguments); };
      window.ProRaces.events.__cx = true;
    }
    sw('_alboIndex', (o) => function () { return isCxGd() ? Promise.resolve(null) : o.apply(this, arguments); });
    document.addEventListener('click', onLinkClick, true);
    window.CX = { otherGd: () => (mode === 'strada' ? cxGd : live) };
    wrap('renderAtleta', async (id) => {
      if (mode === 'strada' && !(await ensureIds())) return;
      if (!otherHas('atleta', id)) return;
      const t = document.getElementById('atleta-results-title');
      placePicker(t && t.closest('.section-header'));
      placeStrip('atleta', id, document.querySelector('.athlete-header'));
    });
    wrap('renderTeam', async (tid) => {
      if (mode === 'strada' && !(await ensureIds())) return;
      if (!otherHas('team', tid)) return;
      const h = [...document.querySelectorAll('#app .section-header')].find(x => /RISULTATI TEAM/i.test(x.textContent));
      placePicker(h);
      placeStrip('team', tid, document.querySelector('.team-header'));
    });
    // Righe "STAGIONE" di atleta/team: nel ciclocross i bottoni-anno sono quelli della strada. La stagione ciclocross è evidenziata a parte
    // e un anno della strada (anche lo stesso anno solare) riporta alla strada, invece di restare sul ciclocross.
    sw('profileYearRow', (o) => function () {
      const h = o.apply(this, arguments);
      if (!isCxGd() || typeof h !== 'string') return h;
      const season = (cxData && String(cxData.key).replace('-', '/')) || '';
      const off = h.replace(/background:var\(--accent,#e8001d\);color:#fff/g, 'background:var(--bg-elevated);color:var(--text-secondary)');
      const pill = `<button type="button" class="year-pill" style="padding:5px 13px;border-radius:14px;border:1px solid var(--border-subtle);cursor:default;font-size:.82rem;font-weight:700;background:var(--accent,#e8001d);color:#fff">${season} ciclocross</button>`;
      return off.replace(/(<span[^>]*>STAGIONE<\/span>)/, '$1' + pill);
    });
    for (const fn of ['setAtletaYear', 'setTeamYear']) {
      const o = window[fn];
      if (typeof o === 'function' && !o.__cx) {
        const w = async function () { const a = arguments, self = this; if (mode === 'ciclocross') await setMode('strada'); return o.apply(self, a); };
        w.__cx = true; window[fn] = w;
      }
    }
    // Link diretto #/ciclocross → entra nella specialità e apre la classifica
    window.cxRenderClassifica = () => { if (!isAdmin()) return undefined; setMode('ciclocross', { go: '/classifica' }); return Promise.resolve(); };

    // Stagioni passate: per il ciclocross esiste solo la stagione in corso (finora), niente cambio stagione
    const origSetSeason = window.setSeason;
    if (typeof origSetSeason === 'function' && !origSetSeason.__cx) {
      const s = function () { if (mode === 'ciclocross') { if (typeof showToast === 'function') showToast('Per il ciclocross esiste solo la stagione in corso', 'info'); return; } return origSetSeason.apply(this, arguments); };
      s.__cx = true; window.setSeason = s;
    }
    const st = document.createElement('style');
    st.textContent = 'body.disc-cx .season-bar{display:none!important}';
    document.head.appendChild(st);

    let _t = null;
    new MutationObserver(() => { if (_t) return; _t = setTimeout(() => { _t = null; addSegs(); }, 60); }).observe(document.body, { childList: true, subtree: true });

    if (isAdmin()) { const t0 = setInterval(() => { if (typeof globalData !== 'undefined' && globalData) { clearInterval(t0); setTimeout(() => { if (mode === 'strada') ensureIds(); }, 3500); } }, 300); setTimeout(() => clearInterval(t0), 60000); }
    // Ripristina la specialità scelta (dopo che l'app ha caricato i dati)
    let saved = 'strada'; try { saved = localStorage.getItem(MODE_KEY) || 'strada'; } catch (e) {}
    if (saved === 'ciclocross' && isAdmin()) {
      const t = setInterval(() => { if (typeof globalData !== 'undefined' && globalData) { clearInterval(t); setMode('ciclocross').then(() => { /* la pagina Statistiche può essere già in caricamento con i dati della strada: la si ridisegna */ if (/^\/(statistiche|record)/.test(location.pathname + location.hash.replace(/^#/, ''))) setTimeout(() => { if (mode === 'ciclocross') route(); }, 2500); }); } }, 250);
      setTimeout(() => clearInterval(t), 60000);
    }
  }
  init();
})();
