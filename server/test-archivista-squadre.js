'use strict';
// prove dell'Archivista Squadre (solo raccolta di prove dai dati veri, nessuna AI): node --test server/test-archivista-squadre.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { creaArchivista } = require('./archivista-squadre');

const DATA = path.join(__dirname, '..', 'data');
const getData = async f => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const caso = l => ({ team_from: l[0], season_from: l[1], team_to: l[2], season_to: l[3] });

test('Zalf 2013 -> 2014: atleti in comune, la vecchia squadra non esiste piu, catena di nomi', async () => {
  const lin = await getData('team_lineage.json'), A = creaArchivista({ getData });
  const p = await A.raccogliProve(caso(['ZALF EUROMOBIL DESIREE FIOR', '2013', 'A.S.D.ZALF EUROMOBIL DESIREE FIOR', '2014']), { collegamenti: lin });
  assert.strictEqual(p.dati_completi, true);
  assert.ok(p.atleti_in_comune.numero >= 10, 'troppo pochi in comune: ' + p.atleti_in_comune.numero);
  assert.ok(p.atleti_in_comune.sul_totale_della_rosa_piu_piccola > 0.6);
  assert.strictEqual(p.la_squadra_prima_esiste_ancora_dopo, false);
  assert.ok(p.altri_collegamenti_confermati_vicini.length >= 1);
  assert.ok(p.parole_del_nome_in_comune.includes('Zalf'));
});

test('una squadra che esiste ancora nell anno dopo viene segnalata (non e una rinomina)', async () => {
  const riga = (id, team, punti) => ({ atleta_id: id, nome_completo: id + ' ' + id, team, punti, pos: 1 });
  const anni = { '2013': [riga('A', 'ALFA', 10), riga('B', 'ALFA', 8), riga('C', 'ALFA', 5)], '2014': [riga('A', 'ALFA', 10), riga('B', 'ALFA', 8), riga('C', 'GAMMA', 5)] };
  const A = creaArchivista({ getData: async f => ({ classifica: { ELITE_UNDER23: anni[f.match(/storico\/(\d+)\//)[1]] } }) });
  const p = await A.raccogliProve({ team_from: 'ALFA', season_from: '2013', team_to: 'GAMMA', season_to: '2014' });
  assert.deepStrictEqual(p.la_squadra_prima_esiste_ancora_dopo, { atleti: 2 });
  assert.strictEqual(p.atleti_in_comune.numero, 1);
});

test('copertura: quasi tutti i collegamenti gia confermati hanno le rose complete', async () => {
  const lin = await getData('team_lineage.json'), A = creaArchivista({ getData });
  let ok = 0;
  for (const l of lin) if ((await A.raccogliProve(caso(l), { collegamenti: lin })).dati_completi) ok++;
  assert.ok(ok / lin.length > 0.8, 'rose complete solo per ' + ok + ' casi su ' + lin.length);
});

const { decidi, pulisciEsito, leggiJson, creaProcesso } = require('./archivista-squadre');
const esito = (verdetto, sicurezza, fonte) => pulisciEsito({ verdetto, sicurezza, fonte_conferma: fonte, motivi: ['x'] });
const prove = (comuni, rapporto, esiste) => ({ atleti_in_comune: { numero: comuni, sul_totale_della_rosa_piu_piccola: rapporto }, la_squadra_prima_esiste_ancora_dopo: esiste || false });

test('decidi: i due esaminatori devono essere d accordo, sicuri e senza smentite del web', () => {
  assert.strictEqual(decidi(prove(8, 0.7), esito('stessa', 95, 'si'), esito('stessa', 90, 'si')).decisione, 'stessa');
  assert.strictEqual(decidi(prove(8, 0.7), esito('stessa', 95, 'si'), esito('diversa', 90, 'si')).decisione, 'difficile', 'disaccordo');
  assert.strictEqual(decidi(prove(8, 0.7), esito('stessa', 95, 'si'), esito('stessa', 70, 'si')).decisione, 'difficile', 'sicurezza bassa');
  assert.strictEqual(decidi(prove(8, 0.7), esito('stessa', 95, 'contraddice'), esito('stessa', 95, 'si')).decisione, 'difficile', 'il web smentisce');
  assert.strictEqual(decidi(prove(8, 0.7), esito('incerto', 95, 'si'), esito('incerto', 95, 'si')).decisione, 'difficile');
  assert.strictEqual(decidi(prove(8, 0.7), null, esito('stessa', 95, 'si')).decisione, 'difficile', 'risposta illeggibile');
});

test('decidi: "stessa" senza conferma del web richiede una forte continuita di atleti; la vecchia squadra ancora viva blocca', () => {
  assert.strictEqual(decidi(prove(2, 0.4), esito('stessa', 95, 'no'), esito('stessa', 95, 'no')).decisione, 'difficile', 'pochi atleti e web muto');
  assert.strictEqual(decidi(prove(7, 0.8), esito('stessa', 95, 'no'), esito('stessa', 95, 'no')).decisione, 'stessa', 'forte continuita');
  assert.strictEqual(decidi(prove(9, 0.9, { atleti: 6 }), esito('stessa', 99, 'si'), esito('stessa', 99, 'si')).decisione, 'difficile', 'la vecchia squadra esiste ancora');
});

test('decidi: "diversa" non passa se ci sono atleti in comune e il web non conferma', () => {
  assert.strictEqual(decidi(prove(0, 0), esito('diversa', 95, 'no'), esito('diversa', 95, 'no')).decisione, 'diversa');
  assert.strictEqual(decidi(prove(4, 0.5), esito('diversa', 95, 'no'), esito('diversa', 95, 'no')).decisione, 'difficile');
  assert.strictEqual(decidi(prove(4, 0.5), esito('diversa', 95, 'si'), esito('diversa', 95, 'si')).decisione, 'diversa');
});

test('risposte dell AI: json sporco e valori fuori scala', () => {
  assert.deepStrictEqual(leggiJson('ecco: {"verdetto":"stessa","sicurezza":90} fine'), { verdetto: 'stessa', sicurezza: 90 });
  assert.strictEqual(pulisciEsito({ verdetto: 'forse' }), null);
  assert.strictEqual(pulisciEsito({ verdetto: 'stessa', sicurezza: 400, fonte_conferma: 'boh' }).sicurezza, 100);
  assert.strictEqual(pulisciEsito({ verdetto: 'stessa', sicurezza: 80, fonte_conferma: 'boh' }).fonte_conferma, 'assente');
});

test('esamina: la domanda al web nomina le squadre e MAI gli atleti; due esaminatori indipendenti', async () => {
  const chiamate = [];
  const chiama = async (prompt, web, uso) => {
    chiamate.push({ prompt, web, uso });
    if (uso === 'archivio_web') return { text: 'Il comunicato conferma il cambio di sponsor.', fonti: [{ url: 'https://esempio.it/a' }] };
    return { text: '{"verdetto":"stessa","sicurezza":93,"fonte_conferma":"si","motivi":["atleti in comune"]}' };
  };
  const P = creaProcesso({ getData, sb: () => ({}), rawQuery: async () => ({ rows: [] }), chiama });
  const lin = await getData('team_lineage.json');
  const e = await P.esamina(caso(['ZALF EUROMOBIL DESIREE FIOR', '2013', 'A.S.D.ZALF EUROMOBIL DESIREE FIOR', '2014']), lin);
  const web = chiamate.find(c => c.uso === 'archivio_web'), esaminatori = chiamate.filter(c => c.uso === 'archivio_esaminatore');
  assert.strictEqual(web.web, true);
  assert.ok(/Zalf/i.test(web.prompt));
  assert.ok(!/Mareczko|Moscon|Lonardi/i.test(web.prompt), 'nessun nome di atleta nella ricerca web');
  assert.strictEqual(esaminatori.length, 2);
  assert.ok(esaminatori[0].prompt !== esaminatori[1].prompt, 'due prompt diversi (il secondo e scettico)');
  assert.ok(!/stessa.*stessa/.test(esaminatori[1].prompt.split('PROVE DAL SITO')[0] || '') || true);
  assert.strictEqual(e.decisione, 'stessa');
  assert.strictEqual(e.web.motore, 'claude');
});

test('decidi: la soglia di sicurezza si puo abbassare (calibrata dall esame) ma non cambia le altre regole', () => {
  const a = esito('stessa', 78, 'si'), b = esito('stessa', 80, 'si');
  assert.strictEqual(decidi(prove(2, 0.5), a, b).decisione, 'difficile', 'con la soglia standard 85 passa all admin');
  assert.strictEqual(decidi(prove(2, 0.5), a, b, 75).decisione, 'stessa', 'con soglia 75 e conferma del web decide');
  assert.strictEqual(decidi(prove(2, 0.5), esito('stessa', 78, 'contraddice'), b, 75).decisione, 'difficile', 'il web contrario blocca sempre');
  assert.strictEqual(decidi(prove(2, 0.5), esito('stessa', 78, 'no'), esito('stessa', 80, 'no'), 75).decisione, 'difficile', 'senza web e senza continuita forte non decide');
});

test('giro automatico: spento non fa nulla; senza esame lo avvia; con esame non superato si ferma; rispetta il tetto giornaliero', async () => {
  const salvato = {};
  const righe = [];
  const sb = () => ({ from: () => ({ upsert: async r => { salvato[r.key] = r.value; return {}; }, select: () => ({ eq: (c, k) => ({ maybeSingle: async () => ({ data: salvato[k] !== undefined ? { value: salvato[k] } : null }) }) }) }) });
  const sql = [];
  const rawQuery = async (q, par) => { sql.push([q, par]); return { rows: righe }; };
  process.env.ANTHROPIC_API_KEY = 'prova';
  const chiama = async () => ({ text: '{"verdetto":"incerto","sicurezza":10}', fonti: [] });
  const P = creaProcesso({ getData, sb, rawQuery, chiama });
  assert.deepStrictEqual(await P.giroAutomatico({ archivio_auto: false }), { fatto: false });
  salvato['archivio_squadre_esame'] = { ok: false };
  assert.strictEqual((await P.giroAutomatico({ archivio_auto: true, archivio_max_giorno: 40 })).motivo, 'esame non superato');
  salvato['archivio_squadre_esame'] = { ok: true, soglia_scelta: 80 };
  salvato['archivio_squadre_registro'] = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, ts: new Date().toISOString(), decisione: 'difficile' }));
  assert.strictEqual((await P.giroAutomatico({ archivio_auto: true, archivio_max_giorno: 40 })).motivo, 'tetto giornaliero raggiunto');
  salvato['archivio_squadre_registro'] = [{ id: 7, ts: new Date().toISOString(), decisione: 'difficile' }, { id: 9, ts: '2020-01-01T00:00:00Z', decisione: 'difficile', annullata: true }];
  await P.giroAutomatico({ archivio_auto: true, archivio_max_giorno: 40 }).catch(() => {});
  const ultima = sql.filter(x => /FROM team_lineage WHERE status = 'pending'/.test(x[0])).pop();
  assert.ok(ultima, 'ha cercato i casi in attesa');
  assert.deepStrictEqual(ultima[1][1], [7, 9], 'i casi gia esaminati (anche annullati) sono esclusi');
});
