'use strict';
// Prove di integrazione della Redazione con database, rete e Claude finti:
// minorenni (niente ricerca web), risultati automatici+manuali, titoli regionali dell'admin, fonti conservate solo dietro le quinte.
// Si lanciano con:  node --test server/test-redazione-ricerca.js
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

process.env.ANTHROPIC_API_KEY = 'chiave-finta';
const _si = global.setInterval; global.setInterval = (...a) => { const t = _si(...a); if (t && t.unref) t.unref(); return t; };

// ---- rete finta: pagine e Google News passano da rete-sicura, Claude e i dati del sito da fetch ----
const chiamateRete = [];                                  // url richiesti a rete-sicura
const chiamateClaude = [];                                // corpi inviati a Claude
const RSS = `<rss><channel><item><title>Milesi vince ancora - Testata Locale</title><link>https://news.example/1</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate><description>Nicolas Milesi vince</description><source url="https://locale.example">Testata Locale</source></item></channel></rss>`;
const origLoad = Module._load;
Module._load = function (richiesta, ...resto) {
  if (richiesta === './db') return { rawQuery: async () => ({ rows: [{ usd: 0, n: 0 }] }) };
  if (richiesta === './rete-sicura') return { scarica: async url => { chiamateRete.push(String(url)); return { ok: true, status: 200, url: String(url), tipo: 'text/xml', text: /news\.google\./.test(url) ? RSS : '<html><title>x</title><body>pagina</body></html>' }; } };
  return origLoad.call(this, richiesta, ...resto);
};

const ATLETI = {
  a_milesi: { id: 'a_milesi', nome: 'NICOLAS', cognome: 'MILESI', team_attuale: 'Alfa', categoria: 'ELI_M', punti_totali: 120.5, risultati: [{ nome_gara: 'Gara uno', data: '2026-05-01', posizione: 1, tipo: 'regionale', moltiplicatore: 1, punti_effettivi: 10 }] },
  b_rossi: { id: 'b_rossi', nome: 'MARIO', cognome: 'ROSSI', team_attuale: 'Beta', categoria: 'AL_M', punti_totali: 50, risultati: [{ nome_gara: 'Gara due', data: '2026-05-02', posizione: 2, tipo: 'regionale', moltiplicatore: 1, punti_effettivi: 8 }] },
  c_ignoto: { id: 'c_ignoto', nome: 'PAOLO', cognome: 'NERI', team_attuale: 'Gamma', punti_totali: 5, risultati: [] },
};
const riga = (o) => ({ gara_id: 'g1_ELI_M', nome_gara: 'Gara uno', data: '2026-05-05', tipo: 'regionale', moltiplicatore: 1, campionato_regionale: false, campionato_italiano: false, regione: 'VENETO', cognome: 'X', nome: 'Y', team: 'T', ...o });
const RAW = [
  riga({ posizione: 1, atleta_id: 'a_milesi', cognome: 'MILESI', nome: 'NICOLAS', team: 'Alfa', punti_effettivi: 10 }),
  riga({ posizione: 2, atleta_id: 'a_bianchi', cognome: 'BIANCHI', nome: 'LUCA', team: 'Beta', punti_effettivi: 7.5 }),
  riga({ gara_id: 'g0_ELI_M', nome_gara: 'Gara dell anno scorso', data: '2025-09-01', posizione: 1, atleta_id: 'a_bianchi', cognome: 'BIANCHI', nome: 'LUCA', team: 'Beta', punti_effettivi: 100 }),
  riga({ gara_id: 'g3_ELI_M', nome_gara: 'Campionato Veneto', data: '2026-06-01', posizione: 1, atleta_id: 'a_milesi', cognome: 'MILESI', nome: 'NICOLAS', team: 'Alfa', punti_effettivi: 20, campionato_regionale: true }),
];
const MANUALI = [
  riga({ id: 1, gara_id: 'g2_ELI_M', nome_gara: 'Gara manuale', data: '2026-05-06', posizione: 1, atleta_id: 'a_bianchi', cognome: 'BIANCHI', nome: 'LUCA', team: 'Beta', punti_effettivi: '12,5' }),   // punti come stringa
  riga({ id: 2, gara_id: 'g1_ELI_M', posizione: 1, atleta_id: 'a_milesi', cognome: 'MILESI', nome: 'NICOLAS', team: 'Alfa', punti_effettivi: 10 }),                                                   // doppione di una riga dello scraper
];
const TITOLI = [{ id: 1, atleta_id: 'a_verdi', atleta_nome: 'VERDI LUCA', anno: 2026, categoria: 'ELI_M', disciplina: 'CRONOMETRO', regione: 'BOLZANO', gara_id: 'g9_ELI_M', fascia: 'UNDER23' },
  { id: 2, atleta_id: 'a_milesi', atleta_nome: 'MILESI NICOLAS', anno: 2025, categoria: 'ELI_M', disciplina: 'STRADA', regione: 'VENETO', gara_id: 'g0_ELI_M', fascia: null }];
const FIXTURE = {
  'athletes.json': ATLETI, 'results_raw.json': RAW, 'calendar.json': [], 'carriere.json': { a: {}, cats: [], teams: [] }, 'titoli_campione.json': { t: [] }, 'teams.json': {},
  'rankings/ELI_M.json': [{ pos: 1, atleta_id: 'a_milesi', cognome: 'MILESI', nome: 'NICOLAS', team_nome: 'Alfa', punti: 120.5, p1: 4, p2: 1, p3: 0, pout: 2, gare: 7 }],
  'rankings/AL_M.json': [{ pos: 1, atleta_id: 'b_rossi', cognome: 'ROSSI', nome: 'MARIO', team_nome: 'Beta', punti: 50, p1: 1, p2: 1, p3: 0, pout: 1, gare: 3 }],
  'team_rankings/ELI_M.json': [], 'team_rankings/AL_M.json': [],
};
const TESTO_ARTICOLO = 'Un articolo di prova scritto per il collaudo. '.repeat(14);
const risposta = testo => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: testo }], usage: { input_tokens: 10, output_tokens: 10 }, stop_reason: 'end_turn' }) });
global.fetch = async (url, opts) => {
  url = String(url);
  if (url.startsWith('http://sito.invalid/data/')) { const f = decodeURIComponent(url.slice('http://sito.invalid/data/'.length)); return FIXTURE[f] !== undefined ? { ok: true, json: async () => FIXTURE[f] } : { ok: false, status: 404 }; }
  if (url.startsWith('https://api.anthropic.com/')) {
    const body = JSON.parse(opts.body), prompt = body.messages[0].content;
    chiamateClaude.push({ web: !!(body.tools && body.tools.length), prompt: typeof prompt === 'string' ? prompt : JSON.stringify(prompt) });
    if (/scegli quali DATI/.test(prompt)) return risposta('BLOCCO: atleta | Mario Rossi');
    if (/Sei il RICERCATORE di una redazione/.test(prompt)) return risposta(JSON.stringify({ voci: [{ tema: 'programma', fatto: 'Partenza alle 9', fonte: { nome: 'Comitato', url: 'https://esempio.it/a', data: '', livello: 'ufficiale' }, conferme: 1 }], contraddizioni: [], non_trovato: [] }));
    return risposta(`===TITOLO===\nTitolo di prova\n===SOMMARIO===\nSommario di prova.\n===CORPO===\n${TESTO_ARTICOLO}\n===FONTI===\n===DA_VERIFICARE===\n===TAG===\nprova`);
  }
  return { ok: false, status: 404 };
};

// ---- database finto ----
const kv = new Map(), tabelle = { manual_results: MANUALI, regional_champion_titles: TITOLI, pcs_results: [] };
function costruttore(nome) {
  const filtri = []; let chiave = null;
  const b = {
    select() { return b; }, order() { return b; }, range() { return b; },
    eq(c, v) { if (nome === 'kv_store') chiave = v; else filtri.push(r => r[c] === v); return b; },
    gte(c, v) { filtri.push(r => String(r[c]).slice(0, 10) >= v); return b; },
    maybeSingle: async () => ({ data: kv.has(chiave) ? { value: kv.get(chiave) } : null, error: null }),
    upsert: async riga => { kv.set(riga.key, JSON.parse(JSON.stringify(riga.value))); return { error: null }; },
    then(ok, ko) { return Promise.resolve({ data: (tabelle[nome] || []).filter(r => filtri.every(f => f(r))), error: null }).then(ok, ko); },
  };
  return b;
}
const rotte = [], app = { locals: {} };
['get', 'post', 'put', 'delete'].forEach(m => { app[m] = (percorso, ...gestori) => rotte.push({ m, percorso, gestori }); });
require('./redazione')(app, { requireAdmin: (req, _res, next) => { req.user = { id: 1, role: 'admin', display_name: 'Admin Prova' }; next(); }, getSupabase: () => ({ from: costruttore }), SITE_URL: 'http://sito.invalid', fotoPer: async () => [] });
const R = app.locals.redazione;

async function chiama(m, url, body) {
  const r = rotte.find(x => x.m === m && new RegExp('^' + x.percorso.replace(/:[a-z]+/gi, '([^/]+)') + '$').test(url));
  assert.ok(r, 'rotta mancante: ' + m + ' ' + url);
  const re = new RegExp('^' + r.percorso.replace(/:[a-z]+/gi, '([^/]+)') + '$'), valori = url.match(re).slice(1), nomi = (r.percorso.match(/:[a-z]+/gi) || []).map(n => n.slice(1));
  const req = { params: Object.fromEntries(nomi.map((n, i) => [n, valori[i]])), body: body || {}, query: {}, headers: {} };
  return new Promise((ok, ko) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(o) { ok({ code: this.code, body: o }); return this; }, send(o) { ok({ code: this.code, body: o }); return this; } };
    let i = 0; const avanti = () => { const g = r.gestori[i++]; if (g) Promise.resolve(g(req, res, avanti)).catch(ko); };
    avanti();
  });
}
const attendi = async id => { for (let i = 0; i < 200; i++) { const b = (kv.get('redazione_articoli') || []).find(x => x.id === id); if (b && b.stato !== 'in_generazione') return b; await new Promise(r => setTimeout(r, 25)); } throw new Error('bozza non completata'); };
const azzera = () => { chiamateRete.length = 0; chiamateClaude.length = 0; };

test('atleta minorenne: nessuna ricerca web, nessuna ricerca su Google News', async () => {
  azzera();
  const r = await chiama('post', '/api/admin/redazione/genera', { tipo: 'atleta', id: 'b_rossi', web: true });
  assert.strictEqual(r.code, 200);
  const b = await attendi(r.body.id);
  assert.strictEqual(b.stato, 'bozza', b.errore);
  assert.ok(chiamateClaude.length >= 1);
  assert.strictEqual(chiamateClaude.some(c => c.web), false, 'Claude non doveva avere lo strumento di ricerca web');
  assert.strictEqual(chiamateRete.some(u => /news\.google\./.test(u)), false, 'nessuna ricerca su Google News');
  assert.strictEqual(chiamateClaude.some(c => /Sei il RICERCATORE di una redazione/.test(c.prompt)), false, 'nessun dossier sul web');
  assert.strictEqual(b.protezione.web_richiesto, true); assert.strictEqual(b.protezione.web_eseguito, false); assert.match(b.protezione.motivo, /minorenn/);
  assert.deepStrictEqual(b.notizie_google, []);
});
test('atleta di categoria ignota: nel dubbio si tratta da minorenne', async () => {
  azzera();
  const r = await chiama('post', '/api/admin/redazione/genera', { tipo: 'atleta', id: 'c_ignoto', web: true });
  const b = await attendi(r.body.id);
  assert.strictEqual(b.stato, 'bozza', b.errore);
  assert.strictEqual(chiamateClaude.some(c => c.web), false); assert.strictEqual(chiamateRete.some(u => /news\.google\./.test(u)), false);
});
test('testo libero che nomina un minorenne: niente web, nemmeno se richiesto', async () => {
  azzera();
  const r = await chiama('post', '/api/admin/redazione/richiesta', { testo: 'Scrivi un pezzo su Mario Rossi e la sua stagione', web: true });
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  const b = await attendi(r.body.id);
  assert.strictEqual(b.stato, 'bozza', b.errore);
  assert.strictEqual(chiamateClaude.some(c => c.web), false, 'nessuna ricerca web');
  assert.strictEqual(chiamateRete.some(u => /news\.google\./.test(u)), false);
  assert.strictEqual(b.protezione.web_eseguito, false);
});
test('protezione(): gare giovanili, Elite, libero con nome di un minorenne', async () => {
  const gG = { risultati: [{ codice: 'AL_M', top10: [] }] }, gE = { risultati: [{ codice: 'ELI_M', top10: [] }] };
  assert.strictEqual((await R.protezione('gara', { web: true }, gG)).web, false);
  assert.strictEqual((await R.protezione('gara', { web: true }, gE)).web, true);
  assert.strictEqual((await R.protezione('libero', { web: true, richiesta: 'Parlami di Mario Rossi' }, { blocchi: [] })).web, false);
  assert.strictEqual((await R.protezione('libero', { web: true, richiesta: 'Parlami di Luca Bianchi' }, { blocchi: [] })).web, true);
  assert.strictEqual((await R.protezione('stagione', { web: true }, { codice: 'JUN_F', classifica_atleti: [] })).web, false);
});
test('atleta adulto con ricerca web: dossier e Google News partono, le fonti restano solo interne', async () => {
  azzera();
  const r = await chiama('post', '/api/admin/redazione/genera', { tipo: 'atleta', id: 'a_milesi', web: true });
  const b = await attendi(r.body.id);
  assert.strictEqual(b.stato, 'bozza', b.errore);
  assert.strictEqual(chiamateClaude.some(c => c.web), true, 'il dossier usa la ricerca web');
  assert.strictEqual(chiamateRete.some(u => /news\.google\./.test(u)), true);
  assert.strictEqual(b.protezione.web_eseguito, true);
  assert.deepStrictEqual(b.fonti, [], 'nessuna fonte mostrata');
  const urls = b.fonti_interne.map(f => f.url);
  assert.ok(urls.includes('https://esempio.it/a'), 'fonte del dossier conservata'); assert.ok(urls.includes('https://news.example/1'), 'notizia di Google News conservata');
  assert.ok(b.fonti_interne.every(f => f.consultata_il && f.tipo));
  // endpoint riservato
  const f = await chiama('get', '/api/admin/redazione/fonti/' + b.id);
  assert.strictEqual(f.code, 200); assert.ok(f.body.fonti.length >= 2); assert.strictEqual(f.body.dossier.voci[0].fonte.url, 'https://esempio.it/a');
  // pubblicazione: le pagine pubbliche non mostrano le fonti
  await chiama('put', '/api/admin/redazione/bozze/' + b.id, { stato: 'approvata' });
  const pub = await chiama('post', '/api/admin/redazione/pubblica/' + b.id, { atleti: [] });
  assert.strictEqual(pub.code, 200);
  for (const u of ['/api/articoli/' + pub.body.slug, '/api/articoli']) {
    const out = await chiama('get', u); const testo = JSON.stringify(out.body);
    assert.strictEqual(out.code, 200); assert.ok(!/fonti|esempio\.it|news\.example|dossier/.test(testo), 'niente fonti nelle pagine pubbliche: ' + u);
  }
});

test('risultati automatici + manuali: settimana con punti numerici, senza doppioni e senza la stagione scorsa', async () => {
  const f = await R.factsSettimana('2026-05-10');
  const cat = f.categorie.find(c => c.codice === 'ELI_M'); assert.ok(cat, 'categoria presente');
  const per = Object.fromEntries(cat.migliori_della_settimana.map(a => [a.atleta, a]));
  assert.strictEqual(per['BIANCHI LUCA'].punti, 20, '7,5 (scraper) + 12,5 (inserito a mano, punti come stringa)');
  assert.strictEqual(typeof per['BIANCHI LUCA'].punti, 'number');
  assert.strictEqual(per['MILESI NICOLAS'].punti, 10, 'il doppione manuale non conta due volte');
  const classifica = Object.fromEntries(cat.classifica_ora.map(a => [a.atleta, a.punti]));
  assert.strictEqual(classifica['BIANCHI LUCA'], 20, 'i 100 punti del 2025 non entrano nella classifica 2026');
});
test('titoli regionali assegnati dall admin entrano negli articoli di stagione, di profilo e di gara', async () => {
  const f = await R.factsStagione('ELI_M');
  assert.strictEqual(f.stagione, '2026');
  const nomi = f.campioni_regionali.map(c => c.campione);
  assert.ok(nomi.includes('VERDI LUCA'), 'titolo assegnato dal pannello admin'); assert.ok(nomi.some(n => /MILESI/.test(n)), 'titolo ricavato dai flag delle gare');
  const verdi = f.campioni_regionali.find(c => c.campione === 'VERDI LUCA');
  assert.strictEqual(verdi.regione, 'BOLZANO'); assert.strictEqual(verdi.fascia, 'Under 23'); assert.strictEqual(verdi.disciplina, 'cronometro');
  assert.ok(f.campioni_regionali.every(c => c.gara_id === undefined && c.atleta_id === undefined), 'campi interni tolti');
  const a = await R.factsAtleta('a_milesi');
  assert.ok(a.titoli.some(t => t.anno === 2025 && t.regione === 'VENETO' && t.assegnato_dalla_redazione), 'titolo 2025 assegnato dall admin sul profilo');
  assert.strictEqual(a.atleta.minorenne, false); assert.strictEqual(a.atleta.categoria_codice, 'ELI_M');
  assert.strictEqual((await R.factsAtleta('b_rossi')).atleta.minorenne, true);
  assert.strictEqual((await R.factsAtleta('c_ignoto')).atleta.minorenne, true, 'categoria ignota = minorenne');
});
