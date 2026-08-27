'use strict';
// Genera gli "screenshot" statici delle pagine storiche ciclismo.info
// (Classifica e Risultati) — stessa idea del sistema nativo 2026
// (data/seasons/{anno}/*.json): file pre-calcolati serviti dalla CDN invece
// di interrogare Supabase ad ogni navigazione, che per gli anni storici è
// sempre stato il vero collo di bottiglia (le stesse query pesanti rifatte
// identiche ad ogni visita, anche quando i dati non cambiano mai).
//
// Rigenerazione INCREMENTALE per anno: se in futuro un admin corregge un
// risultato storico, si rilancia solo per quell'anno — non serve rifare
// tutto l'archivio 2007-2025.
//
// Stessa logica di calcolo di /api/ciclismo-results/classifica e
// /api/ciclismo-results/races in server.js (duplicata qui invece che
// importata: questo è uno script standalone, non l'app Express).
//
// Uso:
//   node generate-ciclismo-snapshot.js              (tutti gli anni 2007-2025)
//   node generate-ciclismo-snapshot.js 2019         (solo il 2019)
//   node generate-ciclismo-snapshot.js 2019 2021    (intervallo 2019-2021)

(() => {
  const fs = require('fs'), path = require('path');
  const p = path.join(__dirname, '.env.local');
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }
})();

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const SUPABASE_URL = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta SUPABASE_SECRET in server/.env.local'); process.exit(1); }

const OUT_DIR = path.join(__dirname, '..', 'data', 'ciclismo-storico');

// Stessa regex usata ovunque nel resto del progetto per l'id numerico
// ciclismo.info dall'URL gara.
function ciclismoGaraId(url) {
  const m = String(url || '').match(/_(\d+)_(\d{4})_(\d{2})_(\d{2})_/);
  return m ? m[1] : null;
}

async function generateClassifica(sb, anno) {
  const data = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await sb.from('ciclismo_results')
      .select('ciclismo_id, atleta_id, categoria, team, punti_stagione')
      .eq('stagione', anno).not('punti_stagione', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!page || !page.length) break;
    data.push(...page);
    if (page.length < PAGE) break;
  }

  const byAthlete = new Map();
  for (const r of data) {
    if (!r.ciclismo_id || !r.categoria) continue;
    byAthlete.set(r.ciclismo_id, r);
  }
  const allCiclismoIds = [...byAthlete.keys()];
  let nomeById = new Map();
  const CHUNK = 300;
  for (let i = 0; i < allCiclismoIds.length; i += CHUNK) {
    const chunk = allCiclismoIds.slice(i, i + CHUNK);
    const { data: athData, error: athErr } = await sb.from('ciclismo_athletes').select('ciclismo_id, nome_completo').in('ciclismo_id', chunk);
    if (athErr) continue;
    for (const a of (athData || [])) nomeById.set(a.ciclismo_id, a.nome_completo);
  }
  const classifica = {};
  for (const r of byAthlete.values()) {
    if (!classifica[r.categoria]) classifica[r.categoria] = [];
    classifica[r.categoria].push({
      ciclismo_id: r.ciclismo_id, atleta_id: r.atleta_id,
      nome_completo: nomeById.get(r.ciclismo_id) || r.ciclismo_id,
      team: r.team, punti: r.punti_stagione,
    });
  }
  for (const cat of Object.keys(classifica)) {
    classifica[cat].sort((a, b) => b.punti - a.punti);
    classifica[cat].forEach((r, i) => { r.pos = i + 1; });
  }
  return { classifica };
}

async function generateRaces(sb, anno) {
  const data = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await sb.from('ciclismo_results')
      .select('gara_ciclismo_url, nome_gara, data, categoria, regione, luogo, posizione, atleta_id, ciclismo_id, team')
      .eq('stagione', anno).not('gara_ciclismo_url', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!page || !page.length) break;
    data.push(...page);
    if (page.length < PAGE) break;
  }

  const byUrl = new Map();
  for (const r of data) {
    const gid = ciclismoGaraId(r.gara_ciclismo_url);
    if (!gid) continue;
    if (!byUrl.has(gid)) {
      byUrl.set(gid, { id: gid, nome: r.nome_gara, data: r.data, regione: r.regione, luogo: r.luogo, url: r.gara_ciclismo_url, byCategory: new Map(), n_partecipanti: 0 });
    }
    const ev = byUrl.get(gid);
    ev.n_partecipanti++;
    if (!r.categoria) continue;
    if (!ev.byCategory.has(r.categoria)) ev.byCategory.set(r.categoria, []);
    if (r.posizione) ev.byCategory.get(r.categoria).push({ posizione: r.posizione, atleta_id: r.atleta_id, ciclismo_id: r.ciclismo_id, team: r.team });
  }

  const allCiclismoIds = new Set();
  for (const ev of byUrl.values()) for (const rows of ev.byCategory.values()) for (const r of rows) if (r.ciclismo_id) allCiclismoIds.add(r.ciclismo_id);
  let nomeById = new Map();
  const idsArr = [...allCiclismoIds];
  const CHUNK = 300;
  for (let i = 0; i < idsArr.length; i += CHUNK) {
    const chunk = idsArr.slice(i, i + CHUNK);
    const { data: athData } = await sb.from('ciclismo_athletes').select('ciclismo_id, nome_completo').in('ciclismo_id', chunk);
    for (const a of (athData || [])) nomeById.set(a.ciclismo_id, a.nome_completo);
  }

  const races = [...byUrl.values()].map(ev => {
    const categorie = {};
    for (const [cat, rows] of ev.byCategory) {
      // Dedup per atleta prima del taglio al podio — stessa protezione
      // applicata all'endpoint live (vedi server.js), per lo stesso motivo:
      // una riga letta due volte non deve mostrare il "1°" ripetuto.
      const seen = new Set();
      const deduped = rows.filter(r => {
        const key = r.ciclismo_id || r.atleta_id;
        if (!key) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const top3 = deduped.sort((a, b) => a.posizione - b.posizione).slice(0, 3)
        .map(r => ({ posizione: r.posizione, atleta_id: r.atleta_id, nome_completo: nomeById.get(r.ciclismo_id) || r.ciclismo_id, team: r.team }));
      categorie[cat] = top3;
    }
    return { id: ev.id, nome: ev.nome, data: ev.data, regione: ev.regione, luogo: ev.luogo, url: ev.url, n_partecipanti: ev.n_partecipanti, categorie };
  }).sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  try {
    const { data: mediaData } = await sb.from('ciclismo_gara_media')
      .select('gara_ciclismo_url, photo_url').eq('stagione', anno).not('photo_url', 'is', null).limit(5000);
    const photoByUrl = new Map();
    for (const m of (mediaData || [])) if (!photoByUrl.has(m.gara_ciclismo_url)) photoByUrl.set(m.gara_ciclismo_url, m.photo_url);
    for (const r of races) if (photoByUrl.has(r.url)) r.photo_url = photoByUrl.get(r.url);
  } catch { /* foto opzionale */ }

  return { races };
}

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });
  const args = process.argv.slice(2).map(Number).filter(n => !isNaN(n));
  let years;
  if (args.length === 0) years = Array.from({ length: 2025 - 2007 + 1 }, (_, i) => 2007 + i);
  else if (args.length === 1) years = [args[0]];
  else years = Array.from({ length: args[1] - args[0] + 1 }, (_, i) => args[0] + i);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Genero snapshot per ${years.length} anno/i: ${years.join(', ')}\n`);

  for (const anno of years) {
    const dir = path.join(OUT_DIR, String(anno));
    fs.mkdirSync(dir, { recursive: true });

    const classificaData = await generateClassifica(sb, anno);
    const nAthletes = Object.values(classificaData.classifica).reduce((s, arr) => s + arr.length, 0);
    fs.writeFileSync(path.join(dir, 'classifica.json'), JSON.stringify(classificaData));
    console.log(`[${anno}] classifica.json: ${Object.keys(classificaData.classifica).length} categorie, ${nAthletes} atleti`);

    const racesData = await generateRaces(sb, anno);
    fs.writeFileSync(path.join(dir, 'races.json'), JSON.stringify(racesData));
    console.log(`[${anno}] races.json: ${racesData.races.length} gare`);
  }

  console.log('\n=== FATTO ===');
}

main().catch(e => { console.error('ERRORE FATALE:', e); process.exit(1); });
