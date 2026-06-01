/**
 * ciclismo.info Photo Scraper
 *
 * Scarica le foto dalle pagine gara di ciclismo.info, suddiviso per
 * sottodomini di categoria: juniores / allievi / esordienti / donne.
 * Ogni gara ha 1 foto: /immagini/gara_{N}_{slug}_{ID}_original.jpg
 *
 * Flusso:
 *   1. Per ogni sottodominio, fetcha la pagina risultati_gare_{cat}.htm
 *   2. Estrae le pagine gara recenti, fetcha ognuna e ricava la foto
 *   3. Ritorna candidati per la coda admin (stesso pattern di xpix)
 */

'use strict';
const http  = require('http');
const https = require('https');

// Sottodomini reali con pagina risultati_gare_{sub}.htm
const IC_SUBS = ['juniores', 'allievi', 'esordienti'];

// ── HTTP/HTTPS helper generico ────────────────────────────────────────────────
function fetchURL(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout: ' + url)), timeoutMs);
    const lib   = url.startsWith('https') ? https : http;
    const opts  = {
      rejectUnauthorized: false,
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
        resolve(Buffer.concat(chunks).toString('latin1')); // ISO-8859-1
      });
    }).on('error', e => { clearTimeout(timer); reject(e); });
  });
}

// ── Estrai URL pagine gara da una pagina indice ───────────────────────────────
// href tipo: gara_juniores_35779_2026_05_31_pravisdomini___..._tappa.htm
function extractGaraUrls(html, sub) {
  const found = new Set();
  const re = new RegExp(`(gara_${sub}_\\d+_\\d{4}_\\d{2}_\\d{2}_[^"' >]+?\\.htm)`, 'gi');
  let m;
  while ((m = re.exec(html)) !== null) {
    found.add(`http://${sub}.ciclismo.info/${m[1]}`);
  }
  return [...found];
}

// ── Estrai TUTTE le foto "original" da una pagina gara ────────────────────────
// Due percorsi possibili:
//   /immagini/gara_..._original.jpg                 (foto principale)
//   /galleria_fotografica/gare/gara_..._{fotoid}_original.jpg  (galleria multipla)
function extractPhotos(html, sub) {
  const seen = new Set();
  const photos = [];
  const re = /(\/(?:immagini|galleria_fotografica\/gare)\/gara_[^"' >]+_original\.(?:jpg|jpeg|png))/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = `http://${sub}.ciclismo.info${m[1]}`;
    if (!seen.has(url)) { seen.add(url); photos.push(url); }
  }
  return photos;
}

// ── Parsa info gara dall'URL ──────────────────────────────────────────────────
// gara_juniores_35779_2026_05_31_pravisdomini___pravisdomini_pn_24_giro_...htm
function parseGaraUrl(url) {
  const filename = url.split('/').pop().replace('.htm', '');
  const parts    = filename.split('_');
  if (parts.length < 6) return null;

  const categoria = parts[1];
  const gara_id   = parts[2];
  const date      = `${parts[3]}-${parts[4]}-${parts[5]}`;
  const nameRaw   = parts.slice(6).join(' ').replace(/__+/g, ' ').trim();
  const name      = decodeURIComponent(nameRaw)
    .replace(/\s+/g, ' ').replace(/[_]+/g, ' ').trim().toUpperCase();

  return { categoria, gara_id, date, name, url };
}

// ── Entry point principale ─────────────────────────────────────────────────────
// knownUrls: Set di URL gara già presenti in coda
// maxNew: max nuove gare da processare
async function fetchItaliaciclismoCandidates(knownUrls, maxNew = 25) {
  console.log('[ic] Raccolta URL gare da ciclismo.info...');

  // 1. Raccolta URL gare dalle pagine risultati di ogni categoria
  const garaUrls = new Set();
  for (const sub of IC_SUBS) {
    try {
      const html  = await fetchURL(`http://${sub}.ciclismo.info/risultati_gare_${sub}.htm`, 12000);
      const found = extractGaraUrls(html, sub);
      found.forEach(u => garaUrls.add(u));
      console.log(`[ic] ${sub} → ${found.length} gare`);
    } catch (e) {
      console.warn(`[ic] Errore indice ${sub}: ${e.message}`);
    }
  }
  console.log(`[ic] ${garaUrls.size} URL gara totali`);

  // 2. Filtra per anno corrente e non già controllate (in coda o no_photo)
  const currentYear = new Date().getFullYear();
  const toProcess = [...garaUrls]
    .filter(u => !knownUrls.has(u) && u.includes(`_${currentYear}_`))
    .slice(0, maxNew);
  console.log(`[ic] ${toProcess.length} nuove gare da processare`);

  // 3. Per ogni gara, fetch pagina e ricava la foto (8 in parallelo)
  const results = [];
  const checkedNoPhoto = [];   // URL controllate senza foto → il server le ricorda
  let idx = 0;
  async function worker() {
    while (idx < toProcess.length) {
      const garaUrl = toProcess[idx++];
      try {
        const info = parseGaraUrl(garaUrl);
        if (!info) { checkedNoPhoto.push(garaUrl); continue; }
        const html   = await fetchURL(garaUrl, 12000);
        const photos = extractPhotos(html, info.categoria);
        if (photos.length) {
          results.push({
            gara_url: garaUrl, categoria: info.categoria, date: info.date,
            name: info.name, photos, photo_url: photos[0],
          });
          console.log(`[ic] ✓ ${info.date} ${info.name} — ${photos.length} foto`);
        } else {
          checkedNoPhoto.push(garaUrl);
        }
      } catch (e) {
        // errore di rete: non marcare come no_photo, riprova al prossimo sync
        console.warn(`[ic] Errore ${garaUrl}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));

  console.log(`[ic] ${results.length} con foto, ${checkedNoPhoto.length} senza foto`);
  return { results, checkedNoPhoto };
}

module.exports = { fetchItaliaciclismoCandidates, parseGaraUrl, extractGaraUrls };
