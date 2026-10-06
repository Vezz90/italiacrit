/* ============================================================
   ICS — pagine ATLETI e TEAM (elenchi), stile Home/Risultati.
   Due pagine separate: ordine alfabetico (a gruppi per lettera),
   i 3 leader della categoria in alto, posizione in classifica come
   etichetta, ordinabile per punti/vittorie/gare. Usa lo stato e le
   funzioni di app.js (atlGender/atlCat/atlSearch, teamGender/teamCat/
   teamSearch, setPage, catLabel, getEntityOverrides, …).
   ============================================================ */
'use strict';

(function () {
  const CATS_M = ['ES1_M', 'ES2_M', 'AL_M', 'JUN_M', 'ELI_M'];
  const CATS_F = ['ES1_F', 'ES2_F', 'AL_F', 'JUN_F', 'ELI_F'];
  const COL = ['#2459E6', '#0E8F7E', '#C2670C', '#7C3AED', '#D6336C', '#0B1B3A'];
  const PODC = [['#C99400', '#5A3F00'], ['#6E7A90', '#2A3342'], ['#B26A2C', '#4A2A0E']];
  const $ = id => document.getElementById(id);
  let followsLoaded = false;
  const ui = { atl: { sort: 'az', n: 60, all: false }, team: { sort: 'az', n: 60 } };

  const tc = s => String(s || '').toLowerCase().replace(/(^|[\s'’(-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase()).replace(/(?<![A-Za-z])(?:[A-Za-z]\.)+(?![A-Za-z]{2})[A-Za-z]?/g, m => m.toUpperCase());
  const ini = n => { const p = String(n || '').trim().split(/\s+/); return ((p[0] || '?')[0] + ((p[1] || '')[0] || '')).toUpperCase(); };
  const colOf = s => { let h = 0; s = String(s || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997; return COL[h % COL.length]; };
  const dm = iso => { const p = String(iso || '').split('-'); return p.length > 2 ? `${p[2]}/${p[1]}` : ''; };
  const sexLbl = c => String(c).endsWith('_F') ? 'donne' : 'uomini';

  /* ---------- statistiche dalla stagione caricata ---------- */
  function seasonStats(cat) {
    const A = {}, T = {};
    const cut = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
    for (const r of globalData.resultsRaw) {
      if (getRankingFileCode(r) !== cat) continue;
      const pts = r.punti_effettivi || 0;
      if (r.atleta_id) {
        const a = A[r.atleta_id] || (A[r.atleta_id] = { g: 0, w: 0, p: 0, last: '', hot: 0, nome: `${r.cognome} ${r.nome}`, team: r.team });
        a.g++; if (r.posizione === 1) a.w++; if (r.posizione <= 3) a.p++; if (r.data > a.last) a.last = r.data; if (r.data >= cut) a.hot += pts;
      }
      if (r.team_id) {
        const t = T[r.team_id] || (T[r.team_id] = { ath: new Set(), gare: new Set(), w: 0, best: {} });
        if (r.atleta_id) { t.ath.add(r.atleta_id); t.best[r.atleta_id] = (t.best[r.atleta_id] || 0) + pts; }
        t.gare.add(r.gara_id); if (r.posizione === 1) t.w++;
      }
    }
    return { A, T };
  }

  /* ---------- foto/logo caricati in differita ---------- */
  async function fillImages(root) {
    const spans = [...root.querySelectorAll('[data-aid],[data-tid]')];
    for (let i = 0; i < spans.length; i += 8) {
      if (!document.contains(root)) return;
      await Promise.all(spans.slice(i, i + 8).map(async el => {
        const isA = el.hasAttribute('data-aid'), id = el.getAttribute(isA ? 'data-aid' : 'data-tid');
        const ov = await getEntityOverrides(isA ? 'atleta' : 'team', id).catch(() => ({}));
        if (!ov.photo_url || !document.contains(el)) return;
        const img = document.createElement('img');
        img.src = mediaUrl(ov.photo_url); img.alt = ''; img.loading = 'lazy';
        img.onerror = () => img.remove();
        el.appendChild(img);
      }));
    }
  }
  async function fillFollow(root, type) {
    try { if (!followsLoaded && typeof authUser === 'function' && authUser()) { followsLoaded = true; await _loadFollows(); } } catch {}
    root.querySelectorAll('.el-fol[data-fid]').forEach(sp => { try { _injectFollowBtn(sp.id, type, sp.getAttribute('data-fid')); } catch {} });
  }

  /* ---------- guscio ---------- */
  function shell(kind) {
    const A = kind === 'atl';
    const g = A ? atlGender : teamGender, cat = A ? atlCat : teamCat, q = A ? atlSearch : teamSearch;
    const cats = g === 'M' ? CATS_M : CATS_F;
    const setG = A ? 'setAtlGender' : 'setTeamGender', setC = A ? 'setAtlCat' : 'setTeamCat', setQ = A ? 'setAtlSearch' : 'setTeamSearch';
    const sortOpts = A
      ? [['az', 'A–Z'], ['pts', 'Punti'], ['w', 'Vittorie'], ['g', 'Gare']]
      : [['az', 'A–Z'], ['pts', 'Punti'], ['w', 'Vittorie'], ['ath', 'Atleti']];
    return `<div class="hx-wrap el-wrap">
      <div class="rs-head"><h1>${A ? 'Atleti' : 'Team'}</h1><span class="rs-cnt" id="el-count"></span>
        <div class="rs-right"><span class="hx-pill">Stagione ${esc(String(_loadedSeasonYear()))}</span></div></div>
      <div class="rs-bar" role="search">
        <div class="hx-seg" role="group" aria-label="Genere"><button type="button" onclick="${setG}('M')" aria-pressed="${g === 'M'}">Uomini</button><button type="button" onclick="${setG}('F')" aria-pressed="${g === 'F'}">Donne</button></div>
        <label class="hx-sel"><span class="sr">Categoria</span><select aria-label="Categoria" onchange="${setC}(this.value)">${cats.map(c => `<option value="${c}"${c === cat ? ' selected' : ''}>${esc(catLabel(c))}</option>`).join('')}</select></label>
        <input type="search" class="rs-search" placeholder="${A ? 'Cerca atleta per nome, cognome o team…' : 'Cerca team per nome…'}" value="${esc(q)}" oninput="window.${setQ}(this.value)" aria-label="Cerca" autocomplete="off">
        ${A ? `<label class="hx-sel"><span class="sr">Quali atleti</span><select aria-label="Quali atleti" onchange="window.ElV2.scope(this.value)"><option value="act"${ui.atl.all ? '' : ' selected'}>Attivi in stagione</option><option value="all"${ui.atl.all ? ' selected' : ''}>Tutto l’archivio</option></select></label>` : ''}
        <label class="hx-sel"><span class="sr">Ordina</span><select aria-label="Ordina" onchange="window.ElV2.sort('${kind}',this.value)">${sortOpts.map(o => `<option value="${o[0]}"${ui[kind].sort === o[0] ? ' selected' : ''}>Ordina: ${o[1]}</option>`).join('')}</select></label>
      </div>
      <div class="hx-layout"><div class="hx-col"><section id="el-lead"></section><section><div id="el-list" class="el-tbl"></div><div id="el-more"></div></section></div>
        <aside class="hx-col" id="el-side"></aside></div></div>`;
  }

  function leadHtml(items) {
    if (!items.length) return '';
    return `<div class="hx-ph"><h2>${items[0].isT ? 'Le squadre in testa' : 'I leader della categoria'}</h2></div><div class="el-pod">${items.map((x, i) => `<a class="el-pc" href="${x.href}" style="--c1:${PODC[i][0]};--c2:${PODC[i][1]}"><span class="rk">${i + 1}</span><div class="av" ${x.isT ? `data-tid="${esc(x.id)}"` : `data-aid="${esc(x.id)}"`}>${esc(ini(x.nome))}</div><b>${esc(tc(x.nome))}</b><small>${esc(x.sub)}</small><div class="pt">${x.pts} <span>punti</span></div></a>`).join('')}</div>`;
  }

  /* ---------- ATLETI ---------- */
  function atletiData() {
    const { A } = seasonStats(atlCat);
    const all = Object.values(globalData.athletes).filter(a => a.categoria === atlCat).map(a => {
      const aid = a.id || a.atleta_id, s = A[aid] || { g: 0, w: 0, p: 0, last: '', hot: 0 };
      return { id: aid, nome: `${a.cognome || ''} ${a.nome || ''}`.trim(), cognome: a.cognome || '', team: a.team_attuale || '', team_id: a.team_id || '', pts: a.punti_totali || 0, g: s.g, w: s.w, p: s.p, last: s.last, hot: s.hot };
    });
    const byPts = all.slice().sort((a, b) => b.pts - a.pts);
    byPts.forEach((a, i) => { a.rank = i + 1; });
    return { all, byPts };
  }
  function drawAtleti() {
    if (!$('el-list')) return;
    const { all, byPts } = atletiData(), q = atlSearch.toLowerCase().trim(), u = ui.atl;
    // di default solo chi ha punti o gare in stagione; cercando per nome si guarda in tutto l'archivio
    let L = all.filter(a => q ? `${a.nome} ${a.team}`.toLowerCase().includes(q) : (u.all || a.g > 0 || a.pts > 0));
    const cmp = { az: (a, b) => a.nome.localeCompare(b.nome, 'it'), pts: (a, b) => b.pts - a.pts || a.nome.localeCompare(b.nome, 'it'), w: (a, b) => b.w - a.w || b.pts - a.pts, g: (a, b) => b.g - a.g || b.pts - a.pts }[u.sort];
    L = L.sort(cmp);
    $('el-count').textContent = `${L.length} atleti in ${catLabel(atlCat)} ${sexLbl(atlCat)}${q ? '' : (u.all ? ' · tutto l’archivio' : ' attivi in stagione')}`;
    $('el-lead').innerHTML = leadHtml(byPts.filter(a => a.pts > 0).slice(0, 3).map(a => ({ id: a.id, nome: a.nome, sub: `${tc(a.team)} · ${a.w} vittorie`, pts: a.pts, href: `/atleta/${esc(a.id)}` })));
    let prev = '', rows = '';
    L.slice(0, u.n).forEach(a => {
      const l = (a.cognome[0] || '#').toUpperCase();
      if (u.sort === 'az' && l !== prev) { prev = l; rows += `<div class="el-letter" id="el-L-${esc(l)}">${esc(l)}</div>`; }
      rows += `<div class="el-tr" data-href="/atleta/${esc(a.id)}"><span class="el-rkb">#${a.rank}</span>
        <div class="el-who"><span class="el-av" data-aid="${esc(a.id)}" style="background:${colOf(a.id)}">${esc(ini(a.nome))}</span><div><b>${esc(a.nome)}</b><small>${a.last ? 'ultima gara ' + dm(a.last) : 'nessuna gara in stagione'}</small></div></div>
        <span class="el-tm">${a.team_id ? `<a href="/team/${esc(a.team_id)}">${esc(tc(a.team))}</a>` : esc(tc(a.team))}</span>
        <span class="el-pts">${a.pts}</span><span class="el-n">${a.g}</span><span class="el-n win">${a.w}</span><span class="el-n">${a.p}</span>
        <span class="el-fol" id="el-f-${esc(a.id)}" data-fid="${esc(a.id)}"><button class="follow-pill" type="button" onclick="event.stopPropagation();window.toggleFollow('atleta','${esc(a.id)}','el-f-${esc(a.id)}')">☆ Segui</button></span>
        <span class="el-st"><span>${a.g} gare</span><span>${a.w} vitt.</span><span>${a.p} podi</span></span></div>`;
    });
    $('el-list').innerHTML = `<div class="el-thead"><span>Class.</span><span>Atleta</span><span>Team attuale</span><span class="n">Punti</span><span class="n">Gare</span><span class="n">Vitt.</span><span class="n">Podi</span><span></span></div>${rows || '<div class="hx-empty">Nessun atleta trovato in questa categoria</div>'}`;
    $('el-more').innerHTML = L.length > u.n ? `<button class="rs-more" type="button" onclick="window.ElV2.more('atl')">Mostra altri atleti (${L.length - u.n})</button>` : '';
    const hot = all.filter(a => a.hot > 0).sort((a, b) => b.hot - a.hot).slice(0, 5);
    const letters = [...new Set(all.map(a => (a.cognome[0] || '').toUpperCase()).filter(Boolean))].sort();
    $('el-side').innerHTML = `<section class="hx-panel"><div class="hx-ph"><h2>Hot rider · 14 giorni</h2></div>${hot.map((h, i) => `<a class="el-li" href="/atleta/${esc(h.id)}"><span class="p">${i + 1}</span><div><b>${esc(tc(h.nome))}</b><small>${esc(tc(h.team))}</small></div><span class="up">${h.hot} pt</span></a>`).join('') || '<div class="hx-none">Nessun risultato negli ultimi 14 giorni</div>'}</section>
      <section class="hx-panel"><div class="hx-ph"><h2>Cerca per iniziale</h2></div><div class="el-az">${letters.map(l => `<a href="#" onclick="return window.ElV2.jump('${esc(l)}')">${esc(l)}</a>`).join('')}</div></section>`;
    fillImages($('el-lead')); fillImages($('el-list')); fillFollow($('el-list'), 'atleta');
  }

  /* ---------- TEAM ---------- */
  function teamData() {
    const { T } = seasonStats(teamCat);
    const all = Object.values(globalData.teams).filter(t => t.punti_per_cat && t.punti_per_cat[teamCat]).map(t => {
      const s = T[t.id] || { ath: new Set(), gare: new Set(), w: 0, best: {} };
      const b = Object.entries(s.best).sort((x, y) => y[1] - x[1])[0];
      return { id: t.id, nome: t.nome || '', pts: t.punti_per_cat[teamCat] || 0, ath: s.ath.size || (t.atleti ? t.atleti.length : 0), w: s.w, g: s.gare.size, best: b ? { id: b[0], pts: b[1] } : null };
    });
    const byPts = all.slice().sort((a, b) => b.pts - a.pts);
    byPts.forEach((t, i) => { t.rank = i + 1; });
    return { all, byPts };
  }
  function drawTeam() {
    if (!$('el-list')) return;
    const { all, byPts } = teamData(), q = teamSearch.toLowerCase().trim(), u = ui.team;
    let L = all.filter(t => !q || t.nome.toLowerCase().includes(q));
    const cmp = { az: (a, b) => a.nome.localeCompare(b.nome, 'it'), pts: (a, b) => b.pts - a.pts, w: (a, b) => b.w - a.w || b.pts - a.pts, ath: (a, b) => b.ath - a.ath || b.pts - a.pts }[u.sort];
    L = L.sort(cmp);
    $('el-count').textContent = `${L.length} team in ${catLabel(teamCat)} ${sexLbl(teamCat)}`;
    $('el-lead').innerHTML = leadHtml(byPts.slice(0, 3).map(t => ({ isT: true, id: t.id, nome: t.nome, sub: `${t.ath} atleti · ${t.w} vittorie`, pts: t.pts, href: `/team/${esc(t.id)}` })));
    let prev = '', rows = '';
    const bestName = id => { const a = globalData.athletes[id]; return a ? tc(`${a.cognome} ${a.nome}`) : tc(String(id).replace(/_/g, ' ')); };
    L.slice(0, u.n).forEach(t => {
      const l = (t.nome.replace(/^[^A-Za-z0-9]+/, '')[0] || '#').toUpperCase();
      if (u.sort === 'az' && l !== prev) { prev = l; rows += `<div class="el-letter" id="el-L-${esc(l)}">${esc(l)}</div>`; }
      rows += `<div class="el-tr t" data-href="/team/${esc(t.id)}"><span class="el-rkb">#${t.rank}</span>
        <div class="el-who"><span class="el-logo" data-tid="${esc(t.id)}" style="background:${colOf(t.id)}">${esc(ini(t.nome))}</span><div><b>${nationFlagPrefix(t.nome)}${esc(tc(t.nome))}</b><small>${t.g} gare a punti</small></div></div>
        <span class="el-tm">${t.best ? `<a href="/atleta/${esc(t.best.id)}">${esc(bestName(t.best.id))}</a> · ${t.best.pts} pt` : '—'}</span>
        <span class="el-pts">${t.pts}</span><span class="el-n">${t.ath}</span><span class="el-n win">${t.w}</span>
        <span class="el-fol" id="el-f-${esc(t.id)}" data-fid="${esc(t.id)}"><button class="follow-pill" type="button" onclick="event.stopPropagation();window.toggleFollow('team','${esc(t.id)}','el-f-${esc(t.id)}')">☆ Segui</button></span>
        <span class="el-st"><span>${t.ath} atleti</span><span>${t.w} vitt.</span></span></div>`;
    });
    $('el-list').innerHTML = `<div class="el-thead t"><span>Class.</span><span>Team</span><span>Miglior atleta</span><span class="n">Punti</span><span class="n">Atleti</span><span class="n">Vitt.</span><span></span></div>${rows || '<div class="hx-empty">Nessun team in questa categoria</div>'}`;
    $('el-more').innerHTML = L.length > u.n ? `<button class="rs-more" type="button" onclick="window.ElV2.more('team')">Mostra altri team (${L.length - u.n})</button>` : '';
    const top = all.slice().sort((a, b) => b.w - a.w || b.pts - a.pts).slice(0, 5).filter(t => t.w > 0);
    const letters = [...new Set(all.map(t => (t.nome.replace(/^[^A-Za-z0-9]+/, '')[0] || '').toUpperCase()).filter(Boolean))].sort();
    $('el-side').innerHTML = `<section class="hx-panel"><div class="hx-ph"><h2>Più vittorie</h2></div>${top.map((t, i) => `<a class="el-li" href="/team/${esc(t.id)}"><span class="p">${i + 1}</span><div><b>${esc(tc(t.nome))}</b><small>${t.ath} atleti</small></div><span class="up">${t.w} vitt.</span></a>`).join('') || '<div class="hx-none">Nessuna vittoria in stagione</div>'}</section>
      <section class="hx-panel"><div class="hx-ph"><h2>Cerca per iniziale</h2></div><div class="el-az">${letters.map(l => `<a href="#" onclick="return window.ElV2.jump('${esc(l)}')">${esc(l)}</a>`).join('')}</div></section>`;
    fillImages($('el-lead')); fillImages($('el-list')); fillFollow($('el-list'), 'team');
  }

  /* ---------- pagine ---------- */
  function fixCat(kind) {
    if (kind === 'atl') { if ((atlGender === 'M' && atlCat.endsWith('_F')) || (atlGender === 'F' && !atlCat.endsWith('_F'))) atlCat = atlGender === 'M' ? 'JUN_M' : 'ELI_F'; }
    else if ((teamGender === 'M' && teamCat.endsWith('_F')) || (teamGender === 'F' && !teamCat.endsWith('_F'))) teamCat = teamGender === 'M' ? 'JUN_M' : 'ELI_F';
  }
  window.ElV2 = {
    renderAtleti() {
      if (!globalData) return;
      fixCat('atl'); ui.atl.n = 60;
      setPageMeta('Atleti', 'Elenco atleti del ciclismo agonistico italiano: Esordienti, Allievi, Juniores, Under23, Elite — uomini e donne.');
      setPage(shell('atl'));
      window.filterAtletiList = () => { ui.atl.n = 60; drawAtleti(); };
      drawAtleti();
    },
    renderTeam() {
      if (!globalData) return;
      fixCat('team'); ui.team.n = 60;
      setPageMeta('Team', 'Elenco team e squadre del ciclismo agonistico italiano, con punti e corridori per categoria.');
      setPage(shell('team'));
      window.filterTeamList = () => { ui.team.n = 60; drawTeam(); };
      drawTeam();
    },
    scope(v) { ui.atl.all = v === 'all'; ui.atl.n = 60; drawAtleti(); },
    sort(kind, v) { ui[kind].sort = v; ui[kind].n = 60; kind === 'atl' ? drawAtleti() : drawTeam(); },
    more(kind) { ui[kind].n += 60; kind === 'atl' ? drawAtleti() : drawTeam(); },
    jump(l) {
      const el = $('el-L-' + l);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else { /* lettera oltre il blocco caricato: mostra tutto e riprova */
        const kind = $('el-list').querySelector('.el-tr.t') ? 'team' : 'atl';
        ui[kind].n = 99999; kind === 'atl' ? drawAtleti() : drawTeam();
        setTimeout(() => { const e = $('el-L-' + l); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
      }
      return false;
    },
  };

  document.addEventListener('click', e => {
    const h = e.target.closest && e.target.closest('#el-list [data-href]');
    if (!h || e.target.closest('a, button')) return;
    navTo(h.getAttribute('data-href'));
  });
})();
