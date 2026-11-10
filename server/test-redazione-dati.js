'use strict';
// Prove delle funzioni pure della Redazione (dati, minorenni, titoli regionali, controlli sui fatti).
// Si lanciano con:  node --test server/test-redazione-dati.js
const test = require('node:test');
const assert = require('node:assert');
const D = require('./redazione-dati');

test('numeri: punti numerici, stringa, null e non validi non si concatenano', () => {
  assert.strictEqual(D.numero('12,5'), 12.5); assert.strictEqual(D.numero(null), 0); assert.strictEqual(D.numero('abc'), 0); assert.strictEqual(D.numero(undefined), 0); assert.strictEqual(D.numero(' 7 '), 7);
  const rows = [{ punti_effettivi: '10' }, { punti_effettivi: 5 }, { punti_effettivi: null }, { punti_effettivi: 'x' }, { punti_effettivi: '2,5' }].map(D.normalizzaRiga);
  assert.strictEqual(rows.reduce((s, r) => s + r.punti_effettivi, 0), 17.5);
  assert.strictEqual(D.normalizzaRiga({ posizione: '3', data: '2026-05-04T10:00:00Z' }).posizione, 3);
  assert.strictEqual(D.normalizzaRiga({ data: '2026-05-04T10:00:00Z' }).data, '2026-05-04');
});

test('unione risultati: automatici + manuali, senza duplicati, lo scraper vince', () => {
  const scraper = [{ gara_id: 'g1_AL_M', posizione: 1, atleta_id: 'a1', data: '2026-05-01', nome_gara: 'Trofeo Rossi', punti_effettivi: '10' }, { gara_id: 'g1_AL_M', posizione: 2, atleta_id: 'a2', data: '2026-05-01', nome_gara: 'Trofeo Rossi', punti_effettivi: 8 }];
  const manuali = [
    { gara_id: 'g1_AL_M', posizione: 1, atleta_id: 'a1', data: '2026-05-01', nome_gara: 'Trofeo Rossi', punti_effettivi: 99 },          // stessa gara e posizione: duplicato
    { gara_id: 'altro_id', posizione: 5, atleta_id: 'a2', data: '2026-05-01', nome_gara: 'TROFEO  ROSSI', punti_effettivi: 3 },       // stesso atleta, stessa gara con id diverso: duplicato
    { gara_id: 'g2_AL_M', posizione: 1, atleta_id: 'a3', data: '2026-05-08', nome_gara: 'Coppa Verdi', punti_effettivi: '12' },       // nuova
    { gara_id: 'g2_AL_M', posizione: 1, atleta_id: 'a3', data: '2026-05-08', nome_gara: 'Coppa Verdi', punti_effettivi: '12' }];      // doppia riga manuale
  const u = D.uniscRisultati(scraper, manuali);
  assert.strictEqual(u.length, 3);
  assert.strictEqual(u.find(r => r.atleta_id === 'a1').punti_effettivi, 10, 'vince lo scraper');
  assert.strictEqual(u.find(r => r.atleta_id === 'a3')._origine, 'manuale');
  assert.strictEqual(typeof u.find(r => r.atleta_id === 'a3').punti_effettivi, 'number');
  assert.strictEqual(D.uniscRisultati([], []).length, 0); assert.strictEqual(D.uniscRisultati(null, null).length, 0);
});

test('minorenni: categorie, dubbio, dati e testo libero', () => {
  for (const c of ['ES1_M', 'ES2_F', 'AL_M', 'AL_F', 'JUN_M', 'JUN_F']) assert.strictEqual(D.minorenneDaCodice(c), true, c);
  for (const c of ['ELI_M', 'ELI_F']) assert.strictEqual(D.minorenneDaCodice(c), false, c);
  for (const c of [undefined, null, '', '?', 'XYZ']) assert.strictEqual(D.minorenneDaCodice(c), true, 'nel dubbio e minorenne: ' + c);
  assert.strictEqual(D.contieneMinorenni({ risultati: [{ codice: 'AL_M' }] }), true);
  assert.strictEqual(D.contieneMinorenni({ risultati: [{ gara_id: 'x_JUN_F' }] }), true);
  assert.strictEqual(D.contieneMinorenni({ risultati: [{ codice: '?' }] }), true);
  assert.strictEqual(D.contieneMinorenni({ atleta: { minorenne: true } }), true);
  assert.strictEqual(D.contieneMinorenni({ codice: 'ELI_M', risultati: [{ codice: 'ELI_F', gara_id: 'x_ELI_F' }] }), false);
  const ind = D.indiceMinorenni({ a: { categoria: 'AL_M', cognome: 'ROSSI', nome: 'MARIO' }, b: { categoria: 'ELI_M', cognome: 'BIANCHI', nome: 'LUCA' }, c: { categoria: 'JUN_F', cognome: 'DE LUCA', nome: 'ANNA MARIA' }, d: { categoria: null, cognome: 'NERI', nome: 'PAOLO' } });
  assert.strictEqual(D.testoNominaMinori('Scrivi un pezzo su Mario Rossi', ind), true);
  assert.strictEqual(D.testoNominaMinori('ROSSI Mario ha vinto', ind), true);
  assert.strictEqual(D.testoNominaMinori('Un articolo su Luca Bianchi', ind), false, 'adulto');
  assert.strictEqual(D.testoNominaMinori('Un articolo su Rossi (senza nome)', ind), false, 'solo il cognome non basta');
  assert.strictEqual(D.testoNominaMinori('Profilo di Anna Maria De Luca', ind), true);
  assert.strictEqual(D.testoNominaMinori('Paolo Neri', ind), true, 'categoria ignota: prudenza');
});

test('titoli regionali assegnati dall admin: si aggiungono ai flag senza doppioni', () => {
  const flag = [{ prova: 'Campionato Veneto', regione: 'VENETO', data: '2026-06-01', campione: 'Mario Rossi', atleta_id: 'a1', gara_id: 'g1_ELI_M' }];
  const titoli = [{ atleta_id: 'a1', atleta_nome: 'ROSSI MARIO', gara_id: 'g1_ELI_M', regione: '', fascia: 'ELITE' },                          // gia presente
    { atleta_id: 'a9', atleta_nome: 'VERDI LUCA', gara_id: 'g7_ELI_M', regione: 'BOLZANO', fascia: 'UNDER23', disciplina: 'CRONOMETRO' }];  // assegnato a mano
  const u = D.unisciCampioniRegionali(flag, titoli, { garaNome: { g7_ELI_M: 'Campionato Alto Adige' }, garaData: { g7_ELI_M: '2026-06-15' } });
  assert.strictEqual(u.length, 2);
  const nuovo = u.find(c => c.atleta_id === 'a9');
  assert.strictEqual(nuovo.prova, 'Campionato Alto Adige'); assert.strictEqual(nuovo.regione, 'BOLZANO'); assert.strictEqual(nuovo.fascia, 'Under 23'); assert.strictEqual(nuovo.disciplina, 'cronometro'); assert.ok(nuovo.assegnato_dalla_redazione);
  assert.strictEqual(u.filter(c => c.atleta_id === 'a1').length, 1);
  assert.strictEqual(D.unisciCampioniRegionali([], [], {}).length, 0);
});

const FATTI = { classifica_atleti: [
  { pos: 1, id: 'a1', cognome: 'MILESI', atleta: 'MILESI NICOLAS', team: 'Alfa', punti: 120.5, vittorie: 4, secondi_posti: 1 },
  { pos: 2, id: 'a2', cognome: 'ROSSI', atleta: 'ROSSI MARIO', team: 'Beta', punti: 98, vittorie: 2 },
  { pos: 3, id: 'a3', cognome: 'ROSSI', atleta: 'ROSSI LUCA', team: 'Gamma', punti: 70, vittorie: 0 }] };

test('controlli sui fatti: numero giusto ma attribuito alla persona sbagliata', () => {
  const ok = D.verificaAffermazioni('Nicolas Milesi chiude con 120,5 punti e 4 vittorie.', FATTI);
  assert.deepStrictEqual(ok, []);
  const sbagliato = D.verificaAffermazioni('Nicolas Milesi chiude con 98 punti.', FATTI);     // 98 esiste, ma e di Rossi Mario
  assert.strictEqual(sbagliato.length, 1); assert.strictEqual(sbagliato[0].gravita, 'alta');
  const vitt = D.verificaAffermazioni('Mario Rossi mette insieme 5 vittorie.', FATTI);
  assert.strictEqual(vitt.length, 1); assert.strictEqual(vitt[0].gravita, 'alta');
  assert.strictEqual(D.verificaAffermazioni('Mario Rossi mette insieme due vittorie.', FATTI).length, 0, 'numero in lettere giusto');
  assert.strictEqual(D.verificaAffermazioni('Mario Rossi mette insieme tre vittorie.', FATTI).length, 1, 'numero in lettere sbagliato');
});
test('controlli sui fatti: cognome condiviso, frasi con piu atleti, distacchi, vincitore, posizione', () => {
  // "Rossi" da solo e ambiguo (due Rossi): non si giudica
  assert.deepStrictEqual(D.verificaAffermazioni('Rossi chiude con 5 vittorie.', FATTI), []);
  // due atleti nella stessa frase: attribuzione incerta, niente segnalazioni
  assert.deepStrictEqual(D.verificaAffermazioni('Nicolas Milesi con 120,5 punti precede Mario Rossi con 98 punti.', FATTI), []);
  // "punti di distacco" non e un punteggio
  assert.deepStrictEqual(D.verificaAffermazioni('Nicolas Milesi precede il secondo di 22 punti di distacco.', FATTI), []);
  const vinc = D.verificaAffermazioni('Luca Rossi ha vinto la stagione.', FATTI);
  assert.strictEqual(vinc.length, 1); assert.strictEqual(vinc[0].gravita, 'media');
  assert.deepStrictEqual(D.verificaAffermazioni('Nicolas Milesi ha vinto la stagione.', FATTI), []);
  const pos = D.verificaAffermazioni('Luca Rossi chiude al secondo posto.', FATTI);
  assert.strictEqual(pos.length, 1); assert.strictEqual(pos[0].gravita, 'media');
  assert.deepStrictEqual(D.verificaAffermazioni('Luca Rossi chiude al terzo posto.', FATTI), []);
  // nessun atleta nei dati: nulla da verificare
  assert.deepStrictEqual(D.verificaAffermazioni('Mario Rossi ha 99 punti.', { gara: { nome: 'x' } }), []);
});
test('controlli sui fatti: profilo atleta (numeri in due blocchi)', () => {
  const f = { atleta: { nome: 'MILESI NICOLAS', punti_stagione: 80 }, stagione_in_corso: { gare: 9, vittorie: 3, podi: 6 } };
  assert.deepStrictEqual(D.verificaAffermazioni('Nicolas Milesi ha 3 vittorie e 6 podi con 80 punti.', f), []);
  assert.strictEqual(D.verificaAffermazioni('Nicolas Milesi ha 4 vittorie.', f).length, 1);
});

test('nomi solo in parte presenti nei dati', () => {
  const noti = new Set(['MILESI', 'NICOLAS', 'ROSSI', 'MARIO', 'LUCA']);
  const stop = new Set(['GRAN', 'PREMIO']);
  const p = D.nomiParziali('Ieri ha vinto Marco Rossi davanti a tutti. Poi Nicolas Milesi.', FATTI, noti, stop);
  assert.strictEqual(p.length, 1); assert.match(p[0].testo, /Marco Rossi/); assert.strictEqual(p[0].gravita, 'media');
  assert.strictEqual(D.nomiParziali('Ieri ha vinto Gran Premio davanti.', FATTI, noti, stop).length, 0);
  assert.strictEqual(D.nomiParziali('Ieri ha vinto Lucio Pellegrino davanti.', FATTI, noti, stop).length, 0, 'entrambe ignote: lo segnala il controllo principale');
});
test('numeri piccoli con grandezza', () => {
  assert.deepStrictEqual(D.numeriPiccoliNonVerificati('Ha vinto 5 gare e 3 podi, in 1 gara.', new Set(['3'])), ['5 gare']);
  assert.deepStrictEqual(D.numeriPiccoliNonVerificati('Nessun numero.', new Set()), []);
});
