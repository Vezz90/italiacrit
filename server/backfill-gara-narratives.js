'use strict';
// Giro una tantum: genera il racconto AI (vedi _generateAndStoreGaraNarrative
// in server.js) per le gare disputate nell'ultimo mese, così la pagina
// pubblica di ogni gara recente mostra subito il testo nuovo invece di
// aspettare lo sweep periodico (_sweepGaraNarratives, un batch di 5 ogni 30
// min) o la prima visita di un utente.
//
// Gira contro il backend GIÀ DEPLOYATO (Render), perché è lì che vive
// ANTHROPIC_API_KEY — in locale server/.env.local non ce l'ha. Serve quindi
// un login admin: aggiungi ADMIN_EMAIL e ADMIN_PASSWORD a server/.env.local
// prima di lanciare questo script.

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
const DAYS_BACK = 30;
const DELAY_MS = 2000; // tra una gara e l'altra: niente anti-bot da evadere qui (è la nostra API), solo per non saturare Claude

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Imposta ADMIN_EMAIL e ADMIN_PASSWORD in server/.env.local (credenziali di un account admin del sito)');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error('Login fallito: ' + (data.error || res.status));
  if (data.user?.role !== 'admin') throw new Error('L\'account non ha ruolo admin');
  return data.token;
}

function raceIdsLastMonth() {
  const resultsRaw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'results_raw.json'), 'utf8'));
  const cutoff = new Date(Date.now() - DAYS_BACK * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const byId = new Map();
  for (const r of resultsRaw) {
    if (!r.gara_id || !r.data) continue;
    if (r.data < cutoff || r.data > today) continue;
    if (!byId.has(r.gara_id)) byId.set(r.gara_id, r.data);
  }
  return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id]) => id);
}

(async () => {
  const token = await login();
  const ids = raceIdsLastMonth();
  console.log(`${ids.length} gare nell'ultimo mese (dal ${new Date(Date.now() - DAYS_BACK * 86400000).toISOString().slice(0, 10)}).\n`);

  let ok = 0, fail = 0;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    process.stdout.write(`(${i + 1}/${ids.length}) ${id} … `);
    try {
      const res = await fetch(`${BASE}/api/admin/gara-narrative/${encodeURIComponent(id)}/regenerate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      ok++;
      console.log('✓');
    } catch (e) {
      fail++;
      console.log('ERRORE: ' + e.message);
    }
    if (i < ids.length - 1) await sleep(DELAY_MS);
  }
  console.log(`\n=== Completato: ${ok} ok, ${fail} falliti ===`);
})();
