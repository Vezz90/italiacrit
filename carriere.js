/* ============================================================
   ICS — Comparatore: carriere a confronto (anno per anno)
   Dati: data/carriere.json (scripts/build_almanacco.py) + stagione in corso dal sito.
   Espone window.CmpCareer.render(mode, idA, idB, hostId)
   ============================================================ */
'use strict';

(function () {
  const SHORT = ['Esord. 1°', 'Esord. 2°', 'Allievi', 'Juniores', 'Elite U23', 'Donne Esord.', 'Donne Allieve', 'Donne Juniores'];
  const NATIVE_CAT = { ES1_M: 0, ES2_M: 1, AL_M: 2, JUN_M: 3, ELI_M: 4, AL_F: 6, JUN_F: 7, ES1_F: 5, ES2_F: 5, ELI_F: 7 };
  const CA = '#E3182D', CB = '#2563EB';
  let cr = null, idxA = null;

  const norm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const tc = s => String(s || '').toLowerCase().replace(/(^|[\s'’(-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());

  async function data() {
    if (!cr) cr = await loadJson('data/carriere.json');
    return cr;
  }

  function findAthlete(id) {
    const a = cr.a;
    if (a[id]) return { key: id, rec: a[id] };
    const al = window._athAlias && window._athAlias[id];
    if (al && a[al]) return { key: al, rec: a[al] };
    const g = globalData && globalData.athletes && globalData.athletes[id];
    const nm = g ? `${g.cognome || ''} ${g.nome || ''}` : (window._compHistoricalNames && window._compHistoricalNames[id] ? `${window._compHistoricalNames[id].cognome} ${window._compHistoricalNames[id].nome}` : id.replace(/_/g, ' '));
    if (!idxA) { idxA = {}; for (const [k, v] of Object.entries(a)) idxA[norm(v.n)] = k; }
    const k = idxA[norm(nm)];
    return k ? { key: k, rec: a[k] } : { key: id, rec: null, name: nm };
  }

  function findTeam(id) {
    const g = globalData && globalData.teams && globalData.teams[id];
    const nm = g ? g.nome : id;
    const k = norm(nm);
    return { key: k, rec: cr.t[k] || null, name: nm };
  }

  // stagione in corso (dati ICS): posizione/punti dalla classifica nativa
  async function liveRow(mode, id) {
    try {
      if (mode === 'atleta') {
        const g = globalData.athletes[id]; if (!g || !g.risultati || !g.risultati.length) return null;
        const code = getRankingFileCode({ categoria: g.categoria, genere: g.genere }) || g.categoria;
        const rk = await loadRanking(code); const row = (rk || []).find(r => r.atleta_id === id);
        const res = g.risultati.filter(r => r.tipo !== 'pista');
        return { y: +_loadedSeasonYear(), c: NATIVE_CAT[code] ?? 0, pos: row ? row.pos : 0, pts: row ? row.punti : g.punti_totali || 0, w: res.filter(r => r.posizione === 1).length, p: res.filter(r => r.posizione <= 3).length, live: true };
      }
      const t = globalData.teams[id]; if (!t) return null;
      const cats = {}; (t.risultati || []).forEach(r => { const c = getRankingFileCode(r) || r.categoria; if (c) cats[c] = (cats[c] || 0) + (r.punti_effettivi || 0); });
      const best = Object.entries(cats).sort((a, b) => b[1] - a[1])[0]; if (!best) return null;
      const rk = await loadTeamRanking(best[0]); const row = (rk || []).find(r => r.team_id === id);
      return { y: +_loadedSeasonYear(), c: NATIVE_CAT[best[0]] ?? 0, pos: row ? row.pos : 0, pts: row ? row.punti : best[1], w: 0, p: 0, live: true };
    } catch (_) { return null; }
  }

  // [y, cat, pos, pts, team, w, p]  (atleta)   |  [y, cat, pos, pts]  (team)
  function seasons(rec, mode) {
    if (!rec) return [];
    return rec.s.map(s => mode === 'atleta' ? { y: s[0], c: s[1], pos: s[2], pts: s[3], team: cr.teams[s[4]] || '', w: s[5], p: s[6] } : { y: s[0], c: s[1], pos: s[2], pts: s[3] });
  }

  function totals(rows, mode) {
    const titles = rows.filter(r => !r.live && r.pos === 1).length;
    const posList = rows.filter(r => r.pos > 0).map(r => r.pos);
    return {
      stagioni: new Set(rows.map(r => r.y)).size, titoli: titles,
      vitt: rows.reduce((s, r) => s + (r.w || 0), 0), podi: rows.reduce((s, r) => s + (r.p || 0), 0),
      best: posList.length ? Math.min(...posList) : null, pts: rows.filter(r => !r.live).reduce((s, r) => s + (r.pts || 0), 0),
      da: rows.length ? Math.min(...rows.map(r => r.y)) : null, a: rows.length ? Math.max(...rows.map(r => r.y)) : null,
    };
  }

  function chart(rA, rB, nameA, nameB) {
    const years = [...new Set([...rA, ...rB].map(r => r.y))].sort((a, b) => a - b);
    if (!years.length) return '';
    const W = 720, H = 230, pl = 40, pr = 14, pt = 16, pb = 30, y0 = years[0], y1 = years[years.length - 1] || y0;
    const X = y => pl + (y1 === y0 ? (W - pl - pr) / 2 : (y - y0) / (y1 - y0) * (W - pl - pr));
    const maxPos = 300, lg = p => Math.log10(Math.min(Math.max(p, 1), maxPos));
    const Y = p => pt + lg(p) / lg(maxPos) * (H - pt - pb);   // 1 in alto, 300 in basso
    const ticks = [1, 3, 10, 30, 100, 300].map(p => `<line x1="${pl}" x2="${W - pr}" y1="${Y(p)}" y2="${Y(p)}" class="cc-grid"/><text x="${pl - 6}" y="${Y(p) + 3}" text-anchor="end" class="cc-tk">${p}°</text>`).join('');
    const xt = years.map(y => `<text x="${X(y)}" y="${H - 10}" text-anchor="middle" class="cc-tk">${String(y).slice(2)}</text>`).join('');
    const line = (rows, col) => {
      const pts = rows.filter(r => r.pos > 0).sort((a, b) => a.y - b.y);
      // se ci sono due categorie nello stesso anno si tiene la miglior posizione per la linea
      const best = {}; pts.forEach(r => { if (!best[r.y] || r.pos < best[r.y].pos) best[r.y] = r; });
      const arr = Object.values(best).sort((a, b) => a.y - b.y);
      const d = arr.map((r, i) => `${i ? 'L' : 'M'}${X(r.y).toFixed(1)},${Y(r.pos).toFixed(1)}`).join(' ');
      return `<path d="${d}" fill="none" stroke="${col}" stroke-width="2.4" stroke-linejoin="round" opacity=".9"/>` + arr.map(r => `<circle cx="${X(r.y)}" cy="${Y(r.pos)}" r="${r.pos === 1 ? 5.5 : 3.8}" fill="${r.pos === 1 ? '#E5A100' : col}" stroke="var(--bg-card)" stroke-width="1.6"><title>${r.y} · ${SHORT[r.c]} · ${r.pos}°${r.live ? ' (in corso)' : ''}</title></circle>`).join('');
    };
    return `<div class="hx-panel cc-chart"><div class="cc-leg"><span style="--c:${CA}">${nameA}</span><span style="--c:${CB}">${nameB}</span><small>Posizione in classifica finale (più in alto = meglio). Pallino oro = titolo.</small></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Posizione in classifica anno per anno">${ticks}${xt}${line(rA, CA)}${line(rB, CB)}</svg></div>`;
  }

  function table(rA, rB, mode) {
    const years = [...new Set([...rA, ...rB].map(r => r.y))].sort((a, b) => b - a);
    const cell = (rows, y) => {
      const rs = rows.filter(r => r.y === y); if (!rs.length) return '<td class="cc-none">—</td>';
      return `<td>${rs.map(r => `<div class="cc-c${r.pos === 1 && !r.live ? ' win' : ''}"><b>${r.pos ? r.pos + '°' : '—'}</b><span>${SHORT[r.c]}</span><small>${r.pts} pt${mode === 'atleta' && (r.w || r.p) ? ` · ${r.w || 0}V ${r.p || 0}P` : ''}${r.team ? ` · ${esc(tc(r.team))}` : ''}</small></div>`).join('')}</td>`;
    };
    return `<div class="am-table cc-table"><table><thead><tr><th>Anno</th><th style="color:${CA}">A</th><th style="color:${CB}">B</th></tr></thead><tbody>${years.map(y => `<tr><th>${y}${rA.concat(rB).some(r => r.y === y && r.live) ? '<small>in corso</small>' : ''}</th>${cell(rA, y)}${cell(rB, y)}</tr>`).join('')}</tbody></table></div>`;
  }

  function totalsHtml(tA, tB, mode) {
    const row = (label, a, b, inv, f) => {
      const fm = v => (v == null ? '—' : (f ? f(v) : v));
      const wa = a != null && b != null && (inv ? a < b : a > b), wb = a != null && b != null && (inv ? b < a : b > a);
      return `<div class="cc-tr"><b class="${wa ? 'w' : ''}" style="--c:${CA}">${fm(a)}</b><span>${label}</span><b class="${wb ? 'w' : ''}" style="--c:${CB}">${fm(b)}</b></div>`;
    };
    return `<div class="hx-panel cc-tot">${row('Stagioni', tA.stagioni, tB.stagioni)}${row('Titoli classifica finale', tA.titoli, tB.titoli)}${mode === 'atleta' ? row('Vittorie', tA.vitt, tB.vitt) + row('Podi', tA.podi, tB.podi) : ''}${row('Miglior posizione', tA.best, tB.best, true, v => v + '°')}${row('Punti in carriera (archivio)', tA.pts, tB.pts)}</div>`;
  }

  async function headToHead(keyA, keyB, rA, rB, nameA, nameB) {
    const shared = [];
    for (const a of rA) for (const b of rB) if (a.y === b.y && a.c === b.c && a.p > 0 && b.p > 0 && !a.live) shared.push({ y: a.y, c: a.c });
    const yrs = [...new Set(shared.map(s => s.y))].sort((x, y) => y - x).slice(0, 6);
    const out = [];
    for (const y of yrs) {
      const rc = await loadJson(`data/ciclismo-storico/${y}/races.json`).catch(() => null);
      for (const e of ((rc && rc.races) || [])) {
        for (const [cat, top] of Object.entries(e.categorie || {})) {
          const pa = top.find(x => x.atleta_id === keyA), pb = top.find(x => x.atleta_id === keyB);
          if (pa && pb) out.push({ d: e.data, n: e.nome, id: e.id, a: pa.posizione, b: pb.posizione });
        }
      }
    }
    if (!out.length) return `<div class="hx-panel"><h3 class="cc-h3">Sfide dirette sul podio</h3><div class="hx-none">Nessuna gara in cui siano saliti sul podio insieme negli anni archiviati.</div></div>`;
    out.sort((x, y) => String(y.d).localeCompare(String(x.d)));
    const wa = out.filter(o => o.a < o.b).length, wb = out.filter(o => o.b < o.a).length;
    return `<div class="hx-panel"><h3 class="cc-h3">Sfide dirette sul podio</h3><div class="cc-h2h"><b style="color:${CA}">${wa}</b><span>${out.length} gare in comune sul podio</span><b style="color:${CB}">${wb}</b></div>
      <div class="cc-rows">${out.slice(0, 12).map(o => `<a href="/gara/CIC_${esc(o.id)}"><span>${esc(String(o.d).slice(0, 4))}</span><em>${esc(tc(o.n))}</em><i class="${o.a < o.b ? 'w' : ''}" style="--c:${CA}">${o.a}°</i><i class="${o.b < o.a ? 'w' : ''}" style="--c:${CB}">${o.b}°</i></a>`).join('')}</div></div>`;
  }

  async function render(mode, idA, idB, hostId) {
    const host = document.getElementById(hostId || 'comp-career'); if (!host) return;
    host.innerHTML = '<div class="hx-none" style="padding:16px 0">Carico le carriere…</div>';
    try { await data(); } catch (_) { host.innerHTML = ''; return; }
    if (!cr) { host.innerHTML = ''; return; }
    const fa = mode === 'atleta' ? findAthlete(idA) : findTeam(idA), fb = mode === 'atleta' ? findAthlete(idB) : findTeam(idB);
    const [la, lb] = await Promise.all([liveRow(mode, idA), liveRow(mode, idB)]);
    const rA = seasons(fa.rec, mode).concat(la ? [la] : []), rB = seasons(fb.rec, mode).concat(lb ? [lb] : []);
    const nameA = esc(tc(fa.rec ? fa.rec.n : fa.name)), nameB = esc(tc(fb.rec ? fb.rec.n : fb.name));
    if (!rA.length && !rB.length) { host.innerHTML = `<div class="hx-panel"><div class="hx-none">Per questa coppia non ci sono stagioni nell'archivio storico.</div></div>`; return; }
    const tA = totals(rA, mode), tB = totals(rB, mode);
    const head = (nm, t, col) => `<div class="cc-head" style="--c:${col}"><b>${nm}</b><small>${t.da ? `${t.da}–${t.a}` : 'nessuna stagione'}</small></div>`;
    host.innerHTML = `<section class="cc-sec"><div class="hx-ph"><h2>Carriera a confronto</h2><small>Stagione per stagione, dall'archivio ${cr.from || 2007} a oggi</small></div>
      <div class="cc-heads">${head(nameA, tA, CA)}<span>VS</span>${head(nameB, tB, CB)}</div>
      ${totalsHtml(tA, tB, mode)}${chart(rA, rB, nameA, nameB)}${table(rA, rB, mode)}<div id="cc-h2h"></div>
      <p class="am-note">I punti degli anni archiviati seguono il regolamento di ciclismo.info e non sono confrontabili con quelli della stagione in corso (regolamento ICS). Le vittorie e i podi dell'archivio contano le gare dove l'atleta è tra i primi 3.</p></section>`;
    if (mode === 'atleta' && fa.rec && fb.rec) {
      const h = document.getElementById('cc-h2h');
      if (h) h.innerHTML = await headToHead(fa.key, fb.key, seasons(fa.rec, 'atleta'), seasons(fb.rec, 'atleta'), nameA, nameB);
    }
  }

  window.CmpCareer = { render };
})();
