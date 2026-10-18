'use strict';
// Aggiorna la foto profilo con l'ULTIMA presente su PCS (logica in pcs-photo-lib.js, la stessa usata dal recupero degli anni).
// Regola: foto importata da PCS -> si aggiorna se PCS cambia immagine; nessuna foto -> si aggiunge; foto caricata a mano (o da altri script)
// -> resta, FINO a quando PCS pubblica una foto di un anno piu recente di quello in cui abbiamo caricato la nostra.
// Una richiesta a PCS per atleta; ogni atleta si ricontrolla al massimo ogni --days giorni (default 90).
//   node pcs-photo-refresh.js [--limit=N] [--days=90] [--atleta-id=X] [--dry]
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8').split('\n').forEach(l => { const m = l.match(/^([^#=\s]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2'); });
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const { launchPcsBrowser, gotoPcsPage, humanDelay } = require('./pcs-browser');
const { createPhotoRefresher } = require('./pcs-photo-lib');
const args = process.argv.slice(2);
const arg = n => (args.find(a => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=');
const LIMIT = parseInt(arg('limit') || '0', 10) || Infinity, DAYS = parseInt(arg('days') || '90', 10), ONLY = arg('atleta-id'), DRY = args.includes('--dry');
const STATE = path.join(__dirname, 'pcs-photo-refresh-state.json');
let state = {}; try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (_) {}
const sb = createClient('https://aqqsstsbgpapzoxllosh.supabase.co', process.env.SUPABASE_SECRET, { realtime: { transport: ws } });

(async () => {
  const photo = await createPhotoRefresher(sb, { dry: DRY });
  const slugs = new Map();
  for (let from = 0; ; from += 1000) {
    const q = await sb.from('entity_overrides').select('entity_id,new_value').eq('entity_type', 'atleta').eq('field', 'pcs_slug').order('id').range(from, from + 999);
    if (q.error) throw q.error;
    q.data.forEach(x => slugs.set(x.entity_id, x.new_value));
    if (q.data.length < 1000) break;
  }
  const limitT = Date.now() - DAYS * 864e5;
  let list = [...slugs.entries()].map(([id, slug]) => ({ id, slug })).filter(a => !photo.classify(a.id).skip && !(state[a.id] && state[a.id] > limitT) && (!ONLY || a.id === ONLY));
  const kinds = list.reduce((m, x) => { const k = photo.classify(x.id).kind; m[k] = (m[k] || 0) + 1; return m; }, {});
  console.log('da controllare per tipo:', JSON.stringify(kinds), '· in totale', list.length);
  list = list.slice(0, LIMIT);

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
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const n = await go(`https://www.procyclingstats.com/rider/${a.slug}`);
    if (n.ok) { try { await photo.check(page, a.id, a.slug); } catch (e) { console.log(`  errore foto ${a.id}: ${e.message}`); } }
    state[a.id] = Date.now();
    if (i % 10 === 0) fs.writeFileSync(STATE, JSON.stringify(state));
    if ((i + 1) % 25 === 0) console.log(`(${i + 1}/${list.length})`, JSON.stringify(photo.stats));
    await humanDelay(i);
  }
  fs.writeFileSync(STATE, JSON.stringify(state));
  await browser.close().catch(() => {});
  console.log('\n=== Completato ===', JSON.stringify(photo.stats));
})().catch(e => { console.error('ERRORE FATALE', e); process.exit(1); });
