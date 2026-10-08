/* ============================================================
   ICS — Titoli di campione (regionali e italiani) sui profili
   Archivio 2007-2025: data/titoli_campione.json (da scripts/scrape_campioni_regionali.py +
   scripts/build_titoli.py) + titoli della stagione in corso (admin / campionati italiani).
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

  // titoli della stagione in corso (ICS): italiani dalle gare + regionali assegnati dall'admin
  function nativeFor(id) {
    try {
      return collectChampions().filter(c => c.atleta_id === id).map(c => ({ y: +c.anno, kind: c.kind, cat: null, catCode: c.categoria, reg: String(c.regione || '').toUpperCase(), aid: id, n: c.nome, team: c.team || '', gid: c.gara_id, gara: c.nome_gara || '', pos: 1, prova: c.disciplina || 'STRADA', fascia: c.fascia, native: true }));
    } catch (_) { return []; }
  }
  function nativeForTeam(teamId) {
    try { return collectChampions({ teamId }).map(c => ({ y: +c.anno, kind: c.kind, cat: null, catCode: c.categoria, reg: String(c.regione || '').toUpperCase(), aid: c.atleta_id || '', n: c.nome, team: c.team || '', gid: c.gara_id, gara: c.nome_gara || '', pos: 1, prova: c.disciplina || 'STRADA', native: true })); } catch (_) { return []; }
  }

  function catLabelOf(t) { return t.cat != null ? SHORT[t.cat] : (typeof catLabel === 'function' ? catLabel(t.catCode) : ''); }

  function chip(t, withName) {
    const extra = [catLabelOf(t), t.reg ? tc(t.reg) : '', withName ? tc(t.n) : ''].filter(Boolean).join(' · ');
    const href = withName && t.aid ? `/atleta/${encodeURIComponent(t.aid)}` : (t.arch && t.gid ? `/gara/CIC_${encodeURIComponent(t.gid)}` : (t.gid ? `/gara/${encodeURIComponent(t.gid)}` : null));
    const prova = t.prova && t.prova !== 'STRADA' ? tc(t.prova).replace(' A ', ' a ') : '';
    return championChipHtml({ kind: t.kind, disciplina: prova, anno: t.y, extra, title: `${t.gara ? tc(t.gara) + ' — ' : ''}${t.y}`, href });
  }

  function summary(list) {
    const reg = list.filter(t => t.kind === 'reg').length, it = list.filter(t => t.kind === 'it').length;
    const parts = [];
    if (reg) parts.push(`<b>${reg}</b> ${reg === 1 ? 'titolo regionale' : 'titoli regionali'}`);
    if (it) parts.push(`<b>${it}</b> ${it === 1 ? 'titolo italiano' : 'titoli italiani'}`);
    return parts.join(' · ');
  }

  function uniq(list) {
    const seen = new Set();
    return list.filter(t => { const k = `${t.y}|${t.kind}|${t.aid}|${t.catCode || t.cat}|${t.prova}|${t.reg}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  async function athleteTitles(id) {
    await load();
    return uniq([...nativeFor(id), ...(byAth[athKey(id)] || [])]).sort((a, b) => b.y - a.y || (a.kind === 'it' ? -1 : 1));
  }
  async function teamTitles(teamId) {
    await load();
    const nm = globalData && globalData.teams && globalData.teams[teamId] ? globalData.teams[teamId].nome : teamId;
    return uniq([...nativeForTeam(teamId), ...(byTeam[norm(nm)] || [])]).sort((a, b) => b.y - a.y || (a.kind === 'it' ? -1 : 1));
  }

  async function mountAthlete(id, hostId) {
    const host = document.getElementById(hostId); if (!host) return;
    const list = await athleteTitles(id);
    if (!document.getElementById(hostId)) return;
    if (!list.length) { host.innerHTML = ''; return; }
    host.innerHTML = `<section class="ath-block ttl-sec"><div class="ath-block-h"><span>TITOLI DI CAMPIONE</span><i></i></div>
      <p class="ath-moment-note ttl-sum">${summary(list)}</p><div class="ttl-chips">${list.map(t => chip(t, false)).join('')}</div></section>`;
  }

  async function mountTeam(teamId, hostId) {
    const host = document.getElementById(hostId); if (!host) return;
    const list = await teamTitles(teamId);
    if (!document.getElementById(hostId)) return;
    if (!list.length) { host.innerHTML = ''; return; }
    const years = [...new Set(list.map(t => t.y))].sort((a, b) => b - a);
    host.innerHTML = `<section class="ath-block ttl-sec"><div class="ath-block-h"><span>TITOLI DI CAMPIONE</span><i></i></div>
      <p class="ath-moment-note ttl-sum">${summary(list)} vinti da corridori della squadra</p>
      <div class="ttl-years">${years.map(y => `<div class="ttl-y"><b>${y}</b><div class="ttl-chips">${list.filter(t => t.y === y).map(t => chip(t, true)).join('')}</div></div>`).join('')}</div></section>`;
  }

  // badge dell'anno che si sta guardando (vista storica del profilo)
  async function yearChipsAthlete(id, anno, hostId) {
    const host = document.getElementById(hostId); if (!host) return;
    const list = (await athleteTitles(id)).filter(t => String(t.y) === String(anno));
    host.innerHTML = list.map(t => chip(t, false)).join('');
  }
  async function yearChipsTeam(teamId, anno, hostId) {
    const host = document.getElementById(hostId); if (!host) return;
    const list = (await teamTitles(teamId)).filter(t => String(t.y) === String(anno));
    host.innerHTML = list.length ? `<div class="ttl-chips" style="margin:10px 0">${list.map(t => chip(t, true)).join('')}</div>` : '';
  }

  window.Titoli = { mountAthlete, mountTeam, yearChipsAthlete, yearChipsTeam, athleteTitles, teamTitles };
})();
