'use strict';
/**
 * Rileva possibili collegamenti "stesso club, nome diverso" fra squadre di
 * stagioni consecutive (Elite/U23 Uomini, storico ciclismo.info) — un
 * team_id sul sito è generato dal nome (slug), quindi ogni cambio sponsor
 * crea per il sito una squadra "nuova" anche se è lo stesso club/roster.
 *
 * Segnale principale: quanti corridori dello stesso team nella stagione N
 * si ritrovano in un'altra squadra nella stagione N+1 ("overlap_ratio" =
 * corridori in comune / dimensione della rosa più piccola). Verificato dal
 * vivo su dati reali: coglie anche rebrand totali senza nessuna somiglianza
 * di nome (es. "CTF" 2024 → "Bahrain Victorious Development Team" 2025,
 * 63% di roster in comune, zero parole condivise). La sola somiglianza di
 * nome (usata altrove nel sito per l'import PCS) non li troverebbe mai.
 *
 * NON collega nulla in automatico: ogni candidato finisce in team_lineage
 * con status='pending', un admin conferma o rifiuta da un pannello dedicato
 * — il rischio di falsi positivi è reale e verificato (es. semplici
 * trasferimenti in blocco verso una squadra rivale possono generare un
 * overlap alto senza essere la stessa squadra rinominata).
 *
 * Uso:
 *   $env:SUPABASE_SECRET = "..."
 *   node detect-team-lineage.js [--min-riders=3] [--min-overlap=0.3]
 */

const fs = require('fs');
const path = require('path');

(function loadEnv() {
  const p = path.join(__dirname, '.env.local');
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  });
})();

const SUPABASE_URL    = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta $env:SUPABASE_SECRET o crea server/.env.local'); process.exit(1); }

const args = process.argv.slice(2);
const MIN_RIDERS  = parseInt((args.find(a => a.startsWith('--min-riders=')) || '').split('=')[1] || '') || 3;
const ELITE_ONLY = args.includes('--elite-only');
const DRY = args.includes('--dry');
const MIN_NAME_SIM = 0.6;   // stesso club con nome appena ritoccato (G.S. Mobilieri Ponsacco -> Ciclistica Mobilieri Ponsacco)
const MIN_OVERLAP = parseFloat((args.find(a => a.startsWith('--min-overlap=')) || '').split('=')[1] || '') || 0.3;

// Stesso ID che userebbe il sito per una squadra con questo nome (slug
// maiuscolo con underscore) — usato solo come team_id "best effort" per il
// collegamento, la chiave vera del confronto resta il nome+stagione.
function teamIdFromName(name) {
  return String(name || '').toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Somiglianza di nome, semplice indice di Jaccard sulle parole (>=3 lettere,
// per non far pesare "A", "DI", "DEL" ecc.) — solo un segnale di supporto,
// il segnale principale resta l'overlap del roster.
function nameSimilarity(a, b) {
  const words = s => new Set(String(s || '').toUpperCase().split(/[^A-Z0-9]+/).filter(w => w.length >= 3));
  const wa = words(a), wb = words(b);
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / new Set([...wa, ...wb]).size;
}

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  console.log('=== Rilevamento storico squadre (tutte le categorie) ===\n');
  console.log(`Soglie: minimo ${MIN_RIDERS} corridori in comune, overlap >= ${MIN_OVERLAP}\n`);

  // 1. Righe atleta/stagione/team (tutte le categorie, salvo --elite-only), una stagione per volta per non andare in timeout.
  // Scorrimento a chiave (id crescente, senza filtri sulla colonna stagione): la query filtrata per stagione andava in statement timeout.
  const rows = [];
  for (let lastId = 0, fails = 0; ;) {
    let q = sb.from('ciclismo_results').select('id, atleta_id, stagione, team, categoria').gt('id', lastId).order('id').limit(1000);
    const { data, error } = await q;
    if (error) { if (++fails > 5) throw error; await new Promise(r => setTimeout(r, 2000)); continue; }
    fails = 0;
    if (!data.length) break;
    for (const r of data) if (r.atleta_id && r.team && (!ELITE_ONLY || r.categoria === 'ELITE_UNDER23')) rows.push({ atleta_id: r.atleta_id, stagione: r.stagione, team: r.team });
    lastId = data[data.length - 1].id;
    if (data.length < 1000) break;
    if (rows.length % 50000 < 1000) process.stdout.write(`  ${rows.length} righe, id ${lastId}`);
  }
  console.log('');
  console.log(`${rows.length} righe atleta/stagione/team caricate\n`);

  // 2. Roster per (team, stagione)
  const rosterKey = (team, stagione) => `${team}|||${stagione}`;
  const rosters = new Map(); // key -> Set(atleta_id)
  for (const r of rows) {
    const k = rosterKey(r.team, r.stagione);
    if (!rosters.has(k)) rosters.set(k, new Set());
    rosters.get(k).add(r.atleta_id);
  }
  const teamsBySeason = new Map(); // stagione -> Set(team)
  for (const r of rows) {
    if (!teamsBySeason.has(r.stagione)) teamsBySeason.set(r.stagione, new Set());
    teamsBySeason.get(r.stagione).add(r.team);
  }
  const seasons = [...teamsBySeason.keys()].sort();
  console.log(`Stagioni coperte: ${seasons.join(', ')}\n`);

  // 3. Per ogni coppia di stagioni consecutive PRESENTI nei dati, confronta
  //    ogni squadra di season[i] con ogni squadra di season[i+1].
  let candidates = [];
  for (let i = 0; i < seasons.length - 1; i++) {
    const sFrom = seasons[i], sTo = seasons[i + 1];
    const teamsFrom = [...teamsBySeason.get(sFrom)];
    const teamsTo   = [...teamsBySeason.get(sTo)];
    for (const teamFrom of teamsFrom) {
      const rosterFrom = rosters.get(rosterKey(teamFrom, sFrom));
      if (!rosterFrom) continue;
      const teamIdFrom = teamIdFromName(teamFrom);
      for (const teamTo of teamsTo) {
        const teamIdTo = teamIdFromName(teamTo);
        // Confronto sull'ID derivato, non sul nome grezzo: due nomi DIVERSI
        // (es. "Team Technipes inEmiliaRomagna" vs "Team Technipes
        // #inEmiliaRomagna", solo un "#" aggiunto davanti allo sponsor)
        // possono comunque generare lo STESSO team_id — se il nome grezzo
        // fosse l'unico controllo, la coppia passava come "candidata"
        // valida e finiva confermata come una transizione verso SE STESSA
        // (team_id_from === team_id_to), mandando in loop infinito la
        // catena "Storico Squadra" lato frontend (guard a 30 ripetizioni,
        // segnalato dal vivo con screenshot). L'id è sempre il criterio di
        // identità reale sul sito, il nome no.
        if (teamIdTo === teamIdFrom) continue;
        const rosterTo = rosters.get(rosterKey(teamTo, sTo));
        if (!rosterTo) continue;
        let common = 0;
        for (const aid of rosterFrom) if (rosterTo.has(aid)) common++;
        const sim = nameSimilarity(teamFrom, teamTo);
        const overlapRatio = common / Math.min(rosterFrom.size, rosterTo.size);
        const byRoster = common >= MIN_RIDERS && overlapRatio >= MIN_OVERLAP;
        const byName = sim >= MIN_NAME_SIM && common >= 1;   // nelle giovanili i roster ruotano molto: basta un atleta in comune + nome quasi uguale
        if (!byRoster && !byName) continue;
        candidates.push({
          team_id_from: teamIdFrom, team_from: teamFrom, season_from: sFrom,
          team_id_to: teamIdTo, team_to: teamTo, season_to: sTo,
          common_riders: common, overlap_ratio: Math.round(overlapRatio * 100) / 100,
          name_similarity: Math.round(nameSimilarity(teamFrom, teamTo) * 100) / 100,
        });
      }
    }
  }
  candidates.sort((a, b) => b.overlap_ratio - a.overlap_ratio);
  console.log(`${candidates.length} candidati trovati sopra soglia\n`);

  // 4. Upsert in team_lineage come 'pending' (idempotente: ON CONFLICT
  //    aggiorna solo i numeri, non tocca lo status se già rivisto).
  if (DRY) { console.log('--dry: nessuna scrittura'); for (const c of candidates.slice(0, 5000)) console.log(`  ${c.overlap_ratio} sim ${c.name_similarity}  ${c.team_from} (${c.season_from}) -> ${c.team_to} (${c.season_to}) [${c.common_riders}]`); process.exit(0); }
  let inserted = 0, skippedReviewed = 0;
  for (const c of candidates) {
    const { data: existing } = await sb.from('team_lineage')
      .select('id, status')
      .eq('team_id_from', c.team_id_from).eq('team_id_to', c.team_id_to)
      .eq('season_from', c.season_from).eq('season_to', c.season_to)
      .maybeSingle();
    if (existing && existing.status !== 'pending') { skippedReviewed++; continue; } // non sovrascrivere una decisione già presa
    const { error } = await sb.from('team_lineage').upsert({ ...c, status: 'pending' }, {
      onConflict: 'team_id_from,team_id_to,season_from,season_to',
    });
    if (error) { console.log(`  ERRORE ${c.team_from} → ${c.team_to}: ${error.message}`); continue; }
    inserted++;
  }

  console.log(`\n=== Completato ===`);
  console.log(`✓ Candidati salvati/aggiornati: ${inserted}`);
  console.log(`⏭ Già rivisti in passato (non toccati): ${skippedReviewed}`);
  console.log(`\nTop 10 per overlap:`);
  for (const c of candidates.slice(0, 10)) {
    console.log(`  ${c.overlap_ratio}  ${c.team_from} (${c.season_from}) → ${c.team_to} (${c.season_to})  [${c.common_riders} corridori in comune]`);
  }
})().catch(e => { console.error(e); process.exit(1); });
