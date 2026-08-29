'use strict';
// Import mirato di 2 edizioni della "Coppa Pietro Linari" (2008 e 2012) che
// mancavano nel nostro DB — trovate confrontando il nostro storico con
// l'albo d'oro ufficiale del club organizzatore (PDF fornito dall'utente:
// ciclisticaborgoabuggiano.it) e recuperate tramite il blocco "Edizioni
// precedenti" della pagina 2013 (stesso meccanismo usato per l'albo d'oro).
// Stessa identica logica di inserimento di ciclismo-gara-scraper.js (non
// duplicata per pigrizia: è solo per 2 gare, non vale la pena generalizzare
// qui l'enumerazione completa) — vedi quel file per i commenti estesi sulle
// scelte (pcsIds, manualIds, ecc.).
//
// Uso: node ciclismo-import-two-races.js

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
const { fetchDecoded, parseGaraPage } = require('./ciclismo-info-test.js');

const SUPABASE_URL = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta SUPABASE_SECRET in server/.env.local'); process.exit(1); }

function normalizeToAtletaId(nomeCompleto) {
  return String(nomeCompleto || '')
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const RACES = [
  {
    url: 'http://juniores.ciclismo.info/gara_juniores_1654_2008_08_18_borgo_a_buggiano_pt_47_coppa_linari.htm',
    stagione: '2008', categoria: 'JUNIORES', data: '2008-08-18', regione: 'TOSCANA', luogo: 'Borgo a Buggiano (PT)',
    nome_gara: '47 COPPA LINARI',
  },
  {
    url: 'http://juniores.ciclismo.info/gara_juniores_10121_2012_08_18_borgo_a_buggiano_pt_51_coppa_pietro_linari.htm',
    stagione: '2012', categoria: 'JUNIORES', data: '2012-08-18', regione: 'TOSCANA', luogo: 'Borgo a Buggiano (PT)',
    nome_gara: '51 COPPA PIETRO LINARI',
  },
  // Il Gran Premio Industria Commercio Artigianato Carnaghese 2017 (46a
  // edizione) NON manca per un bug: è stata sospesa e poi annullata a
  // gara in corso ("È stato sospeso e poi annullato il 46° Gran Premio..."
  // — articolo ciclismo.info del 2017). Correttamente assente dal DB.
  // Verificato anche il 2022: nessuna traccia nemmeno nell'indice annuale
  // ciclismo.info della categoria, stessa conclusione.
];

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  const italiacritAthletes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'athletes.json'), 'utf8'));
  const italiacritIds = new Set(Object.keys(italiacritAthletes));

  const manualIds = new Set();
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from('manual_athletes').select('atleta_id').range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || !data.length) break;
      data.forEach(r => manualIds.add(r.atleta_id));
      if (data.length < PAGE) break;
    }
  }
  const pcsIds = new Set();
  for (const table of ['pcs_results', 'pcs_gara_results', 'pcs_race_full_results']) {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from(table).select('atleta_id').range(from, from + PAGE - 1);
      if (error) break;
      if (!data || !data.length) break;
      data.forEach(r => { if (r.atleta_id) pcsIds.add(r.atleta_id); });
      if (data.length < PAGE) break;
    }
  }
  console.log(`Atleti italiacrit: ${italiacritIds.size} | Profili manuali: ${manualIds.size} | Atleti PCS: ${pcsIds.size}\n`);

  const teams = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'teams.json'), 'utf8'));
  const teamIdByName = new Map(Object.values(teams).map(t => [String(t.nome || '').trim().toUpperCase(), t.id]));

  for (const sample of RACES) {
    console.log(`\n=== ${sample.nome_gara} (${sample.stagione}) ===`);
    let html;
    try { html = await fetchDecoded(sample.url); } catch (e) { console.log('  ERRORE fetch:', e.message); continue; }
    const { ordineArrivo } = parseGaraPage(html, sample.url);
    console.log(`  ordine di arrivo estratto: ${ordineArrivo.length} piazzamenti`);
    if (!ordineArrivo.length) { console.log('  nessun dato, salto'); continue; }

    let inseriti = 0;
    for (const row of ordineArrivo) {
      if (!row.ciclismoId) continue;
      const nomeCompleto = row.nome;
      const atletaIdDerivato = normalizeToAtletaId(nomeCompleto);
      const matched = italiacritIds.has(atletaIdDerivato) || manualIds.has(atletaIdDerivato);

      const athPayload = { ciclismo_id: row.ciclismoId, nome_completo: nomeCompleto, updated_at: new Date().toISOString() };
      if (matched) athPayload.atleta_id = atletaIdDerivato;
      const { data: existingAth } = await sb.from('ciclismo_athletes').select('atleta_id').eq('ciclismo_id', row.ciclismoId).maybeSingle();
      await sb.from('ciclismo_athletes').upsert(athPayload, { onConflict: 'ciclismo_id' });

      let finalAtletaId = matched ? atletaIdDerivato : ((existingAth && existingAth.atleta_id) || null);

      if (!finalAtletaId && !pcsIds.has(atletaIdDerivato)) {
        const { data: existingManual } = await sb.from('manual_athletes').select('atleta_id').eq('atleta_id', atletaIdDerivato).maybeSingle();
        if (existingManual) {
          finalAtletaId = atletaIdDerivato;
        } else {
          const nomeParts = String(nomeCompleto || '').trim().split(/\s+/);
          const cognome = nomeParts[0] || nomeCompleto;
          const nomeP = nomeParts.slice(1).join(' ') || '-';
          // Categoria del PROFILO atleta (non della gara) — dedotta dalla
          // categoria della gara corrente, non più sempre "JUN_M": la
          // Carnaghese è ELITE_UNDER23, un profilo creato con la categoria
          // sbagliata finirebbe nella scheda "Juniores" invece che
          // "Elite/U23".
          const CAT_MAP = { ESORDIENTI1: 'ES1_M', ESORDIENTI2: 'ES2_M', ALLIEVI: 'AL_M', JUNIORES: 'JUN_M', ELITE_UNDER23: 'ELI_M' };
          const categoria = CAT_MAP[sample.categoria] || 'JUN_M';
          const team = row.team || null;
          const team_id = team
            ? (teamIdByName.get(team.trim().toUpperCase())
              || team.trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
            : null;
          const { error: profErr } = await sb.from('manual_athletes').upsert({
            atleta_id: atletaIdDerivato, cognome, nome: nomeP, team_id, team, categoria, genere: 'M',
            created_by: null, source: 'ciclismo_info',
          }, { onConflict: 'atleta_id', ignoreDuplicates: true });
          if (!profErr) finalAtletaId = atletaIdDerivato;
        }
        if (finalAtletaId) await sb.from('ciclismo_athletes').update({ atleta_id: finalAtletaId }).eq('ciclismo_id', row.ciclismoId);
      }

      const { error: insErr } = await sb.from('ciclismo_results').upsert({
        ciclismo_id: row.ciclismoId,
        atleta_id: finalAtletaId,
        stagione: sample.stagione, categoria: sample.categoria, team: row.team,
        posizione: row.posizione, data: sample.data, regione: sample.regione, luogo: sample.luogo,
        nome_gara: sample.nome_gara, gara_ciclismo_url: sample.url,
      }, { onConflict: 'ciclismo_id,stagione,data,nome_gara' });
      if (insErr) { console.log(`  errore riga ${row.posizione} ${nomeCompleto}:`, insErr.message); continue; }
      inseriti++;
      console.log(`  ${row.posizione}° ${nomeCompleto} (${row.team || '-'}) -> ${finalAtletaId || 'ciclismo_id ' + row.ciclismoId + ' (nessun profilo)'}`);
    }
    console.log(`  totale inseriti/aggiornati: ${inseriti}`);
    await sb.from('ciclismo_gara_scan_state').upsert({ gara_ciclismo_url: sample.url, status: 'done', trovati: ordineArrivo.length, inseriti });
  }

  console.log('\n=== FATTO ===');
}

main().catch(e => { console.error('\nERRORE FATALE:', e?.message || e, '\n', e?.stack || ''); process.exit(1); });
