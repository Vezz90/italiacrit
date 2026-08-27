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

// Stessa funzione di server.js (_watermarkPhoto) / ciclismo-gara-media.js —
// credit impresso nel file, non solo mostrato a schermo.
function _ogEsc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
async function _watermarkPhoto(buffer, text) {
  if (!text) return buffer;
  try {
    const sharp = require('sharp');
    const img = sharp(buffer);
    const meta = await img.metadata();
    const W = meta.width || 1200, H = meta.height || 800;
    const fs2 = Math.max(14, Math.round(W * 0.022));
    const pad = Math.round(fs2 * 0.9);
    const label = `© ${text} · italiacyclingstats.com`;
    const boxW = Math.min(W - pad, Math.round(label.length * fs2 * 0.56) + pad * 2);
    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${W - boxW - pad}" y="${H - fs2 - pad * 2}" width="${boxW}" height="${fs2 + pad}" rx="4" fill="rgba(0,0,0,0.45)"/>
      <text x="${W - pad - boxW / 2}" y="${H - pad - fs2 * 0.28}" font-family="Arial,Helvetica,sans-serif" font-size="${fs2}" font-weight="600" fill="rgba(255,255,255,0.92)" text-anchor="middle">${_ogEsc(label)}</text>
    </svg>`;
    return await img.composite([{ input: Buffer.from(svg), left: 0, top: 0 }]).toBuffer();
  } catch (e) { console.warn('[watermark] fallito, salvo la foto originale:', e.message); return buffer; }
}

const SUPABASE_URL = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta SUPABASE_SECRET in server/.env.local'); process.exit(1); }

// 'esordienti' (dominio+slug) scarica SOLO la classifica generica — su
// ciclismo.info gli Esordienti 1° Anno hanno una classifica separata
// (classifica_esordienti_primo_anno_<anno>.htm, stesso dominio) che quella
// generica NON include: senza questa voce nessun atleta 1° Anno veniva mai
// scoperto (bug osservato dal vivo — mancavano anche dal filtro categoria).
// Ogni voce: { domain, slug, label } — slug è la parte dopo "classifica_"
// nell'URL, label identifica la combinazione anno+categoria nello stato di
// avanzamento (ciclismo_backfill_state), domain resta il sottodominio reale.
const CATEGORIE = [
  { domain: 'donne-esordienti', slug: 'donne-esordienti', label: 'donne-esordienti' },
  { domain: 'donne-allieve',    slug: 'donne-allieve',    label: 'donne-allieve' },
  { domain: 'donne-juniores',   slug: 'donne-juniores',   label: 'donne-juniores' },
  { domain: 'esordienti',       slug: 'esordienti',              label: 'esordienti' },
  { domain: 'esordienti',       slug: 'esordienti_primo_anno',   label: 'esordienti-1anno' },
  { domain: 'allievi',          slug: 'allievi',          label: 'allievi' },
  { domain: 'juniores',         slug: 'juniores',         label: 'juniores' },
  { domain: 'elite-under23',    slug: 'elite-under23',    label: 'elite-under23' },
];
const DELAY_MS = 300;

// Stessa mappa di ciclismo-create-profiles.js — usata qui per creare al volo
// il profilo di un atleta mai visto in FCI (vedi finalAtletaId più sotto).
const CAT_MAP = {
  ESORDIENTI1: 'ES1_M', ESORDIENTI2: 'ES2_M', ALLIEVI: 'AL_M', JUNIORES: 'JUN_M', ELITE_UNDER23: 'ELI_M',
  DONNE_ESORDIENTI: 'AL_F', DONNE_ALLIEVE: 'AL_F', DONNE_JUNIORES: 'JUN_F',
};

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

  console.log(`=== Backfill ciclismo.info: ${annoInizio}-${annoFine}, categorie: ${CATEGORIE.map(c => c.label).join(', ')} ===\n`);

  // Master list italiacrit per il matching
  const italiacritAthletes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'athletes.json'), 'utf8'));
  const italiacritIds = new Set(Object.keys(italiacritAthletes));

  // Atleti già tracciati dal circuito PCS (professionisti/nazionali/
  // continentali, non solo FCI italiani) — vedi nota identica e più estesa
  // in ciclismo-gara-scraper.js: senza questo controllo un corridore
  // straniero con risultati giovanili in Italia (es. Pogačar junior) riceve
  // un profilo manual_athletes duplicato con dati vecchi che sovrascrive
  // quello reale.
  const pcsIds = new Set();
  for (const table of ['pcs_results', 'pcs_gara_results', 'pcs_race_full_results']) {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from(table).select('atleta_id').range(from, from + PAGE - 1);
      if (error) break;
      if (!data || !data.length) break;
      data.forEach(r => { if (r.atleta_id) pcsIds.add(r.atleta_id); });
      if (data.length < PAGE) break;
    }
  }
  console.log(`Atleti italiacrit di riferimento: ${italiacritIds.size} | Atleti PCS noti: ${pcsIds.size}\n`);

  // Per la creazione al volo del profilo di un atleta mai in FCI (vedi sotto)
  const teams = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'teams.json'), 'utf8'));
  const teamIdByName = new Map(Object.values(teams).map(t => [String(t.nome || '').trim().toUpperCase(), t.id]));

  // Stato già completato (riprendibilità)
  const { data: doneRows } = await sb.from('ciclismo_backfill_state').select('id').eq('status', 'done');
  const doneSet = new Set((doneRows || []).map(r => r.id));
  console.log(`Combinazioni anno+categoria già completate: ${doneSet.size}\n`);

  let totAtleti = 0, totRisultati = 0, totMatch = 0, totNuovi = 0, totFoto = 0, totErrori = 0;

  for (let anno = annoFine; anno >= annoInizio; anno--) {
    for (const catObj of CATEGORIE) {
      const { domain, slug, label } = catObj;
      const stateId = `${anno}_${label}`;
      if (doneSet.has(stateId)) { console.log(`[skip] ${stateId} già fatto`); continue; }

      const classUrl = `http://${domain}.ciclismo.info/classifica_${slug}_${anno}.htm`;
      const { status, html } = await fetchDecodedSafe(classUrl);
      if (!html) {
        console.log(`[classifica] ${stateId}: HTTP ${status}, salto`);
        await sb.from('ciclismo_backfill_state').upsert({ id: stateId, anno, categoria: label, status: 'skip-404' });
        await sleep(DELAY_MS);
        continue;
      }
      const { classifica } = parseClassificaPage(html);
      console.log(`[classifica] ${stateId}: ${classifica.length} atleti`);
      await sleep(DELAY_MS);

      for (const a of classifica) {
        if (!a.ciclismoId) continue;
        totAtleti++;
        const schedaUrl = `http://${domain}.ciclismo.info${a.schedaUrl}`;
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
              const photoRes = await fetch(`http://${domain}.ciclismo.info${photoMatch[0]}`);
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

        // Anno di nascita (Classe YYYY sul profilo) — solo se non già impostato
        // a mano (non sovrascrivere una correzione admin esistente).
        const bYearMatch = String(scheda.natoIl || '').match(/(\d{4})\s*$/);
        if (bYearMatch) {
          try {
            const { data: existingYear } = await sb.from('entity_overrides')
              .select('new_value').eq('entity_type', 'atleta').eq('entity_id', atletaId)
              .eq('field', 'anno_nascita').maybeSingle();
            if (!existingYear || !existingYear.new_value) {
              await sb.from('entity_overrides').upsert(
                { entity_type: 'atleta', entity_id: atletaId, field: 'anno_nascita', new_value: bYearMatch[1] },
                { onConflict: 'entity_type,entity_id,field' }
              );
            }
          } catch { /* opzionale, non bloccare l'import */ }
        }

        // Upsert atleta (nascita). ATTENZIONE: 'matched' qui controlla SOLO
        // contro gli atleti FCI nativi (italiacritIds) — un atleta collegato
        // in un secondo momento da ciclismo-create-profiles.js (via
        // manual_athletes, per uno unmatched-in-FCI) NON risulterebbe
        // "matched" qui. Se questo stesso ciclismo_id viene ri-scrapato più
        // avanti (perché compare anche in un'ALTRA stagione/categoria non
        // ancora processata), un upsert incondizionato di atleta_id:null
        // cancellerebbe silenziosamente quel collegamento già fatto — bug
        // reale osservato dal vivo (Sensi Matteo). Si include atleta_id nel
        // payload SOLO quando è effettivamente matched: altrimenti Postgres
        // (ON CONFLICT DO UPDATE con colonne esplicite) lascia il valore
        // esistente invariato invece di azzerarlo.
        const upsertPayload = {
          ciclismo_id: a.ciclismoId,
          nome_completo: scheda.nomeCompleto,
          data_nascita: scheda.natoIl,
          photo_url: photoUrl,
          updated_at: new Date().toISOString(),
        };
        if (matched) upsertPayload.atleta_id = atletaId;
        await sb.from('ciclismo_athletes').upsert(upsertPayload, { onConflict: 'ciclismo_id' });

        // Atleta_id AUTORITATIVO per questo ciclismo_id: non basarsi solo su
        // 'matched' (controlla SOLO gli atleti FCI nativi) — un ciclismo_id
        // già collegato in precedenza da ciclismo-create-profiles.js (via
        // manual_athletes, per un atleta mai in athletes.json) risulterebbe
        // "non matched" qui e i risultati di QUESTA stagione (anche se
        // scrapata in un secondo momento, es. anni più vecchi) restavano
        // orfani per sempre — 22.184 righe già trovate così dal vivo (bug
        // reale, Sensi Matteo). Si rilegge il valore vero appena scritto/
        // preesistente invece di ri-derivarlo ogni volta dal solo match FCI.
        let finalAtletaId = matched ? atletaId : null;
        if (!finalAtletaId) {
          const { data: freshAth } = await sb.from('ciclismo_athletes').select('atleta_id').eq('ciclismo_id', a.ciclismoId).maybeSingle();
          finalAtletaId = (freshAth && freshAth.atleta_id) || null;
        }
        // Profilo mancante: crealo SUBITO invece di lasciare la riga orfana
        // in attesa di un rilancio manuale di ciclismo-create-profiles.js —
        // un atleta mai in FCI restava altrimenti NON CLICCABILE e senza
        // l'avatar (disallineato dalla grafica) su ogni pagina finché
        // qualcuno non rieseguiva quello script a mano (bug osservato dal
        // vivo: Trippi Matteo, 35+ risultati già scoperti dal 2011 ma mai
        // collegato). Stessa logica/normalizzazione di quello script.
        if (!finalAtletaId && atletaId && !pcsIds.has(atletaId)) {
          const { data: existingManual } = await sb.from('manual_athletes').select('atleta_id').eq('atleta_id', atletaId).maybeSingle();
          if (existingManual) {
            finalAtletaId = atletaId;
          } else {
            const nomeParts = String(scheda.nomeCompleto || '').trim().split(/\s+/);
            const cognome = nomeParts[0] || scheda.nomeCompleto;
            const nomeP = nomeParts.slice(1).join(' ') || '-';
            const catRaw = scheda.categoria || '';
            const genere = /DONNE/i.test(catRaw) ? 'F' : 'M';
            const categoria = CAT_MAP[catRaw] || (genere === 'F' ? 'AL_F' : 'AL_M');
            const team = scheda.team || null;
            const team_id = team
              ? (teamIdByName.get(team.trim().toUpperCase())
                || team.trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
              : null;
            const { error: profErr } = await sb.from('manual_athletes').upsert({
              atleta_id: atletaId, cognome, nome: nomeP, team_id, team, categoria, genere,
              created_by: null, source: 'ciclismo_info',
            }, { onConflict: 'atleta_id', ignoreDuplicates: true });
            if (!profErr) finalAtletaId = atletaId;
          }
          // Ricollega anche ciclismo_athletes.atleta_id (sopra non l'ha
          // fatto perché 'matched' era false) — altrimenti al prossimo
          // ri-scraping di questo ciclismo_id (altra stagione) il link
          // andrebbe ri-derivato da zero invece di essere già autorevole.
          if (finalAtletaId) await sb.from('ciclismo_athletes').update({ atleta_id: finalAtletaId }).eq('ciclismo_id', a.ciclismoId);
        }

        // Upsert risultati di QUESTO anno. punti_stagione = punteggio
        // classifica ciclismo.info (già letto dalla riga classifica, "P.
        // NNN") — è un totale STAGIONALE, non per singola gara (la pagina
        // gara non pubblica il contributo punti di ogni piazzamento), quindi
        // viene ripetuto identico su ogni riga dell'atleta in quella
        // stagione: comodo da leggere lato frontend senza una query/tabella
        // separata, a costo di un po' di ridondanza.
        const rows = scheda.piazzamenti.map(pl => ({
          ciclismo_id: a.ciclismoId,
          atleta_id: finalAtletaId,
          stagione: String(anno),
          categoria: scheda.categoria,
          team: scheda.team,
          posizione: pl.posizione,
          punti_stagione: a.punti != null ? a.punti : null,
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

      await sb.from('ciclismo_backfill_state').upsert({ id: stateId, anno, categoria: label, status: 'done' });
      console.log(`  -> fatto ${stateId} | totali finora: atleti=${totAtleti} risultati=${totRisultati} match=${totMatch} nuovi=${totNuovi} foto=${totFoto} errori=${totErrori}`);
    }
  }

  console.log(`\n=== BACKFILL COMPLETATO ===`);
  console.log(`Atleti processati: ${totAtleti} | Match italiacrit: ${totMatch} | Nuovi: ${totNuovi}`);
  console.log(`Risultati importati: ${totRisultati} | Foto importate: ${totFoto} | Errori: ${totErrori}`);
}

main().catch(e => { console.error('ERRORE FATALE:', e); process.exit(1); });
