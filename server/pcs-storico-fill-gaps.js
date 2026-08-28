'use strict';
// Colma i "buchi" lasciati da pcs-athlete-import-storico.js: per un atleta
// già marcato completo (entity_overrides pcs_slug impostato), la cronologia
// squadre (pcs_team_history) può includere anni per cui NON è mai stato
// salvato nessun risultato in pcs_results — il ciclo che li scarica uno per
// uno può essersi interrotto a metà (script killato/riavviato durante la
// notte, tantissime volte in questa sessione) mentre pcs_slug era già stato
// scritto PRIMA di quel ciclo, quindi --skip-complete non lo riprova più.
// Effetto visibile: sul profilo compaiono le squadre di quegli anni ma
// nessun risultato sotto la pillola stagione corrispondente (segnalato
// dall'utente su ZEITS_ANDREY: squadre 2008-2023, risultati fermi al 2012).
//
// A differenza dello script principale, qui si visita SOLO l'anno mancante
// per gli atleti che hanno davvero un buco — molto più mirato/veloce di un
// rilancio completo.
//
// Uso: node pcs-storico-fill-gaps.js [--limit=N]

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
const { launchPcsBrowser, gotoPcsPage, humanDelay, withTimeout } = require('./pcs-browser');

const SUPABASE_URL = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta SUPABASE_SECRET in server/.env.local'); process.exit(1); }

const args = process.argv.slice(2);
const LIMIT = parseInt((args.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '') || null;

// Stessa identica logica di estrazione tabella risultati di
// pcs-athlete-import-storico.js (extractResultsOnly) — duplicata qui
// apposta, per non dover esportare nulla dallo script principale e non
// rischiare di alterarne il comportamento.
async function extractResultsOnly(page, season) {
  return page.evaluate((season) => {
    const rows = [];
    const tables = [...document.querySelectorAll('table')];
    for (const table of tables) {
      const headers = [...table.querySelectorAll('th')].map(th => th.textContent.trim().toLowerCase());
      const hasResult = headers.some(h => /result|ris\.|pos|place/.test(h));
      const hasRace   = headers.some(h => /race|gara|corsa/.test(h));
      if (!hasResult && !hasRace) continue;
      let iDate = -1, iRace = -1, iCat = -1, iResult = -1, iTime = -1;
      headers.forEach((h, i) => {
        if (iDate   < 0 && /date|data/.test(h))               iDate   = i;
        if (iRace   < 0 && /race|gara|corsa/.test(h))         iRace   = i;
        if (iCat    < 0 && /cat|class/.test(h))               iCat    = i;
        if (iResult < 0 && /result|ris\.|pos|place/.test(h))  iResult = i;
        if (iTime   < 0 && /time|gap|distacco|\//.test(h))    iTime   = i;
      });
      if (iDate < 0 || iRace < 0 || iResult < 0) {
        const trs = table.querySelectorAll('tbody tr');
        if (!trs.length) continue;
        const firstRow = [...trs[0].querySelectorAll('td')];
        if (firstRow.length < 3) continue;
        if (/^\d{1,2}\.\d{2}$/.test(firstRow[0]?.textContent?.trim())) {
          iDate = 0; iRace = 1; iResult = firstRow.length >= 5 ? 3 : 2; iTime = firstRow.length >= 6 ? 4 : -1; iCat = firstRow.length >= 4 ? 2 : -1;
        } else continue;
      }
      let lastCountry = null, lastTourName = null, pendingGC = null;
      for (const tr of table.querySelectorAll('tbody tr')) {
        const cells = [...tr.querySelectorAll('td')];
        if (cells.length < 3) continue;
        const dateRaw = cells[iDate]?.textContent?.trim() || '';
        const raceCell = cells[iRace];
        const resultRaw = cells[iResult]?.textContent?.trim() || '';
        const timeRaw = iTime >= 0 ? (cells[iTime]?.textContent?.trim() || '') : '';
        const catRaw = iCat >= 0 ? (cells[iCat]?.textContent?.trim() || '') : '';
        const rawRaceText = raceCell?.textContent?.trim() || '';
        const flagEl = raceCell?.querySelector('span.flag');
        const flagClasses = flagEl ? [...flagEl.classList] : [];
        const ownCountry = flagClasses.find(c => c !== 'flag') || null;
        if (ownCountry) lastCountry = ownCountry;
        const country = ownCountry || lastCountry;
        const dm = dateRaw.match(/^(\d{1,2})\.(\d{2})$/);
        if (!dm) {
          const isClassificationRow = !!raceCell?.querySelector('.imob, .idesk');
          if (isClassificationRow) {
            if (/general classification/i.test(rawRaceText) && lastTourName) {
              const posStr = resultRaw.replace(/[^0-9]/g, '');
              const posizione = posStr ? parseInt(posStr) : null;
              if (posizione && posizione >= 1 && posizione <= 999) pendingGC = { tourName: lastTourName, posizione, catRaw, country };
            }
          } else if (rawRaceText) { lastTourName = rawRaceText; pendingGC = null; }
          continue;
        }
        const data = `${season}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`;
        const raceLink = raceCell?.querySelector('a');
        let pcs_race_slug = null, pcs_url = null, isStage = false, tourSlug = null;
        if (raceLink) {
          const href = raceLink.getAttribute('href') || '';
          pcs_url = href.replace(/^\/+/, '');
          const m = href.match(/(?:^|\/)(?:national-)?race\/([a-z0-9-]+)\/\d{4}\/?(.*)$/i);
          if (m) {
            const stagePart = m[2] && m[2] !== 'result' ? '-' + m[2].replace(/\//g, '-') : '';
            pcs_race_slug = m[1] + stagePart; isStage = !!stagePart; tourSlug = m[1];
          }
        }
        if (!rawRaceText || !pcs_race_slug) continue;
        if (pendingGC && isStage && pendingGC.tourName === lastTourName && tourSlug) {
          rows.push({ data, gara_name: `${pendingGC.tourName} — Classifica Generale`, pcs_race_slug: tourSlug + '-gc', pcs_url: `race/${tourSlug}/${season}/gc`, posizione: pendingGC.posizione, distacco: null, cat: pendingGC.catRaw, country: pendingGC.country });
        }
        pendingGC = null;
        const stageIdx = rawRaceText.indexOf('Stage ');
        const cleanedLabel = stageIdx >= 0 ? rawRaceText.slice(stageIdx) : rawRaceText;
        const gara_name = (isStage && lastTourName) ? `${lastTourName} — ${cleanedLabel}` : cleanedLabel;
        const posStr = resultRaw.replace(/[^0-9]/g, '');
        const posizione = posStr ? parseInt(posStr) : null;
        if (!posizione || posizione < 1 || posizione > 999) continue;
        let distacco = null;
        if (posizione !== 1 && timeRaw && timeRaw !== '-' && timeRaw !== '0:00:00') distacco = timeRaw.startsWith('+') ? timeRaw : ('+' + timeRaw);
        rows.push({ data, gara_name, pcs_race_slug, pcs_url, posizione, distacco, cat: catRaw, country });
      }
      if (rows.length > 0) break;
    }
    return rows;
  }, season).catch(() => []);
}

async function upsertResults(sb, rows) {
  if (!rows.length) return;
  const { error } = await sb.from('pcs_results').upsert(rows, { onConflict: 'atleta_id,season,pcs_race_slug' });
  if (error) throw error;
}

async function findGaps(sb) {
  // thByAtleta = ogni anno che PCS "dovrebbe" avere per l'atleta: sia dalla
  // storia squadra, SIA dagli anni già coperti da ciclismo.info — che
  // pubblica solo i primi arrivati, quindi anche un anno "coperto" può
  // nascondere un piazzamento più basso visibile solo su PCS (richiesta
  // esplicita dell'utente, stessa correzione fatta in
  // pcs-athlete-import-storico.js).
  const thByAtleta = new Map(), resByAtleta = new Map(), slugByAtleta = new Map();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('pcs_team_history').select('atleta_id, season').range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    for (const r of data) { if (!thByAtleta.has(r.atleta_id)) thByAtleta.set(r.atleta_id, new Set()); thByAtleta.get(r.atleta_id).add(r.season); }
    if (data.length < PAGE) break;
  }
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('ciclismo_results').select('atleta_id, stagione').not('atleta_id', 'is', null).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    for (const r of data) {
      const y = parseInt(r.stagione, 10);
      if (!thByAtleta.has(r.atleta_id)) thByAtleta.set(r.atleta_id, new Set());
      thByAtleta.get(r.atleta_id).add(y);
    }
    if (data.length < PAGE) break;
  }
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('pcs_results').select('atleta_id, season').range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    for (const r of data) { if (!resByAtleta.has(r.atleta_id)) resByAtleta.set(r.atleta_id, new Set()); resByAtleta.get(r.atleta_id).add(r.season); }
    if (data.length < PAGE) break;
  }
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('entity_overrides').select('entity_id, new_value')
      .eq('entity_type', 'atleta').eq('field', 'pcs_slug').range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    for (const r of data) slugByAtleta.set(r.entity_id, r.new_value);
    if (data.length < PAGE) break;
  }

  const currentYear = new Date().getFullYear();
  const out = [];
  for (const [atletaId, seasons] of thByAtleta) {
    const slug = slugByAtleta.get(atletaId);
    if (!slug) continue;
    const have = resByAtleta.get(atletaId) || new Set();
    const missing = [...seasons].filter(y => y <= currentYear && !have.has(y)).sort((a, b) => a - b);
    if (missing.length) out.push({ atletaId, slug, missing });
  }
  return out;
}

(async () => {
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  console.log('=== PCS Storico: colma i buchi (squadra nota ma risultati mancanti) ===\n');
  let gaps = await findGaps(sb);
  console.log(`Atleti con anni mancanti: ${gaps.length}`);
  if (LIMIT) gaps = gaps.slice(0, LIMIT);
  const totalYears = gaps.reduce((n, g) => n + g.missing.length, 0);
  console.log(`Anni totali da recuperare: ${totalYears}\n`);

  let { browser, context, page } = await launchPcsBrowser();
  let done = 0, errors = 0, totalRows = 0, i = 0;

  for (const g of gaps) {
    i++;
    process.stdout.write(`(${i}/${gaps.length}) ${g.atletaId} [${g.slug}] anni: ${g.missing.join(',')} … `);
    let rowsForAthlete = 0;
    for (const y of g.missing) {
      await humanDelay(i);
      if (page.isClosed() || browser.isConnected?.() === false) {
        try { await context.close().catch(() => {}); await browser.close().catch(() => {}); } catch {}
        ({ browser, context, page } = await launchPcsBrowser());
      }
      const nav = await gotoPcsPage(page, `https://www.procyclingstats.com/rider/${g.slug}/${y}`, { onLog: msg => process.stdout.write('\n  ' + msg) });
      if (!nav.ok) continue;
      let yearResults;
      try { yearResults = await withTimeout(extractResultsOnly(page, y), 20000, 'extractResultsOnly'); }
      catch { continue; }
      if (yearResults.length) {
        const rows = yearResults.map(r => ({ atleta_id: g.atletaId, pcs_slug: g.slug, season: y, gara_name: r.gara_name, data: r.data, posizione: r.posizione, distacco: r.distacco, pcs_race_slug: r.pcs_race_slug, pcs_url: r.pcs_url, country: r.country, gara_id: null }));
        try { await upsertResults(sb, rows); rowsForAthlete += rows.length; totalRows += rows.length; }
        catch (e) { errors++; process.stdout.write(`ERRORE DB ${y}: ${e.message} `); }
      }
    }
    done++;
    console.log(`✓ +${rowsForAthlete} ris.`);
  }

  try { await context.close(); await browser.close(); } catch {}
  console.log(`\n=== Completato === atleti: ${done}/${gaps.length} | risultati recuperati: ${totalRows} | errori: ${errors}`);
})().catch(e => { console.error('ERRORE FATALE', e); process.exit(1); });
