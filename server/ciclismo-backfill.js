'use strict';
// Backfill storico ciclismo.info: TUTTE le stagioni (2007-anno corrente) x
// TUTTE le categorie, con matching contro il database italiacrit esistente,
// scrittura diretta su Supabase (ciclismo_athletes + ciclismo_results) e
// import foto (credit ciclismo.info) per gli atleti senza foto già presente.
//
// Riprendibile: salva lo stato di avanzamento (anno+categoria completati) in
// ciclismo_backfill_state, così un rilancio salta il già fatto.
//
// Uso: node ciclismo-backfill.js [annoInizio] [annoFine]

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
const iconvLite = (() => { try { return require('iconv-lite'); } catch { return null; } })();
const { fetchDecoded, parseClassificaPage, parseAthletePage, decodeEntities } = require('./ciclismo-info-test.js');

const SUPABASE_URL = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta SUPABASE_SECRET in server/.env.local'); process.exit(1); }

const CATEGORIE = ['donne-esordienti', 'donne-allieve', 'donne-juniores', 'esordienti', 'allievi', 'juniores', 'elite-under23'];
const DELAY_MS = 300;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizeToAtletaId(nomeCompleto) {
  return String(nomeCompleto || '')
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function fetchDecodedSafe(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return { status: res.status, html: null };
    const buf = Buffer.from(await res.arrayBuffer());
    const html = iconvLite ? iconvLite.decode(buf, 'win1252') : buf.toString('latin1');
    return { status: res.status, html };
  } catch (e) { return { status: 0, html: null, error: e.message }; }
}

async function main() {
  const annoInizio = parseInt(process.argv[2]) || 2007;
  const annoFine = parseInt(process.argv[3]) || new Date().getFullYear();
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  console.log(`=== Backfill ciclismo.info: ${annoInizio}-${annoFine}, categorie: ${CATEGORIE.join(', ')} ===\n`);

  // Master list italiacrit per il matching
  const italiacritAthletes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'athletes.json'), 'utf8'));
  const italiacritIds = new Set(Object.keys(italiacritAthletes));
  console.log(`Atleti italiacrit di riferimento: ${italiacritIds.size}\n`);

  // Stato già completato (riprendibilità)
  const { data: doneRows } = await sb.from('ciclismo_backfill_state').select('id').eq('status', 'done');
  const doneSet = new Set((doneRows || []).map(r => r.id));
  console.log(`Combinazioni anno+categoria già completate: ${doneSet.size}\n`);

  let totAtleti = 0, totRisultati = 0, totMatch = 0, totNuovi = 0, totFoto = 0, totErrori = 0;

  for (let anno = annoFine; anno >= annoInizio; anno--) {
    for (const cat of CATEGORIE) {
      const stateId = `${anno}_${cat}`;
      if (doneSet.has(stateId)) { console.log(`[skip] ${stateId} già fatto`); continue; }

      const classUrl = `http://${cat}.ciclismo.info/classifica_${cat}_${anno}.htm`;
      const { status, html } = await fetchDecodedSafe(classUrl);
      if (!html) {
        console.log(`[classifica] ${stateId}: HTTP ${status}, salto`);
        await sb.from('ciclismo_backfill_state').upsert({ id: stateId, anno, categoria: cat, status: 'skip-404' });
        await sleep(DELAY_MS);
        continue;
      }
      const { classifica } = parseClassificaPage(html);
      console.log(`[classifica] ${stateId}: ${classifica.length} atleti`);
      await sleep(DELAY_MS);

      for (const a of classifica) {
        if (!a.ciclismoId) continue;
        totAtleti++;
        const schedaUrl = `http://${cat}.ciclismo.info${a.schedaUrl}`;
        const { html: athHtml } = await fetchDecodedSafe(schedaUrl);
        await sleep(DELAY_MS);
        if (!athHtml) { totErrori++; continue; }

        let scheda;
        try { scheda = parseAthletePage(athHtml, schedaUrl); }
        catch (e) { totErrori++; continue; }

        const atletaId = normalizeToAtletaId(scheda.nomeCompleto || a.nome);
        if (!atletaId) continue;
        const matched = italiacritIds.has(atletaId);
        if (matched) totMatch++; else totNuovi++;

        // Foto: solo se manca già una foto per questo atleta (non sovrascrivere
        // una foto FCI/PCS esistente) — credito ciclismo.info esplicito.
        let photoUrl = null;
        const photoMatch = athHtml.match(/\/immagini\/corridore_[a-z0-9_]+\.jpg/i);
        if (photoMatch) {
          try {
            const { data: existing } = await sb.from('entity_overrides')
              .select('new_value').eq('entity_type', 'atleta').eq('entity_id', atletaId)
              .eq('field', 'photo_url').maybeSingle();
            if (!existing || !existing.new_value) {
              const photoRes = await fetch(`http://${cat}.ciclismo.info${photoMatch[0]}`);
              if (photoRes.ok) {
                const buf = Buffer.from(await photoRes.arrayBuffer());
                if (buf.length > 500) {
                  const storagePath = `atletas/ciclismo/${a.ciclismoId}.jpg`;
                  const { error: upErr } = await sb.storage.from('photos')
                    .upload(storagePath, buf, { contentType: 'image/jpeg', upsert: true });
                  if (!upErr) {
                    photoUrl = `/photos/${storagePath}`;
                    await sb.from('entity_overrides').upsert([
                      { entity_type: 'atleta', entity_id: atletaId, field: 'photo_url', new_value: photoUrl },
                      { entity_type: 'atleta', entity_id: atletaId, field: 'photo_credit', new_value: 'ciclismo.info' },
                    ], { onConflict: 'entity_type,entity_id,field' });
                    totFoto++;
                  }
                }
              }
            }
          } catch { /* foto opzionale, non bloccare l'import */ }
        }

        // Upsert atleta (nascita)
        await sb.from('ciclismo_athletes').upsert({
          ciclismo_id: a.ciclismoId,
          atleta_id: matched ? atletaId : null,
          nome_completo: scheda.nomeCompleto,
          data_nascita: scheda.natoIl,
          photo_url: photoUrl,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'ciclismo_id' });

        // Upsert risultati di QUESTO anno
        const rows = scheda.piazzamenti.map(pl => ({
          ciclismo_id: a.ciclismoId,
          atleta_id: matched ? atletaId : null,
          stagione: String(anno),
          categoria: scheda.categoria,
          team: scheda.team,
          posizione: pl.posizione,
          data: pl.data,
          regione: pl.regione,
          luogo: pl.luogo,
          nome_gara: pl.nomeGara,
          gara_ciclismo_url: pl.garaUrl,
          km: pl.km,
        }));
        if (rows.length) {
          const { error } = await sb.from('ciclismo_results').upsert(rows, { onConflict: 'ciclismo_id,stagione,data,nome_gara' });
          if (error) { totErrori++; }
          else totRisultati += rows.length;
        }
      }

      await sb.from('ciclismo_backfill_state').upsert({ id: stateId, anno, categoria: cat, status: 'done' });
      console.log(`  -> fatto ${stateId} | totali finora: atleti=${totAtleti} risultati=${totRisultati} match=${totMatch} nuovi=${totNuovi} foto=${totFoto} errori=${totErrori}`);
    }
  }

  console.log(`\n=== BACKFILL COMPLETATO ===`);
  console.log(`Atleti processati: ${totAtleti} | Match italiacrit: ${totMatch} | Nuovi: ${totNuovi}`);
  console.log(`Risultati importati: ${totRisultati} | Foto importate: ${totFoto} | Errori: ${totErrori}`);
}

main().catch(e => { console.error('ERRORE FATALE:', e); process.exit(1); });
