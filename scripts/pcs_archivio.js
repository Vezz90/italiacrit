#!/usr/bin/env node
/**
 * Completa le gare dell'archivio ciclismo.info (CIC_<id>, di cui abbiamo solo i primi 10) con l'ordine
 * d'arrivo COMPLETO di ProCyclingStats. L'abbinamento gara -> pagina PCS sta nella tabella cic_pcs_map
 * (costruita dai risultati dei singoli atleti: stesso atleta, stessa data, stessa posizione).
 *
 * Sicurezza: una pagina PCS e' accettata solo se i primi posti coincidono con quelli dell'archivio
 * (stessi corridori nelle stesse posizioni), cosi' non si mescolano categorie o gare diverse.
 *
 *   node scripts/pcs_archivio.js --limit 20                 anteprima (non scrive)
 *   node scripts/pcs_archivio.js --limit 500 --apply        scrive (riprendibile: salta le gare gia' fatte)
 *   opzioni: --min 2 (corrispondenze minime) --year 2025 --sleep 1500
 * PCS blocca i server: va lanciato da un computer normale (usa curl).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server');
for (const line of fs.readFileSync(path.join(SERVER, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require(path.join(SERVER, 'node_modules', '@supabase', 'supabase-js'));
const cheerio = require(path.join(SERVER, 'node_modules', 'cheerio'));
const ws = require(path.join(SERVER, 'node_modules', 'ws'));
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET, { realtime: { transport: ws } });

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const APPLY = process.argv.includes('--apply');
const LIMIT = parseInt(arg('limit', 20), 10);
const MIN = parseInt(arg('min', 2), 10);
const YEAR = arg('year', '');
const SLEEP = parseInt(arg('sleep', 1500), 10);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const key = s => norm(s).split(' ').filter(Boolean).sort().join(' ');      // nome senza ordine: "Rossi Mario" == "MARIO ROSSI"

function curlPage(url) {
  for (let i = 0; i < 2; i++) {
    try {
      const out = execFileSync('curl', ['-s', '-L', '-m', '40', '-A', UA, '-H', 'Accept-Language: it-IT,it;q=0.9,en;q=0.8', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (out && out.includes('<table') && /href="rider\//.test(out)) return out;
    } catch (_) {}
  }
  return null;
}
// lo slug salvato e' il solo nome (es. "coppa-pietro-linari"): si prova race/ e national-race/ con l'anno della gara
function fetchPage(slug, year) {
  const clean = String(slug).replace(/^\/+/, '').replace(/\/result\/?$/, '');
  if (/^(race|national-race|stage-race|one-day-race)\//.test(clean)) return { html: curlPage(`https://www.procyclingstats.com/${clean}${/\/\d{4}$/.test(clean) ? '' : '/' + year}/result`), url: clean };
  for (const pre of ['race', 'national-race']) {
    const html = curlPage(`https://www.procyclingstats.com/${pre}/${clean}/${year}/result`);
    if (html) return { html, url: `${pre}/${clean}/${year}` };
  }
  return { html: null, url: null };
}
function parse(html) {
  const $ = cheerio.load(html);
  const table = $('table').toArray().find(t => {
    if ($(t).parents('.hide').length) return false;
    const h = $(t).find('th').map((_, e) => $(e).text().trim().toLowerCase()).get();
    return h.some(x => /rnk|pos|#/.test(x)) && h.some(x => /rider|name|cyclist/.test(x));
  });
  if (!table) return [];
  const heads = $(table).find('th').map((_, e) => $(e).text().trim().toLowerCase()).get();
  const iPos = heads.findIndex(x => /rnk|pos|#/.test(x)), iRider = heads.findIndex(x => /rider|name|cyclist/.test(x)), iTeam = heads.findIndex(x => /team/.test(x));
  const rows = [];
  $(table).find('tbody tr').each((_, tr) => {
    const td = $(tr).find('td').toArray();
    if (td.length < 2) return;
    const pos = parseInt($(td[iPos]).text().replace(/\s+/g, ''), 10);
    const cell = $(td[iRider]);
    const rider = (cell.find('a').first().text() || cell.text()).replace(/\s+/g, ' ').trim();
    if (!pos || !rider) return;
    const team = iTeam >= 0 ? ($(td[iTeam]).find('a').first().text() || $(td[iTeam]).text()).replace(/\s+/g, ' ').trim() : '';
    rows.push({ pos, rider, team });
  });
  return rows;
}

(async () => {
  // nomi noti -> atleta_id (solo atleti gia' presenti in ICS: nessun profilo nuovo viene creato)
  const known = new Map();
  const ath = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'athletes.json'), 'utf8'));
  for (const [id, a] of Object.entries(ath)) known.set(key(`${a.cognome} ${a.nome}`), id);

  let q = sb.from('cic_pcs_map').select('cic_id,pcs_race_slug,n_match').eq('stato', 'da_fare').gte('n_match', MIN).order('n_match', { ascending: false }).limit(5000);
  const { data: todo, error } = await q;
  if (error) throw error;
  const races = {};
  for (let i = 0; i < todo.length; i += 200) {
    const ids = todo.slice(i, i + 200).map(r => r.cic_id);
    const { data } = await sb.from('cic_races').select('id,nome,data,categoria').in('id', ids);
    for (const r of data || []) races[r.id] = r;
  }
  let list = todo.filter(r => races[r.cic_id] && (!YEAR || String(races[r.cic_id].data).startsWith(YEAR)));
  list = list.slice(0, LIMIT);
  console.log(`${todo.length} gare da fare (min ${MIN} corrispondenze) · in questo giro: ${list.length}${APPLY ? ' · SCRITTURA ATTIVA' : ' · anteprima'}\n`);

  const cache = {};
  const stat = { ok: 0, scartate: 0, errori: 0, righe: 0 };
  for (const r of list) {
    const race = races[r.cic_id];
    const { data: top } = await sb.from('ciclismo_results').select('posizione,atleta_id').ilike('gara_ciclismo_url', `%_${r.cic_id}_2%`).order('posizione').limit(40);
    const cic = (top || []).filter(x => x.posizione <= 10);
    const yr = String(race.data).slice(0, 4), ck = `${r.pcs_race_slug}|${yr}`;
    if (!(ck in cache)) { await sleep(SLEEP); const f = fetchPage(r.pcs_race_slug, yr); cache[ck] = f.html ? { rows: parse(f.html), url: f.url } : null; }
    const rows = cache[ck] && cache[ck].rows, fullSlug = cache[ck] && cache[ck].url;
    let stato = 'errore', nota = '', n = 0;
    if (!rows || !rows.length) { stato = 'errore'; nota = 'pagina PCS non letta'; stat.errori++; }
    else {
      const byPos = new Map(rows.map(x => [x.pos, key(x.rider)]));
      let hit = 0;
      for (const c of cic) if (byPos.get(c.posizione) === key(String(c.atleta_id || '').replace(/_/g, ' '))) hit++;
      const need = Math.max(2, Math.ceil(cic.length * 0.6));
      if (hit >= need && rows.length <= cic.length) { stato = 'completa'; nota = `PCS ha solo ${rows.length} righe: niente da aggiungere`; stat.scartate++; }
      else if (hit >= need) {
        stato = 'importata'; n = rows.length; stat.ok++; stat.righe += rows.length; nota = `coincidono ${hit}/${cic.length} dei primi posti`;
      } else { stato = 'scartata'; nota = `solo ${hit}/${cic.length} primi posti coincidono (altra categoria o gara)`; stat.scartate++; }
      if (stato === 'importata' && APPLY) {
        const gid = `CIC_${r.cic_id}`;
        const season = parseInt(String(race.data).slice(0, 4), 10);
        const seenPos = new Set();
        const out = rows.filter(x => { if (seenPos.has(x.pos)) return false; seenPos.add(x.pos); return true; }).map(x => ({ gara_id: gid, season, posizione: x.pos, rider_name: x.rider, team_name: x.team || null, distacco: null, pcs_race_slug: fullSlug, atleta_id: known.get(key(x.rider)) || null }));
        await sb.from('pcs_gara_results').delete().eq('gara_id', gid);
        for (let i = 0; i < out.length; i += 300) { const { error: e } = await sb.from('pcs_gara_results').insert(out.slice(i, i + 300)); if (e) throw e; }
        await sb.from('entity_overrides').upsert([{ entity_type: 'gara', entity_id: gid, field: 'pcs_race_slug', new_value: fullSlug, edited_by: null }], { onConflict: 'entity_type,entity_id,field' });
      }
    }
    console.log(`${stato === 'importata' ? '✓' : (stato === 'scartata' || stato === 'completa') ? '–' : '✗'} CIC_${r.cic_id} ${String(race.data).slice(0, 10)} ${String(race.nome).slice(0, 38).padEnd(38)} ${String(race.categoria).slice(0, 12).padEnd(12)} PCS ${String(rows ? rows.length : 0).padStart(3)} · ${nota}`);
    if (APPLY) await sb.from('cic_pcs_map').update({ stato, n_pcs: n, nota, aggiornata_il: new Date().toISOString() }).eq('cic_id', r.cic_id);
  }
  console.log(`\nImportate ${stat.ok} (${stat.righe} righe) · scartate ${stat.scartate} · errori ${stat.errori}${APPLY ? '' : '  — anteprima, nulla scritto'}`);
})().catch(e => { console.error('ERRORE:', e.message); process.exit(1); });
