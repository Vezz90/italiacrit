'use strict';
// Scrive i corridori "nuovi" (nessun profilo esistente) confermati a mano
// dall'utente per le gare elencate, con le categorie già riscontrate
// dall'estrazione (due correzioni esplicite: Pietrella Arianna e Sbrizzai
// Noemi sono 2° anno, non 1° come da default). Le "Donne Esordienti" di
// 4° Trofeo Tecam vengono rinumerate includendo le nuove nella sequenza
// già scritta (stessa regola di sempre: posizione relativa per categoria
// risolta, non posizione grezza del tab combinato).
// Uso: node pista-confirm-new.js [--dry-run]

const fs = require('fs');
const path = require('path');

(function loadEnv() {
  const p = path.join(__dirname, '.env.local');
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  });
})();

const BASE = 'https://italiacrit.onrender.com';
const DRY_RUN = process.argv.includes('--dry-run');
const TOP5 = { 1: 7, 2: 6, 3: 5, 4: 4, 5: 3 };
const CAT_LABELS = { ES1_M: 'Esordienti 1° Anno', ES2_M: 'Esordienti 2° Anno', ES1_F: 'Esordienti 1° Anno', ES2_F: 'Esordienti 2° Anno' };

const rows = [
  { gara: 'MEMORIAL_PINUCCIO_CHIAVASSA_2026-05-14', nome_gara: 'MEMORIAL PINUCCIO CHIAVASSA', regione: 'PIEMONTE', cat: 'ES2_M', genere: 'M', pos: 4, cognome: 'CAZZADORE', nome: 'PAOLO', team: 'CICLISTICA ROSTESE' },
  { gara: 'MEMORIAL_PINUCCIO_CHIAVASSA_2026-05-14', nome_gara: 'MEMORIAL PINUCCIO CHIAVASSA', regione: 'PIEMONTE', cat: 'ES2_M', genere: 'M', pos: 6, cognome: 'MARCHISIO', nome: 'MATTIA', team: 'ALBA BRA LANGHE ROERO' },

  { gara: 'TROFEO_DENTIS_2026-07-16', nome_gara: 'TROFEO DENTIS', regione: 'PIEMONTE', cat: 'ES1_M', genere: 'M', pos: 1, cognome: 'CHERCHI', nome: 'GABRIELE', team: 'ALBA BRA LANGHE ROERO' },
  { gara: 'TROFEO_DENTIS_2026-07-16', nome_gara: 'TROFEO DENTIS', regione: 'PIEMONTE', cat: 'ES1_M', genere: 'M', pos: 5, cognome: 'VALLONE', nome: "NICOLO'", team: 'QUILIANO BIKE SPEED WHEEL' },
  { gara: 'TROFEO_DENTIS_2026-07-16', nome_gara: 'TROFEO DENTIS', regione: 'PIEMONTE', cat: 'ES1_M', genere: 'M', pos: 10, cognome: 'CASTELLINI', nome: 'SIMONE', team: 'QUILIANO BIKE SPEED WHEEL' },
  { gara: 'TROFEO_DENTIS_2026-07-16', nome_gara: 'TROFEO DENTIS', regione: 'PIEMONTE', cat: 'ES1_M', genere: 'M', pos: 11, cognome: 'GERBALDO', nome: 'ALESSANDRO', team: 'ARDENS CYCLING TEAM' },
  { gara: 'TROFEO_DENTIS_2026-07-16', nome_gara: 'TROFEO DENTIS', regione: 'PIEMONTE', cat: 'ES1_F', genere: 'F', pos: 1, cognome: 'COLOMBINO', nome: 'ESTER', team: 'QUILIANO BIKE SPEED WHEEL' },
  { gara: 'TROFEO_DENTIS_2026-07-16', nome_gara: 'TROFEO DENTIS', regione: 'PIEMONTE', cat: 'ES2_M', genere: 'M', pos: 7, cognome: 'LICATA', nome: 'LORENZO', team: 'ARDENS CYCLING TEAM' },
  { gara: 'TROFEO_DENTIS_2026-07-16', nome_gara: 'TROFEO DENTIS', regione: 'PIEMONTE', cat: 'ES2_M', genere: 'M', pos: 11, cognome: 'MARCHISIO', nome: 'MATTIA', team: 'ALBA BRA LANGHE ROERO' },
  { gara: 'TROFEO_DENTIS_2026-07-16', nome_gara: 'TROFEO DENTIS', regione: 'PIEMONTE', cat: 'ES2_M', genere: 'M', pos: 12, cognome: 'SALICE', nome: "NICOLO'", team: "G.S. LUPI VALLE D'AOSTA" },

  { gara: '3_TROFEO_ALF_GROUP_2026-07-24', nome_gara: '3° TROFEO ALF GROUP', regione: 'VENETO', cat: 'ES2_M', genere: 'M', pos: 6, cognome: 'SANTAROSSA', nome: 'NOAH', team: 'CICLO TEAM GORGAZZO' },
  { gara: '3_TROFEO_ALF_GROUP_2026-07-24', nome_gara: '3° TROFEO ALF GROUP', regione: 'VENETO', cat: 'ES2_F', genere: 'F', pos: 4, cognome: 'SBRIZZAI', nome: 'NOEMI', team: 'LIBERTAS CERESETTO' },

  { gara: "NOTTURNA_DELL_ASSUNTA_2026-08-07", nome_gara: "NOTTURNA DELL'ASSUNTA", regione: 'FRIULI VENEZIA GIULIA', cat: 'ES2_M', genere: 'M', pos: 2, cognome: 'BIT', nome: 'DANIELE', team: 'GOTTARDO GIOCHI CANEVA' },
  { gara: "NOTTURNA_DELL_ASSUNTA_2026-08-07", nome_gara: "NOTTURNA DELL'ASSUNTA", regione: 'FRIULI VENEZIA GIULIA', cat: 'ES2_M', genere: 'M', pos: 8, cognome: 'SANTAROSSA', nome: 'NOAH', team: 'CICLO TEAM GORGAZZO' },
  { gara: "NOTTURNA_DELL_ASSUNTA_2026-08-07", nome_gara: "NOTTURNA DELL'ASSUNTA", regione: 'FRIULI VENEZIA GIULIA', cat: 'ES2_M', genere: 'M', pos: 9, cognome: 'NADAL', nome: 'GABRIELE', team: 'A.S.D. SACILESE' },

  { gara: 'MEMORIAL_GIOVANNI_FINO_E_PAOLO_MATTIO_2026-08-20', nome_gara: 'MEMORIAL GIOVANNI FINO E PAOLO MATTIO', regione: 'PIEMONTE', cat: 'ES1_M', genere: 'M', pos: 5, cognome: 'GIACOBBE', nome: 'EDOARDO', team: 'UÀ CYCLING TEAM' },
  { gara: 'MEMORIAL_GIOVANNI_FINO_E_PAOLO_MATTIO_2026-08-20', nome_gara: 'MEMORIAL GIOVANNI FINO E PAOLO MATTIO', regione: 'PIEMONTE', cat: 'ES2_M', genere: 'M', pos: 5, cognome: 'MARCHISIO', nome: 'MATTIA', team: 'ALBA BRA LANGHE ROERO' },

  // 4 Trofeo Tecam — Donne Esordienti rinumerate (le prime 5 posizioni per
  // ES1_F/ES2_F sono già scritte da pista-write-donne-esordienti.js)
  { gara: '4_TROFEO_TECAM_2026-07-17', nome_gara: '4° TROFEO TECAM', regione: 'LOMBARDIA', cat: 'ES1_F', genere: 'F', pos: 4, cognome: 'LANFRANCHI', nome: 'VITTORIA', team: 'UNIONE CICLISTICA OSSANESGA' },
  { gara: '4_TROFEO_TECAM_2026-07-17', nome_gara: '4° TROFEO TECAM', regione: 'LOMBARDIA', cat: 'ES1_F', genere: 'F', pos: 5, cognome: 'BREVIARIO', nome: 'ILARIA', team: 'UNIONE CICLISTICA OSSANESGA' },
  { gara: '4_TROFEO_TECAM_2026-07-17', nome_gara: '4° TROFEO TECAM', regione: 'LOMBARDIA', cat: 'ES1_F', genere: 'F', pos: 6, cognome: 'ANGHEL', nome: 'BEATRICE IOANA', team: 'UNIONE CICLISTICA OSSANESGA' },
  { gara: '4_TROFEO_TECAM_2026-07-17', nome_gara: '4° TROFEO TECAM', regione: 'LOMBARDIA', cat: 'ES1_F', genere: 'F', pos: 7, cognome: 'MOLTENI', nome: 'ELISA', team: 'UC COSTAMASNAGA ASD' },
  { gara: '4_TROFEO_TECAM_2026-07-17', nome_gara: '4° TROFEO TECAM', regione: 'LOMBARDIA', cat: 'ES2_F', genere: 'F', pos: 3, cognome: 'PIETRELLA', nome: 'ARIANNA', team: 'S.C. CESANO MADERNO' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error('Login fallito: ' + (data.error || res.status));
  return data.token;
}

(async () => {
  const token = DRY_RUN ? null : await login();
  let written = 0, errors = 0;
  for (const r of rows) {
    const garaId = `${r.gara}_${r.cat}`;
    const data = r.gara.match(/(\d{4}-\d{2}-\d{2})$/)[1];
    const body = {
      posizione: r.pos, cognome: r.cognome, nome: r.nome, team: r.team,
      nome_gara: r.nome_gara, data, categoria: CAT_LABELS[r.cat], genere: r.genere,
      tipo: 'tipo_pista', campionato_regionale: false, campionato_italiano: false, regione: r.regione,
      punti_override: TOP5[r.pos] || 0,
    };
    if (DRY_RUN) { console.log('[DRY]', garaId, '#' + r.pos, r.cognome, r.nome, body.punti_override + 'pt'); continue; }
    try {
      const res = await fetch(`${BASE}/api/admin/gara/${encodeURIComponent(garaId)}/manual-result`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      written++;
      console.log('✓', garaId, '#' + r.pos, r.cognome, r.nome, 'pts=' + d.row.punti_effettivi);
    } catch (e) { errors++; console.log('✗', garaId, '#' + r.pos, r.cognome, r.nome, e.message); }
    await sleep(500);
  }
  console.log(`\n=== ${DRY_RUN ? 'Simulazione' : 'Completato'}: ${rows.length} pianificate${DRY_RUN ? '' : `, ${written} scritte, ${errors} errori`} ===`);
})();
