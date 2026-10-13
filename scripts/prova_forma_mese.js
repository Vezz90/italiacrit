#!/usr/bin/env node
/**
 * Prova "Forma per mese": estrae dal database i risultati (top 10) di alcuni atleti e li scrive in prototipi/forma_dati.js
 *   node scripts/prova_forma_mese.js NEGRENTE_MATTIA BICELLI_MICHELE MAGLI_LORENZO
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), SERVER = path.join(ROOT, 'server');
for (const line of fs.readFileSync(path.join(SERVER, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require(path.join(SERVER, 'node_modules', '@supabase', 'supabase-js'));
const ws = require(path.join(SERVER, 'node_modules', 'ws'));
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET, { realtime: { transport: ws } });
const ids = process.argv.slice(2);
(async () => {
  const out = [];
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'results_raw.json'), 'utf8'));
  for (const id of ids) {
    const { data, error } = await sb.from('ciclismo_results').select('data,posizione,categoria,nome_gara').eq('atleta_id', id).order('data');
    if (error) throw error;
    const rows = (data || []).map(r => [r.data, r.posizione, r.categoria, String(r.nome_gara || '').slice(0, 48)]);
    const last = rows.length ? rows[rows.length - 1][0] : '2000-01-01';
    // gare piu' recenti dello storico (stagione in corso) dal file risultati del sito
    for (const r of raw) if (r.atleta_id === id && r.data > last && r.posizione >= 1 && r.posizione <= 10) rows.push([r.data, r.posizione, r.categoria, String(r.nome_gara || '').slice(0, 48)]);
    rows.sort((a, b) => a[0].localeCompare(b[0]));
    // PCS: tutte le gare (anche estere e oltre il 10 posto). Una riga PCS uguale a una nostra (stessa data e posizione, oppure stessa data e nome simile) conta una volta sola.
    const ics = rows.map(r => ({ r, src: 'I' }));
    const { data: pcs } = await sb.from('pcs_results').select('data,posizione,gara_name,country,season').eq('atleta_id', id).not('data', 'is', null).not('posizione', 'is', null).order('data');
    const tk = s => new Set(String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^A-Z0-9]+/).filter(w => w.length >= 4 && !/^(GRAN|PREMIO|TROFEO|COPPA|MEMORIAL|CLASSIFICA|GENERALE|TAPPA|PRIMA|SECONDA|TERZA|QUARTA|QUINTA)$/.test(w)));
    let extra = 0, dup = 0;
    for (const p of (pcs || [])) {
      const same = ics.find(x => x.r[0] === p.data && (x.r[1] === p.posizione || [...tk(x.r[3])].filter(w => tk(p.gara_name).has(w)).length >= 2));
      if (same) { if (same.src === 'I') same.src = 'IP'; dup++; continue; }
      ics.push({ r: [p.data, p.posizione, '', String(p.gara_name || '').slice(0, 48), p.country || ''], src: 'P' }); extra++;
    }
    console.log('   PCS:', (pcs || []).length, 'righe,', dup, 'gia presenti,', extra, 'in piu');
    const merged = ics.map(x => [x.r[0], x.r[1], x.r[2], x.r[3], x.src, x.r[4] || '']).sort((p, q) => p[0].localeCompare(q[0]));
    const { data: a } = await sb.from('ciclismo_athletes').select('nome_completo,data_nascita').eq('atleta_id', id).limit(1);
    out.push({ id, nome: (a && a[0] && a[0].nome_completo) || id.replace(/_/g, ' '), nascita: (a && a[0] && a[0].data_nascita) || null, rows: merged });
    console.log(id, merged.length, 'risultati totali');
  }
  fs.writeFileSync(path.join(ROOT, 'prototipi', 'forma_dati.js'), 'window.FORMA_DATA = ' + JSON.stringify(out) + ';\n');
  console.log('scritto prototipi/forma_dati.js');
})().catch(e => { console.error(e.message); process.exit(1); });
