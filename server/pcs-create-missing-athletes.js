'use strict';
// Crea i profili degli italiani presenti negli arrivi PCS che non hanno nessun profilo da noi (elenco: pcs-italiani-2026-senza-profilo-v2.csv).
// Per ognuno: profilo pcs_atleta (come fa il server per i "fantasma"), slug PCS, collegamento delle righe di arrivo gia' salvate e
// file per l'importazione di foto, social e risultati (pcs-athlete-import.js --ids-file) e per il recupero degli anni (pcs-span-ids.json).
//   node pcs-create-missing-athletes.js [--dry]
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8').split('\n').forEach(l => { const m = l.match(/^([^#=\s]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2'); });
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const DRY = process.argv.includes('--dry');
const sb = createClient('https://aqqsstsbgpapzoxllosh.supabase.co', process.env.SUPABASE_SECRET, { realtime: { transport: ws } });
const strip = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’`´]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const idPart = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/['’`´]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
// donne dell'elenco (verificate a mano sui nomi); tutti gli altri sono uomini
const FEMALE = new Set(['gariboldi-rebecca', 'rebecca-gariboldi', 'barbon-emma', 'vianello-isabella', 'pelanda-giada', 'pasini-bianca', 'pasquali-giusy', 'policarpo-giuseppina', 'corvi-valentina', 'piccaluga-sabrina', 'riebler-alice', 'zingerle-sophia', 'fondriest-carlotta', 'marchet-giorgia']);
const REGIONAL = /^(italy|piemonte|emilia romagna|sardegna|umbria|lombardia|veneto|toscana|lazio|liguria|marche|abruzzo|puglia|campania|sicilia|friuli.*|trentino.*)$/i;

(async () => {
  const rows = fs.readFileSync(path.join(__dirname, 'pcs-italiani-2026-senza-profilo-v2.csv'), 'utf8').split('\n').slice(1).filter(Boolean).map(l => l.split(';'));
  const entries = [], profiles = [], slugOv = [];
  // hanno gia' un probabile profilo con un nome in piu' (da verificare, non si crea un doppione) + un nome ambiguo (cognome/nome invertiti su PCS)
  const SKIP = new Set(['paolo-marangon', 'michele-cacchio', 'brandon-fedrizzi', 'matteo-bozicevich', 'anna-longo-borghini', 'enrico-andrea-balliana', 'guido-viero', 'laura-benuzzi', 'giuseppe-de-laurentis', 'leonardo-bianchi', 'marco-aurelio-fontana', 'galupo-alessio']);
  for (const [nome_completo, team, , slug] of rows) {
    if (SKIP.has(slug)) continue;
    const tok = nome_completo.trim().split(/\s+/), st = slug.split('-');
    // PCS scrive "Cognome Nome" ma lo slug e' "nome-cognome": la divisione giusta e' quella per cui slug = parole dopo + parole prima
    let cognomeW = null, nomeW = null;
    for (let k = 1; k < tok.length; k++) {
      const cand = strip(tok.slice(k).join(' ') + ' ' + tok.slice(0, k).join(' '));
      if (cand === slug) { cognomeW = tok.slice(0, k); nomeW = tok.slice(k); break; }
    }
    if (!cognomeW) { cognomeW = tok.slice(0, tok.length - 1); nomeW = tok.slice(-1); }
    const cognome = cognomeW.join(' ').toUpperCase(), nome = nomeW.join(' ').toUpperCase();
    const id = `${idPart(cognome)}_${idPart(nome)}`;
    const genere = FEMALE.has(slug) || FEMALE.has(strip(nome_completo)) ? 'F' : 'M';
    const teamNome = team && !REGIONAL.test(team.trim()) ? team.trim().toUpperCase() : 'SCONOSCIUTO';
    const teamId = idPart(teamNome);
    entries.push({ atleta_id: id, slug, cognome, nome });
    profiles.push({ entity_type: 'pcs_atleta', entity_id: id, field: 'profile', new_value: JSON.stringify({ cognome, nome, team_id: teamId, team_nome: teamNome, categoria: genere === 'F' ? 'ELI_F' : 'ELI_M', genere }), edited_by: null });
    slugOv.push({ entity_type: 'atleta', entity_id: id, field: 'pcs_slug', new_value: slug, edited_by: null });
    console.log(`${id.padEnd(34)} ${genere} ${teamNome.padEnd(36)} [${slug}]`);
  }
  if (DRY) { console.log(`\n--dry: ${entries.length} profili, nessuna scrittura`); return; }
  // non toccare chi esiste gia'
  const exist = new Set();
  for (let i = 0; i < entries.length; i += 50) {
    const q = await sb.from('entity_overrides').select('entity_id').in('entity_id', entries.slice(i, i + 50).map(e => e.atleta_id));
    (q.data || []).forEach(x => exist.add(x.entity_id));
  }
  const fresh = entries.filter(e => !exist.has(e.atleta_id));
  console.log(`\nGia' presenti come override (saltati): ${entries.length - fresh.length}`);
  const keep = new Set(fresh.map(e => e.atleta_id));
  let r1 = await sb.from('entity_overrides').upsert(profiles.filter(p => keep.has(p.entity_id)), { onConflict: 'entity_type,entity_id,field' });
  let r2 = await sb.from('entity_overrides').upsert(slugOv.filter(p => keep.has(p.entity_id)), { onConflict: 'entity_type,entity_id,field' });
  console.log('profili:', r1.error ? 'ERRORE ' + r1.error.message : 'ok', '· slug:', r2.error ? 'ERRORE ' + r2.error.message : 'ok');
  // collega le righe di arrivo gia' salvate
  let linked = 0;
  for (const e of fresh) {
    const a = await sb.from('pcs_race_full_results').update({ atleta_id: e.atleta_id }).eq('pcs_slug', e.slug).is('atleta_id', null).select('id');
    linked += (a.data || []).length;
  }
  console.log('righe di arrivo collegate:', linked);
  fs.writeFileSync(path.join(__dirname, 'pcs-create-ids.json'), JSON.stringify(fresh));
  const f = path.join(__dirname, 'pcs-span-ids.json');
  const span = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
  for (const e of fresh) if (!span.includes(e.atleta_id)) span.push(e.atleta_id);
  fs.writeFileSync(f, JSON.stringify(span));
  console.log(`creati: ${fresh.length}`);
})().catch(e => { console.error(e); process.exit(1); });
