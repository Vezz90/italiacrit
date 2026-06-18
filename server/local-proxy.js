'use strict';
/**
 * Proxy locale per import foto PCS.
 * Il browser scarica le immagini da PCS (bypassa Cloudflare),
 * le invia qui, e questo server le carica su Supabase con la service key.
 *
 * Uso:
 *   $env:SUPABASE_SECRET = "la-tua-service-role-key"
 *   node local-proxy.js
 */

const http   = require('http');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL    = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta $env:SUPABASE_SECRET'); process.exit(1); }

const ws = require('ws');
const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });
const PORT = 3999;
let stats = { done: 0, skip: 0, err: 0 };

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Slug, X-AtletaId');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET /existing — lista atleti che hanno già la foto
  if (req.method === 'GET' && req.url === '/existing') {
    const { data, error } = await sb.from('entity_overrides')
      .select('entity_id')
      .eq('entity_type', 'atleta')
      .eq('field', 'photo_url')
      .not('new_value', 'is', null)
      .limit(5000);
    if (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data || []));
    return;
  }

  // GET /stats — stato corrente
  if (req.method === 'GET' && req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
    return;
  }

  // POST /upload — riceve immagine JPEG grezza, carica su Supabase
  if (req.method === 'POST' && req.url === '/upload') {
    const slug      = req.headers['x-slug'];
    const atletaId  = req.headers['x-atletaid'];
    if (!slug || !atletaId) { res.writeHead(400); res.end('slug/atletaid mancanti'); return; }

    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const buf = Buffer.concat(chunks);
      try {
        const { error: upErr } = await sb.storage.from('photos')
          .upload(`pcs/${slug}.jpeg`, buf, { contentType: 'image/jpeg', upsert: true });
        if (upErr) throw new Error(upErr.message);

        const { error: dbErr } = await sb.from('entity_overrides').upsert({
          entity_type: 'atleta',
          entity_id:   atletaId,
          field:       'photo_url',
          new_value:   `/pcs/${slug}.jpeg`,
          edited_by:   null,
        }, { onConflict: 'entity_type,entity_id,field' });
        if (dbErr) throw new Error(dbErr.message);

        stats.done++;
        console.log(`✓ ${slug} (tot: ${stats.done})`);
        res.writeHead(200); res.end('ok');
      } catch (e) {
        stats.err++;
        console.error(`✗ ${slug}: ${e.message}`);
        res.writeHead(500); res.end(e.message);
      }
    });
    return;
  }

  res.writeHead(404); res.end();
}).listen(PORT, () => {
  console.log(`Proxy in ascolto su http://localhost:${PORT}`);
  console.log('Ora esegui lo script nel browser su procyclingstats.com');
});
