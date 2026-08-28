'use strict';
/**
 * Import PCS (foto + social + storia squadra-per-anno + risultati) per gli
 * atleti STORICI ciclismo.info (2007-2025) — script SEPARATO da
 * pcs-athlete-import.js apposta, per non toccare/rischiare quello che gira
 * già ogni settimana sulla stagione nativa 2026.
 *
 * Deduplicazione PRIMA di cercare: lo stesso atleta compare spesso più
 * volte in ciclismo_athletes con ciclismo_id diversi (una registrazione
 * per categoria/anno — es. "FERRARI ALESSANDRO" ne ha 5), ma condividono
 * già lo stesso atleta_id (derivato dal nome, stessa normalizzazione in
 * tutto il progetto) — si cerca UNA VOLTA per atleta_id, non una volta per
 * ciclismo_id, altrimenti si rifà la stessa ricerca PCS più volte per la
 * stessa persona.
 *
 * Una sola pagina PCS per atleta (stessa scoperta di oggi in
 * pcs-athlete-import.js: la pagina rider/{slug}/{anno} mostra SEMPRE la
 * storia squadra-per-anno COMPLETA, qualunque anno metti nell'URL) —
 * l'anno scelto è il più recente noto su ciclismo.info per quell'atleta,
 * così anche i risultati di quella singola pagina sono quelli giusti.
 *
 * Uso:
 *   node pcs-athlete-import-storico.js [--limit=N] [--atleta-id=X] [--skip-complete]
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

const args      = process.argv.slice(2);
const LIMIT     = parseInt((args.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '') || null;
const SINGLE_ID = (args.find(a => a.startsWith('--atleta-id=')) || '').split('=')[1] || null;
const SKIP_COMPLETE = args.includes('--skip-complete');

function normalizeStr(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function slugify(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
// Stessa euristica di pcs-athlete-import.js: PCS spesso omette i nomi
// centrali dallo slug, disambigua gli omonimi con un "2" finale, e
// traslittera diversamente alcuni suoni slavi/ucraini/russi.
function pcsAthleteSlugCandidates(cognome, nome) {
  const nomeParts = slugify(nome).split('-').filter(Boolean);
  const cog = slugify(cognome);
  const candidates = [];
  const add = s => { if (s && !candidates.includes(s)) candidates.push(s); };
  add(`${nomeParts.join('-')}-${cog}`);
  if (nomeParts.length > 1) add(`${nomeParts[0]}-${cog}`);
  if (nomeParts.length > 1) {
    const trueGivenName = nomeParts[nomeParts.length - 1];
    const surnameRest = nomeParts.slice(0, -1);
    add(`${trueGivenName}-${surnameRest.join('-')}-${cog}`);
    add(`${trueGivenName}-${cog}-${surnameRest.join('-')}`);
    add(`${nomeParts.slice(1).join('-')}-${cog}`);
  }
  if (cognome && cognome.includes('-')) {
    const firstSegment = slugify(cognome.split('-')[0]);
    add(`${nomeParts.join('-')}-${firstSegment}`);
    if (nomeParts.length > 1) add(`${nomeParts[0]}-${firstSegment}`);
  }
  const base = candidates.slice(0, 2);
  for (const b of base) add(`${b}2`);
  for (const b of base) {
    if (b.includes('ks')) add(b.replace(/ks/g, 'x'));
    if (/ii(-|$)/.test(b)) add(b.replace(/ii(-|$)/g, 'iy$1'));
  }
  return candidates;
}

async function searchPcsRider(page, cognome, nome, gotoPcsPage) {
  const nav = await gotoPcsPage(page, `https://www.procyclingstats.com/search.php?search=${encodeURIComponent(`${nome} ${cognome}`)}`, { readySelector: 'body' });
  if (!nav.ok) return null;
  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => h && /\/rider\/[a-z0-9-]+$/.test(h))
  ).catch(() => []);
  if (!hrefs.length) return null;
  const gn = slugify(nome), sn = slugify(cognome);
  const scored = hrefs.map(h => {
    const m = h.match(/\/rider\/([a-z0-9-]+)$/);
    if (!m) return null;
    const s = m[1];
    let score = 0;
    for (const p of gn.split('-')) if (s.includes(p)) score++;
    for (const p of sn.split('-')) if (s.includes(p)) score++;
    return { slug: s, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].slug : null;
}

// Stessa estrazione di pcs-athlete-import.js: foto + social + storia
// squadra-per-anno (tutta la carriera in un solo caricamento) + risultati
// della singola stagione visitata.
async function extractProfileAndResults(page, season) {
  const imgSrc = await page.evaluate(() => {
    const img = [...document.querySelectorAll('img')].find(i => i.src && i.src.includes('/images/riders/'));
    if (img) return img.src || img.dataset.src || null;
    const lazy = document.querySelector('[data-src*="/images/riders/"]');
    return lazy ? lazy.dataset.src : null;
  }).catch(() => null);

  let photo = null;
  if (imgSrc) {
    const bytes = await page.evaluate(async url => {
      try { const r = await fetch(url, { credentials: 'include' }); if (!r.ok) return null; return Array.from(new Uint8Array(await r.arrayBuffer())); }
      catch { return null; }
    }, imgSrc).catch(() => null);
    if (bytes && bytes.length >= 1000) {
      const buf = Buffer.from(bytes);
      if ((buf[0] === 0xFF && buf[1] === 0xD8) || (buf[0] === 0x89 && buf[1] === 0x50)) photo = buf;
    }
  }

  const socials = await page.evaluate(() => {
    const result = {};
    for (const a of document.querySelectorAll('a[href]')) {
      const h = (a.href || '').replace(/\/$/, '');
      if (!result.instagram && /instagram\.com\/(?!p\/|reel\/)[^/?"#]+/.test(h)) result.instagram = h;
      if (!result.twitter   && /(twitter\.com|x\.com)\/(?!i\/)[^/?"#]+/.test(h)) result.twitter = h;
      if (!result.strava    && /strava\.com\/(athletes|clubs)\/[^?"#]+/.test(h)) result.strava = h;
      if (!result.facebook  && /facebook\.com\/(?!sharer)[^/?"#]+/.test(h)) result.facebook = h;
    }
    return result;
  }).catch(() => ({}));

  // Anno di nascita — mostrato nel riquadro info del corridore ("Date of
  // birth: 21th September 1998"), richiesta esplicita dell'utente per
  // completare le date mancanti su ciclismo.info. Solo l'ANNO: è quello
  // che il campo override 'anno_nascita' già usa in tutto il sito
  // (mostrato come "Classe XXXX" — vedi ciclismo-backfill.js), non una
  // data completa.
  const birthYear = await page.evaluate(() => {
    const txt = document.body.innerText || '';
    const m = txt.match(/Date of birth:\s*\d{1,2}[a-z]{0,2}\s+[A-Za-z]+\s+(\d{4})/);
    return m ? m[1] : null;
  }).catch(() => null);

  const teamHistory = await page.evaluate(() => {
    const out = [];
    for (const a of document.querySelectorAll('a[href]')) {
      if ((a.parentElement?.className || '').trim() !== 'name') continue;
      const href = (a.getAttribute('href') || '').replace(/^\/+/, '');
      const m = href.match(/^team\/([a-z0-9-]+)-(\d{4})$/);
      if (!m) continue;
      out.push({ season: parseInt(m[2], 10), name: a.textContent.trim(), slug: href });
    }
    return out;
  }).catch(() => []);

  const results = await extractResultsOnly(page, season);

  return { photo, socials, birthYear, teamHistory, results };
}

// Solo la tabella risultati della pagina rider/{slug}/{anno} corrente —
// estratta a parte per essere riusabile sulle visite AGGIUNTIVE alle altre
// stagioni professionistiche (la storia squadra dà tutti gli anni in un
// colpo solo, ma i risultati riga-per-riga sono solo quelli della singola
// pagina/anno visitato, serve una visita per anno).
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

async function uploadPhoto(sb, slug, buf) {
  const ext = (buf[0] === 0x89 && buf[1] === 0x50) ? 'png' : 'jpeg';
  const storagePath = `atletas/pcs/${slug}.${ext}`;
  const { error } = await sb.storage.from('photos').upload(storagePath, buf, { contentType: `image/${ext}`, upsert: true });
  if (error) throw error;
  return `/photos/${storagePath}`;
}

async function upsertOverrides(sb, entityId, fields) {
  const rows = Object.entries(fields).filter(([, v]) => v != null)
    .map(([field, new_value]) => ({ entity_type: 'atleta', entity_id: entityId, field, new_value, edited_by: null }));
  if (!rows.length) return;
  const { error } = await sb.from('entity_overrides').upsert(rows, { onConflict: 'entity_type,entity_id,field' });
  if (error) throw error;
}

async function upsertTeamHistory(sb, atletaId, teamHistory) {
  if (!teamHistory?.length) return;
  const rows = teamHistory.map(t => ({ atleta_id: atletaId, season: t.season, team: t.name, team_pcs_slug: t.slug, updated_at: new Date().toISOString() }));
  const { error } = await sb.from('pcs_team_history').upsert(rows, { onConflict: 'atleta_id,season' });
  if (error) throw error;
}

async function upsertResults(sb, rows) {
  if (!rows.length) return;
  const { error } = await sb.from('pcs_results').upsert(rows, { onConflict: 'atleta_id,season,pcs_race_slug' });
  if (error) throw error;
}

// Elenco atleti storici DEDUPLICATI: un atleta_id per persona (non un
// ciclismo_id) — l'ultimo cognome/nome/anno noto per ciascuno, così la
// pagina PCS visitata è quella dell'anno più recente in cui l'abbiamo
// visto su ciclismo.info (dove la sua carriera potrebbe essere continuata
// da professionista subito dopo).
async function loadAtletiStorici(sb) {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('ciclismo_results')
      .select('atleta_id, ciclismo_id, stagione')
      .not('atleta_id', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  // Anno più recente noto per ciascun atleta_id, E tutti gli anni noti da
  // ciclismo.info (non solo il più recente) — servono entrambi: il primo
  // per scegliere la pagina PCS iniziale, il secondo perché ciclismo.info
  // pubblica solo i primi arrivati (i piazzamenti oltre un certo limite
  // restano invisibili anche per un anno "coperto") — PCS spesso ha
  // l'ordine d'arrivo più completo per la STESSA gara/anno. Senza questo,
  // gli anni già coperti da ciclismo.info non venivano MAI controllati su
  // PCS, perdendo quei piazzamenti più bassi (segnalato dall'utente).
  const lastYearByAtleta = new Map();
  const yearsByAtleta = new Map();
  for (const r of rows) {
    const y = parseInt(r.stagione, 10);
    if (!lastYearByAtleta.has(r.atleta_id) || y > lastYearByAtleta.get(r.atleta_id)) lastYearByAtleta.set(r.atleta_id, y);
    if (!yearsByAtleta.has(r.atleta_id)) yearsByAtleta.set(r.atleta_id, new Set());
    yearsByAtleta.get(r.atleta_id).add(y);
  }

  // Nome completo: da manual_athletes (cognome/nome separati, più preciso)
  // se presente, altrimenti dall'ultima riga ciclismo_athletes con quel
  // atleta_id (nome_completo unico, split alla bell'e meglio).
  const manualByAtleta = new Map();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('manual_athletes').select('atleta_id, cognome, nome').range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    for (const a of data) manualByAtleta.set(a.atleta_id, a);
    if (data.length < PAGE) break;
  }
  const nomeCompletoByAtleta = new Map();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('ciclismo_athletes').select('atleta_id, nome_completo').not('atleta_id', 'is', null).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    for (const a of data) if (!nomeCompletoByAtleta.has(a.atleta_id)) nomeCompletoByAtleta.set(a.atleta_id, a.nome_completo);
    if (data.length < PAGE) break;
  }

  const out = [];
  for (const [atletaId, lastYear] of lastYearByAtleta) {
    const manual = manualByAtleta.get(atletaId);
    let cognome, nome;
    if (manual) { cognome = manual.cognome; nome = manual.nome; }
    else {
      const full = String(nomeCompletoByAtleta.get(atletaId) || '').trim().split(/\s+/);
      cognome = full[0] || atletaId; nome = full.slice(1).join(' ') || cognome;
    }
    out.push({ atleta_id: atletaId, cognome, nome, lastYear, ciclismoYears: [...(yearsByAtleta.get(atletaId) || [])] });
  }
  // Dal più vecchio al più recente (2007 → oggi), richiesta esplicita
  // dell'utente. Un atleta con più anni di ciclismo.info viene comunque
  // coperto per intero in un solo passaggio (usa lastYear come pagina di
  // partenza, poi visita anche gli anni PRO successivi via la cronologia
  // squadre — vedi sotto), quindi ordinare per lastYear non lascia buchi:
  // sposta solo QUALE persona viene coperta prima.
  out.sort((a, b) => a.lastYear - b.lastYear);
  return out;
}

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  const { launchPcsBrowser, gotoPcsPage, humanDelay, withTimeout } = require('./pcs-browser');

  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  console.log('=== PCS Import STORICO (2007-2025, script separato dal nativo 2026) ===\n');

  let athletes = await loadAtletiStorici(sb);
  console.log(`Atleti storici unici (deduplicati per atleta_id): ${athletes.length}\n`);

  if (SINGLE_ID) athletes = athletes.filter(a => a.atleta_id === SINGLE_ID);

  if (SKIP_COMPLETE) {
    const { data: doneOv } = await sb.from('entity_overrides').select('entity_id').eq('entity_type', 'atleta').eq('field', 'pcs_slug').not('new_value', 'is', null);
    const done = new Set((doneOv || []).map(r => r.entity_id));
    athletes = athletes.filter(a => !done.has(a.atleta_id));
    console.log(`Dopo --skip-complete: ${athletes.length} da processare\n`);
  }

  if (LIMIT) athletes = athletes.slice(0, LIMIT);
  if (!athletes.length) { console.log('Niente da fare.'); process.exit(0); }

  let { browser, page } = await launchPcsBrowser();
  console.log('Pronto.\n');

  let donePhoto = 0, doneResults = 0, doneTeamHist = 0, doneBirth = 0, notFound = 0, challengeFails = 0, errors = 0;
  let browserRelaunches = 0;
  const MAX_RELAUNCHES = 20;

  async function relaunchBrowser() {
    browserRelaunches++;
    process.stdout.write(`\n  🔄 finestra del browser chiusa/persa — rilancio (${browserRelaunches}/${MAX_RELAUNCHES})…\n`);
    try { await browser.close(); } catch {}
    const fresh = await launchPcsBrowser();
    browser = fresh.browser; page = fresh.page;
  }

  for (let i = 0; i < athletes.length; i++) {
    if (page.isClosed() || browser.isConnected?.() === false) {
      if (browserRelaunches >= MAX_RELAUNCHES) { console.log('\nTroppi rilanci del browser, mi fermo.'); break; }
      await relaunchBrowser();
    }

    const ath = athletes[i];
    const season = ath.lastYear || new Date().getFullYear();
    const candidates = pcsAthleteSlugCandidates(ath.cognome, ath.nome);
    let slug = candidates[0];
    process.stdout.write(`(${i + 1}/${athletes.length}) ${ath.cognome} ${ath.nome} [${slug}] … `);

    let nav = await gotoPcsPage(page, `https://www.procyclingstats.com/rider/${slug}/${season}`, { onLog: msg => process.stdout.write('\n' + msg) });

    if (nav.notFound) {
      for (const cand of candidates.slice(1)) {
        process.stdout.write(`non trovato, provo "${cand}"… `);
        const nav2 = await gotoPcsPage(page, `https://www.procyclingstats.com/rider/${cand}/${season}`, { onLog: msg => process.stdout.write('\n' + msg) });
        if (nav2.ok) { slug = cand; nav = nav2; break; }
        nav = nav2;
        if (nav2.closed) break;
      }
    }
    if (nav.notFound && !nav.closed) {
      process.stdout.write('cerco… ');
      const found = await withTimeout(searchPcsRider(page, ath.cognome, ath.nome, gotoPcsPage), 20000, 'searchPcsRider').catch(() => null);
      if (found && found !== slug) {
        slug = found;
        process.stdout.write(`trovato come "${slug}" … `);
        nav = await gotoPcsPage(page, `https://www.procyclingstats.com/rider/${slug}/${season}`, { onLog: msg => process.stdout.write('\n' + msg) });
      }
    }

    if (nav.closed) {
      if (browserRelaunches >= MAX_RELAUNCHES) { console.log('\nTroppi rilanci del browser, mi fermo.'); break; }
      i--; continue;
    }
    if (nav.timedOut) { process.stdout.write('sfida non superata, riprovo al prossimo giro\n'); challengeFails++; await humanDelay(i); continue; }
    if (!nav.ok) { process.stdout.write('non trovato su PCS\n'); notFound++; await humanDelay(i); continue; }

    let extracted;
    try {
      extracted = await withTimeout(extractProfileAndResults(page, season), 25000, 'extractProfileAndResults');
    } catch (e) {
      process.stdout.write(`browser non risponde (${e.message}), riprovo\n`);
      if (browserRelaunches >= MAX_RELAUNCHES) { console.log('\nTroppi rilanci del browser, mi fermo.'); break; }
      await relaunchBrowser(); i--; continue;
    }
    const { photo, socials, birthYear, teamHistory, results } = extracted;

    const fields = { pcs_slug: slug };
    if (photo) {
      // Sostituisce SEMPRE l'eventuale foto ciclismo.info già presente —
      // richiesta esplicita dell'utente: quella PCS è di qualità migliore.
      try { fields.photo_url = await uploadPhoto(sb, slug, photo); donePhoto++; } catch (e) { process.stdout.write(`ERRORE foto: ${e.message} `); errors++; }
    }
    if (socials?.instagram) fields.instagram_url = socials.instagram;
    if (socials?.twitter)   fields.twitter_url   = socials.twitter;
    if (socials?.strava)    fields.strava_url    = socials.strava;
    if (socials?.facebook)  fields.facebook_url  = socials.facebook;
    if (birthYear) {
      // Non sovrascrivere una correzione admin già fatta a mano — stessa
      // cautela di ciclismo-backfill.js per lo stesso campo.
      const { data: existingYear } = await sb.from('entity_overrides').select('new_value')
        .eq('entity_type', 'atleta').eq('entity_id', ath.atleta_id).eq('field', 'anno_nascita').maybeSingle();
      if (!existingYear || !existingYear.new_value) { fields.anno_nascita = birthYear; doneBirth++; }
    }

    try { await upsertOverrides(sb, ath.atleta_id, fields); } catch (e) { process.stdout.write(`ERRORE DB override: ${e.message} `); errors++; }

    try { await upsertTeamHistory(sb, ath.atleta_id, teamHistory); if (teamHistory?.length) doneTeamHist++; } catch (e) { process.stdout.write(`ERRORE DB team: ${e.message} `); errors++; }

    let totalResultRows = 0;
    if (results.length) {
      const rows = results.map(r => ({ atleta_id: ath.atleta_id, pcs_slug: slug, season, gara_name: r.gara_name, data: r.data, posizione: r.posizione, distacco: r.distacco, pcs_race_slug: r.pcs_race_slug, pcs_url: r.pcs_url, country: r.country, gara_id: null }));
      try { await upsertResults(sb, rows); doneResults++; totalResultRows += rows.length; } catch (e) { process.stdout.write(`ERRORE DB risultati: ${e.message} `); errors++; }
    }

    // Ogni altro anno da controllare su PCS, oltre a quello della pagina
    // già visitata: sia gli anni PRO successivi all'ultimo noto su
    // ciclismo.info (storia squadra), SIA gli anni GIÀ coperti da
    // ciclismo.info — ciclismo.info pubblica solo i primi arrivati, un
    // piazzamento più basso (es. 20°) resta invisibile anche per un anno
    // "coperto"; PCS spesso ha l'ordine d'arrivo più completo per la stessa
    // gara. Prima si guardavano solo gli anni dopo l'ultimo noto, perdendo
    // sistematicamente questi piazzamenti bassi per tutta la carriera
    // amatoriale (richiesta esplicita dell'utente dopo averlo notato).
    const currentYear = new Date().getFullYear();
    const extraYears = [...new Set([
      ...(teamHistory || []).map(t => t.season),
      ...(ath.ciclismoYears || []),
    ])]
      .filter(y => y <= currentYear && y !== season)
      .sort((a, b) => a - b);
    let extraYearsDone = 0;
    for (const y of extraYears) {
      await humanDelay(i);
      if (page.isClosed() || browser.isConnected?.() === false) {
        if (browserRelaunches >= MAX_RELAUNCHES) break;
        await relaunchBrowser();
      }
      const navY = await gotoPcsPage(page, `https://www.procyclingstats.com/rider/${slug}/${y}`, { onLog: msg => process.stdout.write('\n' + msg) });
      if (!navY.ok) continue;
      let yearResults;
      try { yearResults = await withTimeout(extractResultsOnly(page, y), 20000, 'extractResultsOnly'); }
      catch { continue; }
      if (yearResults.length) {
        const rowsY = yearResults.map(r => ({ atleta_id: ath.atleta_id, pcs_slug: slug, season: y, gara_name: r.gara_name, data: r.data, posizione: r.posizione, distacco: r.distacco, pcs_race_slug: r.pcs_race_slug, pcs_url: r.pcs_url, country: r.country, gara_id: null }));
        try { await upsertResults(sb, rowsY); totalResultRows += rowsY.length; extraYearsDone++; } catch (e) { process.stdout.write(`ERRORE DB risultati ${y}: ${e.message} `); errors++; }
      }
    }

    const tags = [
      fields.photo_url ? '📷' : '', fields.instagram_url ? 'IG' : '', fields.twitter_url ? 'TW' : '',
      fields.strava_url ? 'ST' : '', fields.facebook_url ? 'FB' : '', birthYear ? '🎂' : '',
      teamHistory?.length ? `${teamHistory.length} squadre` : '',
      extraYearsDone ? `+${extraYearsDone} anni extra` : '',
      totalResultRows ? `${totalResultRows} ris. totali` : '',
    ].filter(Boolean).join(' ') || '—';
    process.stdout.write(`✓ ${tags}\n`);

    await humanDelay(i);
  }

  await browser.close();

  console.log(`\n=== Completato ===`);
  console.log(`📷 Foto salvate:         ${donePhoto}`);
  console.log(`🎂 Date di nascita:      ${doneBirth}`);
  console.log(`🏳 Storia squadra:       ${doneTeamHist}`);
  console.log(`🏁 Atleti con risultati: ${doneResults}`);
  console.log(`❓ Non trovati su PCS:   ${notFound}`);
  console.log(`⏳ Sfide non superate:   ${challengeFails} (rilanciare lo script per riprovarli)`);
  console.log(`❌ Errori:               ${errors}`);
})();
