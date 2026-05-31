/**
 * xpix.it Scraper — foto watermarked per gare di ciclismo agonistico italiano
 *
 * Usa la REST API pubblica di WordPress (wp/v2) di xpix.it:
 *   - /wp/v2/pixy_album  → lista tutti gli album fotografici
 *   - /wp/v2/product     → ottieni il primo prodotto (foto) di un album
 *   - /wp/v2/media       → ottieni l'URL dell'immagine watermarked
 *
 * Non richiede API key né autenticazione.
 * Le foto hanno watermark visibile "xpix.it // Angela Faggion".
 */

'use strict';
const https = require('https');

const XPIX_API   = 'https://www.xpix.it/wp-json/wp/v2';
const XPIX_SHOP  = 'https://www.xpix.it/negozio/';

// ── HTTP helper ───────────────────────────────────────────────────────────────
function fetchURL(url, timeoutMs = 15000, asJSON = false) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout: ' + url)), timeoutMs);
    const opts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; italiacrit-bot/1.0)',
        'Accept': asJSON ? 'application/json' : 'text/html,*/*',
      },
    };
    https.get(url, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer);
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetchURL(next, timeoutMs, asJSON).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        return reject(new Error(`HTTP ${res.statusCode} — ${url}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => {
        clearTimeout(timer);
        if (asJSON) {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        } else {
          resolve(body);
        }
      });
    }).on('error', e => { clearTimeout(timer); reject(e); });
  });
}

// ── Concurrency limiter ───────────────────────────────────────────────────────
async function mapConcurrent(arr, fn, limit = 4) {
  const results = new Array(arr.length);
  let idx = 0;
  async function worker() {
    while (idx < arr.length) {
      const i = idx++;
      results[i] = await fn(arr[i], i).catch(() => null);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, worker));
  return results;
}

// ── Fetch tutti gli album dalla taxonomy pixy_album ───────────────────────────
// Strategia doppia:
// 1. Per ID decrescente (album più recenti per data creazione taxonomy)
// 2. Ricerca per anno corrente e prossimo (trova album creati anni fa ma con foto 2026+)
async function fetchAllAlbums() {
  const seen = new Set();
  const all  = [];

  const addBatch = (data) => {
    for (const a of data) {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        all.push(a); // includi anche count=0: foto potrebbero essere in arrivo
      }
    }
  };

  const currentYear = new Date().getFullYear();

  // Passata 1: ultimi 200 album per ID (i più recenti)
  for (let page = 1; page <= 2; page++) {
    try {
      const url = `${XPIX_API}/pixy_album?per_page=100&page=${page}&_fields=id,name,slug,count&orderby=id&order=desc`;
      const data = await fetchURL(url, 20000, true);
      if (!Array.isArray(data) || !data.length) break;
      addBatch(data);
      if (data.length < 100) break;
    } catch (e) { console.warn(`[xpix] fetchAllAlbums p${page}: ${e.message}`); break; }
  }

  // Passata 2: ricerca per anno corrente (cattura album con ID vecchio ma foto nuove)
  try {
    const url = `${XPIX_API}/pixy_album?search=${currentYear}&per_page=100&_fields=id,name,slug,count`;
    const data = await fetchURL(url, 20000, true);
    if (Array.isArray(data)) addBatch(data);
  } catch (e) { console.warn(`[xpix] fetchAllAlbums search ${currentYear}: ${e.message}`); }

  console.log(`[xpix] fetchAllAlbums: ${all.length} album unici trovati`);
  return all;
}

// ── Fetch un singolo album per slug (bypass filtri) ──────────────────────────
async function fetchAlbumBySlug(slug) {
  // Supporta sia slug puro che URL completo negozio xpix
  const m = slug.match(/pixy_album=([^&]+)/);
  if (m) slug = decodeURIComponent(m[1]);
  slug = slug.trim().replace(/^\/+|\/+$/g, '');

  const url = `${XPIX_API}/pixy_album?slug=${encodeURIComponent(slug)}&_fields=id,name,slug,count`;
  const data = await fetchURL(url, 20000, true);
  if (!Array.isArray(data) || !data.length) return null;
  return data[0]; // il taxonomy term
}

// Solo album dal 2026 in avanti — se non c'è anno nel nome, includi (potrebbe essere 2026)
function isCyclingRelevant() { return true; }
function isRecent(name) {
  const match = (name || '').match(/\b(20\d{2})\b/g);
  if (!match) return true; // nessun anno → includi
  const maxYear = Math.max(...match.map(Number));
  return maxYear >= 2026;
}

// ── Recupera URL foto watermarked per un album — 2 sole chiamate API ──────────
// 1. GET /wp/v2/product?pixy_album=[id]  → lista featured_media IDs
// 2. GET /wp/v2/media?include=[id,id,…]  → tutti i source_url in un colpo solo
async function fetchPhotosForAlbum(album, maxPhotos = 50) {
  try {
    // Passo 1: ottieni tutti i prodotti dell'album (paginato se > 100)
    const products = [];
    let page = 1;
    while (products.length < maxPhotos) {
      const batch = await fetchURL(
        `${XPIX_API}/product?pixy_album=${album.id}&per_page=100&page=${page}&_fields=id,featured_media&orderby=id&order=asc`,
        15000, true
      );
      if (!Array.isArray(batch) || !batch.length) break;
      products.push(...batch);
      if (batch.length < 100) break;
      page++;
    }
    if (!products.length) return [];

    // Passo 2: raccogli i featured_media IDs (salta 0/null), rispetta maxPhotos
    const mediaIds = products
      .map(p => p.featured_media)
      .filter(Boolean)
      .slice(0, maxPhotos);
    if (!mediaIds.length) return [];

    // Passo 3: singola chiamata per recuperare tutti gli URL
    const mediaList = await fetchURL(
      `${XPIX_API}/media?include=${mediaIds.join(',')}&per_page=${mediaIds.length}&_fields=id,source_url`,
      15000, true
    );
    if (!Array.isArray(mediaList)) return [];

    // Mantieni l'ordine originale dei prodotti
    const urlByMediaId = {};
    mediaList.forEach(m => { if (m.source_url) urlByMediaId[m.id] = m.source_url; });

    return mediaIds
      .map(id => urlByMediaId[id])
      .filter(Boolean);

  } catch (e) {
    console.warn(`[xpix] fetchPhotosForAlbum ${album.slug}: ${e.message}`);
    return [];
  }
}

// ── Entry point principale ─────────────────────────────────────────────────────
// knownSlugs: Set di slug già presenti in coda (evita duplicati)
// maxNew: quanti nuovi album processare per sync (default 25)
async function fetchXpixCandidates(knownSlugs, maxNew = 25) {
  console.log('[xpix] Caricamento lista album...');
  const allAlbums = await fetchAllAlbums();
  console.log(`[xpix] ${allAlbums.length} album totali trovati`);

  const toProcess = allAlbums
    .filter(a => isRecent(a.name))
    .filter(a => isCyclingRelevant(a.name))
    .filter(a => !knownSlugs.has(a.slug))
    .slice(0, maxNew);

  console.log(`[xpix] ${toProcess.length} nuovi album da processare (max ${maxNew})`);

  // Aggiunge subito in coda SENZA aspettare le foto — le foto vengono
  // caricate in background o quando l'admin clicca "Ricarica foto".
  // Così il sync è veloce e non perde album che hanno foto in arrivo.
  const valid = toProcess.map(album => ({
    album_id:    album.id,
    album_name:  album.name,
    album_slug:  album.slug,
    photo_count: album.count,
    photos:      [],           // vuoto: caricato al primo "Ricarica foto"
    photo_url:   null,
    album_page:  `${XPIX_SHOP}?yith_wcan=1&filter=open&pixy_album=${encodeURIComponent(album.slug)}`,
  }));

  console.log(`[xpix] ${valid.length} nuovi album aggiunti in coda`);
  return valid;
}

module.exports = { fetchXpixCandidates, fetchPhotosForAlbum, fetchAllAlbums, fetchAlbumBySlug, isCyclingRelevant, isRecent };
