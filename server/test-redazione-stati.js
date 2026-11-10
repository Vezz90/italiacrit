'use strict';
// Prove sulle regole di pubblicazione della Redazione (stati, approvazione, ritiro, cancellazione, registro delle azioni).
// Si lanciano con:  node --test server/test-redazione-stati.js   (nessuna dipendenza: database e rete sono finti)
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// timer del modulo (radar, ecc.) senza tenere vivo il processo
const _si = global.setInterval; global.setInterval = (...a) => { const t = _si(...a); if (t && t.unref) t.unref(); return t; };
// database finto: solo il registro dei consumi e il kv_store in memoria
const origLoad = Module._load;
Module._load = function (richiesta, ...resto) { return richiesta === './db' ? { rawQuery: async () => ({ rows: [{ usd: 0, n: 0 }] }) } : origLoad.call(this, richiesta, ...resto); };

const kv = new Map();
const supabaseFinto = { from: () => ({
  select: () => ({ eq: (_c, chiave) => ({ maybeSingle: async () => ({ data: kv.has(chiave) ? { value: kv.get(chiave) } : null, error: null }) }) }),
  upsert: async riga => { kv.set(riga.key, JSON.parse(JSON.stringify(riga.value))); return { error: null }; },
}) };

const rotte = [];
const app = { locals: {} };
['get', 'post', 'put', 'delete'].forEach(m => { app[m] = (percorso, ...gestori) => rotte.push({ m, percorso, gestori }); });
const requireAdmin = (req, _res, next) => { req.user = req.user || { id: 7, role: 'admin', display_name: 'Admin Prova' }; next(); };
require('./redazione')(app, { requireAdmin, getSupabase: () => supabaseFinto, SITE_URL: 'http://sito.invalid', fotoPer: async () => [] });

async function chiama(m, url, body) {
  const r = rotte.find(x => x.m === m && new RegExp('^' + x.percorso.replace(/:[a-z]+/gi, '([^/]+)') + '$').test(url));
  assert.ok(r, 'rotta mancante: ' + m + ' ' + url);
  const valori = (url.match(new RegExp('^' + r.percorso.replace(/:[a-z]+/gi, '([^/]+)') + '$')) || []).slice(1), nomi = (r.percorso.match(/:[a-z]+/gi) || []).map(n => n.slice(1));
  const req = { params: Object.fromEntries(nomi.map((n, i) => [n, valori[i]])), body: body || {}, query: {}, headers: {} };
  return new Promise((ok, ko) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(o) { ok({ code: this.code, body: o }); return this; }, send(o) { ok({ code: this.code, body: o }); return this; } };
    let i = 0; const avanti = () => { const g = r.gestori[i++]; if (g) Promise.resolve(g(req, res, avanti)).catch(ko); };
    avanti();
  });
}
const CHIAVE = 'redazione_articoli';
const TESTO = 'x'.repeat(200);
const metti = (...articoli) => kv.set(CHIAVE, articoli.map(a => ({ titolo: 'Titolo di prova', sommario: 's', corpo: TESTO, creato: '2026-01-01T00:00:00Z', ...a })));
const leggi = id => kv.get(CHIAVE).find(a => a.id === id);

test('pubblica: solo gli articoli approvati', async () => {
  metti({ id: 'b1', stato: 'bozza' }, { id: 's1', stato: 'scartata' }, { id: 'g1', stato: 'in_generazione' }, { id: 'e1', stato: 'errore' }, { id: 'a1', stato: 'approvata' });
  for (const id of ['b1', 's1', 'g1', 'e1']) {
    const r = await chiama('post', '/api/admin/redazione/pubblica/' + id, { atleti: [] });
    assert.strictEqual(r.code, 409, 'stato ' + id + ' non doveva poter essere pubblicato');
    assert.notStrictEqual(leggi(id).stato, 'pubblicata');
  }
  const ok = await chiama('post', '/api/admin/redazione/pubblica/a1', { atleti: [] });
  assert.strictEqual(ok.code, 200); assert.strictEqual(leggi('a1').stato, 'pubblicata');
  assert.ok(leggi('a1').slug && leggi('a1').pubblicata_il);
  const az = leggi('a1').storico.at(-1); assert.strictEqual(az.az, 'pubblicata'); assert.strictEqual(az.da.nome, 'Admin Prova'); assert.ok(az.ts);
  assert.strictEqual((await chiama('post', '/api/admin/redazione/pubblica/nonce', {})).code, 404);
});
test('pubblica: titolo o testo mancanti', async () => {
  metti({ id: 'a2', stato: 'approvata', corpo: 'corto' });
  assert.strictEqual((await chiama('post', '/api/admin/redazione/pubblica/a2', {})).code, 400);
});
test('modifica stato: transizioni valide e non valide', async () => {
  metti({ id: 'b', stato: 'bozza' }, { id: 'p', stato: 'pubblicata', slug: 'p-x', pubblicata_il: '2026-01-02' }, { id: 'g', stato: 'in_generazione' }, { id: 'e', stato: 'errore' }, { id: 'v', stato: 'bozza', corpo: 'corto' }, { id: 's', stato: 'scartata' });
  const put = (id, body) => chiama('put', '/api/admin/redazione/bozze/' + id, body);
  assert.strictEqual((await put('b', { stato: 'pubblicata' })).code, 409, 'non si pubblica passando dal PUT');
  assert.strictEqual((await put('b', { stato: 'qualsiasi' })).code, 409);
  assert.strictEqual((await put('p', { stato: 'bozza' })).code, 409, 'un articolo pubblicato si ritira, non si riporta in bozza dal PUT');
  assert.strictEqual((await put('p', { stato: 'approvata' })).code, 409);
  assert.strictEqual((await put('g', { titolo: 'x' })).code, 409);
  assert.strictEqual((await put('e', { stato: 'approvata' })).code, 409);
  assert.strictEqual((await put('v', { stato: 'approvata' })).code, 400, 'non si approva una bozza incompleta');
  assert.strictEqual((await put('s', { stato: 'approvata' })).code, 409, 'una scartata torna prima in bozza');
  const ok = await put('b', { stato: 'approvata', titolo: 'Nuovo' });
  assert.strictEqual(ok.code, 200); assert.strictEqual(leggi('b').stato, 'approvata'); assert.strictEqual(leggi('b').storico.at(-1).az, 'approvata');
  assert.strictEqual((await put('p', { corpo: TESTO + ' corretto' })).code, 200, 'il testo di un articolo pubblicato si puo correggere');
  assert.strictEqual(leggi('p').stato, 'pubblicata');
});
test('ritiro e cancellazione: prima si ritira, poi si elimina; la cache pubblica si svuota', async () => {
  metti({ id: 'a', stato: 'approvata' }, { id: 'b', stato: 'bozza' });
  await chiama('post', '/api/admin/redazione/pubblica/a', { atleti: [] });
  const slug = leggi('a').slug;
  assert.strictEqual((await chiama('get', '/api/articoli/' + slug)).code, 200);
  assert.strictEqual((await chiama('delete', '/api/admin/redazione/bozze/a')).code, 409, 'un articolo pubblicato non si elimina');
  assert.ok(leggi('a'));
  assert.strictEqual((await chiama('post', '/api/admin/redazione/ritira/b')).code, 409, 'non si ritira cio che non e pubblicato');
  const r = await chiama('post', '/api/admin/redazione/ritira/a');
  assert.strictEqual(r.code, 200); assert.strictEqual(leggi('a').stato, 'bozza'); assert.strictEqual(leggi('a').storico.at(-1).az, 'ritirata');
  assert.strictEqual((await chiama('get', '/api/articoli/' + slug)).code, 404, 'dopo il ritiro la pagina pubblica non risponde piu');
  const lista = await chiama('get', '/api/articoli'); assert.strictEqual(lista.body.articoli.length, 0);
  assert.strictEqual((await chiama('delete', '/api/admin/redazione/bozze/a')).code, 200);
  assert.strictEqual(leggi('a'), undefined);
});
test('registro delle azioni: approvazione, pubblicazione e ritiro di una stessa bozza', async () => {
  metti({ id: 'z', stato: 'bozza' });
  await chiama('put', '/api/admin/redazione/bozze/z', { stato: 'approvata' });
  await chiama('post', '/api/admin/redazione/pubblica/z', { atleti: [] });
  await chiama('post', '/api/admin/redazione/ritira/z');
  assert.deepStrictEqual(leggi('z').storico.map(x => x.az), ['approvata', 'pubblicata', 'ritirata']);
});
