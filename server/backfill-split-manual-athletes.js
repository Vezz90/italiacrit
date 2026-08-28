'use strict';
// Le omonimie separate da split-namesake-athletes.js ricevono un nuovo
// atleta_id (es. RINALDI_LUCA_2008) su ciclismo_athletes/ciclismo_results/
// ciclismo_gara_media, ma NESSUNA riga in manual_athletes (quella resta sul
// cluster "canonico", che tiene l'id originale). /api/pcs-athlete/:id però
// usa proprio manual_athletes come ultimo fallback per gli atleti visti solo
// da ciclismo.info — senza una riga lì, la scheda profilo dà 404 anche se
// l'atleta è cliccabile ovunque sul sito (bug segnalato dall'utente su
// RINALDI_LUCA_2008). Stessa logica di creazione di ciclismo-create-profiles.js,
// solo puntata sui nuovi id "scissi" invece che sugli unmatched originali.
//
// Uso: node backfill-split-manual-athletes.js

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
if (!SUPABASE_SECRET) { console.error('Imposta SUPABASE_SECRET in server/.env.local'); process.exit(1); }

const CAT_MAP = {
  ESORDIENTI1: 'ES1_M', ESORDIENTI2: 'ES2_M', ALLIEVI: 'AL_M', JUNIORES: 'JUN_M', ELITE_UNDER23: 'ELI_M',
  DONNE_ESORDIENTI: 'AL_F', DONNE_ALLIEVE: 'AL_F', DONNE_JUNIORES: 'JUN_F',
};

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });
  const teams = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'teams.json'), 'utf8'));
  const teamIdByName = new Map(Object.values(teams).map(t => [String(t.nome || '').trim().toUpperCase(), t.id]));

  console.log('Cerco atleta_id "scissi" senza profilo manual_athletes…');
  const splitAthletes = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('ciclismo_athletes')
      .select('ciclismo_id, atleta_id, nome_completo, data_nascita')
      .not('atleta_id', 'is', null)
      .order('ciclismo_id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    splitAthletes.push(...data);
    if (data.length < PAGE) break;
  }
  const splitIds = [...new Set(splitAthletes
    .filter(a => /_(19|20)[0-9]{2}$/.test(a.atleta_id))
    .map(a => a.atleta_id))];
  console.log(`atleta_id scissi trovati: ${splitIds.length}`);

  const { data: existingManual } = await sb.from('manual_athletes').select('atleta_id').in('atleta_id', splitIds);
  const haveManual = new Set((existingManual || []).map(r => r.atleta_id));
  const missing = splitIds.filter(id => !haveManual.has(id));
  console.log(`già con profilo: ${haveManual.size} — da creare: ${missing.length}\n`);
  if (!missing.length) { console.log('Niente da fare.'); return; }

  const nameById = new Map();
  for (const a of splitAthletes) if (!nameById.has(a.atleta_id)) nameById.set(a.atleta_id, a.nome_completo);

  let created = 0, errori = 0;
  for (const atletaId of missing) {
    try {
      const { data: lastResult } = await sb.from('ciclismo_results')
        .select('team, categoria, stagione')
        .eq('atleta_id', atletaId)
        .order('stagione', { ascending: false })
        .limit(1).maybeSingle();

      const nomeCompleto = nameById.get(atletaId) || atletaId.replace(/_(19|20)[0-9]{2}$/, '').replace(/_/g, ' ');
      const nomeParts = String(nomeCompleto).trim().split(/\s+/);
      const cognome = nomeParts[0] || nomeCompleto;
      const nome = nomeParts.slice(1).join(' ') || '-';
      const catRaw = (lastResult && lastResult.categoria) || '';
      const genere = /DONNE/i.test(catRaw) ? 'F' : 'M';
      const categoria = CAT_MAP[catRaw] || (genere === 'F' ? 'AL_F' : 'AL_M');
      const team = (lastResult && lastResult.team) || null;
      const team_id = team
        ? (teamIdByName.get(team.trim().toUpperCase())
          || team.trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
        : null;

      const { error: insErr } = await sb.from('manual_athletes').upsert({
        atleta_id: atletaId, cognome, nome, team_id, team, categoria, genere,
        created_by: null, source: 'ciclismo_info',
      }, { onConflict: 'atleta_id', ignoreDuplicates: true });
      if (insErr) { errori++; console.log(`  ✗ ${atletaId}: ${insErr.message}`); continue; }
      created++;
      console.log(`  ✓ ${atletaId} (${cognome} ${nome}, ${team || 'squadra sconosciuta'})`);
    } catch (e) { errori++; console.log(`  ✗ ${atletaId}: ${e.message}`); }
  }
  console.log(`\n=== FATTO === profili creati: ${created} — errori: ${errori}`);
}

main().catch(e => { console.error('ERRORE FATALE', e); process.exit(1); });
