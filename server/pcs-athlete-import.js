'use strict';
/**
 * Import unificato da ProCyclingStats: foto profilo + social + risultati
 * stagionali (con paese) — un solo caricamento pagina per atleta.
 *
 * Sostituisce pcs-scraper.js, run-pcs-import.js e la logica atleti di
 * run-import.js / pcs-results.js, che duplicavano la stessa richiesta su
 * più script diversi senza mai gestire la sfida anti-bot di PCS (vedi
 * pcs-browser.js per il dettaglio del fix).
 *
 * I risultati fuori dal calendario ICS (gara_id = null) sono il "palmares
 * estero": vengono salvati con il codice paese della gara (letto dalla
 * bandierina PCS accanto al nome gara) ma SENZA punteggio e SENZA importare
 * la gara per intero — solo la riga del singolo atleta. Il filtro per
 * mostrare solo le gare estere (country != 'it') è applicato lato frontend.
 *
 * Uso:
 *   $env:SUPABASE_SECRET = "..."
 *   node pcs-athlete-import.js [--force] [--atleta-id=X] [--limit=N] [--season=YYYY]
 *
 *   --force        rilancia anche chi ha già foto E risultati di questa stagione
 *   --atleta-id=X  processa solo quell'atleta
 *   --limit=N      processa solo i primi N atleti (utile per test)
 *   --season=YYYY  stagione (default: anno corrente)
 */

const fs   = require('fs');
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
const FORCE     = args.includes('--force');
const SINGLE_ID = (args.find(a => a.startsWith('--atleta-id=')) || '').split('=')[1] || null;
const LIMIT     = parseInt((args.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '') || null;
const SEASON    = parseInt((args.find(a => a.startsWith('--season=')) || '').split('=')[1] || '') || new Date().getFullYear();

const DATA_DIR  = path.join(__dirname, '..', 'data');
const RANK_DIR  = path.join(DATA_DIR, 'rankings');
// Solo le categorie che PCS traccia normalmente — Allievi/Esordienti quasi
// mai presenti, includerli sprecherebbe richieste su profili inesistenti.
const ATH_CATS  = ['ELI_M', 'ELI_F', 'JUN_M', 'JUN_F'];
const CAL_FILES = [
  path.join(DATA_DIR, 'calendar.json'),
  path.join(DATA_DIR, 'seasons', String(SEASON), 'calendar.json'),
];

function normalizeStr(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function slugify(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function pcsAthleteSlug(ath) {
  return `${slugify(ath.nome)}-${slugify(ath.cognome)}`;
}

// PCS spesso omette i nomi centrali dallo slug (es. "Lorenzo Mark Finn" →
// rider/lorenzo-finn, non rider/lorenzo-mark-finn) — genera varianti da
// provare in ordine prima di ricorrere alla ricerca (search.php risulta
// rotta: anche il form del sito, testato dal vivo, non restituisce risultati
// via GET — probabilmente ora richiede una chiamata AJAX interna diversa).
function pcsAthleteSlugCandidates(ath) {
  const nomeParts = slugify(ath.nome).split('-').filter(Boolean);
  const cognome = slugify(ath.cognome);
  const candidates = [];
  const add = s => { if (s && !candidates.includes(s)) candidates.push(s); };
  add(`${nomeParts.join('-')}-${cognome}`);      // nome completo (comportamento attuale)
  if (nomeParts.length > 1) add(`${nomeParts[0]}-${cognome}`); // solo il primo nome
  return candidates;
}

// ─── Calendario: mappa data → gara_id (identico a pcs-results.js) ─────────
function buildCalendarMap() {
  const map = new Map();
  for (const f of CAL_FILES) {
    if (!fs.existsSync(f)) continue;
    for (const e of JSON.parse(fs.readFileSync(f, 'utf8'))) {
      if (!e.data || !e.id) continue;
      if (!map.has(e.data)) map.set(e.data, []);
      map.get(e.data).push({ id: e.id, nome: e.nome || '', categoria: e.categoria || '' });
    }
  }
  return map;
}

function matchGaraId(calMap, dateStr, pcsCat, pcsName) {
  const entries = calMap.get(dateStr);
  if (!entries?.length) return null;
  if (entries.length === 1) return entries[0].id;
  const catStr = (pcsCat || '').toLowerCase();
  const nameStr = normalizeStr(pcsName || '');
  let priority = null;
  if (/jun|u19/.test(catStr))                          priority = 'JUN';
  else if (/ali|u17|cadets/.test(catStr))              priority = 'AL';
  else if (/u23|elite|1\.[12]|2\.pro|wt/.test(catStr)) priority = 'ELI';
  if (priority) { const m = entries.find(e => e.id.includes(priority)); if (m) return m.id; }
  if (nameStr.length > 4) {
    const words = nameStr.split(' ').filter(w => w.length > 4);
    const byName = entries.find(e => words.some(w => normalizeStr(e.nome).includes(w)));
    if (byName) return byName.id;
  }
  return entries[0].id;
}

// ─── Estrazione dati dalla pagina rider/{slug}/{anno} ─────────────────────
// Foto, social e risultati stagionali sono tutti sulla stessa pagina —
// verificato dal vivo: un solo caricamento basta per tutto, dimezzando le
// richieste rispetto a visitare separatamente /rider/{slug} e /rider/{slug}/{anno}.

async function extractProfileAndResults(page, season) {
  const info = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    return { fullName: h1 ? h1.textContent.trim() : null };
  }).catch(() => ({ fullName: null }));

  // Foto
  const imgSrc = await page.evaluate(() => {
    const img = [...document.querySelectorAll('img')]
      .find(i => i.src && i.src.includes('/images/riders/'));
    if (img) return img.src || img.dataset.src || null;
    const lazy = document.querySelector('[data-src*="/images/riders/"]');
    return lazy ? lazy.dataset.src : null;
  }).catch(() => null);

  let photo = null;
  if (imgSrc) {
    const bytes = await page.evaluate(async url => {
      try {
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) return null;
        return Array.from(new Uint8Array(await r.arrayBuffer()));
      } catch { return null; }
    }, imgSrc).catch(() => null);
    if (bytes && bytes.length >= 1000) {
      const buf = Buffer.from(bytes);
      if (buf[0] === 0xFF && buf[1] === 0xD8) photo = buf;
    }
  }

  // Social
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

  // Risultati stagionali + paese (bandierina PCS: <span class="flag it"></span>
  // subito prima del link gara — il secondo token della class è il codice ISO-2).
  const results = await page.evaluate((season) => {
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
          iDate = 0; iRace = 1;
          iResult = firstRow.length >= 5 ? 3 : 2;
          iTime   = firstRow.length >= 6 ? 4 : -1;
          iCat    = firstRow.length >= 4 ? 2 : -1;
        } else {
          continue;
        }
      }

      let lastCountry = null; // vedi commento sotto sulla propagazione bandiera
      for (const tr of table.querySelectorAll('tbody tr')) {
        const cells = [...tr.querySelectorAll('td')];
        if (cells.length < 3) continue;

        const dateRaw   = cells[iDate]?.textContent?.trim() || '';
        const raceCell  = cells[iRace];
        const resultRaw = cells[iResult]?.textContent?.trim() || '';
        const timeRaw   = iTime >= 0 ? (cells[iTime]?.textContent?.trim() || '') : '';
        const catRaw    = iCat  >= 0 ? (cells[iCat]?.textContent?.trim()  || '') : '';

        // Bandiera: nelle corse a tappe SOLO la riga "riepilogo tour" porta la
        // bandierina — le singole tappe (e le righe di classifica generale/
        // punti/ecc.) non la ripetono. Senza propagazione, ogni tappa di una
        // corsa a tappe estera risulterebbe senza paese e verrebbe esclusa dal
        // "palmares estero" sul frontend (bug osservato: corridore con una
        // corsa a tappe francese, 0 risultati esteri mostrati). Va calcolata
        // PRIMA di eventuali "continue" successivi, così la bandiera della
        // riga di riepilogo (che viene comunque scartata per data/risultato
        // non validi) si propaga alle tappe successive nella stessa sequenza.
        const flagEl = raceCell?.querySelector('span.flag');
        const flagClasses = flagEl ? [...flagEl.classList] : [];
        const ownCountry = flagClasses.find(c => c !== 'flag') || null;
        if (ownCountry) lastCountry = ownCountry;
        const country = ownCountry || lastCountry;

        const dm = dateRaw.match(/^(\d{1,2})\.(\d{2})$/);
        if (!dm) continue;
        const data = `${season}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`;

        const raceLink = raceCell?.querySelector('a');
        const gara_name = raceCell?.textContent?.trim() || '';
        let pcs_race_slug = null;
        if (raceLink) {
          const href = raceLink.getAttribute('href') || '';
          // PCS usa "race/slug/anno/result" (senza slash iniziale) per le gare
          // normali e "national-race/slug/anno/result" per quelle nazionali —
          // e per le corse a tappe l'ultimo segmento è "stage-N" invece di
          // "result": va incluso nello slug, altrimenti tutte le tappe della
          // stessa corsa collidono sulla stessa chiave e si sovrascrivono a
          // vicenda nell'upsert (onConflict atleta_id,season,pcs_race_slug).
          const m = href.match(/(?:^|\/)(?:national-)?race\/([a-z0-9-]+)\/\d{4}\/?(.*)$/i);
          if (m) {
            const stagePart = m[2] && m[2] !== 'result' ? '-' + m[2].replace(/\//g, '-') : '';
            pcs_race_slug = m[1] + stagePart;
          }
        }
        if (!gara_name || !pcs_race_slug) continue;

        const posStr = resultRaw.replace(/[^0-9]/g, '');
        const posizione = posStr ? parseInt(posStr) : null;
        if (!posizione || posizione < 1 || posizione > 999) continue;

        let distacco = null;
        if (posizione === 1) {
          distacco = null;
        } else if (timeRaw && timeRaw !== '-' && timeRaw !== '0:00:00') {
          distacco = timeRaw.startsWith('+') ? timeRaw : (timeRaw ? '+' + timeRaw : null);
        }

        rows.push({ data, gara_name, pcs_race_slug, posizione, distacco, cat: catRaw, country });
      }

      if (rows.length > 0) break;
    }

    return rows;
  }, season).catch(() => []);

  return { fullName: info.fullName, photo, socials, results };
}

async function searchPcsRider(page, ath, gotoPcsPage) {
  const nav = await gotoPcsPage(
    page,
    `https://www.procyclingstats.com/search.php?search=${encodeURIComponent(`${ath.nome} ${ath.cognome}`)}`,
    { readySelector: 'body' }
  );
  if (!nav.ok) return null;

  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')]
      .map(a => a.getAttribute('href'))
      .filter(h => h && /\/rider\/[a-z0-9-]+$/.test(h))
  ).catch(() => []);

  if (!hrefs.length) return null;
  const gn = slugify(ath.nome);
  const sn = slugify(ath.cognome);
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

// ─── Supabase ─────────────────────────────────────────────────────────────

async function uploadPhoto(sb, slug, buf) {
  const ext = (buf[0] === 0x89 && buf[1] === 0x50) ? 'png' : 'jpeg';
  const storagePath = `atletas/pcs/${slug}.${ext}`;
  const { error } = await sb.storage.from('photos')
    .upload(storagePath, buf, { contentType: `image/${ext}`, upsert: true });
  if (error) throw error;
  return `/photos/${storagePath}`;
}

async function upsertOverrides(sb, entityId, fields) {
  const rows = Object.entries(fields)
    .filter(([, v]) => v != null)
    .map(([field, new_value]) => ({ entity_type: 'atleta', entity_id: entityId, field, new_value, edited_by: null }));
  if (!rows.length) return;
  const { error } = await sb.from('entity_overrides')
    .upsert(rows, { onConflict: 'entity_type,entity_id,field' });
  if (error) throw error;
}

async function getExistingPhotoIds(sb) {
  const { data } = await sb.from('entity_overrides')
    .select('entity_id').eq('entity_type', 'atleta').eq('field', 'photo_url')
    .not('new_value', 'is', null).limit(5000);
  return new Set((data || []).map(r => r.entity_id));
}

async function getSavedSlugs(sb) {
  const { data } = await sb.from('entity_overrides')
    .select('entity_id, new_value')
    .eq('entity_type', 'atleta').eq('field', 'pcs_slug')
    .not('new_value', 'is', null).limit(5000);
  return new Map((data || []).map(r => [r.entity_id, r.new_value]));
}

async function getAthletesWithResults(sb, season) {
  const { data } = await sb.from('pcs_results')
    .select('atleta_id').eq('season', season).limit(5000);
  return new Set((data || []).map(r => r.atleta_id));
}

async function upsertResults(sb, rows) {
  if (!rows.length) return;
  const { error } = await sb.from('pcs_results')
    .upsert(rows, { onConflict: 'atleta_id,season,pcs_race_slug' });
  if (error) throw error;
}

// ─── Main ──────────────────────────────────────────────────────────────────

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  const { launchPcsBrowser, gotoPcsPage, humanDelay } = require('./pcs-browser');

  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  console.log(`=== PCS Import unificato (foto+social+risultati) [stagione ${SEASON}] ===\n`);

  // 1. Atleti da processare
  const athMap = new Map();
  if (SINGLE_ID) {
    for (const cat of ATH_CATS) {
      const f = path.join(RANK_DIR, `${cat}.json`);
      if (!fs.existsSync(f)) continue;
      for (const a of JSON.parse(fs.readFileSync(f, 'utf8')))
        if (a.atleta_id === SINGLE_ID) { athMap.set(a.atleta_id, a); break; }
    }
    if (!athMap.size) { console.error(`Atleta ${SINGLE_ID} non trovato nei ranking`); process.exit(1); }
  } else {
    for (const cat of ATH_CATS) {
      const f = path.join(RANK_DIR, `${cat}.json`);
      if (!fs.existsSync(f)) { console.log(`Mancante: ${cat}.json`); continue; }
      for (const a of JSON.parse(fs.readFileSync(f, 'utf8')))
        if (a.atleta_id && !athMap.has(a.atleta_id)) athMap.set(a.atleta_id, a);
    }
  }

  let athletes = [...athMap.values()];
  console.log(`${athletes.length} atleti unici in ${ATH_CATS.join(', ')}`);

  // 2. Skip chi ha già foto E risultati di questa stagione (a meno di --force)
  const withPhoto   = FORCE ? new Set() : await getExistingPhotoIds(sb);
  const withResults = FORCE ? new Set() : await getAthletesWithResults(sb, SEASON);
  const savedSlugs   = await getSavedSlugs(sb);

  let toProcess = athletes.filter(a => !(withPhoto.has(a.atleta_id) && withResults.has(a.atleta_id)));
  if (LIMIT) toProcess = toProcess.slice(0, LIMIT);

  console.log(`${athletes.length - toProcess.length} già completi — ${toProcess.length} da processare\n`);
  if (!toProcess.length) { console.log('Niente da fare.'); process.exit(0); }

  // 3. Calendario per associare gara_id
  const calMap = buildCalendarMap();
  console.log(`Calendario: ${calMap.size} date di gara caricate\n`);

  // 4. Browser (visibile — necessario per superare eventuali sfide anti-bot)
  const { browser, page } = await launchPcsBrowser();
  console.log('Pronto.\n');

  let donePhoto = 0, doneResults = 0, notFound = 0, challengeFails = 0, errors = 0, totalRows = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const ath = toProcess[i];
    const atletaId = ath.atleta_id;
    const savedSlug = savedSlugs.get(atletaId);
    const guessedCandidates = pcsAthleteSlugCandidates(ath);
    const candidates = savedSlug
      ? [savedSlug, ...guessedCandidates.filter(c => c !== savedSlug)]
      : guessedCandidates;

    let slug = candidates[0];
    process.stdout.write(`(${i + 1}/${toProcess.length}) ${ath.cognome} ${ath.nome} [${slug}] … `);

    let nav = await gotoPcsPage(page, `https://www.procyclingstats.com/rider/${slug}/${SEASON}`, {
      onLog: msg => process.stdout.write('\n' + msg),
    });

    if (nav.notFound) {
      for (const cand of candidates.slice(1)) {
        process.stdout.write(`non trovato, provo "${cand}"… `);
        const nav2 = await gotoPcsPage(page, `https://www.procyclingstats.com/rider/${cand}/${SEASON}`, {
          onLog: msg => process.stdout.write('\n' + msg),
        });
        if (nav2.ok) { slug = cand; nav = nav2; break; }
        nav = nav2;
      }
    }
    if (nav.notFound) {
      process.stdout.write('cerco… ');
      const found = await searchPcsRider(page, ath, gotoPcsPage);
      if (found && found !== slug) {
        slug = found;
        process.stdout.write(`trovato come "${slug}" … `);
        nav = await gotoPcsPage(page, `https://www.procyclingstats.com/rider/${slug}/${SEASON}`, {
          onLog: msg => process.stdout.write('\n' + msg),
        });
      }
    }

    if (nav.timedOut) {
      process.stdout.write('sfida non superata, riprovo al prossimo giro\n');
      challengeFails++;
      await humanDelay(i);
      continue;
    }
    if (!nav.ok) {
      process.stdout.write('non trovato su PCS\n');
      notFound++;
      await humanDelay(i);
      continue;
    }

    const { photo, socials, results } = await extractProfileAndResults(page, SEASON);

    const fields = { pcs_slug: slug };
    if (photo && !withPhoto.has(atletaId)) {
      try {
        fields.photo_url = await uploadPhoto(sb, slug, photo);
        withPhoto.add(atletaId);
        donePhoto++;
      } catch (e) {
        process.stdout.write(`ERRORE foto: ${e.message} `);
        errors++;
      }
    }
    if (socials?.instagram) fields.instagram_url = socials.instagram;
    if (socials?.twitter)   fields.twitter_url   = socials.twitter;
    if (socials?.strava)    fields.strava_url    = socials.strava;
    if (socials?.facebook)  fields.facebook_url  = socials.facebook;

    try {
      await upsertOverrides(sb, atletaId, fields);
    } catch (e) {
      process.stdout.write(`ERRORE DB override: ${e.message} `);
      errors++;
    }
    savedSlugs.set(atletaId, slug);

    if (results.length) {
      const rows = results.map(r => ({
        atleta_id:     atletaId,
        pcs_slug:      slug,
        season:        SEASON,
        gara_name:     r.gara_name,
        data:          r.data,
        posizione:     r.posizione,
        distacco:      r.distacco,
        pcs_race_slug: r.pcs_race_slug,
        country:       r.country,
        // Non tentare l'abbinamento al calendario ICS se sappiamo che la gara
        // è all'estero — matchGaraId() abbina solo per data (+ euristica
        // categoria/nome), quindi una gara straniera nello stesso giorno di
        // una gara italiana verrebbe erroneamente associata a quest'ultima
        // (es. campionato francese abbinato al campionato italiano dello
        // stesso giorno), facendo risultare l'atleta come se avesse corso in
        // Italia. Abbina solo quando il paese è Italia o sconosciuto.
        gara_id: (r.country && r.country !== 'it') ? null : matchGaraId(calMap, r.data, r.cat, r.gara_name),
      }));
      try {
        await upsertResults(sb, rows);
        totalRows += rows.length;
        doneResults++;
      } catch (e) {
        process.stdout.write(`ERRORE DB risultati: ${e.message} `);
        errors++;
      }
    }

    const tags = [
      fields.photo_url     ? '📷' : '',
      fields.instagram_url ? 'IG' : '',
      fields.twitter_url   ? 'TW' : '',
      fields.strava_url    ? 'ST' : '',
      fields.facebook_url  ? 'FB' : '',
      results.length        ? `${results.length} ris.` : '',
    ].filter(Boolean).join(' ') || '—';
    process.stdout.write(`✓ ${tags}\n`);

    await humanDelay(i);
  }

  await browser.close();

  console.log(`\n=== Completato ===`);
  console.log(`📷 Foto salvate:        ${donePhoto}`);
  console.log(`🏁 Atleti con risultati: ${doneResults} (${totalRows} righe totali)`);
  console.log(`❓ Non trovati su PCS:   ${notFound}`);
  console.log(`⏳ Sfide non superate:   ${challengeFails} (rilanciare lo script per riprovarli)`);
  console.log(`❌ Errori:               ${errors}`);
})();
