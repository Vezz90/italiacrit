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

const fs = require('fs'), path = require('path');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const { launchPcsBrowser, gotoPcsPage, humanDelay, withTimeout } = require('./pcs-browser');

const SUPABASE_URL = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta SUPABASE_SECRET in server/.env.local'); process.exit(1); }

const args = process.argv.slice(2);
const LIMIT = parseInt((args.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '') || null;
// --atleta-id=ID1,ID2: solo questi atleti (es. per colmare subito un profilo segnalato, senza aspettare l'intera lista)
const ONLY_IDS = new Set(String((args.find(a => a.startsWith('--atleta-id=')) || '').split('=')[1] || '').split(',').filter(Boolean));

// Stessa identica logica di estrazione tabella risultati di
// pcs-athlete-import-storico.js (extractResultsOnly) — duplicata qui
// apposta, per non dover esportare nulla dallo script principale e non
// rischiare di alterarne il comportamento.
// PCS, per un anno in cui il corridore non ha risultati, serve la pagina dell'ULTIMA stagione: senza controllo quei risultati venivano
// salvati con l'anno richiesto (Branchini: 12 righe del 2026 copiate su 2018-2025). L'anno vero sta nel link della gara.
function urlYear(u) {
  const s = String(u || '');
  let m = s.match(/race\/[^/]+\/((?:19|20)\d{2})(?:\/|$)/);
  if (m) return +m[1];
  m = s.match(/race\/.+?-((?:19|20)\d{2})(?:-[a-z0-9-]+)?$/i);
  return m ? +m[1] : null;
}
// Ciclocross e gare invernali: lo slug porta l'anno d'inizio della stagione (es. ...-2025 per una gara di gennaio 2026), quindi si accetta
// anche l'anno vicino quando la data cade a cavallo (gen-mar con anno-1, nov-dic con anno+1).
function yearMatches(r, season) {
  const y = urlYear(r.pcs_url);
  if (y == null || y === season) return true;
  const mo = parseInt(String(r.data || '').slice(5, 7), 10);
  return (y === season - 1 && mo >= 1 && mo <= 3) || (y === season + 1 && mo >= 11);
}
function onlyThisSeason(rows, season) {
  const withYear = rows.filter(r => urlYear(r.pcs_url) != null);
  if (withYear.length && withYear.every(r => !yearMatches(r, season))) return [];      // pagina di un'altra stagione: nessun risultato per questo anno
  return rows.filter(r => yearMatches(r, season));
}

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
          let m = href.match(/(?:^|\/)(?:national-)?race\/([a-z0-9-]+)\/\d{4}\/?(.*)$/i);
          // nuovo formato dei link PCS (da settembre 2026): race/<gara>-<anno>-<result|stage-N|gc|...> invece di race/<gara>/<anno>/<...>
          if (!m) { const n = href.match(/(?:^|\/)(?:national-)?race\/([a-z0-9-]+?)-(\d{4})(?:-(.+))?$/i); if (n) m = [n[0], n[1], n[3] || '']; }
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

// ── Elenco dei "buchi": per ogni atleta con profilo PCS, gli anni in cui PCS dovrebbe avere risultati e noi no ──────────────────────
// Si interroga a blocchi di atleti (IN su atleta_id) invece di scorrere intere tabelle da centinaia di migliaia di righe: la scansione
// completa andava in "statement timeout". Gli anni gia' visitati (anche quelli senza risultati su PCS) si ricordano in pcs-fillgaps-state.json,
// cosi' un anno vuoto non ricompare all'infinito e il lavoro si puo' fermare e riprendere in qualsiasi momento.
const STATE_FILE = path.join(__dirname, 'pcs-fillgaps-state.json');
const PROGRESS_FILE = path.join(__dirname, 'logs', 'fillgaps-progress.json');
let state = {};
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) {}
let _stateDirty = false;
function markYear(aid, y, r) { state[`${aid}|${y}`] = { r, t: new Date().toISOString() }; _stateDirty = true; }
function saveState() { if (!_stateDirty) return; try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); _stateDirty = false; } catch (_) {} }
function yearDone(aid, y) {
  const s = state[`${aid}|${y}`];
  if (!s) return false;
  if (s.r === 'ok') return true;
  const days = (Date.now() - Date.parse(s.t)) / 86400000;
  return s.r === 'empty' ? days < 90 : days < 0.5;      // vuoto: si ricontrolla dopo 90 giorni; errore: dopo 12 ore
}

// Atleti appena collegati a PCS (pcs-retry-notfound.js): non hanno storico squadre, quindi gli anni da recuperare sono TUTTI quelli
// dal primo anno noto a oggi (gli anni senza gare su PCS restano vuoti e si ricordano come tali).
const MIRROR_FILE = path.join(__dirname, 'pcs-pro-mirror.json');   // "atleta|stagione" con solo gli arrivi copiati dalle gare pro
let MIRROR = new Set(); try { MIRROR = new Set(JSON.parse(fs.readFileSync(MIRROR_FILE, 'utf8'))); } catch (_) {}
const saveMirror = () => { try { fs.writeFileSync(MIRROR_FILE, JSON.stringify([...MIRROR])); } catch (_) {} };
const { createPhotoRefresher } = require('./pcs-photo-lib');   // controlla la foto profilo nella stessa visita (nessuna richiesta in piu)
const SPAN_FILE = path.join(__dirname, 'pcs-span-ids.json');
let SPAN = new Set(); try { SPAN = new Set(JSON.parse(fs.readFileSync(SPAN_FILE, 'utf8'))); } catch (_) {}

async function findGaps(sb) {
  const currentYear = new Date().getFullYear();
  const slugByAtleta = new Map();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from('entity_overrides').select('entity_id, new_value').eq('entity_type', 'atleta').eq('field', 'pcs_slug');
    if (ONLY_IDS.size) q = q.in('entity_id', [...ONLY_IDS]);
    const { data, error } = await q.order('id').range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    for (const r of data) slugByAtleta.set(r.entity_id, r.new_value);
    if (data.length < PAGE) break;
  }
  const ids = [...slugByAtleta.keys()];
  const out = [];
  const BATCH = 100;
  async function pageAll(build) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build().range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || !data.length) break;
      rows.push(...data);
      if (data.length < PAGE) break;
    }
    return rows;
  }
  for (let b = 0; b < ids.length; b += BATCH) {
    const chunk = ids.slice(b, b + BATCH);
    // un blocco che va in timeout si spezza a meta' e si riprova (alcuni atleti hanno migliaia di righe)
    const fetchChunk = async (ch, depth = 0) => {
      try {
        return await Promise.all([
          pageAll(() => sb.from('pcs_team_history').select('atleta_id, season').in('atleta_id', ch).order('atleta_id').order('season')),
          pageAll(() => sb.from('ciclismo_results').select('atleta_id, stagione').in('atleta_id', ch).order('id')),
          pageAll(() => sb.from('pcs_results').select('atleta_id, season').in('atleta_id', ch).order('id')),
        ]);
      } catch (e) {
        if (ch.length === 1) { if (depth < 3) { await new Promise(r => setTimeout(r, 3000)); return fetchChunk(ch, depth + 1); } return [[], [], []]; }
        const mid = Math.ceil(ch.length / 2);
        const a = await fetchChunk(ch.slice(0, mid), depth), c = await fetchChunk(ch.slice(mid), depth);
        return [a[0].concat(c[0]), a[1].concat(c[1]), a[2].concat(c[2])];
      }
    };
    const [th, cr, pr] = await fetchChunk(chunk);
    const want = new Map(), have = new Map();
    for (const r of th) { if (!want.has(r.atleta_id)) want.set(r.atleta_id, new Set()); want.get(r.atleta_id).add(r.season); }
    for (const r of cr) { const y = parseInt(r.stagione, 10); if (!want.has(r.atleta_id)) want.set(r.atleta_id, new Set()); want.get(r.atleta_id).add(y); }
    // stagioni con solo gli arrivi copiati dalle gare pro (pcs-pro-mirror.json) non contano come recuperate: il recupero le sostituisce
    for (const r of pr) { if (MIRROR.has(r.atleta_id + '|' + r.season)) continue; if (!have.has(r.atleta_id)) have.set(r.atleta_id, new Set()); have.get(r.atleta_id).add(r.season); }
    for (const aid of chunk) {
      const seasons = want.get(aid); if (!seasons) continue;
      if (SPAN.has(aid)) { const mn = Math.min(...seasons); for (let y = mn; y <= currentYear; y++) seasons.add(y); }
      const h = have.get(aid) || new Set();
      const missing = [...seasons].filter(y => y && y <= currentYear && !h.has(y) && !yearDone(aid, y)).sort((x, y) => x - y);
      if (missing.length) out.push({ atletaId: aid, slug: slugByAtleta.get(aid), missing, active: seasons.has(currentYear) || h.has(currentYear) });
    }
    process.stdout.write(`\r  scansione ${Math.min(b + BATCH, ids.length)}/${ids.length} atleti, ${out.length} con anni mancanti…`);
  }
  process.stdout.write('\n');
  // priorita': prima chi e' attivo quest'anno, poi chi ha piu' anni mancanti
  out.sort((a, b) => (b.active - a.active) || (b.missing.length - a.missing.length));
  return out;
}

const WORKERS = Math.max(1, parseInt((args.find(a => a.startsWith('--workers=')) || '').split('=')[1] || '2', 10) || 2);

(async () => {
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });
  fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });

  console.log('=== PCS Storico: colma i buchi (squadra nota ma risultati mancanti) ===\n');
  let gaps = await findGaps(sb);
  console.log(`Atleti con anni mancanti: ${gaps.length}`);
  if (LIMIT) gaps = gaps.slice(0, LIMIT);
  const totalYears = gaps.reduce((n, g) => n + g.missing.length, 0);
  console.log(`Anni totali da recuperare: ${totalYears} · lavoratori in parallelo: ${WORKERS}\n`);

  // stato per la pagina di avanzamento (si legge da logs/fillgaps-progress.json)
  const prog = {
    started: new Date().toISOString(), updated: new Date().toISOString(), finished: false, workers: WORKERS,
    athletesTotal: gaps.length, athletesDone: 0, yearsTotal: totalYears, yearsDone: 0, yearsWithResults: 0, yearsEmpty: 0, yearsFailed: 0,
    rows: 0, errors: 0, challenges: 0, current: {}, recent: [],
  };
  let lastWrite = 0;
  function writeProgress(force) {
    const now = Date.now();
    if (!force && now - lastWrite < 3000) return;
    lastWrite = now; prog.updated = new Date().toISOString();
    try { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(prog)); } catch (_) {}
    saveState();
  }
  writeProgress(true);

  let photoRef = null; try { photoRef = await createPhotoRefresher(sb); console.log(`foto profilo: controllo attivo (${photoRef.size} foto note)`); } catch (e) { console.warn('controllo foto non attivo:', e.message); }
  let { browser, context, page: firstPage } = await launchPcsBrowser();
  let nextIdx = 0, stop = false;

  async function worker(w) {
    let page = w === 0 ? firstPage : await context.newPage();
    while (!stop) {
      const gi = nextIdx++;
      if (gi >= gaps.length) break;
      const g = gaps[gi];
      let rowsForAthlete = 0, yearsOk = 0;
      for (const y of g.missing) {
        prog.current[w] = `${g.atletaId} ${y}`; writeProgress();
        await humanDelay(gi);
        if (page.isClosed()) {
          if (browser.isConnected?.() === false) { stop = true; console.error('Browser chiuso: esco, il wrapper riparte'); break; }
          page = await context.newPage();
        }
        const nav = await gotoPcsPage(page, `https://www.procyclingstats.com/rider/${g.slug}/${y}`, { onLog: msg => { if (/sfida|challenge/i.test(msg)) prog.challenges++; } });
        prog.yearsDone++;
        if (!nav.ok) { if (nav.notFound) { markYear(g.atletaId, y, 'empty'); prog.yearsEmpty++; } else { markYear(g.atletaId, y, 'fail'); prog.yearsFailed++; } continue; }
        if (photoRef) { try { await photoRef.check(page, g.atletaId, g.slug); } catch (_) {} }   // la pagina anno mostra la foto attuale
        let yearResults;
        try { yearResults = onlyThisSeason(await withTimeout(extractResultsOnly(page, y), 20000, 'extractResultsOnly'), y); }
        catch { markYear(g.atletaId, y, 'fail'); prog.yearsFailed++; continue; }
        if (yearResults.length) {
          const rows = yearResults.map(r => ({ atleta_id: g.atletaId, pcs_slug: g.slug, season: y, gara_name: r.gara_name, data: r.data, posizione: r.posizione, distacco: r.distacco, pcs_race_slug: r.pcs_race_slug, pcs_url: r.pcs_url, country: r.country || null }));
          // stessa chiave (atleta, stagione, gara) due volte nello stesso anno (es. gara disputata due volte): Postgres rifiuta l'upsert, si tiene la prima
          { const seenK = new Set(); for (let k = rows.length - 1; k >= 0; k--) { const kk = rows[k].pcs_race_slug; if (seenK.has(kk)) rows.splice(k, 1); else seenK.add(kk); } }
          try { if (MIRROR.has(g.atletaId + '|' + y)) { await sb.from('pcs_results').delete().eq('atleta_id', g.atletaId).eq('season', y); MIRROR.delete(g.atletaId + '|' + y); saveMirror(); } await upsertResults(sb, rows); rowsForAthlete += rows.length; prog.rows += rows.length; prog.yearsWithResults++; yearsOk++; markYear(g.atletaId, y, 'ok'); }
          catch (e) { prog.errors++; markYear(g.atletaId, y, 'fail'); prog.yearsFailed++; console.error(`ERRORE DB ${g.atletaId} ${y}: ${e.message}`); }
        } else { markYear(g.atletaId, y, 'empty'); prog.yearsEmpty++; }
        writeProgress();
      }
      prog.athletesDone++;
      prog.recent.unshift({ id: g.atletaId, years: g.missing.length, ok: yearsOk, rows: rowsForAthlete, t: new Date().toISOString() });
      if (prog.recent.length > 30) prog.recent.pop();
      prog.current[w] = '';
      console.log(`(${prog.athletesDone}/${gaps.length}) ${g.atletaId} [${g.slug}] anni ${g.missing.join(',')} → +${rowsForAthlete} ris.`);
      writeProgress(true);
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, (_, w) => worker(w)));

  prog.finished = !stop; writeProgress(true);
  try { await context.close(); await browser.close(); } catch {}
  console.log(`\n=== Completato === atleti: ${prog.athletesDone}/${gaps.length} | anni con risultati: ${prog.yearsWithResults} | vuoti: ${prog.yearsEmpty} | falliti: ${prog.yearsFailed} | righe: ${prog.rows} | errori: ${prog.errors}`);
  if (stop) process.exit(2);
})().catch(e => { console.error('ERRORE FATALE', e); saveState(); process.exit(1); });
