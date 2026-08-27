'use strict';
// Indagine una tantum: quanti atleti del circuito ICS (pcs_gara_results)
// hanno un atleta_id "corto" (nome senza secondo nome/parte extra) che
// probabilmente è la STESSA persona di un atleta FCI nativo con un
// atleta_id "più lungo" (stesso cognome, stessa/simile squadra, nome che è
// un prefisso). Non modifica nulla, stampa solo i candidati per revisione
// manuale prima di un eventuale merge.
//
// Uso: node find-name-duplicates.js

(() => {
  const fs = require('fs'), path = require('path');
  const p = path.join(__dirname, '.env.local');
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }
})();

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const SUPABASE_URL = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  const nativeAthletes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'athletes.json'), 'utf8'));
  const nativeKeys = Object.keys(nativeAthletes);
  // Indice per cognome (primo token) -> lista di chiavi native con quel cognome
  const byCognome = new Map();
  for (const k of nativeKeys) {
    const cognome = k.split('_')[0];
    if (!byCognome.has(cognome)) byCognome.set(cognome, []);
    byCognome.get(cognome).push(k);
  }

  // Tutti gli atleta_id distinti usati in pcs_gara_results, con un esempio
  // di rider_name/team_name/season per contesto.
  const seen = new Map();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('pcs_gara_results')
      .select('atleta_id, rider_name, team_name, season')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    for (const r of data) {
      if (!r.atleta_id || seen.has(r.atleta_id)) continue;
      seen.set(r.atleta_id, r);
    }
    if (data.length < PAGE) break;
  }
  console.log(`Atleti distinti nel circuito ICS: ${seen.size}\n`);

  const candidates = [];
  for (const [aid, sample] of seen) {
    if (nativeAthletes[aid]) continue; // già un atleta nativo con quell'id esatto, nessun problema
    const parts = aid.split('_');
    const cognome = parts[0];
    const pool = byCognome.get(cognome);
    if (!pool || !pool.length) continue;
    for (const nativeKey of pool) {
      if (nativeKey === aid) continue;
      const nativeParts = nativeKey.split('_');
      // Match se le parole del nome corto (pcs) sono TUTTE presenti, in ordine,
      // come prefisso delle parole del nome nativo (es. MARANGON_PAOLO è
      // prefisso di MARANGON_PAOLO_GRAZIANO) — evita falsi positivi tra
      // persone diverse con lo stesso cognome ma nome completamente diverso.
      if (nativeParts.length > parts.length && parts.every((w, i) => nativeParts[i] === w)) {
        candidates.push({ pcsId: aid, nativeId: nativeKey, riderName: sample.rider_name, teamName: sample.team_name, nativeTeam: nativeAthletes[nativeKey].team_attuale, season: sample.season });
      }
    }
  }

  console.log(`Candidati doppione trovati: ${candidates.length}\n`);
  for (const c of candidates) {
    const sameTeam = (c.teamName || '').toUpperCase().trim() === (c.nativeTeam || '').toUpperCase().trim();
    console.log(`${c.pcsId}  →  ${c.nativeId}  ${sameTeam ? '(stessa squadra ✓)' : `(squadra diversa: "${c.teamName}" vs "${c.nativeTeam}")`}  [stagione ${c.season}]`);
  }
}

main().catch(e => { console.error('ERRORE FATALE:', e); process.exit(1); });
