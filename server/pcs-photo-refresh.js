'use strict';
// Aggiorna la foto profilo con l'ULTIMA presente su PCS, senza toccare quelle caricate a mano.
// Regola: foto importate da PCS e assenza di foto si aggiornano sempre; una foto caricata a mano (o da altri script) resta, FINO a quando PCS
// pubblica una foto di un anno piu recente di quello in cui abbiamo caricato la nostra.
// Per ogni atleta: 1 richiesta alla pagina PCS; se l'immagine e la stessa gia vista (photo_src) non fa altro; se e cambiata
// la scarica, la confronta con quella che abbiamo e, solo se diversa, la carica (con ?v=<hash> per non restare in cache).
//   node pcs-photo-refresh.js [--limit=N] [--days=90] [--atleta-id=X] [--dry]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8').split('\n').forEach(l => { const m = l.match(/^([^#=\s]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2'); });
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const { launchPcsBrowser, gotoPcsPage, humanDelay } = require('./pcs-browser');
const args = process.argv.slice(2);
const arg = n => (args.find(a => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=');
const LIMIT = parseInt(arg('limit') || '0', 10) || Infinity, DAYS = parseInt(arg('days') || '90', 10), ONLY = arg('atleta-id'), DRY = args.includes('--dry');
const PUB = 'https://aqqsstsbgpapzoxllosh.supabase.co/storage/v1/object/public';
const STATE = path.join(__dirname, 'pcs-photo-refresh-state.json');
let state = {}; try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (_) {}
const sb = createClient('https://aqqsstsbgpapzoxllosh.supabase.co', process.env.SUPABASE_SECRET, { realtime: { transport: ws } });
const sha = b => crypto.createHash('sha1').update(b).digest('hex');

async function overridesByField(field) {
  const m = new Map();
  for (let from = 0; ; from += 1000) {
    const q = await sb.from('entity_overrides').select('entity_id,new_value,edited_by,created_at').eq('entity_type', 'atleta').eq('field', field).order('id').range(from, from + 999);
    if (q.error) throw q.error;
    q.data.forEach(x => m.set(x.entity_id, x));
    if (q.data.length < 1000) break;
  }
  return m;
}

(async () => {
  const slugs = await overridesByField('pcs_slug'), photos = await overridesByField('photo_url'), srcs = await overridesByField('photo_src');
  // atleti con slug PCS. Tre casi:
  //  - 'pcs'   foto importata da PCS (/photos/atletas/pcs/...): si aggiorna ogni volta che PCS cambia immagine;
  //  - 'none'  nessuna foto: si aggiunge quella di PCS;
  //  - 'other' foto caricata a mano (o da altri script): vince lei, FINO a quando PCS pubblica una foto di un anno piu recente
  //            dell'anno in cui e stata caricata la nostra (il nome del file PCS contiene l'anno: es. christian-scaroni-2026.jpeg).
  //            Se la nostra e dell'anno in corso, PCS non puo essere piu recente: non si controlla nemmeno (nessuna richiesta sprecata).
  const thisYear = new Date().getFullYear();
  let list = [];
  for (const [id, sl] of slugs) {
    const p = photos.get(id), v = p && p.new_value ? String(p.new_value) : '';
    const base = { id, slug: sl.new_value, url: v || null, src: srcs.get(id) && srcs.get(id).new_value };
    if (!v) list.push({ ...base, kind: 'none' });
    else if (v.startsWith('/photos/atletas/pcs/')) list.push({ ...base, kind: 'pcs' });
    else {
      const y = new Date(p.created_at).getFullYear();
      if (y < thisYear) list.push({ ...base, kind: 'other', year: y, manual: !!p.edited_by });
    }
  }
  if (ONLY) list = list.filter(x => x.id === ONLY);
  const limitT = Date.now() - DAYS * 864e5;
  list = list.filter(x => !(state[x.id] && state[x.id] > limitT));
  // prima chi e attivo di recente (e quindi cambia foto piu spesso): l'ordine dei nostri id piu recenti non e noto, si usa l'elenco attivi 2026 se presente
  let active = new Set(); try { active = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'pcs-active-2026.json'), 'utf8'))); } catch (_) {}
  list.sort((a, b) => (active.has(b.id) ? 1 : 0) - (active.has(a.id) ? 1 : 0));
  list = list.slice(0, LIMIT);
  const kinds = list.reduce((m, x) => (m[x.kind] = (m[x.kind] || 0) + 1, m), {});
  console.log('per tipo:', JSON.stringify(kinds));
  console.log(`foto PCS da controllare: ${list.length} (gia controllati negli ultimi ${DAYS} giorni: esclusi)`);

  let { browser, context, page } = await launchPcsBrowser();
  async function go(url) {
    for (let k = 0; k < 3; k++) {
      if (page.isClosed()) { try { page = await context.newPage(); } catch { try { await browser.close(); } catch {} ({ browser, context, page } = await launchPcsBrowser()); } }
      const n = await gotoPcsPage(page, url, {});
      if (n.ok || n.notFound) return n;
      await humanDelay(k);
    }
    return { ok: false };
  }
  let changed = 0, same = 0, none = 0, added = 0;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const n = await go(`https://www.procyclingstats.com/rider/${a.slug}`);
    if (!n.ok) { state[a.id] = Date.now(); await humanDelay(i); continue; }
    const imgSrc = await page.evaluate(() => {
      const img = [...document.querySelectorAll('img')].find(x => x.src && x.src.includes('/images/riders/'));
      if (img) return img.src || img.dataset.src || null;
      const lazy = document.querySelector('[data-src*="/images/riders/"]');
      return lazy ? lazy.dataset.src : null;
    }).catch(() => null);
    state[a.id] = Date.now();
    const pcsYear = imgSrc ? parseInt((imgSrc.match(/-(\d{4})\.(?:jpe?g|png)/) || [])[1], 10) : NaN;
    if (!imgSrc) { none++; }
    else if (a.kind === 'other' && !(pcsYear > a.year)) { same++; }   // la nostra e piu recente (o pari) della foto PCS: resta la nostra
    else if (a.kind === 'pcs' && a.src === imgSrc && a.url) { same++; }
    else {
      const bytes = await page.evaluate(async u => { try { const r = await fetch(u, { credentials: 'include' }); if (!r.ok) return null; return Array.from(new Uint8Array(await r.arrayBuffer())); } catch { return null; } }, imgSrc).catch(() => null);
      const buf = bytes && bytes.length >= 1000 ? Buffer.from(bytes) : null;
      const ok = buf && ((buf[0] === 0xFF && buf[1] === 0xD8) || (buf[0] === 0x89 && buf[1] === 0x50));
      if (!ok) { none++; }
      else {
        let identical = false;
        if (a.url && a.kind === 'pcs') { try { const r = await fetch(`${PUB}${String(a.url).split('?')[0]}`); if (r.ok) identical = sha(Buffer.from(await r.arrayBuffer())) === sha(buf); } catch (_) {} }
        const ext = buf[0] === 0x89 ? 'png' : 'jpeg';
        if (identical) { same++; if (!DRY) await sb.from('entity_overrides').upsert({ entity_type: 'atleta', entity_id: a.id, field: 'photo_src', new_value: imgSrc, edited_by: null }, { onConflict: 'entity_type,entity_id,field' }); }
        else if (DRY) { console.log(`  [DRY] ${a.id}: foto ${a.kind === 'other' ? `PCS ${pcsYear} al posto della nostra ${a.year}` : a.url ? 'cambiata' : 'nuova'}`); a.url ? changed++ : added++; }
        else {
          const storagePath = `atletas/pcs/${a.slug}.${ext}`;
          const up = await sb.storage.from('photos').upload(storagePath, buf, { contentType: `image/${ext}`, upsert: true });
          if (up.error) console.log(`  ERRORE upload ${a.id}: ${up.error.message}`);
          else {
            await sb.from('entity_overrides').upsert([
              { entity_type: 'atleta', entity_id: a.id, field: 'photo_url', new_value: `/photos/${storagePath}?v=${sha(buf).slice(0, 8)}`, edited_by: null },
              { entity_type: 'atleta', entity_id: a.id, field: 'photo_src', new_value: imgSrc, edited_by: null },
            ], { onConflict: 'entity_type,entity_id,field' });
            a.url ? changed++ : added++;
            console.log(`  ${a.id}: foto ${a.kind === 'other' ? `di PCS (${pcsYear}) al posto della nostra del ${a.year}${a.manual ? ' caricata a mano' : ''}` : a.url ? 'aggiornata' : 'aggiunta'}`);
          }
        }
      }
    }
    if (i % 10 === 0) fs.writeFileSync(STATE, JSON.stringify(state));
    if ((i + 1) % 25 === 0) console.log(`(${i + 1}/${list.length}) aggiornate ${changed} · nuove ${added} · invariate ${same} · senza foto su PCS ${none}`);
    await humanDelay(i);
  }
  fs.writeFileSync(STATE, JSON.stringify(state));
  await browser.close().catch(() => {});
  console.log(`\n=== Completato === aggiornate ${changed} · nuove ${added} · invariate ${same} · senza foto su PCS ${none}`);
})().catch(e => { console.error('ERRORE FATALE', e); process.exit(1); });
