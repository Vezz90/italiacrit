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

module.exports = { DEFAULT_CHANNELS, fetchChannelVideos, fetchAllChannels, parseYouTubeRSS, resolveHandle };
