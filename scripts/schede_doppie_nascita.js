#!/usr/bin/env node
/**
 * Confronta la DATA DI NASCITA delle coppie di schede doppie: quella su PCS (pagina del corridore della scheda doppia)
 * e quella nell'archivio ciclismo.info (ciclismo_athletes) della scheda vera. Stessa data = stessa persona; anni diversi
 * = persone diverse (anche se il nome e' simile). Non modifica nulla. Scrive schede_doppie_nascita.json.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..'), SERVER = path.join(ROOT, 'server');
for (const line of fs.readFileSync(path.join(SERVER, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require(path.join(SERVER, 'node_modules', '@supabase', 'supabase-js'));
const cheerio = require(path.join(SERVER, 'node_modules', 'cheerio'));
const ws = require(path.join(SERVER, 'node_modules', 'ws'));
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET, { realtime: { transport: ws } });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EN = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const IT = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };

function pcsBirth(slug) {
  try {
    const html = execFileSync('curl', ['-s', '-L', '-m', '30', '-A', UA, `https://www.procyclingstats.com/rider/${slug}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const txt = cheerio.load(html)('body').text().replace(/\s+/g, ' ');
    const m = txt.match(/Date of birth:\s*(\d{1,2})(?:st|nd|rd|th)\s*([A-Za-z]+)\s*(\d{4})/i);
    if (m && EN[m[2].toLowerCase()]) return { y: +m[3], m: EN[m[2].toLowerCase()], d: +m[1] };
  } catch (_) {}
  return null;
}
function itBirth(s) {
  const m = String(s || '').match(/(\d{1,2})\s+([A-Za-zàù]+)\s+(\d{4})/);
  return m && IT[m[2].toLowerCase()] ? { y: +m[3], m: IT[m[2].toLowerCase()], d: +m[1] } : null;
}
const fmt = b => b ? `${String(b.d).padStart(2, '0')}/${String(b.m).padStart(2, '0')}/${b.y}` : '—';

(async () => {
  const pairs = JSON.parse(fs.readFileSync(path.join(ROOT, 'schede_doppie_verifica.json'), 'utf8'));
  let alias = {}; try { alias = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'atleti_alias.json'), 'utf8')); } catch (_) {}
  // slug PCS delle schede doppie (anche di quelle gia' unite: dalla versione di extra_roster prima delle unioni)
  const slugs = new Map();
  const addRoster = obj => { for (const b of Object.values(obj)) for (const a of (b.atleti || [])) if (a.pcs_slug) slugs.set(a.atleta_id, a.pcs_slug); };
  try { addRoster(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'extra_roster.json'), 'utf8'))); } catch (_) {}
  try { addRoster(JSON.parse(execFileSync('git', ['show', '6db312ff:data/extra_roster.json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))); } catch (_) {}
  const out = [];
  for (const p of pairs) {
    let slug = slugs.get(p.dup);
    if (!slug) { const { data } = await sb.from('pcs_results').select('pcs_slug').eq('atleta_id', p.dup).not('pcs_slug', 'is', null).limit(1); slug = data && data[0] && data[0].pcs_slug; }
    const { data: cr } = await sb.from('ciclismo_athletes').select('data_nascita').eq('atleta_id', p.vera).maybeSingle();
    const real = itBirth(cr && cr.data_nascita);
    let pcs = null;
    if (slug) { await sleep(900); pcs = pcsBirth(slug); }
    let verdict = 'non verificabile';
    if (pcs && real) verdict = (pcs.y === real.y && pcs.m === real.m && pcs.d === real.d) ? 'STESSA PERSONA' : (pcs.y === real.y ? 'stesso anno, giorno diverso' : 'PERSONE DIVERSE');
    out.push({ dup: p.dup, vera: p.vera, unita: !!alias[p.dup], slug: slug || null, nascitaPCS: fmt(pcs), nascitaIC: fmt(real), verdict });
    process.stdout.write('.');
  }
  fs.writeFileSync(path.join(ROOT, 'schede_doppie_nascita.json'), JSON.stringify(out, null, 1));
  const by = {}; out.forEach(o => { const k = (o.unita ? 'gia unite: ' : 'ancora separate: ') + o.verdict; by[k] = (by[k] || 0) + 1; });
  console.log('\n', by);
})().catch(e => { console.error('ERRORE:', e.message); process.exit(1); });
