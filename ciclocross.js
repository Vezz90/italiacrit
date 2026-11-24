/* ============================================================
   Italia Cycling Stats — ciclocross.js
   Specialità Ciclocross (stagione ottobre→gennaio, es. "2026/27").
   VISIBILE SOLO ALL'ADMIN finché non è pronta (stesso criterio della pista).

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

  const isAdmin = () => { try { return (JSON.parse(localStorage.getItem('italiacrit-user') || 'null') || {}).role === 'admin'; } catch (e) { return false; } };
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
  let cxTeams = null;           // team_id con risultati ciclocross

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
    const resultsRaw = [];
    const athletes = {}, teams = {};
    let seq = 0;
    for (const r of res) {
      const g = gare[r.gara]; if (!g) continue;
      const pos = parseInt(r.pos, 10); if (!(pos >= 1)) continue;
      const tipo = String(g.geo || 'Regionale').toLowerCase();
      const mult = MULT[tipo] || 1;
      const calId = `${slug(g.nome)}_${g.data}`;
      const code = r.cat;                                   // es. ES2_M
      const base = code.replace(/_[MF]$/, ''), gen = code.endsWith('_F') ? 'F' : 'M';
      const isCR = /campionato regionale/i.test(g.nome), isCI = /campionato italiano/i.test(g.nome);
      if (!seenCal[calId]) {
        seenCal[calId] = 1;
        calendar.push({ id: calId, nome: g.nome, data: g.data, tipo, moltiplicatore: mult, campionato_regionale: isCR, campionato_italiano: isCI,
          regione: String(g.regione || '').toUpperCase(), categoria: g.categorie_ammesse || g.classe || '', luogo: g.luogo || '', fci_id: g.fci_id });
      }
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
    cxAth = new Set(Object.keys(athletes)); cxTeams = new Set(Object.keys(teams));
    const meta = { ...((liveGd && liveGd.meta) || {}), disciplina: 'ciclocross' };
    return processLoadedData({ calendar, resultsRaw, athletes, teams, meta, raceDetails: (liveGd && liveGd.raceDetails) || {}, videos: (liveGd && liveGd.videos) || {}, extraRoster: {} });
  }

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
    try { localStorage.setItem(MODE_KEY, m); } catch (e) {}
    document.body.classList.toggle('disc-cx', m === 'ciclocross');
    renderNavSwitch();
    if (typeof invalidatePhotoCache === 'function') invalidatePhotoCache();
    if (opts.go) location.hash = '#' + opts.go;
    route();
  }
  window.cxSetMode = setMode;

  // ── Interruttore nel menu ────────────────────────────────────────
  function renderNavSwitch() {
    document.querySelectorAll('.nav-links').forEach(box => {
      let el = box.querySelector('.cx-nav-switch');
      if (!isAdmin()) { if (el) el.remove(); return; }
      if (!el) {
        el = document.createElement('span');
        el.className = 'cx-nav-switch'; el.style.cssText = 'display:inline-flex;gap:2px;margin-left:14px;padding-left:14px;border-left:1px solid rgba(128,128,128,.4);align-items:center';
        el.innerHTML = '<a href="#" class="nav-link" data-m="strada">Strada</a><a href="#" class="nav-link" data-m="ciclocross">Ciclocross</a>';
        el.onclick = (e) => { const b = e.target.closest('a[data-m]'); if (!b) return; e.preventDefault(); setMode(b.dataset.m, { go: '/' }); };
        box.appendChild(el);
      }
      el.querySelectorAll('a').forEach(b => b.classList.toggle('active', b.dataset.m === mode));
    });
  }

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
    try { await loadRaw(); build(globalData); return true; } catch (e) { return false; }
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
    wrap('renderAtleta', async (id) => {
      if (mode === 'strada' && !(await ensureIds())) return;
      if (!otherHas('atleta', id)) return;
      const t = document.getElementById('atleta-results-title');
      placePicker(t && t.closest('.section-header'));
    });
    wrap('renderTeam', async (tid) => {
      if (mode === 'strada' && !(await ensureIds())) return;
      if (!otherHas('team', tid)) return;
      const h = [...document.querySelectorAll('#app .section-header')].find(x => /RISULTATI TEAM/i.test(x.textContent));
      placePicker(h);
    });
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

    window.addEventListener('hashchange', () => setTimeout(renderNavSwitch, 120)); // l'app azzera 'active' sui link a ogni cambio pagina
    renderNavSwitch();
    new MutationObserver(() => { if (isAdmin() && !document.querySelector('.cx-nav-switch')) renderNavSwitch(); }).observe(document.body, { childList: true, subtree: true });

    // Ripristina la specialità scelta (dopo che l'app ha caricato i dati)
    let saved = 'strada'; try { saved = localStorage.getItem(MODE_KEY) || 'strada'; } catch (e) {}
    if (saved === 'ciclocross' && isAdmin()) {
      const t = setInterval(() => { if (typeof globalData !== 'undefined' && globalData) { clearInterval(t); setMode('ciclocross'); } }, 250);
      setTimeout(() => clearInterval(t), 60000);
    }
  }
  init();
})();
