#!/usr/bin/env node
/**
 * Importa i risultati COMPLETI di un campionato (Mondiali / Europei) da ProCyclingStats come risultati veri
 * (manual_results), per TUTTI i corridori classificati (italiani e stranieri), con il moltiplicatore scelto.
 *
 * PCS blocca gli IP dei server (Render, GitHub Actions): lo script va lanciato da un computer normale.
 * Usa le credenziali Supabase di server/.env.local.
 *
 *   node scripts/import_campionati_pcs.js --event wc --mult 4 --url <pagina PCS>          (anteprima, non scrive)
 *   node scripts/import_campionati_pcs.js --event wc --mult 4 --url <pagina PCS> --apply  (scrive)
 *
 * Escluse: ME (uomini elite), ME (TT) e le staffette miste. Punti: tabella standard (1..10) x moltiplicatore.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server');

// ── env ───────────────────────────────────────────────────────────────
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
const EVENT = arg('event', 'eu') === 'wc' ? 'Campionato del Mondo' : 'Campionato Europeo';
const MULT = Math.max(1, Math.min(4, parseInt(arg('mult', EVENT === 'Campionato del Mondo' ? 4 : 3), 10)));
const START = String(arg('url', '')).trim();
const ONLY = arg('only', '');                       // es. --only "MU,MJ (TT)"
if (!START) { console.error('Manca --url'); process.exit(1); }

const BASE_PTS = { 1: 15, 2: 12, 3: 10, 4: 8, 5: 6, 6: 5, 7: 4, 8: 3, 9: 2, 10: 1 };
const EXCLUDE = new Set(['ME', 'ME (TT)']);
const CLASS = {
  MU: { cat: 'ELI', gen: 'M', nome: 'Under 23' }, MJ: { cat: 'JUN', gen: 'M', nome: 'Juniores' },
  WE: { cat: 'ELI', gen: 'F', nome: 'Donne Elite' }, WU: { cat: 'ELI', gen: 'F', nome: 'Donne Under 23' }, WJ: { cat: 'JUN', gen: 'F', nome: 'Donne Juniores' },
};
const COUNTRY_IT = {
  'ITALY': 'ITALIA', 'SPAIN': 'SPAGNA', 'FRANCE': 'FRANCIA', 'GERMANY': 'GERMANIA', 'BELGIUM': 'BELGIO', 'NETHERLANDS': 'PAESI BASSI',
  'SWITZERLAND': 'SVIZZERA', 'AUSTRIA': 'AUSTRIA', 'DENMARK': 'DANIMARCA', 'NORWAY': 'NORVEGIA', 'SWEDEN': 'SVEZIA', 'FINLAND': 'FINLANDIA',
  'GREAT BRITAIN': 'GRAN BRETAGNA', 'UNITED KINGDOM': 'GRAN BRETAGNA', 'IRELAND': 'IRLANDA', 'PORTUGAL': 'PORTOGALLO', 'POLAND': 'POLONIA',
  'CZECH REPUBLIC': 'REPUBBLICA CECA', 'SLOVAKIA': 'SLOVACCHIA', 'SLOVENIA': 'SLOVENIA', 'CROATIA': 'CROAZIA', 'SERBIA': 'SERBIA', 'HUNGARY': 'UNGHERIA',
  'ROMANIA': 'ROMANIA', 'BULGARIA': 'BULGARIA', 'GREECE': 'GRECIA', 'TURKEY': 'TURCHIA', 'TURKIYE': 'TURCHIA', 'UKRAINE': 'UCRAINA', 'ESTONIA': 'ESTONIA',
  'LATVIA': 'LETTONIA', 'LITHUANIA': 'LITUANIA', 'LUXEMBOURG': 'LUSSEMBURGO', 'BELARUS': 'BIELORUSSIA', 'UNITED STATES': 'STATI UNITI',
  'COLOMBIA': 'COLOMBIA', 'AUSTRALIA': 'AUSTRALIA', 'JAPAN': 'GIAPPONE', 'SAN MARINO': 'SAN MARINO', 'CANADA': 'CANADA', 'NEW ZEALAND': 'NUOVA ZELANDA',
  'ARGENTINA': 'ARGENTINA', 'BRAZIL': 'BRASILE', 'MEXICO': 'MESSICO', 'ECUADOR': 'ECUADOR', 'CHILE': 'CILE', 'SOUTH AFRICA': 'SUDAFRICA',
  'ERITREA': 'ERITREA', 'ETHIOPIA': 'ETIOPIA', 'RWANDA': 'RUANDA', 'MOROCCO': 'MAROCCO', 'ALGERIA': 'ALGERIA', 'EGYPT': 'EGITTO', 'ISRAEL': 'ISRAELE',
  'KAZAKHSTAN': 'KAZAKISTAN', 'CHINA': 'CINA', 'HONG KONG': 'HONG KONG', 'COSTA RICA': 'COSTA RICA', 'VENEZUELA': 'VENEZUELA', 'URUGUAY': 'URUGUAY',
  'ICELAND': 'ISLANDA', 'MOLDOVA': 'MOLDAVIA', 'ALBANIA': 'ALBANIA', 'GEORGIA': 'GEORGIA', 'ARMENIA': 'ARMENIA', 'AZERBAIJAN': 'AZERBAIGIAN',
  'BOSNIA AND HERZEGOVINA': 'BOSNIA ERZEGOVINA', 'NORTH MACEDONIA': 'MACEDONIA DEL NORD', 'MONTENEGRO': 'MONTENEGRO', 'CYPRUS': 'CIPRO', 'MALTA': 'MALTA',
  'LIECHTENSTEIN': 'LIECHTENSTEIN', 'ANDORRA': 'ANDORRA', 'SOUTH KOREA': 'COREA DEL SUD', 'INDIA': 'INDIA', 'THAILAND': 'TAILANDIA',
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normId = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
const makeId = (c, n) => normId(c) + '_' + normId(n);
function parseName(full) {
  const words = String(full || '').trim().split(/\s+/);
  if (words.length === 1) return { cognome: words[0].toUpperCase(), nome: '' };
  let k = words.findIndex(w => /[a-z]/.test(w));
  if (k <= 0) k = words.length - 1;
  return { cognome: words.slice(0, k).join(' ').toUpperCase(), nome: words.slice(k).join(' ').toUpperCase() };
}
// PCS riconosce e blocca le richieste di Node (fingerprint TLS): si usa curl, che passa.
const { execFileSync } = require('child_process');
async function get(slug) {
  const url = `https://www.procyclingstats.com/${String(slug).replace(/^https?:\/\/(www\.)?procyclingstats\.com\//i, '').replace(/^\//, '')}`;
  for (let i = 0; i < 3; i++) {
    try {
      const out = execFileSync('curl', ['-s', '-L', '-m', '40', '-A', UA, '-H', 'Accept-Language: it-IT,it;q=0.9,en;q=0.8', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (out && out.includes('<table') || out.includes('<select')) return out;
    } catch (_) {}
    await sleep(1500);
  }
  throw new Error('PCS non risponde per ' + url);
}

(async () => {
  // ── archivio atleti noti (athletes.json + extra_roster + profili PCS su Supabase) ──
  const known = new Map();        // nome normalizzato -> atleta_id
  const knownIds = new Set();
  const info = {};                // atleta_id -> {cognome, nome}
  const addKnown = (id, c, n) => { if (!id) return; knownIds.add(id); info[id] = { cognome: c, nome: n }; known.set(norm(c + ' ' + n), id); known.set(norm(n + ' ' + c), id); };
  const ath = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'athletes.json'), 'utf8'));
  for (const [id, a] of Object.entries(ath)) addKnown(id, a.cognome, a.nome);
  try { for (const b of Object.values(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'extra_roster.json'), 'utf8')))) for (const a of (b.atleti || [])) addKnown(a.atleta_id, a.cognome, a.nome); } catch (_) {}
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('entity_overrides').select('entity_id,new_value').eq('entity_type', 'pcs_atleta').eq('field', 'profile').range(from, from + 999);
    if (error) throw error;
    for (const r of data || []) { try { const v = JSON.parse(r.new_value); addKnown(r.entity_id, v.cognome, v.nome); } catch (_) {} }
    if (!data || data.length < 1000) break;
  }
  console.log(`Atleti noti: ${knownIds.size}`);

  // ── categorie della pagina ──
  const year = (START.match(/(20\d\d)/) || [])[1];
  const first = cheerio.load(await get(START));
  const found = new Map();
  first('option').each((_, o) => {
    const label = first(o).text().replace(/\s+/g, ' ').trim(), val = (first(o).attr('value') || '').trim();
    if (!/^race\//.test(val) || !/^(M|W)[EUJ]( \(TT\))?$/.test(label)) return;
    const ys = val.match(/20\d\d/g) || [];
    if (ys.length && ys.some(y => y !== year)) return;
    if (!found.has(label) || (ys.length && !found.get(label).ys.length)) found.set(label, { label, slug: val, ys });
  });
  // --slug "WJ=race/..." forza l'indirizzo PCS di una categoria quando il menu ne ha uno sbagliato o accorciato
  for (const kv of process.argv.map((v, i, arr) => arr[i - 1] === '--slug' ? v : null).filter(Boolean)) {
    const [lab, sl] = kv.split('=');
    if (lab && sl) found.set(lab.trim(), { label: lab.trim(), slug: sl.trim(), ys: [] });
  }
  let classes = [...found.values()].filter(c => !EXCLUDE.has(c.label) && CLASS[c.label.replace(/ \(TT\)/, '')]);
  if (ONLY) { const want = new Set(String(ONLY).split(',').map(s => s.trim())); classes = classes.filter(c => want.has(c.label)); }
  console.log(`${EVENT} ${year} · moltiplicatore x${MULT} · ${classes.length} categorie: ${classes.map(c => c.label).join(', ')}\n`);

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const allRows = [], newProfiles = new Map();
  let tot = 0;
  for (const c of classes) {
    await sleep(1500);
    let html;
    try { html = await get(c.slug); } catch (e) { console.log(`✗ ${c.label}: ${e.message}`); continue; }
    const dm = html.match(/\b(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (20\d\d)\b/);
    if (!dm) { console.log(`✗ ${c.label}: data non trovata`); continue; }
    const data = `${dm[3]}-${String(MONTHS.indexOf(dm[2]) + 1).padStart(2, '0')}-${String(dm[1]).padStart(2, '0')}`;
    if (year && dm[3] !== year) { console.log(`✗ ${c.label}: la pagina e' del ${dm[3]} (atteso ${year}), saltata`); continue; }
    const base = c.label.replace(/ \(TT\)/, ''), tt = /\(TT\)/.test(c.label), cl = CLASS[base];
    const nomeGara = `${EVENT} ${tt ? 'a cronometro' : 'su strada'} - ${cl.nome}`;
    const garaId = `${normId(nomeGara)}_${data}_${cl.cat}_${cl.gen}`;
    const catCode = `${cl.cat}_${cl.gen}`;
    const $ = cheerio.load(html);
    const table = $('table').toArray().find(t => { const h = $(t).find('th').map((_, e) => $(e).text().trim().toLowerCase()).get(); return h.includes('rnk') && h.includes('rider'); });
    if (!table) { console.log(`✗ ${c.label}: tabella non trovata`); continue; }
    const heads = $(table).find('th').map((_, e) => $(e).text().trim().toLowerCase()).get();
    const iPos = heads.indexOf('rnk'), iTeam = heads.indexOf('team');
    const rows = [];
    $(table).find('tbody tr').each((_, tr) => {
      const td = $(tr).find('td').toArray();
      const pos = parseInt($(td[iPos]).text().trim(), 10);
      const a = $(tr).find('a[href^="rider/"]').first();
      if (!pos || !a.length) return;                                    // DNF/DNS/OTL: niente posizione
      const rider = a.text().replace(/\s+/g, ' ').trim();
      const country = (iTeam >= 0 ? $(td[iTeam]).text() : '').replace(/\s+/g, ' ').trim();
      rows.push({ pos, rider, country });
    });
    let nNew = 0;
    for (const r of rows) {
      const { cognome, nome } = parseName(r.rider);
      let id = known.get(norm(cognome + ' ' + nome)) || known.get(norm(r.rider));
      const team = (COUNTRY_IT[r.country.toUpperCase()] || r.country.toUpperCase()) || 'ESTERO';
      if (!id) {
        id = makeId(cognome, nome);
        if (!knownIds.has(id)) { newProfiles.set(id, { cognome, nome, team, cat: catCode, gen: cl.gen }); nNew++; addKnown(id, cognome, nome); }
      }
      const base_ = BASE_PTS[r.pos] || 0;
      allRows.push({
        gara_id: garaId, posizione: r.pos, cognome: info[id]?.cognome || cognome, nome: info[id]?.nome ?? nome, atleta_id: id,
        team, team_id: normId(team), tempo: '', nome_gara: nomeGara, data, categoria: catCode, genere: cl.gen, tipo: 'internazionale',
        moltiplicatore: MULT, campionato_regionale: false, campionato_italiano: false, regione: '', km: '', media: '',
        punti_base: base_, punti_effettivi: base_ * MULT,
      });
    }
    tot += rows.length;
    const top3 = rows.slice(0, 3).map(r => `${r.pos}° ${r.rider} (${r.country})`).join(' · ');
    console.log(`✓ ${c.label.padEnd(8)} ${data}  ${String(rows.length).padStart(3)} classificati, ${String(nNew).padStart(3)} nuovi profili · ${top3}`);
  }
  console.log(`\nTotale: ${tot} risultati, ${newProfiles.size} nuovi profili atleta.`);
  if (!APPLY) { console.log('Anteprima: nulla è stato scritto. Aggiungi --apply per salvare.'); return; }

  // ── scrittura ──
  const profs = [...newProfiles.entries()].map(([id, p]) => ({
    entity_type: 'pcs_atleta', entity_id: id, field: 'profile', edited_by: null,
    new_value: JSON.stringify({ cognome: p.cognome, nome: p.nome, team_id: normId(p.team), team_nome: p.team, categoria: p.cat, genere: p.gen }),
  }));
  for (let i = 0; i < profs.length; i += 200) {
    const { error } = await sb.from('entity_overrides').upsert(profs.slice(i, i + 200), { onConflict: 'entity_type,entity_id,field' });
    if (error) throw new Error('profili: ' + error.message);
  }
  for (let i = 0; i < allRows.length; i += 200) {
    const { error } = await sb.from('manual_results').upsert(allRows.slice(i, i + 200).map(r => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: 'gara_id,posizione,atleta_id' });
    if (error) throw new Error('risultati: ' + error.message);
  }
  console.log(`Scritti ${profs.length} profili e ${allRows.length} risultati.`);
})().catch(e => { console.error('ERRORE:', e.message); process.exit(1); });
