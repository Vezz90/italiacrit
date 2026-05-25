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
async function fetchAllAlbums() {
  const all = [];
  let page = 1;
  while (page <= 25) {   // max 2500 album
    try {
      const url = `${XPIX_API}/pixy_album?per_page=100&page=${page}&_fields=id,name,slug,count&orderby=id&order=desc`;
      const data = await fetchURL(url, 20000, true);
      if (!Array.isArray(data) || !data.length) break;
      all.push(...data.filter(a => a.count > 0));
      if (data.length < 100) break;
      page++;
    } catch (e) {
      console.warn(`[xpix] fetchAllAlbums p${page}: ${e.message}`);
      break;
    }
  }
  return all;
}

// ── Filtri rilevanza ──────────────────────────────────────────────────────────
// Salta gare professionistiche e contenuti non-gara
const SKIP_RE = /\b(giro d.?italia|tour de france|vuelta|tirreno.adriatico|strade bianche|sanremo|giro di lombardia|coppi e bartali|liegi|parigi|fiandre|amstel|roubaix|critérium|criterium du dauphiné)\b|ritiro|presentazione|shooting|saggio|consegna|bmx|mountain bike|\bmtb\b|cross|pista|velodromo/i;
const CYCLING_RE = /juniores?|allievi|esordienti|elite|under.?23|u\.?23|donne|allieve|femmin|\bgp\b|gran premio|trofeo|coppa|memorial|campionato|circuito|popolarissima|corsa|giro del|giro di|giro della/i;

function isCyclingRelevant(name) {
  return !SKIP_RE.test(name) && CYCLING_RE.test(name);
}

function isRecent(name) {
  const y = new Date().getFullYear();
  return new RegExp(`\\b(${y}|${y - 1})\\b`).test(name);
}

// ── Recupera URL foto watermarked tramite WP REST API ─────────────────────────
// Strategia 1 (preferita): pixy_album term ID → product → media → source_url
// Strategia 2 (fallback):  scrape pagina gallery HTML
async function fetchPhotoForAlbum(album) {
  // Strategia 1: wp/v2/product?pixy_album=[id]
  try {
    const products = await fetchURL(
      `${XPIX_API}/product?pixy_album=${album.id}&per_page=1&_fields=id,featured_media`,
      10000, true
    );
    if (Array.isArray(products) && products.length && products[0].featured_media) {
      const media = await fetchURL(
        `${XPIX_API}/media/${products[0].featured_media}?_fields=source_url`,
        8000, true
      );
      if (media && media.source_url) return media.source_url;
    }
  } catch { /* fallback */ }

  // Strategia 2: scrape HTML gallery page
  try {
    const html = await fetchURL(
      `${XPIX_SHOP}?yith_wcan=1&filter=open&pixy_album=${encodeURIComponent(album.slug)}`,
      12000, false
    );
    const m = html.match(/src="(https:\/\/xpix\.fsn1\.your-objectstorage\.com\/[^"]+_watermarked\.jpg)"/);
    if (m) return m[1];
  } catch { /* nothing */ }

  return null;
}

// ── Entry point principale ─────────────────────────────────────────────────────
// knownSlugs: Set di slug già presenti in coda (evita duplicati)
// maxNew: quanti nuovi album processare per sync (default 30, bilancia velocità/completezza)
async function fetchXpixCandidates(knownSlugs, maxNew = 30) {
  console.log('[xpix] Caricamento lista album...');
  const allAlbums = await fetchAllAlbums();
  console.log(`[xpix] ${allAlbums.length} album totali trovati`);

  const toProcess = allAlbums
    .filter(a => isRecent(a.name))
    .filter(a => isCyclingRelevant(a.name))
    .filter(a => !knownSlugs.has(a.slug))
    .slice(0, maxNew);

  console.log(`[xpix] ${toProcess.length} nuovi album da processare (max ${maxNew})`);

  const results = await mapConcurrent(toProcess, async (album) => {
    const photoUrl = await fetchPhotoForAlbum(album);
    if (!photoUrl) return null;
    return {
      album_id:    album.id,
      album_name:  album.name,
      album_slug:  album.slug,
      photo_count: album.count,
      photo_url:   photoUrl,
      album_page:  `${XPIX_SHOP}?yith_wcan=1&filter=open&pixy_album=${encodeURIComponent(album.slug)}`,
    };
  }, 4);

  const valid = results.filter(Boolean);
  console.log(`[xpix] ${valid.length} album con foto recuperate`);
  return valid;
}

module.exports = { fetchXpixCandidates, fetchAllAlbums, isCyclingRelevant, isRecent };
