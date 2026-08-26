'use strict';
// Fase di MATCHING (nessuna scrittura) tra gli atleti scaricati da ciclismo.info
// (output di ciclismo-pilot.js) e il database esistente di italiacrit
// (data/athletes.json, la master list FCI). Stampa statistiche + salva un
// report JSON per revisione, prima di qualunque scrittura reale.
//
// Uso: node ciclismo-match.js <anno>

const fs = require('fs');
const path = require('path');

function normalizeToAtletaId(nomeCompleto) {
  return String(nomeCompleto || '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // rimuove accenti
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function main() {
  const anno = process.argv[2] || '2025';
  const scratchDir = 'C:/Users/vezza/AppData/Local/Temp/claude/C--Users-vezza--gemini-antigravity-scratch-gpx-viewer/05519ddc-787f-45f0-99c4-8aa81465dda1/scratchpad';
  const pilotPath = path.join(scratchDir, `ciclismo-pilot-${anno}.json`);
  const athletesPath = path.join(__dirname, '..', 'data', 'athletes.json');

  const pilot = JSON.parse(fs.readFileSync(pilotPath, 'utf8'));
  const italiacritAthletes = JSON.parse(fs.readFileSync(athletesPath, 'utf8'));

  const italiacritIds = new Set(Object.keys(italiacritAthletes));
  console.log(`Atleti italiacrit (data/athletes.json): ${italiacritIds.size}`);
  console.log(`Atleti ciclismo.info stagione ${anno}: ${pilot.atleti.length}\n`);

  const matched = [];
  const unmatched = [];
  const byDerivedId = new Map(); // derivedId -> [ciclismoAthlete, ...] per rilevare collisioni interne

  for (const a of pilot.atleti) {
    if (a.error) continue;
    const derivedId = normalizeToAtletaId(a.nomeCompleto);
    if (!byDerivedId.has(derivedId)) byDerivedId.set(derivedId, []);
    byDerivedId.get(derivedId).push(a);

    const rec = {
      ciclismoId: a.ciclismoId,
      nomeCompleto: a.nomeCompleto,
      derivedId,
      teamCiclismo: a.team,
      categoriaCiclismo: a.categoria,
      natoIl: a.natoIl,
      nPiazzamenti: a.piazzamenti.length,
    };

    if (italiacritIds.has(derivedId)) {
      const ic = italiacritAthletes[derivedId];
      rec.match = {
        atleta_id: derivedId,
        team_attuale: ic.team_attuale,
        categoria_italiacrit: ic.categoria,
        stessoTeam: (ic.team_attuale || '').toUpperCase().trim() === (a.team || '').toUpperCase().trim(),
      };
      matched.push(rec);
    } else {
      unmatched.push(rec);
    }
  }

  // Collisioni: due (o piu') persone diverse di ciclismo.info che collassano sullo
  // stesso atleta_id derivato — rischio di merge sbagliato se non revisionato a mano.
  const collisioni = [...byDerivedId.entries()]
    .filter(([, list]) => {
      const uniqueCiclismoIds = new Set(list.map(x => x.ciclismoId));
      return uniqueCiclismoIds.size > 1;
    })
    .map(([derivedId, list]) => ({
      derivedId,
      persone: list.map(x => ({ ciclismoId: x.ciclismoId, team: x.team, categoria: x.categoria })),
    }));

  const nStessoTeam = matched.filter(m => m.match.stessoTeam).length;

  console.log(`=== RISULTATO MATCHING ===`);
  console.log(`Match diretti (atleta_id già in italiacrit): ${matched.length} (${(matched.length / pilot.atleti.length * 100).toFixed(1)}%)`);
  console.log(`  di cui con team coincidente: ${nStessoTeam}/${matched.length}`);
  console.log(`Nessun match — nuovi profili da creare: ${unmatched.length} (${(unmatched.length / pilot.atleti.length * 100).toFixed(1)}%)`);
  console.log(`Collisioni sospette (stesso nome, persone diverse): ${collisioni.length}`);

  if (collisioni.length) {
    console.log(`\n--- Esempi di collisioni (da rivedere manualmente) ---`);
    for (const c of collisioni.slice(0, 10)) {
      console.log(`  ${c.derivedId}: ${c.persone.map(p => `ciclismoId=${p.ciclismoId} team="${p.team}" cat=${p.categoria}`).join(' | ')}`);
    }
  }

  console.log(`\n--- Esempi di match diretti ---`);
  for (const m of matched.slice(0, 8)) {
    console.log(`  ${m.derivedId}: ciclismo team="${m.teamCiclismo}" (${m.categoriaCiclismo}) vs italiacrit team="${m.match.team_attuale}" (${m.match.categoria_italiacrit}) — ${m.match.stessoTeam ? 'OK stesso team' : 'team diverso (normale se ha cambiato squadra)'}`);
  }

  console.log(`\n--- Esempi di NON-match (nuovi profili) ---`);
  for (const u of unmatched.slice(0, 8)) {
    console.log(`  ${u.derivedId}: team="${u.teamCiclismo}" (${u.categoriaCiclismo}), nato ${u.natoIl}, ${u.nPiazzamenti} piazzamenti`);
  }

  const outPath = path.join(scratchDir, `ciclismo-match-${anno}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ anno, matched, unmatched, collisioni }, null, 2));
  console.log(`\nReport completo salvato in: ${outPath}`);
}

main();
