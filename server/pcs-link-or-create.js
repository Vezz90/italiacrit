'use strict';
// Dopo un'importazione di arrivi PCS (gare pro): ogni corridore deve avere un profilo. Solo database, nessun accesso a PCS.
// Per ogni slug PCS degli arrivi senza atleta collegato:
//   1) ha gia lo slug su un nostro atleta -> collega le righe;
//   2) esiste un atleta con lo stesso nome (anche in ordine diverso, anche solo da ciclismo.info) -> gli assegna lo slug,
//      toglie "non su PCS" e collega;
//   3) altrimenti crea il profilo.
// Mette i collegati/creati in coda per il recupero degli anni (pcs-span-ids.json).
//   node pcs-link-or-create.js [--dry] [--season=2026]
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8').split('\n').forEach(l => { const m = l.match(/^([^#=\s]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2'); });
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const DRY = process.argv.includes('--dry');
const SEASON = ((process.argv.find(a => a.startsWith('--season=')) || '').split('=')[1]) || null;
const sb = createClient('https://aqqsstsbgpapzoxllosh.supabase.co', process.env.SUPABASE_SECRET, { realtime: { transport: ws } });
const idPart = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/['’`´]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const key = id => idPart(id).split('_').filter(Boolean).sort().join('_');
const REGIONAL = /^(italy|piemonte|emilia romagna|sardegna|umbria|lombardia|veneto|toscana|lazio|liguria|marche|abruzzo|puglia|campania|sicilia|friuli.*|trentino.*)$/i;

async function all(t, sel, f) {
  const o = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(t).select(sel).order('id').range(from, from + 999);
    if (f) q = f(q);
    const r = await q;
    if (r.error) throw r.error;
    o.push(...r.data);
    if (r.data.length < 1000) break;
  }
  return o;
}
async function hasHistory(id) { const q = await sb.from('ciclismo_results').select('id').eq('atleta_id', id).limit(1); return !!(q.data && q.data.length); }

(async () => {
  const slugRows = await all('entity_overrides', 'entity_id,new_value', q => q.eq('entity_type', 'atleta').eq('field', 'pcs_slug'));
  const slugToId = new Map(slugRows.map(x => [x.new_value, x.entity_id]));
  const known = new Map(); // chiave nome -> ids
  const addKnown = id => { const k = key(id); if (!known.has(k)) known.set(k, new Set()); known.get(k).add(id); };
  Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'athletes.json'), 'utf8'))).forEach(addKnown);
  (await all('entity_overrides', 'entity_id', q => q.in('entity_type', ['atleta', 'pcs_atleta']))).forEach(x => addKnown(x.entity_id));

  let races = (await sb.from('pro_races').select('pcs_race_slug,season,circuit,classe,nome,data_start,pcs_url,country')).data || [];
  if (SEASON) races = races.filter(r => String(r.season) === SEASON);
  const riders = new Map(); // pcs_slug -> {nome, team, country, female, rows}
  for (const r of races) {
    for (let from = 0; ; from += 1000) {
      const q = await sb.from('pcs_race_full_results').select('pcs_slug,atleta_id,nome_completo,team,country').eq('pcs_race_slug', r.pcs_race_slug).eq('season', r.season).range(from, from + 999);
      if (q.error) { console.log('errore', r.pcs_race_slug, q.error.message); break; }
      for (const x of q.data) {
        if (!x.pcs_slug || x.atleta_id) continue;
        const e = riders.get(x.pcs_slug) || { nome: x.nome_completo, team: x.team, country: x.country, female: true, rows: 0, races: new Set() };
        // donna solo se TUTTE le gare in cui compare sono femminili (classe WWT o nome/slug "women"...); "UWT" e una gara maschile
        if (!(/WWT$/i.test(r.classe || '') || /women|femmes|f[eé]minin|femenin|donne|vrouwen|dames|ladies/i.test((r.nome || '') + ' ' + r.pcs_race_slug))) e.female = false;
        e.rows++; e.races.add(r.pcs_race_slug + '|' + r.season);
        riders.set(x.pcs_slug, e);
      }
      if (q.data.length < 1000) break;
    }
  }
  console.log(`gare ${races.length} · corridori con righe senza profilo collegato: ${riders.size}`);

  const plan = { link: [], create: [], ambiguous: [] };
  for (const [slug, e] of riders) {
    if (slugToId.has(slug)) { plan.link.push({ slug, id: slugToId.get(slug), how: 'slug' }); continue; }
    // "MAGNIER Paul": parole tutte in maiuscolo = cognome, il resto = nome
    const tok = String(e.nome || '').trim().split(/\s+/);
    let k = tok.findIndex(t => t !== t.toUpperCase());
    if (k <= 0) k = tok.length > 1 ? tok.length - 1 : 1;
    const cognome = tok.slice(0, k).join(' ').toUpperCase(), nome = tok.slice(k).join(' ').toUpperCase();
    const id = `${idPart(cognome)}_${idPart(nome)}`;
    const cands = known.get(key(id));
    if (cands && cands.size >= 1) {
      // si collega per nome solo se lo slug non e di un omonimo (finisce con una cifra) e le parole dell'id e dello slug combaciano
      const st = new Set(slug.replace(/\d+$/, '').toUpperCase().split('-').filter(Boolean));
      const okOne = cands.size === 1 && !/\d$/.test(slug) && (() => { const it = idPart([...cands][0]).split('_').filter(Boolean); return it.every(t => st.has(t)) || [...st].every(t => it.includes(t)); })();
      if (okOne) plan.link.push({ slug, id: [...cands][0], how: 'nome' }); else plan.ambiguous.push({ slug, nome: e.nome, ids: [...cands] });
      continue;
    }
    if (await hasHistory(id)) { plan.link.push({ slug, id, how: 'storico' }); continue; }
    plan.create.push({ slug, id, cognome, nome, team: e.team, country: e.country, female: e.female });
  }
  console.log(`da collegare: ${plan.link.length} (slug ${plan.link.filter(x => x.how === 'slug').length}, nome ${plan.link.filter(x => x.how === 'nome').length}, storico ${plan.link.filter(x => x.how === 'storico').length}) · da creare: ${plan.create.length} · ambigui: ${plan.ambiguous.length}`);
  plan.link.filter(x => x.how !== 'slug').slice(0, 15).forEach(x => console.log('  collega', x.slug, '->', x.id, `[${x.how}]`));
  plan.create.slice(0, 15).forEach(x => console.log('  crea', x.id, x.team, x.country));
  plan.ambiguous.forEach(x => console.log('  AMBIGUO', x.slug, x.ids.join(' | ')));
  fs.writeFileSync(path.join(__dirname, 'pcs-link-or-create-plan.json'), JSON.stringify(plan, null, 1));
  if (DRY) return console.log('--dry: nessuna scrittura');

  const up = r => { if (r.error) console.log('ERRORE', r.error.message); };
  for (const c of plan.create) {
    const teamNome = c.team && !REGIONAL.test(c.team.trim()) ? c.team.trim().toUpperCase() : 'SCONOSCIUTO';
    up(await sb.from('entity_overrides').upsert({ entity_type: 'pcs_atleta', entity_id: c.id, field: 'profile', new_value: JSON.stringify({ cognome: c.cognome, nome: c.nome, team_id: idPart(teamNome), team_nome: teamNome, categoria: c.female ? 'ELI_F' : 'ELI_M', genere: c.female ? 'F' : 'M' }), edited_by: null }, { onConflict: 'entity_type,entity_id,field' }));
    plan.link.push({ slug: c.slug, id: c.id, how: 'nuovo' });
  }
  const span = path.join(__dirname, 'pcs-span-ids.json');
  const queue = fs.existsSync(span) ? JSON.parse(fs.readFileSync(span, 'utf8')) : [];
  for (const l of plan.link) {
    if (l.how !== 'slug') {
      up(await sb.from('entity_overrides').upsert({ entity_type: 'atleta', entity_id: l.id, field: 'pcs_slug', new_value: l.slug, edited_by: null }, { onConflict: 'entity_type,entity_id,field' }));
      await sb.from('entity_overrides').delete().eq('entity_type', 'atleta').eq('entity_id', l.id).eq('field', 'pcs_not_found');
      if (!queue.includes(l.id)) queue.push(l.id);
    }
    // collegamento delle righe: per gara, per evitare i timeout
    for (const rc of riders.get(l.slug).races) { const [rs, se] = rc.split('|'); up(await sb.from('pcs_race_full_results').update({ atleta_id: l.id }).eq('pcs_race_slug', rs).eq('season', Number(se)).eq('pcs_slug', l.slug).is('atleta_id', null)); }
  }
  fs.writeFileSync(span, JSON.stringify(queue));
  // le schede leggono i risultati da pcs_results: copia gli arrivi delle gare pro (stagioni elencate in pcs-pro-mirror.json) per chi non ha ancora la stagione recuperata;
  // il recupero degli anni (pcs-storico-fill-gaps.js) poi li sostituisce con i risultati completi
  let mirrored = 0;
  const ids = [...new Set(plan.link.map(l => l.id))];
  const realSeasons = new Set();
  const mirrorFile = path.join(__dirname, 'pcs-pro-mirror.json');
  const mirror = new Set(fs.existsSync(mirrorFile) ? JSON.parse(fs.readFileSync(mirrorFile, 'utf8')) : []);
  for (let i = 0; i < ids.length; i += 100) {
    const q = await sb.from('pcs_results').select('atleta_id,season').in('atleta_id', ids.slice(i, i + 100));
    for (const x of q.data || []) if (!mirror.has(x.atleta_id + '|' + x.season)) realSeasons.add(x.atleta_id + '|' + x.season);
  }
  for (const r of races) {
    for (let from = 0; ; from += 1000) {
      const q = await sb.from('pcs_race_full_results').select('atleta_id,pcs_slug,posizione,distacco,country').eq('pcs_race_slug', r.pcs_race_slug).eq('season', r.season).not('atleta_id', 'is', null).not('posizione', 'is', null).range(from, from + 999);
      const rows = (q.data || []).filter(x => ids.includes(x.atleta_id) && !realSeasons.has(x.atleta_id + '|' + r.season)).map(x => ({ atleta_id: x.atleta_id, pcs_slug: x.pcs_slug, season: r.season, gara_name: r.nome, data: r.data_start, posizione: x.posizione, distacco: x.distacco, pcs_race_slug: r.pcs_race_slug, gara_id: null, country: r.country || 'it', pcs_url: r.pcs_url }));
      if (rows.length) { const u = await sb.from('pcs_results').upsert(rows, { onConflict: 'atleta_id,season,pcs_race_slug', ignoreDuplicates: true }); up(u); mirrored += rows.length; rows.forEach(x => mirror.add(x.atleta_id + '|' + x.season)); }
      if (!q.data || q.data.length < 1000) break;
    }
  }
  fs.writeFileSync(mirrorFile, JSON.stringify([...mirror]));
  console.log('righe copiate sulle schede:', mirrored);
  console.log('fatto · in coda per il recupero anni:', queue.length);
})().catch(e => { console.error(e); process.exit(1); });
