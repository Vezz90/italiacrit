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
 *   node pcs-athlete-import.js [--force] [--atleta-id=X] [--limit=N] [--season=YYYY] [--include-phantoms]
 *
 *   --force             rilancia anche chi ha già foto E risultati di questa stagione
 *   --atleta-id=X       processa solo quell'atleta
 *   --limit=N           processa solo i primi N atleti (utile per test)
 *   --season=YYYY       stagione (default: anno corrente)
 *   --include-phantoms  include anche gli atleti "fantasma": corridori non
 *                        registrati con la FCI (di solito stranieri/
 *                        professionisti) che compaiono comunque in
 *                        pcs_gara_results (posizioni 11+ di gare del
 *                        circuito con pagina PCS completa scrapata) — hanno
 *                        già una pagina sul sito con i risultati base, ma
 *                        restano senza foto/social/palmares estero se non
 *                        processati anche da questo script.
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
const INCLUDE_PHANTOMS = args.includes('--include-phantoms');
const SINGLE_ID = (args.find(a => a.startsWith('--atleta-id=')) || '').split('=')[1] || null;
const IDS_FILE  = (args.find(a => a.startsWith('--ids-file=')) || '').split('=')[1] || null;
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

  // Bug dati FCI noto: i cognomi composti a volte vengono spezzati — solo la
  // prima parola salvata in `cognome`, il resto finisce dentro `nome` prima
  // del vero nome proprio (es. "PEZZO ROSOLA KEVIN" → cognome:"PEZZO",
  // nome:"ROSOLA KEVIN", nome vero "Kevin Pezzo Rosola"). Se `nome` ha più
  // parole, prova anche: ultima parola di `nome` come nome proprio + resto
  // di `nome` unito a `cognome` come cognome completo.
  if (nomeParts.length > 1) {
    const trueGivenName = nomeParts[nomeParts.length - 1];
    const surnameRest = nomeParts.slice(0, -1);
    add(`${trueGivenName}-${surnameRest.join('-')}-${cognome}`);
  }

  // PCS a volte tronca i cognomi doppi con trattino alla prima parte sola
  // (es. "Costa-Staricco" → rider/giulia-costa). Prova anche solo il primo
  // segmento del cognome, se contiene un trattino.
  if (ath.cognome && ath.cognome.includes('-')) {
    const firstSegment = slugify(ath.cognome.split('-')[0]);
    add(`${nomeParts.join('-')}-${firstSegment}`);
    if (nomeParts.length > 1) add(`${nomeParts[0]}-${firstSegment}`);
  }

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
      const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8;
      const isPng  = buf[0] === 0x89 && buf[1] === 0x50;
      if (isJpeg || isPng) photo = buf;
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

      let lastCountry = null;   // vedi commento sotto sulla propagazione bandiera
      let lastTourName = null;  // vedi commento sotto sulla propagazione nome giro
      for (const tr of table.querySelectorAll('tbody tr')) {
        const cells = [...tr.querySelectorAll('td')];
        if (cells.length < 3) continue;

        const dateRaw   = cells[iDate]?.textContent?.trim() || '';
        const raceCell  = cells[iRace];
        const resultRaw = cells[iResult]?.textContent?.trim() || '';
        const timeRaw   = iTime >= 0 ? (cells[iTime]?.textContent?.trim() || '') : '';
        const catRaw    = iCat  >= 0 ? (cells[iCat]?.textContent?.trim()  || '') : '';
        const rawRaceText = raceCell?.textContent?.trim() || '';

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
        if (!dm) {
          // Righe senza data singola sono di due tipi, entrambe da saltare
          // come risultato ma da distinguere per il nome del giro:
          //  - la riga "titolo tour" vera e propria (es. "Ronde de l'Isard
          //    (2.2U)"), che nel DOM usa uno <span> semplice — è questa che
          //    vogliamo come prefisso per le tappe successive;
          //  - le righe di riepilogo "Points classification"/"General
          //    classification" (posizione finale nella generale/punti, non
          //    un vero risultato di tappa), che nel DOM usano la stessa
          //    coppia di span imob/idesk delle tappe — vanno ignorate anche
          //    per il nome del giro, altrimenti sovrascrivono il titolo vero
          //    con "General classificationGeneral classification".
          const isClassificationRow = !!raceCell?.querySelector('.imob, .idesk');
          if (rawRaceText && !isClassificationRow) lastTourName = rawRaceText;
          continue;
        }
        const data = `${season}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`;

        const raceLink = raceCell?.querySelector('a');
        let pcs_race_slug = null;
        let pcs_url = null;
        let isStage = false;
        if (raceLink) {
          const href = raceLink.getAttribute('href') || '';
          pcs_url = href.replace(/^\/+/, '');
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
            isStage = !!stagePart;
          }
        }
        if (!rawRaceText || !pcs_race_slug) continue;

        // Il DOM ha DUE etichette sovrapposte per le tappe (una breve per
        // mobile "S4", una estesa per desktop "Stage 4" — entrambe presenti
        // sempre, mostrate alternativamente via CSS), quindi il testo grezzo
        // concatena "S4Stage 4 - Matera › Corato" senza separatore. Tenendo
        // solo da "Stage " in poi si ottiene l'etichetta leggibile, e
        // anteponendo il nome del giro si ottiene lo stile PCS completo.
        const stageIdx = rawRaceText.indexOf('Stage ');
        const cleanedLabel = stageIdx >= 0 ? rawRaceText.slice(stageIdx) : rawRaceText;
        const gara_name = (isStage && lastTourName) ? `${lastTourName} — ${cleanedLabel}` : cleanedLabel;

        const posStr = resultRaw.replace(/[^0-9]/g, '');
        const posizione = posStr ? parseInt(posStr) : null;
        if (!posizione || posizione < 1 || posizione > 999) continue;

        let distacco = null;
        if (posizione === 1) {
          distacco = null;
        } else if (timeRaw && timeRaw !== '-' && timeRaw !== '0:00:00') {
          distacco = timeRaw.startsWith('+') ? timeRaw : (timeRaw ? '+' + timeRaw : null);
        }

        rows.push({ data, gara_name, pcs_race_slug, pcs_url, posizione, distacco, cat: catRaw, country });
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
  // Paginato come getPhantomAthletes: pcs_results ha già oltre 27000 righe
  // (molti risultati per atleta), un limit(5000) fisso ne perdeva la
  // maggior parte per ordine di ritorno arbitrario — --skip-complete non
  // vedeva mai la maggioranza degli atleti come "già fatti" e li
  // riprocessava inutilmente ad ogni rilancio.
  const ids = new Set();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('pcs_results')
      .select('atleta_id').eq('season', season).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    for (const r of data) ids.add(r.atleta_id);
    if (data.length < PAGE) break;
  }
  return ids;
}

// Atleti "fantasma": non registrati con la FCI (di solito stranieri o
// professionisti) ma comunque presenti in pcs_gara_results — arrivati lì
// perché hanno corso in una gara del circuito ICS con pagina PCS completa
// scrapata (es. un corridore di team estero al Circuito del Porto). Hanno
// già una pagina sul sito (costruita al volo dal frontend a partire dai
// risultati), ma restano senza foto/social/palmares se non processati anche
// qui. rider_name è nel formato PCS "Cognome Nome" (es. "Viviani Attilio").
//
// ATTENZIONE duplicati: un atleta FCI con secondo nome (es. "Maya Yvette
// Kingma") spesso compare su PCS senza ("Kingma Maya") — usare solo la prima
// parola di rider_name come "cognome" creava un profilo fantasma duplicato
// (KINGMA_MAYA) accanto a quello FCI vero (KINGMA_MAYA_YVETTE). fciAthletes
// permette di riconoscere questi casi e saltarli: si prova il cognome più
// lungo possibile (per gestire cognomi doppi come "Longo Borghini", "De
// Angelis") confrontandolo con i cognomi FCI noti, poi si verifica che la
// prima parola del nome coincida — se sì, il fantasma è già coperto da un
// atleta FCI esistente e non va creato.
async function getPhantomAthletes(sb, season, fciAthletes = new Map()) {
  const all = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('pcs_gara_results')
      .select('atleta_id, rider_name')
      .eq('season', season)
      .not('atleta_id', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }

  // Indice cognomi FCI noti: tupla di parole (in stringa) → lista atleti
  const normWords = s => normalizeStr(s).split(' ').filter(Boolean);
  const fciByCognome = new Map();
  let maxCognomeLen = 1;
  for (const a of fciAthletes.values()) {
    const cogWords = normWords(a.cognome);
    if (!cogWords.length) continue;
    maxCognomeLen = Math.max(maxCognomeLen, cogWords.length);
    const key = cogWords.join(' ');
    if (!fciByCognome.has(key)) fciByCognome.set(key, []);
    fciByCognome.get(key).push({ nomeWords: normWords(a.nome) });
  }

  const map = new Map();
  let skippedDupes = 0;
  for (const r of all) {
    if (map.has(r.atleta_id)) continue;
    const words = normWords(r.rider_name || '');
    if (words.length) {
      let isDupe = false;
      for (let clen = Math.min(maxCognomeLen, words.length - 1 || 1); clen >= 1; clen--) {
        const candidates = fciByCognome.get(words.slice(0, clen).join(' '));
        if (!candidates) continue;
        const nomeWords = words.slice(clen);
        if (nomeWords.length && candidates.some(c => c.nomeWords[0] === nomeWords[0])) { isDupe = true; }
        break; // prova solo il cognome noto più lungo possibile, non i più corti
      }
      if (isDupe) { skippedDupes++; continue; }
    }
    const parts = (r.rider_name || '').trim().split(/\s+/);
    const cognome = parts[0] || r.atleta_id;
    const nome = parts.slice(1).join(' ') || cognome;
    map.set(r.atleta_id, { atleta_id: r.atleta_id, nome, cognome });
  }
  if (skippedDupes) console.log(`[fantasma] ${skippedDupes} scartati perché già coperti da un atleta FCI con nome esteso diverso`);
  return map;
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

  // 1. Atleti da processare — carica sempre tutti gli atleti FCI (serve come
  // riferimento anti-duplicati per i "fantasma", anche in modalità --atleta-id)
  const fciAll = new Map();
  for (const cat of ATH_CATS) {
    const f = path.join(RANK_DIR, `${cat}.json`);
    if (!fs.existsSync(f)) { console.log(`Mancante: ${cat}.json`); continue; }
    for (const a of JSON.parse(fs.readFileSync(f, 'utf8')))
      if (a.atleta_id && !fciAll.has(a.atleta_id)) fciAll.set(a.atleta_id, a);
  }

  const athMap = new Map();
  let idsFileSlugs = null; // atleta_id -> slug confermato manualmente (da pcs-link-found.py)
  if (SINGLE_ID) {
    if (fciAll.has(SINGLE_ID)) athMap.set(SINGLE_ID, fciAll.get(SINGLE_ID));
    if (!athMap.size) {
      // Non nei ranking FCI — prova tra gli atleti "fantasma" (pcs_gara_results)
      const phantoms = await getPhantomAthletes(sb, SEASON, fciAll);
      if (phantoms.has(SINGLE_ID)) athMap.set(SINGLE_ID, phantoms.get(SINGLE_ID));
    }
    if (!athMap.size) { console.error(`Atleta ${SINGLE_ID} non trovato né nei ranking né tra i fantasma`); process.exit(1); }
  } else if (IDS_FILE) {
    // Lista mirata (es. profili trovati a mano e confermati via pcs-link-found.py)
    const entries = JSON.parse(fs.readFileSync(IDS_FILE, 'utf8'));
    idsFileSlugs = new Map();
    const phantoms = await getPhantomAthletes(sb, SEASON, fciAll);
    for (const e of entries) {
      const a = fciAll.get(e.atleta_id) || phantoms.get(e.atleta_id);
      if (!a) { console.log(`[ids-file] ${e.atleta_id} non trovato né in FCI né tra i fantasma, salto`); continue; }
      athMap.set(e.atleta_id, a);
      if (e.slug) idsFileSlugs.set(e.atleta_id, e.slug);
    }
    console.log(`${athMap.size} atleti da --ids-file=${IDS_FILE}`);
  } else {
    for (const [id, a] of fciAll) athMap.set(id, a);
    console.log(`${athMap.size} atleti unici in ${ATH_CATS.join(', ')}`);

    if (INCLUDE_PHANTOMS) {
      const phantoms = await getPhantomAthletes(sb, SEASON, fciAll);
      let added = 0;
      for (const [id, a] of phantoms) {
        if (!athMap.has(id)) { athMap.set(id, a); added++; }
      }
      console.log(`+ ${added} atleti "fantasma" da pcs_gara_results (non registrati FCI)`);
    }
  }

  let athletes = [...athMap.values()];

  // 2. La foto (una volta salvata) non serve ricontrollarla: --skip-complete
  // salta anche chi ha già risultati, utile solo per riprendere un backfill
  // storico interrotto. Di default invece i risultati vengono SEMPRE
  // ricontrollati (upsert idempotente su atleta_id+season+pcs_race_slug) —
  // altrimenti il giro settimanale non intercetterebbe mai nuovi piazzamenti
  // o vittorie all'estero per chi ha già almeno un risultato salvato.
  const SKIP_COMPLETE = args.includes('--skip-complete');
  const withPhoto   = FORCE ? new Set() : await getExistingPhotoIds(sb);
  const withResults = (FORCE || !SKIP_COMPLETE) ? new Set() : await getAthletesWithResults(sb, SEASON);
  const savedSlugs   = await getSavedSlugs(sb);

  let toProcess = idsFileSlugs
    ? athletes // --ids-file: sono conferme manuali, si riprocessano sempre
    : SKIP_COMPLETE
      ? athletes.filter(a => !(withPhoto.has(a.atleta_id) && withResults.has(a.atleta_id)))
      : athletes;
  if (LIMIT) toProcess = toProcess.slice(0, LIMIT);

  if (idsFileSlugs) {
    for (const [id, slug] of idsFileSlugs) savedSlugs.set(id, slug);
  }

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
        pcs_url:       r.pcs_url,
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
