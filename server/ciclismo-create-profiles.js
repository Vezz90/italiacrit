'use strict';
// Crea un profilo italiacrit (manual_athletes) per ogni atleta ciclismo.info
// senza corrispondenza — poi ricollega ciclismo_athletes/ciclismo_results/
// ciclismo_gara_media al nuovo atleta_id. Salva un report delle collisioni
// (due ciclismo_id diversi che risolverebbero allo STESSO atleta_id — quasi
// certamente due persone reali con lo stesso nome, non la stessa persona) per
// revisione manuale invece di fonderle per sbaglio in un unico profilo.
//
// Uso: node ciclismo-create-profiles.js

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

function normalizeToAtletaId(nomeCompleto) {
  return String(nomeCompleto || '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Mappa (best-effort) delle categorie ciclismo.info sui codici italiacrit —
// il sistema italiacrit non distingue Esordienti1/2 per le donne (osservato:
// un'atleta "Donne Esordienti" reale risultava già in italiacrit come "AL_F"),
// quindi per le categorie femminili si usa una mappa più larga.
const CAT_MAP = {
  ESORDIENTI1: 'ES1_M', ESORDIENTI2: 'ES2_M', ALLIEVI: 'AL_M', JUNIORES: 'JUN_M', ELITE_UNDER23: 'ELI_M',
  DONNE_ESORDIENTI: 'AL_F', DONNE_ALLIEVE: 'AL_F', DONNE_JUNIORES: 'JUN_F',
};

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });
  const teams = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'teams.json'), 'utf8'));
  const teamIdByName = new Map(Object.values(teams).map(t => [String(t.nome || '').trim().toUpperCase(), t.id]));

  // Tutti gli unmatched
  const unmatched = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('ciclismo_athletes').select('ciclismo_id, nome_completo').is('atleta_id', null).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    unmatched.push(...data);
    if (data.length < PAGE) break;
  }
  console.log(`Atleti da creare: ${unmatched.length}\n`);

  // Rileva collisioni PRIMA di scrivere: due ciclismo_id diversi -> stesso atleta_id derivato
  const byDerivedId = new Map();
  for (const a of unmatched) {
    const id = normalizeToAtletaId(a.nome_completo);
    if (!byDerivedId.has(id)) byDerivedId.set(id, []);
    byDerivedId.get(id).push(a);
  }
  const collisions = [...byDerivedId.entries()].filter(([, list]) => list.length > 1);
  console.log(`Collisioni rilevate (stesso nome, ciclismo_id diversi — SALTATE, vanno riviste a mano): ${collisions.length}\n`);

  let created = 0, relinked = 0, skippedCollision = 0, errori = 0;
  const skippedList = [];

  for (const [derivedId, list] of byDerivedId) {
    if (list.length > 1) { skippedCollision += list.length; skippedList.push({ derivedId, ciclismoIds: list.map(x => x.ciclismo_id) }); continue; }
    const a = list[0];

    try {
      // Ultimo risultato noto (stagione più recente) per team/categoria attuali
      const { data: lastResult } = await sb.from('ciclismo_results')
        .select('team, categoria, stagione')
        .eq('ciclismo_id', a.ciclismo_id)
        .order('stagione', { ascending: false })
        .limit(1).maybeSingle();

      const nomeParts = String(a.nome_completo || '').trim().split(/\s+/);
      const cognome = nomeParts[0] || a.nome_completo;
      const nome = nomeParts.slice(1).join(' ') || '-';
      const catRaw = (lastResult && lastResult.categoria) || '';
      const genere = /DONNE/i.test(catRaw) ? 'F' : 'M';
      const categoria = CAT_MAP[catRaw] || (genere === 'F' ? 'AL_F' : 'AL_M');
      const team = (lastResult && lastResult.team) || null;
      const team_id = team ? (teamIdByName.get(team.trim().toUpperCase()) || null) : null;

      const { error: insErr } = await sb.from('manual_athletes').upsert({
        atleta_id: derivedId, cognome, nome, team_id, team, categoria, genere,
        created_by: null, source: 'ciclismo_info',
      }, { onConflict: 'atleta_id', ignoreDuplicates: true });
      if (insErr) { errori++; console.log(`  ERRORE creazione ${derivedId}: ${insErr.message}`); continue; }
      created++;

      // Ricollega tutte le tabelle ciclismo_* a questo atleta_id
      await sb.from('ciclismo_athletes').update({ atleta_id: derivedId }).eq('ciclismo_id', a.ciclismo_id);
      await sb.from('ciclismo_results').update({ atleta_id: derivedId }).eq('ciclismo_id', a.ciclismo_id);
      await sb.from('ciclismo_gara_media').update({ atleta_id: derivedId }).eq('ciclismo_id', a.ciclismo_id);
      relinked++;

      if (created % 200 === 0) console.log(`  ${created}/${unmatched.length - skippedCollision}...`);
    } catch (e) { errori++; console.log(`  ERRORE ${derivedId}: ${e.message}`); }
  }

  const scratchDir = 'C:/Users/vezza/AppData/Local/Temp/claude/C--Users-vezza--gemini-antigravity-scratch-gpx-viewer/05519ddc-787f-45f0-99c4-8aa81465dda1/scratchpad';
  fs.writeFileSync(path.join(scratchDir, 'ciclismo-profile-collisions.json'), JSON.stringify(skippedList, null, 2));

  console.log(`\n=== FATTO ===`);
  console.log(`Profili creati: ${created} | Ricollegati: ${relinked} | Saltati per collisione: ${skippedCollision} (${collisions.length} gruppi) | Errori: ${errori}`);
  console.log(`Report collisioni salvato in: ${path.join(scratchDir, 'ciclismo-profile-collisions.json')}`);
}

main().catch(e => { console.error('ERRORE FATALE:', e); process.exit(1); });
