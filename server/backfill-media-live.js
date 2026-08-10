'use strict';
// Giro una tantum: rileva quali video Media Video già importati sono/sono
// stati trasmessi in diretta (liveStreamingDetails via API YouTube ufficiale)
// e valorizza is_live/live_ended/scheduled_start retroattivamente, così le
// dirette già fatte dai creator prima di questo fix vengono comunque
// riconosciute dal nuovo sistema.

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
  Prefer: 'return=representation',
};

async function main() {
  let all = []; let offset = 0;
  while (true) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/media_videos?select=id,url&url=like.*youtu*&order=id&offset=${offset}&limit=1000`, { headers: REST_HEADERS });
    const page = await r.json();
    all = all.concat(page);
    if (page.length < 1000) break;
    offset += 1000;
  }
  console.log(`${all.length} video YouTube da controllare per stato diretta`);

  const byVideoId = new Map();
  for (const row of all) {
    const m = (row.url || '').match(/[?&]v=([\w-]+)/);
    if (!m) continue;
    const vid = m[1];
    if (!byVideoId.has(vid)) byVideoId.set(vid, []);
    byVideoId.get(vid).push(row.id);
  }
  const videoIds = [...byVideoId.keys()];

  let marked = 0, endedMarked = 0;
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${batch.join(',')}&key=${YOUTUBE_API_KEY}`;
    const resp = await fetch(url).then(x => x.json());
    if (resp.error) { console.error('YouTube API errore:', resp.error.message); continue; }
    for (const item of (resp.items || [])) {
      const lsd = item.liveStreamingDetails;
      if (!lsd) continue; // non è mai stato un video da diretta
      const isLiveNow = !!(lsd.actualStartTime && !lsd.actualEndTime);
      const patch = { is_live: true, live_ended: !isLiveNow, scheduled_start: lsd.scheduledStartTime || null };
      const rowIds = byVideoId.get(item.id) || [];
      for (const rowId of rowIds) {
        const patchResp = await fetch(`${SUPABASE_URL}/rest/v1/media_videos?id=eq.${rowId}`, {
          method: 'PATCH', headers: REST_HEADERS, body: JSON.stringify(patch),
        });
        if (patchResp.ok) { marked++; if (patch.live_ended) endedMarked++; }
        else console.error(`PATCH id=${rowId} fallita: ${patchResp.status}`);
      }
    }
  }
  console.log(`Fatto: ${marked} video segnati come dirette (${endedMarked} già concluse, ${marked - endedMarked} ancora "in corso" secondo YouTube).`);
}

main().catch(e => { console.error(e); process.exit(1); });
