'use strict';
// Unisce i profili doppi trovati da find-name-duplicates.js: sposta ogni
// riferimento dall'atleta_id "corto" (creato dall'importer del circuito ICS
// da un nome senza secondo nome) a quello FCI nativo corretto, poi elimina
// il profilo corto residuo. Nessuna cancellazione di dati storici, solo
// riassegnazione dell'id.
//
// Uso: node merge-duplicate-athletes.js

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

const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const SUPABASE_URL = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;

const PAIRS = [
  ['BORREMANS_KASPER', 'BORREMANS_KASPER_TOBIAS'],
  ['FEDRIZZI_BRANDON', 'FEDRIZZI_BRANDON_DAVIDE'],
  ['CRANAGE_JOSHUA', 'CRANAGE_JOSHUA_JAMES'],
  ['CACCHIO_MICHELE', 'CACCHIO_MICHELE_PIO'],
  ['SIMS_OLIVER', 'SIMS_OLIVER_EDWARD_ANTHONY'],
  ['BOZICEVICH_MATTEO', 'BOZICEVICH_MATTEO_LAPO'],
  ['GAGGIOLI_LUCIANO', 'GAGGIOLI_LUCIANO_WILLIAM'],
  ['CASABONA_IVAN', 'CASABONA_IVAN_ALDO'],
  ['GHELFI_LORENZO', 'GHELFI_LORENZO_MASSIMO'],
  ['MARANGON_PAOLO', 'MARANGON_PAOLO_GRAZIANO'],
];

// Tabelle con colonna atleta_id semplice: riassegnazione diretta.
const SIMPLE_TABLES = [
  'athlete_follows', 'athlete_profiles', 'ciclismo_athletes', 'ciclismo_gara_media',
  'ciclismo_results', 'manual_athletes', 'manual_results', 'pcs_gara_results',
  'pcs_race_full_results', 'pcs_results',
];

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  for (const [shortId, fullId] of PAIRS) {
    console.log(`\n--- ${shortId} → ${fullId} ---`);
    for (const table of SIMPLE_TABLES) {
      const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true }).eq('atleta_id', shortId);
      if (error) { console.log(`  ${table}: errore (${error.message})`); continue; }
      if (!count) continue;
      const { error: updErr } = await sb.from(table).update({ atleta_id: fullId }).eq('atleta_id', shortId);
      if (updErr) console.log(`  ${table}: ${count} righe trovate, ERRORE aggiornamento: ${updErr.message}`);
      else console.log(`  ${table}: ${count} righe spostate su ${fullId}`);
    }

    // family_links.linked_atleta_id
    {
      const { count, error } = await sb.from('family_links').select('*', { count: 'exact', head: true }).eq('linked_atleta_id', shortId);
      if (!error && count) {
        const { error: updErr } = await sb.from('family_links').update({ linked_atleta_id: fullId }).eq('linked_atleta_id', shortId);
        console.log(`  family_links: ${count} righe ${updErr ? 'ERRORE: ' + updErr.message : 'spostate su ' + fullId}`);
      }
    }

    // entity_overrides: entity_id generico, va filtrato per entity_type per non toccare altro
    {
      const { data: overrides, error } = await sb.from('entity_overrides').select('id, entity_type, field').eq('entity_id', shortId);
      if (!error && overrides && overrides.length) {
        for (const ov of overrides) {
          const { error: updErr } = await sb.from('entity_overrides').update({ entity_id: fullId }).eq('id', ov.id);
          console.log(`  entity_overrides: override "${ov.field}" (${ov.entity_type}) ${updErr ? 'ERRORE: ' + updErr.message : 'spostato su ' + fullId}`);
        }
      }
    }

    // race_photos.atleta_ids è una CSV testuale — sostituzione di sottostringa esatta (id delimitato da virgole)
    {
      const { data: photos, error } = await sb.from('race_photos').select('id, atleta_ids').ilike('atleta_ids', `%${shortId}%`);
      if (!error && photos && photos.length) {
        for (const ph of photos) {
          const ids = String(ph.atleta_ids || '').split(',').map(s => s.trim());
          if (!ids.includes(shortId)) continue; // match parziale casuale su un altro id, non toccare
          const newIds = [...new Set(ids.map(id => id === shortId ? fullId : id))].join(',');
          const { error: updErr } = await sb.from('race_photos').update({ atleta_ids: newIds }).eq('id', ph.id);
          console.log(`  race_photos: foto #${ph.id} ${updErr ? 'ERRORE: ' + updErr.message : 'aggiornata'}`);
        }
      }
    }

    // Elimina il profilo manual_athletes/ciclismo_athletes corto residuo, se esiste (non dovrebbe: erano id sintetici PCS, mai in manual_athletes)
    const { error: delErr } = await sb.from('manual_athletes').delete().eq('atleta_id', shortId);
    if (!delErr) console.log(`  manual_athletes: eventuale profilo corto rimosso`);
  }

  console.log('\n=== FATTO ===');
}

main().catch(e => { console.error('ERRORE FATALE:', e); process.exit(1); });
