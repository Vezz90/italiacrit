'use strict';
// Controllo ricorrente (ogni 30 minuti, da Utilita di pianificazione) dei risultati delle gare pro internazionali non a punti.
// Il giorno della gara e il giorno dopo cerca i risultati su PCS; appena una gara ha il vincitore salvata non la richiede piu.
// Se non c'e nessuna gara internazionale di oggi/ieri senza risultati, esce SENZA toccare PCS (nessuna richiesta inutile).
// Si ferma da solo se PCS blocca (6 ore di pausa) e non si sovrappone a un'altra esecuzione.
//   node pcs-pro-oggi.js [--dry]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8').split('\n').forEach(l => { const m = l.match(/^([^#=\s]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2'); });
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const DRY = process.argv.includes('--dry');
const LOCK = path.join(__dirname, 'pcs-pro-oggi.lock'), BLOCK = path.join(__dirname, 'pcs-blocked.flag');
const logDir = path.join(__dirname, 'logs'); fs.mkdirSync(logDir, { recursive: true });
const log = m => { const l = `[${new Date().toLocaleString('it-IT')}] ${m}`; console.log(l); try { fs.appendFileSync(path.join(logDir, 'pcs-pro-oggi.log'), l + '\n'); } catch (_) {} };
const age = f => { try { return Date.now() - fs.statSync(f).mtimeMs; } catch { return Infinity; } };
const day = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const words = s => new Set(String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 2 && !/^(trofeo|gran|premio|giro|del|della|dei|delle|the)$/.test(w)));

// L'attivita pianificata gira ogni 30 minuti SOLO nei giorni con una gara internazionale: la accende il pianificatore (pcs-pro-pianifica.js,
// una volta al giorno) e questo script la spegne da solo quando non c'e piu nulla da cercare.
const TASK = 'ItaliaCrit-PCS-ProOggi', START_HOUR = 13;   // le gare del giorno finiscono nel pomeriggio: prima non si cerca nulla
const setTask = on => { if (DRY) return; try { spawnSync('powershell.exe', ['-NoProfile', '-Command', `${on ? 'Enable' : 'Disable'}-ScheduledTask -TaskName '${TASK}' | Out-Null`], { timeout: 30000 }); log(`attivita ${TASK}: ${on ? 'accesa' : 'spenta'}`); } catch (e) { log('attivita pianificata non modificabile: ' + e.message); } };

(async () => {
  if (age(BLOCK) < 6 * 3600e3) return log('PCS ha bloccato da poco: pausa, nessuna richiesta');
  if (age(LOCK) < 40 * 60e3) return log('altra esecuzione in corso: esco');
  const oggi = day(Date.now()), ieri = day(Date.now() - 86400000);
  const cal = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'calendar.json'), 'utf8'));
  const tutte = cal.filter(g => g.tipo === 'internazionale' && (g.data === oggi || g.data === ieri) && !/_(ESORD|ALLIEV|JUN)/i.test(g.id));
  if (!tutte.length) { log(`nessuna gara internazionale oggi/ieri (${ieri}, ${oggi}): non faccio nulla`); return setTask(false); }
  const cand = tutte.filter(g => g.data === ieri || new Date().getHours() >= START_HOUR);
  if (!cand.length) return log(`gara di oggi, ma prima delle ${START_HOUR}:00 non cerco ancora i risultati`);

  const sb = createClient('https://aqqsstsbgpapzoxllosh.supabase.co', process.env.SUPABASE_SECRET, { realtime: { transport: ws } });
  const { data: have } = await sb.from('pro_races').select('nome, data_start, data_end, winner_name').gte('data_end', ieri).lte('data_start', oggi);
  const missing = cand.filter(g => {
    const w = words(g.nome);
    return !(have || []).some(r => r.winner_name && words(r.nome).size && [...words(r.nome)].filter(x => w.has(x)).length >= Math.min(2, words(r.nome).size));
  });
  if (!missing.length) { log(`tutte le ${cand.length} gare di oggi/ieri hanno gia i risultati: non faccio nulla`); return setTask(false); }
  log(`senza risultati: ${missing.map(g => g.nome.replace(/\s+/g, ' ').slice(0, 40)).join(' | ')}`);
  if (DRY) return log('--dry: non lancio l\'import');

  fs.writeFileSync(LOCK, String(process.pid));
  try {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'pcs-pro-italy-import.js'), '--season=' + oggi.slice(0, 4), '--oggi'], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 25 * 60e3 });
    const out = (r.stdout || '') + (r.stderr || '');
    fs.writeFileSync(path.join(logDir, 'pcs-pro-oggi-ultimo-import.log'), out);
    if (/you have been blocked|Sorry, you have been blocked|sfida non superata|sei stato bloccato/i.test(out)) { fs.writeFileSync(BLOCK, new Date().toISOString()); log('ATTENZIONE: PCS sembra bloccare, pausa di 6 ore'); }
    log(`import terminato (codice ${r.status}): ${(out.match(/✓[^\n]*/g) || []).slice(0, 5).join(' ; ') || 'nessun nuovo risultato'}`);
  } finally { try { fs.unlinkSync(LOCK); } catch (_) {} }
})().catch(e => { log('ERRORE ' + e.message); try { fs.unlinkSync(LOCK); } catch (_) {} process.exit(1); });
