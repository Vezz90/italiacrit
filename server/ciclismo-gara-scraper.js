'use strict';
// Scraper delle pagine GARA di ciclismo.info (non delle schede atleta) — colma
// un buco strutturale: l'enumerazione classifica-driven di ciclismo-backfill.js
// scopre le gare SOLO passando dagli atleti già in classifica nazionale, quindi
// un corridore isolato (es. straniero, mai in classifica italiana) o un
// piazzamento alto ma il cui atleta non è mai stato riscoperto resta invisibile
// anche se la pagina reale della gara lo riporta. La sezione "ORDINE DI ARRIVO"
// di ogni pagina gara pubblica i primi 10 (verificato dal vivo), indipendente
// dalla classifica: qui si rilegge quella sezione per ogni gara già nota e si
// inseriscono le posizioni 1-10 mancanti.
//
// Riprendibile: salta le gare già scansionate (ciclismo_gara_scan_state).
//
// Uso: node ciclismo-gara-scraper.js [--rescan]   (--rescan ignora lo stato e ricontrolla tutto)

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
const { fetchDecoded, parseGaraPage } = require('./ciclismo-info-test.js');

const SUPABASE_URL = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta SUPABASE_SECRET in server/.env.local'); process.exit(1); }

const RESCAN = process.argv.includes('--rescan');
const DELAY_MS = 300;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizeToAtletaId(nomeCompleto) {
  return String(nomeCompleto || '')
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Stessa mappa di ciclismo-create-profiles.js / ciclismo-backfill.js.
const CAT_MAP = {
  ESORDIENTI1: 'ES1_M', ESORDIENTI2: 'ES2_M', ALLIEVI: 'AL_M', JUNIORES: 'JUN_M', ELITE_UNDER23: 'ELI_M',
  DONNE_ESORDIENTI: 'AL_F', DONNE_ALLIEVE: 'AL_F', DONNE_JUNIORES: 'JUN_F',
};

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  const italiacritAthletes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'athletes.json'), 'utf8'));
  const italiacritIds = new Set(Object.keys(italiacritAthletes));

  // manual_athletes già create (es. da ciclismo-create-profiles.js) — un match
  // qui riusa quel profilo invece di lasciare la riga senza atleta_id.
  const manualIds = new Set();
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from('manual_athletes').select('atleta_id').range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || !data.length) break;
      data.forEach(r => manualIds.add(r.atleta_id));
      if (data.length < PAGE) break;
    }
  }
  console.log(`Atleti italiacrit: ${italiacritIds.size} | Profili manuali già creati: ${manualIds.size}\n`);

  const teams = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'teams.json'), 'utf8'));
  const teamIdByName = new Map(Object.values(teams).map(t => [String(t.nome || '').trim().toUpperCase(), t.id]));

  // Elenco gare già note (una riga campione per gara, per i metadati) —
  // stessa enumerazione paginata di ciclismo-gara-media.js.
  const garaSet = new Map();
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from('ciclismo_results')
        .select('gara_ciclismo_url, stagione, nome_gara, categoria, data, regione, luogo')
        .not('gara_ciclismo_url', 'is', null)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || !data.length) break;
      for (const r of data) if (!garaSet.has(r.gara_ciclismo_url)) garaSet.set(r.gara_ciclismo_url, r);
      if (data.length < PAGE) break;
    }
  }

  let doneSet = new Set();
  if (!RESCAN) {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from('ciclismo_gara_scan_state').select('gara_ciclismo_url').range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || !data.length) break;
      data.forEach(r => doneSet.add(r.gara_ciclismo_url));
      if (data.length < PAGE) break;
    }
  }

  const todo = [...garaSet.entries()].filter(([url]) => !doneSet.has(url));
  console.log(`Gare totali note: ${garaSet.size} | già scansionate: ${doneSet.size} | da fare: ${todo.length}\n`);

  let checked = 0, gareConBuchi = 0, righeInserite = 0, atletiNuovi = 0, errori = 0;

  for (const [url, sample] of todo) {
    checked++;
    try {
      const html = await fetchDecoded(url);
      const { ordineArrivo } = parseGaraPage(html, url);

      if (!ordineArrivo.length) {
        await sb.from('ciclismo_gara_scan_state').upsert({ gara_ciclismo_url: url, status: 'no-data', trovati: 0, inseriti: 0 });
        await sleep(DELAY_MS);
        continue;
      }

      // Righe già presenti per QUESTA gara+stagione (per evitare doppioni per
      // posizione E per atleta, stesso ragionamento del gap-fill lato client).
      const { data: existing } = await sb.from('ciclismo_results')
        .select('posizione, atleta_id, ciclismo_id')
        .eq('gara_ciclismo_url', url).eq('stagione', sample.stagione);
      const havePos = new Set((existing || []).map(r => r.posizione));
      const haveCiclismoId = new Set((existing || []).map(r => r.ciclismo_id));

      let inseritiQui = 0;
      for (const row of ordineArrivo) {
        if (!row.ciclismoId || havePos.has(row.posizione) || haveCiclismoId.has(row.ciclismoId)) continue;

        const nomeCompleto = row.nome;
        const atletaIdDerivato = normalizeToAtletaId(nomeCompleto);
        const matched = italiacritIds.has(atletaIdDerivato) || manualIds.has(atletaIdDerivato);

        // Upsert atleta ciclismo.info (stesso pattern difensivo di
        // ciclismo-backfill.js: atleta_id incluso SOLO se matched, altrimenti
        // un upsert incondizionato rischia di azzerare un link già fatto in
        // un secondo momento da ciclismo-create-profiles.js).
        const athPayload = { ciclismo_id: row.ciclismoId, nome_completo: nomeCompleto, updated_at: new Date().toISOString() };
        if (matched) athPayload.atleta_id = atletaIdDerivato;
        const { data: existingAth } = await sb.from('ciclismo_athletes').select('atleta_id').eq('ciclismo_id', row.ciclismoId).maybeSingle();
        if (!existingAth) atletiNuovi++;
        await sb.from('ciclismo_athletes').upsert(athPayload, { onConflict: 'ciclismo_id' });

        // Atleta_id AUTORITATIVO: 'matched' controlla solo italiacritIds/
        // manualIds caricati UNA VOLTA all'avvio — un link fatto DOPO (da
        // ciclismo-create-profiles.js o dal tool admin rimatch, mentre questo
        // script gira) non risulterebbe "matched" qui pur essendo già
        // collegato su ciclismo_athletes: si usa quel valore già letto sopra
        // come fallback, stessa correzione fatta su ciclismo-backfill.js
        // dopo il bug reale trovato dal vivo (22.184 righe orfane).
        let finalAtletaId = matched ? atletaIdDerivato : ((existingAth && existingAth.atleta_id) || null);

        // Profilo mancante: crealo subito (stessa correzione fatta su
        // ciclismo-backfill.js) — altrimenti il corridore resta orfano, non
        // cliccabile e senza avatar sulla pagina gara finché qualcuno non
        // rilancia ciclismo-create-profiles.js a mano.
        if (!finalAtletaId) {
          const { data: existingManual } = await sb.from('manual_athletes').select('atleta_id').eq('atleta_id', atletaIdDerivato).maybeSingle();
          if (existingManual) {
            finalAtletaId = atletaIdDerivato;
          } else {
            const nomeParts = String(nomeCompleto || '').trim().split(/\s+/);
            const cognome = nomeParts[0] || nomeCompleto;
            const nomeP = nomeParts.slice(1).join(' ') || '-';
            const catRaw = sample.categoria || '';
            const genere = /DONNE/i.test(catRaw) ? 'F' : 'M';
            const categoria = CAT_MAP[catRaw] || (genere === 'F' ? 'AL_F' : 'AL_M');
            const team = row.team || null;
            const team_id = team
              ? (teamIdByName.get(team.trim().toUpperCase())
                || team.trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
              : null;
            const { error: profErr } = await sb.from('manual_athletes').upsert({
              atleta_id: atletaIdDerivato, cognome, nome: nomeP, team_id, team, categoria, genere,
              created_by: null, source: 'ciclismo_info',
            }, { onConflict: 'atleta_id', ignoreDuplicates: true });
            if (!profErr) finalAtletaId = atletaIdDerivato;
          }
          if (finalAtletaId) await sb.from('ciclismo_athletes').update({ atleta_id: finalAtletaId }).eq('ciclismo_id', row.ciclismoId);
        }

        const { error: insErr } = await sb.from('ciclismo_results').upsert({
          ciclismo_id: row.ciclismoId,
          atleta_id: finalAtletaId,
          stagione: sample.stagione, categoria: sample.categoria, team: row.team,
          posizione: row.posizione, data: sample.data, regione: sample.regione, luogo: sample.luogo,
          nome_gara: sample.nome_gara, gara_ciclismo_url: url,
        }, { onConflict: 'ciclismo_id,stagione,data,nome_gara' });
        if (insErr) { errori++; continue; }

        havePos.add(row.posizione);
        haveCiclismoId.add(row.ciclismoId);
        inseritiQui++;
        righeInserite++;
      }

      if (inseritiQui > 0) {
        gareConBuchi++;
        console.log(`(${checked}/${todo.length}) ${sample.nome_gara} [${sample.stagione}]: +${inseritiQui} posizioni recuperate`);
      }
      await sb.from('ciclismo_gara_scan_state').upsert({ gara_ciclismo_url: url, status: 'done', trovati: ordineArrivo.length, inseriti: inseritiQui });
    } catch (e) {
      errori++;
      console.log(`(${checked}/${todo.length}) ERRORE ${url}: ${e.message}`);
      await sb.from('ciclismo_gara_scan_state').upsert({ gara_ciclismo_url: url, status: 'error', trovati: 0, inseriti: 0 });
    }
    if (checked % 100 === 0) console.log(`... ${checked}/${todo.length} | gare con buchi colmati: ${gareConBuchi} | righe inserite: ${righeInserite} | atleti nuovi: ${atletiNuovi} | errori: ${errori}`);
    await sleep(DELAY_MS);
  }

  console.log(`\n=== FATTO ===`);
  console.log(`Gare controllate: ${checked} | con buchi colmati: ${gareConBuchi} | righe inserite: ${righeInserite} | atleti nuovi scoperti: ${atletiNuovi} | errori: ${errori}`);
}

main().catch(e => { console.error('ERRORE FATALE:', e); process.exit(1); });
