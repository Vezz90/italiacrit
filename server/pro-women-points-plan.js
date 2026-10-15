'use strict';
// Anteprima (nessuna scrittura): quali atlete italiane prenderebbero punti nelle gare pro FEMMINILI 1.1/2.1/1.Pro/2.Pro (non Women's WorldTour).
// Punti = tabella base del sito (1°=15 ... 10°=1) x moltiplicatore (--mult, default 3, come le gare internazionali).
//   node pro-women-points-plan.js [--season=2026] [--mult=3]
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8').split('\n').forEach(l => { const m = l.match(/^([^#=\s]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2'); });
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const args = process.argv.slice(2);
const arg = n => (args.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1];
const SEASON = parseInt(arg('season') || new Date().getFullYear(), 10), MULT = parseInt(arg('mult') || '3', 10);
const BASE = { 1: 15, 2: 12, 3: 10, 4: 8, 5: 6, 6: 5, 7: 4, 8: 3, 9: 2, 10: 1 };
const sb = createClient('https://aqqsstsbgpapzoxllosh.supabase.co', process.env.SUPABASE_SECRET, { realtime: { transport: ws } });
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

(async () => {
  const athletes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'athletes.json'), 'utf8'));
  const { data: races } = await sb.from('pro_races').select('pcs_race_slug, season, nome, data_start, data_end, classe, circuit, is_gc, parent_slug')
    .eq('season', SEASON).in('circuit', [24, 16]).order('data_start');
  const eligible = (races || []).filter(r => !/WWT/.test(r.classe) && !r.parent_slug);
  console.log(`Gare femminili pro ${SEASON} (escluse Women's WorldTour): ${eligible.length}\n`);
  let tot = 0;
  for (const r of eligible) {
    const { data: rows } = await sb.from('pcs_race_full_results').select('posizione, atleta_id, nome_completo, team').eq('pcs_race_slug', r.pcs_race_slug).eq('season', SEASON).not('posizione', 'is', null).order('posizione').limit(400);
    const seen = new Set(), ita = [];
    for (const x of rows || []) {
      let id = x.atleta_id;
      if (!id) { const w = x.nome_completo.trim().split(/\s+/), up = w.filter(t => t.length > 1 && t === t.toUpperCase()), lo = w.filter(t => !up.includes(t)); id = up.length && lo.length ? `${norm(up.join(' '))}_${norm(lo.join(' '))}` : null; }
      if (!id || !athletes[id] || athletes[id].genere === 'M' || seen.has(id)) continue;
      seen.add(id);
      ita.push({ id, pos: x.posizione, pts: (BASE[x.posizione] || 0) * MULT, nome: x.nome_completo, team: x.team });
    }
    console.log(`${r.data_start} ${r.classe.padEnd(5)} ${r.nome}: ${ita.length} atlete in archivio nei primi ${rows.length}`);
    for (const a of ita.slice(0, 8)) console.log(`     ${String(a.pos).padStart(3)}°  ${a.nome.padEnd(28)} ${a.pts ? a.pts + ' pt' : 'fuori dai primi 10 (0 pt)'}`);
    tot += ita.filter(a => a.pts).length;
  }
  console.log(`\nTotale piazzamenti a punti: ${tot}`);
})().catch(e => { console.error(e); process.exit(1); });
