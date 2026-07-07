/**
 * YouTube RSS Scraper per canali di ciclismo agonistico italiano
 * Usa feed RSS pubblici di YouTube — nessuna API key richiesta.
 * Ogni canale restituisce gli ultimi ~15 video.
 *
 * Tipi di canale supportati:
 *   channel_id — es. UCVvuWSmp_89VDcdayoJMelw
 *   username   — es. ciclismoweb  (legacy YouTube usernames)
 *   handle     — es. @CiclismoLive o ciclismolive
 *                Il server risolve automaticamente il channel_id dalla pagina.
 */

'use strict';
const https = require('https');

// ── Canali predefiniti ─────────────────────────────────────────────────────────
const DEFAULT_CHANNELS = [
  {
    id: 'toscana_sprint',
    name: 'ToscanaSprint',
    type: 'channel_id',
    value: 'UCVvuWSmp_89VDcdayoJMelw',
    enabled: true,
  },
  {
    id: 'ciclismoweb',
    name: 'ciclismoweb / ExtraCiclismo',
    type: 'username',
    value: 'ciclismoweb',
    enabled: true,
  },
  {
    id: 'bicitv',
    name: 'BICITV',
    type: 'channel_id',
    value: 'UCkQ32NsdII9MQ4p3RHyWeVA',
    enabled: true,
  },
  {
    id: 'ciclismolive',
    name: 'CiclismoLive',
    type: 'channel_id',
    value: 'UCQl1bzhYYXYMROIuvlNDiRQ',   // @CiclismoLive risolto
    enabled: true,
  },
  {
    id: 'pianetaciclismo',
    name: 'PianetaCiclismo',
    type: 'channel_id',
    value: 'UCnThk3tlBKht3Lt18gL8PMA',   // @pianetaciclismo-bypianetag4399
    enabled: true,
  },
];

// ── Cache locale per channel_id risolti da handle ─────────────────────────────
const _handleCache = {};

// ── Helper: fetch HTTPS con timeout e redirect ─────────────────────────────────
function fetchURL(url, timeoutMs = 15000, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout: ' + url)), timeoutMs);

    const options = {
      rejectUnauthorized: false, // alcune reti hanno catena cert incompleta
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; italiacrit-bot/1.0)',
        'Accept-Language': 'it-IT,it;q=0.9',
        ...extraHeaders,
      },
    };

    https.get(url, options, (res) => {
      // Segui redirect (max 3)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer);
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetchURL(next, timeoutMs, extraHeaders).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => { clearTimeout(timer); resolve(data); });
    }).on('error', err => { clearTimeout(timer); reject(err); });
  });
}

// ── Risolvi @handle → UC channel_id ──────────────────────────────────────────
async function resolveHandle(handle) {
  // Rimuovi @ se presente
  const clean = handle.replace(/^@/, '');
  const cacheKey = clean.toLowerCase();
  if (_handleCache[cacheKey]) return _handleCache[cacheKey];

  // Prova prima con legacy username (spesso funziona per canali con nome uguale)
  try {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?user=${encodeURIComponent(clean)}`;
    const xml = await fetchURL(rssUrl, 8000);
    const m = xml.match(/<yt:channelId>([^<]+)<\/yt:channelId>/);
    if (m && m[1]) { _handleCache[cacheKey] = m[1]; return m[1]; }
  } catch { /* continua */ }

  // Fetch pagina canale e cerca channelId nella sorgente JSON
  const urls = [
    `https://www.youtube.com/@${clean}`,
    `https://www.youtube.com/c/${clean}`,
  ];

  for (const pageUrl of urls) {
    try {
      const html = await fetchURL(pageUrl, 12000, {
        'Cookie': 'CONSENT=YES+; VISITOR_INFO1_LIVE=',
      });
      // Cerca "externalId":"UCxxxx" oppure "channelId":"UCxxxx"
      const patterns = [
        /"externalId"\s*:\s*"(UC[\w-]{22})"/,
        /"channelId"\s*:\s*"(UC[\w-]{22})"/,
        /"browseId"\s*:\s*"(UC[\w-]{22})"/,
        /channel\/(UC[\w-]{22})/,
      ];
      for (const pat of patterns) {
        const m = html.match(pat);
        if (m && m[1]) {
          console.log(`[yt-scraper] Risolto @${clean} → ${m[1]}`);
          _handleCache[cacheKey] = m[1];
          return m[1];
        }
      }
    } catch { /* continua */ }
  }

  console.warn(`[yt-scraper] Impossibile risolvere handle @${clean}`);
  return null;
}

// ── Helper XML minimale ────────────────────────────────────────────────────────
function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return '';
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

function extractAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}[^>]+${attr}="([^"]+)"`, 'i');
  const m = xml.match(re);
  return m ? m[1] : '';
}

// ── Parser feed RSS YouTube ────────────────────────────────────────────────────
function parseYouTubeRSS(xml, channelName) {
  const entries = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = entryRe.exec(xml)) !== null) {
    const entry     = match[1];
    const videoId   = extractTag(entry, 'yt:videoId');
    const title     = extractTag(entry, 'title');
    const published = (extractTag(entry, 'published') || '').slice(0, 10);
    const thumbnail = extractAttr(entry, 'media:thumbnail', 'url')
      || (videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : '');
    const author    = extractTag(entry, 'name') || channelName;

    if (videoId && title) {
      entries.push({
        videoId,
        url:          `https://www.youtube.com/watch?v=${videoId}`,
        title,
        published_at: published,
        thumbnail,
        channelName:  author || channelName,
      });
    }
  }
  return entries;
}

// ── Fetch canale singolo ───────────────────────────────────────────────────────
async function fetchChannelVideos(channel) {
  let { type, value, name } = channel;
  if (!value) return [];

  let rssUrl;

  if (type === 'channel_id') {
    rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(value)}`;

  } else if (type === 'username') {
    rssUrl = `https://www.youtube.com/feeds/videos.xml?user=${encodeURIComponent(value)}`;

  } else if (type === 'handle') {
    // Risolvi handle → channel_id
    // Controlla se abbiamo già un ID risolto salvato nell'oggetto canale
    let chId = channel._resolved_id || _handleCache[value.replace(/^@/, '').toLowerCase()];
    if (!chId) chId = await resolveHandle(value);
    if (chId) {
      channel._resolved_id = chId; // salva in memoria per futuri sync
      rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(chId)}`;
    } else {
      console.warn(`[yt-scraper] Handle @${value} non risolto, skip`);
      return [];
    }
  } else {
    return [];
  }

  try {
    const xml = await fetchURL(rssUrl);
    return parseYouTubeRSS(xml, name);
  } catch (e) {
    console.warn(`[yt-scraper] Errore canale "${name}": ${e.message}`);
    return [];
  }
}

// ── Fetch tutti i canali abilitati ────────────────────────────────────────────
async function fetchAllChannels(channels) {
  const results = {};
  for (const ch of (channels || []).filter(c => c.enabled && c.value)) {
    results[ch.id] = await fetchChannelVideos(ch);
  }
  return results;
}

// Estrae un oggetto JSON bilanciato (conta le graffe rispettando le stringhe)
// che inizia dopo la prima occorrenza di `marker`. Serve per leggere
// ytInitialPlayerResponse dalla pagina HTML: un regex "non greedy" fino al
// primo `};` è inaffidabile perché quel JSON è enorme e può contenere `};`
// dentro stringhe innestate (es. descrizioni video), troncando l'oggetto.
function _extractJsonAfter(html, marker) {
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const start = html.indexOf('{', idx);
  if (start === -1) return null;
  let depth = 0, inStr = false, strCh = null, esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === strCh) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

// ── Durata + segnale "diretta": scraping della pagina watch (nessuna API key) ──
// Il campo autoritativo per capire se un video è (stato) uno streaming live è
// videoDetails.isLiveContent, non la durata: uno streaming breve (es. 20 min)
// va comunque rilevato, mentre un lungo video di montaggio normale (non
// trasmesso in diretta) non deve scattare come falso positivo. La durata resta
// un fallback per i canali che caricano la registrazione integrale della
// diretta come video normale, senza usare l'infrastruttura live di YouTube
// (in quel caso isLiveContent è false ma il video supera comunque l'ora).
// NB: un regex "prima occorrenza di lengthSeconds nella pagina" non basta,
// perché la pagina contiene MOLTI altri blocchi JSON (video correlati, ecc.)
// con lo stesso nome di campo riferito ad ALTRI video: bisogna leggere
// ytInitialPlayerResponse.videoDetails, non un match a caso nell'HTML.
async function fetchVideoLiveInfo(videoId) {
  try {
    const html = await fetchURL(`https://www.youtube.com/watch?v=${videoId}`, 10000, {
      'Cookie': 'CONSENT=YES+; VISITOR_INFO1_LIVE=',
    });
    const player = _extractJsonAfter(html, 'var ytInitialPlayerResponse');
    const vd = player?.videoDetails;
    if (!vd) {
      // Pagina scaricata ma senza ytInitialPlayerResponse.videoDetails: quasi
      // sempre un consent wall o una pagina "sorry, unusual traffic" servita
      // a un IP datacenter (es. Render) invece della pagina video vera.
      const reason = /consent\.youtube\.com|unusual traffic|Prima di continuare/i.test(html)
        ? 'consent_wall' : `no_video_details_${html.length}b`;
      return { duration: null, isLiveContent: false, reason };
    }
    const duration = vd.lengthSeconds != null ? parseInt(vd.lengthSeconds, 10) : null;
    return { duration: Number.isFinite(duration) ? duration : null, isLiveContent: !!vd.isLiveContent, reason: null };
  } catch (e) { return { duration: null, isLiveContent: false, reason: 'fetch_error: ' + e.message }; }
}

async function fetchVideoDuration(videoId) {
  return (await fetchVideoLiveInfo(videoId)).duration;
}

module.exports = { DEFAULT_CHANNELS, fetchChannelVideos, fetchAllChannels, parseYouTubeRSS, resolveHandle, fetchVideoDuration, fetchVideoLiveInfo };
