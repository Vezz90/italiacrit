'use strict';
// Pianificatore giornaliero (attivita ItaliaCrit-PCS-ProOggi-Pianifica, ogni giorno alle 00:15): accende il controllo ogni 30 minuti delle gare pro
// SOLO se nel calendario c'e una gara internazionale oggi o ieri; negli altri giorni lo tiene spento (nessun costo, nessuna richiesta).
//   node pcs-pro-pianifica.js [--dry]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const DRY = process.argv.includes('--dry');
const TASK = 'ItaliaCrit-PCS-ProOggi';
const day = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const logDir = path.join(__dirname, 'logs'); fs.mkdirSync(logDir, { recursive: true });
const log = m => { const l = `[${new Date().toLocaleString('it-IT')}] ${m}`; console.log(l); try { fs.appendFileSync(path.join(logDir, 'pcs-pro-oggi.log'), l + '\n'); } catch (_) {} };
const oggi = day(Date.now()), ieri = day(Date.now() - 86400000);
const cal = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'calendar.json'), 'utf8'));
const gare = cal.filter(g => g.tipo === 'internazionale' && (g.data === oggi || g.data === ieri) && !/_(ESORD|ALLIEV|JUN)/i.test(g.id));
const on = gare.length > 0;
log(`pianificatore: ${on ? `${gare.length} gara/e internazionale/i oggi o ieri (${gare.map(g => g.nome.replace(/\s+/g, ' ').slice(0, 30)).join(' | ')}): controllo ogni 30 minuti ACCESO` : 'nessuna gara internazionale oggi/ieri: controllo SPENTO'}`);
if (!DRY) spawnSync('powershell.exe', ['-NoProfile', '-Command', `${on ? 'Enable' : 'Disable'}-ScheduledTask -TaskName '${TASK}' | Out-Null`], { timeout: 30000 });
