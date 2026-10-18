'use strict';
// Elenco dei profili con anni vuoti in mezzo alla carriera (solo database, nessun accesso a PCS), ordinato per priorita:
// piu anni mancanti per primi. Stato: con slug (il recupero li riempie) / segnato "non su PCS" / senza slug.
//   node audit-buchi-profili.js  ->  audit-buchi-profili.csv
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8').split('\n').forEach(l => { const m = l.match(/^([^#=\s]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2'); });
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const sb = createClient('https://aqqsstsbgpapzoxllosh.supabase.co', process.env.SUPABASE_SECRET, { realtime: { transport: ws } });
async function scan(t, sel, fn) { for (let last = 0, fails = 0; ;) { const q = await sb.from(t).select('id,' + sel).gt('id', last).order('id').limit(1000); if (q.error) { if (++fails > 5) throw q.error; await new Promise(r => setTimeout(r, 2000)); continue; } fails = 0; if (!q.data.length) break; q.data.forEach(fn); last = q.data[q.data.length - 1].id; if (q.data.length < 1000) break; } }
(async () => {
  const years = new Map();
  const add = (id, y) => { if (!id || !y) return; (years.get(id) || years.set(id, new Set()).get(id)).add(y); };
  await scan('ciclismo_results', 'atleta_id,stagione', x => /^\d{4}$/.test(x.stagione) && add(x.atleta_id, +x.stagione));
  await scan('pcs_results', 'atleta_id,season', x => add(x.atleta_id, x.season));
  const ov = new Map();
  for (let from = 0; ; from += 1000) { const q = await sb.from('entity_overrides').select('entity_id,field,new_value').eq('entity_type', 'atleta').in('field', ['pcs_slug', 'pcs_not_found']).order('id').range(from, from + 999); (q.data || []).forEach(x => { const o = ov.get(x.entity_id) || ov.set(x.entity_id, {}).get(x.entity_id); if (x.field === 'pcs_slug') o.slug = x.new_value; else o.nf = true; }); if (!q.data || q.data.length < 1000) break; }
  const span = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'pcs-span-ids.json'), 'utf8')));
  const rows = [];
  for (const [id, set] of years) {
    const ys = [...set].sort((a, b) => a - b), mn = ys[0], mx = ys[ys.length - 1], miss = [];
    for (let y = mn; y <= mx; y++) if (!set.has(y)) miss.push(y);
    if (!miss.length) continue;
    const o = ov.get(id) || {};
    rows.push({ id, mn, mx, n: miss.length, miss: miss.join(' '), stato: o.slug ? 'con slug' : o.nf ? 'non su PCS' : 'senza slug', coda: span.has(id) ? 'si' : 'no' });
  }
  rows.sort((a, b) => b.n - a.n);
  fs.writeFileSync(path.join(__dirname, 'audit-buchi-profili.csv'), 'atleta;da;a;anni_mancanti;quali;stato;in_coda_recupero\n' + rows.map(r => [r.id, r.mn, r.mx, r.n, r.miss, r.stato, r.coda].join(';')).join('\n'));
  const by = {}; rows.forEach(r => { const k = r.stato + (r.coda === 'si' ? ' · in coda' : ' · NON in coda'); by[k] = (by[k] || 0) + 1; });
  console.log('profili con buchi:', rows.length); console.log(by);
  console.log('primi 10:', rows.slice(0, 10).map(r => `${r.id} ${r.n} anni [${r.stato}]`).join(' | '));
})().catch(e => { console.error(e); process.exit(1); });
