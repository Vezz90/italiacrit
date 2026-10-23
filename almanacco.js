/* ============================================================
   ICS — Statistiche (Almanacco)
   Sala dei campioni, albo delle classifiche, dinastie dei team,
   record di sempre, anno per anno. Dati: data/almanacco.json
   (generato da scripts/build_almanacco.py sull'archivio 2007-2025).
   ============================================================ */
'use strict';

(function () {
  const SHORT = ['Esord. 1°', 'Esord. 2°', 'Allievi', 'Juniores', 'Elite U23', 'Donne Esord.', 'Donne Allieve', 'Donne Juniores', 'Donne Elite'];
  const MEN = [4, 3, 2, 1, 0];     // ELITE, JUN, AL, ES2, ES1
  const WOMEN = [7, 6, 5];         // DONNE JUN, AL, ES (archivio)
  const WOMEN_NOW = [8, 7, 6, 5];  // dal 2026 c'e anche Donne Elite
  const catsOfSex = () => st.sex === 'M' ? MEN : (st.period === 'now' ? WOMEN_NOW : WOMEN);
  // codice classifica della stagione -> indice categoria
  const CODE_CI = { ES1_M: 0, ES2_M: 1, AL_M: 2, JUN_M: 3, ELI_M: 4, ES1_F: 5, ES2_F: 5, AL_F: 6, JUN_F: 7, ELI_F: 8 };
  // categoria archivio -> codice classifica nativa (stagione in corso)
  const NATIVE = { 0: 'ES1_M', 1: 'ES2_M', 2: 'AL_M', 3: 'JUN_M', 4: 'ELI_M', 5: ['ES1_F', 'ES2_F'], 6: 'AL_F', 7: 'JUN_F', 8: 'ELI_F' };
  const st = { data: null, sex: 'M', cat: null, period: 'arch', /* pagina unica: non si cambia piu */ live: null, modern: null, reg: null, regIdx: [], regCache: {}, regNow: {} };   // cat: indice categoria (null = tutte); period: 'arch' (2007-2025) | 'now' (dal 2026)

  const tc = s => String(s || '').toLowerCase().replace(/(^|[\s'’(-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
  const nm = n => tc(String(n || '').replace(/\s+/g, ' ').trim());
  const fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const link = (id, name) => id ? `<a href="/atleta/${encodeURIComponent(id)}">${esc(nm(name))}</a>` : esc(nm(name));

  // dati del sottoinsieme scelto: una categoria, oppure tutto il sesso (numeri reali, calcolati dallo script)
  function S(d) {
    if (st.cat != null && d.cat && d.cat[d.cats[st.cat]]) return d.cat[d.cats[st.cat]];
    return (d.sex && d.sex[st.sex]) || d;
  }
  const inSel = c => st.cat != null ? c === st.cat : (st.sex === 'M' ? MEN : WOMEN_NOW).includes(c);
  const selLabel = () => `${st.sex === 'M' ? 'Uomini' : 'Donne'}${st.cat != null ? ' · ' + SHORT[st.cat] : ''}`;

  // Stagioni dal 2026 in poi: classifiche del sito (punti del regolamento ICS), per atleti e squadre. Si aggiungono da sole a ogni stagione archiviata.
  async function loadModern() {
    if (st.modern) return st.modern;
    const out = { ath: [], teams: [] };
    let idx = null; try { idx = await loadJson('data/seasons/index.json'); } catch (_) {}
    const seasons = (idx && idx.seasons ? idx.seasons : []).map(Number).filter(y => y >= 2026);
    await Promise.all(seasons.flatMap(y => Object.entries(CODE_CI).map(async ([code, ci]) => {
      const live = idx && +idx.current === y;
      try { ((await loadJson(`data/seasons/${y}/rankings/${code}.json`)) || []).forEach(r => out.ath.push({ id: r.atleta_id, n: `${r.cognome || ''} ${r.nome || ''}`.trim(), y, c: ci, p: r.punti || 0, w: r.p1 != null ? r.p1 : (r.vittorie || 0), pd: (r.p1 || 0) + (r.p2 || 0) + (r.p3 || 0), live })); } catch (_) {}
      try { ((await loadJson(`data/seasons/${y}/team_rankings/${code}.json`)) || []).slice(0, 10).forEach(t => out.teams.push({ team: t.team_nome, y, c: ci, p: t.punti || 0, live })); } catch (_) {}
    })));
    st.modern = out;
    return out;
  }

  // ---- per regione: file separato per ogni regione, caricato solo quando la si sceglie ----
  const regKey = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const regSlug = slug => String(slug).toLowerCase().replace(/_/g, '-');          // EMILIA_ROMAGNA -> emilia-romagna
  const regUrl = slug => `/statistiche/regione/${regSlug(slug)}`;
  async function loadRegIdx() {
    if (st.regIdx && st.regIdx.length) return st.regIdx;
    try { const r = await loadJson('data/almanacco_regioni/index.json'); st.regIdx = (r && r.regions) || []; } catch (_) { st.regIdx = []; }
    return st.regIdx;
  }
  async function loadReg(slug) {
    if (st.regCache[slug]) return st.regCache[slug];
    let r = null;
    try { r = await loadJson(`data/almanacco_regioni/${slug}.json`); } catch (_) { /* si riprova alla prossima scelta */ }
    if (r) st.regCache[slug] = r;     // un errore momentaneo non va ricordato
    return r;
  }
  // stagione in corso: solo le gare disputate nella regione (regione della gara, anche dal calendario se manca nel risultato)
  function regNow(regName) {
    const key = regKey(regName);
    if (st.regNow[key]) return st.regNow[key];
    const calMap = {}; (globalData.calendar || []).forEach(g => { calMap[g.id] = g; });
    const rows = [];
    for (const r of globalData.resultsRaw || []) {
      if (r.tipo === 'pista') continue;
      const ci = CODE_CI[getRankingFileCode(r)];
      if (ci == null) continue;
      const cal = calMap[r.gara_id];
      if (regKey(normalizeRegion(r.regione || (cal && cal.regione) || '')) !== key) continue;
      rows.push({ r, ci });
    }
    return (st.regNow[key] = rows);
  }
  // chi guida quest'anno in ogni categoria (piu vittorie, poi podi) fra le gare della regione
  function regLive(rd) {
    const by = {};
    regNow(rd.region).forEach(({ r, ci }) => {
      if (!(r.posizione >= 1 && r.posizione <= 3)) return;
      const m = by[ci] || (by[ci] = {});
      const a = m[r.atleta_id] || (m[r.atleta_id] = { id: r.atleta_id, n: `${r.cognome || ''} ${r.nome || ''}`.trim(), p: 0, pd: 0 });
      if (r.posizione === 1) a.p++;
      a.pd++;
    });
    const out = {};
    Object.keys(by).forEach(ci => { const b = Object.values(by[ci]).sort((x, y) => y.p - x.p || y.pd - x.pd)[0]; if (b && b.p > 0) out[ci] = b; });
    return out;
  }
  function regRecords(rd, cur) {
    const yrs = y => (!y || !y.length) ? '' : (y[0] === y[1] ? `${y[0]}` : `${y[0]}–${y[1]}`);
    const sec = S(rd), now = regNow(rd.region).filter(x => inSel(x.ci));
    const tot = new Map(), seasons = new Map(), teams = new Map();
    for (const r of sec.winsTop.concat(sec.podiTop)) if (!tot.has(r.id)) tot.set(r.id, { id: r.id, n: r.n, w: r.w || 0, p: r.p || 0, y: (r.y || []).slice() });
    for (const t of sec.teamsTop || []) teams.set(regKey(t.team), { team: t.team, w: t.w, p: t.p, y: (t.y || []).slice() });
    for (const { r, ci } of now) {
      const w = r.posizione === 1 ? 1 : 0, pd = (r.posizione >= 1 && r.posizione <= 3) ? 1 : 0;
      if (!w && !pd) continue;
      const nmA = `${r.cognome || ''} ${r.nome || ''}`.trim();
      const a = tot.get(r.atleta_id) || tot.set(r.atleta_id, { id: r.atleta_id, n: nmA, w: 0, p: 0, y: [] }).get(r.atleta_id);
      a.w += w; a.p += pd; a.y = a.y.length ? [Math.min(a.y[0], cur), Math.max(a.y[1], cur)] : [cur, cur];
      if (w) { const k = r.atleta_id + '|' + ci; (seasons.get(k) || seasons.set(k, { id: r.atleta_id, n: nmA, y: cur, c: ci, w: 0 }).get(k)).w++; }
      const tk = regKey(r.team);
      if (tk) {
        const t = teams.get(tk) || teams.set(tk, { team: r.team, w: 0, p: 0, y: [] }).get(tk);
        t.w += w; t.p += pd; t.y = t.y.length ? [Math.min(t.y[0], cur), Math.max(t.y[1], cur)] : [cur, cur];
      }
    }
    const all = [...tot.values()];
    const topW = all.filter(x => x.w > 0).sort((a, b) => b.w - a.w || b.p - a.p).slice(0, 8);
    const topP = all.filter(x => x.p > 0).sort((a, b) => b.p - a.p || b.w - a.w).slice(0, 8);
    const best = sec.bestSeasons.concat([...seasons.values()]).sort((a, b) => b.w - a.w || b.y - a.y).slice(0, 8);
    const topT = [...teams.values()].filter(t => t.w > 0 || t.p > 0).sort((a, b) => b.w - a.w || b.p - a.p).slice(0, 8);
    const none = '<div class="am-none">Nessun dato per questa selezione.</div>';
    const row = (i, href, name, small, val) => `<${href ? `a class="hx-si-r" href="${href}"` : 'div class="hx-si-r"'}><span class="n">${i + 1}</span><span class="nm">${name}${small ? `<small>${small}</small>` : ''}</span><span class="up">${val}</span></${href ? 'a' : 'div'}>`;
    const ath = (arr, fn) => arr.length ? arr.map((r, i) => row(i, `/atleta/${encodeURIComponent(r.id)}`, esc(nm(r.n)), yrs(r.y), fn(r))).join('') : none;
    const reg = tc(rd.region);
    return `<section class="am-sec"><div class="hx-ph"><h2>Record in ${esc(reg)}</h2><small>Vittorie e podi nelle gare disputate in regione, dal ${rd.from} a oggi</small></div>
      <div class="am-recs">
        <div class="hx-panel"><h3>Più vittorie</h3>${ath(topW, r => `${r.w} vitt.`)}</div>
        <div class="hx-panel"><h3>Più podi</h3>${ath(topP, r => `${r.p} podi`)}</div>
        <div class="hx-panel"><h3>Più vittorie in una stagione</h3>${best.length ? best.map((r, i) => row(i, `/atleta/${encodeURIComponent(r.id)}`, esc(nm(r.n)), `${r.y} · ${SHORT[r.c]}`, `${r.w} vitt.`)).join('') : none}</div>
        <div class="hx-panel"><h3>Team più vincenti</h3>${topT.length ? topT.map((t, i) => row(i, '', esc(tc(t.team)), yrs(t.y), `${t.w} vitt. · ${t.p} podi`)).join('') : none}</div>
      </div></section>`;
  }
  function regLinks() {
    const list = (st.regIdx || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'it'));
    if (!list.length) return '';
    return `<section class="am-sec"><div class="hx-ph"><h2>Statistiche per regione</h2><small>Record, campioni e squadre delle gare disputate in ogni regione</small></div>
      <div class="am-reglinks">${list.map(r => `<a href="${regUrl(r.slug)}"${st.reg === r.slug ? ' aria-current="page"' : ''}>${esc(tc(r.name))}<small>${fmt(r.races)} gare</small></a>`).join('')}</div></section>`;
  }
  function regSelect() {
    const list = (st.regIdx || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'it'));
    if (!list.length) return '';
    return `<div class="am-regrow"><label class="am-regsel"><span>Regione</span><select id="am-reg" aria-label="Regione"><option value="">Tutta Italia</option>${list.map(r => `<option value="${esc(r.slug)}" ${st.reg === r.slug ? 'selected' : ''}>${esc(tc(r.name))} · ${fmt(r.races)} gare</option>`).join('')}</select></label></div>`;
  }

  async function loadData() {
    if (st.data) return st.data;
    st.data = await loadJson('data/almanacco.json?v=20261019c');   // la versione cambia a ogni rigenerazione: evita copie vecchie in cache
    return st.data;
  }

  // Leader della stagione in corso (classifica nativa), per la riga "in corso" dell'albo
  async function loadLive() {
    if (st.live) return st.live;
    const out = {};
    await Promise.all(Object.entries(NATIVE).map(async ([ci, code0]) => {
      const code = [].concat(code0)[0];
      try {
        const rk = await loadRanking(code);
        if (rk && rk[0]) out[ci] = { id: rk[0].atleta_id, n: `${rk[0].cognome || ''} ${rk[0].nome || ''}`.trim(), p: rk[0].punti };
      } catch (_) { /* ok */ }
    }));
    st.live = out;
    return out;
  }

  function kpis(d) {
    const sec = S(d), who = selLabel();
    const races = sec.counts && sec.counts.races != null ? sec.counts.races : sec.racesPerYear.reduce((a, r) => a + r.n, 0);
    const tiles = [
      [d.to - d.from + 1, 'stagioni in archivio', `${d.from}–${d.to}`],
      [fmt(races), 'gare archiviate', who],
      [fmt(sec.counts ? sec.counts.athletes : d.counts.athletes), 'atleti nel database', who],
      [fmt(sec.counts ? sec.counts.teams : d.counts.teams), 'squadre diverse', 'con le variazioni di nome'],
    ];
    return `<div class="am-kpis">${tiles.map(t => `<div class="am-kpi"><b>${t[0]}</b><span>${t[1]}</span><small>${t[2]}</small></div>`).join('')}</div>`;
  }

  function hallHtml(d) {
    const top = S(d).hall.filter(h => (h.titles[0][1] >= 5) === (st.sex === 'F')).slice(0, 6);
    if (!top.length) return '';
    const chips = h => h.titles.map(t => `<i title="${esc(SHORT[t[1]])} ${t[0]}">${t[0]} · ${SHORT[t[1]]}</i>`).join('');
    return `<section class="am-sec"><div class="hx-ph"><h2>Sala dei campioni</h2><small>Chi ha vinto più classifiche finali</small></div>
      <div class="am-hall">${top.map((h, i) => `<a class="am-champ" href="/atleta/${encodeURIComponent(h.id)}" style="--c1:${['#C99400', '#6E7A90', '#B26A2C'][i] || '#33415F'};--c2:${['#5A3F00', '#2A3342', '#4A2A0E'][i] || '#16213D'}">
        <span class="am-n">${h.titles.length}</span><b>${esc(nm(h.n))}</b><small>${h.titles.length} titoli${h.cats > 1 ? ` in ${h.cats} categorie` : ''}</small><div class="am-chips">${chips(h)}</div></a>`).join('')}</div></section>`;
  }

  function multiHtml(d) {
    const top = S(d).multi.filter(h => (h.titles[0][1] >= 5) === (st.sex === 'F')).slice(0, 8);
    if (!top.length) return '';
    return `<section class="am-sec"><div class="hx-ph"><h2>Campioni in più categorie</h2><small>Hanno vinto la classifica finale salendo di categoria</small></div>
      <div class="am-multi">${top.map(h => `<a class="am-mrow" href="/atleta/${encodeURIComponent(h.id)}"><b>${esc(nm(h.n))}</b><span class="am-path">${h.titles.map(t => `<i>${t[0]}<em>${SHORT[t[1]]}</em></i>`).join('<u>›</u>')}</span><small>${h.cats} categorie</small></a>`).join('')}</div></section>`;
  }

  function albo(d, o = {}) {
    const cols = st.cat != null ? [st.cat] : (st.sex === 'M' ? MEN : WOMEN);
    const hallIds = new Set(S(d).hall.map(h => h.id));
    const years = Object.keys(d.perYear).map(Number).sort((a, b) => b - a);
    const head = `<tr><th>Anno</th>${cols.map(c => `<th>${SHORT[c]}</th>`).join('')}</tr>`;
    const live = o.live || st.live || {};
    const unit = o.unit || 'pt';
    const liveRow = Object.keys(live).length ? `<tr class="am-live"><th>${d.to + 1}<small>in corso</small></th>${cols.map(c => { const l = live[c]; return `<td>${l ? `${link(l.id, l.n)}<small>${l.p} ${unit}</small>` : '<span class="am-none">—</span>'}</td>`; }).join('')}</tr>` : '';
    const body = years.map(y => {
      const ch = d.perYear[y].champs;
      return `<tr><th>${y}</th>${cols.map(c => { const k = d.cats[c]; const x = ch[k]; return `<td>${x ? `${link(x.id, x.n)}${hallIds.has(x.id) ? ' <em class="am-star" title="Campione più volte">★</em>' : ''}<small>${x.p} ${unit}</small>` : '<span class="am-none">—</span>'}</td>`; }).join('')}</tr>`;
    }).join('');
    return `<section class="am-sec"><div class="hx-ph"><h2>${o.title || 'Albo delle classifiche finali'}</h2>${o.sub ? `<small>${o.sub}</small>` : ''}</div>
      <div class="am-table"><table><thead>${head}</thead><tbody>${liveRow}${body}</tbody></table></div>
      <p class="am-note">${o.note || '★ campione più volte. La riga della stagione in corso è provvisoria e usa i punti del regolamento ICS; gli anni passati usano i punti di ciclismo.info.'}</p></section>`;
  }

  function dynasties(d, o = {}) {
    const top = S(d).dynasties.filter(x => x.titles.length >= 2).slice(0, 10);
    if (!top.length) return '';
    return `<section class="am-sec"><div class="hx-ph"><h2>${o.title || 'Dinastie dei team'}</h2><small>${o.sub || 'Classifica a squadre vinta più volte'}</small></div>
      <div class="am-dyn">${top.map((x, i) => `<div class="am-drow"><span class="am-rk">${i + 1}</span><div class="am-dn"><b>${esc(tc(x.team))}</b><div class="am-chips">${x.titles.map(t => `<i>${t[0]} · ${SHORT[t[1]]}</i>`).join('')}</div></div><div class="am-dc"><b>${x.titles.length}</b><small>${o.unit || 'titoli'}${x.streak > 1 ? ` · ${x.streak} anni di fila` : ''}</small></div></div>`).join('')}</div></section>`;
  }

  function records(d) {
    const yrs = y => (!y || !y.length) ? '' : (y[0] === y[1] ? `${y[0]}` : `${y[0]}–${y[1]}`);
    const list = (arr, fn) => arr.map((r, i) => `<a class="hx-si-r" href="/atleta/${encodeURIComponent(r.id)}"><span class="n">${i + 1}</span><span class="nm">${esc(nm(r.n))}${yrs(r.y) ? `<small>${yrs(r.y)}</small>` : ''}</span><span class="up">${fn(r)}</span></a>`).join('');
    const seasonRows = arr => arr.map((r, i) => `<a class="hx-si-r" href="/atleta/${encodeURIComponent(r.id)}"><span class="n">${i + 1}</span><span class="nm">${esc(nm(r.n))}<small>${r.y} · ${SHORT[r.c]}</small></span><span class="up">${r.p} pt</span></a>`).join('');
    const teamRows = arr => arr.map((r, i) => `<div class="hx-si-r"><span class="n">${i + 1}</span><span class="nm">${esc(tc(r.team))}<small>${r.y} · ${SHORT[r.c]}</small></span><span class="up">${r.p} pt</span></div>`).join('');
    const sec = S(d), m = st.modern || { ath: [], teams: [] };
    // vittorie e podi: totale archivio + stagioni dal 2026 (sono conteggi di piazzamenti, si possono sommare)
    const tot = new Map();
    for (const r of sec.winsTop.concat(sec.podiTop)) if (!tot.has(r.id)) tot.set(r.id, { id: r.id, n: r.n, w: r.w || 0, p: r.p || 0, y: (r.y || []).slice() });
    for (const r of m.ath) {
      if (!inSel(r.c)) continue;
      const t = tot.get(r.id) || tot.set(r.id, { id: r.id, n: r.n, w: 0, p: 0, y: [] }).get(r.id);
      t.w += r.w; t.p += r.pd;
      if (r.w || r.pd) t.y = t.y.length ? [Math.min(t.y[0], r.y), Math.max(t.y[1], r.y)] : [r.y, r.y];   // le stagioni dal 2026 allungano l'arco
    }
    const all = [...tot.values()];
    const topW = all.filter(x => x.w > 0).sort((a, b) => b.w - a.w || b.p - a.p).slice(0, 8);
    const topP = all.filter(x => x.p > 0).sort((a, b) => b.p - a.p || b.w - a.w).slice(0, 8);
    const mAth = m.ath.filter(r => inSel(r.c)).sort((a, b) => b.p - a.p).slice(0, 8);
    const mTeam = m.teams.filter(r => inSel(r.c)).sort((a, b) => b.p - a.p).slice(0, 8);
    const none = '<div class="am-none">Nessuna stagione ancora archiviata.</div>';
    // una sola scheda per ogni record: dentro, i due gruppi di anni (senza nominare la fonte)
    const grp = (label, html) => `<div class="am-yr">${label}</div>${html}`;
    return `<section class="am-sec"><div class="hx-ph"><h2>Record di sempre</h2><small>Vittorie e podi sommano tutte le stagioni, dal ${d.from} a oggi</small></div>
      <div class="am-recs">
        <div class="hx-panel"><h3>Più vittorie</h3>${list(topW, r => `${r.w} vitt.`)}</div>
        <div class="hx-panel"><h3>Più podi</h3>${list(topP, r => `${r.p} podi`)}</div>
        <div class="hx-panel"><h3>Stagioni da record</h3>${grp(`${d.from}–${d.to}`, seasonRows(sec.bestSeasons.slice(0, 8)))}${grp(`Dal ${d.to + 1}`, mAth.length ? seasonRows(mAth) : none)}</div>
        <div class="hx-panel"><h3>Team da record</h3>${grp(`${d.from}–${d.to}`, teamRows(sec.bestTeamSeasons.slice(0, 8)))}${grp(`Dal ${d.to + 1}`, mTeam.length ? teamRows(mTeam) : none)}</div>
      </div></section>`;
  }

  function racesChart(d) {
    const rows = S(d).racesPerYear, W = 720, H = 190, pl = 8, pb = 24, pt = 20, max = Math.max(1, ...rows.map(r => r.n));
    const bw = (W - pl * 2) / rows.length;
    const bars = rows.map((r, i) => {
      const h = Math.max(2, (H - pb - pt) * r.n / max), x = pl + i * bw + 3, y = H - pb - h, low = r.n < max * 0.45;
      return `<rect x="${x}" y="${y}" width="${bw - 6}" height="${h}" rx="3" class="${low ? 'am-bar low' : 'am-bar'}"/><text x="${x + (bw - 6) / 2}" y="${y - 5}" text-anchor="middle" class="am-bv">${fmt(r.n)}</text><text x="${x + (bw - 6) / 2}" y="${H - 8}" text-anchor="middle" class="am-bx">${String(r.y).slice(2)}</text>`;
    }).join('');
    return `<section class="am-sec"><div class="hx-ph"><h2>Gare per stagione</h2><small>Gare archiviate con risultati. Nel 2020 la pandemia ha ridotto il calendario.</small></div>
      <div class="hx-panel"><svg viewBox="0 0 ${W} ${H}" class="am-chart" role="img" aria-label="Gare per stagione">${bars}</svg></div></section>`;
  }

  function rises(d) {
    if (!S(d).rises.length) return '';
    return `<section class="am-sec"><div class="hx-ph"><h2>I salti più grandi</h2><small>Da fuori dai primi 30 a un posto fra i primi 10, nella stessa categoria</small></div>
      <div class="am-rises">${S(d).rises.slice(0, 10).map(r => `<a class="am-rise" href="/atleta/${encodeURIComponent(r.id)}"><b>${esc(nm(r.n))}</b><span>${r.y} · ${SHORT[r.c]}</span><em>${r.from}° → ${r.to}°</em></a>`).join('')}</div></section>`;
  }

  // ---- dal 2026: stagione in corso (dati del sito, punti del regolamento ICS) ----
  const codesOf = ci => [].concat(NATIVE[ci]);   // una o piu annate
  function seasonRes(ci) {
    const set = new Set(codesOf(ci));
    return globalData.resultsRaw.filter(r => set.has(getRankingFileCode(r)));
  }
  function seasonView(d, cur) {
    const head = `<div class="hx-ph"><h2>Stagione ${cur}</h2><small>In corso · dati del sito, punti secondo il regolamento ICS · ${esc(selLabel())}</small></div>`;
    if (st.cat != null) {
      try {
        const codes = codesOf(st.cat);
        const html = codes.map(code => {
          const res = globalData.resultsRaw.filter(r => getRankingFileCode(r) === code);
          const inner = _renderStatisticheCat(code, res, globalData.athletes, globalData.calendar, '', globalData.resultsRaw, { asHtml: true }) || '';
          return codes.length > 1 ? `<h3 class="am-sub">${esc(typeof catLabel === 'function' ? catLabel(code) : code)}</h3>${inner}` : inner;
        }).join('');
        return `<section class="am-sec">${head}<div class="am-season">${html}</div></section>`;
      } catch (_) { return `<section class="am-sec">${head}<div class="hx-none">Dati non disponibili per questa categoria.</div></section>`; }
    }
    const cols = catsOfSex();
    const cards = cols.map(ci => {
      const res = seasonRes(ci);
      const races = new Set(res.map(r => r.gara_id)).size, ath = new Set(res.map(r => r.atleta_id)).size, wins = res.filter(r => r.posizione === 1).length;
      return `<button type="button" class="am-scard" data-cat="${ci}"><b>${SHORT[ci]}</b><span><em>${fmt(races)}</em> gare</span><span><em>${fmt(ath)}</em> atleti</span><span><em>${fmt(wins)}</em> vittorie</span><i>Apri ›</i></button>`;
    }).join('');
    return `<section class="am-sec">${head}<div class="am-scards">${cards}</div><p class="am-note">Scegli una categoria per vederne i numeri, i record e le classifiche della stagione.</p></section>`;
  }

  async function render(opts) {
    if (!globalData) { setPage('<div class="loading-bar"></div>'); return; }
    setPage('<div class="hx-wrap"><div class="hd-skel-hero"></div></div>');
    let d;
    try { d = await loadData(); } catch (_) { d = null; }
    if (!d) return typeof window.renderHomeDashboard === 'function' ? window.renderHomeDashboard() : setPage('<div class="hx-wrap"><div class="hx-none">Dati non disponibili.</div></div>');
    d.counts = d.counts || { athletes: 0, teams: 0 };
    await Promise.all([loadLive(), loadModern(), loadRegIdx()]);
    // regione scelta dall'indirizzo (/statistiche/regione/toscana); senza indirizzo valido si torna al nazionale
    const want = opts && opts.reg ? String(opts.reg).toLowerCase() : null;
    const hit = want ? (st.regIdx || []).find(r => regSlug(r.slug) === want) : null;
    st.reg = hit ? hit.slug : null;
    if (st.reg) await loadReg(st.reg);
    if (want && !hit) history.replaceState(null, '', '/statistiche');
    const cur = (typeof _loadedSeasonYear === 'function') ? _loadedSeasonYear() : d.to + 1;
    setPageMeta('Statistiche e almanacco del ciclismo giovanile italiano', `Albo delle classifiche, campioni, dinastie dei team e record del ciclismo agonistico italiano dal ${d.from}.`);
    const paint = () => {
      const rd = st.reg ? st.regCache[st.reg] : null;
      if (st.reg && !rd) { st.reg = null; showToast && showToast('Dati della regione non disponibili, riprova', 'error'); }
      const dd = rd || d, regName = rd ? tc(rd.region) : '';
      if (rd) setPageMeta(`Statistiche del ciclismo giovanile in ${regName}: record, campioni e squadre`, `Chi ha vinto di più, le squadre più forti e l'albo anno per anno nelle gare disputate in ${regName} dal ${rd.from}.`);
      else setPageMeta('Statistiche e almanacco del ciclismo giovanile italiano', `Albo delle classifiche, campioni, dinastie dei team e record del ciclismo agonistico italiano dal ${d.from}.`);
      let body;
      if (rd) {
        const sec = S(rd), few = (sec.counts && sec.counts.races || 0) < 100;
        const empty = !(sec.counts && sec.counts.races) && !regNow(rd.region).some(x => inSel(x.ci));
        const note = empty ? `<div class="hx-none">Nessuna gara archiviata per questa selezione in ${esc(regName)}.</div>`
          : `<p class="am-note">${few ? `Dati limitati: solo ${fmt(sec.counts.races)} gare archiviate per questa selezione in ${esc(regName)}. ` : ''}Si contano le gare disputate in ${esc(regName)}, non la regione di residenza di atleti e squadre. Dal ${rd.to + 1} i numeri sono quelli del sito.</p>`;
        body = `${kpis(rd)}${note}${empty ? '' : regRecords(rd, cur) + albo(rd, { live: regLive(rd), unit: 'vitt.', title: 'Chi ha vinto di più, anno per anno', sub: `Atleta con più vittorie in ${esc(regName)} in ogni stagione`, note: `Per ogni stagione e categoria: l'atleta con più vittorie nelle gare disputate in ${esc(regName)} (a parità, più podi). La riga ${rd.to + 1} è la stagione in corso.` }) + dynasties(rd, { title: 'Squadre dominanti', sub: `Squadra con più vittorie in ${esc(regName)} in una stagione, più volte`, unit: 'anni in testa' }) + racesChart(rd)}${regLinks()}`;
      } else {
        body = `${kpis(d)}${hallHtml(d)}${multiHtml(d)}${albo(d)}${dynasties(d)}${records(d)}${racesChart(d)}${rises(d)}${regLinks()}`;
      }
      setPage(`<div class="hx-wrap am-wrap">
        <div class="rs-head"><h1>Statistiche${rd ? ` · ${esc(regName)}` : ''}</h1><span class="rs-cnt">almanacco ${d.from}–${cur}</span>
          <div class="rs-right"><div class="hx-seg" role="group" aria-label="Uomini o donne"><button type="button" data-sex="M" aria-pressed="${st.sex === 'M'}">Uomini</button><button type="button" data-sex="F" aria-pressed="${st.sex === 'F'}">Donne</button></div></div></div>
        <div class="am-filter" role="group" aria-label="Categoria"><button type="button" data-cat="" aria-pressed="${st.cat == null}">Tutte le categorie</button>${catsOfSex().map(c => `<button type="button" data-cat="${c}" aria-pressed="${st.cat === c}">${SHORT[c]}</button>`).join('')}</div>
        ${regSelect()}
        ${body}
        <p class="am-note">Fonte: classifiche e risultati pubblicati da ciclismo.info (2007–${d.to}) e dati FCI per la stagione in corso. Confrontare i punti fra anni diversi ha senso solo dentro la stessa fonte.</p>
      </div>`);
      const regSel = document.getElementById('am-reg');
      if (regSel) regSel.onchange = async () => {
        st.reg = regSel.value || null;
        if (st.reg) await loadReg(st.reg);
        const path = st.reg ? regUrl(st.reg) : '/statistiche';
        if (location.pathname !== path) history.pushState(null, '', path);   // il titolo e il canonical di paint() leggono il nuovo indirizzo
        paint();
      };
      document.querySelectorAll('.am-wrap .hx-seg button[data-sex]').forEach(b => { b.onclick = () => { st.sex = b.dataset.sex; st.cat = null; paint(); }; });
      document.querySelectorAll('.am-wrap [data-per]').forEach(b => { b.onclick = () => { st.period = b.dataset.per; if (st.period === 'arch' && st.cat === 8) st.cat = null; paint(); }; });
      document.querySelectorAll('.am-wrap .am-filter [data-cat], .am-wrap .am-scard[data-cat]').forEach(b => { b.onclick = () => { st.cat = b.dataset.cat === '' ? null : +b.dataset.cat; paint(); }; });
    };
    paint();
  }

  window.renderAlmanacco = render;
})();
