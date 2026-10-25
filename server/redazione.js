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
  const { requireAdmin, getSupabase, SITE_URL, fotoPer } = deps;
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
  async function albi(c, cal, opts) {
    const voci = opts.tutte ? (cal || []).filter(x => x.data === c.data && alboBase(x.nome) === alboBase(c.nome)).slice(0, 4) : [c];
    const out = [], visti = new Set();
    for (const v of (voci.length ? voci : [c])) for (const a of await alboFor(v.nome, v.categoria)) { if (!visti.has(a.serie)) { visti.add(a.serie); out.push(a); } }
    return out;
  }
  async function factsGara(id, opts = {}) {
    const [cal, raw] = await Promise.all([getData('calendar.json'), getData('results_raw.json')]);
    const c = (cal || []).find(x => x.id === id);
    if (!c) throw new Error('gara non trovata nel calendario: ' + id);
    // la voce di calendario e i risultati hanno id diversi (il calendario non porta la categoria): si abbinano per data, nome e categoria
    const cband = /allie/i.test(c.categoria || '') ? 'AL' : /junior/i.test(c.categoria || '') ? 'JUN' : /elite|under|u23/i.test(c.categoria || '') ? 'ELI' : /esord/i.test(c.categoria || '') ? 'ES' : '';
    const cg = /donn|femmin|allieve/i.test(c.categoria || '') ? 'F' : 'M', cbase = alboBase(c.nome);
    const same = r => r.gara_id === id || String(r.gara_id || '').startsWith(id + '_')
      || (r.data === c.data && alboBase(r.nome_gara) === cbase && (() => { const k = catOf(r); return opts.tutte || !k || !cband || (k.replace(/_[MF]$/, '').replace(/^ES\d$/, 'ES') === cband && k.slice(-1) === cg); })());
    let rows = (raw || []).filter(same);
    try {                                                                    // righe inserite a mano (ordine d'arrivo completo): si aggiungono se mancano
      const { data: man } = await sb().from('manual_results').select('*').eq('data', c.data);
      const have = new Set(rows.map(r => r.gara_id + '|' + r.posizione));
      (man || []).filter(same).forEach(r => { if (!have.has(r.gara_id + '|' + r.posizione)) rows.push(r); });
    } catch (_) { /* solo i dati dello scraper */ }
    const byCat = {};
    rows.forEach(r => { const k = catOf(r) || r.categoria || '?'; (byCat[k] = byCat[k] || []).push(r); });
    const risultati = Object.entries(byCat).map(([k, list]) => ({
      categoria: CAT_NOME[k] || k, codice: k, gara_id: (list[0] || {}).gara_id, partecipanti: list.length,
      top10: list.sort((a, b) => a.posizione - b.posizione).slice(0, 10).map(r => ({ pos: r.posizione, id: r.atleta_id, atleta: fullName(r), team: r.team, tempo: r.tempo || null, km: r.km || null, media: r.media || null, punti: r.punti_effettivi })),
    }));
    return {
      oggi: today(), stato: rows.length ? 'risultati' : 'anteprima',
      gara: { nome: (opts.tutte && rows.length) ? rows.map(r => r.nome_gara).filter(Boolean).sort((x, y) => x.length - y.length)[0] || c.nome : c.nome, data: c.data, luogo: c.luogo, regione: c.regione,
        categoria_calendario: opts.tutte ? 'tutte le categorie dell evento (vedi risultati)' : c.categoria, tipo: c.tipo, moltiplicatore_punti: c.moltiplicatore,
        campionato_italiano: !!c.campionato_italiano, campionato_regionale: !!c.campionato_regionale },
      risultati, albo_doro: await albi(c, cal, opts),
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

  // ---------- foto ----------
  // foto candidate per l'articolo: della gara (caricate, album) e dei vincitori adulti. Mai foto profilo di minorenni.
  async function fotoCandidate(tipo, p, facts) {
    if (!fotoPer) return [];
    const garaIds = [], atletaIds = [];
    if (tipo === 'gara') {
      garaIds.push(p.id);
      try { const cal = await getData('calendar.json'); const c = cal.find(x => x.id === p.id); if (c) cal.filter(x => x.data === c.data && alboBase(x.nome) === alboBase(c.nome)).forEach(x => garaIds.push(x.id)); } catch (_) { /* solo l'id indicato */ }
      (facts.risultati || []).forEach(r => { if (r.gara_id) garaIds.push(r.gara_id); if (!MINORI.test(r.codice || '')) (r.top10 || []).slice(0, 3).forEach(t => t.id && atletaIds.push(t.id)); });
    } else if (tipo === 'atleta') atletaIds.push(p.id);
    try { return await fotoPer({ garaIds, atletaIds }); } catch (e) { console.warn('[redazione] foto:', e.message); return []; }
  }
  // scelta iniziale: foto della gara (con credito) e, se non ce ne sono, la foto del vincitore
  const sceglie = c => { const g = c.filter(f => f.fonte !== 'profilo').slice(0, 2); return (g.length ? g : c.filter(f => f.fonte === 'profilo').slice(0, 1)).map(f => ({ url: f.url, credito: f.credito, didascalia: f.didascalia })); };

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
    const body0 = { model: MODEL, max_tokens: web ? 14000 : 6000, thinking: { type: 'disabled' } };
    if (web) body0.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
    const fonti = new Map(); let texts = [], usage = null, stop = '';
    for (let giro = 0; giro < 4; giro++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ ...body0, messages }), signal: AbortSignal.timeout(170000) });
      const j = await r.json();
      if (!r.ok) throw new Error(`Claude ${r.status}: ${(j.error && j.error.message) || ''}`);
      usage = j.usage; stop = j.stop_reason;
      for (const b of j.content || []) {
        if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach(x => { if (x.url) fonti.set(x.url, { titolo: x.title || x.url, url: x.url, uso: 'consultata nella ricerca' }); });
        if (b.type === 'text') { texts.push(b.text); (b.citations || []).forEach(c => { if (c.url) fonti.set(c.url, { titolo: c.title || c.url, url: c.url, uso: 'citata nel testo' }); }); }
      }
      if (j.stop_reason !== 'pause_turn') return { text: texts.join('\n'), lastText: texts[texts.length - 1] || '', fonti: [...fonti.values()], usage, stop };
      messages = [...messages, { role: 'assistant', content: j.content }]; texts = [];
    }
    throw new Error('la ricerca web non si e conclusa: riprova');
  }
  function sezioni(t) {
    const out = {}; const re = /^={3}([A-Z_]+)={3}[ \t]*$/gm; let m, prev = null, start = 0;
    while ((m = re.exec(t))) { if (prev) out[prev] = t.slice(start, m.index).trim(); prev = m[1]; start = re.lastIndex; }
    if (prev) out[prev] = t.slice(start).trim();
    return out;
  }
  function parseJson(res) {
    const tutti = [res.lastText, res.text, (res.text || '') + '\n' + (res.lastText || '')];
    for (const t of tutti) {
      const x = sezioni(t || '');
      if (x.CORPO && x.CORPO.length > 80) {
        const righe = v => String(v || '').split('\n').map(r => r.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
        return {
          titolo: (x.TITOLO || '').split('\n')[0].trim(), sommario: x.SOMMARIO || '', corpo: x.CORPO,
          fonti: righe(x.FONTI).map(r => { const [titolo, url, uso] = r.split('|').map(q => q.trim()); return /^https?:\/\//i.test(url || '') ? { titolo: titolo || url, url, uso: uso || '' } : null; }).filter(Boolean),
          da_verificare: righe(x.DA_VERIFICARE), tag: String(x.TAG || '').split(',').map(q => q.trim()).filter(Boolean),
        };
      }
    }
    for (const t of [res.lastText, res.text]) {                          // ripiego: se l'AI ha risposto comunque in JSON
      const a = (t || '').indexOf('{'), b = (t || '').lastIndexOf('}');
      if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) { /* niente */ } }
    }
    const e = new Error('risposta dell\'AI non leggibile' + (res.stop === 'max_tokens' ? ' (testo troncato: troppo lungo)' : '') + ' — inizio: ' + String(res.text || '').replace(/\s+/g, ' ').slice(0, 300));
    throw e;
  }

  const REGOLE = `Sei il cronista di italiacyclingstats.com, sito italiano di statistiche del ciclismo giovanile, dilettantistico e under 23/elite. Scrivi un articolo in italiano.

REGOLE DI METODO (obbligatorie):
1. NOMI, NUMERI, POSIZIONI, TEMPI, DATE E PUNTI vengono SOLO dal blocco DATI (o dalle PAGINE UFFICIALI indicate). Non ricalcolarli e non inventarli.
2. La ricerca web (se attiva) serve per il CONTESTO: programma e orari, percorso, notizie, storia della corsa. Riscrivi sempre con parole tue: è vietato copiare frasi, anche brevi, dalle fonti. Elenca ogni fonte usata in "fonti".
3. Usa un'informazione presa dal web solo se la fonte è affidabile (federazione, organizzatore, testata nota) e non contraddice i DATI. Se il web contraddice i DATI vincono i DATI: scrivilo in "da_verificare". Se non sei sicuro di un fatto, non usarlo e mettilo in "da_verificare".
4. Niente citazioni di persone, emozioni o aneddoti che non siano nei dati o nelle fonti. Niente esagerazioni. Se mancano dati scrivi un testo più breve invece di riempire.
5. Per atleti minorenni usa solo nome, squadra e risultati sportivi: mai età, scuola, residenza o altro. Non usare il web per cercare informazioni sui minorenni.
6. NOMI: scrivi sempre "Nome Cognome" in maiuscolo/minuscolo normale (nei DATI il cognome viene prima e spesso e tutto maiuscolo: "MILESI NICOLAS" diventa "Nicolas Milesi"). Usa i nomi delle squadre come sono nei DATI, scritti in modo leggibile.
7. TITOLO: deve contenere i nomi dei vincitori principali. Se l'evento ha piu categorie, nel titolo devono comparire SEMPRE i vincitori delle categorie piu alte presenti (prima Elite/Under 23 uomini e Donne Elite, poi Juniores, poi Allievi), senza dimenticarne nessuno tra Elite/Under 23: se non ci stanno tutti nel titolo, mettili nel sommario e nelle prime righe. Le sezioni dell'articolo vanno dalla categoria piu alta alla piu bassa.
8. CONFRONTI CON GLI ANNI PASSATI: sono benvenuti se sono PERTINENTI e DIMOSTRATI dai DATI (albo d'oro, risultati di oggi). Esempi buoni, sempre nella STESSA categoria e per lo STESSO titolo: un bis o un tris dello stesso atleta o della stessa squadra; un atleta che oggi ritrova il titolo dopo averlo vinto in passato; il vincitore di un'edizione precedente che oggi e presente nei risultati (dove ha chiuso); la media o il distacco confrontati con quelli dei vincitori precedenti; una squadra che torna a vincere. Sono invece VIETATI i confronti non dimostrati o fuori luogo: non dire che qualcuno "ha interrotto il dominio" o "ha preso il posto" di un altro, se quell'atleta non e piu in quella categoria o non ha gareggiato oggi; niente paragoni tra categorie diverse, niente curiosita di contorno, niente deduzioni ("per forza", "segno di un ricambio"). Se un confronto non e chiaro, pertinente e verificabile nei DATI, omettilo.
9. Non inventare ruoli, meriti o giudizi: niente "zona podio ideale", niente "ha confermato la propria autorevolezza" se non e nei DATI. Due atleti sono compagni di squadra solo se hanno la stessa squadra nei DATI.
10. Tono: giornalismo sportivo vivo e umano, frasi brevi e più lunghe alternate, immagini efficaci senza cliché ("saldamente", "da sottolineare", "gran finale"). Non ripetere due volte la stessa informazione.

FORMATO DELLA RISPOSTA: rispondi SOLO con queste sezioni, ciascuna introdotta dalla sua riga di intestazione, senza altro testo prima o dopo:
===TITOLO===
(una riga)
===SOMMARIO===
(1-2 frasi)
===CORPO===
(paragrafi separati da una riga vuota; eventuali sottotitoli con '## ')
===FONTI===
(una per riga: titolo | indirizzo | cosa ne hai ricavato; lascia vuoto se non hai usato fonti esterne)
===DA_VERIFICARE===
(una per riga, cose che un redattore deve controllare prima della pubblicazione; vuoto se nulla)
===TAG===
(parole chiave separate da virgola)`;

  const ISTRUZIONI = {
    gara: f => f.stato === 'risultati'
      ? `TIPO: RESOCONTO DI GARA (350-600 parole). Racconta chi ha vinto e come (distacchi, tempi, media se presenti), il podio per categoria, e il contesto: edizione, importanza della gara (campionato, moltiplicatore punti) e, quando sono pertinenti e nel rispetto della regola 8, i confronti con le edizioni precedenti dello stesso titolo nella stessa categoria. Se ci sono più categorie, una sezione ciascuna, dalla più alta alla più bassa, e il titolo con i nomi dei vincitori principali (regola 7).`
      : `TIPO: ANTEPRIMA DI GARA (300-500 parole). I risultati non ci sono ancora. Presenta la gara: data, luogo, categorie, programma/orari e percorso (dalle fonti web o ufficiali, se ci sono), albo d'oro delle ultime edizioni dai DATI, cosa c'è in palio (titolo, punti). Non fare pronostici su nomi se i DATI non li supportano.`,
    settimana: () => `TIPO: IL PUNTO DELLA SETTIMANA (450-700 parole). Riepilogo delle gare del periodo: i protagonisti per categoria (punti, vittorie, podi), eventuali cambi al comando delle classifiche e margini sul secondo, le gare più importanti. Struttura: apertura con la notizia principale, poi una sezione per le categorie con più movimento (non tutte se sono molte).`,
    atleta: () => `TIPO: PROFILO DI UN ATLETA (400-600 parole, atleta maggiorenne). Racconta la carriera dai dati: dalle categorie giovanili (archivio) alla stagione in corso, titoli, risultati migliori, evoluzione per anno, risultati su PCS. Il web può aggiungere contesto sportivo (squadra, successi noti) ma nessun dato privato.`,
  };

  async function genera(tipo, p) {
    let facts, soggetto;
    if (tipo === 'gara') { facts = await factsGara(p.id, { tutte: !!p.tutte }); soggetto = facts.gara.nome; }
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
      soggetto, foto: sceglie(await fotoCandidate(tipo, p, facts)), dati: JSON.stringify(facts).length < 80000 ? facts : { nota: 'dati troppo grandi per essere salvati' }, token: res.usage };
  }

  app.locals.redazione = { factsGara, factsSettimana, factsAtleta, leggiLink, alboFor };   // per le prove

  // ---------- API ----------
  app.get('/api/admin/redazione/bozze', requireAdmin, async (req, res) => {
    try { res.json({ bozze: (await readAll()).sort((a, b) => String(b.creato).localeCompare(String(a.creato))) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // crea la bozza (in scrittura) e la completa in background: la generazione puo durare 1-2 minuti con la ricerca web
  async function avvia(tipo, p, soggetto) {
    const id = crypto.randomBytes(6).toString('hex'), now = new Date().toISOString();
    await mutate(arr => { arr.push({ id, tipo, stato: 'in_generazione', soggetto: soggetto || p.id || 'settimana', parametri: p, creato: now, aggiornato: now }); });
    const fine = genera(tipo, p).then(art => mutate(arr => { const x = arr.find(a => a.id === id); if (x) Object.assign(x, art, { stato: 'bozza', aggiornato: new Date().toISOString() }); }))
      .catch(e => { console.warn('[redazione] generazione fallita:', e.message); return mutate(arr => { const x = arr.find(a => a.id === id); if (x) Object.assign(x, { stato: 'errore', errore: e.message, aggiornato: new Date().toISOString() }); }).catch(() => {}); });
    return { id, fine };
  }

  app.post('/api/admin/redazione/genera', requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const tipo = String(b.tipo || '');
      if (!['gara', 'settimana', 'atleta'].includes(tipo)) return res.status(400).json({ error: 'tipo non valido' });
      if ((tipo === 'gara' || tipo === 'atleta') && !b.id) return res.status(400).json({ error: "scegli la gara o l'atleta" });
      const p = { id: String(b.id || ''), fine: b.fine ? String(b.fine).slice(0, 10) : null, web: !!b.web, tutte: b.tutte !== false, link: Array.isArray(b.link) ? b.link.map(String).slice(0, 5) : [], indicazioni: b.indicazioni || '' };
      const { id } = await avvia(tipo, p);
      res.json({ ok: true, id });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- articoli automatici: ogni evento importante recente (o imminente) ha gia la sua bozza ----------
  const MAX_PER_GIRO = 4, MAX_AL_GIORNO = 12;
  let inCorso = false;
  async function autoGenera() {
    if (inCorso) return { avviati: 0, nota: 'gia in corso' };
    if (!process.env.ANTHROPIC_API_KEY) return { avviati: 0, nota: 'ANTHROPIC_API_KEY non configurata' };
    inCorso = true;
    try {
      const [cal, raw] = await Promise.all([getData('calendar.json'), getData('results_raw.json')]);
      const t = today(), arr = await readAll();
      const chiavi = new Set(arr.map(b => b.parametri && b.parametri.chiave).filter(Boolean));
      const oggiFatte = arr.filter(b => b.parametri && b.parametri.auto && String(b.creato).slice(0, 10) === t).length;
      let manual = [];
      try { const { data } = await sb().from('manual_results').select('gara_id,data,nome_gara,posizione').gte('data', shift(t, -2)); manual = data || []; } catch (_) { /* solo scraper */ }
      const righe = (raw || []).filter(r => r.data >= shift(t, -2)).concat(manual);
      const vistiEv = new Set(), cand = [];
      for (const c of (cal || [])) {
        if (!c.data || c.data < shift(t, -2) || c.data > shift(t, 2) || !c.nome || c.nome.trim() === '-') continue;
        const ev = `${c.data}|${alboBase(c.nome)}`;
        if (vistiEv.has(ev)) continue; vistiEv.add(ev);
        const imp = (c.campionato_italiano ? 3 : 0) + (c.campionato_regionale ? 2 : 0) + ((c.moltiplicatore || 1) >= 2 ? 1 : 0) + (c.tipo === 'nazionale' ? 1 : 0);
        const n = righe.filter(r => r.data === c.data && alboBase(r.nome_gara) === alboBase(c.nome)).length;
        if (c.data <= t && n) cand.push({ c, imp, n, chiave: `gara|risultati|${ev}` });
        else if (c.data > t && imp >= 1) cand.push({ c, imp, n: 0, chiave: `gara|anteprima|${ev}` });
      }
      cand.sort((a, b) => b.imp - a.imp || b.n - a.n);
      const daFare = cand.filter(x => !chiavi.has(x.chiave) && x.imp >= 1).slice(0, Math.max(0, Math.min(MAX_PER_GIRO, MAX_AL_GIORNO - oggiFatte)));
      let avviati = 0;
      for (const x of daFare) {
        const { fine } = await avvia('gara', { id: x.c.id, tutte: true, web: x.imp >= 3, link: [], indicazioni: '', chiave: x.chiave, auto: true }, x.c.nome);
        avviati++; await fine;                                           // una alla volta: niente raffiche di richieste
      }
      // il punto della settimana: lunedi e martedi, per l'ultima settimana con gare
      const gg = new Date().getUTCDay();
      if ((gg === 1 || gg === 2) && oggiFatte + avviati < MAX_AL_GIORNO) {
        const ultimo = (raw || []).reduce((m, r) => (r.data && r.data <= t && r.data > m ? r.data : m), '');
        const chiave = `settimana|${ultimo}`;
        if (ultimo && !chiavi.has(chiave)) { const { fine } = await avvia('settimana', { fine: ultimo, web: false, link: [], indicazioni: '', chiave, auto: true }, `Il punto della settimana (fino al ${ultimo})`); avviati++; await fine; }
      }
      return { avviati };
    } catch (e) { console.warn('[redazione] auto:', e.message); return { avviati: 0, errore: e.message }; }
    finally { inCorso = false; }
  }
  app.post('/api/admin/redazione/auto', requireAdmin, async (req, res) => {
    if (inCorso) return res.json({ ok: true, nota: 'sto gia scrivendo' });
    autoGenera().catch(() => {});                                        // in background: la pagina vede le bozze comparire
    res.json({ ok: true });
  });
  if (process.env.ANTHROPIC_API_KEY) { setTimeout(() => autoGenera().catch(() => {}), 3 * 60 * 1000); setInterval(() => autoGenera().catch(() => {}), 30 * 60 * 1000); }

  app.put('/api/admin/redazione/bozze/:id', requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const out = await mutate(arr => {
        const x = arr.find(a => a.id === req.params.id); if (!x) return null;
        ['titolo', 'sommario', 'corpo'].forEach(k => { if (typeof b[k] === 'string') x[k] = b[k]; });
        if (['bozza', 'approvata', 'scartata'].includes(b.stato)) x.stato = b.stato;
        if (Array.isArray(b.foto)) x.foto = b.foto.filter(f => f && /^https?:\/\//i.test(f.url || '')).slice(0, 6).map(f => ({ url: String(f.url), credito: String(f.credito || '').slice(0, 120), didascalia: String(f.didascalia || '').slice(0, 200) }));
        x.aggiornato = new Date().toISOString();
        return x;
      });
      if (!out) return res.status(404).json({ error: 'bozza non trovata' });
      res.json({ ok: true, bozza: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // elenco delle foto disponibili per una bozza (per sceglierle nell'editor)
  app.get('/api/admin/redazione/foto/:id', requireAdmin, async (req, res) => {
    try {
      const b = (await readAll()).find(a => a.id === req.params.id);
      if (!b) return res.status(404).json({ error: 'bozza non trovata' });
      res.json({ foto: await fotoCandidate(b.tipo, b.parametri || {}, b.dati || {}) });
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
