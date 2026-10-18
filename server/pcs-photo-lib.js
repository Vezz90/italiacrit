'use strict';
// Logica condivisa per aggiornare la foto profilo da PCS (usata da pcs-photo-refresh.js e dal recupero degli anni).
// Regola: foto importata da PCS -> si aggiorna quando PCS cambia immagine; nessuna foto -> si aggiunge quella di PCS;
// foto caricata a mano (o da altri script) -> resta, FINO a quando PCS pubblica una foto di un anno piu recente (il nome del file PCS
// contiene l'anno, es. christian-scaroni-2026.jpeg) di quello in cui e stata caricata la nostra.
const crypto = require('crypto');
const PUB = 'https://aqqsstsbgpapzoxllosh.supabase.co/storage/v1/object/public';
const sha = b => crypto.createHash('sha1').update(b).digest('hex');

async function overridesByField(sb, field) {
  const m = new Map();
  for (let from = 0; ; from += 1000) {
    const q = await sb.from('entity_overrides').select('entity_id,new_value,edited_by,created_at').eq('entity_type', 'atleta').eq('field', field).order('id').range(from, from + 999);
    if (q.error) throw q.error;
    q.data.forEach(x => m.set(x.entity_id, x));
    if (q.data.length < 1000) break;
  }
  return m;
}

// carica una volta sola le foto attuali e le sorgenti gia viste
async function createPhotoRefresher(sb, opts = {}) {
  const photos = await overridesByField(sb, 'photo_url'), srcs = await overridesByField(sb, 'photo_src');
  const thisYear = new Date().getFullYear(), seen = new Set(), stats = { changed: 0, added: 0, same: 0, none: 0 };

  // classifica l'atleta
  function classify(id) {
    const p = photos.get(id), v = p && p.new_value ? String(p.new_value) : '';
    if (!v) return { kind: 'none', url: null };
    if (v.startsWith('/photos/atletas/pcs/')) return { kind: 'pcs', url: v };
    const y = new Date(p.created_at).getFullYear();
    return { kind: 'other', url: v, year: y, manual: !!p.edited_by, skip: y >= thisYear };   // del 2026: non puo essere superata da PCS
  }

  // page: pagina PCS di quell'atleta GIA CARICATA (profilo o un suo anno). Ritorna 'changed'|'added'|'same'|'none'|'skip'
  async function check(page, id, slug) {
    if (seen.has(id)) return 'skip'; seen.add(id);
    const a = classify(id);
    if (a.skip) return 'skip';
    const imgSrc = await page.evaluate(() => {
      const img = [...document.querySelectorAll('img')].find(x => x.src && x.src.includes('/images/riders/'));
      if (img) return img.src || img.dataset.src || null;
      const lazy = document.querySelector('[data-src*="/images/riders/"]');
      return lazy ? lazy.dataset.src : null;
    }).catch(() => null);
    if (!imgSrc) { stats.none++; return 'none'; }
    const pcsYear = parseInt((imgSrc.match(/-(\d{4})\.(?:jpe?g|png)/) || [])[1], 10);
    const prevSrc = srcs.get(id) && srcs.get(id).new_value;
    if (a.kind === 'other' && !(pcsYear > a.year)) { stats.same++; return 'same'; }   // la nostra e piu recente o pari: resta la nostra
    if (a.kind === 'pcs' && prevSrc === imgSrc) { stats.same++; return 'same'; }
    const bytes = await page.evaluate(async u => { try { const r = await fetch(u, { credentials: 'include' }); if (!r.ok) return null; return Array.from(new Uint8Array(await r.arrayBuffer())); } catch { return null; } }, imgSrc).catch(() => null);
    const buf = bytes && bytes.length >= 1000 ? Buffer.from(bytes) : null;
    if (!buf || !((buf[0] === 0xFF && buf[1] === 0xD8) || (buf[0] === 0x89 && buf[1] === 0x50))) { stats.none++; return 'none'; }
    if (a.kind === 'pcs' && a.url) {   // se e identica a quella che abbiamo, si ricorda solo la sorgente
      try { const r = await fetch(`${PUB}${a.url.split('?')[0]}`); if (r.ok && sha(Buffer.from(await r.arrayBuffer())) === sha(buf)) {
        if (!opts.dry) await sb.from('entity_overrides').upsert({ entity_type: 'atleta', entity_id: id, field: 'photo_src', new_value: imgSrc, edited_by: null }, { onConflict: 'entity_type,entity_id,field' });
        srcs.set(id, { new_value: imgSrc }); stats.same++; return 'same';
      } } catch (_) {}
    }
    const ext = buf[0] === 0x89 ? 'png' : 'jpeg', storagePath = `atletas/pcs/${slug}.${ext}`, url = `/photos/${storagePath}?v=${sha(buf).slice(0, 8)}`;
    if (opts.dry) { console.log(`  [DRY] ${id}: ${a.kind === 'other' ? `foto PCS ${pcsYear} al posto della nostra ${a.year}` : a.url ? 'foto cambiata' : 'foto nuova'}`); return a.url ? 'changed' : 'added'; }
    const up = await sb.storage.from('photos').upload(storagePath, buf, { contentType: `image/${ext}`, upsert: true });
    if (up.error) { console.log(`  ERRORE upload foto ${id}: ${up.error.message}`); return 'none'; }
    await sb.from('entity_overrides').upsert([
      { entity_type: 'atleta', entity_id: id, field: 'photo_url', new_value: url, edited_by: null },
      { entity_type: 'atleta', entity_id: id, field: 'photo_src', new_value: imgSrc, edited_by: null },
    ], { onConflict: 'entity_type,entity_id,field' });
    srcs.set(id, { new_value: imgSrc }); photos.set(id, { new_value: url, created_at: new Date().toISOString() });
    const r = a.url ? 'changed' : 'added'; stats[r]++;
    console.log(`  foto ${id}: ${a.kind === 'other' ? `di PCS (${pcsYear}) al posto della nostra del ${a.year}${a.manual ? ' caricata a mano' : ''}` : r === 'changed' ? 'aggiornata' : 'aggiunta'}`);
    return r;
  }
  return { check, classify, stats, size: photos.size };
}

module.exports = { createPhotoRefresher };
