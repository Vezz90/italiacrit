/* ============================================================
   ICS — Statistiche (Almanacco)
   Sala dei campioni, albo delle classifiche, dinastie dei team,
   record di sempre, anno per anno. Dati: data/almanacco.json
   (generato da scripts/build_almanacco.py sull'archivio 2007-2025).
   ============================================================ */
'use strict';

(function () {
  const SHORT = ['Esord. 1°', 'Esord. 2°', 'Allievi', 'Juniores', 'Elite U23', 'Donne Esord.', 'Donne Allieve', 'Donne Juniores'];
  const MEN = [4, 3, 2, 1, 0];     // ELITE, JUN, AL, ES2, ES1
  const WOMEN = [7, 6, 5];         // DONNE JUN, AL, ES
  // categoria archivio -> codice classifica nativa (stagione in corso)
  const NATIVE = { 0: 'ES1_M', 1: 'ES2_M', 2: 'AL_M', 3: 'JUN_M', 4: 'ELI_M', 6: 'AL_F', 7: 'JUN_F' };
  const st = { data: null, sex: 'M', live: null };

  const tc = s => String(s || '').toLowerCase().replace(/(^|[\s'’(-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
  const nm = n => tc(String(n || '').replace(/\s+/g, ' ').trim());
  const fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const link = (id, name) => id ? `<a href="/atleta/${encodeURIComponent(id)}">${esc(nm(name))}</a>` : esc(nm(name));

  async function loadData() {
    if (st.data) return st.data;
    st.data = await loadJson('data/almanacco.json');
    return st.data;
  }

  // Leader della stagione in corso (classifica nativa), per la riga "in corso" dell'albo
  async function loadLive() {
    if (st.live) return st.live;
    const out = {};
    await Promise.all(Object.entries(NATIVE).map(async ([ci, code]) => {
      try {
        const rk = await loadRanking(code);
        if (rk && rk[0]) out[ci] = { id: rk[0].atleta_id, n: `${rk[0].cognome || ''} ${rk[0].nome || ''}`.trim(), p: rk[0].punti };
      } catch (_) { /* ok */ }
    }));
    st.live = out;
    return out;
  }

  function kpis(d) {
    const races = d.racesPerYear.reduce((s, r) => s + r.n, 0);
    const tiles = [
      [d.to - d.from + 1, 'stagioni in archivio', `${d.from}–${d.to}`],
      [fmt(races), 'gare archiviate', 'con podio e classifiche'],
      [fmt(d.counts.athletes), 'atleti nel database', 'dal 2007 a oggi'],
      [fmt(d.counts.teams), 'squadre diverse', 'con le variazioni di nome'],
    ];
    return `<div class="am-kpis">${tiles.map(t => `<div class="am-kpi"><b>${t[0]}</b><span>${t[1]}</span><small>${t[2]}</small></div>`).join('')}</div>`;
  }

  function hallHtml(d) {
    const top = d.hall.filter(h => (h.titles[0][1] >= 5) === (st.sex === 'F')).slice(0, 6);
    const chips = h => h.titles.map(t => `<i title="${esc(SHORT[t[1]])} ${t[0]}">${t[0]} · ${SHORT[t[1]]}</i>`).join('');
    return `<section class="am-sec"><div class="hx-ph"><h2>Sala dei campioni</h2><small>Chi ha vinto più classifiche finali</small></div>
      <div class="am-hall">${top.map((h, i) => `<a class="am-champ" href="/atleta/${encodeURIComponent(h.id)}" style="--c1:${['#C99400', '#6E7A90', '#B26A2C'][i] || '#33415F'};--c2:${['#5A3F00', '#2A3342', '#4A2A0E'][i] || '#16213D'}">
        <span class="am-n">${h.titles.length}</span><b>${esc(nm(h.n))}</b><small>${h.titles.length} titoli${h.cats > 1 ? ` in ${h.cats} categorie` : ''}</small><div class="am-chips">${chips(h)}</div></a>`).join('')}</div></section>`;
  }

  function multiHtml(d) {
    const top = d.multi.filter(h => (h.titles[0][1] >= 5) === (st.sex === 'F')).slice(0, 8);
    if (!top.length) return '';
    return `<section class="am-sec"><div class="hx-ph"><h2>Campioni in più categorie</h2><small>Hanno vinto la classifica finale salendo di categoria</small></div>
      <div class="am-multi">${top.map(h => `<a class="am-mrow" href="/atleta/${encodeURIComponent(h.id)}"><b>${esc(nm(h.n))}</b><span class="am-path">${h.titles.map(t => `<i>${t[0]}<em>${SHORT[t[1]]}</em></i>`).join('<u>›</u>')}</span><small>${h.cats} categorie</small></a>`).join('')}</div></section>`;
  }

  function albo(d) {
    const cols = st.sex === 'M' ? MEN : WOMEN;
    const hallIds = new Set(d.hall.map(h => h.id));
    const years = Object.keys(d.perYear).map(Number).sort((a, b) => b - a);
    const head = `<tr><th>Anno</th>${cols.map(c => `<th>${SHORT[c]}</th>`).join('')}</tr>`;
    const live = st.live || {};
    const liveRow = Object.keys(live).length ? `<tr class="am-live"><th>${d.to + 1}<small>in corso</small></th>${cols.map(c => { const l = live[c]; return `<td>${l ? `${link(l.id, l.n)}<small>${l.p} pt</small>` : '<span class="am-none">—</span>'}</td>`; }).join('')}</tr>` : '';
    const body = years.map(y => {
      const ch = d.perYear[y].champs;
      return `<tr><th>${y}</th>${cols.map(c => { const k = d.cats[c]; const x = ch[k]; return `<td>${x ? `${link(x.id, x.n)}${hallIds.has(x.id) ? ' <em class="am-star" title="Campione più volte">★</em>' : ''}<small>${x.p} pt</small>` : '<span class="am-none">—</span>'}</td>`; }).join('')}</tr>`;
    }).join('');
    return `<section class="am-sec"><div class="hx-ph"><h2>Albo delle classifiche finali</h2></div>
      <div class="am-table"><table><thead>${head}</thead><tbody>${liveRow}${body}</tbody></table></div>
      <p class="am-note">★ campione più volte. La riga della stagione in corso è provvisoria e usa i punti del regolamento ICS; gli anni passati usano i punti di ciclismo.info.</p></section>`;
  }

  function dynasties(d) {
    const top = d.dynasties.filter(x => x.titles.length >= 2).slice(0, 10);
    return `<section class="am-sec"><div class="hx-ph"><h2>Dinastie dei team</h2><small>Classifica a squadre vinta più volte</small></div>
      <div class="am-dyn">${top.map((x, i) => `<div class="am-drow"><span class="am-rk">${i + 1}</span><div class="am-dn"><b>${esc(tc(x.team))}</b><div class="am-chips">${x.titles.map(t => `<i>${t[0]} · ${SHORT[t[1]]}</i>`).join('')}</div></div><div class="am-dc"><b>${x.titles.length}</b><small>titoli${x.streak > 1 ? ` · ${x.streak} anni di fila` : ''}</small></div></div>`).join('')}</div></section>`;
  }

  function records(d) {
    const list = (arr, fn) => arr.map((r, i) => `<a class="hx-si-r" href="/atleta/${encodeURIComponent(r.id)}"><span class="n">${i + 1}</span><span class="nm">${esc(nm(r.n))}</span><span class="up">${fn(r)}</span></a>`).join('');
    return `<section class="am-sec"><div class="hx-ph"><h2>Record di sempre</h2></div><div class="am-recs">
      <div class="hx-panel"><h3>Più vittorie</h3>${list(d.winsTop.slice(0, 8), r => `${r.w} vitt.`)}</div>
      <div class="hx-panel"><h3>Più podi</h3>${list(d.podiTop.slice(0, 8), r => `${r.p} podi`)}</div>
      <div class="hx-panel"><h3>Stagioni da record</h3>${d.bestSeasons.slice(0, 8).map((r, i) => `<a class="hx-si-r" href="/atleta/${encodeURIComponent(r.id)}"><span class="n">${i + 1}</span><span class="nm">${esc(nm(r.n))}<small>${r.y} · ${SHORT[r.c]}</small></span><span class="up">${r.p} pt</span></a>`).join('')}</div>
      <div class="hx-panel"><h3>Team da record</h3>${d.bestTeamSeasons.slice(0, 8).map((r, i) => `<div class="hx-si-r"><span class="n">${i + 1}</span><span class="nm">${esc(tc(r.team))}<small>${r.y} · ${SHORT[r.c]}</small></span><span class="up">${r.p} pt</span></div>`).join('')}</div>
    </div></section>`;
  }

  function racesChart(d) {
    const rows = d.racesPerYear, W = 720, H = 190, pl = 8, pb = 24, pt = 20, max = Math.max(...rows.map(r => r.n));
    const bw = (W - pl * 2) / rows.length;
    const bars = rows.map((r, i) => {
      const h = Math.max(2, (H - pb - pt) * r.n / max), x = pl + i * bw + 3, y = H - pb - h, low = r.n < max * 0.45;
      return `<rect x="${x}" y="${y}" width="${bw - 6}" height="${h}" rx="3" class="${low ? 'am-bar low' : 'am-bar'}"/><text x="${x + (bw - 6) / 2}" y="${y - 5}" text-anchor="middle" class="am-bv">${fmt(r.n)}</text><text x="${x + (bw - 6) / 2}" y="${H - 8}" text-anchor="middle" class="am-bx">${String(r.y).slice(2)}</text>`;
    }).join('');
    return `<section class="am-sec"><div class="hx-ph"><h2>Gare per stagione</h2><small>Gare archiviate con risultati. Nel 2020 la pandemia ha ridotto il calendario.</small></div>
      <div class="hx-panel"><svg viewBox="0 0 ${W} ${H}" class="am-chart" role="img" aria-label="Gare per stagione">${bars}</svg></div></section>`;
  }

  function rises(d) {
    if (!d.rises.length) return '';
    return `<section class="am-sec"><div class="hx-ph"><h2>I salti più grandi</h2><small>Da fuori dai primi 30 a un posto fra i primi 10, nella stessa categoria</small></div>
      <div class="am-rises">${d.rises.slice(0, 10).map(r => `<a class="am-rise" href="/atleta/${encodeURIComponent(r.id)}"><b>${esc(nm(r.n))}</b><span>${r.y} · ${SHORT[r.c]}</span><em>${r.from}° → ${r.to}°</em></a>`).join('')}</div></section>`;
  }

  async function render() {
    if (!globalData) { setPage('<div class="loading-bar"></div>'); return; }
    setPage('<div class="hx-wrap"><div class="hd-skel-hero"></div></div>');
    let d;
    try { d = await loadData(); } catch (_) { d = null; }
    if (!d) return typeof window.renderHomeDashboard === 'function' ? window.renderHomeDashboard() : setPage('<div class="hx-wrap"><div class="hx-none">Dati non disponibili.</div></div>');
    d.counts = d.counts || { athletes: 0, teams: 0 };
    await loadLive();
    const cur = (typeof _loadedSeasonYear === 'function') ? _loadedSeasonYear() : d.to + 1;
    setPageMeta('Statistiche e almanacco del ciclismo giovanile italiano', `Albo delle classifiche, campioni, dinastie dei team e record del ciclismo agonistico italiano dal ${d.from}.`);
    const paint = () => {
      setPage(`<div class="hx-wrap am-wrap">
        <div class="rs-head"><h1>Statistiche</h1><span class="rs-cnt">almanacco ${d.from}–${cur}</span>
          <div class="rs-right"><div class="hx-seg" role="group" aria-label="Uomini o donne"><button type="button" data-sex="M" aria-pressed="${st.sex === 'M'}">Uomini</button><button type="button" data-sex="F" aria-pressed="${st.sex === 'F'}">Donne</button></div><div class="hx-seg" role="group" aria-label="Sezione"><button type="button" aria-pressed="true">Almanacco</button><button type="button" id="am-go-season" aria-pressed="false">Stagione ${cur}</button></div></div></div>
        ${kpis(d)}${hallHtml(d)}${multiHtml(d)}${albo(d)}${dynasties(d)}${records(d)}${racesChart(d)}${rises(d)}
        <p class="am-note">Fonte: classifiche e risultati pubblicati da ciclismo.info (2007–${d.to}) e dati FCI per la stagione in corso. Confrontare i punti fra anni diversi ha senso solo dentro la stessa fonte.</p>
      </div>`);
      document.querySelectorAll('.am-wrap .hx-seg button[data-sex]').forEach(b => { b.onclick = () => { st.sex = b.dataset.sex; paint(); }; });
      const go = document.getElementById('am-go-season'); if (go) go.onclick = () => navTo('/statistiche/stagione');
    };
    paint();
  }

  window.renderAlmanacco = render;
})();
