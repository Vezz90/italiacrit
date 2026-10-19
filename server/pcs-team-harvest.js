'use strict';
// Raccolta delle squadre da PCS (anche i club italiani Juniores/U23, che non compaiono negli elenchi): per ogni nostra squadra del 2026
// 1) ricerca per nome (search.php, una richiesta) -> pagina squadra di PCS;
// 2) verifica con la ROSA: i nostri atleti di quella squadra devono comparire nella rosa PCS (per slug o per nome);
// 3) dal menu degli anni si scaricano tutte le stagioni (nome che la squadra aveva e rosa di ogni anno).
// Scrive solo server/pcs-teams-harvest.json (nessuna scrittura sul database); il collegamento storico/rose si fa dopo, solo sui dati salvati.
//   node pcs-team-harvest.js [--limit=N] [--offset=N] [--cat=JUNIORES,ELITE_UNDER23] [--team="NOME ESATTO"]
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8').split('\n').forEach(l => { const m = l.match(/^([^#=\s]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2'); });
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const { launchPcsBrowser, gotoPcsPage, humanDelay } = require('./pcs-browser');
const args = process.argv.slice(2);
const arg = n => (args.find(a => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=');
const LIMIT = parseInt(arg('limit') || '0', 10) || Infinity, OFFSET = parseInt(arg('offset') || '0', 10);
const CATS = (arg('cat') || 'JUNIORES,ELITE_UNDER23').split(',').filter(Boolean);
const ONLY_TEAM = arg('team');
const OLD = args.includes('--old');   // squadre degli anni passati (ciclismo.info) assenti nel 2026 e non gia coperte dalle catene trovate
const OUT = path.join(__dirname, 'pcs-teams-harvest.json');
let data = {}; try { data = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) {}
const save = () => fs.writeFileSync(OUT, JSON.stringify(data));
const sb = createClient('https://aqqsstsbgpapzoxllosh.supabase.co', process.env.SUPABASE_SECRET, { realtime: { transport: ws } });
const strip = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const toks = s => new Set(strip(s).split(' ').filter(Boolean));
const STOP = new Set(['a', 's', 'd', 'asd', 'ssd', 'sc', 'gs', 'uc', 'team', 'club', 'cycling', 'ciclistica', 'polisportiva', 'societa', 'dilettantistica', 'sport', 'e', 'di', 'del', 'della', 'the', 'srl', 'snc', 'a.s.d', 'pol', 'ssdarl']);

function searchTerms(name) {
  // nomi FCI e nomi PCS spesso differiscono nello sponsor: si provano piu combinazioni (max 4 ricerche)
  const w = strip(name).split(' ').filter(x => x && !STOP.has(x) && x.length > 1);
  const longest = [...w].sort((a, b) => b.length - a.length);
  const t = [w.slice(0, 4).join('+'), w.slice(0, 2).join('+'), w.slice(-2).join('+'), longest[0], longest[1]];
  return [...new Set(t.filter(Boolean))].slice(0, 4);
}

(async () => {
  // le nostre squadre del 2026 con i loro atleti
  const teams = new Map(); // nome -> Set(atleta_id)   (solo 2026; con --old si usa byYear)
  const byYear = new Map(), names2026 = new Set();
  // pagine piccole e nuovi tentativi: la lettura con filtro stagione/categoria andava in timeout
  for (let last = 0, fails = 0; ;) {
    const q = await sb.from('ciclismo_results').select('id,atleta_id,team,categoria,stagione').gt('id', last).order('id').limit(500);
    if (q.error) { if (++fails > 8) throw q.error; await new Promise(r => setTimeout(r, 3000)); continue; }
    fails = 0;
    if (!q.data.length) break;
    for (const x of q.data) {
      if (!CATS.includes(x.categoria)) continue;
      const t = String(x.team || '').trim().toUpperCase(); if (!t || !x.atleta_id) continue;
      if (x.stagione === '2026') { names2026.add(t); if (!OLD) (teams.get(t) || teams.set(t, new Set()).get(t)).add(x.atleta_id); }
      else if (OLD) { const m = byYear.get(t) || byYear.set(t, new Map()).get(t); const y = parseInt(x.stagione, 10); (m.get(y) || m.set(y, new Set()).get(y)).add(x.atleta_id); }
    }
    last = q.data[q.data.length - 1].id; if (q.data.length < 500) break;
  }
  const slugOf = new Map();
  for (let from = 0; ; from += 1000) { const q = await sb.from('entity_overrides').select('entity_id,new_value').eq('entity_type', 'atleta').eq('field', 'pcs_slug').order('id').range(from, from + 999); (q.data || []).forEach(x => slugOf.set(x.entity_id, x.new_value)); if (!q.data || q.data.length < 1000) break; }
  let list;
  if (OLD) {
    // indice delle rose gia raccolte: anno -> elenco di Set(slug)
    const rosters = new Map();
    for (const d of Object.values(data)) if (d.status === 'ok') for (const [y, se] of Object.entries(d.seasons || {})) (rosters.get(+y) || rosters.set(+y, []).get(+y)).push(new Set(se.roster.map(r => r.slug)));
    list = [];
    for (const [name, m] of byYear) {
      if (names2026.has(name) || data[name]) continue;
      const y = Math.max(...m.keys()), ids = m.get(y);
      const slugs = [...ids].map(i => slugOf.get(i)).filter(Boolean);
      // gia coperta: almeno 2 dei nostri atleti (con slug) stanno in una rosa gia raccolta dello stesso anno
      if ((rosters.get(y) || []).some(r => slugs.filter(x => r.has(x)).length >= 2)) continue;
      if (ids.size < 3) continue;   // squadre minuscole: troppo poco per verificare con la rosa
      list.push([name, ids, y]);
    }
    list.sort((a, b) => b[1].size - a[1].size);
  } else list = [...teams.entries()].map(([n, ids]) => [n, ids, 2026]).sort((a, b) => b[1].size - a[1].size);
  if (ONLY_TEAM) list = list.filter(([n]) => n === ONLY_TEAM.toUpperCase());
  list = list.filter(([n]) => !data[n] || data[n].status === 'errore').slice(OFFSET, OFFSET + LIMIT);
  console.log(`squadre ${CATS.join('+')} ${OLD ? 'del passato' : '2026'}: ${OLD ? byYear.size : teams.size} · da fare: ${list.length}`);

  let { browser, context, page } = await launchPcsBrowser();
  async function go(url, sel) {
    for (let k = 0; k < 3; k++) {
      if (page.isClosed()) { try { page = await context.newPage(); } catch { try { await browser.close(); } catch {} ({ browser, context, page } = await launchPcsBrowser()); } }
      const n = await gotoPcsPage(page, url, sel ? { readySelector: sel } : {});
      if (n.ok || n.notFound) return n;
      await humanDelay(k);
    }
    return { ok: false };
  }
  // link "popolari" presenti in ogni pagina di ricerca: da escludere
  let popular = new Set();
  if ((await go('https://www.procyclingstats.com/search.php?term=zzqqxx&searchfilter=teams')).ok) popular = new Set(await page.evaluate(() => [...document.querySelectorAll('a[href^="team/"]')].map(a => a.getAttribute('href'))));
  await humanDelay(0);

  const readTeam = async url => {
    const n = await go('https://www.procyclingstats.com/' + url, 'table');
    if (!n.ok) return null;
    return page.evaluate(() => {
      const sel = document.querySelector('select');
      const years = sel ? [...sel.options].map(o => ({ url: o.value.replace(/\/overview\/start$/, ''), label: o.text.trim() })) : [];
      const roster = [...document.querySelectorAll('table.teamlist a[href^="rider/"]')].map(a => ({ slug: a.getAttribute('href').replace(/^rider\//, ''), name: a.innerText.replace(/\s+/g, ' ').trim() }));
      return { h1: (document.querySelector('h1') || {}).innerText || '', years, roster };
    });
  };
  const overlap = (ids, roster) => {
    const rs = new Set(roster.map(r => r.slug)), rn = roster.map(r => toks(r.name));
    let hit = 0;
    for (const id of ids) {
      const s = slugOf.get(id); if (s && rs.has(s)) { hit++; continue; }
      const t = toks(id.replace(/_/g, ' '));
      if (rn.some(x => x.size === t.size && [...t].every(w => x.has(w)))) hit++;
    }
    return hit;
  };

  for (let i = 0; i < list.length; i++) {
    const [name, idsSet, refYear] = list[i], ids = [...idsSet];
    let found = null, tried = 0;
    for (const term of searchTerms(name)) {
      const s = await go(`https://www.procyclingstats.com/search.php?term=${term}&searchfilter=teams`);
      await humanDelay(i);
      if (!s.ok) continue;
      const cands = [...new Set(await page.evaluate(() => [...document.querySelectorAll('a[href^="team/"]')].map(a => a.getAttribute('href'))))].filter(h => !popular.has(h) && /-\d{4}$/.test(h)).slice(0, 3);
      for (const c of cands) {
        let t = await readTeam(c); tried++; await humanDelay(i);
        if (!t) continue;
        // pagina del 2026 (o dell'anno piu recente) per confrontare con la nostra rosa attuale
        const cur = t.years.find(y => y.label.startsWith(String(refYear))) || (OLD ? null : t.years[0]);
        if (!cur) continue;   // la squadra non ha quell'anno
        if (!c.startsWith(cur.url)) { t = await readTeam(cur.url); await humanDelay(i); if (!t) continue; }
        const ov = overlap(ids, t.roster);
        if (ov >= 2 && ov >= Math.min(ids.length, t.roster.length) * 0.25) { found = { pcs: c.replace(/-\d{4}$/, ''), years: t.years, overlap: ov, roster2026: t.roster.length }; break; }
      }
      if (found) break;
    }
    if (!found) { data[name] = { status: 'non trovata', refYear, athletes: ids.length, tried, at: new Date().toISOString() }; console.log(`(${i + 1}/${list.length}) ${name}: non su PCS`); save(); continue; }
    const seasons = {};
    for (const y of found.years) {
      const ty = await readTeam(y.url); await humanDelay(i);
      const yr = (y.label.match(/^(\d{4})/) || [])[1];
      if (ty && yr) seasons[yr] = { name: y.label.replace(/^\d{4}\s*\|\s*/, ''), url: y.url, roster: ty.roster };
    }
    data[name] = { status: 'ok', refYear, pcs: found.pcs, overlap: found.overlap, athletes: ids.length, seasons, at: new Date().toISOString() };
    console.log(`(${i + 1}/${list.length}) ${name} → ${found.pcs} · rosa ${refYear} ${found.overlap}/${ids.length} nostri · anni ${Object.keys(seasons).join(',')} ✓`);
    save();
  }
  save();
  await browser.close().catch(() => {});
  console.log('\n=== Completato ===', JSON.stringify(Object.values(data).reduce((a, d) => (a[d.status] = (a[d.status] || 0) + 1, a), {})));
})().catch(e => { console.error('ERRORE FATALE', e); process.exit(1); });
