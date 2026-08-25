'use strict';
// Elenco arrivo COMPLETO delle gare "extra" (fuori dal circuito FCI, mai
// abbinate a un gara_id) scoperte tramite gli atleti che tracciamo. Finora
// pcs_results conteneva solo le righe dei NOSTRI atleti in quelle gare (in
// media ~11 su un centinaio di partenti) — chi apriva il modale "risultati
// gara" da una pagina atleta vedeva un ordine di arrivo pieno di buchi.
// Questo script visita la pagina risultati REALE della gara su PCS e salva
// TUTTI i corridori (posizione, nome, team, nazione), non solo i nostri —
// chi non è un nostro atleta tracciato resta senza atleta_id (nessun link
// al profilo, solo testo), esattamente come richiesto.
//
// Abbinamento all'atleta_id: via pcs_slug (lo slug del profilo PCS del
// corridore, es. "rider/ettore-martinelli"), non per nome — affidabile al
// 100%, lo slug è un identificativo interno di PCS, non ambiguo come un nome.
//
// Uso: node pcs-race-fullresults-import.js [--limit N] [--dry-run]

const path = require('path');
const cheerio = require('cheerio');
const { launchPcsBrowser, gotoPcsPage, humanDelay, sleep } = require('./pcs-browser');

(function loadEnv() {
  const fs = require('fs');
  const p = path.join(__dirname, '.env.local');
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  });
})();

const SUPABASE_URL = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('SUPABASE_SECRET mancante in .env.local'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

function parseResultsTable(html) {
  const $ = cheerio.load(html);
  const table = $('table.results').first();
  if (!table.length) return [];
  const rows = [];
  table.find('tbody > tr').each((_, tr) => {
    const $tr = $(tr);
    const posText = $tr.find('> td').first().text().trim();
    const posizione = /^\d+$/.test(posText) ? parseInt(posText, 10) : null;
    const riderA = $tr.find('td.ridername a[href^="rider/"]').first();
    if (!riderA.length) return; // riga senza corridore (es. separatore) — salta
    const nomeCompleto = riderA.text().replace(/\s+/g, ' ').trim();
    if (!nomeCompleto) return;
    const pcsSlug = (riderA.attr('href') || '').replace(/^rider\//, '').trim();
    const flagSpan = $tr.find('td.ridername span.flag').first();
    const flagClass = (flagSpan.attr('class') || '').split(/\s+/).find(c => c !== 'flag') || '';
    const teamA = $tr.find('td.cu600 a[href^="team/"]').first();
    const team = teamA.length ? teamA.text().trim() : $tr.find('td.cu600').first().text().trim();
    const distacco = $tr.find('td.time').first().text().replace(/\s+/g, ' ').trim();
    rows.push({ posizione, pcsSlug, nomeCompleto, team, country: flagClass, distacco });
  });
  return rows;
}

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  console.log('Carico elenco gare extra (fuori dal circuito FCI) da coprire…');
  const { data: raceRows, error: e1 } = await sb
    .from('pcs_results')
    .select('pcs_race_slug, season, pcs_url, gara_name')
    .is('gara_id', null)
    .not('pcs_race_slug', 'is', null)
    .not('pcs_url', 'is', null);
  if (e1) throw e1;

  const raceMap = new Map();
  for (const r of raceRows) {
    const key = `${r.pcs_race_slug}|${r.season}`;
    if (!raceMap.has(key)) raceMap.set(key, r);
  }
  console.log(`${raceMap.size} gare distinte da coprire.\n`);

  console.log('Carico mappa pcs_slug → atleta_id (nostri atleti già tracciati)…');
  const { data: slugRows, error: e2 } = await sb
    .from('pcs_results')
    .select('pcs_slug, atleta_id')
    .not('pcs_slug', 'is', null);
  if (e2) throw e2;
  const slugToAtletaId = new Map();
  for (const r of slugRows) if (r.pcs_slug && r.atleta_id) slugToAtletaId.set(r.pcs_slug, r.atleta_id);
  console.log(`${slugToAtletaId.size} pcs_slug noti.\n`);

  console.log('Carico gare già completate (per non riscrapare)…');
  const { data: doneRows, error: e3 } = await sb.from('pcs_race_full_results').select('pcs_race_slug, season');
  if (e3) throw e3;
  const done = new Set((doneRows || []).map(r => `${r.pcs_race_slug}|${r.season}`));
  console.log(`${done.size} gare già coperte in precedenza.\n`);

  const todo = [...raceMap.entries()].filter(([key]) => !done.has(key)).slice(0, LIMIT);
  console.log(`${todo.length} gare da fare in questo giro.\n`);
  if (!todo.length) { console.log('Niente da fare.'); return; }

  const { browser, page } = await launchPcsBrowser();
  let done_n = 0, errors = 0, totalRows = 0, matched = 0;

  for (let i = 0; i < todo.length; i++) {
    const [key, race] = todo[i];
    const url = `https://www.procyclingstats.com/${race.pcs_url}`;
    process.stdout.write(`(${i + 1}/${todo.length}) ${race.gara_name} … `);

    const nav = await gotoPcsPage(page, url, { readySelector: 'table.results' });
    if (!nav.ok) {
      console.log(nav.notFound ? 'pagina non trovata, salto' : `errore (${nav.error || 'sconosciuto'}), riprovo al prossimo giro`);
      if (nav.closed) { console.log('Finestra browser chiusa — interrompo.'); break; }
      errors++;
      await sleep(2000);
      continue;
    }

    let html;
    try { html = await page.content(); } catch (e) { console.log('errore lettura pagina:', e.message); errors++; continue; }
    const rows = parseResultsTable(html);
    if (!rows.length) {
      console.log('nessuna tabella risultati (forse ancora da disputare o formato diverso)');
      await humanDelay(i);
      continue;
    }

    const toInsert = rows.map(r => ({
      pcs_race_slug: race.pcs_race_slug,
      season: race.season,
      posizione: r.posizione,
      pcs_slug: r.pcsSlug || null,
      atleta_id: r.pcsSlug ? (slugToAtletaId.get(r.pcsSlug) || null) : null,
      nome_completo: r.nomeCompleto,
      team: r.team || null,
      country: r.country || null,
      distacco: r.distacco || null,
    }));
    matched += toInsert.filter(r => r.atleta_id).length;
    totalRows += toInsert.length;

    if (DRY_RUN) {
      console.log(`[DRY] ${toInsert.length} righe (${toInsert.filter(r=>r.atleta_id).length} abbinate)`);
    } else {
      const { error: eIns } = await sb.from('pcs_race_full_results')
        .upsert(toInsert, { onConflict: 'pcs_race_slug,season,posizione,nome_completo' });
      if (eIns) { console.log(`✗ errore salvataggio: ${eIns.message}`); errors++; }
      else { console.log(`✓ ${toInsert.length} righe (${toInsert.filter(r=>r.atleta_id).length} abbinate)`); done_n++; }
    }
    await humanDelay(i);
  }

  await browser.close().catch(() => {});
  console.log(`\n=== ${DRY_RUN ? 'Simulazione' : 'Completato'} ===`);
  console.log(`Gare completate: ${done_n}/${todo.length}`);
  console.log(`Righe totali salvate: ${totalRows} (${matched} abbinate a un nostro atleta)`);
  console.log(`Errori: ${errors}`);
})();
