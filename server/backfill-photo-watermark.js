'use strict';
// Giro una tantum: marchia il credit direttamente nel file per le foto gara
// GIA' approvate prima che il watermark automatico esistesse (vedi
// _watermarkPhoto in server.js, applicato solo ai NUOVI caricamenti da quel
// momento in poi) — scarica ogni foto, ci disegna sopra lo stesso overlay,
// e la ricarica sullo stesso filename (upsert).

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

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
if (!SUPABASE_SECRET) { console.error('Imposta SUPABASE_SECRET in server/.env.local'); process.exit(1); }

const REST_HEADERS = { apikey: SUPABASE_SECRET, Authorization: `Bearer ${SUPABASE_SECRET}` };

const _ogEsc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function watermarkPhoto(buffer, text) {
  const img = sharp(buffer);
  const meta = await img.metadata();
  const W = meta.width || 1200, H = meta.height || 800;
  const fs2 = Math.max(14, Math.round(W * 0.022));
  const pad = Math.round(fs2 * 0.9);
  const label = `© ${text} · italiacyclingstats.com`;
  const boxW = Math.min(W - pad, Math.round(label.length * fs2 * 0.56) + pad * 2);
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${W - boxW - pad}" y="${H - fs2 - pad * 2}" width="${boxW}" height="${fs2 + pad}" rx="4" fill="rgba(0,0,0,0.45)"/>
    <text x="${W - pad - boxW / 2}" y="${H - pad - fs2 * 0.28}" font-family="Arial,Helvetica,sans-serif" font-size="${fs2}" font-weight="600" fill="rgba(255,255,255,0.92)" text-anchor="middle">${_ogEsc(label)}</text>
  </svg>`;
  return await img.composite([{ input: Buffer.from(svg), left: 0, top: 0 }]).jpeg({ quality: 90 }).toBuffer();
}

async function main() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/race_photos?status=eq.approved&select=id,filename,photographer,display_name&order=id`, { headers: REST_HEADERS });
  if (!r.ok) throw new Error(`select HTTP ${r.status}: ${await r.text()}`);
  const rows = await r.json();
  console.log(`${rows.length} foto approvate da marchiare`);

  let done = 0, failed = 0;
  for (const row of rows) {
    const credit = (row.photographer || '').trim() || (row.display_name || '').trim();
    if (!credit || !row.filename) { continue; }
    try {
      const imgResp = await fetch(`${SUPABASE_URL}/storage/v1/object/public/photos/${encodeURIComponent(row.filename)}`);
      if (!imgResp.ok) { console.warn(`  [${row.id}] download fallito HTTP ${imgResp.status}`); failed++; continue; }
      const buf = Buffer.from(await imgResp.arrayBuffer());
      const watermarked = await watermarkPhoto(buf, credit);
      const upResp = await fetch(`${SUPABASE_URL}/storage/v1/object/photos/${encodeURIComponent(row.filename)}`, {
        method: 'POST',
        headers: { ...REST_HEADERS, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
        body: watermarked,
      });
      if (!upResp.ok) { console.warn(`  [${row.id}] upload fallito HTTP ${upResp.status}: ${await upResp.text()}`); failed++; continue; }
      done++;
      if (done % 25 === 0) console.log(`  ...${done}/${rows.length}`);
    } catch (e) { console.warn(`  [${row.id}] errore:`, e.message); failed++; }
  }
  console.log(`Fatto: ${done} marchiate, ${failed} fallite.`);
}

main().catch(e => { console.error(e); process.exit(1); });
