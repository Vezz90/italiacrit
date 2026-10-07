/* ============================================================
   ICS — nuova HOME (v2)
   Layout: gara in evidenza + 2 in vetrina, "Ultime gare" a card
   compatte (foto/video a sinistra se ci sono, sempre i primi 3),
   Oggi su ICS, Sport Intelligence, classifiche con la foto di una
   vittoria del leader, colonna laterale (atleti da seguire,
   prossime gare). La vecchia dashboard è ora la pagina Statistiche (#/statistiche)
   e fa da ripiego se questa pagina dà errore.
   Usa le funzioni/variabili globali di app.js (globalData, setPage,
   esc, catLabel, loadRanking, getEntityOverrides, mediaUrl…).
   ============================================================ */
'use strict';

(function () {
  const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const MESIL = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const CATS_M = ['ELI_M', 'JUN_M', 'AL_M', 'ES2_M', 'ES1_M'];
  const CATS_F = ['ELI_F', 'JUN_F', 'AL_F', 'ES2_F', 'ES1_F'];
  const BAND_COLOR = { ELI: ['#2459E6', '#0B1B3A'], JUN: ['#0E8F7E', '#042B26'], AL: ['#C2670C', '#3B1D04'], ES: ['#7C3AED', '#1F0B47'] };
  const F_COLOR = ['#D6336C', '#3B0A1E'];
  const hx = { sex: 'M', cat: '', reg: '', tipo: '', n: 12, year: 0, pcat: '' };
  let mediaPromise = null, seq = 0;

  const $ = id => document.getElementById(id);
  const iso = d => d.toISOString().slice(0, 10);
  const codeOf = gid => (String(gid || '').match(/_((?:ELI|JUN|AL|ES1|ES2)_[MF])$/) || [])[1] || '';
  const noSuffix = gid => String(gid || '').replace(/_[A-Z0-9]+_[MF]$/, '');
  const dparts = s => { const p = String(s).split('-'); return { y: +p[0], m: +p[1] - 1, d: +p[2] }; };
  const fmtLong = s => { const x = dparts(s); return x.d + ' ' + MESIL[x.m] + ' ' + x.y; };
  const initials = n => { const p = String(n || '').trim().split(/\s+/); return ((p[0] || '?')[0] + ((p[1] || '')[0] || '')).toUpperCase(); };
  const tc = s => String(s || '').toLowerCase().replace(/(^|[\s'’(-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
  // risultato dentro il sesso/categoria scelti (categoria di appartenenza dell'atleta, vedi gare promiscue)
  const inScope = r => { const c = getRankingFileCode(r) || codeOf(r.gara_id) || ''; return c.endsWith('_' + hx.sex) && (!hx.cat || c === hx.cat); };
  const fmtInt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  // Nome gara pulito: "75 TROFEO MADONNA DEL ROSARIO 49 TROFEO MARIO ZANCHI" → "75° Trofeo Madonna del Rosario"
  function raceTitle(n) {
    let s = String(n || '').replace(/\s+/g, ' ').trim();
    s = s.replace(/^(\d+)\s*[°^º]?\s+/, '$1° ');
    s = s.replace(/\s+\d+\s*[°^º]?\s+(TROFEO|MEMORIAL|GRAN PREMIO|GP|COPPA)\b.*$/i, '');
    s = tc(s).replace(/\b(Di|Del|Della|Delle|Dei|Degli|Da|De|E|In)\b/g, m => m.toLowerCase()).replace(/\bGp\b/g, 'GP');
    return s.replace(/^(\d+)° /, '$1° ');
  }

  /* ---------- copertina generata (gare senza foto) ---------- */
  function cover(code, km) {
    const band = String(code || 'ELI_M').replace(/_[MF]$/, '').replace(/^ES\d$/, 'ES');
    const c = String(code).endsWith('_F') ? F_COLOR : (BAND_COLOR[band] || BAND_COLOR.ELI);
    const id = 'hxg' + (++seq);
    return `<svg class="hx-cv" viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset="1" stop-color="${c[1]}"/></linearGradient></defs>
      <rect width="400" height="240" fill="url(#${id})"/><path d="M-20 240 L150 118 Q205 78 330 92 L420 98 L420 240 Z" fill="rgba(0,0,0,.28)"/>
      <path d="M40 240 L180 128 Q215 100 300 108" stroke="rgba(255,255,255,.55)" stroke-width="3" fill="none" stroke-dasharray="14 12"/>
      <path d="M0 150 Q100 90 210 112 T400 70" stroke="rgba(255,255,255,.12)" stroke-width="2" fill="none"/>
      ${km ? `<text x="392" y="226" text-anchor="end" font-family="Inter, sans-serif" font-style="italic" font-weight="800" font-size="110" fill="rgba(255,255,255,.14)">${esc(km)}</text>` : ''}</svg>`;
  }

  /* ---------- media (foto/video) ---------- */
  function loadMedia() {
    if (mediaPromise) return mediaPromise;
    mediaPromise = (async () => {
      const get = p => fetch(`${API_BASE}${p}`).then(r => r.json()).catch(() => ({ photos: [] }));
      const [d1, d2, d3] = await Promise.all([get('/race-photos'), get('/xpix-photos'), get('/ic-photos')]);
      const up = new Map(), ext = [];
      for (const p of (d1.photos || [])) {
        if (!p.filename || !p.gara_id) continue;
        if (!up.has(p.gara_id)) up.set(p.gara_id, []);
        up.get(p.gara_id).push({ url: `${PHOTOS_BASE}/photos/${p.filename}`, cap: String(p.caption || ''), tags: String(p.atleta_ids || '').split(',').map(s => s.trim()).filter(Boolean) });
      }
      for (const p of [...(d2.photos || []), ...(d3.photos || [])]) {
        if (!p.gara_id) continue;
        const urls = (p.photos && p.photos.length ? p.photos : (p.url ? [p.url] : [])).filter(u => /^https?:/.test(u)).map(icProxy);
        if (urls.length) ext.push({ gara_id: p.gara_id, urls, tags: p.tags || {} });
      }
      return { up, ext };
    })();
    return mediaPromise;
  }
  function racePhotos(media, gid) {
    const out = [];
    for (const p of (media.up.get(gid) || [])) out.push(p.url);
    const ns = noSuffix(gid);
    for (const e of media.ext) if (e.gara_id === gid || noSuffix(e.gara_id) === ns) out.push(...e.urls);
    return out;
  }
  function raceVideos(gid) {
    const v = (globalData.videos || {})[toCalId(gid)];
    return Array.isArray(v) ? v.length : 0;
  }

  /* ---------- gare raggruppate ---------- */
  function buildRaces() {
    const map = new Map(), count = {};
    for (const r of globalData.resultsRaw) {
      if (!r.gara_id) continue;
      count[r.gara_id] = (count[r.gara_id] || 0) + 1;
      if (!r.posizione || r.posizione > 3) continue;
      let g = map.get(r.gara_id);
      if (!g) { g = { id: r.gara_id, nome: r.nome_gara, data: r.data, code: codeOf(r.gara_id), km: r.km, media: r.media, tipo: r.tipo, molt: r.moltiplicatore || 1, top: [] }; map.set(r.gara_id, g); }
      g.top.push(r);
    }
    const calMap = globalData.garaToCalId || {};
    const calById = {};
    for (const c of globalData.calendar) calById[c.id] = c;
    const out = [];
    for (const g of map.values()) {
      g.top.sort((a, b) => a.posizione - b.posizione);
      if (!g.top.length || g.top[0].posizione !== 1) continue;
      const cal = calById[calMap[g.id] || toCalId(g.id)] || null;
      g.luogo = cal ? (cal.luogo || cal.regione || '') : '';
      g.regione = cal ? (cal.regione || '') : '';
      g.n = count[g.id] || 0;
      out.push(g);
    }
    return out;
  }
  /* ---------- gare recenti con solo i dati PCS (importati a mano, non ancora nei risultati FCI) ---------- */
  const pcsCache = {};
  function pcsPerson(name) {
    const w = String(name || '').trim().split(/\s+/);
    const up = w.filter(x => x.length > 1 && x === x.toUpperCase() && /[A-ZÀ-Ý]/.test(x));
    let cognome = up.join(' '), nome = w.filter(x => !up.includes(x)).join(' ');
    if (!cognome || !nome) { nome = w.length > 1 ? w[w.length - 1] : ''; cognome = w.slice(0, -1).join(' ') || w[0] || ''; }
    return { cognome, nome };
  }
  async function provisional(taken) {
    const today = iso(new Date()), from = iso(new Date(Date.now() - 3 * 864e5));
    const g2c = globalData.garaToCalId || {}, orphans = globalData.calBareOrphanIds || new Set();
    const have = new Set();
    for (const r of globalData.resultsRaw) if (r.gara_id) { have.add(toCalId(r.gara_id)); if (g2c[r.gara_id]) have.add(g2c[r.gara_id]); }
    const cands = [];
    for (const g of globalData.calendar) {
      if (!g.data || g.data < from || g.data > today || have.has(g.id) || orphans.has(g.id)) continue;
      if (!g.nome || g.nome.trim() === '-' || isNonRaceCalendarEntry(g) || isProCalendarEntry(g) || calendarHasResultsByNameDate(g)) continue;
      const bands = _calBandsOf(g.categoria);
      if (bands.size !== 1) continue;
      const band = [...bands][0];
      if (band === 'ES') continue;
      cands.push({ g, code: band + (/DONNE|DONNA/i.test(g.categoria || '') ? '_F' : '_M') });
    }
    const out = await Promise.all(cands.map(async ({ g, code }) => {
      let rows = pcsCache[g.id];
      if (!rows || Date.now() - rows.ts > 180000) {
        try { rows = { ts: Date.now(), v: await apiCall(`/pcs-results/gara/${encodeURIComponent(g.id)}`) }; } catch { rows = { ts: Date.now(), v: [] }; }
        pcsCache[g.id] = rows;
      }
      const v = (Array.isArray(rows.v) ? rows.v : []).slice().sort((a, b) => a.posizione - b.posizione);
      if (!v.length || v[0].posizione !== 1) return null;
      return { id: g.id, nome: g.nome, data: g.data, code, km: g.km || '', media: '', tipo: g.tipo || 'regionale', molt: g.moltiplicatore || 1, luogo: g.luogo || g.regione || '', regione: g.regione || '', n: v.length, prov: true,
        top: v.slice(0, 3).map(r => ({ posizione: r.posizione, atleta_id: r.atleta_id, tempo: '', ...pcsPerson(r.rider_name) })) };
    }));
    return out.filter(Boolean);
  }
  function sortRaces(a, b) {
    return b.data.localeCompare(a.data) || b.molt - a.molt || (b.code === 'ELI_M') - (a.code === 'ELI_M') || b.n - a.n || a.id.localeCompare(b.id);
  }
  function podium(g, big) {
    const t0 = g.top[0], time = (() => { const km = parseFloat(g.km), md = parseFloat(g.media); if (km > 0 && md > 0) { const s = Math.round(km / md * 3600); return `${Math.floor(s / 3600)}h ${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}′ ${String(s % 60).padStart(2, '0')}″`; } return ''; })();
    return g.top.slice(0, 3).map(r => {
      let gap = '';
      if (r.posizione === 1) gap = time;
      else gap = r.tempo ? '+' + String(r.tempo).replace(/^a\s*/, '').replace(/'/g, '′').replace(/"/g, '″') : 's.t.';
      return { pos: r.posizione, nome: tc(`${r.cognome} ${r.nome}`), id: r.atleta_id, gap };
    });
  }
  function badgeFor(data, today) {
    const n = Math.round((new Date(today + 'T00:00:00') - new Date(data + 'T00:00:00')) / 864e5);
    if (n <= 0) return ['OGGI', true];
    if (n === 1) return ['IERI', true];
    const x = dparts(data); return [x.d + ' ' + MESI[x.m].toUpperCase(), false];
  }

  /* ---------- rendering ---------- */
  function raceCard(g, media, today) {
    const photos = racePhotos(media, g.id), vids = raceVideos(g.id), has = photos.length > 0 || vids > 0;
    const band = (g.code || 'ELI_M').replace(/_[MF]$/, '').replace(/^ES\d$/, 'ES');
    const col = g.code.endsWith('_F') ? F_COLOR[0] : (BAND_COLOR[band] || BAND_COLOR.ELI)[0];
    const b = badgeFor(g.data, today);
    const km = parseFloat(g.km) > 0 ? Math.round(parseFloat(g.km)) : '';
    const media$ = has
      ? `<div class="hx-rk-m">${cover(g.code, '')}${photos[0] ? `<img src="${esc(photos[0])}" alt="" loading="lazy" onerror="this.remove()">` : ''}${vids && !photos.length ? '<span class="hx-play">▶</span>' : ''}<div class="hx-chips">${photos.length ? `<span>📷 ${photos.length}</span>` : ''}${vids ? `<span>▶ ${vids}</span>` : ''}</div></div>`
      : `<div class="hx-spine" style="--sp:${col}"></div>`;
    const top = podium(g).map(t => `<li><i class="hx-med p${t.pos}">${t.pos}</i><span class="nm">${esc(t.nome)}</span><span class="g">${esc(t.gap)}</span></li>`).join('');
    return `<a class="hx-rk ${has ? '' : 'nomedia'}" href="#/gara/${encodeURIComponent(g.id)}">${media$}<div class="hx-rk-b"><div class="hx-rk-h"><span class="hx-bd ${b[1] ? 'hot' : ''}">${b[0]}</span><span>${esc(catLabel(g.code))}</span>${g.prov ? '<span class="hx-bd" style="background:#64748B" title="Ordine d’arrivo da PCS, in attesa dei risultati FCI">PROVV.</span>' : ''}${km ? `<span>·</span><span class="num">${km} km</span>` : ''}</div><h3>${esc(raceTitle(g.nome))}</h3><div class="hx-loc">${esc(g.luogo || g.regione || '')}</div><ol class="hx-top3">${top}</ol></div></a>`;
  }

  function stats(races, today) {
    const last = races.length ? races[0].data : today;
    const from = iso(new Date(new Date(last + 'T00:00:00').getTime() - 2 * 864e5));
    const scoped = globalData.resultsRaw.filter(inScope);
    const rows = scoped.filter(r => r.data >= from);
    const first = {};
    for (const r of scoped) if (r.atleta_id && (!first[r.atleta_id] || r.data < first[r.atleta_id])) first[r.atleta_id] = r.data;
    const wk = iso(new Date(new Date(last + 'T00:00:00').getTime() - 7 * 864e5));
    const year = String(last).slice(0, 4);
    const titles = Object.values(_regionalChampionTitles || {}).reduce((s, l) => s + l.filter(t => String(t.anno) === year && String(t.categoria || '').endsWith('_' + hx.sex) && (!hx.cat || t.categoria === hx.cat)).length, 0);
    return [
      ['<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>', new Set(rows.map(r => r.gara_id)).size, 'Gare negli ultimi 3 giorni di gara'],
      ['<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>', fmtInt(rows.length), 'Risultati pubblicati'],
      ['<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.4c2.2.7 3.5 2.6 3.5 5.6"/>', fmtInt(Object.keys(first).length), hx.cat ? 'Atleti in questa categoria' : 'Atleti in archivio'],
      ['<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 13v4M8 21h8M9 17h6"/>', rows.filter(r => r.posizione === 1).length, 'Vittorie negli ultimi 3 giorni di gara'],
      ['<path d="M3 17l6-6 4 4 7-8"/><path d="M15 7h5v5"/>', Object.values(first).filter(d => d >= wk).length, 'Nuovi atleti (7 giorni)'],
      ['<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>', titles, 'Titoli regionali ' + year]
    ];
  }

  function intelligence(races, today) {
    const last = races.length ? races[0].data : today;
    const cut = iso(new Date(new Date(last + 'T00:00:00').getTime() - 14 * 864e5));
    const main = new Set([...CATS_M, ...CATS_F]);
    const hot = {}, byCat = {};
    for (const r of globalData.resultsRaw) {
      if (!r.atleta_id || r.tipo === 'pista') continue;
      const c = getRankingFileCode(r);
      if (!main.has(c)) continue;
      const pts = r.punti_effettivi || 0;
      const d = (byCat[c] = byCat[c] || {});
      const e = (d[r.atleta_id] = d[r.atleta_id] || [0, 0]);
      e[0] += pts; if (r.data < cut) e[1] += pts;
      if (r.data >= cut) {
        const h = (hot[r.atleta_id + '|' + c] = hot[r.atleta_id + '|' + c] || { id: r.atleta_id, cat: c, pts: 0, w: 0, n: 0, nome: tc(`${r.cognome} ${r.nome}`), team: tc(r.team), team_id: r.team_id });
        h.pts += pts; h.n++; if (r.posizione === 1) h.w++;
      }
    }
    const sexCats = hx.cat ? [hx.cat] : (hx.sex === 'F' ? CATS_F : CATS_M);
    const hotL = Object.values(hot).filter(h => sexCats.includes(h.cat)).sort((a, b) => b.pts - a.pts).slice(0, 5);
    const movers = [];
    for (const c of sexCats) {
      const d = byCat[c]; if (!d) continue;
      const now = Object.entries(d).sort((a, b) => b[1][0] - a[1][0]), before = Object.entries(d).sort((a, b) => b[1][1] - a[1][1]);
      const rn = {}, rb = {};
      now.forEach(([a], i) => { rn[a] = i + 1; }); before.forEach(([a], i) => { rb[a] = i + 1; });
      for (const [a, [pn, pb]] of Object.entries(d)) if (pb > 0 && rn[a] <= 40 && rb[a] - rn[a] > 0) movers.push({ id: a, cat: c, gain: rb[a] - rn[a], pos: rn[a] });
    }
    movers.sort((a, b) => b.gain - a.gain);
    const nameOf = {};
    for (const r of globalData.resultsRaw) if (r.atleta_id && !nameOf[r.atleta_id]) nameOf[r.atleta_id] = tc(`${r.cognome} ${r.nome}`);
    return { hot: hotL, movers: movers.slice(0, 5).map(m => ({ ...m, nome: nameOf[m.id] || m.id })), nameOf };
  }

  async function rivalries(code, k) {
    const rk = (await loadRanking(code) || []).slice(0, 10), ids = new Set(rk.map(x => x.atleta_id));
    const by = {};
    for (const r of globalData.resultsRaw) if (ids.has(r.atleta_id) && codeOf(r.gara_id) === code) (by[r.gara_id] = by[r.gara_id] || {})[r.atleta_id] = r.posizione;
    const pair = {};
    for (const d of Object.values(by)) {
      const ks = Object.keys(d).sort();
      for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
        const k = ks[i] + '|' + ks[j], p = (pair[k] = pair[k] || [0, 0, 0]);
        p[0]++; if (d[ks[i]] < d[ks[j]]) p[1]++; else if (d[ks[j]] < d[ks[i]]) p[2]++;
      }
    }
    const nm = {}; rk.forEach(x => { nm[x.atleta_id] = tc(`${x.cognome} ${x.nome}`); });
    return Object.entries(pair).sort((a, b) => b[1][0] - a[1][0]).slice(0, k || 3).map(([kk, v]) => { const [a, b] = kk.split('|'); return { a: nm[a], b: nm[b], n: v[0], wa: v[1], wb: v[2], cat: code }; });
  }

  /* ---------- pagina ---------- */
  async function render() {
    if (!globalData) { setPage('<div class="loading-bar"></div>'); return; }
    const myId = (window._hxRender = (window._hxRender || 0) + 1);
    setPage('<div class="hx-wrap"><div class="hd-skel-hero"></div></div>');
    try {
      const media = await loadMedia();
      if (myId !== window._hxRender) return;
      await paint(media, myId);
    } catch (e) {
      console.error('[home v2]', e);
      if (myId === window._hxRender) return window.renderHomeDashboard();
    }
  }

  /* ---------- selettore stagione ---------- */
  const curYear = () => +_loadedSeasonYear() || new Date().getFullYear();
  function yearSel() {
    const cy = curYear(), sel = hx.year || cy, ys = [];
    for (let y = cy; y >= 2007; y--) ys.push(y);
    return `<label class="hx-sel hx-yr"><span class="sr">Stagione</span><select id="hx-year" aria-label="Stagione">${ys.map(y => `<option value="${y}"${y === sel ? ' selected' : ''}>Stagione ${y}${y === cy ? ' (in corso)' : ''}</option>`).join('')}</select></label>`;
  }
  function wireYear() {
    const el = $('hx-year');
    if (el) el.onchange = () => { const y = +el.value; hx.year = y === curYear() ? 0 : y; hx.cat = ''; hx.pcat = ''; hx.reg = ''; hx.n = 12; render(); };
  }

  /* ---------- stagioni passate (archivio ciclismo.info) ---------- */
  const _pastCache = {};
  async function loadPast(y) {
    if (_pastCache[y]) return _pastCache[y];
    const [r, c] = await Promise.all([loadJson(`data/ciclismo-storico/${y}/races.json`), loadJson(`data/ciclismo-storico/${y}/classifica.json`)]);
    return (_pastCache[y] = { races: (r && r.races) || [], cls: (c && c.classifica) || {} });
  }
  async function paintPast(y, myId) {
    const { races, cls } = await loadPast(y);
    if (myId !== window._hxRender) return;
    const isF = k => /^DONNE/i.test(k), F = hx.sex === 'F';
    const ord = k => (typeof _CICLISMO_CAT_ORDER !== 'undefined' && _CICLISMO_CAT_ORDER[k] != null) ? _CICLISMO_CAT_ORDER[k] : 99;
    const catKeys = new Set(); races.forEach(ev => Object.keys(ev.categorie || {}).forEach(k => { if (isF(k) === F) catKeys.add(k); }));
    const cats = [...catKeys].sort((a, b) => ord(a) - ord(b));
    if (hx.pcat && !catKeys.has(hx.pcat)) hx.pcat = '';
    const regs = [...new Set(races.map(g => g.regione).filter(Boolean))].sort();
    const list = races.filter(ev => Object.entries(ev.categorie || {}).some(([k, t]) => isF(k) === F && t.length && (!hx.pcat || k === hx.pcat)) && (!hx.reg || ev.regione === hx.reg))
      .sort((a, b) => String(b.data).localeCompare(String(a.data)));
    const head = list.slice(0, 12), hero = head.find(g => g.photo_url) || head[0];
    const side = [...head.filter(g => g !== hero && g.photo_url), ...head.filter(g => g !== hero && !g.photo_url)].slice(0, 2);
    const restAll = list.filter(g => g !== hero && !side.includes(g)), rest = restAll.slice(0, hx.n);
    const lab = k => (typeof _ciclismoCatLabel === 'function' ? _ciclismoCatLabel(k) : String(k).replace(/_/g, ' '));
    const codeOfRaw = k => (isF(k) ? 'ELI_F' : 'ELI_M');
    const sel = (id, val, opts, label) => `<label class="hx-sel"><span class="sr">${label}</span><select id="${id}" aria-label="${label}"><option value="">${label}</option>${opts.map(o => `<option value="${esc(o[0])}" ${o[0] === val ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></label>`;
    const href = ev => `/gara/CIC_${esc(ev.id)}`;
    const firstCat = ev => Object.keys(ev.categorie || {}).find(k => isF(k) === F) || Object.keys(ev.categorie || {})[0] || '';
    const heroHtml = hero ? `<a class="hx-card hx-hero" href="${href(hero)}"><div class="hx-bg">${cover(codeOfRaw(firstCat(hero)), '')}${hero.photo_url ? `<img src="${esc(mediaUrl(hero.photo_url))}" alt="" onerror="this.remove()">` : ''}</div>
        <span class="hx-tag">STAGIONE ${y}</span><div class="hx-meta">${fmtLong(hero.data).toUpperCase()} · ${esc(lab(firstCat(hero))).toUpperCase()}</div>
        <h1>${esc(raceTitle(hero.nome))}</h1><p>I risultati della giornata</p></a>` : '<div class="hx-card hx-empty">Nessuna gara trovata con questi filtri.</div>';
    const sideHtml = side.map(g => `<a class="hx-card hx-side" href="${href(g)}"><div class="hx-bg">${cover(codeOfRaw(firstCat(g)), '')}${g.photo_url ? `<img src="${esc(mediaUrl(g.photo_url))}" alt="" loading="lazy" onerror="this.remove()">` : ''}</div><h3>${esc(raceTitle(g.nome))}</h3><small>${esc(lab(firstCat(g)))}${g.luogo ? ' · ' + esc(tc(g.luogo)) : ''}</small><span class="hx-chev">›</span></a>`).join('');
    const card = ev => window.RisV2 ? window.RisV2.histCard(ev) : '';
    const topCats = hx.pcat ? [hx.pcat] : cats;
    const clsHtml = topCats.map(k => {
      const rows = (cls[k] || []).slice(0, hx.pcat ? 5 : 1);
      return rows.map((r, i) => `<a class="hx-mr" href="/atleta/${encodeURIComponent(r.atleta_id || '')}">${hx.pcat ? `<span class="hx-pos p${i + 1}">${i + 1}</span>` : ''}<span class="hx-mav">${esc(initials(tc(r.nome_completo)))}</span><span class="nm"><b>${esc(tc(r.nome_completo))}</b><small>${esc(hx.pcat ? tc(r.team || '') : lab(k))}</small></span><span class="pt num">${r.punti}</span></a>`).join('');
    }).join('') || '<div class="hx-none">Nessun dato</div>';
    const withRes = list.filter(ev => Object.values(ev.categorie || {}).some(t => t.length)).length;
    const winners = {}, wNames = {};
    list.forEach(ev => Object.entries(ev.categorie || {}).forEach(([k, t]) => { if (isF(k) === F && t[0] && t[0].atleta_id) { winners[t[0].atleta_id] = (winners[t[0].atleta_id] || 0) + 1; wNames[t[0].atleta_id] = t[0].nome_completo; } }));
    const topW = Object.entries(winners).sort((a, b) => b[1] - a[1]).slice(0, 3);
    setPage(`<div class="hx-wrap">
      <div class="hx-filters" aria-label="Filtri">
        <div class="hx-seg" role="group" aria-label="Uomini o donne"><button type="button" data-sex="M" aria-pressed="${!F}">Uomini</button><button type="button" data-sex="F" aria-pressed="${F}">Donne</button></div>
        ${sel('hx-pcat', hx.pcat, cats.map(k => [k, lab(k)]), 'Tutte le categorie')}
        ${sel('hx-reg', hx.reg, regs.map(r => [r, tc(r)]), 'Tutte le regioni')}
        ${yearSel()}
      </div>
      <div class="hx-layout"><div class="hx-col">
        <section class="hx-herogrid">${heroHtml}<div class="hx-sidecol">${sideHtml}</div></section>
        <section><div class="hx-ph"><h2>Gare ${y}</h2><a href="/risultati">Tutti i risultati →</a></div><div class="hx-rlist">${rest.map(card).join('') || '<div class="hx-none">Nessuna altra gara con questi filtri.</div>'}</div>${restAll.length > rest.length ? `<button type="button" class="hx-more" id="hx-more">Carica altre gare (${restAll.length - rest.length})</button>` : ''}</section>
      </div>
      <aside class="hx-col" aria-label="Laterale">
        <section class="hx-panel"><div class="hx-ph"><h2>Stagione ${y}</h2></div><div class="rs-kv"><span>Gare</span><b>${list.length}</b><span>Con risultati</span><b>${withRes}</b></div></section>
        <section class="hx-panel"><div class="hx-ph"><h2>Più vittorie</h2></div>${topW.map(([id, n], i) => `<a class="hx-si-r" href="/atleta/${encodeURIComponent(id)}"><span class="n">${i + 1}</span><span class="nm">${esc(tc(wNames[id]))}</span><span class="up">${n} vitt.</span></a>`).join('') || '<div class="hx-none">Nessun dato</div>'}</section>
        <section class="hx-panel"><div class="hx-ph"><h2>Classifica atleti ${y}</h2><a href="/classifica">Completa →</a></div>${clsHtml}</section>
      </aside></div>
    </div>`);
    document.querySelectorAll('.hx-seg button').forEach(b => { b.onclick = () => { hx.sex = b.dataset.sex; hx.pcat = ''; hx.n = 12; render(); }; });
    const more = $('hx-more'); if (more) more.onclick = () => { const yy = window.scrollY; hx.n += 12; render().then(() => window.scrollTo(0, yy)); };
    [['hx-pcat', 'pcat'], ['hx-reg', 'reg']].forEach(([id, k]) => { const el = $(id); if (el) el.onchange = () => { hx[k] = el.value; hx.n = 12; render(); }; });
    wireYear();
    document.querySelectorAll('.hx-wrap [data-href]').forEach(el => el.addEventListener('click', e => { if (e.target.closest('a')) return; if (typeof navTo === 'function') navTo(el.getAttribute('data-href')); }));
  }

  async function paint(media, myId) {
    if (hx.year && hx.year !== curYear()) return paintPast(hx.year, myId);
    const all = [...buildRaces(), ...await provisional().catch(() => [])].sort(sortRaces);
    const today = iso(new Date());
    const regs = [...new Set(all.map(g => g.regione).filter(Boolean))].sort();
    const tipi = [...new Set(all.map(g => g.tipo).filter(Boolean))].sort();
    const cats = hx.sex === 'F' ? CATS_F : CATS_M;
    let list = all.filter(g => (hx.sex === 'F' ? g.code.endsWith('_F') : g.code.endsWith('_M')) && (!hx.cat || g.code === hx.cat) && (!hx.reg || g.regione === hx.reg) && (!hx.tipo || g.tipo === hx.tipo));
    // in evidenza e in vetrina: tra le gare più recenti preferisco quelle con una foto
    const hasPh = g => racePhotos(media, g.id).length > 0, head = list.slice(0, 12);
    const hero = head.find(hasPh) || head[0];
    const side = [...head.filter(g => g !== hero && hasPh(g)), ...head.filter(g => g !== hero && !hasPh(g))].slice(0, 2);
    const restAll = list.filter(g => g !== hero && !side.includes(g)), rest = restAll.slice(0, hx.n);
    const scopeRaces = all.filter(g => g.code.endsWith('_' + hx.sex) && (!hx.cat || g.code === hx.cat));
    const st = stats(scopeRaces, today), si = intelligence(scopeRaces, today);
    // rivalità: con una categoria scelta le 3 più accese di quella; altrimenti la più accesa di OGNI categoria
    const riv = hx.cat ? await rivalries(hx.cat, 3) : (await Promise.all(cats.map(c => rivalries(c, 1)))).flat();
    if (myId !== window._hxRender) return;
    const band = hx.cat ? hx.cat.replace(/_[MF]$/, '').replace(/^ES\d$/, 'ES') : '';
    const calOk = g => {
      const f = /DONNE|DONNA/i.test(g.categoria || '');
      if (f !== (hx.sex === 'F')) return false;
      if (!band) return true;
      const mixed = /PROMISCUA|OPEN|M\/F|PIU' CATEGORIE|MULTICATEGORIA/i.test(g.categoria || '');
      return mixed || _calBandsOf(g.categoria).has(band);
    };
    const upcoming = globalData.calendar.filter(g => g.data >= today && !isNonRaceCalendarEntry(g) && !isProCalendarEntry(g) && calOk(g)).sort((a, b) => a.data.localeCompare(b.data)).filter((g, i, arr) => arr.findIndex(x => x.data === g.data && String(x.nome).toUpperCase().replace(/[^A-Z0-9]/g, '') === String(g.nome).toUpperCase().replace(/[^A-Z0-9]/g, '')) === i).slice(0, 5);
    // classifiche a destra: senza categoria il primo di ogni categoria (uomini e donne); con una categoria i primi 5
    const grp = (t, inner) => `<div class="hx-grp">${t}</div>${inner}`;
    const mini = (kind) => hx.cat
      ? `<div class="hx-mini" data-kind="${kind}" data-codes="${hx.cat}" data-top="5"><div class="hx-none">…</div></div>`
      : grp('Uomini', `<div class="hx-mini" data-kind="${kind}" data-codes="${CATS_M.join(',')}" data-top="1"><div class="hx-none">…</div></div>`) + grp('Donne', `<div class="hx-mini" data-kind="${kind}" data-codes="${CATS_F.join(',')}" data-top="1"><div class="hx-none">…</div></div>`);
    const clsLink = kind => `#/classifica${hx.cat ? '/' + hx.cat : ''}${kind === 't' ? (hx.cat ? '/team' : '') : ''}`;

    const ic = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
    const sel = (id, val, opts, label) => `<label class="hx-sel"><span class="sr">${label}</span><select id="${id}" aria-label="${label}"><option value="">${label}</option>${opts.map(o => `<option value="${esc(o[0])}" ${o[0] === val ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></label>`;
    const heroHtml = hero ? (() => {
      const ph = racePhotos(media, hero.id)[0];
      return `<a class="hx-card hx-hero" href="#/gara/${encodeURIComponent(hero.id)}"><div class="hx-bg">${cover(hero.code, '')}${ph ? `<img src="${esc(ph)}" alt="" onerror="this.remove()">` : ''}</div>
        <span class="hx-tag">IN EVIDENZA</span><div class="hx-meta">${fmtLong(hero.data).toUpperCase()} · ${esc(catLabel(hero.code)).toUpperCase()}</div>
        <h1>${esc(raceTitle(hero.nome))}</h1><p>I risultati della giornata</p></a>`;
    })() : '<div class="hx-card hx-empty">Nessuna gara trovata con questi filtri.</div>';
    const sideHtml = side.map(g => { const ph = racePhotos(media, g.id)[0]; return `<a class="hx-card hx-side" href="#/gara/${encodeURIComponent(g.id)}"><div class="hx-bg">${cover(g.code, '')}${ph ? `<img src="${esc(ph)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</div><h3>${esc(raceTitle(g.nome))}</h3><small>${esc(catLabel(g.code))}${g.luogo ? ' · ' + esc(g.luogo) : ''}</small><span class="hx-chev">›</span></a>`; }).join('');
    const siHtml = `<section class="hx-si"><h2>${ic('<path d="M12 3c1 3.5 4.5 5 4.5 9a4.5 4.5 0 0 1-9 0c0-1.7.7-2.9 1.6-3.9C9.6 10 11 9 12 3z"/>')}Sport Intelligence</h2><div class="hx-si-g">
      <div class="hx-si-c"><h3>Hot riders · 14 giorni</h3>${si.hot.map((h, i) => `<a class="hx-si-r" href="#/atleta/${encodeURIComponent(h.id)}"><span class="n">${i + 1}</span><span class="nm">${esc(h.nome)}</span><span class="up">${h.pts} pt</span></a>`).join('') || '<div class="hx-none">Nessun dato</div>'}</div>
      <div class="hx-si-c"><h3>Movers · posizioni guadagnate</h3>${si.movers.map((m, i) => `<a class="hx-si-r" href="#/atleta/${encodeURIComponent(m.id)}"><span class="n">${i + 1}</span><span class="nm">${esc(m.nome)}</span><span class="up">↑${m.gain}</span></a>`).join('') || '<div class="hx-none">Nessun dato</div>'}</div>
      <div class="hx-si-c"><h3>Rivalità${hx.cat ? ' · ' + esc(catLabel(hx.cat)) : ''}</h3>${riv.map(r => `<div class="hx-rv"><b>${esc(r.a)} vs ${esc(r.b)}</b><span>${hx.cat ? '' : esc(catLabel(r.cat)) + ' · '}${r.n} gare insieme · ${r.wa}–${r.wb}</span></div>`).join('') || '<div class="hx-none">Nessun dato</div>'}</div></div>
      <div class="hx-si-f"><a href="#/statistiche">Statistiche per categoria →</a> · <a href="#/record">Record e primati →</a></div></section>`;
    const followHtml = si.hot.slice(0, 3).map((h, i) => `<a class="hx-ath" href="#/atleta/${encodeURIComponent(h.id)}"><div class="hx-av" data-aid="${esc(h.id)}" style="background:${['#2459E6', '#0E8F7E', '#C2670C'][i]}">${esc(initials(h.nome))}</div><div><b>${esc(h.nome)}</b><span>${esc(h.team)} · ${esc(catLabel(h.cat))}</span><br><span class="hx-tg ${h.w ? '' : 'b'}">${h.w ? 'Hot rider' : 'In forma'}</span></div><div class="hx-upv">+${h.pts}</div></a>`).join('');
    const calRow = g => { const x = dparts(g.data); return `<a class="hx-calr" href="#/calendario"><div class="d num">${String(x.d).padStart(2, '0')}<small>${MESI[x.m]}</small></div><div class="t">${esc(raceTitle(g.nome))}<small>${esc(tc(g.luogo || g.regione || ''))}</small></div><span class="hx-pill">${esc(tc(g.categoria || '').replace(/ E /g, ' · '))}</span></a>`; };
    setPage(`<div class="hx-wrap">
      <div class="hx-filters" aria-label="Filtri">
        <div class="hx-seg" role="group" aria-label="Uomini o donne"><button type="button" data-sex="M" aria-pressed="${hx.sex === 'M'}">Uomini</button><button type="button" data-sex="F" aria-pressed="${hx.sex === 'F'}">Donne</button></div>
        ${sel('hx-cat', hx.cat, cats.map(c => [c, catLabel(c)]), 'Tutte le categorie')}
        ${sel('hx-reg', hx.reg, regs.map(r => [r, tc(r)]), 'Tutte le regioni')}
        ${sel('hx-tipo', hx.tipo, tipi.map(t => [t, tc(t)]), 'Tutti i tipi')}
        ${yearSel()}
      </div>
      <div class="hx-layout"><div class="hx-col">
        <section class="hx-herogrid">${heroHtml}<div class="hx-sidecol">${sideHtml}</div></section>
        <section><div class="hx-ph"><h2>Ultime gare</h2><a href="#/risultati">Tutti i risultati →</a></div><div class="hx-rlist">${rest.map(g => raceCard(g, media, today)).join('') || '<div class="hx-none">Nessuna altra gara con questi filtri.</div>'}</div>${restAll.length > rest.length ? `<button type="button" class="hx-more" id="hx-more">Carica altre gare (${restAll.length - rest.length})</button>` : ''}</section>
        <section class="hx-panel"><div class="hx-ph"><h2>Oggi su ICS</h2></div><div class="hx-stats">${st.map(s => `<div class="hx-st">${ic(s[0])}<b>${s[1]}</b><span>${s[2]}</span></div>`).join('')}</div></section>
        ${siHtml}
      </div>
      <aside class="hx-col" aria-label="Laterale">
        <section class="hx-panel"><div class="hx-ph"><h2>Atleti da seguire</h2><a href="#/atleti">Vedi tutti →</a></div>${followHtml || '<div class="hx-none">Nessun dato</div>'}</section>
        <section class="hx-panel"><div class="hx-ph"><h2>Classifica atleti</h2><a href="${clsLink('a')}">Completa →</a></div>${mini('a')}</section>
        <section class="hx-panel"><div class="hx-ph"><h2>Classifica team</h2><a href="${clsLink('t')}">Completa →</a></div>${mini('t')}</section>
        <section class="hx-panel"><div class="hx-ph"><h2>Prossime gare</h2><a href="#/calendario">Calendario →</a></div>${upcoming.map(calRow).join('') || '<div class="hx-none">Nessuna gara in programma</div>'}</section>
      </aside></div>
      <section class="hx-banner"><div><h2>Tutto il ciclismo italiano,<br>in un unico portale.</h2><p>Risultati, classifiche, atleti, team, gare e molto altro.</p></div><a class="hx-cta" href="#/regolamento">SCOPRI IL PROGETTO →</a></section>
    </div>`);
    document.querySelectorAll('.hx-seg button').forEach(b => { b.onclick = () => { hx.sex = b.dataset.sex; hx.cat = ''; hx.n = 12; render(); }; });
    wireYear();
    const more = $('hx-more'); if (more) more.onclick = () => { const y = window.scrollY; hx.n += 12; render().then(() => window.scrollTo(0, y)); };
    [['hx-cat', 'cat'], ['hx-reg', 'reg'], ['hx-tipo', 'tipo']].forEach(([id, k]) => { const el = $(id); if (el) el.onchange = () => { hx[k] = el.value; hx.n = 12; render(); }; });
    // classifiche a destra: atleti e team (foto profilo / logo piccoli)
    document.querySelectorAll('.hx-mini').forEach(box => {
      const kind = box.dataset.kind, top = +box.dataset.top, codes = box.dataset.codes.split(',');
      Promise.all(codes.map(c => (kind === 'a' ? loadRanking(c) : loadTeamRanking(c)).then(rk => ({ c, rk: (rk || []).slice(0, top) })).catch(() => ({ c, rk: [] })))).then(res => {
        if (myId !== window._hxRender) return;
        const rows = [];
        for (const { c, rk } of res) rk.forEach((r, i) => rows.push({ c, i, r }));
        box.innerHTML = rows.map(({ c, i, r }) => {
          const isA = kind === 'a', name = isA ? tc(`${r.cognome} ${r.nome}`) : tc(r.team_nome || ''), id = isA ? r.atleta_id : r.team_id;
          const sub = hx.cat ? (isA ? tc(r.team_nome || '') : (r.n_atleti ? r.n_atleti + ' atleti' : '')) : catLabel(c);
          return `<a class="hx-mr" href="#/${isA ? 'atleta' : 'team'}/${encodeURIComponent(id)}">${hx.cat ? `<span class="hx-pos p${i + 1}">${i + 1}</span>` : ''}<span class="hx-mav" data-kind="${isA ? 'atleta' : 'team'}" data-id="${esc(id)}">${esc(initials(name))}</span><span class="nm"><b>${esc(name)}</b><small>${esc(sub)}</small></span><span class="pt num">${r.punti}</span></a>`;
        }).join('') || '<div class="hx-none">Nessun dato</div>';
        box.querySelectorAll('.hx-mav').forEach(async el => {
          try { const ov = await getEntityOverrides(el.dataset.kind, el.dataset.id); if (ov.photo_url && myId === window._hxRender) el.innerHTML = `<img src="${esc(mediaUrl(ov.photo_url))}" alt="" loading="lazy" onerror="this.remove()">`; } catch (_) { /* ok */ }
        });
      });
    });
    document.querySelectorAll('.hx-av[data-aid]').forEach(async el => {
      try { const ov = await getEntityOverrides('atleta', el.dataset.aid); if (ov.photo_url && myId === window._hxRender) el.innerHTML = `<img src="${esc(mediaUrl(ov.photo_url))}" alt="" loading="lazy" onerror="this.remove()">`; } catch (_) { /* ok */ }
    });
  }

  window.renderHomeV2 = render;
})();
