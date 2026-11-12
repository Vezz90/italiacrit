'use strict';
// prove dell'archivio della Redazione: node --test server/test-redazione-archivio.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { creaArchivio, sintesiAlmanacco, schedaFci, categorieDa } = require('./redazione-archivio');
const D = require('./redazione-dati');

const DATA = path.join(__dirname, '..', 'data');
const leggi = f => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

test('categorie riconosciute da un riferimento libero', () => {
  assert.deepStrictEqual(categorieDa('nazionale ELI_M'), ['ELITE_UNDER23']);
  assert.deepStrictEqual(categorieDa('Lombardia allievi').sort(), ['ALLIEVI', 'DONNE_ALLIEVE']);
  assert.deepStrictEqual(categorieDa('juniores donne'), ['DONNE_JUNIORES']);
  assert.deepStrictEqual(categorieDa('nazionale'), []);
});

test('sintesi dell almanacco nazionale: albo dei numeri uno, record, codici per la tutela dei minori', () => {
  const s = sintesiAlmanacco(leggi('almanacco.json'), { categorie: ['ELITE_UNDER23'] });
  const eli = s.albo_dei_numeri_uno.find(c => c.codice === 'ELI_M');
  assert.ok(eli && eli.numeri_uno_per_anno.length >= 15, 'servono i numeri uno di quasi tutti gli anni');
  assert.ok(eli.numeri_uno_per_anno.every(x => x.anno && x.numero_uno && Number.isFinite(x.punti)));
  assert.ok(s.albo_dei_numeri_uno.every(c => c.codice === 'ELI_M'), 'filtrato sulla categoria chiesta');
  // con una categoria scelta i record sono di QUELLA categoria, non la somma di tutte (errore visto l'11/11: gare e vittorie giovanili attribuite agli Elite)
  const rec = s.record_per_categoria[0], alm = leggi('almanacco.json');
  assert.strictEqual(rec.codice, 'ELI_M');
  const g19 = rec.gare_per_anno.find(g => g.anno === 2019).gare;
  assert.strictEqual(g19, alm.cat.ELITE_UNDER23.racesPerYear.find(r => r.y === 2019).n);
  assert.ok(g19 < alm.racesPerYear.find(r => r.y === 2019).n, 'le gare Elite sono meno del totale di tutte le categorie');
  assert.ok(!('tutte_le_categorie_insieme' in s), 'niente totali di tutte le categorie quando se ne chiede una');
  assert.ok(rec.piu_vittorie.every(a => alm.cat.ELITE_UNDER23.winsTop.some(w => w.w === a.vittorie)), 'vittorie prese dalla classifica della categoria');
  assert.strictEqual(D.contieneMinorenni(s), false, 'solo Elite: il web resta possibile');
  const tutto = sintesiAlmanacco(leggi('almanacco.json'));
  assert.strictEqual(D.contieneMinorenni(tutto), true, 'con le categorie giovanili il web si spegne');
  assert.ok(JSON.stringify(tutto).length < 120000, 'il blocco deve restare compatto');
});

test('scheda FCI: solo dati di corsa, niente email, telefoni o organizzatori', () => {
  const info = ['102^ COPPA SAN GEO <br><b>Data:</b> 14/02/2026 <br><b>Località:</b> Ponte San Marco <br><b>Categoria:</b> (1.12) Elite e Under 23 <br><b>Telefono:</b> 036531294 <br><b>Email:</b> PIPPO@GMAIL.COM <br><b>Nome:</b> G.S. SAN GEO <br><b>Indirizzo:</b> VIA BARIAGA 24 <br><b>Descrizione:</b> Ponte San Marco, Gavardo, scrivere a info@esempio.it o 335 6974847, da ripetersi 4 volte <br><b>Orario Partenza:</b> 12:30 <br><b>Lunghezza KM:</b> 164,600'];
  const s = schedaFci(info), j = JSON.stringify(s);
  assert.strictEqual(s.km, 164.6);
  assert.strictEqual(s.edizione, 102);
  assert.strictEqual(s.orario_partenza, '12:30');
  assert.ok(s.percorso.includes('da ripetersi 4 volte'));
  assert.ok(!/@|036531294|6974847|BARIAGA|SAN GEO/i.test(j.replace('Ponte San Marco', '')), 'dati di contatto filtrati: ' + j);
});

test('scheda FCI vera dal file del sito', () => {
  const rd = leggi('race_details_elite.json'), v = Object.values(rd)[0];
  const s = schedaFci(v.info);
  assert.ok(s && s.localita);
  assert.ok(!/@/.test(JSON.stringify(s)));
});

function archivioFinto(extra = {}) {
  const files = {
    'teams.json': { T1: { id: 'T1', nome: 'TEAM COLPACK BALLAN', punti_totali: 900, atleti: ['A', 'B'], risultati: [
      { gara_id: 'G1_2026-04-01_ELI_M', nome_gara: 'COPPA UNO', data: '2026-04-01', atleta_nome: 'MARIO', atleta_cognome: 'ROSSI', posizione: 1, moltiplicatore: 2 },
      { gara_id: 'G2_2026-05-01_ELI_M', nome_gara: 'COPPA DUE', data: '2026-05-01', atleta_nome: 'LUCA', atleta_cognome: 'BIANCHI', posizione: 3, moltiplicatore: 1 }] } },
    'team_rankings/ELI_M.json': [{ pos: 2, team_id: 'T1', team_nome: 'TEAM COLPACK BALLAN', punti: 900, p1: 1, n_atleti: 2 }],
    'ciclismo-storico/2016/classifica_team.json': { anno: 2016, classifica: { ELITE_UNDER23: [{ pos: 1, team: 'TEAM COLPACK', punti: 1142 }, { pos: 2, team: 'ZALF', punti: 800 }] } },
    'almanacco.json': leggi('almanacco.json'), 'team_lineage.json': leggi('team_lineage.json'),
    'calendar.json': [{ id: 'X_2026-11-15', nome: 'GIRO DI PROVA', data: '2026-11-15', regione: 'VENETO', categoria: 'Juniores', tipo: 'nazionale', moltiplicatore: 2 },
      { id: 'Y_2026-11-14', nome: 'COPPA LOMBARDA', data: '2026-11-14', regione: 'LOMBARDIA', categoria: 'Allievi', tipo: 'regionale', moltiplicatore: 1 }],
    'medaglie_internazionali.json': { cats: ['ESORDIENTI1', 'ESORDIENTI2', 'ALLIEVI', 'JUNIORES', 'ELITE_UNDER23', 'DONNE_ESORDIENTI', 'DONNE_ALLIEVE', 'DONNE_JUNIORES'],
      t: [[2025, 4, 0, 'STRADA', 1, 'X_Y', 'VERDI ANNA', 'TEAM Z', '1', 'CAMPIONATO EUROPEO SU STRADA'], [2024, 3, 0, 'PISTA', 2, 'K', 'NERI PAOLO', 'TEAM K', '2', 'MONDIALI']] },
    ...extra,
  };
  const getData = async f => { if (!(f in files)) throw new Error('manca ' + f); return files[f]; };
  const catena = { select() { return this; }, eq() { return this; }, or() { return this; }, limit() { return Promise.resolve({ data: [{ team_from: 'TEAM COLPACK', season_from: '2018', team_to: 'TEAM COLPACK BALLAN', season_to: '2019', status: 'confirmed' }] }); } };
  return creaArchivio({ getData, sb: () => ({ from: () => catena }), rawQuery: async () => ({ rows: [] }), today: () => '2026-11-11' });
}

test('squadra: stagione, classifica squadre, storia per anno, cambi di nome, record dell almanacco', async () => {
  const f = await archivioFinto().factsSquadra('Colpack');
  assert.strictEqual(f.squadra, 'Team Colpack Ballan');
  assert.strictEqual(f.stagione_in_corso.per_categoria[0].vittorie, 1);
  assert.strictEqual(f.classifiche_squadre_ora[0].posizione, 2);
  assert.deepStrictEqual(f.storia_per_anno.map(x => [x.anno, x.posizione, x.punti]), [[2016, 1, 1142]]);
  assert.strictEqual(f.cambi_di_nome_confermati.length, 1);
  assert.ok((f.stagioni_record || []).some(s => s.anno === 2016 && s.punti === 1142));
});

test('calendario: prossime gare e filtro per regione', async () => {
  const A = archivioFinto();
  const tutto = await A.factsCalendario('10');
  assert.strictEqual(tutto.gare_principali[0].gara, 'GIRO DI PROVA', 'prima la gara di peso maggiore');
  const v = await A.factsCalendario('14 Veneto');
  assert.strictEqual(v.regione, 'VENETO'); assert.strictEqual(v.gare_principali.length, 1);
});

test('medaglie: filtro per anno e categoria con codici', async () => {
  const A = archivioFinto();
  const m = await A.factsMedaglie('2025');
  assert.strictEqual(m.medaglie.length, 1); assert.strictEqual(m.medaglie[0].atleta, 'Verdi Anna'); assert.strictEqual(m.medaglie[0].codice, 'ELI_M');
  const j = await A.factsMedaglie('juniores');
  assert.strictEqual(j.medaglie[0].codice, 'JUN_M');
  assert.strictEqual(D.contieneMinorenni(j), true);
});

test('storico per regione', async () => {
  const idx = leggi('almanacco_regioni/index.json'), lomb = leggi('almanacco_regioni/LOMBARDIA.json');
  const A = archivioFinto({ 'almanacco_regioni/index.json': idx, 'almanacco_regioni/LOMBARDIA.json': lomb });
  const s = await A.factsStorico('Lombardia elite');
  assert.match(s.ambito, /Lombardia/i);
  assert.ok(s.albo_dei_numeri_uno.length >= 1);
  const n = await A.factsStorico('nazionale');
  assert.strictEqual(n.ambito, 'Italia');
});

test('almanacco: i nomi collegati dall admin sono una sola squadra (caso Zalf: titoli 2013-2014-2015 di fila)', () => {
  const alm = leggi('almanacco.json'), z = alm.cat.ELITE_UNDER23.dynasties.filter(d => /ZALF/.test(d.team));
  assert.strictEqual(z.length, 1, 'tutti i nomi Zalf in un solo gruppo, non ' + z.length);
  const anni = z[0].titles.map(t => t[0]);
  assert.ok([2013, 2014, 2015].every(y => anni.includes(y)), 'manca un anno: ' + anni);
  assert.ok(z[0].streak >= 3, 'serie piu lunga: ' + z[0].streak);
  assert.ok(Array.isArray(leggi('team_lineage.json')) && leggi('team_lineage.json').length > 100);
});
