/**
 * italiaciclismo.net Photo Scraper
 *
 * Scarica le foto dalle pagine gara di http://www.italiaciclismo.net/
 * Il sito è HTTP-only (no HTTPS) — usa il modulo http nativo di Node.js.
 *
 * Flusso:
 *   1. Fetcha la homepage + pagine indice per raccogliere URL gara recenti
 *   2. Per ogni pagina gara, estrae le URL delle foto
 *   3. Ritorna candidati per la coda admin (stesso pattern di xpix)
 */

'use strict';
const http  = require('http');
const https = require('https');

const IC_BASE = 'http://www.italiaciclismo.net';

// ── HTTP/HTTPS helper generico ────────────────────────────────────────────────
function fetchURL(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout: ' + url)), timeoutMs);
    const lib   = url.startsWith('https') ? https : http;
    const opts  = {
      headers: {
        'User-Agent':       'Mozilla/5.0 (compatible; italiacrit-bot/1.0)',
        'Accept':           'text/html,*/*',
        'Accept-Language':  'it-IT,it;q=0.9',
        'Connection':       'close',
      },
    };

    lib.get(url, opts, (res) => {
      // Segui redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer);
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetchURL(next, timeoutMs).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} — ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString('latin1')); // il sito usa latin1/ISO-8859-1
      });
    }).on('error', e => { clearTimeout(timer); reject(e); });
  });
}

// ── Estrai URL gare da una pagina HTML ────────────────────────────────────────
// Cerca href tipo: gara_juniores_12345_2026_04_25_...htm
const GARA_URL_RE = /href="(gara_(?:juniores|allievi|esordienti|elite_under23|donne[^"]*?)_\d+_\d{4}_\d{2}_\d{2}_[^"]*?\.htm)"/gi;

function extractGaraUrls(html, baseUrl) {
  const found = new Set();
  let m;
  while ((m = GARA_URL_RE.exec(html)) !== null) {
    const rel = m[1];
    const abs = rel.startsWith('http') ? rel : `${IC_BASE}/${rel}`;
    found.add(abs);
  }
  return [...found];
}

// ── Estrai foto da una pagina gara ────────────────────────────────────────────
// Cerca tag <img> con percorsi foto tipici del sito
function extractPhotos(html, garaUrl) {
  const photos = [];
  const seen   = new Set();

  // Pattern 1: <img src="foto/nomeFile.jpg"> o varianti con path relativo
  const imgRe = /<img[^>]+src="([^"]+\.(?:jpg|jpeg|png|gif))"[^>]*>/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    let src = m[1];
    // Salta icone, loghi, spacer, banner di piccole dimensioni
    if (/logo|icon|banner|spacer|button|pixel|arrow|star|flag|trophy|spinner/i.test(src)) continue;
    if (src.includes('data:')) continue;

    // Costruisci URL assoluto
    if (!src.startsWith('http')) {
      const base = new URL(garaUrl);
      src = src.startsWith('/') ? `${base.origin}${src}` : `${IC_BASE}/${src.replace(/^\.\//, '')}`;
    }

    if (!seen.has(src)) {
      seen.add(src);
      photos.push(src);
    }
  }

  // Filtra: tieni solo immagini che sembrano foto di gara (non elementi UI)
  // Euristica: URL che contengono anno, numero, o percorso "foto"
  const racePhotos = photos.filter(u => {
    const lower = u.toLowerCase();
    return lower.includes('foto') ||
           lower.includes('gara') ||
           lower.includes('2024') ||
           lower.includes('2025') ||
           lower.includes('2026') ||
           /\/\d{4,}[_-]/.test(lower) ||
           /[_-]\d{4,}\./.test(lower);
  });

  // Se il filtro è troppo aggressivo, restituisci le prime foto trovate
  return (racePhotos.length ? racePhotos : photos).slice(0, 12);
}

// ── Parsa info gara dall'URL ──────────────────────────────────────────────────
// Esempio: gara_juniores_35389_2026_04_25_massa_ms_50_gran_premio_..._massa.htm
function parseGaraUrl(url) {
  const filename = url.split('/').pop().replace('.htm', '');
  const parts    = filename.split('_');

  // parts[0] = 'gara', parts[1] = categoria, parts[2] = id numerico
  // parts[3..5] = YYYY_MM_DD, resto = location + nome
  if (parts.length < 6) return null;

  const categoria = parts[1];   // juniores | allievi | esordienti | elite_under23 | donne_...
  const gara_id   = parts[2];   // ID numerico
  const date      = `${parts[3]}-${parts[4]}-${parts[5]}`;  // YYYY-MM-DD
  // Resto dell'URL = location + nome gara (separati da _)
  const nameRaw   = parts.slice(6).join(' ').replace(/__+/g, ' ').trim();
  // Decodifica percent-encoding e pulisci
  const name      = decodeURIComponent(nameRaw)
    .replace(/\s+/g, ' ')
    .replace(/[_]+/g, ' ')
    .trim()
    .toUpperCase();

  return { categoria, gara_id, date, name, url };
}

// ── Pagine indice da cui raccogliere URL gare ─────────────────────────────────
const INDEX_PAGES = [
  `${IC_BASE}/`,
  `${IC_BASE}/risultati_juniores.htm`,
  `${IC_BASE}/risultati_allievi.htm`,
  `${IC_BASE}/risultati_esordienti.htm`,
  `${IC_BASE}/risultati_elite_under23.htm`,
  `${IC_BASE}/risultati_donne.htm`,
];

// ── Entry point principale ─────────────────────────────────────────────────────
// knownUrls: Set di URL gara già presenti in coda
// maxNew: max nuovi album da processare
async function fetchItaliaciclismoCandidates(knownUrls, maxNew = 20) {
  console.log('[ic] Raccolta URL gare da pagine indice...');

  // 1. Raccolta URL gare dalle pagine indice
  const garaUrls = new Set();
  for (const indexUrl of INDEX_PAGES) {
    try {
      const html = await fetchURL(indexUrl, 12000);
      const found = extractGaraUrls(html, indexUrl);
      found.forEach(u => garaUrls.add(u));
      console.log(`[ic] ${indexUrl} → ${found.length} gare trovate`);
    } catch (e) {
      console.warn(`[ic] Errore index ${indexUrl}: ${e.message}`);
    }
  }

  console.log(`[ic] ${garaUrls.size} URL gara totali raccolte`);

  // 2. Filtra per anno corrente/precedente e non già in coda
  const currentYear = new Date().getFullYear();
  const toProcess = [...garaUrls]
    .filter(u => {
      if (knownUrls.has(u)) return false;
      // Mantieni solo gare recenti (anno corrente o precedente nell'URL)
      return u.includes(`_${currentYear}_`) || u.includes(`_${currentYear - 1}_`);
    })
    .slice(0, maxNew);

  console.log(`[ic] ${toProcess.length} nuove gare recenti da processare`);

  // 3. Per ogni gara, fetch pagina e estrai foto
  const results = [];
  for (const garaUrl of toProcess) {
    try {
      const info = parseGaraUrl(garaUrl);
      if (!info) continue;

      const html   = await fetchURL(garaUrl, 12000);
      const photos = extractPhotos(html, garaUrl);

      if (photos.length) {
        results.push({
          gara_url:  garaUrl,
          categoria: info.categoria,
          date:      info.date,
          name:      info.name,
          photos,
          photo_url: photos[0],
        });
        console.log(`[ic] ✓ ${info.date} ${info.name} — ${photos.length} foto`);
      } else {
        console.log(`[ic] ✗ ${info.date} ${info.name} — nessuna foto`);
      }

      // Pausa breve tra le richieste
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.warn(`[ic] Errore ${garaUrl}: ${e.message}`);
    }
  }

  console.log(`[ic] ${results.length} gare con foto trovate`);
  return results;
}

module.exports = { fetchItaliaciclismoCandidates, parseGaraUrl, extractGaraUrls };
