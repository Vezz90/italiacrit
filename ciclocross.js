/* ============================================================
   Italia Cycling Stats — ciclocross.js
   Specialità Ciclocross (stagione ottobre→gennaio, es. "2026/27").
   VISIBILE SOLO ALL'ADMIN finché non è pronta (stesso criterio della pista).
   - Classifica a #/ciclocross: stesse 10 categorie e stessa scala punti della strada
     (BASEPTS × moltiplicatore: regionale 1, nazionale 2, internazionale 3).
   - Interruttore Strada | Ciclocross nella scheda atleta e nella scheda team,
     mostrato solo se il nome ha risultati ciclocross.
   - Il team del ciclocross resta sulla riga del risultato: non tocca il team su strada.
   Dati: data/ciclocross/<stagione>/ (script scraper/cx_import.py).
   ============================================================ */
(function () {
  'use strict';

  const isAdmin = () => { try { return (JSON.parse(localStorage.getItem('italiacrit-user') || 'null') || {}).role === 'admin'; } catch (e) { return false; } };
  const MULT = { Regionale: 1, Nazionale: 2, Internazionale: 3 };
  const CATS = ['ELI_M', 'ELI_F', 'JUN_M', 'JUN_F', 'AL_M', 'AL_F', 'ES2_M', 'ES2_F', 'ES1_M', 'ES1_F'];
  const E = (s) => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const catName = (c) => (typeof catLabel === 'function' ? catLabel(c) : c);
  const pts = (pos, mult) => (pos >= 1 && pos <= 10 ? (BASEPTS[pos] || 0) * mult : 0);
  const normClub = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(A\.?S\.?D\.?|S\.?S\.?D\.?|A\.?S\.?|S\.?R\.?L\.?|S\.?P\.?A\.?|ASD|SSD|TEAM|CICLISMO|ASS\.?)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ').trim();
  // Chi corre solo il ciclocross non ha (ancora) una scheda atleta: niente link per lui
  const hasAth = (id) => { try { return !!(globalData && globalData.athletes && globalData.athletes[id]); } catch (e) { return false; } };
  const fmtDate = (d) => { const p = String(d || '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : (d || ''); };
  const seasonLabel = (k) => String(k).replace('-', '/');

  // ── Dati ─────────────────────────────────────────────────────────
  let _index = null;
  const _seasons = {};
  async function getJson(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }
  async function loadIndex() { if (!_index) _index = await getJson('/data/ciclocross/index.json'); return _index; }

  async function loadSeason(key) {
    if (_seasons[key]) return _seasons[key];
    const base = `/data/ciclocross/${key}/`;
    const [cal, res] = await Promise.all([getJson(base + 'calendar.json'), getJson(base + 'results.json')]);
    const gare = {};
    for (const g of cal) gare[g.fci_id] = g;
    const rows = [];
    for (const r of res) {
      const g = gare[r.gara]; if (!g) continue;
      const pos = parseInt(r.pos, 10);
      if (!(pos >= 1)) continue;
      rows.push({ ...r, pos, mult: MULT[g.geo] || 1, punti: pts(pos, MULT[g.geo] || 1), garaNome: g.nome, geo: g.geo, club_n: normClub(r.club) });
    }
    const byAth = {}, byClub = {};
    for (const r of rows) {
      (byAth[r.atleta_id] ||= []).push(r);
      if (r.club_n) (byClub[r.club_n] ||= []).push(r);
    }
    return (_seasons[key] = { key, gare, rows, byAth, byClub });
  }

  // ── Calcolo classifiche ──────────────────────────────────────────
  function rankAthletes(S, cat) {
    const m = {};
    for (const r of S.rows) {
      if (r.cat !== cat) continue;
      const a = (m[r.atleta_id] ||= { id: r.atleta_id, nome: r.nome, club: r.club, punti: 0, gare: 0, vit: 0, pod: 0 });
      a.punti += r.punti; a.gare++; if (r.pos === 1) a.vit++; if (r.pos <= 3) a.pod++;
      a.club = r.club; // ultimo team visto (sulla riga del risultato)
    }
    return Object.values(m).sort((x, y) => y.punti - x.punti || y.vit - x.vit || y.pod - x.pod || x.nome.localeCompare(y.nome));
  }
  function rankClubs(S, cat) {
    const m = {};
    for (const r of S.rows) {
      if (cat && r.cat !== cat) continue;
      if (!r.club_n) continue;
      const c = (m[r.club_n] ||= { n: r.club_n, nome: r.club, punti: 0, atleti: new Set(), vit: 0, pod: 0 });
      c.punti += r.punti; c.atleti.add(r.atleta_id); if (r.pos === 1) c.vit++; if (r.pos <= 3) c.pod++;
    }
    return Object.values(m).sort((x, y) => y.punti - x.punti || y.vit - x.vit || x.nome.localeCompare(y.nome));
  }

  // ── Interfaccia ──────────────────────────────────────────────────
  const CSS = `
  .cx-switch{display:inline-flex;gap:4px;padding:4px;border-radius:999px;background:var(--bg-card,#f3f3f3);border:1px solid var(--border,#ddd);margin:0 0 14px}
  .cx-switch button,.cx-switch a{border:0;background:transparent;color:var(--text-secondary,#555);font:600 .82rem/1 inherit;padding:8px 16px;border-radius:999px;cursor:pointer;text-decoration:none}
  .cx-switch .on{background:var(--accent,#1a73e8);color:#fff}
  .cx-wrap{max-width:1000px;margin:0 auto;padding:16px}
  .cx-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 16px}
  .cx-tabs button{border:1px solid var(--border,#ddd);background:var(--bg-card,#fff);color:var(--text-primary,#222);padding:6px 12px;border-radius:8px;font-size:.8rem;cursor:pointer}
  .cx-tabs button.on{background:var(--accent,#1a73e8);color:#fff;border-color:transparent}
  .cx-tbl{width:100%;border-collapse:collapse;font-size:.88rem}
  .cx-tbl th{text-align:left;font-size:.72rem;letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted,#888);padding:6px 8px;border-bottom:1px solid var(--border,#ddd)}
  .cx-tbl td{padding:8px;border-bottom:1px solid var(--border,#eee)}
  .cx-tbl td.n,.cx-tbl th.n{text-align:right;font-variant-numeric:tabular-nums}
  .cx-box{overflow-x:auto}
  .cx-note{font-size:.78rem;color:var(--text-muted,#888);margin:6px 0 14px}
  .cx-badge{display:inline-block;padding:2px 8px;border-radius:6px;background:rgba(120,120,120,.15);font-size:.72rem;font-weight:700}
  `;
  function ensureCss() { if (!document.getElementById('cx-css')) { const s = document.createElement('style'); s.id = 'cx-css'; s.textContent = CSS; document.head.appendChild(s); } }
  const root = () => document.getElementById('app');
  const goto = (path) => { location.hash = '#' + path; };

  function switchBar(active, onStrada, onCx) {
    const w = document.createElement('div');
    w.className = 'cx-switch'; w.setAttribute('role', 'tablist');
    const mk = (label, on, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (on) b.className = 'on'; b.onclick = fn; return b; };
    w.appendChild(mk('Strada', active === 'strada', onStrada));
    w.appendChild(mk('Ciclocross', active === 'cx', onCx));
    return w;
  }

  // Classifica ciclocross: #/ciclocross
  async function renderClassificaCx(seasonKey, cat) {
    const el = root(); if (!el) return;
    ensureCss();
    el.innerHTML = '<div class="cx-wrap">Caricamento ciclocross…</div>';
    try {
      const idx = await loadIndex();
      const key = seasonKey || idx.current;
      const S = await loadSeason(key);
      cat = cat || 'ELI_M';
      const list = rankAthletes(S, cat);
      const clubs = rankClubs(S, cat);
      const wrap = document.createElement('div'); wrap.className = 'cx-wrap';
      wrap.appendChild(switchBar('cx', () => goto('/classifica'), () => {}));
      const h = document.createElement('h1');
      h.innerHTML = `Classifica Ciclocross ${E(seasonLabel(key))} <span class="cx-badge">solo admin</span>`;
      wrap.appendChild(h);
      const note = document.createElement('p'); note.className = 'cx-note';
      note.textContent = 'Stessa scala punti e stesse categorie della strada. La stagione va da ottobre a gennaio.';
      wrap.appendChild(note);
      if ((idx.seasons || []).length > 1) {
        const sel = document.createElement('select');
        sel.innerHTML = idx.seasons.map(s => `<option value="${E(s)}"${s === key ? ' selected' : ''}>${E(seasonLabel(s))}</option>`).join('');
        sel.onchange = () => renderClassificaCx(sel.value, cat);
        wrap.appendChild(sel);
      }
      const tabs = document.createElement('div'); tabs.className = 'cx-tabs';
      for (const c of CATS) { const b = document.createElement('button'); b.textContent = catName(c); if (c === cat) b.className = 'on'; b.onclick = () => renderClassificaCx(key, c); tabs.appendChild(b); }
      wrap.appendChild(tabs);
      const box = document.createElement('div'); box.className = 'cx-box';
      box.innerHTML = `<h2>Atleti</h2><table class="cx-tbl"><thead><tr><th>#</th><th>Atleta</th><th>Team</th><th class="n">Gare</th><th class="n">Vitt.</th><th class="n">Punti</th></tr></thead><tbody>`
        + list.slice(0, 100).map((a, i) => `<tr><td>${i + 1}</td><td>${hasAth(a.id) ? `<a href="/atleta/${encodeURIComponent(a.id)}">${E(a.nome)}</a>` : E(a.nome)}</td><td>${E(a.club)}</td><td class="n">${a.gare}</td><td class="n">${a.vit}</td><td class="n"><b>${a.punti}</b></td></tr>`).join('')
        + `</tbody></table>` + (list.length ? '' : '<p class="cx-note">Nessun risultato in questa categoria.</p>');
      wrap.appendChild(box);
      const box2 = document.createElement('div'); box2.className = 'cx-box';
      box2.innerHTML = `<h2>Team</h2><table class="cx-tbl"><thead><tr><th>#</th><th>Team</th><th class="n">Atleti</th><th class="n">Vitt.</th><th class="n">Punti</th></tr></thead><tbody>`
        + clubs.slice(0, 50).map((c, i) => `<tr><td>${i + 1}</td><td>${E(c.nome)}</td><td class="n">${c.atleti.size}</td><td class="n">${c.vit}</td><td class="n"><b>${c.punti}</b></td></tr>`).join('')
        + `</tbody></table>`;
      wrap.appendChild(box2);
      el.innerHTML = ''; el.appendChild(wrap);
      document.title = `Classifica Ciclocross ${seasonLabel(key)}`;
      window.scrollTo(0, 0);
    } catch (e) {
      el.innerHTML = `<div class="cx-wrap">Dati ciclocross non disponibili (${E(e.message)}).</div>`;
    }
  }

  function resultsTable(rows) {
    const sorted = rows.slice().sort((a, b) => (b.data || '').localeCompare(a.data || ''));
    return `<div class="cx-box"><table class="cx-tbl"><thead><tr><th>Data</th><th>Gara</th><th>Cat.</th><th>Team</th><th class="n">Pos.</th><th class="n">Punti</th></tr></thead><tbody>`
      + sorted.map(r => `<tr><td>${E(fmtDate(r.data))}</td><td>${E(r.garaNome)} <span class="cx-badge">${E(r.geo)}</span></td><td>${E(catName(r.cat))}</td><td>${E(r.club)}</td><td class="n">${r.pos}</td><td class="n">${r.punti || ''}</td></tr>`).join('')
      + `</tbody></table></div>`;
  }

  // Cerca i risultati ciclocross di un atleta in tutte le stagioni (più recente prima)
  async function athleteCx(id) {
    const idx = await loadIndex();
    const out = [];
    for (const k of (idx.seasons || []).slice().reverse()) { const S = await loadSeason(k); if (S.byAth[id]) out.push({ S, rows: S.byAth[id] }); }
    return out;
  }
  async function teamCx(teamNome) {
    const idx = await loadIndex(); const n = normClub(teamNome); const out = [];
    if (!n) return out;
    for (const k of (idx.seasons || []).slice().reverse()) { const S = await loadSeason(k); if (S.byClub[n]) out.push({ S, rows: S.byClub[n] }); }
    return out;
  }

  // Inserisce l'interruttore in cima alla pagina atleta/team e, a richiesta, il pannello ciclocross
  function mountSwitch(data, buildPanel, reRenderRoad) {
    const el = root(); if (!el || !data.length) return;
    ensureCss();
    const host = el.firstElementChild; if (!host) return;
    const bar = switchBar('strada', () => {}, async () => {
      const panel = document.createElement('div'); panel.className = 'cx-wrap';
      panel.appendChild(switchBar('cx', () => reRenderRoad(), () => {}));
      panel.insertAdjacentHTML('beforeend', buildPanel(data));
      el.innerHTML = ''; el.appendChild(panel); window.scrollTo(0, 0);
    });
    bar.style.cssText = 'margin:10px 16px 0';
    el.insertBefore(bar, host);
  }

  function athletePanel(data) {
    return data.map(({ S, rows }) => {
      const byCat = {};
      for (const r of rows) (byCat[r.cat] ||= []).push(r);
      const tot = rows.reduce((s, r) => s + r.punti, 0), vit = rows.filter(r => r.pos === 1).length, pod = rows.filter(r => r.pos <= 3).length;
      const cats = Object.keys(byCat).map(c => {
        const pos = rankAthletes(S, c).findIndex(a => a.id === rows[0].atleta_id) + 1;
        return `${E(catName(c))}: ${pos}°`;
      }).join(' · ');
      return `<h2>Ciclocross ${E(seasonLabel(S.key))} <span class="cx-badge">solo admin</span></h2>`
        + `<p class="cx-note">${rows.length} gare · ${vit} vittorie · ${pod} podi · <b>${tot}</b> punti — in classifica: ${cats}</p>` + resultsTable(rows);
    }).join('');
  }
  function teamPanel(data) {
    return data.map(({ S, rows }) => {
      const m = {};
      for (const r of rows) { const a = (m[r.atleta_id] ||= { id: r.atleta_id, nome: r.nome, punti: 0, gare: 0, vit: 0 }); a.punti += r.punti; a.gare++; if (r.pos === 1) a.vit++; }
      const ath = Object.values(m).sort((x, y) => y.punti - x.punti);
      const tot = ath.reduce((s, a) => s + a.punti, 0);
      return `<h2>Ciclocross ${E(seasonLabel(S.key))} <span class="cx-badge">solo admin</span></h2>`
        + `<p class="cx-note">${ath.length} atleti · <b>${tot}</b> punti</p>`
        + `<div class="cx-box"><table class="cx-tbl"><thead><tr><th>Atleta</th><th class="n">Gare</th><th class="n">Vitt.</th><th class="n">Punti</th></tr></thead><tbody>`
        + ath.map(a => `<tr><td>${hasAth(a.id) ? `<a href="/atleta/${encodeURIComponent(a.id)}">${E(a.nome)}</a>` : E(a.nome)}</td><td class="n">${a.gare}</td><td class="n">${a.vit}</td><td class="n"><b>${a.punti}</b></td></tr>`).join('')
        + `</tbody></table></div><h3>Risultati</h3>` + resultsTable(rows);
    }).join('');
  }

  // ── Aggancio alle pagine esistenti (senza toccarne il codice) ─────
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
  function init() {
    wrap('renderAtleta', async (id) => {
      const data = await athleteCx(id);
      mountSwitch(data, athletePanel, () => window.renderAtleta(id));
    });
    wrap('renderTeam', async (tid) => {
      const t = (typeof globalData !== 'undefined' && globalData && globalData.teams) ? globalData.teams[tid] : null;
      const data = await teamCx(t && t.nome);
      mountSwitch(data, teamPanel, () => window.renderTeam(tid));
    });
    wrap('renderClassifica', async () => {
      const el = root(); if (!el || !el.firstElementChild) return;
      ensureCss();
      const bar = switchBar('strada', () => {}, () => goto('/ciclocross'));
      bar.style.cssText = 'margin:10px 16px 0';
      el.insertBefore(bar, el.firstElementChild);
    });
    window.cxRenderClassifica = () => (isAdmin() ? renderClassificaCx() : undefined);
  }
  init();
})();
