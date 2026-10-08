/* ============================================================
   ICS — Titoli di campione e medaglie sui profili
   Archivio 2007-2025: data/titoli_campione.json (campioni regionali/italiani), data/medaglie_internazionali.json
   (Europei/Mondiali), data/titoli_stagioni.json (campioni italiani accumulati dallo scraper) + titoli della
   stagione in corso (admin / campionati italiani / medaglie dai risultati inseriti).
   Resa compatta: una "parola" per tipo di titolo con gli anni accanto, ogni anno apre la gara.
   ============================================================ */
'use strict';

(function () {
  const SHORT = ['Esord. 1°', 'Esord. 2°', 'Allievi', 'Juniores', 'Elite U23', 'Donne Esord.', 'Donne Allieve', 'Donne Juniores'];
  let data = null, byAth = null, byTeam = null;

  const norm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const tc = s => String(s || '').toLowerCase().replace(/(^|[\s'’(-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());

  async function load() {
    if (data) return data;
    const d = await loadJson('data/titoli_campione.json').catch(() => null);
    data = (d && d.t) || [];
    byAth = {}; byTeam = {};
    // Medaglie (primi 3) ai Campionati Europei e Mondiali, archivio 2007-2025
    const md = await loadJson('data/medaglie_internazionali.json').catch(() => null);
    for (const r of ((md && md.t) || [])) {
      const t3 = { y: r[0], kind: r[1] ? 'wc' : 'eu', cat: r[2], reg: '', aid: r[5], n: r[6], team: r[7], gid: r[8], gara: r[9], pos: r[4], prova: r[3], arch: true, medal: true };
      (byAth[t3.aid] = byAth[t3.aid] || []).push(t3);
      const k3 = norm(t3.team); if (k3) (byTeam[k3] = byTeam[k3] || []).push(t3);
    }
    // Campioni Italiani delle stagioni successive all'archivio, accumulati dallo scraper (data/titoli_stagioni.json):
    // la stagione in corso e' gia' coperta da collectChampions, quindi si prendono solo gli anni diversi.
    const cur = typeof _loadedSeasonYear === 'function' ? +_loadedSeasonYear() : 0;
    const st = await loadJson('data/titoli_stagioni.json').catch(() => null);
    for (const s of ((st && st.t) || [])) {
      if (s.y === cur) continue;
      const t2 = { y: s.y, kind: 'it', cat: null, catCode: s.catCode, reg: '', aid: s.aid, n: s.n, team: s.team, gid: s.gid, gara: s.gara, pos: 1, prova: s.prova, acc: true };
      (byAth[t2.aid] = byAth[t2.aid] || []).push(t2);
      const k = norm(t2.team); if (k) (byTeam[k] = byTeam[k] || []).push(t2);
    }
    for (const r of data) {
      const t = { y: r[0], kind: r[1] ? 'it' : 'reg', cat: r[2], reg: r[3], aid: r[4], n: r[5], team: r[6], gid: r[7], gara: r[8], pos: r[9], prova: r[10], arch: true };
      (byAth[t.aid] = byAth[t.aid] || []).push(t);
      const k = norm(t.team); if (k) (byTeam[k] = byTeam[k] || []).push(t);
    }
    return data;
  }

  // archivio: id profilo -> id archivio (stesso nome, alias, nome normalizzato)
  function athKey(id) {
    if (byAth[id]) return id;
    const al = window._athAlias && window._athAlias[id]; if (al && byAth[al]) return al;
    const g = globalData && globalData.athletes && globalData.athletes[id];
    if (g) { const k = norm(`${g.cognome || ''} ${g.nome || ''}`); if (byAth[k]) return k; }
    return id;
  }

  // titoli della stagione in corso (ICS): italiani dalle gare + regionali assegnati dall'admin + medaglie Europei/Mondiali
  const INTL = /campionat\w*[^]*?(europe\w*|del mondo|mondial\w*)|(europe\w*|mondial\w*)[^]*?campionat/i;
  function nativeMedals(filter) {
    const out = [];
    try {
      for (const r of (globalData.resultsRaw || [])) {
        if (!r.posizione || r.posizione > 3 || !INTL.test(r.nome_gara || '') || !r.atleta_id) continue;
        if (/squadre|staffetta/i.test(r.nome_gara)) continue;
        if (!filter(r)) continue;
        const code = getRankingFileCode(r) || r.categoria;
        out.push({ y: +String(r.data || '').slice(0, 4), kind: /europe/i.test(r.nome_gara) ? 'eu' : 'wc', cat: null, catCode: code, reg: '', aid: r.atleta_id, n: `${r.cognome || ''} ${r.nome || ''}`.trim(), team: r.team || '', gid: r.gara_id, gara: r.nome_gara, pos: r.posizione, prova: /cronometro/i.test(r.nome_gara) ? 'CRONOMETRO' : 'STRADA', native: true, medal: true });
      }
    } catch (_) { /* ok */ }
    return out;
  }
  const mapNative = (c, id) => ({ y: +c.anno, kind: c.kind, cat: null, catCode: c.categoria, reg: String(c.regione || '').toUpperCase(), aid: id || c.atleta_id || '', n: c.nome, team: c.team || '', gid: c.gara_id, gara: c.nome_gara || '', pos: 1, prova: c.disciplina || 'STRADA', fascia: c.fascia, native: true, did: c.id });
  function nativeFor(id) {
    try { return nativeMedals(r => r.atleta_id === id).concat(collectChampions().filter(c => c.atleta_id === id).map(c => mapNative(c, id))); } catch (_) { return []; }
  }
  function nativeForTeam(teamId) {
    try { return nativeMedals(r => r.team_id === teamId).concat(collectChampions({ teamId }).map(c => mapNative(c))); } catch (_) { return []; }
  }

  function catLabelOf(t) { return t.cat != null ? SHORT[t.cat] : (typeof catLabel === 'function' ? catLabel(t.catCode) : ''); }

  function uniq(list) {
    const seen = new Set();
    return list.filter(t => { const k = `${t.y}|${t.kind}|${t.aid}|${String(t.prova || '')}|${t.medal ? t.pos : ''}|${t.reg}|${t.gid || ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  async function athleteTitles(id) {
    await load();
    const extra = (window._athExtraTitles && window._athExtraTitles[id]) || [];
    return uniq([...nativeFor(id), ...extra, ...(byAth[athKey(id)] || [])]);
  }
  async function teamTitles(teamId) {
    await load();
    const nm = globalData && globalData.teams && globalData.teams[teamId] ? globalData.teams[teamId].nome : teamId;
    return uniq([...nativeForTeam(teamId), ...(byTeam[norm(nm)] || [])]);
  }

  // ── resa compatta ────────────────────────────────────────────
  const JERSEY = (a, b) => `<svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8.3 2.6L4 4.8v4.4h2.1V21h11.8V9.2H20V4.8l-4.3-2.2-1.9 1.8h-3.6L8.3 2.6z" fill="#fff" stroke="rgba(0,0,0,.45)" stroke-width="0.7" stroke-linejoin="round"/><rect x="6.1" y="10.4" width="11.8" height="2.3" fill="${a}"/><rect x="6.1" y="14.6" width="11.8" height="2.3" fill="${b}"/></svg>`;
  // ordine: medaglie (oro/argento/bronzo, Mondiali prima degli Europei), poi italiano, poi regionale
  const GROUPS = [
    { label: 'ORO · MONDIALI', cls: 'g1', icon: '🥇', test: t => t.medal && t.kind === 'wc' && t.pos === 1 },
    { label: 'ORO · EUROPEI', cls: 'g1', icon: '🥇', test: t => t.medal && t.kind === 'eu' && t.pos === 1 },
    { label: 'ARGENTO · MONDIALI', cls: 'g2', icon: '🥈', test: t => t.medal && t.kind === 'wc' && t.pos === 2 },
    { label: 'ARGENTO · EUROPEI', cls: 'g2', icon: '🥈', test: t => t.medal && t.kind === 'eu' && t.pos === 2 },
    { label: 'BRONZO · MONDIALI', cls: 'g3', icon: '🥉', test: t => t.medal && t.kind === 'wc' && t.pos === 3 },
    { label: 'BRONZO · EUROPEI', cls: 'g3', icon: '🥉', test: t => t.medal && t.kind === 'eu' && t.pos === 3 },
    { label: 'CAMPIONE ITALIANO', cls: 'it', icon: JERSEY('#008C45', '#CD212A'), test: t => !t.medal && t.kind === 'it' },
    { label: 'CAMPIONE REGIONALE', cls: 'reg', icon: JERSEY('#2F7FD8', '#2F7FD8'), test: t => !t.medal && t.kind === 'reg' },
  ];
  const raceHref = t => (t.arch && t.gid ? `/gara/CIC_${encodeURIComponent(t.gid)}` : (t.gid ? `/gara/${encodeURIComponent(t.gid)}` : ''));
  function yearLink(t, withName) {
    const prova = t.prova === 'CRONOMETRO' ? 'Cronometro' : (t.prova === 'CRONOSCALATA' ? 'Cronoscalata' : (t.prova === 'CRONOMETRO A SQUADRE' ? 'Crono squadre' : ''));
    const tip = [t.gara ? tc(t.gara) : '', prova, catLabelOf(t), t.reg ? tc(t.reg) : '', withName ? tc(t.n) : ''].filter(Boolean).join(' · ');
    const sup = t.prova === 'CRONOMETRO' ? 'crono' : (t.prova === 'CRONOSCALATA' ? 'scal.' : '');
    const href = raceHref(t);
    const body = `${t.y}${sup ? `<sup>${sup}</sup>` : ''}`;
    const x = t.did != null && authUser()?.role === 'admin' ? `<button class="ttl-x" title="Rimuovi il titolo" onclick="event.preventDefault();event.stopPropagation();window.adminDeleteRegionalTitle(${t.did})">✕</button>` : '';
    return `${href ? `<a class="ttl-yr" href="${href}" title="${esc(tip)}">${body}</a>` : `<span class="ttl-yr" title="${esc(tip)}">${body}</span>`}${x}`;
  }
  function cardsHtml(list, withName) {
    return GROUPS.map(g => {
      const seenK = new Set();
      const items = list.filter(g.test).sort((a, b) => (b.y - a.y) || ((b.gid ? 1 : 0) - (a.gid ? 1 : 0)) || ((b.cat != null || b.catCode ? 1 : 0) - (a.cat != null || a.catCode ? 1 : 0)))
        .filter(t => { const k = `${t.y}|${t.prova}|${withName ? t.aid : ''}`; if (seenK.has(k)) return false; seenK.add(k); return true; });
      if (!items.length) return '';
      return `<div class="ttl-card ttl-card--${g.cls}"><span class="ttl-ic">${g.icon}</span><div class="ttl-body"><b>${g.label}${items.length > 1 ? `<em>×${items.length}</em>` : ''}</b><div class="ttl-yrs">${items.map(t => yearLink(t, withName)).join('')}</div></div></div>`;
    }).join('');
  }

  async function mountAthlete(id, hostId) {
    const host = document.getElementById(hostId); if (!host) return;
    const list = await athleteTitles(id);
    if (!document.getElementById(hostId)) return;
    if (!list.length) { host.innerHTML = ''; return; }
    host.innerHTML = `<section class="ath-block ttl-sec"><div class="ath-block-h"><span>TITOLI E MEDAGLIE</span><i></i></div><div class="ttl-grid">${cardsHtml(list, false)}</div></section>`;
  }

  async function mountTeam(teamId, hostId) {
    const host = document.getElementById(hostId); if (!host) return;
    const list = await teamTitles(teamId);
    if (!document.getElementById(hostId)) return;
    if (!list.length) { host.innerHTML = ''; return; }
    const years = [...new Set(list.map(t => t.y))].sort((a, b) => b - a);
    const det = years.map(y => `<div class="ttl-dr"><b>${y}</b><span>${list.filter(t => t.y === y).map(t => {
      const g = GROUPS.find(x => x.test(t)); const href = t.aid ? `/atleta/${encodeURIComponent(t.aid)}` : '';
      return `<em>${g ? g.label.toLowerCase().replace(/^./, c => c.toUpperCase()) : ''}${catLabelOf(t) ? ' · ' + esc(catLabelOf(t)) : ''}: ${href ? `<a href="${href}">${esc(tc(t.n))}</a>` : esc(tc(t.n))}</em>`;
    }).join('')}</span></div>`).join('');
    host.innerHTML = `<section class="ath-block ttl-sec"><div class="ath-block-h"><span>TITOLI E MEDAGLIE DEI CORRIDORI</span><i></i></div><div class="ttl-grid">${cardsHtml(list, true)}</div>
      <details class="ttl-det"><summary>Chi li ha vinti</summary>${det}</details></section>`;
  }

  // compatibilita': i badge accanto al nome non ci sono piu', restano per non rompere i richiami
  async function yearChipsAthlete() {}
  async function yearChipsTeam() {}

  window.Titoli = { mountAthlete, mountTeam, yearChipsAthlete, yearChipsTeam, athleteTitles, teamTitles };
})();
