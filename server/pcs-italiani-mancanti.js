'use strict';
// Italiani presenti oggi nella classifica PCS (uomini e donne) che NON abbiamo come atleti: ne' collegati per slug, ne' per nome.
// Legge server/pcs-nation-riders.json (da pcs-harvest-slugs.js) e scrive server/pcs-italiani-mancanti.csv. Nessuna scrittura sul database.
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8').split('\n').forEach(l => { const m = l.match(/^([^#=\s]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2'); });
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const sb = createClient('https://aqqsstsbgpapzoxllosh.supabase.co', process.env.SUPABASE_SECRET, { realtime: { transport: ws } });
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/['’`]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
const key = tokens => tokens.slice().sort().join(' ');

(async () => {
  const riders = JSON.parse(fs.readFileSync(path.join(__dirname, 'pcs-nation-riders.json'), 'utf8'));
  const cur = Object.entries(riders).filter(([, v]) => v.years && (v.years['2026'] != null));
  const slugs = new Set();
  for (let from = 0; ; from += 1000) {
    const q = await sb.from('entity_overrides').select('new_value').eq('field', 'pcs_slug').order('id').range(from, from + 999);
    if (!q.data || !q.data.length) break; q.data.forEach(x => slugs.add(x.new_value)); if (q.data.length < 1000) break;
  }
  // tutti gli id atleta che conosciamo (ciclismo.info + circuito) come insieme di parole, per riconoscere lo stesso nome scritto in ordine diverso
  const ids = new Set();
  for (const k of Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'athletes.json'), 'utf8')))) ids.add(key(norm(k.replace(/_/g, ' ')).split(' ')));
  for (let lastId = 0, fails = 0; ;) {
    const q = await sb.from('ciclismo_results').select('id, atleta_id').gt('id', lastId).order('id').limit(1000);
    if (q.error) { if (++fails > 5) throw q.error; await new Promise(r => setTimeout(r, 2000)); continue; }
    fails = 0;
    if (!q.data.length) break;
    q.data.forEach(x => x.atleta_id && ids.add(key(norm(x.atleta_id.replace(/_/g, ' ')).split(' '))));
    lastId = q.data[q.data.length - 1].id;
    if (q.data.length < 1000) break;
  }
  const missing = [], linked = [];
  for (const [slug, v] of cur) {
    if (slugs.has(slug)) { linked.push(slug); continue; }
    const nameKey = key(norm(v.name).split(' '));
    if (ids.has(nameKey)) { linked.push(slug); continue; }
    missing.push({ slug, name: v.name, gender: v.gender === 'we' ? 'Donne' : 'Uomini', team: v.team || '', punti: v.years['2026'] });
  }
  missing.sort((a, b) => b.punti - a.punti);
  const csv = 'nome;sesso;squadra;punti;slug_pcs\n' + missing.map(m => [m.name, m.gender, m.team, m.punti, m.slug].join(';')).join('\n');
  fs.writeFileSync(path.join(__dirname, 'pcs-italiani-mancanti.csv'), csv);
  console.log(`In classifica PCS oggi: ${cur.length} italiani · gia' da noi: ${linked.length} · mancanti: ${missing.length}`);
  console.log(`Uomini ${missing.filter(m => m.gender === 'Uomini').length} · Donne ${missing.filter(m => m.gender === 'Donne').length}`);
})().catch(e => { console.error(e); process.exit(1); });
