/**
 * YouTube RSS Scraper per canali di ciclismo agonistico italiano
 * Usa feed RSS pubblici di YouTube — nessuna API key richiesta.
 * Ogni canale restituisce gli ultimi ~15 video.
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
    // CiclismoLive: il channel_id va confermato — disabilitato fino a verifica
    id: 'ciclismolive',
    name: 'CiclismoLive',
    type: 'channel_id',
    value: '',
    enabled: false,
  },
];

// ── Helper: fetch HTTPS con timeout ───────────────────────────────────────────
function fetchURL(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout: ' + url)), timeoutMs);
    https.get(url, (res) => {
      // Segui redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer);
        return fetchURL(res.headers.location, timeoutMs).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => { clearTimeout(timer); resolve(data); });
    }).on('error', err => { clearTimeout(timer); reject(err); });
  });
}

// ── Helper XML minimale ────────────────────────────────────────────────────────
function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
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
    const entry = match[1];
    const videoId   = extractTag(entry, 'yt:videoId');
    const title     = extractTag(entry, 'title');
    const published = (extractTag(entry, 'published') || '').slice(0, 10);
    const thumbnail = extractAttr(entry, 'media:thumbnail', 'url')
      || (videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : '');
    const author = extractTag(entry, 'name') || channelName;

    if (videoId && title) {
      entries.push({
        videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title,
        published_at: published,
        thumbnail,
        channelName: author || channelName,
      });
    }
  }
  return entries;
}

// ── Fetch canale singolo ───────────────────────────────────────────────────────
async function fetchChannelVideos(channel) {
  const { type, value, name } = channel;
  if (!value) return [];

  const url = type === 'channel_id'
    ? `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(value)}`
    : `https://www.youtube.com/feeds/videos.xml?user=${encodeURIComponent(value)}`;

  try {
    const xml = await fetchURL(url);
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

module.exports = { DEFAULT_CHANNELS, fetchChannelVideos, fetchAllChannels, parseYouTubeRSS };
