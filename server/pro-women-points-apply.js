'use strict';
// Assegna i punti ICS alle atlete ITALIANE presenti in archivio nelle gare femminili pro 1.1/2.1/1.Pro/2.Pro (NON Women's WorldTour):
// punti = tabella base (1°=15 ... 10°=1) x moltiplicatore (default 3, "internazionale"). Scrive in manual_results (come gli altri inserimenti a mano)
// con regione='PRO': Risultati e Home mostrano la card pro con l'arrivo completo, i punti restano nella pagina gara a punti e nel profilo.
//   node pro-women-points-apply.js [--season=2026] [--mult=3] [--dry]
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8').split('\n').forEach(l => { const m = l.match(/^([^#=\s]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2'); });
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const args = process.argv.slice(2);
const arg = n => (args.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1];
const SEASON = parseInt(arg('season') || new Date().getFullYear(), 10), MULT = parseInt(arg('mult') || '3', 10), DRY = args.includes('--dry');
const BASE = { 1: 15, 2: 12, 3: 10, 4: 8, 5: 6, 6: 5, 7: 4, 8: 3, 9: 2, 10: 1 };
const sb = createClient('https://aqqsstsbgpapzoxllosh.supabase.co', process.env.SUPABASE_SECRET, { realtime: { transport: ws } });
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

(async () => {
  const athletes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'athletes.json'), 'utf8'));
  const { data: races } = await sb.from('pro_races').select('pcs_race_slug, season, nome, data_start, classe, circuit, parent_slug').eq('season', SEASON).in('circuit', [24, 16]).order('data_start');
  const eligible = (races || []).filter(r => !/WWT/.test(r.classe) && !r.parent_slug);
  let written = 0;
  // gare gia' presenti tra i risultati FCI (stessa data, stesse parole del nome): hanno gia' i loro punti, non si raddoppiano
  const stop = new Set(['DEL', 'DELLA', 'DELLE', 'DONNE', 'DONNA', 'ELITE', 'WOMEN', 'WOMENS', 'TROFEO', 'PREMIO', 'GRAN', 'COPPA']);
  const toks = s => new Set(String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/['’`]/g, '').replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 2 && !stop.has(w) && !/^\d+$/.test(w)));
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'results_raw.json'), 'utf8')).filter(x => x.genere === 'F' && x.categoria && /elite/i.test(x.categoria));
  const inFci = r => { const mine = [...toks(r.nome)]; return raw.some(x => x.data === r.data_start && (() => { const o = toks(x.nome_gara); const hit = mine.filter(w => o.has(w)).length; return mine.length && hit >= Math.min(2, mine.length); })()); };
  for (const r of eligible) {
    if (inFci(r)) { console.log(`${r.data_start} ${r.nome}: gia' nei risultati FCI con punti, salto`); continue; }
    const garaId = `${norm(r.nome)}_${r.data_start}_ELI_F`;
    const { data: rows } = await sb.from('pcs_race_full_results').select('posizione, atleta_id, nome_completo, team, country').eq('pcs_race_slug', r.pcs_race_slug).eq('season', SEASON).not('posizione', 'is', null).lte('posizione', 10).order('posizione');
    const seen = new Set();
    for (const x of rows || []) {
      if (String(x.country || '').toLowerCase() !== 'it') continue;
      let id = x.atleta_id;
      if (!id) { const w = x.nome_completo.trim().split(/\s+/), up = w.filter(t => t.length > 1 && t === t.toUpperCase()), lo = w.filter(t => !up.includes(t)); id = up.length && lo.length ? `${norm(up.join(' '))}_${norm(lo.join(' '))}` : null; }
      const a = id && athletes[id];
      if (!a || a.genere === 'M' || seen.has(id)) continue;
      seen.add(id);
      const row = {
        gara_id: garaId, posizione: x.posizione, cognome: a.cognome, nome: a.nome, atleta_id: id,
        team: a.team_attuale || x.team || '', team_id: a.team_id || '', tempo: '', nome_gara: r.nome, data: r.data_start,
        categoria: 'ELI_F', genere: 'F', tipo: 'internazionale', moltiplicatore: MULT, campionato_regionale: false, campionato_italiano: false,
        regione: 'PRO', km: '', media: '', punti_base: BASE[x.posizione] || 0, punti_effettivi: (BASE[x.posizione] || 0) * MULT, edited_by: 1,
      };
      console.log(`${r.data_start} ${r.nome}: ${x.posizione}° ${a.cognome} ${a.nome} → ${row.punti_effettivi} pt`);
      if (!DRY) {
        const { error } = await sb.from('manual_results').upsert(row, { onConflict: 'gara_id,posizione,atleta_id' });
        if (error) console.log('   ERRORE', error.message); else written++;
      }
    }
  }
  console.log(`\n${DRY ? 'Simulazione' : 'Scritti'}: ${DRY ? '' : written} (moltiplicatore x${MULT})`);
})().catch(e => { console.error(e); process.exit(1); });
