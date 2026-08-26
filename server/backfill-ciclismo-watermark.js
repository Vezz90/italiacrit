'use strict';
// Giro una tantum: marchia il credit "ciclismo.info" direttamente nel file
// per le foto GIA' importate da ciclismo.info prima che il watermark
// automatico esistesse (vedi il fix in ciclismo-gara-media.js e
// ciclismo-backfill.js) — sia le foto gara (ciclismo_gara_media) sia le
// foto profilo atleta (entity_overrides, photo_credit='ciclismo.info').

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

function storagePathFromUrl(photoUrl) {
  // photo_url salvato come "/photos/<path>" — lo storage path è tutto dopo "/photos/"
  const m = String(photoUrl || '').match(/^\/photos\/(.+)$/);
  return m ? m[1] : null;
}

async function watermarkOne(storagePath) {
  const imgResp = await fetch(`${SUPABASE_URL}/storage/v1/object/public/photos/${storagePath}`);
  if (!imgResp.ok) return { ok: false, status: imgResp.status };
  const buf = Buffer.from(await imgResp.arrayBuffer());
  const watermarked = await watermarkPhoto(buf, 'ciclismo.info');
  const upResp = await fetch(`${SUPABASE_URL}/storage/v1/object/photos/${storagePath}`, {
    method: 'POST',
    headers: { ...REST_HEADERS, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
    body: watermarked,
  });
  if (!upResp.ok) return { ok: false, status: upResp.status, err: await upResp.text() };
  return { ok: true };
}

async function main() {
  let done = 0, failed = 0, skipped = 0;

  // 1) Foto gara (ciclismo_gara_media)
  {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ciclismo_gara_media?photo_url=not.is.null&select=id,photo_url&order=id`, { headers: REST_HEADERS });
    if (!r.ok) throw new Error(`select gara_media HTTP ${r.status}: ${await r.text()}`);
    const rows = await r.json();
    console.log(`${rows.length} foto gara da marchiare`);
    for (const row of rows) {
      const sp = storagePathFromUrl(row.photo_url);
      if (!sp) { skipped++; continue; }
      const res = await watermarkOne(sp);
      if (res.ok) { done++; if (done % 25 === 0) console.log(`  ...gara ${done}/${rows.length}`); }
      else { failed++; console.warn(`  [gara ${row.id}] fallito HTTP ${res.status}`); }
    }
  }

  // 2) Foto profilo atleta (entity_overrides, photo_credit='ciclismo.info')
  {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/entity_overrides?field=eq.photo_url&entity_type=eq.atleta&select=entity_id,new_value`, { headers: REST_HEADERS });
    if (!r.ok) throw new Error(`select entity_overrides HTTP ${r.status}: ${await r.text()}`);
    const photoRows = await r.json();
    const r2 = await fetch(`${SUPABASE_URL}/rest/v1/entity_overrides?field=eq.photo_credit&entity_type=eq.atleta&new_value=eq.ciclismo.info&select=entity_id`, { headers: REST_HEADERS });
    if (!r2.ok) throw new Error(`select credit HTTP ${r2.status}: ${await r2.text()}`);
    const creditIds = new Set((await r2.json()).map(x => x.entity_id));
    const athPhotos = photoRows.filter(p => creditIds.has(p.entity_id) && p.new_value);
    console.log(`${athPhotos.length} foto profilo atleta ciclismo.info da marchiare`);
    for (const row of athPhotos) {
      const sp = storagePathFromUrl(row.new_value);
      if (!sp) { skipped++; continue; }
      const res = await watermarkOne(sp);
      if (res.ok) { done++; if (done % 25 === 0) console.log(`  ...atleta ${done}`); }
      else { failed++; console.warn(`  [${row.entity_id}] fallito HTTP ${res.status}`); }
    }
  }

  console.log(`\nFatto: ${done} marchiate, ${failed} fallite, ${skipped} saltate (url non riconosciuto).`);
}

main().catch(e => { console.error(e); process.exit(1); });
