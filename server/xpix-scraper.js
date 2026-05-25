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

// ── Recupera più URL foto watermarked per un album ────────────────────────────
// Strategia 1: wp/v2/product?pixy_album=[id] → prodotti → featured_media+images → source_url
// Strategia 2: wp/v2/media?pixy_album=[id] (taxonomy diretta su media)
// Strategia 3: scrape HTML gallery — sempre eseguita per supplementare
async function fetchPhotosForAlbum(album, maxPhotos = 12) {
  const seen   = new Set();
  const photos = [];

  const addPhoto = (url) => {
    if (!url || seen.has(url) || photos.length >= maxPhotos) return;
    seen.add(url);
    photos.push(url);
  };

  // ── Strategia 1: WP products → featured_media + images array ──────────────
  try {
    const products = await fetchURL(
      `${XPIX_API}/product?pixy_album=${album.id}&per_page=${maxPhotos}&_fields=id,featured_media,images`,
      15000, true
    );
    if (Array.isArray(products) && products.length) {
      // (a) Estrai da campo images[] direttamente (WooCommerce lo include spesso)
      for (const p of products) {
        if (Array.isArray(p.images)) {
          for (const img of p.images) {
            addPhoto(img.src || img.source_url || null);
          }
        }
      }

      // (b) Fetch featured_media per i prodotti che ancora non hanno foto
      const withMedia = products.filter(p => p.featured_media && !photos.length);
      if (withMedia.length) {
        const mediaUrls = await mapConcurrent(
          withMedia.slice(0, maxPhotos),
          async (p) => {
            try {
              const media = await fetchURL(
                `${XPIX_API}/media/${p.featured_media}?_fields=source_url,media_details`,
                8000, true
              );
              return media?.source_url || null;
            } catch { return null; }
          }, 4
        );
        mediaUrls.filter(Boolean).forEach(addPhoto);
      }
    }
  } catch (e) {
    console.warn(`[xpix] strategy1 album ${album.slug}: ${e.message}`);
  }

  // ── Strategia 2: media con taxonomy pixy_album ─────────────────────────────
  if (photos.length < 3) {
    try {
      const media = await fetchURL(
        `${XPIX_API}/media?pixy_album=${album.id}&per_page=${maxPhotos}&_fields=source_url`,
        12000, true
      );
      if (Array.isArray(media)) {
        media.forEach(m => addPhoto(m.source_url || null));
      }
    } catch { /* ignorato */ }
  }

  // ── Strategia 3: scrape HTML gallery (sempre, per integrare) ──────────────
  if (photos.length < maxPhotos) {
    try {
      const html = await fetchURL(
        `${XPIX_SHOP}?yith_wcan=1&filter=open&pixy_album=${encodeURIComponent(album.slug)}`,
        15000, false
      );

      // Regex ampia: qualsiasi src su xpix.it o CDN xpix
      const re = /(?:src|data-src|data-lazy-src)="(https?:\/\/(?:www\.xpix\.it|xpix\.[^"]+\.com)[^"]+\.(?:jpg|jpeg|png)(?:\?[^"]*)?)"/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        const url = m[1];
        // Salta thumbnail minuscole e icone UI
        if (/\d{1,3}x\d{1,3}\.jpg/.test(url)) continue;  // es. 150x150.jpg
        if (/logo|icon|avatar|sprite/i.test(url)) continue;
        addPhoto(url);
        if (photos.length >= maxPhotos) break;
      }

      // Fallback: cerca anche i data-product_image / data-large_image WC
      const reImg = /data-large_image="([^"]+\.(?:jpg|jpeg|png)[^"]*)"/gi;
      while ((m = reImg.exec(html)) !== null) {
        addPhoto(m[1]);
        if (photos.length >= maxPhotos) break;
      }
    } catch (e) {
      console.warn(`[xpix] strategy3 HTML ${album.slug}: ${e.message}`);
    }
  }

  return photos;
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

  const results = await mapConcurrent(toProcess, async (album) => {
    const photos = await fetchPhotosForAlbum(album, 12);
    if (!photos.length) return null;
    return {
      album_id:    album.id,
      album_name:  album.name,
      album_slug:  album.slug,
      photo_count: album.count,
      photos,                    // array di URL watermarked
      photo_url:   photos[0],    // default: prima foto
      album_page:  `${XPIX_SHOP}?yith_wcan=1&filter=open&pixy_album=${encodeURIComponent(album.slug)}`,
    };
  }, 3);   // 3 album in parallelo per non sovraccaricare

  const valid = results.filter(Boolean);
  console.log(`[xpix] ${valid.length} album con foto recuperate`);
  return valid;
}

module.exports = { fetchXpixCandidates, fetchAllAlbums, isCyclingRelevant, isRecent };
