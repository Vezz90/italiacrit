'use strict';
// Giro una tantum: valorizza published_at per i media_videos già importati
// prima che questa colonna esistesse (import di canali YouTube fatto prima
// del fix), interrogando l'API YouTube in blocco (50 id/chiamata) per la
// data di pubblicazione reale di ciascun video.

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

async function main() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/media_videos?published_at=is.null&url=like.*youtu*&select=id,url`,
    { headers: REST_HEADERS }
  );
  if (!r.ok) throw new Error(`select HTTP ${r.status}: ${await r.text()}`);
  const rows = await r.json();
  console.log(`${rows.length} video senza published_at da recuperare`);
  if (!rows.length) return;

  const byVideoId = new Map(); // videoId -> [row ids]
  for (const row of rows) {
    const m = (row.url || '').match(/[?&]v=([\w-]+)/);
    if (!m) continue;
    const vid = m[1];
    if (!byVideoId.has(vid)) byVideoId.set(vid, []);
    byVideoId.get(vid).push(row.id);
  }
  const videoIds = [...byVideoId.keys()];
  console.log(`${videoIds.length} ID video unici`);

  let updated = 0;
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${batch.join(',')}&key=${YOUTUBE_API_KEY}`;
    const resp = await fetch(url).then(x => x.json());
    if (resp.error) { console.error('YouTube API errore:', resp.error.message); continue; }
    for (const item of (resp.items || [])) {
      const publishedAt = item.snippet?.publishedAt;
      if (!publishedAt) continue;
      const rowIds = byVideoId.get(item.id) || [];
      for (const rowId of rowIds) {
        const patchResp = await fetch(`${SUPABASE_URL}/rest/v1/media_videos?id=eq.${rowId}`, {
          method: 'PATCH',
          headers: REST_HEADERS,
          body: JSON.stringify({ published_at: publishedAt }),
        });
        if (patchResp.ok) updated++;
        else console.error(`PATCH id=${rowId} fallita: ${patchResp.status}`);
      }
    }
    console.log(`Blocco ${i / 50 + 1}: ${resp.items?.length || 0} risposte YouTube`);
  }
  console.log(`Fatto: ${updated} video aggiornati con published_at.`);
}

main().catch(e => { console.error(e); process.exit(1); });
