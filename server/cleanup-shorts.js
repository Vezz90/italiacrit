'use strict';
// Giro una tantum: rimuove dai media_videos già importati quelli che sono in
// realtà Shorts (durata <=60s, definizione ufficiale YouTube) — la playlist
// "uploads" li mescola ai video normali e i primi import li avevano presi
// tutti, prima del fix che li esclude di default.

const fs = require('fs');
const path = require('path');

(function loadEnv() {
  const p = path.join(__dirname, '.env.local');
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  });
})();

const SUPABASE_URL = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
if (!SUPABASE_SECRET) { console.error('Imposta SUPABASE_SECRET in server/.env.local'); process.exit(1); }
if (!YOUTUBE_API_KEY) { console.error('Imposta YOUTUBE_API_KEY in server/.env.local'); process.exit(1); }

const REST_HEADERS = {
  apikey: SUPABASE_SECRET,
  Authorization: `Bearer ${SUPABASE_SECRET}`,
  'Content-Type': 'application/json',
};

function parseIsoDuration(iso) {
  const m = (iso || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const [, h, mi, s] = m;
  return (parseInt(h || 0, 10) * 3600) + (parseInt(mi || 0, 10) * 60) + parseInt(s || 0, 10);
}

async function main() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/media_videos?select=id,url,media_profile_id&url=like.*youtu*`,
    { headers: REST_HEADERS }
  );
  if (!r.ok) throw new Error(`select HTTP ${r.status}: ${await r.text()}`);
  const rows = await r.json();
  console.log(`${rows.length} video YouTube nel DB da controllare`);

  const byVideoId = new Map();
  for (const row of rows) {
    const m = (row.url || '').match(/[?&]v=([\w-]+)/);
    if (!m) continue;
    const vid = m[1];
    if (!byVideoId.has(vid)) byVideoId.set(vid, []);
    byVideoId.get(vid).push(row.id);
  }
  const videoIds = [...byVideoId.keys()];

  let toDelete = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${batch.join(',')}&key=${YOUTUBE_API_KEY}`;
    const resp = await fetch(url).then(x => x.json());
    if (resp.error) { console.error('YouTube API errore:', resp.error.message); continue; }
    for (const item of (resp.items || [])) {
      const dur = parseIsoDuration(item.contentDetails?.duration);
      if (dur !== null && dur <= 60) {
        toDelete.push(...(byVideoId.get(item.id) || []));
      }
    }
  }
  console.log(`${toDelete.length} Shorts trovati da rimuovere`);
  if (!toDelete.length) return;

  for (let i = 0; i < toDelete.length; i += 50) {
    const batch = toDelete.slice(i, i + 50);
    const delResp = await fetch(`${SUPABASE_URL}/rest/v1/media_videos?id=in.(${batch.join(',')})`, {
      method: 'DELETE', headers: REST_HEADERS,
    });
    if (!delResp.ok) console.error(`DELETE fallita: ${delResp.status} ${await delResp.text()}`);
  }
  console.log(`Fatto: ${toDelete.length} Shorts rimossi.`);
}

main().catch(e => { console.error(e); process.exit(1); });
