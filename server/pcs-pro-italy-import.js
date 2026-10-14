'use strict';
// Gare professionistiche disputate in Italia (UCI WorldTour, Women's WorldTour, ProSeries) da PCS: calendario + ordine d'arrivo completo.
// Niente punti ICS: servono solo a riempire Home e Risultati. Le gare vanno in pro_races, l'arrivo in pcs_race_full_results
// (stessa tabella che alimenta gia' il modale "risultati gara"). Per le corse a tappe si salva la classifica generale.
//
// Uso: node pcs-pro-italy-import.js [--season=2026] [--force] [--dry-run] [--limit N]
//   (PCS blocca i server: si lancia dal PC, come gli altri pcs-*.js)

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { launchPcsBrowser, gotoPcsPage, humanDelay } = require('./pcs-browser');

(function loadEnv() {
  const p = path.join(__dirname, '.env.local');
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  });
})();

const SUPABASE_URL = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('SUPABASE_SECRET mancante in .env.local'); process.exit(1); }

const args = process.argv.slice(2);
const argv = n => (args.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1];
const SEASONS = (argv('season') || String(new Date().getFullYear())).split(',').map(Number);
const FORCE = args.includes('--force'), DRY = args.includes('--dry-run');
const LIMIT = parseInt(argv('limit') || '', 10) || Infinity;
// 1 = UCI WorldTour, 24 = Women's WorldTour, 26 = ProSeries
const CIRCUITS = [1, 24, 26];

function parseCalendar(html, season, circuit) {
  const $ = cheerio.load(html), out = [];
  $('table tbody tr').each((_, tr) => {
    const tds = $(tr).find('> td');
    if (tds.length < 5) return;
    const flag = ($(tds[2]).find('span.flag').attr('class') || '').split(/\s+/).find(c => c !== 'flag') || '';
    if (flag !== 'it') return;
    const a = $(tds[2]).find('a').first();
    const href = (a.attr('href') || '').trim();
    const m = href.match(/^race\/(.+?)-(\d{4})(?:-.*)?$/);
    if (!m) return;
    const dm = $(tds[0]).text().match(/(\d{2})\.(\d{2})(?:\s*-\s*(\d{2})\.(\d{2}))?/);
    if (!dm) return;
    const start = `${season}-${dm[2]}-${dm[1]}`, end = dm[3] ? `${season}-${dm[4]}-${dm[3]}` : start;
    const w = $(tds[3]).find('a').first();
    out.push({
      pcs_race_slug: m[1], season: +m[2], nome: a.text().replace(/\s+/g, ' ').trim(), data_start: start, data_end: end,
      classe: $(tds[4]).text().trim(), circuit, country: 'it', pcs_url: href,
      winner_name: w.text().replace(/\s+/g, ' ').trim() || null, winner_slug: (w.attr('href') || '').replace(/^rider\//, '') || null,
    });
  });
  return out;
}

function parseResults(html) {
  const $ = cheerio.load(html), rows = [];
  const table = $('table.results').first();
  table.find('tbody > tr').each((_, tr) => {
    const $tr = $(tr);
    const posText = $tr.find('> td').first().text().trim();
    if (!/^\d+$/.test(posText)) return;
    const a = $tr.find('td a[href^="rider/"]').first();   // layout PCS 2026: cella 'mb_w50' (prima 'ridername')
    const nome = a.text().replace(/\s+/g, ' ').trim();
    if (!nome) return;
    const flag = (a.closest('td').find('span.flag').first().attr('class') || '').split(/\s+/).find(c => c !== 'flag') || '';
    const teamA = $tr.find('td.cu600 a[href^="team/"]').first();
    rows.push({
      posizione: parseInt(posText, 10), pcs_slug: (a.attr('href') || '').replace(/^rider\//, ''), nome_completo: nome,
      team: (teamA.length ? teamA.text() : $tr.find('td.cu600').first().text()).trim() || null, country: flag || null,
      distacco: ($tr.find('td.time').first().text() || $tr.find('td.ar').not(':has(a)').last().text()).replace(/\s+/g, ' ').trim() || null,
    });
  });
  return rows;
}

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });
  const today = new Date().toISOString().slice(0, 10);

  // pcs_slug -> atleta_id (per collegare al profilo chi e' gia' nel nostro archivio)
  const slugToId = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('entity_overrides').select('entity_id, new_value').eq('entity_type', 'atleta').eq('field', 'pcs_slug').order('id').range(from, from + 999);
    if (error) throw error;
    if (!data || !data.length) break;
    for (const r of data) slugToId.set(r.new_value, r.entity_id);
    if (data.length < 1000) break;
  }
  console.log(`${slugToId.size} pcs_slug noti`);

  let { browser, context, page } = await launchPcsBrowser();
  // il browser a volte si chiude da solo a meta' lavoro: si riapre la pagina (o tutto il browser) e si riprova
  async function go(url, readySelector) {
    let nav = { ok: false };
    for (let k = 0; k < 4; k++) {
      if (page.isClosed()) {
        try { page = await context.newPage(); }
        catch { try { await browser.close(); } catch {} ({ browser, context, page } = await launchPcsBrowser()); }
      }
      nav = await gotoPcsPage(page, url, { readySelector });
      if (nav.ok || nav.notFound) return nav;
      await humanDelay(k);
    }
    return nav;
  }
  let made = 0, nRows = 0;
  try {
    const races = [];
    for (const season of SEASONS) for (const c of CIRCUITS) {
      const nav = await go(`https://www.procyclingstats.com/races.php?year=${season}&circuit=${c}&class=&filter=Filter`, 'table');
      if (!nav.ok) { console.log(`calendario ${season} circuito ${c}: non letto`, JSON.stringify(nav)); continue; }
      races.push(...parseCalendar(await page.content(), season, c));
      await humanDelay(c);
    }
    console.log(`${races.length} gare in Italia nei circuiti pro:`);
    races.forEach(r => console.log(`  ${r.data_start} ${r.classe.padEnd(6)} ${r.nome}`));

    const { data: have } = await sb.from('pro_races').select('pcs_race_slug, season, winner_name').in('season', SEASONS);
    const doneSet = new Set((have || []).filter(r => r.winner_name).map(r => `${r.pcs_race_slug}|${r.season}`));
    const todo = races.filter(r => r.data_end < today && (FORCE || !doneSet.has(`${r.pcs_race_slug}|${r.season}`))).slice(0, LIMIT);
    console.log(`\n${todo.length} da importare (concluse${FORCE ? '' : ', non gia\' fatte'})\n`);

    for (let i = 0; i < todo.length; i++) {
      const r = todo[i];
      process.stdout.write(`(${i + 1}/${todo.length}) ${r.nome} ${r.season} … `);
      const nav = await go(`https://www.procyclingstats.com/${r.pcs_url}`, 'table.results');
      if (!nav.ok) { console.log(nav.notFound ? 'non trovata' : 'errore, riprovo al prossimo giro'); continue; }
      const rows = parseResults(await page.content());
      if (!rows.length) { console.log('nessun arrivo'); await humanDelay(i); continue; }
      const win = rows.find(x => x.posizione === 1);
      if (win) { r.winner_name = win.nome_completo; r.winner_slug = win.pcs_slug; }
      if (DRY) { console.log(`[DRY] ${rows.length} righe, vince ${r.winner_name}`); continue; }
      const seen = new Set();
      const ins = rows.filter(x => { const k = x.posizione + '|' + x.nome_completo; if (seen.has(k)) return false; seen.add(k); return true; })
        .map(x => ({ pcs_race_slug: r.pcs_race_slug, season: r.season, posizione: x.posizione, pcs_slug: x.pcs_slug || null, atleta_id: slugToId.get(x.pcs_slug) || null, nome_completo: x.nome_completo, team: x.team, country: x.country, distacco: x.distacco }));
      const e1 = (await sb.from('pcs_race_full_results').upsert(ins, { onConflict: 'pcs_race_slug,season,posizione,nome_completo' })).error;
      if (e1) { console.log('errore salvataggio arrivo:', e1.message); continue; }
      const e2 = (await sb.from('pro_races').upsert(r, { onConflict: 'pcs_race_slug,season' })).error;
      if (e2) { console.log('errore salvataggio gara:', e2.message); continue; }
      made++; nRows += ins.length;
      console.log(`✓ ${ins.length} righe, vince ${r.winner_name}`);
      await humanDelay(i);
    }
  } finally { await browser.close().catch(() => {}); }
  console.log(`\n=== ${DRY ? 'Simulazione' : 'Completato'} === gare: ${made} · righe: ${nRows}`);
})().catch(e => { console.error('ERRORE FATALE', e); process.exit(1); });
