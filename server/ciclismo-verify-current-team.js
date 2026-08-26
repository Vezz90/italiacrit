'use strict';
// Verifica di corroborazione per i match diretti: confronta il team ATTUALE
// (stagione in corso, 2026) su ciclismo.info con team_attuale di italiacrit —
// confronto corretto, a differenza del team-dell'anno-passato che può
// legittimamente essere cambiato.
//
// Uso: node ciclismo-verify-current-team.js <anno-match> <anno-corrente>

const fs = require('fs');
const path = require('path');
const { fetchDecoded, parseAthletePage } = require('./ciclismo-info-test.js');

function normalizeTeam(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const annoMatch = process.argv[2] || '2025';
  const annoCorrente = process.argv[3] || '2026';
  const scratchDir = 'C:/Users/vezza/AppData/Local/Temp/claude/C--Users-vezza--gemini-antigravity-scratch-gpx-viewer/05519ddc-787f-45f0-99c4-8aa81465dda1/scratchpad';
  const matchData = JSON.parse(fs.readFileSync(path.join(scratchDir, `ciclismo-match-${annoMatch}.json`), 'utf8'));

  const totali = matchData.matched.length;
  console.log(`Verifica team-attuale per ${totali} match diretti...\n`);

  let okStessoTeam = 0, teamDiverso = 0, errori = 0, nonDisponibile2026 = 0;
  const dettagli = [];

  let i = 0;
  for (const m of matchData.matched) {
    i++;
    const slug = m.derivedId.toLowerCase();
    const subGuess = (m.categoriaCiclismo || '').toLowerCase().replace(/_/g, '-');
    const url = `http://${subGuess}.ciclismo.info/scheda_corridore_risultati_gare_${m.ciclismoId}_${slug}_${annoCorrente}.htm`;
    let esito;
    try {
      const html = await fetchDecoded(url);
      const data = parseAthletePage(html, url);
      if (!data.team) {
        nonDisponibile2026++;
        esito = 'non-disponibile';
      } else {
        const same = normalizeTeam(data.team) === normalizeTeam(m.match.team_attuale);
        if (same) { okStessoTeam++; esito = 'stesso-team'; }
        else { teamDiverso++; esito = 'team-diverso'; }
        dettagli.push({ atleta_id: m.derivedId, team_ciclismo_2026: data.team, team_italiacrit: m.match.team_attuale, esito });
      }
    } catch (e) {
      errori++;
      esito = 'errore-fetch';
      nonDisponibile2026++;
    }
    if (i % 100 === 0) console.log(`  ${i}/${totali}...`);
    await sleep(300);
  }

  console.log(`\n=== RISULTATO VERIFICA TEAM ATTUALE (${annoCorrente}) ===`);
  console.log(`Stesso team (${annoCorrente}): ${okStessoTeam}/${totali} (${(okStessoTeam / totali * 100).toFixed(1)}%)`);
  console.log(`Team diverso (cambio squadra, plausibile): ${teamDiverso}/${totali} (${(teamDiverso / totali * 100).toFixed(1)}%)`);
  console.log(`Non disponibile su ciclismo.info per ${annoCorrente} (non ha ancora corso/schedaUrl non trovata): ${nonDisponibile2026}/${totali}`);
  console.log(`Errori di fetch: ${errori}/${totali}`);

  const outPath = path.join(scratchDir, `ciclismo-verify-team-${annoMatch}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ annoMatch, annoCorrente, okStessoTeam, teamDiverso, nonDisponibile2026, errori, dettagli }, null, 2));
  console.log(`\nDettagli salvati in: ${outPath}`);

  console.log(`\n--- Esempi "team diverso" (rivedere se è cambio squadra reale o falso positivo di normalizzazione) ---`);
  for (const d of dettagli.filter(d => d.esito === 'team-diverso').slice(0, 15)) {
    console.log(`  ${d.atleta_id}: ciclismo="${d.team_ciclismo_2026}" vs italiacrit="${d.team_italiacrit}"`);
  }
}

main().catch(e => { console.error('ERRORE FATALE:', e); process.exit(1); });
