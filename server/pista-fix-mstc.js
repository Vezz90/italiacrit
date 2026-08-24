'use strict';
const fs = require('fs');
const path = require('path');

(function loadEnv() {
  const p = path.join(__dirname, '.env.local');
  fs.readFileSync(p, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  });
})();

const BASE = 'https://italiacrit.onrender.com';
const TOP5 = { 1: 7, 2: 6, 3: 5, 4: 4, 5: 3 };
const CAT_LABELS = { ES1_M: 'Esordienti 1° Anno', ES2_M: 'Esordienti 2° Anno' };
const garaBase = '2_GRAN_PREMIO_MSTC_LA_PALLADIANA_2026-05-29';
const nome_gara = '2* GRAN PREMIO MSTC - LA PALLADIANA';
const data = '2026-05-29';
const regione = 'VENETO';

const rows = [
  { cat: 'ES1_M', pos: 1, cognome: 'VIRLAN', nome: 'MATTEO', team: 'A.S.D. U.S. F. COPPI MONTECCHIO P.' },
  { cat: 'ES1_M', pos: 2, cognome: 'BASSO', nome: 'FILIPPO', team: 'MST CYCLING - SANDRIGO BIKE' },
  { cat: 'ES1_M', pos: 3, cognome: 'ANGONESE', nome: 'ALESSANDRO', team: 'MST CYCLING - SANDRIGO BIKE' },
  { cat: 'ES1_M', pos: 4, cognome: 'CUMAN', nome: 'MATTEO ISAIA', team: 'MST CYCLING - SANDRIGO BIKE' },
  { cat: 'ES1_M', pos: 5, cognome: 'TOSATO', nome: 'MARCO', team: 'G.S. TAVO BONIN BIKE' },
  { cat: 'ES2_M', pos: 1, cognome: 'FORTUNA', nome: 'SIMONE', team: 'MST CYCLING - SANDRIGO BIKE' },
  { cat: 'ES2_M', pos: 2, cognome: 'MUSSOLIN', nome: 'ETTORE', team: 'A.S.D. U.S. F. COPPI MONTECCHIO P.' },
  { cat: 'ES2_M', pos: 3, cognome: 'TESTOLIN', nome: 'MATTEO', team: 'A.S.D. U.S. F. COPPI MONTECCHIO P.' },
  { cat: 'ES2_M', pos: 4, cognome: 'CARACAUSI', nome: 'GIOELE', team: 'A.S.D. U.S. F. COPPI MONTECCHIO P.' },
  { cat: 'ES2_M', pos: 5, cognome: 'BISCONTIN', nome: 'LEONARDO', team: 'G.S. TAVO BONIN BIKE' },
  { cat: 'ES2_M', pos: 6, cognome: 'MENEGHEL', nome: 'ANDREAS', team: 'A.S.D. G.S. FONZASO' },
  { cat: 'ES2_M', pos: 7, cognome: 'ZIROLDI', nome: 'ROCCO', team: 'MST CYCLING - SANDRIGO BIKE' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  });
  const { token } = await res.json();
  for (const r of rows) {
    const garaId = `${garaBase}_${r.cat}`;
    const body = {
      posizione: r.pos, cognome: r.cognome, nome: r.nome, team: r.team,
      nome_gara, data, categoria: CAT_LABELS[r.cat], genere: 'M', tipo: 'tipo_pista',
      campionato_regionale: false, campionato_italiano: false, regione,
      punti_override: TOP5[r.pos] || 0,
    };
    const r2 = await fetch(`${BASE}/api/admin/gara/${encodeURIComponent(garaId)}/manual-result`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    });
    const d = await r2.json();
    console.log(r2.ok ? '✓' : '✗', garaId, '#' + r.pos, r.cognome, r.nome, r2.ok ? `pts=${d.row.punti_effettivi}` : d.error);
    await sleep(500);
  }
})();
