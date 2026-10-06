/* ============================================================
   ICS — pagina RISULTATI (v2), stessa famiglia della nuova Home:
   gare raggruppate per giorno, card compatte (foto/video a
   sinistra se ci sono, sempre i primi 3), vista Lista a tabella,
   lettore con le dirette YouTube davvero in onda in cima.
   La logica dati e i filtri restano in app.js (renderRisultati /
   renderRisultatiStorico): qui solo markup e il lettore live.
   ============================================================ */
'use strict';

(function () {
  const MESIL = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const GG = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  const BAND_COLOR = { ELI: ['#2459E6', '#0B1B3A'], JUN: ['#0E8F7E', '#042B26'], AL: ['#C2670C', '#3B1D04'], ES: ['#7C3AED', '#1F0B47'] };
  const F_COLOR = ['#D6336C', '#3B0A1E'];
  const $ = id => document.getElementById(id);
  let seq = 0;

  const tc = s => String(s || '').toLowerCase().replace(/(^|[\s'’(-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
  function raceTitle(n) {
    let s = String(n || '').replace(/\s+/g, ' ').trim();
    s = s.replace(/^(\d+)\s*[°^º]?\s+/, '$1° ');
    s = s.replace(/\s+\d+\s*[°^º]?\s+(TROFEO|MEMORIAL|GRAN PREMIO|GP|COPPA)\b.*$/i, '');
    s = tc(s).replace(/\b(Di|Del|Della|Delle|Dei|Degli|Da|De|E|In)\b/g, m => m.toLowerCase()).replace(/\bGp\b/g, 'GP');
    return s.replace(/^(\d+)° /, '$1° ');
  }
  const bandOf = code => String(code || 'ELI_M').replace(/_[MF]$/, '').replace(/^ES\d$/, 'ES');
  const colOf = code => String(code).endsWith('_F') ? F_COLOR : (BAND_COLOR[bandOf(code)] || BAND_COLOR.ELI);
  function cover(code) {
    const c = colOf(code), id = 'rsg' + (++seq);
    return `<svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset="1" stop-color="${c[1]}"/></linearGradient></defs><rect width="400" height="240" fill="url(#${id})"/><path d="M-20 240 L150 118 Q205 78 330 92 L420 98 L420 240 Z" fill="rgba(0,0,0,.28)"/><path d="M40 240 L180 128 Q215 100 300 108" stroke="rgba(255,255,255,.55)" stroke-width="3" fill="none" stroke-dasharray="14 12"/></svg>`;
  }
  function dayLong(iso) { const d = new Date(iso + 'T00:00:00'); return `${GG[d.getDay()]} ${d.getDate()} ${MESIL[d.getMonth()]} ${d.getFullYear()}`; }
  function dayShort(iso) { const p = String(iso).split('-'); return `${+p[2]} ${MESI[+p[1] - 1]}`; }
  const getView = () => { try { return localStorage.getItem('ris-view') === 'list' ? 'list' : 'card'; } catch { return 'card'; } };
  function setView(v) { try { localStorage.setItem('ris-view', v); } catch {} }

  /* ---------- dati di una categoria: primi 3 con distacco ---------- */
  function podium(rows) {
    const sorted = rows.slice().sort((a, b) => a.posizione - b.posizione).slice(0, 3);
    const f = sorted[0] || {};
    const km = parseFloat(f.km), md = parseFloat(f.media);
    let time = '';
    if (km > 0 && md > 0) { const s = Math.round(km / md * 3600); time = `${Math.floor(s / 3600)}h ${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}′ ${String(s % 60).padStart(2, '0')}″`; }
    return sorted.map(r => {
      const gap = r.posizione === 1 ? time : (r.tempo ? '+' + String(r.tempo).replace(/^a\s*/, '').replace(/'/g, '′').replace(/"/g, '″') : 's.t.');
      const cr = (typeof _regionalChampionByGara !== 'undefined' ? (_regionalChampionByGara[r.gara_id] || []) : []).some(t => t.atleta_id === r.atleta_id);
      return { pos: r.posizione, nome: tc(`${r.cognome} ${r.nome}`), id: r.atleta_id, gap, cr };
    });
  }
  const top3Html = list => `<ol class="hx-top3">${list.map(t => `<li><i class="hx-med p${t.pos}">${t.pos}</i>${t.id ? `<a class="nm" href="/atleta/${esc(t.id)}">${esc(t.nome)}${t.cr ? ' 🥇' : ''}</a>` : `<span class="nm">${esc(t.nome)}</span>`}<span class="g">${esc(t.gap)}</span></li>`).join('')}</ol>`;

  const shareBtn = id => id ? `<button class="rs-sh" type="button" title="Condividi risultati" aria-label="Condividi risultati" onclick="event.stopPropagation();window.quickShareGara('${esc(id)}')"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>` : '';

  function tierBadges(race) {
    const out = [];
    if (race.campionato_italiano) out.push('<span class="rs-bd ci">CAMP. ITALIANO</span>');
    else if (race.campionato_regionale) out.push('<span class="rs-bd cr">CAMP. REGIONALE</span>');
    else if ((race.mult || 1) >= 2) out.push(`<span class="rs-bd m${race.mult >= 3 ? 3 : 2}">×${race.mult}</span>`);
    return out.join('');
  }

  /* ---------- media di una gara (foto in cache, video da globalData) ---------- */
  function mediaOf(race, ctx) {
    const cats = Object.values(race.byCategory || {});
    const gmap = globalData.garaToCalId || {};
    const calId = gmap[race.id] || toCalId(race.id);
    const vids = (globalData.videos || {})[calId] || (globalData.videos || {})[race.id] || [];
    const photo = cats.map(c => ctx.photosMap[c.gara_id] || ctx.photosMap[gmap[c.gara_id]] || ctx.photosMap[toCalId(c.gara_id)]).find(Boolean) || ctx.photosMap[race.id] || null;
    const src = photo ? (photo.url ? icProxy(photo.url) : (photo.filename ? `${PHOTOS_BASE}/photos/${photo.filename}` : '')) : '';
    const v0 = vids[0] || null, kind = v0 ? videoKind(v0.url) : null;
    const ytThumb = kind === 'yt' ? `https://img.youtube.com/vi/${ytId(v0.url)}/hqdefault.jpg` : '';
    return { src: src || ytThumb, hasPhoto: !!src, vids: vids.length, live: !!(v0 && v0.is_live), has: !!(src || vids.length) };
  }

  function mediaBlock(code, m) {
    return `<div class="hx-rk-m">${cover(code)}${m.src ? `<img src="${esc(m.src)}" alt="" loading="lazy" onerror="this.remove()">` : ''}${!m.hasPhoto && m.vids ? '<span class="hx-play">▶</span>' : ''}<div class="hx-chips">${m.hasPhoto ? '<span>📷</span>' : ''}${m.vids ? `<span>▶ ${m.vids}</span>` : ''}${m.live ? '<span style="background:#E3182D">DIRETTA</span>' : ''}</div></div>`;
  }

  /* ---------- card gara ---------- */
  function cardHtml(race, ctx) {
    const cal = ctx.calById[(globalData.garaToCalId || {})[race.id] || toCalId(race.id)] || ctx.calById[race.id] || null;
    const luogo = cal ? (cal.luogo || cal.regione || '') : (race.regione || '');
    const href = `/gara/${esc(race.id)}`;
    if (race._pending) {
      const m = mediaOf(race, ctx), code = race._categoriaLabel || '';
      const isToday = race.data === ctx.today;
      const spine = `<div class="hx-spine" style="--sp:#94A3B8"></div>`;
      const pcs = race._pcsResults ? (() => {
        const t3 = race._pcsResults.slice().sort((a, b) => a.posizione - b.posizione).slice(0, 3).map(r => {
          const parts = (r.rider_name || '').trim().split(/\s+/);
          const nome = parts.length > 1 ? parts.pop() : '';
          return { pos: r.posizione, nome: tc(`${parts.join(' ') || r.rider_name || ''} ${nome}`), id: r.atleta_id, gap: '' };
        });
        return top3Html(t3);
      })() : `<div class="rs-wait">${isToday ? 'Risultati non ancora disponibili. Sei in gara o hai una foto dell’ordine d’arrivo?' : 'Nessun risultato trovato per questa gara.'}</div>`;
      return `<div class="hx-rk ${m.has ? '' : 'nomedia'} rs-pend-card" data-href="${href}"${isToday ? ' data-pend="1"' : ''}>${m.has ? mediaBlock('ELI_M', m) : spine}<div class="hx-rk-b"><div class="hx-rk-h"><span class="hx-bd ${isToday ? 'hot' : ''}">${isToday ? 'OGGI' : dayShort(race.data).toUpperCase()}</span>${code ? `<span>${esc(tc(code))}</span>` : ''}${tierBadges(race)}</div><h3><a href="${href}">${esc(raceTitle(race.nome))}</a></h3><div class="hx-loc">${esc(tc(luogo))}</div>${pcs}</div></div>`;
    }
    const cats = Object.entries(race.byCategory || {});
    const firstCode = cats[0] ? cats[0][0] : 'ELI_M';
    const m = mediaOf(race, ctx);
    const first = cats[0] && cats[0][1].results && cats[0][1].results[0] || {};
    const km = parseFloat(first.km) > 0 ? Math.round(parseFloat(first.km)) : '';
    const multi = cats.length > 1;
    const body = cats.map(([code, cd]) => `${multi ? `<div class="rs-catl">${esc(catLabel(code) || code)}</div>` : ''}${top3Html(podium(cd.results || []))}`).join('');
    const col = colOf(firstCode)[0];
    window._risShareCache = window._risShareCache || {};
    return `<div class="hx-rk ${m.has ? '' : 'nomedia'}" data-href="${href}">${m.has ? mediaBlock(firstCode, m) : `<div class="hx-spine" style="--sp:${col}"></div>`}<div class="hx-rk-b"><div class="hx-rk-h">${tierBadges(race)}<span>${esc(multi ? cats.map(c => catLabel(c[0]) || c[0]).join(' · ') : (catLabel(firstCode) || firstCode))}</span>${km ? `<span>·</span><span class="num">${km} km</span>` : ''}${shareBtn(cats[0] && cats[0][1].gara_id)}</div><h3><a href="${href}">${esc(raceTitle(race.nome))}</a></h3><div class="hx-loc">${esc(tc(luogo))}</div>${body}</div></div>`;
  }

  /* ---------- riga lista ---------- */
  function rowsHtml(race, ctx) {
    const href = `/gara/${esc(race.id)}`;
    const cal = ctx.calById[(globalData.garaToCalId || {})[race.id] || toCalId(race.id)] || ctx.calById[race.id] || null;
    const luogo = tc(cal ? (cal.luogo || cal.regione || '') : (race.regione || ''));
    const name = `<a href="${href}">${esc(raceTitle(race.nome))}</a><br><small>${esc(luogo)}</small>`;
    if (race._pending) return `<tr data-href="${href}"><td>${name}</td><td>${esc(tc(race._categoriaLabel || ''))}</td><td>${tierBadges(race)}</td><td colspan="3" class="rs-wait">${race.data === ctx.today ? 'In attesa dei risultati' : 'Nessun risultato'}</td><td></td></tr>`;
    const m = mediaOf(race, ctx);
    return Object.entries(race.byCategory || {}).map(([code, cd]) => {
      const p = podium(cd.results || []);
      const cell = i => p[i] ? `<span class="rs-w"><i class="hx-med p${p[i].pos}">${p[i].pos}</i>${p[i].id ? `<a href="/atleta/${esc(p[i].id)}">${esc(p[i].nome)}</a>` : esc(p[i].nome)}</span>` : '—';
      return `<tr data-href="${href}"><td>${name}</td><td>${esc(catLabel(code) || code)}</td><td>${tierBadges(race)}</td><td>${cell(0)}</td><td>${cell(1)}</td><td>${cell(2)}</td><td>${m.hasPhoto ? '📷 ' : ''}${m.vids ? '▶ ' + m.vids : ''}</td></tr>`;
    }).join('');
  }
  const tableHead = '<thead><tr><th>Gara</th><th>Categoria</th><th>Valore</th><th>1°</th><th>2°</th><th>3°</th><th>Media</th></tr></thead>';

  /* ---------- elenco raggruppato per giorno ---------- */
  function listHtml(visible, all, ctx, renderOne, renderRow) {
    const counts = {};
    all.forEach(r => { counts[r.data] = (counts[r.data] || 0) + 1; });
    const list = getView() === 'list';
    let html = '', day = null, buf = [];
    const flush = () => {
      if (day === null) return;
      const n = counts[day] || buf.length;
      html += `<section><div class="rs-dayh"><h2>${esc(dayLong(day))}</h2><small>${n} gar${n === 1 ? 'a' : 'e'}</small><span class="line"></span></div>` +
        (list ? `<div class="rs-tbl"><table>${tableHead}<tbody>${buf.map(renderRow).join('')}</tbody></table></div>` : `<div class="hx-rlist">${buf.map(renderOne).join('')}</div>`) + '</section>';
      buf = [];
    };
    for (const r of visible) { if (r.data !== day) { flush(); day = r.data; } buf.push(r); }
    flush();
    return html;
  }

  /* ---------- gara storica (ciclismo.info) ---------- */
  function histCard(ev) {
    const href = `/gara/CIC_${esc(ev.id)}`;
    const cats = Object.entries(ev.categorie || {}).filter(([, t]) => t.length);
    const multi = cats.length > 1;
    const first = cats[0] ? cats[0][0] : '';
    const body = cats.map(([c, t]) => `${multi ? `<div class="rs-catl">${esc(String(c).replace(/_/g, ' '))}</div>` : ''}${top3Html(t.slice(0, 3).map(r => ({ pos: r.posizione, nome: tc(r.nome_completo || ''), id: r.atleta_id, gap: '' })))}`).join('');
    const photo = ev.photo_url ? mediaUrl(ev.photo_url) : '';
    const code = /DONNE|DONNA/i.test(first) ? 'ELI_F' : 'ELI_M';
    return `<div class="hx-rk ${photo ? '' : 'nomedia'}" data-href="${href}">${photo ? `<div class="hx-rk-m">${cover(code)}<img src="${esc(photo)}" alt="" loading="lazy" onerror="this.remove()"><div class="hx-chips"><span>📷</span></div></div>` : '<div class="hx-spine" style="--sp:#64748B"></div>'}<div class="hx-rk-b"><div class="hx-rk-h"><span>${esc(multi ? cats.map(c => String(c[0]).replace(/_/g, ' ')).join(' · ') : String(first).replace(/_/g, ' '))}</span></div><h3><a href="${href}">${esc(raceTitle(ev.nome))}</a></h3><div class="hx-loc">${esc(tc(ev.regione || ''))}</div>${body}</div></div>`;
  }
  function histRows(ev) {
    const href = `/gara/CIC_${esc(ev.id)}`;
    return Object.entries(ev.categorie || {}).filter(([, t]) => t.length).map(([c, t]) => {
      const cell = i => t[i] ? `<span class="rs-w"><i class="hx-med p${t[i].posizione}">${t[i].posizione}</i>${esc(tc(t[i].nome_completo || ''))}</span>` : '—';
      return `<tr data-href="${href}"><td><a href="${href}">${esc(raceTitle(ev.nome))}</a><br><small>${esc(tc(ev.regione || ''))}</small></td><td>${esc(String(c).replace(/_/g, ' '))}</td><td></td><td>${cell(0)}</td><td>${cell(1)}</td><td>${cell(2)}</td><td>${ev.photo_url ? '📷' : ''}</td></tr>`;
    }).join('');
  }

  /* ---------- guscio della pagina ---------- */
  function shellHtml(o) {
    const opt = (v, l, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
    const sel = (id, fn, label, inner) => `<label class="hx-sel"><span class="sr">${label}</span><select id="${id}" onchange="window.${fn}(this.value)" aria-label="${label}"><option value="">${label}</option>${inner}</select></label>`;
    const years = []; for (let y = o.curYear; y >= 2007; y--) years.push(y);
    const seg = (v, l) => `<button type="button" data-g="${v}" onclick="window.risSetGenere('${v}')" aria-pressed="${o.genere === v}">${l}</button>`;
    return `<div class="hx-wrap rs-wrap">
      <div class="rs-head"><h1>Risultati</h1><span class="rs-cnt" id="ris-count"></span>
        <div class="rs-right"><label class="hx-sel"><span class="sr">Stagione</span><select id="ris-sel-year" onchange="window.risSetYear(Number(this.value))" aria-label="Stagione">${years.map(y => `<option value="${y}"${y === o.curYear ? ' selected' : ''}>Stagione ${y}</option>`).join('')}</select></label>
        <div class="hx-seg" role="group" aria-label="Vista"><button type="button" id="ris-v-card" onclick="window.RisV2.setView('card')" aria-pressed="${getView() === 'card'}">Card</button><button type="button" id="ris-v-list" onclick="window.RisV2.setView('list')" aria-pressed="${getView() === 'list'}">Lista</button></div></div></div>
      <div id="ris-live"></div>
      <div class="rs-bar" role="search">
        <div class="hx-seg" id="ris-seg-genere" role="group" aria-label="Genere">${seg('', 'Tutti')}${seg('M', 'Uomini')}${seg('F', 'Donne')}</div>
        <input type="search" id="ris-search-input" class="rs-search" placeholder="Cerca gara o regione…" aria-label="Cerca" oninput="window.risSetSearch(this.value)" autocomplete="off">
        ${sel('ris-sel-month', 'risSetMonth', 'Tutti i mesi', ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((m, i) => `<option value="${m}">${MESIL[i][0].toUpperCase() + MESIL[i].slice(1)}</option>`).join(''))}
        ${sel('ris-sel-cat', 'risSetCat', 'Tutte le categorie', '')}
        ${sel('ris-sel-region', 'risSetRegion', 'Tutte le regioni', o.regions.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join(''))}
        ${sel('ris-sel-tipo', 'risSetTipo', 'Tutti i tipi', '<option value="regionale">Regionali ×1</option><option value="nazionale">Nazionali ×2</option><option value="internazionale">Internazionali ×3</option><option value="campionato_regionale">Campionati Regionali</option><option value="campionato_italiano">Campionati Italiani</option><option value="tipo_pista">Tipo Pista</option>')}
        <button class="rs-miss" id="ris-missing-toggle" type="button" onclick="window.risToggleMissing()" aria-pressed="${o.missing}">⚠ Gare senza risultati</button>
      </div>
      <div id="ris-pend"></div>
      <div class="hx-layout"><div class="hx-col" id="ris-cards"></div><aside class="hx-col" id="ris-side"></aside></div>
    </div>`;
  }

  /* ---------- colonna destra ---------- */
  function sideHtml(o) {
    const cal = o.upcoming.map(g => { const p = String(g.data).split('-'); return `<a class="hx-calr" href="/calendario"><div class="d num">${p[2]}<small>${MESI[+p[1] - 1]}</small></div><div class="t">${esc(raceTitle(g.nome))}<small>${esc(tc(g.luogo || g.regione || ''))}</small></div><span class="hx-pill">${esc(tc(g.categoria || '').replace(/ E /g, ' · '))}</span></a>`; }).join('');
    return `<section class="hx-panel"><div class="hx-ph"><h2>Ultimo weekend</h2></div><div class="rs-kv"><span>Gare con risultati</span><b>${o.weekend}</b><span>Gare di oggi in attesa</span><b>${o.pending}</b></div></section>
      <section class="hx-panel"><div class="hx-ph"><h2>Prossime gare</h2><a href="/calendario">Calendario →</a></div>${cal || '<div class="hx-none">Nessuna gara in programma</div>'}</section>`;
  }

  /* ---------- lettore dirette ---------- */
  let liveSig = '|', liveItems = [], liveCur = 0, livePlaying = false, liveTimer = null, liveFetched = 0, livePoll = null;
  function liveStop() { clearTimeout(liveTimer); liveTimer = null; }
  function liveTick() {
    liveStop();
    if (liveItems.length < 2 || livePlaying) return;
    liveTimer = setTimeout(() => { if (!$('ris-live')) return; liveCur = (liveCur + 1) % liveItems.length; liveDraw(); }, 8000);
  }
  function liveDraw() {
    const el = $('ris-live'); if (!el) { liveStop(); return; }
    if (!liveItems.length) { el.innerHTML = ''; return; }
    const c = liveItems[liveCur] || liveItems[0], many = liveItems.length > 1;
    const calId = c.gara_id;
    el.innerHTML = `<div class="rs-stage${many ? '' : ' one'}${livePlaying ? ' paused' : ''}" id="rs-stg"><div class="vid" id="rs-vid">
        <img src="https://img.youtube.com/vi/${esc(c.video_id)}/hqdefault.jpg" alt="">
        <span class="bdg"><i></i>IN DIRETTA</span><button class="pl" type="button" aria-label="Guarda la diretta" onclick="window.RisV2.play()">▶</button>
        <div class="cap"><b>${esc(c.title || '')}</b><small>${esc(c.channel || 'YouTube')} · <a href="/gara/${esc(calId)}">Vai alla gara →</a></small></div></div>
      ${many ? `<div class="lst">${liveItems.map((l, i) => `<button class="it" type="button" onclick="window.RisV2.pick(${i})" aria-current="${i === liveCur}"><b>${esc(l.title || '')}</b><small>${esc(l.channel || '')}</small><span class="pg"></span></button>`).join('')}</div>` : ''}</div>`;
    liveTick();
  }
  async function liveRefresh(force) {
    if (!$('ris-live')) return;
    if (!force && Date.now() - liveFetched < 45000) return;
    liveFetched = Date.now();
    let d; try { const r = await fetch(`${API_BASE}/live-now`); if (!r.ok) return; d = await r.json(); } catch { return; }
    if (!$('ris-live')) return;
    const items = [d.live, d.liveSecond].filter(x => x && x.video_id);
    const sig = items.map(i => i.video_id).join(',');
    if (sig === liveSig) { if (!$('ris-live').firstChild && items.length) liveDraw(); return; }
    if (livePlaying && items.some(i => i.video_id === (liveItems[liveCur] || {}).video_id)) { liveItems = items; liveSig = sig; liveCur = items.findIndex(i => i.video_id === (liveItems[liveCur] || {}).video_id); return; }
    liveSig = sig; liveItems = items; liveCur = 0; livePlaying = false;
    liveDraw();
  }
  function liveStart() {
    liveRefresh(false);
    if (!livePoll) livePoll = setInterval(() => { if (!$('ris-live')) { clearInterval(livePoll); livePoll = null; liveStop(); liveSig = '|'; return; } liveRefresh(true); }, 60000);
  }

  window.RisV2 = {
    cardHtml, rowsHtml, listHtml, histCard, histRows, shellHtml, sideHtml, liveStart, getView, dayShort,
    setView(v) {
      setView(v);
      const a = $('ris-v-card'), b = $('ris-v-list');
      if (a) a.setAttribute('aria-pressed', String(v === 'card'));
      if (b) b.setAttribute('aria-pressed', String(v === 'list'));
      _risHistoricalYear ? renderRisultatiStorico(_risHistoricalYear) : renderRisultati();
    },
    play() {
      const c = liveItems[liveCur]; const v = $('rs-vid'); if (!c || !v) return;
      livePlaying = true; liveStop();
      const s = $('rs-stg'); if (s) s.classList.add('paused');
      v.innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(c.video_id)}?autoplay=1&rel=0" title="${esc(c.title || 'Diretta')}" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    },
    syncShell(o) {
      document.querySelectorAll('#ris-seg-genere button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.g || '') === (o.genere || ''))));
      const m = $('ris-missing-toggle'); if (m) m.setAttribute('aria-pressed', String(!!o.missing));
      const y = $('ris-sel-year'); if (y && o.year) y.value = String(o.year);
    },
    loadMoreHtml(n) { return n > 0 ? `<button class="rs-more" type="button" onclick="window.risLoadMore()">Carica altre gare (${n})</button>` : ''; },
    pick(i) { liveCur = i; livePlaying = false; liveStop(); liveDraw(); liveStop(); const s = $('rs-stg'); if (s) s.classList.add('paused'); },
  };

  // click sull'intera card/riga = apre la gara (i link e i pulsanti interni vanno per conto loro)
  document.addEventListener('click', e => {
    const h = e.target.closest && e.target.closest('#ris-cards [data-href]');
    if (!h || e.target.closest('a, button')) return;
    navTo(h.getAttribute('data-href'));
  });
})();
