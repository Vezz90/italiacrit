'use strict';
// Riprova gli atleti segnati "non trovati su PCS" (pcs_not_found) che hanno uno storico vero su ciclismo.info: il segno era stato messo anche
// per errori temporanei (es. Jonathan Milan, che su PCS esiste: rider/jonathan-milan). Per ogni atleta prova gli slug piu' probabili,
// verifica che sia la stessa persona (nome uguale e, se lo conosciamo, anno di nascita) e salva pcs_slug; il recupero degli anni lo fa poi
// pcs-storico-fill-gaps.js.
//   node pcs-retry-notfound.js [--min-seasons=2] [--limit=N] [--atleta-id=ID1,ID2]
const fs = require('fs');
const path = require('path');
const { launchPcsBrowser, gotoPcsPage, humanDelay } = require('./pcs-browser');
fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8').split('\n').forEach(l => { const m = l.match(/^([^#=\s]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2'); });
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const args = process.argv.slice(2);
const arg = n => (args.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1];
const MIN_SEASONS = parseInt(arg('min-seasons') || '2', 10), LIMIT = parseInt(arg('limit') || '0', 10) || Infinity;
const ONLY = new Set((arg('atleta-id') || '').split(',').filter(Boolean));
const STATE = path.join(__dirname, 'pcs-retry-notfound-state.json');
let state = {}; try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (_) {}
const sb = createClient('https://aqqsstsbgpapzoxllosh.supabase.co', process.env.SUPABASE_SECRET, { realtime: { transport: ws } });
const slugify = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const tokens = s => new Set(slugify(s).split('-').filter(Boolean));

// id atleta = COGNOME_NOME (es. MILAN_JONATHAN, VAN_DER_POEL_MATHIEU): la divisione cognome/nome non e' nota, si provano le piu' probabili
function candidates(id) {
  const tk = slugify(String(id).replace(/_/g, ' ')).split('-').filter(Boolean), out = [];
  const add = s => { if (s && !out.includes(s)) out.push(s); };
  for (let k = 1; k <= Math.min(2, tk.length - 1); k++) {
    const given = tk.slice(tk.length - k), sur = tk.slice(0, tk.length - k);
    add(`${given.join('-')}-${sur.join('-')}`);
    if (k > 1) add(`${given[0]}-${sur.join('-')}`);
  }
  add(`${out[0]}2`);
  return out.slice(0, 5);
}

(async () => {
  const nf = [];
  for (let from = 0; ; from += 1000) {
    const q = await sb.from('entity_overrides').select('entity_id').eq('field', 'pcs_not_found').order('id').range(from, from + 999);
    if (!q.data || !q.data.length) break; nf.push(...q.data.map(x => x.entity_id)); if (q.data.length < 1000) break;
  }
  const have = new Set();
  for (let from = 0; ; from += 1000) {
    const q = await sb.from('entity_overrides').select('entity_id').eq('field', 'pcs_slug').order('id').range(from, from + 999);
    if (!q.data || !q.data.length) break; q.data.forEach(x => have.add(x.entity_id)); if (q.data.length < 1000) break;
  }
  let ids = nf.filter(id => !have.has(id) && (!ONLY.size || ONLY.has(id)));
  // stagioni su ciclismo.info + anno di nascita noto
  const seasons = {};
  for (let i = 0; i < ids.length; i += 100) {
    const ch = ids.slice(i, i + 100), q = await sb.from('ciclismo_results').select('atleta_id, stagione').in('atleta_id', ch);
    for (const x of q.data || []) (seasons[x.atleta_id] = seasons[x.atleta_id] || new Set()).add(x.stagione);
  }
  const birth = {};
  for (let i = 0; i < ids.length; i += 100) {
    const ch = ids.slice(i, i + 100), q = await sb.from('entity_overrides').select('entity_id, new_value').eq('field', 'anno_nascita').in('entity_id', ch);
    for (const x of q.data || []) birth[x.entity_id] = parseInt(x.new_value, 10);
  }
  ids = ids.filter(id => (ONLY.size || (seasons[id] && seasons[id].size >= MIN_SEASONS)) && !(state[id] && Date.now() - state[id] < 30 * 864e5))
    .sort((a, b) => ((seasons[b] || { size: 0 }).size - (seasons[a] || { size: 0 }).size)).slice(0, LIMIT);
  console.log(`Atleti da riprovare: ${ids.length}`);

  let { browser, context, page } = await launchPcsBrowser();
  async function go(url) {
    for (let k = 0; k < 3; k++) {
      if (page.isClosed()) { try { page = await context.newPage(); } catch { try { await browser.close(); } catch {} ({ browser, context, page } = await launchPcsBrowser()); } }
      const n = await gotoPcsPage(page, url);
      if (n.ok || n.notFound) return n;
      await humanDelay(k);
    }
    return { ok: false };
  }
  let found = 0, none = 0;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i], label = id.replace(/_/g, ' ');
    let hit = null;
    for (const slug of candidates(id)) {
      const n = await go(`https://www.procyclingstats.com/rider/${slug}`);
      if (!n.ok) { await humanDelay(i); continue; }
      const info = await page.evaluate(() => ({ h1: (document.querySelector('h1') || {}).innerText || '', txt: document.body.innerText.slice(0, 3000) }));
      const pcsTok = tokens(info.h1), ours = [...tokens(label)];
      const nameOk = ours.length && ours.every(t => pcsTok.has(t) || [...pcsTok].some(p => p.startsWith(t) || t.startsWith(p)));
      const by = (info.txt.match(/Date of birth:\s*\d{1,2}\w*\s+\w+\s+(\d{4})/) || [])[1];
      const birthOk = !birth[id] || !by || Math.abs(parseInt(by, 10) - birth[id]) <= 1;
      if (nameOk && birthOk) { hit = slug; break; }
      await humanDelay(i);
    }
    state[id] = Date.now();
    if (hit) {
      found++;
      await sb.from('entity_overrides').upsert({ entity_type: 'atleta', entity_id: id, field: 'pcs_slug', new_value: hit, edited_by: null }, { onConflict: 'entity_type,entity_id,field' });
      await sb.from('entity_overrides').delete().eq('entity_type', 'atleta').eq('entity_id', id).eq('field', 'pcs_not_found');
      try { const f = path.join(__dirname, 'pcs-span-ids.json'); const cur = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []; if (!cur.includes(id)) { cur.push(id); fs.writeFileSync(f, JSON.stringify(cur)); } } catch (_) {}
      console.log(`(${i + 1}/${ids.length}) ${label} → ${hit} ✓  [trovati ${found}]`);
    } else { none++; console.log(`(${i + 1}/${ids.length}) ${label}: non su PCS`); }
    if (i % 10 === 0) fs.writeFileSync(STATE, JSON.stringify(state));
    await humanDelay(i);
  }
  fs.writeFileSync(STATE, JSON.stringify(state));
  await browser.close().catch(() => {});
  console.log(`\n=== Completato === trovati ${found} · non su PCS ${none}`);
})().catch(e => { console.error('ERRORE FATALE', e); process.exit(1); });
