'use strict';
// Redazione AI (PRIVATA, solo amministratori): prepara BOZZE di articoli dai dati del sito, dalla ricerca web e da pagine ufficiali indicate a mano.
// Non pubblica niente: le bozze restano in kv_store ('redazione_articoli') finche un admin le rilegge, le corregge e le approva.
//
// Tre tipi: 'gara' (resoconto o anteprima di una gara), 'settimana' (il punto della settimana), 'atleta' (profilo, SOLO atleti maggiorenni).
// Regole di metodo (vedi REGOLE): nomi/numeri solo dai DATI calcolati qui; il web serve per il contesto e viene riscritto con parole proprie,
// con le fonti elencate; cio che non e sicuro finisce in "da_verificare".
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MODEL = 'claude-sonnet-5';
const KEY = 'redazione_articoli';
const MINORI = /^(ES1|ES2|AL|JUN)_/;                // Esordienti, Allievi, Juniores: minorenni (per loro niente profili e niente ricerca web)
const CAT_NOME = { ELI_M: 'Elite/Under 23 uomini', ELI_F: 'Donne Elite', JUN_M: 'Juniores uomini', JUN_F: 'Juniores donne', AL_M: 'Allievi', AL_F: 'Allieve',
  ES1_M: 'Esordienti 1° anno', ES1_F: 'Esordienti 1° anno donne', ES2_M: 'Esordienti 2° anno', ES2_F: 'Esordienti 2° anno donne' };

module.exports = function registerRedazione(app, deps) {
  const { requireAdmin, getSupabase, SITE_URL } = deps;
  const sb = () => { const s = getSupabase(); if (!s) throw new Error('database non disponibile'); return s; };

  // ---------- dati del sito (GitHub Pages, con ripiego sui file del repository) ----------
  const _cache = {};
  async function getData(file) {
    const hit = _cache[file];
    if (hit && Date.now() - hit.ts < 10 * 60 * 1000) return hit.data;
    let data = null;
    try {
      const r = await fetch(`${SITE_URL}/data/${file}`, { signal: AbortSignal.timeout(15000) });
      if (r.ok) data = await r.json();
    } catch (_) { /* ripiego sul file locale */ }
    if (data == null) {
      try { data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', file), 'utf8')); } catch (_) { /* niente */ }
    }
    if (data == null) throw new Error('dati non disponibili: ' + file);
    _cache[file] = { data, ts: Date.now() };
    return data;
  }

  // ---------- archivio bozze ----------
  async function readAll() {
    const { data, error } = await sb().from('kv_store').select('value').eq('key', KEY).maybeSingle();
    if (error) throw new Error('lettura bozze: ' + error.message);           // un errore NON deve sembrare "nessuna bozza"
    return Array.isArray(data && data.value) ? data.value : [];
  }
  let chain = Promise.resolve();
  function mutate(fn) {                                                      // lettura-modifica-scrittura una alla volta
    const run = chain.then(async () => {
      const arr = await readAll();
      const out = await fn(arr);
      const { error } = await sb().from('kv_store').upsert({ key: KEY, value: arr, updated_at: new Date().toISOString() });
      if (error) throw new Error('scrittura bozze: ' + error.message);
      return out;
    });
    chain = run.catch(() => {});
    return run;
  }

  // ---------- utilita ----------
  const up = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const baseName = n => up(n).replace(/[’'`.\-–,;:()"\/#]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\d+\s*[°^ª]?\s*/, '').split(' ').filter(t => t && t !== 'EDIZIONE').join(' ');
  const catOf = r => { const m = String(r.gara_id || '').match(/_(ELI|JUN|AL|ES1|ES2)_([MF])$/); return m ? `${m[1]}_${m[2]}` : null; };
  const fullName = r => `${r.cognome || ''} ${r.nome || ''}`.replace(/\s+/g, ' ').trim();
  const shift = (iso, days) => new Date(Date.parse(iso + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  const today = () => new Date().toISOString().slice(0, 10);

  // albo d'oro della corsa (ultime edizioni): serie precalcolate in data/albo, chiavi "NOME|sesso|fascia"
  const RUMORE = new Set(['ALLIEVI', 'ALLIEVE', 'ALLIEVO', 'JUNIORES', 'JUNIOR', 'DONNE', 'UNDER', 'UNDER23', '23', 'U23', 'ELITE', 'ES', 'ESORDIENTI', 'CAT', 'FEMMINILE', 'MASCHILE', 'UOMINI', 'E']);
  function alboBase(nome) { const t = baseName(nome).split(' '); while (t.length > 2 && RUMORE.has(t[t.length - 1])) t.pop(); return t.join(' '); }
  async function alboFor(nome, categoriaCal, limit = 6) {
    try {
      const idx = await getData('albo/index.json');
      const base = alboBase(nome), cat = String(categoriaCal || '');
      const band = /allie/i.test(cat) ? 'AL' : /junior/i.test(cat) ? 'JUN' : /elite|under|u23/i.test(cat) ? 'ELI' : /esord/i.test(cat) ? 'ES' : '';
      const g = /donn|femmin|allieve/i.test(cat) ? 'F' : 'M';
      const tutte = Object.entries(idx.index || {}).filter(([k]) => k.split('|')[0] === base);
      const stessoSesso = tutte.filter(([k]) => k.split('|')[1] === g);     // mai l'albo maschile per una gara femminile (o viceversa)
      const keys = (band ? stessoSesso.filter(([k]) => k.split('|')[2] === band) : stessoSesso).filter((x, i, a) => a.findIndex(y => y[0] === x[0]) === i).slice(0, 3);
      const out = [];
      for (const [k, sid] of keys) {
        const n = parseInt(sid, 16) % idx.n_shard;
        const sh = await getData(`albo/shard_${String(n).padStart(2, '0')}.json`);
        const s = sh[sid]; if (!s) continue;
        out.push({ serie: k.split('|').slice(1).join(' · '), luogo: s.luogo, edizioni: (s.ed || []).slice(0, limit).map(e => ({ anno: e.y, data: e.d, nome: e.n,
          vincitori: (e.p || []).filter(p => p[1] === 1).map(p => `${p[3]} (${p[4] || 's.t.'}) — ${p[0]}`) })) });
      }
      return out;
    } catch (e) { return []; }
  }

  // ---------- DATI per tipo ----------
  async function factsGara(id) {
    const [cal, raw] = await Promise.all([getData('calendar.json'), getData('results_raw.json')]);
    const c = (cal || []).find(x => x.id === id);
    if (!c) throw new Error('gara non trovata nel calendario: ' + id);
    // la voce di calendario e i risultati hanno id diversi (il calendario non porta la categoria): si abbinano per data, nome e categoria
    const cband = /allie/i.test(c.categoria || '') ? 'AL' : /junior/i.test(c.categoria || '') ? 'JUN' : /elite|under|u23/i.test(c.categoria || '') ? 'ELI' : /esord/i.test(c.categoria || '') ? 'ES' : '';
    const cg = /donn|femmin|allieve/i.test(c.categoria || '') ? 'F' : 'M', cbase = alboBase(c.nome);
    const same = r => r.gara_id === id || String(r.gara_id || '').startsWith(id + '_')
      || (r.data === c.data && alboBase(r.nome_gara) === cbase && (() => { const k = catOf(r); return !k || !cband || (k.replace(/_[MF]$/, '').replace(/^ES\d$/, 'ES') === cband && k.slice(-1) === cg); })());
    let rows = (raw || []).filter(same);
    try {                                                                    // righe inserite a mano (ordine d'arrivo completo): si aggiungono se mancano
      const { data: man } = await sb().from('manual_results').select('*').eq('data', c.data);
      const have = new Set(rows.map(r => r.gara_id + '|' + r.posizione));
      (man || []).filter(same).forEach(r => { if (!have.has(r.gara_id + '|' + r.posizione)) rows.push(r); });
    } catch (_) { /* solo i dati dello scraper */ }
    const byCat = {};
    rows.forEach(r => { const k = catOf(r) || r.categoria || '?'; (byCat[k] = byCat[k] || []).push(r); });
    const risultati = Object.entries(byCat).map(([k, list]) => ({
      categoria: CAT_NOME[k] || k, partecipanti: list.length,
      top10: list.sort((a, b) => a.posizione - b.posizione).slice(0, 10).map(r => ({ pos: r.posizione, atleta: fullName(r), team: r.team, tempo: r.tempo || null, km: r.km || null, media: r.media || null, punti: r.punti_effettivi })),
    }));
    return {
      oggi: today(), stato: rows.length ? 'risultati' : 'anteprima',
      gara: { nome: c.nome, data: c.data, luogo: c.luogo, regione: c.regione, categoria_calendario: c.categoria, tipo: c.tipo, moltiplicatore_punti: c.moltiplicatore,
        campionato_italiano: !!c.campionato_italiano, campionato_regionale: !!c.campionato_regionale },
      risultati, albo_doro: await alboFor(c.nome, c.categoria),
    };
  }

  async function factsSettimana(fine) {
    const raw = (await getData('results_raw.json')).filter(r => r.data && r.tipo !== 'pista');
    const ultimo = raw.reduce((m, r) => (r.data <= today() && r.data > m ? r.data : m), '');
    const end = fine || ultimo, start = shift(end, -6);
    const cats = {};
    raw.forEach(r => { const k = catOf(r); if (k) (cats[k] = cats[k] || []).push(r); });
    const sommario = [];
    for (const [k, list] of Object.entries(cats)) {
      const win = list.filter(r => r.data >= start && r.data <= end);
      if (!win.length) continue;
      const pts = (rows) => { const m = {}; rows.forEach(r => { const a = m[r.atleta_id] || (m[r.atleta_id] = { atleta: fullName(r), team: r.team, punti: 0, vittorie: 0, podi: 0 }); a.punti += r.punti_effettivi || 0; if (r.posizione === 1) a.vittorie++; if (r.posizione >= 1 && r.posizione <= 3) a.podi++; }); return Object.values(m).sort((a, b) => b.punti - a.punti); };
      const before = pts(list.filter(r => r.data < start)), now = pts(list.filter(r => r.data <= end));
      const inWin = pts(win);
      const gare = {}; win.forEach(r => { gare[r.gara_id] = { nome: r.nome_gara, data: r.data, tipo: r.tipo, moltiplicatore: r.moltiplicatore, regione: r.regione }; });
      sommario.push({
        categoria: CAT_NOME[k] || k, gare_nella_settimana: Object.keys(gare).length,
        gare_principali: Object.values(gare).sort((a, b) => (b.moltiplicatore || 1) - (a.moltiplicatore || 1)).slice(0, 4),
        migliori_della_settimana: inWin.slice(0, 5),
        classifica_ora: now.slice(0, 3).map(a => ({ atleta: a.atleta, team: a.team, punti: a.punti })),
        leader_prima: before[0] ? { atleta: before[0].atleta, punti: before[0].punti } : null,
        cambio_al_comando: !!(before[0] && now[0] && before[0].atleta !== now[0].atleta),
        distacco_primo_secondo: now[1] ? Math.round((now[0].punti - now[1].punti) * 100) / 100 : null,
      });
    }
    if (!sommario.length) throw new Error(`nessuna gara dal ${start} al ${end}`);
    return { periodo: { dal: start, al: end }, categorie: sommario };
  }

  async function factsAtleta(id) {
    const ath = (await getData('athletes.json'))[id];
    if (!ath) throw new Error('atleta non trovato: ' + id);
    if (MINORI.test(ath.categoria || '')) throw new Error('Per tutelare i minorenni non si generano profili per Esordienti, Allievi e Juniores.');
    const ris = ath.risultati || [];
    const best = [...ris].sort((a, b) => a.posizione - b.posizione || (b.moltiplicatore || 1) - (a.moltiplicatore || 1)).slice(0, 8)
      .map(r => ({ gara: r.nome_gara, data: r.data, posizione: r.posizione, livello: r.tipo, punti: r.punti_effettivi }));
    let carriera = [];
    try {
      const car = await getData('carriere.json'); const a = (car.a || {})[id];
      if (a) carriera = a.s.map(s => ({ anno: s[0], categoria: car.cats[s[1]], posizione_finale: s[2], punti: s[3], team: car.teams[s[4]], vittorie: s[5], podi: s[6] }));
    } catch (_) { /* archivio non disponibile */ }
    let titoli = [];
    try { titoli = ((await getData('titoli_campione.json')).t || []).filter(t => t[4] === id).map(t => ({ anno: t[0], titolo: t[8], posizione: t[9], regione: t[3] })); } catch (_) { /* nessuno */ }
    let pcs = [];
    try {
      const { data } = await sb().from('pcs_results').select('season,posizione').eq('atleta_id', id);
      const m = {}; (data || []).forEach(r => { const s = m[r.season] || (m[r.season] = { stagione: r.season, gare: 0, vittorie: 0, podi: 0 }); s.gare++; if (r.posizione === 1) s.vittorie++; if (r.posizione >= 1 && r.posizione <= 3) s.podi++; });
      pcs = Object.values(m).sort((a, b) => b.stagione - a.stagione);
    } catch (_) { /* nessuno */ }
    return {
      atleta: { nome: fullName(ath), team_attuale: ath.team_attuale, categoria: CAT_NOME[ath.categoria] || ath.categoria, punti_stagione: ath.punti_totali },
      stagione_in_corso: { gare: ris.length, vittorie: ris.filter(r => r.posizione === 1).length, podi: ris.filter(r => r.posizione >= 1 && r.posizione <= 3).length, migliori_risultati: best },
      carriera_archivio_2007_2025: carriera, titoli, risultati_pcs_per_stagione: pcs,
    };
  }

  // ---------- pagine ufficiali indicate a mano ----------
  async function leggiLink(urls) {
    const cheerio = require('cheerio');
    const out = [];
    for (const u of urls.slice(0, 5)) {
      try {
        if (!/^https:\/\//i.test(u)) { out.push({ url: u, errore: 'solo indirizzi https' }); continue; }
        const r = await fetch(u, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ICS-Redazione)' } });
        const ct = r.headers.get('content-type') || '';
        if (!r.ok) { out.push({ url: u, errore: 'HTTP ' + r.status }); continue; }
        if (!/html|text/i.test(ct)) { out.push({ url: u, errore: 'formato non leggibile (' + ct.split(';')[0] + '): i PDF per ora vanno riassunti a mano' }); continue; }
        const $ = cheerio.load(await r.text()); $('script,style,nav,footer,noscript').remove();
        out.push({ url: u, titolo: $('title').first().text().trim(), testo: $('body').text().replace(/\s+/g, ' ').trim().slice(0, 6000) });
      } catch (e) { out.push({ url: u, errore: e.message }); }
    }
    return out;
  }

  // ---------- Claude (con ricerca web opzionale) ----------
  async function callClaude(prompt, web) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY non configurata');
    let messages = [{ role: 'user', content: prompt }];
    const body0 = { model: MODEL, max_tokens: web ? 7000 : 4000, thinking: { type: 'disabled' } };
    if (web) body0.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
    const fonti = new Map(); let texts = [], usage = null;
    for (let giro = 0; giro < 4; giro++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ ...body0, messages }), signal: AbortSignal.timeout(170000) });
      const j = await r.json();
      if (!r.ok) throw new Error(`Claude ${r.status}: ${(j.error && j.error.message) || ''}`);
      usage = j.usage;
      for (const b of j.content || []) {
        if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach(x => { if (x.url) fonti.set(x.url, { titolo: x.title || x.url, url: x.url, uso: 'consultata nella ricerca' }); });
        if (b.type === 'text') { texts.push(b.text); (b.citations || []).forEach(c => { if (c.url) fonti.set(c.url, { titolo: c.title || c.url, url: c.url, uso: 'citata nel testo' }); }); }
      }
      if (j.stop_reason !== 'pause_turn') return { text: texts.join('\n'), lastText: texts[texts.length - 1] || '', fonti: [...fonti.values()], usage };
      messages = [...messages, { role: 'assistant', content: j.content }]; texts = [];
    }
    throw new Error('la ricerca web non si e conclusa: riprova');
  }
  function parseJson(res) {
    for (const t of [res.lastText, res.text]) {
      const a = t.indexOf('{'), b = t.lastIndexOf('}');
      if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) { /* prova l'altro */ } }
    }
    throw new Error('risposta dell\'AI non leggibile: riprova');
  }

  const REGOLE = `Sei il cronista di italiacyclingstats.com, sito italiano di statistiche del ciclismo giovanile, dilettantistico e under 23/elite. Scrivi un articolo in italiano.

REGOLE DI METODO (obbligatorie):
1. NOMI, NUMERI, POSIZIONI, TEMPI, DATE E PUNTI vengono SOLO dal blocco DATI (o dalle PAGINE UFFICIALI indicate). Non ricalcolarli e non inventarli.
2. La ricerca web (se attiva) serve per il CONTESTO: programma e orari, percorso, notizie, storia della corsa. Riscrivi sempre con parole tue: è vietato copiare frasi, anche brevi, dalle fonti. Elenca ogni fonte usata in "fonti".
3. Usa un'informazione presa dal web solo se la fonte è affidabile (federazione, organizzatore, testata nota) e non contraddice i DATI. Se il web contraddice i DATI vincono i DATI: scrivilo in "da_verificare". Se non sei sicuro di un fatto, non usarlo e mettilo in "da_verificare".
4. Niente citazioni di persone, emozioni o aneddoti che non siano nei dati o nelle fonti. Niente esagerazioni. Se mancano dati scrivi un testo più breve invece di riempire.
5. Per atleti minorenni usa solo nome, squadra e risultati sportivi: mai età, scuola, residenza o altro. Non usare il web per cercare informazioni sui minorenni.
6. Tono: giornalismo sportivo vivo e umano, frasi brevi e più lunghe alternate, immagini efficaci senza cliché ("saldamente", "da sottolineare", "gran finale"). Non ripetere due volte la stessa informazione.

FORMATO DELLA RISPOSTA: SOLO un oggetto JSON, senza altro testo, con queste chiavi:
{"titolo": "...", "sommario": "1-2 frasi", "corpo": "paragrafi separati da una riga vuota; eventuali sottotitoli con '## '", "fonti": [{"titolo":"...","url":"...","uso":"cosa ne hai ricavato"}], "da_verificare": ["cose che un redattore deve controllare prima della pubblicazione"], "tag": ["..."]}`;

  const ISTRUZIONI = {
    gara: f => f.stato === 'risultati'
      ? `TIPO: RESOCONTO DI GARA (350-600 parole). Racconta chi ha vinto e come (distacchi, tempi, media se presenti), il podio per categoria, e il contesto: edizione, albo d'oro (ultimi vincitori, eventuali bis), importanza della gara (campionato, moltiplicatore punti). Se ci sono più categorie, una sezione ciascuna.`
      : `TIPO: ANTEPRIMA DI GARA (300-500 parole). I risultati non ci sono ancora. Presenta la gara: data, luogo, categorie, programma/orari e percorso (dalle fonti web o ufficiali, se ci sono), albo d'oro delle ultime edizioni dai DATI, cosa c'è in palio (titolo, punti). Non fare pronostici su nomi se i DATI non li supportano.`,
    settimana: () => `TIPO: IL PUNTO DELLA SETTIMANA (450-700 parole). Riepilogo delle gare del periodo: i protagonisti per categoria (punti, vittorie, podi), eventuali cambi al comando delle classifiche e margini sul secondo, le gare più importanti. Struttura: apertura con la notizia principale, poi una sezione per le categorie con più movimento (non tutte se sono molte).`,
    atleta: () => `TIPO: PROFILO DI UN ATLETA (400-600 parole, atleta maggiorenne). Racconta la carriera dai dati: dalle categorie giovanili (archivio) alla stagione in corso, titoli, risultati migliori, evoluzione per anno, risultati su PCS. Il web può aggiungere contesto sportivo (squadra, successi noti) ma nessun dato privato.`,
  };

  async function genera(tipo, p) {
    let facts, soggetto;
    if (tipo === 'gara') { facts = await factsGara(p.id); soggetto = facts.gara.nome; }
    else if (tipo === 'settimana') { facts = await factsSettimana(p.fine); soggetto = `Il punto della settimana (${facts.periodo.dal} – ${facts.periodo.al})`; }
    else if (tipo === 'atleta') { facts = await factsAtleta(p.id); soggetto = facts.atleta.nome; }
    else throw new Error('tipo non valido');
    const link = await leggiLink((p.link || []).filter(Boolean));
    // per i profili di atleti la ricerca web e consentita solo per gli adulti (gia garantito da factsAtleta); per le gare/settimana senza restrizioni
    const web = !!p.web;
    const prompt = `${REGOLE}\n\n${ISTRUZIONI[tipo](facts)}\n\nRicerca web: ${web ? 'ATTIVA (usala per il contesto, max 5 ricerche)' : 'NON disponibile: usa solo DATI e pagine ufficiali'}.\n\nDATI (JSON):\n${JSON.stringify(facts, null, 1)}\n` +
      (link.length ? `\nPAGINE UFFICIALI INDICATE DALLA REDAZIONE (testo estratto; puoi usarle come fonte, riscrivendo con parole tue):\n${JSON.stringify(link, null, 1)}\n` : '') +
      (p.indicazioni ? `\nINDICAZIONI DEL REDATTORE: ${String(p.indicazioni).slice(0, 600)}\n` : '');
    const res = await callClaude(prompt, web);
    const j = parseJson(res);
    const fonti = [...(Array.isArray(j.fonti) ? j.fonti : [])];
    link.filter(l => !l.errore).forEach(l => { if (!fonti.some(f => f.url === l.url)) fonti.push({ titolo: l.titolo || l.url, url: l.url, uso: 'pagina ufficiale indicata' }); });
    const dv = Array.isArray(j.da_verificare) ? j.da_verificare : [];
    link.filter(l => l.errore).forEach(l => dv.push(`Link non letto (${l.errore}): ${l.url}`));
    return { titolo: String(j.titolo || soggetto), sommario: String(j.sommario || ''), corpo: String(j.corpo || ''), fonti, da_verificare: dv, tag: Array.isArray(j.tag) ? j.tag : [],
      soggetto, dati: JSON.stringify(facts).length < 80000 ? facts : { nota: 'dati troppo grandi per essere salvati' }, token: res.usage };
  }

  app.locals.redazione = { factsGara, factsSettimana, factsAtleta, leggiLink, alboFor };   // per le prove

  // ---------- API ----------
  app.get('/api/admin/redazione/bozze', requireAdmin, async (req, res) => {
    try { res.json({ bozze: (await readAll()).sort((a, b) => String(b.creato).localeCompare(String(a.creato))) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/admin/redazione/genera', requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const tipo = String(b.tipo || '');
      if (!['gara', 'settimana', 'atleta'].includes(tipo)) return res.status(400).json({ error: 'tipo non valido' });
      if ((tipo === 'gara' || tipo === 'atleta') && !b.id) return res.status(400).json({ error: 'scegli la gara o l\'atleta' });
      const p = { id: String(b.id || ''), fine: b.fine ? String(b.fine).slice(0, 10) : null, web: !!b.web, link: Array.isArray(b.link) ? b.link.map(String).slice(0, 5) : [], indicazioni: b.indicazioni || '' };
      const id = crypto.randomBytes(6).toString('hex'), now = new Date().toISOString();
      await mutate(arr => { arr.push({ id, tipo, stato: 'in_generazione', soggetto: p.id || 'settimana', parametri: p, creato: now, aggiornato: now }); });
      res.json({ ok: true, id });
      // la generazione puo durare 1-2 minuti (ricerca web): si risponde subito e la bozza si completa in background
      genera(tipo, p).then(art => mutate(arr => { const x = arr.find(a => a.id === id); if (x) Object.assign(x, art, { stato: 'bozza', aggiornato: new Date().toISOString() }); }))
        .catch(e => { console.warn('[redazione] generazione fallita:', e.message); return mutate(arr => { const x = arr.find(a => a.id === id); if (x) Object.assign(x, { stato: 'errore', errore: e.message, aggiornato: new Date().toISOString() }); }).catch(() => {}); });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/admin/redazione/bozze/:id', requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const out = await mutate(arr => {
        const x = arr.find(a => a.id === req.params.id); if (!x) return null;
        ['titolo', 'sommario', 'corpo'].forEach(k => { if (typeof b[k] === 'string') x[k] = b[k]; });
        if (['bozza', 'approvata', 'scartata'].includes(b.stato)) x.stato = b.stato;
        x.aggiornato = new Date().toISOString();
        return x;
      });
      if (!out) return res.status(404).json({ error: 'bozza non trovata' });
      res.json({ ok: true, bozza: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/admin/redazione/bozze/:id', requireAdmin, async (req, res) => {
    try { await mutate(arr => { const i = arr.findIndex(a => a.id === req.params.id); if (i >= 0) arr.splice(i, 1); }); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ricerca per il selettore: gare recenti/prossime del calendario, atleti maggiorenni
  app.get('/api/admin/redazione/cerca', requireAdmin, async (req, res) => {
    try {
      const q = up(req.query.q || '').trim();
      if (req.query.tipo === 'atleta') {
        const ath = await getData('athletes.json');
        const list = Object.values(ath).filter(a => !MINORI.test(a.categoria || '') && (!q || up(fullName(a)).includes(q)))
          .sort((a, b) => (b.punti_totali || 0) - (a.punti_totali || 0)).slice(0, 20)
          .map(a => ({ id: a.id, titolo: fullName(a), dettaglio: `${CAT_NOME[a.categoria] || a.categoria} · ${a.team_attuale || ''} · ${a.punti_totali || 0} pt` }));
        return res.json({ risultati: list });
      }
      const cal = await getData('calendar.json');
      const da = shift(today(), -60), a2 = shift(today(), 5);
      const list = cal.filter(g => g.data >= da && g.data <= a2 && (!q || up(g.nome).includes(q) || up(g.luogo).includes(q)))
        .sort((x, y) => y.data.localeCompare(x.data)).slice(0, 25)
        .map(g => ({ id: g.id, titolo: g.nome, dettaglio: `${g.data} · ${g.luogo || g.regione || ''} · ${g.categoria || ''}` }));
      res.json({ risultati: list });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
