'use strict';
// Archivio completo per la Redazione: tutto cio che il sito ha raccolto (file in data/ e tabelle degli scraper),
// ridotto a blocchi di DATI compatti e gia calcolati. L'AI non fa conti e non vede dati personali non sportivi.
//
// Blocchi: storico (nazionale o regione, 2007-2025), squadra (storia e stagione), calendario (prossime gare),
// pro (gare professionistiche in Italia), medaglie (internazionali), piu gli arricchimenti per gara e atleta.

const CAT_ALM = ['ESORDIENTI1', 'ESORDIENTI2', 'ALLIEVI', 'JUNIORES', 'ELITE_UNDER23', 'DONNE_ESORDIENTI', 'DONNE_ALLIEVE', 'DONNE_JUNIORES'];
// codici del sito: servono anche alla tutela dei minorenni (un blocco con categorie giovanili spegne il web)
const COD_ALM = { ESORDIENTI1: 'ES1_M', ESORDIENTI2: 'ES2_M', ALLIEVI: 'AL_M', JUNIORES: 'JUN_M', ELITE_UNDER23: 'ELI_M', DONNE_ESORDIENTI: 'ES2_F', DONNE_ALLIEVE: 'AL_F', DONNE_JUNIORES: 'JUN_F' };
const NOME_ALM = { ESORDIENTI1: 'Esordienti 1° anno', ESORDIENTI2: 'Esordienti 2° anno', ALLIEVI: 'Allievi', JUNIORES: 'Juniores', ELITE_UNDER23: 'Elite/Under 23 uomini',
  DONNE_ESORDIENTI: 'Esordienti donne', DONNE_ALLIEVE: 'Allieve', DONNE_JUNIORES: 'Juniores donne' };
const ALM_DA_CODICE = { ES1_M: 'ESORDIENTI1', ES2_M: 'ESORDIENTI2', AL_M: 'ALLIEVI', JUN_M: 'JUNIORES', ELI_M: 'ELITE_UNDER23', ES1_F: 'DONNE_ESORDIENTI', ES2_F: 'DONNE_ESORDIENTI', AL_F: 'DONNE_ALLIEVE', JUN_F: 'DONNE_JUNIORES' };
const GIOVANILI = new Set(['ESORDIENTI1', 'ESORDIENTI2', 'ALLIEVI', 'JUNIORES', 'DONNE_ESORDIENTI', 'DONNE_ALLIEVE', 'DONNE_JUNIORES']);

const PAROLE_SOCIETA = new Set(['TEAM', 'A.S.D', 'ASD', 'S.C', 'G.S', 'U.C', 'CLUB', 'CICLISTICA', 'CICLISTICO', 'CICLISMO', 'SPORTIVA', 'ASSOCIAZIONE', 'DILETTANTISTICA', 'VELO', 'GRUPPO', 'SPORTIVO', 'SOCIETA', 'CYCLING', 'RACING']);
const norm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
const bello = s => String(s || '').toLowerCase().replace(/(^|[\s'’.-])(\S)/g, (m, a, b) => a + b.toUpperCase()).trim();

// categorie nominate in un riferimento libero ("storico allievi", "ELI_F", "donne juniores"); vuoto = tutte
function categorieDa(rif) {
  const t = ' ' + norm(rif) + ' ', out = new Set();
  for (const m of String(rif || '').toUpperCase().matchAll(/\b(ES1|ES2|AL|JUN|ELI)_([MF])\b/g)) out.add(ALM_DA_CODICE[m[0]]);
  const donne = /\b(DONNE|FEMMINIL\w*|ALLIEVE)\b/.test(t), uomini = /\b(UOMINI|MASCHIL\w*)\b/.test(t);
  const add = (m, f) => { if (!donne || uomini) m && out.add(m); if (donne || (!uomini && f)) f && out.add(f); };
  if (/\bESORDIENT/.test(t)) { if (/\b(1|PRIMO)\b/.test(t)) add('ESORDIENTI1', 'DONNE_ESORDIENTI'); else if (/\b(2|SECONDO)\b/.test(t)) add('ESORDIENTI2', 'DONNE_ESORDIENTI'); else { add('ESORDIENTI1', 'DONNE_ESORDIENTI'); add('ESORDIENTI2', null); } }
  if (/\bALLIEV/.test(t)) add('ALLIEVI', 'DONNE_ALLIEVE');
  if (/\bJUNIOR/.test(t)) add('JUNIORES', 'DONNE_JUNIORES');
  if (/\b(ELITE|UNDER|U23|DILETTANT)/.test(t)) add('ELITE_UNDER23', null);
  return [...out].filter(Boolean);
}

// sintesi di un almanacco (nazionale o regionale): niente conti per l'AI, tutto in chiaro e con i codici di categoria
function sintesiAlmanacco(alm, { categorie = [], regione = null, maxAnni = 19 } = {}) {
  if (!alm || !alm.perYear) throw new Error('almanacco non disponibile');
  const cats = Array.isArray(alm.cats) && alm.cats.length ? alm.cats : CAT_ALM;
  const vuole = c => !categorie.length || categorie.includes(c);
  const nomeCat = i => cats[i];
  const anni = Object.keys(alm.perYear).map(Number).filter(Number.isFinite).sort((a, b) => a - b).slice(-maxAnni);
  const albo = {};
  for (const y of anni) {
    const py = alm.perYear[y] || {};
    for (const [c, v] of Object.entries(py.champs || {})) {
      if (!vuole(c) || !v) continue;
      (albo[c] = albo[c] || []).push({ anno: y, numero_uno: bello(v.n), squadra: bello(v.t), punti: v.p, punti_del_secondo: v.p2 != null ? v.p2 : null });
    }
    for (const [c, v] of Object.entries(py.teamChamps || {})) {
      if (!vuole(c) || !v) continue;
      const k = c + '__team'; (albo[k] = albo[k] || []).push({ anno: y, squadra_prima: bello(v.n), punti: v.p != null ? v.p : null });
    }
  }
  const perCat = Object.keys(albo).filter(k => !k.endsWith('__team')).map(c => ({
    categoria: NOME_ALM[c] || c, codice: COD_ALM[c] || null, numeri_uno_per_anno: albo[c], squadre_prime_per_anno: albo[c + '__team'] || [],
  }));
  const titoli = arr => (arr || []).map(([y, ci, p]) => ({ anno: y, categoria: NOME_ALM[nomeCat(ci)] || nomeCat(ci), punti: p })).filter(x => !categorie.length || categorie.includes(Object.keys(NOME_ALM).find(k => NOME_ALM[k] === x.categoria)));
  const sel = (arr, n, f) => (arr || []).map(f).filter(Boolean).slice(0, n);
  const garePerAnno = src => (src.racesPerYear || []).filter(r => anni.includes(r.y) && r.n).map(r => ({ anno: r.y, gare: r.n }));
  const conCat = (s, extra) => (!categorie.length || categorie.includes(nomeCat(s.c))) ? Object.assign(extra, { categoria: NOME_ALM[nomeCat(s.c)] || nomeCat(s.c) }) : null;
  // record calcolati su una sorgente: l'almanacco intero (tutte le categorie insieme) o quello di una sola categoria
  const record = src => ({
    gare_per_anno: garePerAnno(src),
    piu_vittorie: sel(src.winsTop, 10, a => ({ atleta: bello(a.n), vittorie: a.w, podi: a.p, dal: a.y && a.y[0], al: a.y && a.y[1] })),
    piu_podi: sel(src.podiTop, 6, a => ({ atleta: bello(a.n), podi: a.p, vittorie: a.w })),
    squadre_dinastia: sel(src.dynasties, 8, d => { const t = titoli(d.titles); return t.length ? { squadra: bello(d.team), stagioni_da_prima: t, stagioni_di_fila_al_massimo: d.streak } : null; }),
    stagioni_record_atleti: sel(src.bestSeasons, 10, s => conCat(s, { atleta: bello(s.n), anno: s.y, punti: s.p })),
    stagioni_record_squadre: sel(src.bestTeamSeasons, 8, s => conCat(s, { squadra: bello(s.team), anno: s.y, punti: s.p })),
    scalate_piu_grandi: sel(src.rises, 6, r => conCat(r, { atleta: bello(r.n), anno: r.y, da_posizione: r.from, a_posizione: r.to })),
  });
  const out = {
    nota: `archivio storico ${alm.from}-${alm.to} del sito${regione ? ' per la regione ' + bello(regione) : ' (tutta Italia)'}: classifiche a punti di fine stagione, vittorie e podi sono quelli registrati nell'archivio (fonte storica diversa dai risultati federali della stagione in corso: i punti e il numero di gare della stagione in corso NON si confrontano 1:1 con quelli di questo archivio). "numero_uno" e il primo della classifica di fine stagione, NON un campione italiano. Il 2020 ha poche gare per la pandemia. Ogni dato vale SOLO per la categoria indicata accanto: i dati "tutte_le_categorie_insieme" sommano esordienti, allievi, juniores ed elite e non vanno mai attribuiti a una sola categoria.`,
    ambito: regione ? 'regione ' + bello(regione) : 'Italia', anni: [alm.from, alm.to],
    categorie_comprese: (categorie.length ? categorie : cats).map(c => ({ categoria: NOME_ALM[c] || c, codice: COD_ALM[c] || null })),
    albo_dei_numeri_uno: perCat,
    numeri_uno_in_piu_categorie: sel(alm.hall, 10, a => { const t = titoli(a.titles); return t.length > 1 || !categorie.length ? (t.length ? { atleta: bello(a.n), stagioni_da_numero_uno: t } : null) : null; }),
  };
  // con una o piu categorie scelte: i record sono quelli DI QUELLA categoria (almanacco per categoria); senza scelta: totali dichiarati come tali
  const perCategoria = alm.cat ? Object.entries(alm.cat).filter(([c]) => vuole(c)) : [];
  if (categorie.length && perCategoria.length) {
    out.record_per_categoria = perCategoria.map(([c, v]) => Object.assign({ categoria: NOME_ALM[c] || c, codice: COD_ALM[c] || null,
      totali: v.counts ? { atleti: v.counts.athletes, squadre: v.counts.teams, gare: v.counts.races } : null }, record(v)));
  } else {
    out.tutte_le_categorie_insieme = Object.assign({ totali: alm.counts || null }, record(alm));
    if (perCategoria.length) out.per_categoria = perCategoria.map(([c, v]) => ({ categoria: NOME_ALM[c] || c, codice: COD_ALM[c] || null, gare_per_anno: garePerAnno(v),
      piu_vittorie: sel(v.winsTop, 5, a => ({ atleta: bello(a.n), vittorie: a.w, dal: a.y && a.y[0], al: a.y && a.y[1] })) }));
  }
  if (alm.teamsTop) out.squadre_piu_vincenti = sel(alm.teamsTop, 8, t => ({ squadra: bello(t.n || t.team), vittorie: t.w, podi: t.p }));
  if ((out.categorie_comprese || []).some(c => GIOVANILI.has(Object.keys(COD_ALM).find(k => COD_ALM[k] === c.codice)))) out.categorie_giovanili = true;
  return out;
}

// scheda FCI della gara: SOLO dati di corsa (percorso, km, orari, luoghi). Telefoni, email, indirizzi e nomi degli organizzatori NON passano.
function schedaFci(info) {
  const testo = (Array.isArray(info) ? info.join(' ') : String(info || ''));
  const campi = {}, re = /<b>([^<:]{2,40}):<\/b>\s*([^<]*)/g; let m;
  while ((m = re.exec(testo))) { const k = m[1].trim(), v = m[2].replace(/\s+/g, ' ').trim(); if (v && !(k in campi)) campi[k] = v; }
  const tieni = { 'Località': 'localita', 'Provincia': 'provincia', 'Categoria': 'categoria', 'Categorie Ammesse': 'categorie_ammesse', 'Categoria Geografica': 'livello', 'Tipo di Gara': 'tipo_di_gara',
    'Tipo di Programma': 'programma', 'Descrizione': 'percorso', 'Orario Partenza': 'orario_partenza', 'Luogo Arrivo': 'arrivo', 'Orario Arrivo': 'orario_arrivo', 'Lunghezza KM': 'km', 'Data': 'data' };
  const out = {};
  for (const [k, v] of Object.entries(tieni)) if (campi[k]) out[v] = campi[k];
  if (out.percorso) out.percorso = out.percorso.replace(/\S+@\S+/g, '').replace(/\+?\d[\d\s/.-]{7,}\d/g, '').replace(/\s+/g, ' ').trim().slice(0, 900);   // per sicurezza: niente email o numeri di telefono finiti nel testo
  if (out.km) { const n = parseFloat(out.km.replace(/\./g, '').replace(',', '.')); if (Number.isFinite(n)) out.km = Math.round(n * 10) / 10; }
  const ed = testo.match(/^\s*(\d{1,3})\s*[\^°ª]/); if (ed) out.edizione = Number(ed[1]);
  return Object.keys(out).length ? out : null;
}

// racconto di gara gia scritto per il sito (tabella gara_narratives): testo ripulito e corto
const racconto = t => String(t || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2500);

function creaArchivio({ getData, sb, rawQuery, today }) {
  const q = async (sql, par) => { const r = await rawQuery(sql, par); return Array.isArray(r) ? r : (r && r.rows) || []; };

  async function factsStorico(rif) {
    const r = String(rif || '').trim(), categorie = categorieDa(r);
    let regione = null, alm;
    try {
      const idx = await getData('almanacco_regioni/index.json'), t = ' ' + norm(r) + ' ';
      const hit = (idx.regions || []).find(g => t.includes(' ' + norm(g.name) + ' ') || t.includes(' ' + norm(g.slug).replace(/ /g, ' ') + ' '));
      if (hit) { regione = hit.name; alm = await getData(`almanacco_regioni/${hit.slug}.json`); }
    } catch (_) { /* senza regioni: nazionale */ }
    if (!alm) alm = await getData('almanacco.json');
    return sintesiAlmanacco(alm, { categorie, regione });
  }

  // nomi di squadra collegati dall'admin (team_lineage confermati, data/team_lineage.json): tutti i nomi di un gruppo sono la stessa societa
  let _gruppi = null;
  async function gruppiNomi() {
    if (_gruppi && Date.now() - _gruppi.at < 10 * 60000) return _gruppi.f;
    let arr = []; try { arr = await getData('team_lineage.json'); } catch (_) { /* senza collegamenti: ogni nome e una squadra */ }
    const padre = new Map();
    const trova = x => { if (!padre.has(x)) padre.set(x, x); let r = x; while (padre.get(r) !== r) r = padre.get(r); while (padre.get(x) !== r) { const n = padre.get(x); padre.set(x, r); x = n; } return r; };
    (Array.isArray(arr) ? arr : []).forEach(l => { const ka = norm(l[0]), kb = norm(l[2]); if (ka && kb) padre.set(trova(ka), trova(kb)); });
    const f = nome => { const k = norm(nome); return padre.has(k) ? trova(k) : k; };
    _gruppi = { at: Date.now(), f }; return f;
  }

  async function storiaSquadra(parole, stessa) {
    const out = [];
    for (let y = 2007; y <= 2025; y++) {
      let ct; try { ct = await getData(`ciclismo-storico/${y}/classifica_team.json`); } catch (_) { continue; }
      for (const [c, lista] of Object.entries((ct && ct.classifica) || {})) {
        const h = (lista || []).find(t => (stessa && stessa(t.team)) || (() => { const n = norm(t.team); return parole.every(w => n.includes(w)); })());
        if (h) out.push({ anno: y, categoria: NOME_ALM[c] || c, codice: COD_ALM[c] || null, nome_quell_anno: bello(h.team), posizione: h.pos, punti: h.punti, squadre_in_classifica: lista.length });
      }
    }
    return out;
  }

  // squadra: stagione in corso (sito), classifiche squadre per categoria, storia dal 2007 (ciclismo.info), cambi di nome confermati, record dell'almanacco
  async function factsSquadra(rif) {
    const teams = await getData('teams.json'), t = norm(rif).split(' ').filter(w => w.length > 2);
    if (!t.length) throw new Error('squadra non indicata');
    const voci = Object.values(teams || {}).filter(x => { const n = ' ' + norm(x.nome) + ' '; return t.every(w => n.includes(' ' + w) || n.includes(w)); }).sort((a, b) => (b.punti_totali || 0) - (a.punti_totali || 0));
    const team = voci[0] || null;
    const nomeT = team ? team.nome : String(rif).toUpperCase();
    const out = { nota: 'storia e stagione di una squadra: vittorie e podi per anno vengono dai risultati registrati del sito (archivio 2007-2025 e stagione in corso).', squadra: bello(nomeT) };
    if (team) {
      const ris = team.risultati || [];
      const cat = r => { const m = String(r.gara_id || '').match(/_(ELI|JUN|AL|ES1|ES2)_([MF])$/); return m ? m[1] + '_' + m[2] : null; };
      const perCat = {};
      ris.forEach(r => { const c = cat(r) || '?', e = perCat[c] || (perCat[c] = { codice: c, vittorie: 0, podi: 0, risultati: 0 }); e.risultati++; if (r.posizione === 1) e.vittorie++; if (r.posizione >= 1 && r.posizione <= 3) e.podi++; });
      const vitt = ris.filter(r => r.posizione === 1).sort((a, b) => (b.moltiplicatore || 1) - (a.moltiplicatore || 1) || String(b.data).localeCompare(String(a.data))).slice(0, 10)
        .map(r => ({ gara: r.nome_gara, data: r.data, atleta: bello(`${r.atleta_nome || ''} ${r.atleta_cognome || ''}`), codice: cat(r), peso: r.moltiplicatore || 1 }));
      out.stagione_in_corso = { punti: team.punti_totali, atleti_in_rosa_con_risultati: (team.atleti || []).length, per_categoria: Object.values(perCat), vittorie_piu_importanti: vitt };
      const classifiche = [];
      for (const c of ['ELI_M', 'ELI_F', 'JUN_M', 'JUN_F', 'AL_M', 'AL_F', 'ES2_M', 'ES2_F', 'ES1_M', 'ES1_F']) {
        try { const rk = await getData('team_rankings/' + c + '.json'); const h = (rk || []).find(x => x.team_id === team.id || norm(x.team_nome) === norm(team.nome)); if (h) classifiche.push({ codice: c, posizione: h.pos, punti: h.punti, vittorie: h.p1, atleti_a_punti: h.n_atleti, squadre_in_classifica: rk.length }); } catch (_) { /* categoria senza classifica */ }
      }
      out.classifiche_squadre_ora = classifiche;
    }
    try {                                                                    // storia dal 2007: classifiche squadre di fine stagione dell'archivio (ciclismo.info)
      const parole = norm(nomeT).split(' ').filter(w => w.length > 3 && !PAROLE_SOCIETA.has(w)).slice(0, 1);   // la prima parola distintiva: regge i cambi di sponsor negli anni
      const gid = await gruppiNomi(), mio = gid(nomeT);
      out.storia_per_anno = await storiaSquadra(parole, x => gid(x) === mio);
    } catch (e) { out.storia_per_anno_errore = 'archivio storico non letto'; }
    try {
      const { data } = await sb().from('team_lineage').select('team_from,season_from,team_to,season_to,status').eq('status', 'confirmed').or(`team_from.ilike.%${norm(nomeT).split(' ').filter(w => w.length > 3)[0] || nomeT}%,team_to.ilike.%${norm(nomeT).split(' ').filter(w => w.length > 3)[0] || nomeT}%`).limit(40);
      if (data && data.length) out.cambi_di_nome_confermati = data.map(l => ({ da: bello(l.team_from), anno_da: l.season_from, a: bello(l.team_to), anno_a: l.season_to }));
    } catch (_) { /* senza storico nomi */ }
    try {
      const alm = await getData('almanacco.json'), n = norm(nomeT), gid = await gruppiNomi(), mio = gid(nomeT), simile = x => { const a = norm(x); return gid(x) === mio || a.includes(n) || n.includes(a); };
      const din = (alm.dynasties || []).find(d => simile(d.team));
      if (din) out.stagioni_da_prima_in_classifica = din.titles.map(([y, ci, p]) => ({ anno: y, categoria: NOME_ALM[(alm.cats || CAT_ALM)[ci]], punti: p }));
      const rec = (alm.bestTeamSeasons || []).filter(s => simile(s.team));
      if (rec.length) out.stagioni_record = rec.map(s => ({ anno: s.y, categoria: NOME_ALM[(alm.cats || CAT_ALM)[s.c]], punti: s.p }));
    } catch (_) { /* senza almanacco */ }
    if (!team && !(out.storia_per_anno || []).length) throw new Error('squadra non trovata: ' + rif);
    if (out.stagione_in_corso && out.stagione_in_corso.per_categoria.some(c => /^(ES1|ES2|AL|JUN)_/.test(c.codice))) out.categorie_giovanili = true;
    return out;
  }

  // prossime gare dal calendario (con scheda FCI se c'e): per le anteprime e il "cosa ci aspetta"
  async function factsCalendario(rif) {
    const cal = await getData('calendar.json'), oggi = today();
    const m = String(rif || '').match(/(\d{1,2})/), giorni = Math.min(31, Math.max(3, m ? Number(m[1]) : 10));
    const fine = new Date(Date.parse(oggi + 'T12:00:00Z') + giorni * 86400000).toISOString().slice(0, 10);
    const t = ' ' + norm(rif) + ' ';
    const reg = [...new Set((cal || []).map(c => c.regione).filter(Boolean))].find(r => t.includes(' ' + norm(r) + ' '));
    const gare = (cal || []).filter(c => c.data >= oggi && c.data <= fine && (!reg || c.regione === reg))
      .sort((a, b) => (b.campionato_italiano ? 1 : 0) - (a.campionato_italiano ? 1 : 0) || (b.moltiplicatore || 1) - (a.moltiplicatore || 1) || a.data.localeCompare(b.data)).slice(0, 25);
    const out = [];
    for (const c of gare) {
      const e = { gara: c.nome, data: c.data, luogo: c.luogo, regione: c.regione, categoria: c.categoria, livello: c.tipo, peso: c.moltiplicatore, campionato_italiano: !!c.campionato_italiano, campionato_regionale: !!c.campionato_regionale };
      out.push(e);
    }
    if (!out.length) throw new Error(`nessuna gara in calendario dal ${oggi} al ${fine}`);
    return { periodo: { dal: oggi, al: fine }, ...(reg ? { regione: reg } : {}), gare_in_programma: (cal || []).filter(c => c.data >= oggi && c.data <= fine && (!reg || c.regione === reg)).length, gare_principali: out };
  }

  // gare professionistiche (WorldTour/ProSeries) corse in Italia, dalla tabella pro_races
  async function factsPro(rif) {
    const y = Number((String(rif || '').match(/20\d\d/) || [])[0]) || Number(today().slice(0, 4));
    const { data, error } = await sb().from('pro_races').select('nome,data_start,data_end,classe,winner_name,stage_no,is_gc,parent_slug').eq('season', y).order('data_start').limit(300);
    if (error) throw new Error('gare pro: ' + error.message);
    const corse = (data || []).filter(r => !r.stage_no || r.is_gc).map(r => ({ gara: r.nome, dal: r.data_start, al: r.data_end, classe: r.classe, vincitore: r.winner_name ? bello(r.winner_name) : null }));
    if (!corse.length) throw new Error('nessuna gara pro registrata per il ' + y);
    return { nota: 'gare professionistiche in Italia registrate dal sito (vincitore della corsa o della classifica generale)', stagione: y, gare: corse.slice(0, 60) };
  }

  // medaglie internazionali (Mondiali, Europei) degli italiani
  async function factsMedaglie(rif) {
    const m = await getData('medaglie_internazionali.json'), cats = m.cats || CAT_ALM;
    const y = Number((String(rif || '').match(/20\d\d/) || [])[0]) || null, catSel = categorieDa(rif);
    const righe = (m.t || []).filter(r => (!y || r[0] === y) && (!catSel.length || catSel.includes(cats[r[1]])))
      .map(r => ({ anno: r[0], categoria: NOME_ALM[cats[r[1]]] || cats[r[1]], codice: COD_ALM[cats[r[1]]] || null, disciplina: String(r[3] || '').toLowerCase(), posizione: r[4], atleta: bello(r[6]), squadra: bello(r[7]), evento: bello(r[9]) }));
    if (!righe.length) throw new Error('nessuna medaglia internazionale' + (y ? ' nel ' + y : ''));
    return { nota: 'medaglie degli italiani a Mondiali ed Europei registrate dal sito (posizione 1 = oro, 2 = argento, 3 = bronzo)', ...(y ? { anno: y } : {}), medaglie: righe.slice(0, 80) };
  }

  // arricchimento della gara: scheda FCI (solo corsa) e racconto gia scritto per il sito
  async function arricchisciGara(facts, c) {
    const extra = {};
    try {
      const base = String(c.id || '').match(/^(.*?_\d{4}-\d{2}-\d{2})/), chiave = base ? base[1] : null;
      if (chiave) {
        for (const f of ['race_details_elite.json', 'race_details_juniores.json', 'race_details_allievi.json', 'race_details_esordienti.json', 'race_details_altri.json', 'race_details.json']) {
          let rd; try { rd = await getData(f); } catch (_) { continue; }
          const v = rd && (rd[chiave] || rd[c.id]);
          if (v) { const s = schedaFci(v.info); if (s) { extra.scheda_federale = s; break; } }
        }
      }
    } catch (_) { /* senza scheda */ }
    try {
      const ids = (facts.risultati || []).map(r => r.gara_id).filter(Boolean);
      if (ids.length) {
        const { data } = await sb().from('gara_narratives').select('gara_id,text').in('gara_id', ids.slice(0, 12));
        const r = (data || []).map(x => ({ gara_id: x.gara_id, testo: racconto(x.text) })).filter(x => x.testo.length > 40);
        if (r.length) extra.racconti_gia_pubblicati_sul_sito = r.map(x => ({ categoria: ((facts.risultati || []).find(y => y.gara_id === x.gara_id) || {}).categoria || null, testo: x.testo }));
      }
    } catch (_) { /* senza racconti */ }
    return extra;
  }

  // arricchimento dell'atleta: tutti i piazzamenti dal 2007 (ciclismo.info, ordini d'arrivo completi) e le squadre da PCS
  async function arricchisciAtleta(id) {
    const extra = {};
    try {
      const rows = await q(`select stagione, categoria, max(team) as team, count(*)::int as gare, count(*) filter (where posizione=1)::int as vittorie, count(*) filter (where posizione between 1 and 3)::int as podi,
        count(*) filter (where posizione between 1 and 10)::int as top10, min(posizione)::int as miglior_posizione from ciclismo_results where atleta_id = $1 group by stagione, categoria order by stagione`, [id]);
      if (rows.length) extra.piazzamenti_per_stagione_archivio_completo = rows.map(x => ({ anno: Number(x.stagione) || x.stagione, categoria: NOME_ALM[x.categoria] || x.categoria, squadra: bello(x.team), gare_con_risultato: x.gare, vittorie: x.vittorie, podi: x.podi, nei_primi_10: x.top10 }));
      const big = await q(`select nome_gara, data, posizione, categoria from ciclismo_results where atleta_id = $1 and posizione <= 3 order by posizione, data desc limit 12`, [id]);
      if (big.length) extra.podi_in_archivio = big.map(x => ({ gara: x.nome_gara, data: String(x.data).slice(0, 10), posizione: x.posizione, categoria: NOME_ALM[x.categoria] || x.categoria }));
    } catch (_) { /* senza archivio */ }
    try {
      const { data } = await sb().from('pcs_team_history').select('season,team,tier').eq('atleta_id', id).order('season');
      if (data && data.length) extra.squadre_per_stagione_pcs = data.map(x => ({ anno: x.season, squadra: x.team, livello: x.tier || null }));
    } catch (_) { /* nessuna */ }
    try {
      const { data } = await sb().from('pcs_results').select('season,gara_name,data,posizione').eq('atleta_id', id).lte('posizione', 10).order('posizione').limit(15);
      if (data && data.length) extra.migliori_risultati_pcs = data.map(x => ({ anno: x.season, gara: x.gara_name, data: x.data, posizione: x.posizione }));
    } catch (_) { /* nessuno */ }
    return extra;
  }

  return { factsStorico, factsSquadra, factsCalendario, factsPro, factsMedaglie, arricchisciGara, arricchisciAtleta };
}

module.exports = { creaArchivio, sintesiAlmanacco, schedaFci, categorieDa, racconto, COD_ALM, NOME_ALM };
