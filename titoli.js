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
  const JERSEY = (bands, size) => `<svg width="${size || 22}" height="${size || 22}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8.3 2.6L4 4.8v4.4h2.1V21h11.8V9.2H20V4.8l-4.3-2.2-1.9 1.8h-3.6L8.3 2.6z" fill="#fff" stroke="rgba(0,0,0,.45)" stroke-width="0.7" stroke-linejoin="round"/>${bands.map((c, i) => `<rect x="6.1" y="${10.2 + i * (7.4 / bands.length)}" width="11.8" height="${7.4 / bands.length - .5}" fill="${c}"/>`).join('')}</svg>`;
  const J_IT = ['#008C45', '#CD212A'], J_REG = ['#2F7FD8', '#2F7FD8'], J_EU = ['#1B4DB1', '#F5C400'], J_WC = ['#0072CE', '#E4002B', '#111', '#F5C400', '#00A859'];
  // ordine dentro lo stesso anno: medaglie (oro prima, Mondiali prima degli Europei), poi italiano, poi regionale
  const GROUPS = [
    { label: 'ORO · MONDIALI', cls: 'g1', icon: '🥇', test: t => t.medal && t.kind === 'wc' && t.pos === 1 },
    { label: 'ORO · EUROPEI', cls: 'g1', icon: '🥇', test: t => t.medal && t.kind === 'eu' && t.pos === 1 },
    { label: 'ARGENTO · MONDIALI', cls: 'g2', icon: '🥈', test: t => t.medal && t.kind === 'wc' && t.pos === 2 },
    { label: 'ARGENTO · EUROPEI', cls: 'g2', icon: '🥈', test: t => t.medal && t.kind === 'eu' && t.pos === 2 },
    { label: 'BRONZO · MONDIALI', cls: 'g3', icon: '🥉', test: t => t.medal && t.kind === 'wc' && t.pos === 3 },
    { label: 'BRONZO · EUROPEI', cls: 'g3', icon: '🥉', test: t => t.medal && t.kind === 'eu' && t.pos === 3 },
    { label: 'CAMPIONE ITALIANO', cls: 'it', icon: JERSEY(J_IT, 15), test: t => !t.medal && t.kind === 'it' },
    { label: 'CAMPIONE REGIONALE', cls: 'reg', icon: JERSEY(J_REG, 15), test: t => !t.medal && t.kind === 'reg' },
  ];
  const raceHref = t => (t.arch && t.gid ? `/gara/CIC_${encodeURIComponent(t.gid)}` : (t.gid ? `/gara/${encodeURIComponent(t.gid)}` : ''));
  function provaOf(t) { return t.prova === 'CRONOMETRO' ? 'Cronometro' : (t.prova === 'CRONOSCALATA' ? 'Cronoscalata' : (t.prova === 'CRONOMETRO A SQUADRE' ? 'Crono squadre' : '')); }
  function tipText(t, withName) { return [t.gara ? tc(t.gara) : '', provaOf(t), catLabelOf(t), t.reg ? tc(t.reg) : '', t.y, withName ? tc(t.n) : ''].filter(Boolean).join(' · '); }
  function chipHtml(t, g, withName) {
    const sup = t.prova === 'CRONOMETRO' ? 'crono' : (t.prova === 'CRONOSCALATA' ? 'scal.' : '');
    const surname = withName && t.n ? ` <small>${esc(tc(String(t.n).split(/\s+/)[0]))}</small>` : '';
    const body = `<i>${g.icon}</i>${g.label}${sup ? `<sup>${sup}</sup>` : ''}${surname}`;
    const href = withName && t.aid ? '' : raceHref(t);
    const x = t.did != null && authUser()?.role === 'admin' ? `<button class="ttl-x" title="Rimuovi il titolo" onclick="event.preventDefault();event.stopPropagation();window.adminDeleteRegionalTitle(${t.did})">✕</button>` : '';
    const link = raceHref(t);
    return `${link ? `<a class="ttl-chip ttl-chip--${g.cls}" href="${link}" title="${esc(tipText(t, withName))}">${body}</a>` : `<span class="ttl-chip ttl-chip--${g.cls}" title="${esc(tipText(t, withName))}">${body}</span>`}${x}`;
  }
  // un titolo per riga di anno, dal piu' recente al piu' vecchio
  function yearRowsHtml(list, withName) {
    const years = [...new Set(list.map(t => t.y))].sort((a, b) => b - a);
    return years.map(y => {
      const seenK = new Set();
      const items = [];
      for (const g of GROUPS) {
        list.filter(t => t.y === y && g.test(t))
          .sort((a, b) => ((b.gid ? 1 : 0) - (a.gid ? 1 : 0)) || ((b.cat != null || b.catCode ? 1 : 0) - (a.cat != null || a.catCode ? 1 : 0)))
          .forEach(t => { const k = `${g.label}|${t.prova}|${withName ? t.aid : ''}|${t.reg}`; if (seenK.has(k)) return; seenK.add(k); items.push(chipHtml(t, g, withName)); });
      }
      return items.length ? `<div class="ttl-row"><b>${y}</b><div class="ttl-chips2">${items.join('')}</div></div>` : '';
    }).join('');
  }

  // maglie accanto al nome: solo la stagione in corso, solo campioni (oro europeo/mondiale, italiano, regionale)
  function seasonBadges(list) {
    const cur = typeof _loadedSeasonYear === 'function' ? +_loadedSeasonYear() : new Date().getFullYear();
    const out = [], seen = new Set();
    for (const t of list.filter(x => x.y === cur && (x.pos === 1 || !x.medal))) {
      const kindKey = t.medal ? t.kind : t.kind;
      const label = t.medal ? (t.kind === 'wc' ? 'Campione del mondo' : 'Campione europeo') : (t.kind === 'it' ? 'Campione italiano' : 'Campione regionale');
      const bands = t.kind === 'wc' ? J_WC : (t.kind === 'eu' ? J_EU : (t.kind === 'it' ? J_IT : J_REG));
      const k = `${kindKey}|${t.prova}|${t.medal ? t.pos : ''}`;
      if (seen.has(k)) continue; seen.add(k);
      const tip = `${label} · ${[provaOf(t), catLabelOf(t), t.reg ? tc(t.reg) : '', t.y].filter(Boolean).join(' · ')}`;
      const href = raceHref(t);
      const ic = JERSEY(bands, 22);
      out.push(href ? `<a href="${href}" title="${esc(tip)}">${ic}</a>` : `<span title="${esc(tip)}">${ic}</span>`);
    }
    return out.join('');
  }

  async function mountAthlete(id, hostId) {
    const host = document.getElementById(hostId); if (!host) return;
    const list = await athleteTitles(id);
    const bh = document.getElementById('atleta-champ-badges'); if (bh) bh.innerHTML = seasonBadges(list);
    if (!document.getElementById(hostId)) return;
    if (!list.length) { host.innerHTML = ''; return; }
    host.innerHTML = `<section class="ath-block ttl-sec"><div class="ath-block-h"><span>TITOLI E MEDAGLIE</span><i></i></div><div class="ttl-rows">${yearRowsHtml(list, false)}</div></section>`;
  }

  async function mountTeam(teamId, hostId) {
    const host = document.getElementById(hostId); if (!host) return;
    const list = await teamTitles(teamId);
    const bh = document.getElementById('team-champ-badges'); if (bh) bh.innerHTML = seasonBadges(list);
    if (!document.getElementById(hostId)) return;
    if (!list.length) { host.innerHTML = ''; return; }
    host.innerHTML = `<section class="ath-block ttl-sec"><div class="ath-block-h"><span>TITOLI E MEDAGLIE DEI CORRIDORI</span><i></i></div><div class="ttl-rows">${yearRowsHtml(list, true)}</div></section>`;
  }

  // compatibilita': i badge accanto al nome non ci sono piu', restano per non rompere i richiami
  async function yearChipsAthlete() {}
  async function yearChipsTeam() {}

  window.Titoli = { mountAthlete, mountTeam, yearChipsAthlete, yearChipsTeam, athleteTitles, teamTitles };
})();
