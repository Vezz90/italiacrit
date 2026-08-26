'use strict';
// Pilota di importazione ciclismo.info per UNA sola stagione, tutte le categorie.
// Nessuna scrittura su Supabase: salva solo un JSON locale per revisione, insieme
// a statistiche di volume/tempo utili a decidere se procedere con il backfill
// storico completo (2007-stagione corrente).
//
// Uso: node ciclismo-pilot.js [anno]   (default: anno corrente)

const fs = require('fs');
const path = require('path');
const { fetchDecoded, parseClassificaPage, parseAthletePage } = require('./ciclismo-info-test.js');

const CATEGORIE = ['donne-esordienti', 'donne-allieve', 'donne-juniores', 'esordienti', 'allievi', 'juniores', 'elite-under23'];
const DELAY_MS = 350; // rispetto verso il server fragile (Apache 2.2.3, no anti-bot)

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const anno = process.argv[2] || String(new Date().getFullYear());
  console.log(`=== Pilota ciclismo.info — stagione ${anno}, categorie: ${CATEGORIE.join(', ')} ===\n`);

  const t0 = Date.now();
  const atleti = new Map(); // ciclismoId -> { ciclismoId, nome, categorie: Set, teamPerCategoria: {}, puntiPerCategoria: {} }
  const erroriClassifica = [];

  for (const cat of CATEGORIE) {
    const url = `http://${cat}.ciclismo.info/classifica_${cat}_${anno}.htm`;
    try {
      const html = await fetchDecoded(url);
      const { classifica } = parseClassificaPage(html);
      console.log(`[classifica] ${cat}: ${classifica.length} atleti`);
      for (const a of classifica) {
        if (!a.ciclismoId) continue;
        if (!atleti.has(a.ciclismoId)) {
          atleti.set(a.ciclismoId, { ciclismoId: a.ciclismoId, nome: a.nome, categorie: [], schedaUrls: {} });
        }
        const rec = atleti.get(a.ciclismoId);
        rec.categorie.push(cat);
        rec.schedaUrls[cat] = `http://${cat}.ciclismo.info${a.schedaUrl}`;
      }
    } catch (e) {
      console.error(`[classifica] ${cat}: ERRORE ${e.message}`);
      erroriClassifica.push({ cat, error: e.message });
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nTotale atleti unici (stagione ${anno}, tutte le categorie): ${atleti.size}\n`);

  // Fase 2: scheda di ogni atleta (una sola, categoria "principale" = prima trovata)
  // per estrarre nascita, team-dell'anno e piazzamenti completi.
  let fatti = 0, erroriScheda = 0;
  let totPiazzamenti = 0, conNascita = 0;
  const risultati = [];
  const listaAtleti = [...atleti.values()];

  for (const a of listaAtleti) {
    const cat = a.categorie[0];
    const url = a.schedaUrls[cat];
    try {
      const html = await fetchDecoded(url);
      const scheda = parseAthletePage(html, url);
      risultati.push({ ciclismoId: a.ciclismoId, categorie: a.categorie, ...scheda });
      totPiazzamenti += scheda.piazzamenti.length;
      if (scheda.natoIl) conNascita++;
    } catch (e) {
      erroriScheda++;
      risultati.push({ ciclismoId: a.ciclismoId, categorie: a.categorie, error: e.message });
    }
    fatti++;
    if (fatti % 50 === 0) console.log(`  [scheda] ${fatti}/${listaAtleti.length}...`);
    await sleep(DELAY_MS);
  }

  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
  const outPath = path.join(__dirname, '..', '..', `ciclismo-pilot-${anno}.json`);
  const outFile = path.join(
    'C:/Users/vezza/AppData/Local/Temp/claude/C--Users-vezza--gemini-antigravity-scratch-gpx-viewer/05519ddc-787f-45f0-99c4-8aa81465dda1/scratchpad',
    `ciclismo-pilot-${anno}.json`
  );
  fs.writeFileSync(outFile, JSON.stringify({ anno, atleti: risultati }, null, 2));

  console.log(`\n=== RISULTATO PILOTA stagione ${anno} ===`);
  console.log(`Atleti unici: ${atleti.size}`);
  console.log(`Schede scaricate con successo: ${listaAtleti.length - erroriScheda} (errori: ${erroriScheda})`);
  console.log(`Totale piazzamenti estratti: ${totPiazzamenti}`);
  console.log(`Atleti con data di nascita trovata: ${conNascita}/${listaAtleti.length}`);
  console.log(`Tempo totale: ${elapsedSec}s (${(elapsedSec / 60).toFixed(1)} min)`);
  console.log(`Media per atleta: ${(elapsedSec / Math.max(listaAtleti.length, 1) * 1000).toFixed(0)}ms`);
  console.log(`Output salvato in: ${outFile}`);

  const perAtleta = elapsedSec / Math.max(listaAtleti.length, 1);
  console.log(`\n--- Stima per backfill storico 2007-${anno} (19 stagioni) ---`);
  console.log(`Se il volume medio per stagione fosse simile: ~${Math.round(atleti.size * 19)} scheda-fetch totali,`);
  console.log(`~${Math.round((perAtleta * atleti.size * 19) / 60)} minuti di solo scraping (esclusi errori/retry).`);
}

main().catch(e => { console.error('ERRORE FATALE:', e); process.exit(1); });
