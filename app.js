/* ============================================================
   ItaliacritResultati — app.js
   Hash Router + Page Renderers
   Legge i JSON statici da data/ via fetch()
   ============================================================ */

'use strict';

// ── CONSTANTS ─────────────────────────────────────────────────
const BASEPTS = { 1:15, 2:12, 3:10, 4:8, 5:6, 6:5, 7:4, 8:3, 9:2, 10:1 };
const RENDER_BASE      = 'https://italiacrit.onrender.com';
const SUPABASE_STORAGE = 'https://aqqsstsbgpapzoxllosh.supabase.co/storage/v1/object/public';
const IS_LOCAL         = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const API_BASE         = IS_LOCAL ? '/api' : `${RENDER_BASE}/api`;
const PHOTOS_BASE      = IS_LOCAL ? '' : SUPABASE_STORAGE;
const MEDIA_BASE       = IS_LOCAL ? '' : SUPABASE_STORAGE;

// ── AUTH HELPERS ──────────────────────────────────────────────
function authToken() { return localStorage.getItem('italiacrit-token'); }
function authUser()  {
  try { return JSON.parse(localStorage.getItem('italiacrit-user') || 'null'); } catch { return null; }
}
function authSave(token, user) {
  localStorage.setItem('italiacrit-token', token);
  localStorage.setItem('italiacrit-user', JSON.stringify(user));
}
function authClear() {
  localStorage.removeItem('italiacrit-token');
  localStorage.removeItem('italiacrit-user');
}

// ── ENTITY OVERRIDES / PHOTO ──────────────────────────────────
const _ovCache = {};
async function getEntityOverrides(type, id) {
  const key = `${type}:${id}`;
  if (_ovCache[key]) return _ovCache[key];
  try {
    const { overrides } = await apiCall(`/admin/override/entity/${type}/${encodeURIComponent(id)}`);
    _ovCache[key] = overrides || {};
  } catch { _ovCache[key] = {}; }
  return _ovCache[key];
}

function canUploadPhoto(entityType) {
  const user = authUser();
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (entityType === 'atleta' && user.role === 'atleta') return true;
  if (entityType === 'team'   && user.role === 'team')   return true;
  return false;
}

function photoAreaHtml(entityType, entityId, photoUrl, initials, shape = 'circle') {
  const size   = shape === 'circle' ? 96 : 88;
  const radius = shape === 'circle' ? '50%' : '10px';
  const canUp  = canUploadPhoto(entityType);
  const imgEl  = photoUrl
    ? `<img data-photo-id="${esc(entityId)}" src="${MEDIA_BASE}${esc(photoUrl)}"
           alt="Foto" style="width:100%;height:100%;object-fit:cover;border-radius:${radius};display:block">`
    : `<div data-photo-id="${esc(entityId)}" style="width:100%;height:100%;border-radius:${radius};
           background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;
           font-family:var(--font-display);font-size:${shape==='circle'?'1.8':'1.6'}rem;
           color:var(--text-muted);letter-spacing:.04em">${esc(initials)}</div>`;
  const camBtn = canUp ? `
    <button class="photo-cam-btn" title="Carica foto"
      onclick="triggerPhotoUpload('${esc(entityType)}','${esc(entityId)}')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
    </button>
    <input type="file" id="photo-file-${esc(entityId)}" accept="image/jpeg,image/png,image/webp"
      style="display:none" onchange="handlePhotoUpload(event,'${esc(entityType)}','${esc(entityId)}')">` : '';
  return `<div class="photo-area" style="width:${size}px;height:${size}px;flex-shrink:0;position:relative">
    ${imgEl}${camBtn}
  </div>`;
}

window.triggerPhotoUpload = function(entityType, entityId) {
  document.getElementById(`photo-file-${entityId}`)?.click();
};

window.handlePhotoUpload = async function(evt, entityType, entityId) {
  const file = evt.target.files[0];
  if (!file) return;

  // Cambia icona per feedback visivo
  const btn = document.querySelector(`.photo-cam-btn`);
  if (btn) { btn.style.opacity = '0.5'; btn.style.pointerEvents = 'none'; }

  const fd = new FormData();
  // I campi testo devono venire PRIMA del file per essere disponibili in multer
  fd.append('entity_type', entityType);
  fd.append('entity_id', entityId);
  fd.append('photo', file);
  try {
    const token = authToken();
    const res  = await fetch(`${API_BASE}/upload/photo`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    let data;
    try { data = await res.json(); } catch { throw new Error('Risposta non valida dal server — è in esecuzione?'); }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    // Update cache and DOM without full re-render
    const key = `${entityType}:${entityId}`;
    if (_ovCache[key]) _ovCache[key].photo_url = data.photo_url;
    const target = document.querySelector(`[data-photo-id="${entityId}"]`);
    if (target) {
      const radius = entityType === 'team' ? '10px' : '50%';
      const newImg = document.createElement('img');
      newImg.src = `${MEDIA_BASE}${data.photo_url}`;
      newImg.setAttribute('data-photo-id', entityId);
      newImg.style.cssText = `width:100%;height:100%;object-fit:cover;border-radius:${radius};display:block`;
      target.replaceWith(newImg);
    }
    const toast = document.createElement('div');
    toast.className = 'upload-toast';
    toast.textContent = 'Foto aggiornata ✓';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  } catch (err) {
    alert('Errore upload: ' + err.message);
  } finally {
    if (btn) { btn.style.opacity = ''; btn.style.pointerEvents = ''; }
  }
};

async function apiCall(path, opts = {}) {
  const token = authToken();
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function updateNavLoginState() {
  const user = authUser();
  const link = document.getElementById('nav-login');
  const drawerLink = document.getElementById('drawer-login');
  if (user) {
    const label = user.display_name?.split(' ')[0] || 'Profilo';
    if (link)       { link.textContent = label; link.href = '#/profilo'; link.id = 'nav-login'; }
    if (drawerLink) { drawerLink.textContent = label; drawerLink.href = '#/profilo'; }
  } else {
    if (link)       { link.textContent = 'Login'; link.href = '#/login'; }
    if (drawerLink) { drawerLink.textContent = 'Login'; drawerLink.href = '#/login'; }
  }
}

// ── REGION NORMALIZATION ───────────────────────────────────────
const ITALIAN_REGIONS = [
  "TRENTINO ALTO ADIGE", "FRIULI VENEZIA GIULIA", "VALLE D AOSTA", "EMILIA ROMAGNA",
  "ABRUZZO","BASILICATA","CALABRIA","CAMPANIA","LAZIO","LIGURIA","LOMBARDIA",
  "MARCHE","MOLISE","PIEMONTE","PUGLIA","SARDEGNA","SICILIA","TOSCANA",
  "UMBRIA","VENETO","BOLZANO","TRENTO"
];
function normalizeRegion(s) {
  if (!s) return '';
  const t = s.toUpperCase().trim();
  // Ordina per lunghezza discendente: le più lunghe prima (EMILIA ROMAGNA prima di EMILIA)
  for (const reg of ITALIAN_REGIONS) {
    if (t.startsWith(reg)) return reg;
  }
  return t;
}

// ── DATA CACHE ────────────────────────────────────────────────
const cache = {};
async function loadJson(path) {
  if (cache[path]) return cache[path];
  try {
    const ts = Date.now();
    const fetchPath = path.includes('?') ? `${path}&_t=${ts}` : `${path}?_t=${ts}`;
    const r = await fetch(fetchPath, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    cache[path] = data;
    return data;
  } catch (e) {
    console.warn(`loadJson(${path}):`, e);
    return null;
  }
}

// Correzioni genere/categoria per atlete classificate erroneamente
const ATHLETE_GENDER_FIXES = {
  'ANDREOLI_ALICE':       { genere:'F', categoria:'ES1_F' },
  'MASINI_GRETA':         { genere:'F', categoria:'ES2_F' },
  'DELOGU_GIULIA':        { genere:'F', categoria:'ES2_F' },
  'RENZULLI_GIULIA':      { genere:'F', categoria:'ES1_F' },
  'ABRIONI_ALESSIA':      { genere:'F', categoria:'ES1_F' },
  'CINQUEGRANI_FEDERICA': { genere:'F', categoria:'ES1_F' },
  'POIDOMANI_ELENA':      { genere:'F', categoria:'ES1_F' },
  'FONTANA_GIULIA_MARIA': { genere:'F', categoria:'ES1_F' },
  'SGROI_GIADA':          { genere:'F', categoria:'ES1_F' },
  'DI_PARDO_BEATRICE':    { genere:'F', categoria:'ES1_F' },
};

// Preload tutto in parallelo
async function loadAll() {
  const [calendar, resultsRaw, athletes, teams, meta, raceDetails, videos] = await Promise.all([
    loadJson('data/calendar.json'),
    loadJson('data/results_raw.json'),
    loadJson('data/athletes.json'),
    loadJson('data/teams.json'),
    loadJson('data/meta.json'),
    loadJson('data/race_details.json'),
    loadJson('data/videos.json'),
  ]);

  // Applica correzioni genere
  if (athletes) {
    for (const [id, fix] of Object.entries(ATHLETE_GENDER_FIXES)) {
      if (athletes[id]) Object.assign(athletes[id], fix);
    }
  }
  if (resultsRaw) {
    for (const r of resultsRaw) {
      const fix = ATHLETE_GENDER_FIXES[r.atleta_id];
      if (fix) { r.genere = fix.genere; if (r.categoria?.endsWith('_M')) r.categoria = r.categoria.replace('_M','_F'); }
    }
  }

  // Indicizzazione per calcolo trend rapidi
  const resultsByAtleta = {};
  const resultsByTeam = {};
  (resultsRaw || []).forEach(r => {
    if (r.atleta_id) {
      if (!resultsByAtleta[r.atleta_id]) resultsByAtleta[r.atleta_id] = [];
      resultsByAtleta[r.atleta_id].push(r);
    }
    if (r.team_id) {
      if (!resultsByTeam[r.team_id]) resultsByTeam[r.team_id] = [];
      resultsByTeam[r.team_id].push(r);
    }
  });
  // Ordina per data decrescente
  Object.values(resultsByAtleta).forEach(list => {
    list.sort((a,b) => (b.data||'').localeCompare(a.data||''));
  });
  Object.values(resultsByTeam).forEach(list => {
    list.sort((a,b) => (b.data||'').localeCompare(a.data||''));
  });

  // Set IDs atlete — usato per filtrare ranking pre-costruiti
  const _femaleIds = new Set((resultsRaw || []).filter(r => r.genere === 'F').map(r => r.atleta_id));

  // Mappa gara_id (risultati) → calendar_id — necessaria perché i gara_id
  // dei risultati hanno suffissi extra rispetto agli id del calendario
  const garaToCalId = {};
  for (const cal of (calendar || [])) {
    if (!cal.id || !cal.data) continue;
    const calBase = cal.id.replace(/_\d{4}-\d{2}-\d{2}$/, '');
    for (const r of (resultsRaw || [])) {
      if (r.data === cal.data && r.gara_id && r.gara_id.startsWith(calBase)) {
        garaToCalId[r.gara_id] = cal.id;
      }
    }
  }

  return {
    calendar: calendar || [],
    resultsRaw: resultsRaw || [],
    athletes: athletes || {},
    teams: teams || {},
    meta: meta || {},
    raceDetails: raceDetails || {},
    videos: videos || {},
    resultsByAtleta,
    resultsByTeam,
    _femaleIds,
    garaToCalId
  };
}

const RANKING_CODES = [
  'ES1_M','ES2_M','AL_M','JUN_M','ELI_M',
  'ES1_F','ES2_F','AL_F','JUN_F','ELI_F'
];

async function loadRanking(code) {
  const data = await loadJson(`data/rankings/${code}.json`) || [];
  // Protezione: filtra atleti del genere sbagliato (possibile errore scraper)
  if (!globalData) return data;
  const isFemale = code.endsWith('_F');
  const femaleSet = globalData._femaleIds;
  if (!femaleSet) return data;
  return data.filter(a => isFemale ? femaleSet.has(a.atleta_id) : !femaleSet.has(a.atleta_id));
}

async function loadTeamRanking(code) {
  const data = await loadJson(`data/team_rankings/${code}.json`);
  return data || [];
}

// ── UTILITY ───────────────────────────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const [y,m,d] = iso.split('-');
  const months = ['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'];
  return `${parseInt(d)} ${months[parseInt(m)-1]} ${y}`;
}

function fmtDateShort(iso) {
  if (!iso) return '—';
  const [,m,d] = iso.split('-');
  const months = ['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'];
  return `${parseInt(d)} ${months[parseInt(m)-1]}`;
}

function badgeCat(code) {
  const label = catLabel(code);
  const cls = code.replace(/[^a-zA-Z]/g, '').toLowerCase(); // as a safe class name
  return `<span class="badge-cat badge-${cls}">${esc(label)}</span>`;
}

function badgeMult(m, tipo, isCR = false, isCI = false) {
  isCR = isCR || (tipo === 'campionato_regionale');
  isCI = isCI || (tipo === 'campionato_italiano');
  const isNat = (m === 2 || tipo === 'nazionale');
  const isInt = (m === 3 || tipo === 'internazionale');
  
  if (isCI) return `<span class="res-badge blue-badge">Campionato Italiano (x3)</span>`;
  if (isCR) return `<span class="res-badge orange-badge">Campionato Regionale (x2)</span>`;
  
  const cls = isInt ? 'blue-badge' : (isNat ? 'orange-badge' : 'gray-badge');
  const label = isInt ? 'Int.le' : (isNat ? 'Naz.le' : 'Reg.le');
  return `<span class="res-badge ${cls}">${label} (x${m})</span>`;
}

function catLabel(code) {
  const map = {
    ES_M: 'Esordienti M',
    ES1_M:'Esordienti 1° Anno', 
    ES2_M:'Esordienti 2° Anno', 
    AL_M: 'Allievi', 
    AL1_M:'Allievi 1° Anno', 
    AL2_M:'Allievi 2° Anno',
    JUN_M:'Juniores',        
    ELI_M:'Elite - U23',
    ES_F: 'Donne Esordienti', 
    ES1_F:'Donne Esordienti 1° Anno', 
    ES2_F:'Donne Esordienti 2° Anno', 
    AL_F: 'Donne Allieve', 
    AL1_F:'Donne Allieve 1° Anno', 
    AL2_F:'Donne Allieve 2° Anno',
    JUN_F:'Donne Juniores',      
    ELI_F:'Donne Elite - U23'
  };
  return map[code] || code;
}

function getRankingFileCode(obj) {
  if (!obj) return null;
  if (typeof obj === 'string') {
    if (obj.startsWith('AL')) return 'AL_' + (obj.endsWith('_F') ? 'F' : 'M');
    return obj;
  }
  // r.genere è autorevole — già corretto da ATHLETE_GENDER_FIXES in loadAll()
  const gender = obj.genere === 'F' ? 'F' : 'M';
  // Estrae solo il TIPO di categoria da gara_id, usa r.genere per il suffisso genere
  if (obj.gara_id) {
    const m = obj.gara_id.match(/_([A-Z0-9]+)_[MF]$/);
    if (m) {
      let base = m[1];
      if (base.startsWith('AL')) base = 'AL';
      return `${base}_${gender}`;
    }
  }
  // Fallback: usa categoria (già corretta al caricamento)
  if (obj.categoria && /^[A-Z0-9]+_[MF]$/.test(obj.categoria)) return obj.categoria;
  return null;
}

// ── Weekend key: returns the Saturday ISO date for Sa+Su grouping ──
function weekendKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0=Sun, 6=Sat
  const offset = day === 0 ? -1 : (6 - day);
  const sat = new Date(d);
  sat.setDate(d.getDate() + offset);
  return sat.toISOString().split('T')[0];
}

function renderTrend(r) {
  if (!r) return '';
  const t = r.trend;
  
  if (t === undefined || t === null) {
    // Se è la prima volta che appare (o non ha storico)
    return `<span class="trend-indicator trend-new">NEW</span>`;
  }
  
  if (t > 0) return `<span class="trend-indicator trend-up">▲${t}</span>`;
  if (t < 0) return `<span class="trend-indicator trend-down">▼${Math.abs(t)}</span>`;
  return `<span class="trend-indicator trend-stable">●</span>`;
}

function posClass(p) {
  if (p === 1) return 'p1';
  if (p === 2) return 'p2';
  if (p === 3) return 'p3';
  return '';
}

function flameSvg() {
  return `<svg class="flame-svg" viewBox="0 0 14 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M7 1C7 1 11 5 11 9C11 11.7614 9.20914 14 7 14C4.79086 14 3 11.7614 3 9C3 7 4 5.5 4 5.5C4 5.5 4.5 8 6 8C6 8 5 6 7 1Z" fill="#e8001d"/>
    <path d="M7 10C7 10 8.5 11.5 8.5 13C8.5 14.3807 7.82843 15.5 7 15.5C6.17157 15.5 5.5 14.3807 5.5 13C5.5 11.5 7 10 7 10Z" fill="#f5c400"/>
  </svg>`;
}

function multFromType(tipo, isCR, isCI) {
  if (isCI || tipo === 'internazionale') return 3;
  if (isCR || tipo === 'nazionale') return 2;
  return 1;
}

// ── ADMIN EDIT SYSTEM ─────────────────────────────────────────
const ADMIN_EDIT_FIELDS = {
  gara: [
    { key: 'nome_gara',     label: 'Nome gara',     type: 'text' },
    { key: 'tipo',          label: 'Tipo gara',      type: 'select',
      options: ['regionale','nazionale','internazionale','campionato_regionale','campionato_italiano'] },
    { key: 'moltiplicatore', label: 'Moltiplicatore', type: 'select', options: ['1','2','3'] },
  ],
  atleta: [
    { key: 'nome',    label: 'Nome',    type: 'text' },
    { key: 'cognome', label: 'Cognome', type: 'text' },
    { key: 'team',    label: 'Team',    type: 'text' },
  ],
  team: [
    { key: 'nome', label: 'Nome team', type: 'text' },
  ],
};

function adminEditBtn(entityType, entityId) {
  if (authUser()?.role !== 'admin') return '';
  return `<button class="admin-edit-btn" onclick="openAdminEdit('${esc(entityType)}','${esc(entityId)}')">✏ Modifica</button>`;
}

window.openAdminEdit = async function(entityType, entityId) {
  const fields = ADMIN_EDIT_FIELDS[entityType] || [];
  // Load existing overrides
  let current = {};
  try {
    const { overrides } = await apiCall(`/admin/override/entity/${entityType}/${encodeURIComponent(entityId)}`);
    current = overrides || {};
  } catch(_) {}

  const fieldsHtml = fields.map(f => {
    const val = esc(current[f.key] || '');
    if (f.type === 'select') {
      const opts = f.options.map(o => `<option value="${o}" ${current[f.key] === o ? 'selected' : ''}>${o}</option>`).join('');
      return `<label class="auth-label">${f.label}<select id="aedit-${f.key}" class="auth-input">${opts}</select></label>`;
    }
    return `<label class="auth-label">${f.label}<input type="text" id="aedit-${f.key}" class="auth-input" value="${val}" placeholder="${f.label}" /></label>`;
  }).join('');

  const labelMap = { gara: 'Gara', atleta: 'Atleta', team: 'Team' };
  const overlay = document.createElement('div');
  overlay.id = 'admin-edit-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:32px;width:100%;max-width:420px;max-height:90vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h2 style="font-family:var(--font-display);font-size:1.4rem;color:var(--red-hot);margin:0">MODIFICA ${esc(labelMap[entityType]||entityType).toUpperCase()}</h2>
        <button onclick="document.getElementById('admin-edit-overlay').remove()" style="background:none;border:none;color:var(--text-muted);font-size:1.4rem;cursor:pointer;padding:4px">✕</button>
      </div>
      <p style="font-size:0.78rem;color:var(--text-muted);margin:0 0 16px;font-family:var(--font-mono)">${esc(entityId)}</p>
      <div id="aedit-error" style="display:none;color:var(--red-hot);font-size:0.85rem;margin-bottom:12px"></div>
      <div style="display:flex;flex-direction:column;gap:14px">
        ${fieldsHtml}
      </div>
      <div style="display:flex;gap:12px;margin-top:24px">
        <button class="auth-btn" id="aedit-save-btn" onclick="saveAdminEdit('${esc(entityType)}','${esc(entityId)}')">SALVA</button>
        <button class="auth-btn auth-btn-outline" onclick="document.getElementById('admin-edit-overlay').remove()">Annulla</button>
      </div>
      <p style="font-size:0.72rem;color:var(--text-muted);margin-top:12px">Le modifiche sovrascrivono i dati dello scraper localmente.</p>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
};

window.saveAdminEdit = async function(entityType, entityId) {
  const fields = ADMIN_EDIT_FIELDS[entityType] || [];
  const errEl = document.getElementById('aedit-error');
  const btn   = document.getElementById('aedit-save-btn');
  btn.disabled = true; btn.textContent = 'Salvataggio…';
  errEl.style.display = 'none';
  try {
    for (const f of fields) {
      const el = document.getElementById('aedit-' + f.key);
      if (!el) continue;
      const val = el.value.trim();
      await apiCall('/admin/override/entity', {
        method: 'POST',
        body: { entity_type: entityType, entity_id: entityId, field: f.key, new_value: val }
      });
    }
    document.getElementById('admin-edit-overlay')?.remove();
    // Show brief confirmation
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--red-hot);color:#fff;padding:10px 24px;border-radius:6px;font-family:var(--font-display);font-size:1rem;letter-spacing:.06em;z-index:9999';
    toast.textContent = 'Modifiche salvate ✓';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  } catch (err) {
    errEl.textContent = 'Errore: ' + err.message; errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = 'SALVA';
  }
};

function slug(s) {
  if (!s) return '';
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // rimuove accenti
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ── THEME LOGIC ───────────────────────────────────────────────
function initTheme() {
  document.body.classList.add('light-mode');
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.style.display = 'none';
}

// ── ROUTER ────────────────────────────────────────────────────
const app = document.getElementById('app');
const footer_update = document.getElementById('footer-update');

let globalData = null;

window.addEventListener('hashchange', route);
window.addEventListener('load', async () => {
  globalData = await loadAll();
  updateMetaUI();

  document.getElementById('initial-loader')?.remove();
  initTheme();
  route();
  initSearch();
  initMobileMenu();

  // Logo click: se siamo in modalità hub → torna alla home generale
  document.getElementById('nav-logo-link')?.addEventListener('click', function(e) {
    if (activeHub) {
      e.preventDefault();
      window.clearHubFilter();
    }
  });

  // --- Sistema di AUTO-POLLING ---
  setInterval(async () => {
    try {
      const r = await fetch('data/meta.json', { cache: 'no-store' });
      const newMeta = await r.json();
      if (newMeta && newMeta.last_update) {
        if (!globalData.meta || newMeta.last_update !== globalData.meta.last_update) {
          console.log("Novità dal backend! Ricarico i dati silenziosamente...");
          // Invalida cache in memoria
          for (let k in cache) delete cache[k];
          
          globalData = await loadAll();
          updateMetaUI();
          route(); // Ri-renderizza la dashboard corrente con i nuovi dati
        }
      }
    } catch (e) {
      console.warn("Auto-polling fallito:", e);
    }
  }, 180000); // 3 minuti
});

function updateMetaUI() {
  if (globalData.meta?.last_update) {
    const d = new Date(globalData.meta.last_update);
    if(footer_update) footer_update.textContent = d.toLocaleString('it-IT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    
    // Live badge se l'update è recente (< 2 ore)
    const ageMs = Date.now() - d.getTime();
    const badge = document.getElementById('badge-live');
    if (badge) {
      if (ageMs < 2 * 3600 * 1000) badge.classList.add('visible');
      else badge.classList.remove('visible');
    }
  }
}

function route() {
  const hash = window.location.hash || '#/';
  updateNavActive(hash);

  // Hub routes — dedicated category ecosystem with URL-encoded context
  if (hash.startsWith('#/hub/')) {
    const hubParts = hash.slice(6).split('/');
    const hubCode = hubParts[0];
    const hubSub  = hubParts[1] || '';
    if (HUB_CONFIG[hubCode]) {
      activeHub = Object.assign({}, HUB_CONFIG[hubCode]);
      activeHub._code = hubCode;
      applyHubFilters(activeHub);
      try { localStorage.setItem('itcContext', hubCode); } catch(e) {}
      if (!hubSub || hubSub === 'home' || hubSub === '') return renderHubHome(hubCode);
      return renderHubSubpage(hubCode, hubSub);
    }
  }
  // activeHub persists as global filter — cleared only by clearHubFilter()

  // Restore saved context (no gate — users land directly on homepage)
  _softRestoreContext();

  const match = (pattern) => {
    const re = new RegExp('^' + pattern.replace(/:[^/]+/g, '([^/]+)') + '$');
    return hash.replace('#', '').match(re);
  };

  if (match('/')) {
    // When a hub is active, Home = hub home
    if (activeHub && activeHub._code) {
      window.location.hash = '#/hub/' + activeHub._code + '/';
      return;
    }
    return renderHome();
  }
  if (match('/classifica')) return renderClassifica();
  if (match('/atleti')) return renderAtletiList();
  if (match('/team')) return renderTeamList();
  if (match('/risultati')) {
    // Reset generic filters, then re-apply hub context if active
    risSearchQuery = ''; risQueryCat = ''; risQueryMonth = ''; risQueryRegion = ''; risQueryGenere = '';
    if (activeHub) applyHubFilters(activeHub);
    return renderRisultati();
  }
  if (match('/calendario')) {
    // Re-apply hub context if active (renderCalendario may reset calQ* internally)
    if (activeHub) applyHubFilters(activeHub);
    return renderCalendario();
  }
  if (match('/statistiche')) return renderStatistiche();
  if (match('/comparatore')) return renderComparatore();
  if (match('/regolamento')) return renderRegolamento();
  if (match('/login')) return renderLogin();
  if (match('/register')) return renderRegister();
  if (match('/profilo')) return renderMyProfile();
  if (match('/admin')) return renderAdmin();
  const m_atleta = match('/atleta/:id');
  if (m_atleta) return renderAtleta(m_atleta[1]);
  const m_team = match('/team/:id');
  if (m_team) return renderTeam(m_team[1]);
  const m_gara = match('/gara/:id');
  if (m_gara) return renderGara(m_gara[1]);
  const m_forma = match('/forma/:cat');
  if (m_forma) return renderForma(m_forma[1]);

  renderNotFound();
}

function updateNavActive(hash) {
  ['nav-home','nav-class','nav-atleti','nav-team','nav-cal','nav-risultati','nav-reg','nav-stats','nav-comp','nav-login'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  updateNavLoginState();
  // Hub routes: highlight based on subpage
  if (hash.startsWith('#/hub/')) {
    const sub = (hash.slice(6).split('/')[1] || '');
    const subMap = { classifica:'nav-class', risultati:'nav-risultati', atleti:'nav-atleti', team:'nav-team', calendario:'nav-cal', statistiche:'nav-stats', comparatore:'nav-comp', regolamento:'nav-reg', login:'nav-login' };
    document.getElementById(subMap[sub] || 'nav-home')?.classList.add('active');
    return;
  }
  if (hash === '#/' || hash === '#') document.getElementById('nav-home')?.classList.add('active');
  else if (hash.startsWith('#/classifica')) document.getElementById('nav-class')?.classList.add('active');
  else if (hash.startsWith('#/atleti')) document.getElementById('nav-atleti')?.classList.add('active');
  else if (hash.startsWith('#/team')) document.getElementById('nav-team')?.classList.add('active');
  else if (hash.startsWith('#/risultati')) document.getElementById('nav-risultati')?.classList.add('active');
  else if (hash.startsWith('#/statistiche')) document.getElementById('nav-stats')?.classList.add('active');
  else if (hash.startsWith('#/comparatore')) document.getElementById('nav-comp')?.classList.add('active');
  else if (hash.startsWith('#/login') || hash.startsWith('#/register') || hash.startsWith('#/profilo')) document.getElementById('nav-login')?.classList.add('active');
}

function setPage(html) {
  if (window.homeHeroInterval) {
    clearInterval(window.homeHeroInterval);
    window.homeHeroInterval = null;
  }
  const _fb = (typeof activeHub !== 'undefined' && activeHub)
    ? '<div class="global-filter-bar" style="--hub-color:' + activeHub.color + '">' +
        '<span class="gfb-dot"></span>' +
        '<span class="gfb-label">' + activeHub.icon + ' ' + activeHub.label + '</span>' +
        '<button class="gfb-clear" onclick="window.clearHubFilter()">✕ Tutto</button>' +
      '</div>'
    : '';
  app.innerHTML = `<main class="page page-enter">${_fb}${html}</main>`;
  updateNavContextChip();
}


// ════════════════════════════════════════════════════════════════════
//  ITALIACRIT MULTI-HUB SYSTEM
//  One platform, contextual category ecosystems
// ════════════════════════════════════════════════════════════════════

const HUB_CONFIG = {
  'uomini': {
    label:'Uomini', gender:'M',
    catCodes:['ELI_M','JUN_M','AL_M','ES2_M','ES1_M'],
    mainCat:'ELI_M', catFilter:'',
    icon:'♂', color:'#1D4ED8',
    gradient:'linear-gradient(135deg,#1D4ED8 0%,#0EA5E9 100%)',
    desc:'Tutto il ciclismo maschile italiano'
  },
  'donne': {
    label:'Donne', gender:'F',
    catCodes:['ELI_F','JUN_F','AL_F','ES2_F','ES1_F'],
    mainCat:'ELI_F', catFilter:'',
    icon:'♀', color:'#EC4899',
    gradient:'linear-gradient(135deg,#BE185D 0%,#EC4899 100%)',
    desc:'Tutto il ciclismo femminile italiano'
  },
  'elite-m': {
    label:'Elite / U23', gender:'M',
    catCodes:['ELI_M'],
    mainCat:'ELI_M', catFilter:'Elite',
    icon:'👑', color:'#F59E0B',
    gradient:'linear-gradient(135deg,#92400E 0%,#F59E0B 100%)',
    desc:'Il vertice del ciclismo maschile italiano'
  },
  'juniores-m': {
    label:'Juniores', gender:'M',
    catCodes:['JUN_M'],
    mainCat:'JUN_M', catFilter:'Junior',
    icon:'🏆', color:'#E11D48',
    gradient:'linear-gradient(135deg,#9F1239 0%,#E11D48 100%)',
    desc:'La classe del futuro del ciclismo maschile'
  },
  'allievi-m': {
    label:'Allievi', gender:'M',
    catCodes:['AL_M'],
    mainCat:'AL_M', catFilter:'Alliev',
    icon:'⭐', color:'#10B981',
    gradient:'linear-gradient(135deg,#065F46 0%,#10B981 100%)',
    desc:'I talenti in crescita del pedale maschile'
  },
  'esordienti-m': {
    label:'Esordienti', gender:'M',
    catCodes:['ES2_M','ES1_M'],
    mainCat:'ES2_M', catFilter:'Esordient',
    icon:'🌱', color:'#6366F1',
    gradient:'linear-gradient(135deg,#3730A3 0%,#6366F1 100%)',
    desc:'I giovanissimi campioni del domani'
  },
  'elite-f': {
    label:'Elite Donne', gender:'F',
    catCodes:['ELI_F'],
    mainCat:'ELI_F', catFilter:'Elite',
    icon:'👑', color:'#F472B6',
    gradient:'linear-gradient(135deg,#9D174D 0%,#F472B6 100%)',
    desc:'Il vertice del ciclismo femminile italiano'
  },
  'juniores-f': {
    label:'Juniores Donne', gender:'F',
    catCodes:['JUN_F'],
    mainCat:'JUN_F', catFilter:'Junior',
    icon:'🏆', color:'#F43F5E',
    gradient:'linear-gradient(135deg,#881337 0%,#F43F5E 100%)',
    desc:'Il futuro del ciclismo femminile'
  },
  'allievi-f': {
    label:'Allieve', gender:'F',
    catCodes:['AL_F'],
    mainCat:'AL_F', catFilter:'Alliev',
    icon:'⭐', color:'#8B5CF6',
    gradient:'linear-gradient(135deg,#4C1D95 0%,#8B5CF6 100%)',
    desc:'I talenti femminili in crescita'
  },
  'esordienti-f': {
    label:'Esordienti Donne', gender:'F',
    catCodes:['ES2_F','ES1_F'],
    mainCat:'ES2_F', catFilter:'Esordient',
    icon:'🌱', color:'#A78BFA',
    gradient:'linear-gradient(135deg,#5B21B6 0%,#A78BFA 100%)',
    desc:'Le giovanissime campionesse del domani'
  },
};

const _HUB_MONTHS = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];

let activeHub = null;

// ── Hub secondary navigation strip ───────────────────────────────────
function buildHubSubnav(hub) {
  const h = window.location.hash || '';
  const code = hub._code || '';
  const base = '#/hub/' + code;
  const tabs = [
    { path:'',             label:'Home' },
    { path:'/risultati',   label:'Risultati' },
    { path:'/classifica',  label:'Classifica' },
    { path:'/atleti',      label:'Atleti' },
    { path:'/team',        label:'Team' },
    { path:'/calendario',  label:'Calendario' },
    { path:'/statistiche', label:'Statistiche' },
    { path:'/comparatore', label:'Comparatore' },
    { path:'/regolamento', label:'Regolamento' },
  ];
  const tabsHtml = tabs.map(function(t) {
    const href = base + t.path;
    const isActive = t.path === ''
      ? (h === base || h === base + '/home' || h === base + '/')
      : h.startsWith(base + t.path);
    return '<a href="' + href + '" class="hub-subnav-tab' + (isActive ? ' hub-subnav-active' : '') + '">' + t.label + '</a>';
  }).join('');
  return '<div class="hub-subnav" style="--hub-color:' + hub.color + '">' +
    '<a href="#/" class="hub-subnav-back" onclick="window.clearHubFilter();return false;">← Tutti</a>' +
    '<span class="hub-subnav-name">' + hub.icon + ' ' + hub.label.toUpperCase() + '</span>' +
    '<div class="hub-subnav-tabs">' + tabsHtml + '</div>' +
  '</div>';
}

// ── Set hub filter state on all page-level filter vars ────────────────
function applyHubFilters(hub) {
  rankGender = hub.gender;
  rankCat = hub.mainCat;
  atlGender = hub.gender;
  atlCat = hub.mainCat;
  teamGender = hub.gender;
  teamCat = hub.mainCat;
  risSearchQuery = '';
  risQueryCat = '';
  risQueryMonth = '';
  risQueryRegion = '';
  risQueryGenere = hub.gender;
  calQGenere = hub.gender;
  calQCat = (hub.catFilter || '').toLowerCase();
  calQMonth = '';
  calQSearch = '';
  calQTipo = '';
  calQRegione = '';
  // Apply hub theme to document
  document.body.setAttribute('data-hub', hub._code || '');
  document.documentElement.style.setProperty('--hub-color', hub.color);
  document.documentElement.style.setProperty('--hub-gradient', hub.gradient || '');
}

// ── Network section for global homepage ─────────────────────────────
function buildNetworkSection(resultsRaw, calendar) {
  const lastDate = resultsRaw.reduce(function(mx,r){ return (r.data||'')>mx?r.data:mx; }, '');
  const cut14 = (function(){ var d=new Date(lastDate||new Date()); d.setDate(d.getDate()-14); return d.toISOString().split('T')[0]; })();

  // Hottest hub by recent activity
  const recentCounts = {};
  resultsRaw.filter(function(r){ return r.data >= cut14; }).forEach(function(r) {
    var code = getRankingFileCode(r);
    if (code) recentCounts[code] = (recentCounts[code]||0) + 1;
  });
  const hottestCode = Object.entries(recentCounts).sort(function(a,b){ return b[1]-a[1]; })[0];
  const hottestCat = hottestCode ? hottestCode[0] : '';

  // Gender totals
  var mCount = 0, fCount = 0;
  var mAthletes = new Set(), fAthletes = new Set();
  resultsRaw.forEach(function(r) {
    if (r.genere === 'F') { fCount++; if(r.atleta_id) fAthletes.add(r.atleta_id); }
    else { mCount++; if(r.atleta_id) mAthletes.add(r.atleta_id); }
  });

  // Gender cards
  const genderCards =
    '<div class="em-gender-card em-gender-m" onclick="location.hash=\'#/hub/uomini\'">' +
      '<div class="em-gender-symbol">♂</div>' +
      '<div class="em-gender-name">UOMINI</div>' +
      '<div class="em-gender-cats">Elite · Juniores · Allievi · Esordienti</div>' +
      '<div class="em-gender-stats">' + mAthletes.size + ' atleti</div>' +
      '<div class="em-gender-cta">Entra →</div>' +
    '</div>' +
    '<div class="em-gender-card em-gender-f" onclick="location.hash=\'#/hub/donne\'">' +
      '<div class="em-gender-symbol">♀</div>' +
      '<div class="em-gender-name">DONNE</div>' +
      '<div class="em-gender-cats">Elite · Juniores · Allieve · Esordienti</div>' +
      '<div class="em-gender-stats">' + fAthletes.size + ' atlete</div>' +
      '<div class="em-gender-cta">Entra →</div>' +
    '</div>';

  // Individual hub cards
  const indivHubs = ['elite-m','juniores-m','allievi-m','esordienti-m','elite-f','juniores-f','allievi-f','esordienti-f'];
  const hubCards = indivHubs.map(function(code) {
    const hub = HUB_CONFIG[code];
    const isHot = hub.catCodes.includes(hottestCat);
    const cnt = new Set(resultsRaw.filter(function(r) {
      return r.genere === hub.gender && hub.catCodes.includes(getRankingFileCode(r));
    }).map(function(r){ return r.atleta_id; })).size;
    return '<div class="hub-entry-card" style="--hub-color:' + hub.color + ';--hub-gradient:' + hub.gradient + '" onclick="location.hash=\'#/hub/' + code + '\'">' +
      '<div class="hub-entry-top">' +
        '<span class="hub-entry-icon">' + hub.icon + '</span>' +
        (isHot ? '<span class="hub-entry-hot">🔥</span>' : '') +
      '</div>' +
      '<div class="hub-entry-label">' + hub.label + '</div>' +
      '<div class="hub-entry-desc">' + hub.desc + '</div>' +
      '<div class="hub-entry-count">' + cnt + ' atleti</div>' +
      '<div class="hub-entry-cta">Entra →</div>' +
    '</div>';
  }).join('');

  return '<section class="em-network">' +
    '<div class="em-network-header">' +
      '<div class="em-network-eyebrow">🌐 ITALIACRIT NETWORK</div>' +
      '<h2 class="em-network-title">Scegli il tuo ecosistema</h2>' +
      '<div class="em-network-sub">Ogni categoria ha il suo mondo — risultati, classifica, rivalità</div>' +
    '</div>' +
    '<div class="em-network-genders">' + genderCards + '</div>' +
    '<div class="em-network-hubs">' + hubCards + '</div>' +
  '</section>';
}

// ── Hub Homepage ──────────────────────────────────────────────────────
async function renderHubHome(hubCode) {
  if (!globalData) return;
  const hub = HUB_CONFIG[hubCode];
  if (!hub) { renderNotFound(); return; }
  activeHub = Object.assign({}, hub);
  activeHub._code = hubCode;
  applyHubFilters(activeHub);

  const { resultsRaw, calendar } = globalData;

  // Load rankings
  const es1Code = hub.catCodes.find(function(c) { return c.startsWith('ES1'); });
  const es2Code = hub.mainCat;
  const isEsordienti = !!es1Code;
  const hubRanking    = (await loadRanking(es2Code)).slice(0, 5);
  const hubRankingES1 = es1Code ? (await loadRanking(es1Code)).slice(0, 5) : null;

  // Filter results to this hub, then split by year for esordienti
  const hubRes = resultsRaw.filter(function(r) {
    return r.genere === hub.gender && hub.catCodes.includes(getRankingFileCode(r));
  });
  const hubResES2 = isEsordienti ? hubRes.filter(function(r){ return getRankingFileCode(r) === es2Code; }) : hubRes;
  const hubResES1 = isEsordienti ? hubRes.filter(function(r){ return getRankingFileCode(r) === es1Code; }) : [];

  // Date helpers
  const MONTHS_SHORT = ['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'];
  const lastDate = hubRes.reduce(function(mx,r){ return (r.data||'')>mx?r.data:mx; }, '');
  const cut14 = (function(){ const d=new Date(lastDate||new Date()); d.setDate(d.getDate()-14); return d.toISOString().split('T')[0]; })();
  const cut7  = (function(){ const d=new Date(lastDate||new Date()); d.setDate(d.getDate()-7);  return d.toISOString().split('T')[0]; })();
  const todayStr = new Date().toISOString().split('T')[0];

  // ── Helper: compute "rider on fire" from a result set ──────────
  function computeFire(resSet) {
    const fm = {};
    resSet.filter(function(r){ return r.data >= cut14; }).forEach(function(r) {
      if (!fm[r.atleta_id]) fm[r.atleta_id] = { atleta_id:r.atleta_id, cognome:r.cognome, nome:r.nome, team:r.team, wins:0, podi:0, pts:0, code:getRankingFileCode(r) };
      if (r.posizione === 1) fm[r.atleta_id].wins++;
      if (r.posizione <= 3) fm[r.atleta_id].podi++;
      fm[r.atleta_id].pts += (r.punti_effettivi||0);
    });
    const list = Object.values(fm).sort(function(a,b){ return b.wins-a.wins||b.podi-a.podi||b.pts-a.pts; });
    const ath = list[0] || null;
    return { ath, streak: ath ? siStreak(ath.atleta_id, resSet) : null };
  }

  const fireES2 = computeFire(hubResES2);
  const fireES1 = isEsordienti ? computeFire(hubResES1) : { ath: null, streak: null };
  // Legacy aliases for non-esordienti paths
  const fireAthlete = fireES2.ath;
  const fireStreak  = fireES2.streak;

  // Recent winners (last 7 days) — combined for ticker
  const recentWins = hubRes.filter(function(r){ return r.data >= cut7 && r.posizione === 1; })
    .sort(function(a,b){ return b.data.localeCompare(a.data); }).slice(0, 5);

  // Upcoming hub races (all, no slice — will group for esordienti)
  const upcomingAll = calendar.filter(function(g) {
    if (g.genere && g.genere !== hub.gender) return false;
    if (hub.catFilter && !(g.categoria||'').toLowerCase().includes(hub.catFilter.toLowerCase())) return false;
    return (g.data||'') >= todayStr;
  }).sort(function(a,b){ return a.data.localeCompare(b.data); });

  // ── Helper: spotlight card ─────────────────────────────────────
  function buildSpotlightHtml(ath, streak, catCode) {
    if (!ath) return '<section class="em-spotlight em-spotlight--half">' +
      '<div class="em-spotlight-body">' +
        '<div class="em-spot-meta"><span class="em-spot-badge">🔥 RIDER ON FIRE</span>' +
        '<span class="em-spot-cat">' + catLabel(catCode) + '</span></div>' +
        '<p style="color:rgba(255,255,255,0.3);font-size:0.82rem;margin-top:12px">Nessun dato recente</p>' +
      '</div></section>';
    return '<section class="em-spotlight em-spotlight--half">' +
      '<div class="em-spotlight-bg-name">' + esc(ath.cognome) + '</div>' +
      '<div class="em-spotlight-body">' +
        '<div class="em-spot-meta">' +
          '<span class="em-spot-badge">🔥 RIDER ON FIRE</span>' +
          '<span class="em-spot-cat">' + catLabel(catCode) + '</span>' +
          (streak && streak.winStreak >= 2 ? '<div class="si-streak-badge">👑 ' + streak.winStreak + ' vittorie di fila</div>' : '') +
        '</div>' +
        '<h2 class="em-spot-name">' + esc(ath.cognome) + '<br><span class="em-spot-firstname">' + esc(ath.nome) + '</span></h2>' +
        '<div class="em-spot-team">' + esc(ath.team||'') + '</div>' +
        '<div class="em-spot-stats">' +
          '<div class="em-stat"><span class="em-stat-val">' + ath.pts + '</span><span class="em-stat-lbl">punti 14gg</span></div>' +
          '<div class="em-stat"><span class="em-stat-val">' + ath.wins + '</span><span class="em-stat-lbl">vittorie</span></div>' +
          '<div class="em-stat"><span class="em-stat-val">' + ath.podi + '</span><span class="em-stat-lbl">podi</span></div>' +
        '</div>' +
        '<a href="#/atleta/' + encodeURIComponent(ath.atleta_id) + '" class="em-spot-cta">Scheda atleta →</a>' +
      '</div></section>';
  }

  // ── Helper: rivalry section ────────────────────────────────────
  function buildRivalHtml(resSet, catCode, isHalf) {
    const rv = siRivalryFinder(resSet)[0] || null;
    if (!rv) return '';
    const vsClass = isHalf ? 'em-versus em-versus--half' : 'em-versus';
    return '<section class="' + vsClass + '">' +
      '<div class="em-versus-label">⚔ RIVALITÀ · ' + catLabel(catCode) + ' · ' + rv.encounters + ' scontri</div>' +
      '<div class="em-versus-ring">' +
        '<div class="em-vs-side em-vs-a">' +
          '<div class="em-vs-pos">' + rv.aWins + 'V</div>' +
          '<a href="#/atleta/' + encodeURIComponent(rv.aId) + '" class="em-vs-name">' + esc(rv.aCog) + '<br><small>' + esc(rv.aNom) + '</small></a>' +
          '<div class="em-vs-team">' + esc(rv.aTeam||'') + '</div>' +
        '</div>' +
        '<div class="em-vs-center"><div class="em-vs-vs">VS</div><div class="em-vs-gap">' + rv.encounters + ' sfide</div></div>' +
        '<div class="em-vs-side em-vs-b">' +
          '<div class="em-vs-pos">' + rv.bWins + 'V</div>' +
          '<a href="#/atleta/' + encodeURIComponent(rv.bId) + '" class="em-vs-name">' + esc(rv.bCog) + '<br><small>' + esc(rv.bNom) + '</small></a>' +
          '<div class="em-vs-team">' + esc(rv.bTeam||'') + '</div>' +
        '</div>' +
      '</div></section>';
  }

  // ── Helper: newsroom section ────────────────────────────────────
  function buildNewsHtml(resSet, label) {
    const items = siNewsroomFeed(resSet, [], [], [], {}).slice(0, 5);
    if (!items.length) return '';
    return '<section class="em-newsroom">' +
      '<div class="em-newsroom-header"><span class="em-newsroom-badge">📡 ' + label + '</span></div>' +
      '<div class="em-newsroom-feed">' +
        items.map(function(item) {
          const click = item.atleta_id
            ? ' onclick="location.hash=\'#/atleta/' + item.atleta_id + '\'"'
            : item.team_id ? ' onclick="location.hash=\'#/team/' + item.team_id + '\'"' : '';
          return '<div class="em-news-item em-news-' + item.type + '"' + click + '>' +
            '<span class="em-news-icon">' + item.icon + '</span>' +
            '<div class="em-news-text">' + item.text + '</div>' +
            ((item.atleta_id || item.team_id) ? '<span class="em-news-arrow">→</span>' : '') +
          '</div>';
        }).join('') +
      '</div></section>';
  }

  // ── Helper: ranking section ─────────────────────────────────────
  function buildRankSection(ranking, catCode) {
    if (!ranking || !ranking.length) return '';
    return '<section class="hub-ranking-section">' +
      '<div class="hub-section-header">' +
        '<div class="hub-section-label">🏆 TOP CLASSIFICA · ' + catLabel(catCode) + '</div>' +
        '<a href="#/classifica" class="hub-section-more">Vedi tutto →</a>' +
      '</div>' +
      '<div class="hub-rank-list">' +
        ranking.map(function(a, i) {
          return '<div class="hub-rank-row' + (i===0?' hub-rank-leader':'') + '" onclick="location.hash=\'#/atleta/' + encodeURIComponent(a.atleta_id) + '\'">' +
            '<span class="hub-rank-pos' + (i===0?' hub-rank-pos-1':i===1?' hub-rank-pos-2':i===2?' hub-rank-pos-3':'') + '">' + (i+1) + '</span>' +
            '<div class="hub-rank-info">' +
              '<div class="hub-rank-name">' + esc(a.cognome) + ' ' + esc(a.nome) + '</div>' +
              '<div class="hub-rank-team">' + esc(a.team_attuale||a.team||'') + '</div>' +
            '</div>' +
            '<span class="hub-rank-pts">' + a.punti + '<small> pt</small></span>' +
          '</div>';
        }).join('') +
      '</div></section>';
  }

  // ── Helper: wrap two sections side by side ──────────────────────
  function dualWrap(htmlA, htmlB) {
    if (!htmlA && !htmlB) return '';
    return '<div class="hub-dual">' + (htmlA||'') + (htmlB||'') + '</div>';
  }

  // ── Ticker ──────────────────────────────────────────────────────
  const tickerItems = [];
  recentWins.slice(0, 3).forEach(function(r){ tickerItems.push('🥇 <strong>' + esc(r.cognome).toUpperCase() + '</strong> vince ' + esc(r.nome_gara||'')); });
  if (fireAthlete && fireStreak && fireStreak.winStreak >= 2) tickerItems.push('👑 <strong>' + esc(fireAthlete.cognome).toUpperCase() + '</strong> — ' + fireStreak.winStreak + ' vittorie consecutive');
  if (upcomingAll[0]) {
    const dys = Math.round((new Date(upcomingAll[0].data) - new Date(todayStr)) / 86400000);
    tickerItems.push('📅 <strong>PROSSIMA' + (dys===0?' OGGI':dys===1?' DOMANI':'') + ':</strong> ' + esc(upcomingAll[0].nome));
  }

  // ── Race map — all hub races (genere + catCodes already filtered) ─
  const raceMap = {};
  for (const r of hubRes) {
    if (!raceMap[r.gara_id]) raceMap[r.gara_id] = { id:r.gara_id, nome:r.nome_gara, data:r.data, categoria:r.categoria, genere:r.genere, tipo:r.tipo, results:[] };
    raceMap[r.gara_id].results.push(r);
  }
  const allRacesSorted = Object.values(raceMap).sort(function(a,b){ return (b.data||'').localeCompare(a.data||''); });
  // Show only races from the most recent weekend
  const lastWkKey = lastDate ? weekendKey(lastDate) : null;
  const lastWeekRaces = lastWkKey
    ? allRacesSorted.filter(function(r){ return r.data && weekendKey(r.data) === lastWkKey; })
    : [];

  // ── Helper: build hub-last-list rows ───────────────────────────
  function buildLastRows(races) {
    return races.map(function(r) {
      const w = r.results.find(function(x){ return x.posizione === 1; });
      const d = new Date(r.data + 'T00:00:00');
      const dateStr = d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()];
      const rcCode = getRankingFileCode({categoria:r.categoria, genere:r.genere, tipo:r.tipo});
      return '<div class="hub-last-row" onclick="location.hash=\'#/risultati/' + encodeURIComponent(r.id) + '\'">' +
        '<span class="hub-last-date">' + dateStr + '</span>' +
        '<span class="hub-last-cat">' + catLabel(rcCode||r.categoria||'') + '</span>' +
        '<span class="hub-last-name">' + esc(r.nome) + '</span>' +
        (w ? '<span class="hub-last-winner">&#127945; ' + esc(w.cognome) + ' ' + esc(w.nome) + '</span>'
           : '<span class="hub-last-winner" style="opacity:.35">—</span>') +
      '</div>';
    }).join('');
  }

  // ── 1. HERO — nome categoria, layout centrato ────────────────────
  const heroHtml = '<section class="em-hero">' +
    '<div class="em-hero-content em-hero-content--centered">' +
      '<div class="em-hero-left">' +
        '<div class="em-eyebrow">ITALIACRIT · ' + hub.icon + ' ' + hub.label.toUpperCase() + '</div>' +
        '<h1 class="em-title hub-cat-title">' + esc(hub.label.toUpperCase()) + '</h1>' +
        '<p class="em-subtitle">' + esc(hub.desc) + '</p>' +
        '<div class="em-hero-ctas">' +
          '<a href="#/classifica" class="em-btn-primary">Classifiche</a>' +
          '<a href="#/risultati" class="em-btn-ghost">Risultati</a>' +
        '</div>' +
      '</div>' +
    '</div>' +
    (tickerItems.length ? '<div class="em-ticker-bar"><div class="em-ticker-inner"><span class="em-ticker-track">' + [...tickerItems,...tickerItems].join(' &nbsp;&middot;&nbsp; ') + '</span></div></div>' : '') +
  '</section>';

  // ── 2. ULTIMI RISULTATI — piena larghezza, per categoria/genere ──
  let lastResultsHtml = '';
  if (lastWeekRaces.length) {
    if (isEsordienti) {
      // Split ES1 / ES2 side by side
      const es1Races = lastWeekRaces.filter(function(r){ return getRankingFileCode({categoria:r.categoria,genere:r.genere,tipo:r.tipo}) === es1Code; });
      const es2Races = lastWeekRaces.filter(function(r){ return getRankingFileCode({categoria:r.categoria,genere:r.genere,tipo:r.tipo}) === es2Code; });
      const makeHalf = function(races, label) {
        if (!races.length) return '';
        return '<section class="hub-last-results hub-last-results--half">' +
          '<div class="hub-section-header hub-section-header--wide">' +
            '<div class="hub-section-label">🏁 ' + label + '</div>' +
          '</div>' +
          '<div class="hub-last-list">' + buildLastRows(races) + '</div>' +
        '</section>';
      };
      lastResultsHtml = dualWrap(
        makeHalf(es1Races, 'ESORDIENTI 1° ANNO'),
        makeHalf(es2Races, 'ESORDIENTI 2° ANNO')
      );
    } else {
      lastResultsHtml =
        '<section class="hub-last-results">' +
          '<div class="hub-section-header hub-section-header--wide">' +
            '<div class="hub-section-label">🏁 ULTIMI RISULTATI</div>' +
            '<a href="#/risultati" class="hub-section-more">Tutti i risultati &rarr;</a>' +
          '</div>' +
          '<div class="hub-last-list">' + buildLastRows(lastWeekRaces) + '</div>' +
        '</section>';
    }
  }

  // ── 3. RIDER ON FIRE ────────────────────────────────────────────
  const spotlightHtml = isEsordienti
    ? dualWrap(buildSpotlightHtml(fireES1.ath, fireES1.streak, es1Code), buildSpotlightHtml(fireES2.ath, fireES2.streak, es2Code))
    : buildSpotlightHtml(fireAthlete, fireStreak, hub.mainCat);

  // ── 4. TOP CLASSIFICA ───────────────────────────────────────────
  const rankHtml = isEsordienti && hubRankingES1
    ? dualWrap(buildRankSection(hubRankingES1, es1Code), buildRankSection(hubRanking, es2Code))
    : buildRankSection(hubRanking, hub.mainCat);

  // ── 5. RIVALITÀ — half (in dual) per esordienti, full per gli altri
  const rivalHtml = isEsordienti
    ? dualWrap(buildRivalHtml(hubResES1, es1Code, true), buildRivalHtml(hubResES2, es2Code, true))
    : buildRivalHtml(hubRes, hub.mainCat, false);

  // ── 5. NEWSROOM ─────────────────────────────────────────────────
  const newsHtml = isEsordienti
    ? dualWrap(buildNewsHtml(hubResES1, 'ESORDIENTI 1° ANNO'), buildNewsHtml(hubResES2, 'ESORDIENTI 2° ANNO'))
    : buildNewsHtml(hubRes, hub.label.toUpperCase() + ' · NEWSROOM');

  // ── 6. PROSSIME GARE — solo il prossimo fine settimana ──────────
  let upHtml = '';
  if (upcomingAll.length) {
    // Trova il weekend del primo evento in arrivo e mostra solo quello
    const nextWk = weekendKey(upcomingAll[0].data);
    const nextWkRaces = upcomingAll.filter(function(g){ return weekendKey(g.data) === nextWk; });
    const satD = new Date(nextWk + 'T00:00:00');
    const sunD = new Date(satD); sunD.setDate(satD.getDate() + 1);
    const wkLabel = satD.getDate() + '–' + sunD.getDate() + ' ' + MONTHS_SHORT[satD.getMonth()] + ' ' + satD.getFullYear();
    const DAY_NAMES = ['DOM','LUN','MAR','MER','GIO','VEN','SAB'];
    upHtml = '<section class="hub-upcoming-weekend">' +
      '<div class="hub-section-header hub-section-header--wide">' +
        '<div class="hub-section-label">🗓 PROSSIMO FINE SETTIMANA &nbsp;<span class="hub-wk-date">' + wkLabel + '</span></div>' +
        '<a href="#/calendario" class="hub-section-more">Calendario &rarr;</a>' +
      '</div>' +
      '<div class="hub-last-list">' +
        nextWkRaces.map(function(g) {
          const gd   = new Date(g.data + 'T00:00:00');
          const days = Math.round((gd - new Date(todayStr + 'T00:00:00')) / 86400000);
          const dayLabel = days === 0 ? '<span class="hub-ug-oggi">OGGI</span>'
                         : days === 1 ? '<span class="hub-ug-domani">DOMANI</span>'
                         : DAY_NAMES[gd.getDay()];
          return '<div class="hub-last-row" onclick="location.hash=\'#/calendario/' + encodeURIComponent(g.id) + '\'">' +
            '<span class="hub-last-date">' + dayLabel + '</span>' +
            '<span class="hub-last-cat">' + esc(catLabel(g.categoria)||g.categoria||'') + '</span>' +
            '<span class="hub-last-name">' + esc(g.nome) + '</span>' +
            '<span class="hub-last-winner" style="opacity:.5">' + esc(g.luogo||g.regione||'') + '</span>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</section>';
  }

  setPage(heroHtml + lastResultsHtml + spotlightHtml + rankHtml + rivalHtml + newsHtml + upHtml);
}

// ── Hub subpage dispatcher ────────────────────────────────────────────
function renderHubSubpage(hubCode, subpage) {
  const hub = HUB_CONFIG[hubCode];
  if (!hub) { renderNotFound(); return; }
  activeHub = hub;
  activeHub._code = hubCode;
  applyHubFilters(hub);
  switch (subpage) {
    case 'risultati':    return renderRisultati();
    case 'classifica':   return renderClassifica();
    case 'atleti':       return renderAtletiList();
    case 'team':         return renderTeamList();
    case 'calendario':   return renderCalendario();
    case 'statistiche':  return renderStatistiche();
    case 'comparatore':  return renderComparatore();
    case 'regolamento':  return renderRegolamento();
    default:             return renderHubHome(hubCode);
  }
}

// ── GLOBAL FILTER HELPERS ─────────────────────────────────────────
function _softRestoreContext() {
  if (activeHub) return;
  var _s;
  try { _s = localStorage.getItem('itcContext'); } catch(e) { return; }
  if (_s && _s !== 'skip' && HUB_CONFIG[_s]) {
    activeHub = Object.assign({}, HUB_CONFIG[_s]);
    activeHub._code = _s;
    applyHubFilters(activeHub);
  }
}

window.clearHubFilter = function() {
  activeHub = null;
  try { localStorage.setItem('itcContext', 'skip'); } catch(e) {}
  document.body.removeAttribute('data-hub');
  document.documentElement.style.removeProperty('--hub-color');
  document.documentElement.style.removeProperty('--hub-gradient');
  rankGender = 'M'; rankCat = 'ES1_M'; rankFilter = ''; rankRegion = ''; rankMonth = '';
  atlGender = 'M'; atlCat = 'JUN_M'; atlSearch = '';
  teamGender = 'M'; teamCat = 'JUN_M'; teamSearch = '';
  risQueryGenere = ''; risQueryCat = ''; risQueryMonth = ''; risQueryRegion = ''; risSearchQuery = '';
  calQGenere = ''; calQCat = ''; calQMonth = ''; calQSearch = ''; calQTipo = ''; calQRegione = '';
  // If on a hub URL, navigate to home — hashchange triggers route() with cleared state
  if ((window.location.hash || '').startsWith('#/hub/')) {
    window.location.hash = '#/';
  } else {
    route();
  }
};

function buildCategoryStrip() {
  const cats = [
    { code:'elite-m',      label:'Elite/U23 ♂', color:'#F59E0B' },
    { code:'juniores-m',   label:'Juniores ♂',  color:'#E11D48' },
    { code:'allievi-m',    label:'Allievi ♂',   color:'#10B981' },
    { code:'esordienti-m', label:'Esord. ♂',    color:'#6366F1' },
    { code:'elite-f',      label:'Elite/U23 ♀', color:'#F472B6' },
    { code:'juniores-f',   label:'Juniores ♀',  color:'#F43F5E' },
    { code:'allievi-f',    label:'Allieve ♀',   color:'#8B5CF6' },
    { code:'esordienti-f', label:'Esord. ♀',    color:'#A78BFA' },
  ];
  return '<div class="cat-filter-strip">' +
    '<span class="cat-filter-label">ESPLORA</span>' +
    '<div class="cat-filter-chips">' +
      cats.map(function(c) {
        return '<a href="#/hub/' + c.code + '/classifica" class="cat-chip" style="--chip-color:' + c.color + '">' + c.label + '</a>';
      }).join('') +
    '</div>' +
  '</div>';
}

// ── ENTRY EXPERIENCE ─────────────────────────────────────────────────

var ENTRY_CATS = {
  M: [
    { code: 'elite-m',      label: 'ELITE / U23', sub: 'Maschile', color: '#F59E0B', gradient: 'linear-gradient(145deg,#78350f 0%,#d97706 100%)' },
    { code: 'juniores-m',   label: 'JUNIORES',    sub: 'Maschile', color: '#E11D48', gradient: 'linear-gradient(145deg,#881337 0%,#E11D48 100%)' },
    { code: 'allievi-m',    label: 'ALLIEVI',     sub: 'Maschile', color: '#10B981', gradient: 'linear-gradient(145deg,#064e3b 0%,#10B981 100%)' },
    { code: 'esordienti-m', label: 'ESORDIENTI',  sub: 'Maschile', color: '#6366F1', gradient: 'linear-gradient(145deg,#312e81 0%,#6366F1 100%)' }
  ],
  F: [
    { code: 'elite-f',      label: 'ELITE / U23', sub: 'Femminile', color: '#F472B6', gradient: 'linear-gradient(145deg,#831843 0%,#db2777 100%)' },
    { code: 'juniores-f',   label: 'JUNIORES',    sub: 'Femminile', color: '#F43F5E', gradient: 'linear-gradient(145deg,#881337 0%,#F43F5E 100%)' },
    { code: 'allievi-f',    label: 'ALLIEVE',     sub: 'Femminile', color: '#8B5CF6', gradient: 'linear-gradient(145deg,#4c1d95 0%,#8B5CF6 100%)' },
    { code: 'esordienti-f', label: 'ESORDIENTI',  sub: 'Femminile', color: '#A78BFA', gradient: 'linear-gradient(145deg,#4c1d95 0%,#A78BFA 100%)' }
  ]
};

function _entryHideShell() {
  var nb = document.getElementById('navbar');
  var nd = document.getElementById('nav-drawer');
  var ft = document.querySelector('footer');
  if (nb) nb.style.display = 'none';
  if (nd) nd.style.display = 'none';
  if (ft) ft.style.display = 'none';
}

function _entryShowShell() {
  var nb = document.getElementById('navbar');
  var nd = document.getElementById('nav-drawer');
  var ft = document.querySelector('footer');
  if (nb) nb.style.display = '';
  if (nd) nd.style.display = '';
  if (ft) ft.style.display = '';
}

function renderEntry(step, data) {
  _entryHideShell();
  var appEl = document.getElementById('app');

  if (!step || step === 'gender') {
    appEl.innerHTML =
      '<div class="entry-page" id="entry-page">' +
        '<div class="entry-bg-glow"></div>' +
        '<div class="entry-content">' +
          '<div class="entry-brand">' +
            '<div class="entry-logo-ring">ITC</div>' +
            '<h1 class="entry-title">ITALIACRIT</h1>' +
            '<p class="entry-tagline">Il Ciclismo Agonistico Italiano</p>' +
          '</div>' +
          '<div class="entry-selector">' +
            '<p class="entry-prompt">SCEGLI IL TUO MONDO</p>' +
            '<div class="entry-gender-grid">' +
              '<div class="entry-gender-card entry-men" onclick="window._entryGender(\'M\')">' +
                '<div class="entry-gender-symbol">&#9794;</div>' +
                '<div class="entry-gender-name">UOMINI</div>' +
                '<div class="entry-gender-cta">Entra &#8594;</div>' +
              '</div>' +
              '<div class="entry-gender-card entry-women" onclick="window._entryGender(\'F\')">' +
                '<div class="entry-gender-symbol">&#9792;</div>' +
                '<div class="entry-gender-name">DONNE</div>' +
                '<div class="entry-gender-cta">Entra &#8594;</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="entry-skip" onclick="window._entrySkip()">Continua senza selezionare &#8594;</div>' +
        '</div>' +
      '</div>';
    requestAnimationFrame(function() {
      var p = document.getElementById('entry-page');
      if (!p) return;
      p.style.opacity = '0';
      requestAnimationFrame(function() {
        p.style.transition = 'opacity .5s ease';
        p.style.opacity = '1';
      });
    });

  } else if (step === 'category') {
    var gender = data.gender;
    var cats = ENTRY_CATS[gender];
    var gLabel = gender === 'M' ? '&#9794; UOMINI' : '&#9792; DONNE';
    var catsHtml = cats.map(function(c) {
      return '<div class="entry-cat-card" style="background:' + c.gradient + ';--cat-c:' + c.color + '" onclick="window._entryCat(\'' + c.code + '\')">' +
        '<div class="entry-cat-name">' + c.label + '</div>' +
        '<div class="entry-cat-sub">' + c.sub + '</div>' +
        '<div class="entry-cat-go">&#8594;</div>' +
        '</div>';
    }).join('');
    appEl.innerHTML =
      '<div class="entry-page entry-cat-view" id="entry-page">' +
        '<div class="entry-bg-glow"></div>' +
        '<div class="entry-content">' +
          '<button class="entry-back" onclick="window.renderEntry()">&larr; ' + gLabel + '</button>' +
          '<p class="entry-prompt entry-prompt-cat">SCEGLI LA TUA CATEGORIA</p>' +
          '<div class="entry-cat-grid">' + catsHtml + '</div>' +
          '<div class="entry-skip" onclick="window._entrySkip()">Continua senza selezionare &#8594;</div>' +
        '</div>' +
      '</div>';
    requestAnimationFrame(function() {
      var p = document.getElementById('entry-page');
      if (!p) return;
      p.style.opacity = '0';
      requestAnimationFrame(function() {
        p.style.transition = 'opacity .4s ease';
        p.style.opacity = '1';
      });
    });
  }
}
window.renderEntry = renderEntry;

window._entryGender = function(gender) {
  var p = document.getElementById('entry-page');
  if (p) {
    p.style.transition = 'opacity .28s ease, transform .28s ease';
    p.style.opacity = '0';
    p.style.transform = 'scale(.97)';
  }
  setTimeout(function() { renderEntry('category', { gender: gender }); }, 300);
};

window._entryCat = function(hubCode) {
  var p = document.getElementById('entry-page');
  if (p) {
    p.style.transition = 'opacity .5s ease, transform .5s ease';
    p.style.opacity = '0';
    p.style.transform = 'scale(1.04)';
  }
  setTimeout(function() {
    _entryShowShell();
    activeHub = Object.assign({}, HUB_CONFIG[hubCode]);
    activeHub._code = hubCode;
    applyHubFilters(activeHub);
    try { localStorage.setItem('itcContext', hubCode); } catch(e) {}
    var returnHash = window._entryReturnHash || '#/';
    window._entryReturnHash = null;
    if (window.location.hash !== returnHash) window.location.hash = returnHash;
    route();
  }, 530);
};

window._entrySkip = function() {
  var p = document.getElementById('entry-page');
  if (p) { p.style.transition = 'opacity .35s'; p.style.opacity = '0'; }
  setTimeout(function() {
    _entryShowShell();
    try { localStorage.setItem('itcContext', 'skip'); } catch(e) {}
    window.location.hash = '#/';
    route();
  }, 370);
};

window.openContextSwitcher = function() {
  window.location.hash = '#/';
  route();
};

function _routeEntryGate() {
  var stored;
  try { stored = localStorage.getItem('itcContext'); } catch(e) { stored = 'skip'; }
  if (!activeHub && !stored) {
    _entryHideShell();
    renderEntry();
    return true;
  }
  if (!activeHub && stored && stored !== 'skip' && HUB_CONFIG[stored]) {
    activeHub = Object.assign({}, HUB_CONFIG[stored]);
    activeHub._code = stored;
    applyHubFilters(activeHub);
  }
  _entryShowShell();
  return false;
}

function updateNavContextChip() {
  var chip = document.getElementById('ctx-chip');
  if (!chip) {
    chip = document.createElement('div');
    chip.id = 'ctx-chip';
    var navbar = document.getElementById('navbar');
    var badge  = document.getElementById('badge-live');
    if (navbar && badge) navbar.insertBefore(chip, badge);
    else if (navbar) navbar.appendChild(chip);
  }
  if (activeHub) {
    chip.className = 'ctx-chip ctx-chip-on';
    chip.style.setProperty('--ctx-c', activeHub.color || '#E11D48');
    chip.innerHTML =
      '<span class="ctx-chip-lbl">' + (activeHub.icon || '') + ' ' + (activeHub.label || 'CATEGORIA') + '</span>' +
      '<span class="ctx-chip-arr">&#9660;</span>';
    chip.onclick = function() { openContextSwitcher(); };
  } else {
    chip.className = 'ctx-chip ctx-chip-off';
    chip.style.removeProperty('--ctx-c');
    chip.innerHTML = '<span class="ctx-chip-lbl">TUTTE</span><span class="ctx-chip-arr">&#9660;</span>';
    chip.onclick = function() { openContextSwitcher(); };
  }
}


// ── SPORT INTELLIGENCE ENGINE ──────────────────────────────

function siStreak(athleteId, resultsRaw) {
  // Count consecutive podiums from most recent result backward
  const sorted = resultsRaw
    .filter(r => r.atleta_id === athleteId && r.data && r.posizione)
    .sort((a, b) => b.data.localeCompare(a.data));
  let podioStreak = 0, winStreak = 0;
  for (const r of sorted) {
    if (r.posizione <= 3) { podioStreak++; if (r.posizione === 1) winStreak++; else if (winStreak > 0) break; }
    else break;
  }
  let wStreak = 0;
  for (const r of sorted) { if (r.posizione === 1) wStreak++; else break; }
  return { podioStreak, winStreak: wStreak };
}

function siMomentum(athleteId, resultsRaw, lastRaceDate) {
  const cut14 = (() => { const d = new Date(lastRaceDate||new Date()); d.setDate(d.getDate()-14); return d.toISOString().split('T')[0]; })();
  const cut28 = (() => { const d = new Date(lastRaceDate||new Date()); d.setDate(d.getDate()-28); return d.toISOString().split('T')[0]; })();
  const r14 = resultsRaw.filter(r => r.atleta_id === athleteId && r.data >= cut14);
  const r28 = resultsRaw.filter(r => r.atleta_id === athleteId && r.data >= cut28 && r.data < cut14);
  const pts14 = r14.reduce((s, r) => s + (r.punti_effettivi||0), 0);
  const pts28 = r28.reduce((s, r) => s + (r.punti_effettivi||0), 0);
  const gare14 = r14.length, podio14 = r14.filter(r=>r.posizione<=3).length, vittorie14 = r14.filter(r=>r.posizione===1).length;
  let label, trend, color;
  if (pts28 === 0 && pts14 > 0) { label = '🔥 In Grande Forma'; trend = 'up'; color = '#E11D48'; }
  else if (pts28 === 0) { label = '⏸ Dati insufficienti'; trend = 'neutral'; color = 'rgba(255,255,255,0.4)'; }
  else {
    const ratio = pts14 / pts28;
    if (ratio >= 1.8)      { label = '🔥 In Forma Straordinaria'; trend = 'up';      color = '#E11D48'; }
    else if (ratio >= 1.2) { label = '📈 In Crescita';             trend = 'up';      color = '#22c55e'; }
    else if (ratio >= 0.8) { label = '⚖ Stabile';                  trend = 'neutral'; color = 'rgba(255,255,255,0.5)'; }
    else if (ratio >= 0.5) { label = '📉 In Rallentamento';         trend = 'down';    color = '#f59e0b'; }
    else                   { label = '⚠ Momento Difficile';         trend = 'down';    color = '#ef4444'; }
  }
  return { label, trend, color, pts14, pts28, gare14, podio14, vittorie14 };
}

function siRivals(athleteId, resultsRaw, catCode) {
  // Find athletes who appear most in the same races as athleteId
  const myRaces = new Set(
    resultsRaw.filter(r => r.atleta_id === athleteId && (!catCode || getRankingFileCode(r) === catCode)).map(r => r.gara_id)
  );
  const counts = {};
  for (const r of resultsRaw) {
    if (r.atleta_id === athleteId || !myRaces.has(r.gara_id)) continue;
    if (catCode && getRankingFileCode(r) !== catCode) continue;
    const k = r.atleta_id;
    if (!counts[k]) counts[k] = { atleta_id:k, cognome:r.cognome, nome:r.nome, team:r.team, team_id:r.team_id, encounters:0, wins:0 };
    counts[k].encounters++;
    if (r.posizione === 1) counts[k].wins++;
  }
  return Object.values(counts).sort((a,b) => b.encounters-a.encounters).slice(0,3);
}

function siTeamDominance(resultsRaw, catOrder, cutStr) {
  // Which team has the most wins per category in the last period
  const teamWins = {};
  for (const r of resultsRaw) {
    if (!r.data || r.data < cutStr || r.posizione !== 1) continue;
    const code = getRankingFileCode(r);
    if (!code) continue;
    const k = `${code}|${r.team_id}`;
    if (!teamWins[k]) teamWins[k] = { code, team:r.team, team_id:r.team_id, wins:0, pts:0 };
    teamWins[k].wins++;
    teamWins[k].pts += r.punti_effettivi||0;
  }
  // Per category, find top team
  const result = {};
  for (const code of catOrder) {
    const top = Object.values(teamWins).filter(x=>x.code===code).sort((a,b)=>b.wins-a.wins)[0];
    if (top) result[code] = top;
  }
  return result;
}

function siCategoryCompetitiveness(resultsRaw, catOrder) {
  // For each category, compute standard deviation of winning margins (proxy for competitiveness)
  const gaps = {};
  for (const r of resultsRaw) {
    const code = getRankingFileCode(r);
    if (!code || !r.data) continue;
    if (r.posizione === 1 || r.posizione === 2) {
      if (!gaps[code]) gaps[code] = { gids:{} };
      if (!gaps[code].gids[r.gara_id]) gaps[code].gids[r.gara_id] = {};
      gaps[code].gids[r.gara_id][r.posizione] = r.punti_effettivi||0;
    }
  }
  const result = {};
  for (const code of catOrder) {
    if (!gaps[code]) continue;
    const diffs = Object.values(gaps[code].gids)
      .filter(g => g[1] && g[2])
      .map(g => g[1] - g[2]);
    if (diffs.length < 3) continue;
    const avg = diffs.reduce((s,v)=>s+v,0) / diffs.length;
    result[code] = { avgGap: Math.round(avg), races: diffs.length };
  }
  return result;
}


// siRivalryFinder — athletes with most direct race encounters
function siRivalryFinder(resultsRaw) {
  const pairs = {};
  const byRace = {};
  for (const r of resultsRaw) {
    if (!r.gara_id || !r.posizione || r.posizione > 8 || !r.data) continue;
    if (!byRace[r.gara_id]) byRace[r.gara_id] = [];
    byRace[r.gara_id].push(r);
  }
  for (const results of Object.values(byRace)) {
    const sorted = results.slice().sort((a,b) => a.posizione - b.posizione).slice(0, 6);
    for (let i = 0; i < sorted.length - 1; i++) {
      for (let j = i+1; j < sorted.length && j <= i+4; j++) {
        const a = sorted[i], b = sorted[j];
        if (a.atleta_id === b.atleta_id) continue;
        const key = [a.atleta_id, b.atleta_id].sort().join('|');
        if (!pairs[key]) pairs[key] = {
          aId:a.atleta_id, bId:b.atleta_id,
          aCog:a.cognome, aNom:a.nome, aTeam:a.team, aTeamId:a.team_id,
          bCog:b.cognome, bNom:b.nome, bTeam:b.team, bTeamId:b.team_id,
          code: getRankingFileCode(a)||'', encounters:0, aWins:0, bWins:0
        };
        pairs[key].encounters++;
        if (a.posizione < b.posizione) pairs[key].aWins++;
        else pairs[key].bWins++;
      }
    }
  }
  return Object.values(pairs)
    .filter(p => p.encounters >= 3)
    .sort((a,b) => {
      const aClose = Math.min(a.aWins, a.bWins) / Math.max(a.encounters,1);
      const bClose = Math.min(b.aWins, b.bWins) / Math.max(b.encounters,1);
      return (b.encounters*(1+bClose)) - (a.encounters*(1+aClose));
    })
    .slice(0, 5);
}

// siNewsroomFeed — auto-generate editorial narrative bullets from data
function siNewsroomFeed(resultsRaw, allRankings, catOrder, topScalatori, teamDom) {
  const items = [];
  const lastDate = resultsRaw.reduce((mx,r) => (r.data||'') > mx ? r.data : mx, '');
  const cut7 = (() => { const d=new Date(lastDate||new Date()); d.setDate(d.getDate()-7); return d.toISOString().split('T')[0]; })();
  // Recent winners
  const byRace = {};
  for (const r of resultsRaw.filter(r => r.data >= cut7 && r.posizione <= 3)) {
    if (!byRace[r.gara_id]) byRace[r.gara_id] = { nome:r.nome_gara, data:r.data, results:[], code:getRankingFileCode(r)||'' };
    byRace[r.gara_id].results.push(r);
  }
  for (const race of Object.values(byRace).sort((a,b) => b.data.localeCompare(a.data)).slice(0,3)) {
    const w = race.results.find(r => r.posizione === 1);
    if (w) items.push({ icon:'🥇', text:'<strong>' + esc(w.cognome) + ' ' + esc(w.nome) + '</strong> vince <em>' + esc(race.nome) + '</em> in ' + catLabel(race.code), type:'victory', atleta_id:w.atleta_id });
  }
  // Streak detections
  const checkedA = new Set();
  for (const r of resultsRaw.filter(x => x.data >= cut7 && x.posizione === 1).sort((a,b) => b.data.localeCompare(a.data)).slice(0,6)) {
    if (checkedA.has(r.atleta_id)) continue; checkedA.add(r.atleta_id);
    const { winStreak, podioStreak } = siStreak(r.atleta_id, resultsRaw);
    if (winStreak >= 2) items.push({ icon:'👑', text:'<strong>' + esc(r.cognome) + '</strong> in striscia: <strong>' + winStreak + ' vittorie consecutive</strong>', type:'streak', atleta_id:r.atleta_id });
    else if (podioStreak >= 3) items.push({ icon:'🔥', text:'<strong>' + esc(r.cognome) + '</strong> — <strong>' + podioStreak + ' podi consecutivi</strong>', type:'streak', atleta_id:r.atleta_id });
  }
  // Biggest movers
  if (topScalatori[0]) items.push({ icon:'📈', text:'<strong>' + esc(topScalatori[0].cognome) + ' ' + esc(topScalatori[0].nome) + '</strong> sale di <strong>+' + topScalatori[0].gain + ' posizioni</strong> in ' + catLabel(topScalatori[0].code), type:'mover', atleta_id:topScalatori[0].atleta_id });
  if (topScalatori[2]) items.push({ icon:'📈', text:'<strong>' + esc(topScalatori[2].cognome) + ' ' + esc(topScalatori[2].nome) + '</strong> — ora ' + topScalatori[2].newPos + '° in ' + catLabel(topScalatori[2].code), type:'mover', atleta_id:topScalatori[2].atleta_id });
  // Team dominance
  for (const [code, td] of Object.entries(teamDom).slice(0,2)) {
    items.push({ icon:'🏆', text:'<strong>' + esc(td.team) + '</strong> domina in ' + catLabel(code) + ': <strong>' + td.wins + ' vittorie</strong> nell\'ultimo mese', type:'team', team_id:td.team_id });
  }
  // Close battles
  for (let i=0; i < Math.min(allRankings.length, catOrder.length); i++) {
    const rk = allRankings[i]; if (!rk || rk.length < 2) continue;
    const gap = rk[0].punti - rk[1].punti;
    if (gap <= 15) { items.push({ icon:'⚔', text:'Solo <strong>' + gap + ' punti</strong> separano <strong>' + esc(rk[0].cognome) + '</strong> e <strong>' + esc(rk[1].cognome) + '</strong> in ' + catLabel(catOrder[i]), type:'battle' }); break; }
  }
  return items.slice(0, 8);
}

// siRaceNarrative — auto-generate story string for a race
function siRaceNarrative(raceId, resultsRaw) {
  const results = resultsRaw.filter(r => r.gara_id === raceId && r.posizione).sort((a,b) => a.posizione - b.posizione);
  if (!results.length) return null;
  const w = results[0], p2 = results[1];
  const { winStreak, podioStreak } = siStreak(w.atleta_id, resultsRaw);
  if (winStreak >= 3) return '👑 ' + esc(w.cognome) + ' è in striscia: ' + winStreak + 'ª vittoria di fila.';
  if (winStreak >= 2) return '🔥 ' + esc(w.cognome) + ' non si ferma: ' + winStreak + ' vittorie consecutive.';
  if (podioStreak >= 4) return '📈 ' + esc(w.cognome) + ' inarrestabile — ' + podioStreak + ' podi di fila.';
  if (p2 && Math.abs((w.punti_effettivi||0)-(p2.punti_effettivi||0)) <= 2) return '⚡ Duello al limite: ' + esc(w.cognome) + ' batte ' + esc(p2.cognome) + ' per pochissimi punti.';
  return '🥇 Vince ' + esc(w.cognome) + ' ' + esc(w.nome) + (p2 ? ' davanti a ' + esc(p2.cognome) : '') + '.';
}

// siClosestBattle — find the tightest ranking gap across categories
function siClosestBattle(allRankings, catOrder) {
  let best = null, bestGap = Infinity;
  for (let i = 0; i < Math.min(allRankings.length, catOrder.length); i++) {
    const rk = allRankings[i]; if (!rk || rk.length < 2) continue;
    const gap = rk[0].punti - rk[1].punti;
    if (gap < bestGap) { bestGap = gap; best = { a:rk[0], b:rk[1], code:catOrder[i], gap }; }
  }
  return best;
}

// siTeamNarrative — generate team storyline text
function siTeamNarrative(teamId, resultsRaw) {
  const teamRes = resultsRaw.filter(r => r.team_id === teamId && r.posizione && r.data);
  if (!teamRes.length) return null;
  const lastDate = teamRes.reduce((mx,r) => r.data > mx ? r.data : mx, '');
  const cut28 = (() => { const d=new Date(lastDate||new Date()); d.setDate(d.getDate()-28); return d.toISOString().split('T')[0]; })();
  const recent = teamRes.filter(r => r.data >= cut28);
  const wins28 = recent.filter(r => r.posizione === 1).length;
  const podi28 = recent.filter(r => r.posizione <= 3).length;
  const gare28 = new Set(recent.map(r => r.gara_id)).size;
  const wByAtl = {};
  for (const r of recent.filter(x => x.posizione === 1)) {
    if (!wByAtl[r.atleta_id]) wByAtl[r.atleta_id] = { cognome:r.cognome, wins:0 };
    wByAtl[r.atleta_id].wins++;
  }
  const topWinner = Object.values(wByAtl).sort((a,b) => b.wins-a.wins)[0] || null;
  const cats28 = [...new Set(recent.map(r => getRankingFileCode(r)||r.categoria).filter(Boolean))];
  if (wins28 === 0 && podi28 === 0) return gare28 + ' gare nell\'ultimo mese. In cerca di conferme.';
  if (wins28 >= 5) return '🔥 Squadra dominante — ' + wins28 + ' vittorie in ' + gare28 + ' gare (ultimi 28gg).';
  if (topWinner && topWinner.wins >= 2) return '👑 ' + esc(topWinner.cognome) + ' trascina il team: ' + topWinner.wins + ' vittorie. ' + podi28 + ' podi totali su ' + gare28 + ' gare.';
  if (podi28 > 0) return '📈 ' + podi28 + ' podi in ' + gare28 + ' gare nell\'ultimo mese' + (cats28.length > 1 ? ' in ' + cats28.length + ' categorie' : '') + '.';
  return gare28 + ' gare, ' + podi28 + ' podi nell\'ultimo mese.';
}

// siAthleteStory — generate season narrative label for athlete
function siAthleteStory(athleteId, resultsRaw) {
  const myRes = resultsRaw.filter(r => r.atleta_id === athleteId && r.posizione && r.data).sort((a,b) => b.data.localeCompare(a.data));
  if (!myRes.length) return null;
  const lastDate = myRes[0].data;
  const cut30 = (() => { const d=new Date(lastDate||new Date()); d.setDate(d.getDate()-30); return d.toISOString().split('T')[0]; })();
  const r30 = myRes.filter(r => r.data >= cut30);
  const wins30 = r30.filter(r => r.posizione === 1).length;
  const podi30 = r30.filter(r => r.posizione <= 3).length;
  const { winStreak, podioStreak } = siStreak(athleteId, resultsRaw);
  if (winStreak >= 3) return '👑 DOMINATORE — ' + winStreak + ' vittorie di fila';
  if (winStreak >= 2) return '🔥 IN STRISCIA — ' + winStreak + ' vittorie consecutive';
  if (podioStreak >= 4) return '🔥 FORMA STRAORDINARIA — ' + podioStreak + ' podi di fila';
  if (wins30 >= 3) return '📈 STAGIONE ECCEZIONALE — ' + wins30 + ' vittorie nell\'ultimo mese';
  if (podi30 >= 4) return '📈 MOLTO IN FORMA — ' + podi30 + ' podi in 30 giorni';
  if (wins30 === 0 && r30.length > 2) return '⏳ In cerca di forma — ' + podi30 + ' podi in ' + r30.length + ' gare';
  return null;
}


// ── HOME ──────────────────────────────────────────────────────
async function renderHome() {
  if (!globalData) return;
  const { calendar, resultsRaw, resultsByAtleta } = globalData;

  // ── DATA ──────────────────────────────────────────────────────
  const lastRaceDate = resultsRaw.reduce((max, r) => (r.data||'') > max ? r.data : max, '');

  // Mappa gare per hero
  const raceMap = {};
  for (const r of resultsRaw) {
    if (!raceMap[r.gara_id]) raceMap[r.gara_id] = { id:r.gara_id, nome:r.nome_gara, data:r.data, categoria:r.categoria, genere:r.genere, tipo:r.tipo, isCR:r.campionato_regionale, isCI:r.campionato_italiano, mult:r.moltiplicatore, regione:r.regione, results:[] };
    raceMap[r.gara_id].results.push(r);
  }
  const allRaces = Object.values(raceMap).sort((a,b) => (b.data||'').localeCompare(a.data||''));
  const lastDateTs = lastRaceDate ? new Date(lastRaceDate).getTime() : 0;
  const heroRaces = allRaces.filter(r => r.data && new Date(r.data).getTime() >= (lastDateTs - 7*86400*1000));

  // Forma del momento — ultimi 14 gg dall'ultima gara, per categoria
  const trendCut = new Date(lastRaceDate || new Date());
  trendCut.setDate(trendCut.getDate() - 14);
  const trendCutStr = trendCut.toISOString().split('T')[0];
  const formaPerCat = {}; // catCode → { atleta_id → stats }
  for (const r of resultsRaw) {
    if (!r.data || r.data < trendCutStr) continue;
    const code = getRankingFileCode(r);
    if (!code) continue;
    const aid = r.atleta_id;
    if (!formaPerCat[code]) formaPerCat[code] = {};
    if (!formaPerCat[code][aid]) formaPerCat[code][aid] = { atleta_id:aid, cognome:r.cognome, nome:r.nome, team:r.team, team_id:r.team_id, pts:0, gare:0, vittorie:0, podio:0 };
    formaPerCat[code][aid].pts += r.punti_effettivi || 0;
    formaPerCat[code][aid].gare++;
    if (r.posizione === 1) formaPerCat[code][aid].vittorie++;
    if (r.posizione <= 3) formaPerCat[code][aid].podio++;
  }
  // Un campione per categoria
  const catOrder14 = ['ELI_M','JUN_M','AL_M','ES2_M','ES1_M','ELI_F','JUN_F','AL_F','ES2_F','ES1_F'];
  const formaBest = catOrder14
    .filter(code => formaPerCat[code])
    .map(code => ({ code, ...Object.values(formaPerCat[code]).sort((a,b)=>b.pts-a.pts)[0] }));

  // Team hot — miglior team per categoria (per punti, ultimo mese)
  // Struttura: teamPerCat[catCode][team_id] = { team_id, team, pts, vittorie, podio, gare }
  const teamPerCat = {};
  for (const r of resultsRaw) {
    if (!r.data || r.data < trendCutStr) continue;
    const code = getRankingFileCode(r);
    if (!code) continue;
    const tid = r.team_id;
    if (!teamPerCat[code]) teamPerCat[code] = {};
    if (!teamPerCat[code][tid]) teamPerCat[code][tid] = { team_id:tid, team:r.team, pts:0, vittorie:0, podio:0, gare:0 };
    teamPerCat[code][tid].pts += r.punti_effettivi || 0;
    if (r.posizione === 1) teamPerCat[code][tid].vittorie++;
    if (r.posizione <= 3) teamPerCat[code][tid].podio++;
    teamPerCat[code][tid].gare++;
  }
  // Migliore team per categoria — per punti e per vittorie
  const catOrderM = ['ELI_M','JUN_M','AL_M','ES2_M','ES1_M'];
  const catOrderF = ['ELI_F','JUN_F','AL_F','ES2_F','ES1_F'];
  const byPtsFn  = (a,b) => b.pts-a.pts||b.vittorie-a.vittorie;
  const byWinsFn = (a,b) => b.vittorie-a.vittorie||b.pts-a.pts;
  const bestTeam = (cat, sortFn) => teamPerCat[cat] ? Object.values(teamPerCat[cat]).sort(sortFn)[0]||null : null;
  const teamHotM = {
    byPts:  catOrderM.map(c=>({code:c,best:bestTeam(c,byPtsFn)})).filter(x=>x.best),
    byWins: catOrderM.map(c=>({code:c,best:bestTeam(c,byWinsFn)})).filter(x=>x.best)
  };
  const teamHotF = {
    byPts:  catOrderF.map(c=>({code:c,best:bestTeam(c,byPtsFn)})).filter(x=>x.best),
    byWins: catOrderF.map(c=>({code:c,best:bestTeam(c,byWinsFn)})).filter(x=>x.best)
  };
  const topTeamTicker = teamHotM.byPts[0]?.best || teamHotF.byPts[0]?.best || null;

  // Upcoming
  const todayStr = new Date().toISOString().split('T')[0];
  const upcoming = calendar.filter(g => g.data >= todayStr).sort((a,b)=>a.data.localeCompare(b.data)).slice(0,7);

  // Rankings
  const catOrder = ['ELI_M','JUN_M','AL_M','ES2_M','ES1_M','ELI_F','JUN_F','AL_F','ES2_F','ES1_F'];
  const allRankings = await Promise.all(catOrder.map(c => loadRanking(c)));

  // 28-day cutoff (usato per forma recente e posizioni a rischio)
  const lastRaceCutoff = new Date(lastRaceDate || new Date());
  lastRaceCutoff.setDate(lastRaceCutoff.getDate() - 28);
  const cutoffStr = lastRaceCutoff.toISOString().split('T')[0];

  // 7-day cutoff per Chi Scala
  const weekCutStr = (() => { const d = new Date(lastRaceDate||new Date()); d.setDate(d.getDate()-7); return d.toISOString().split('T')[0]; })();

  // Forma 28gg per atleta per categoria (usata per rischio posizione)
  const form28ByCat = {};
  // Punti ultima settimana per atleta per categoria (usata per Chi Scala)
  const recentPtsByCat = {};
  for (const r of resultsRaw) {
    const code = getRankingFileCode(r);
    if (!code || !r.data) continue;
    const aid = r.atleta_id;
    if (r.data >= cutoffStr) {
      if (!form28ByCat[code]) form28ByCat[code] = {};
      form28ByCat[code][aid] = (form28ByCat[code][aid]||0) + (r.punti_effettivi||0);
    }
    if (r.data >= weekCutStr) {
      if (!recentPtsByCat[code]) recentPtsByCat[code] = {};
      recentPtsByCat[code][aid] = (recentPtsByCat[code][aid]||0) + (r.punti_effettivi||0);
    }
  }

  // Chi Scala — maggiori guadagni di posizione nell'ultima settimana
  const topScalatori = (() => {
    const result = [];
    for (let i = 0; i < catOrder.length; i++) {
      const code = catOrder[i];
      const rk = allRankings[i];
      if (!rk || rk.length < 2) continue;
      const recentInCat = recentPtsByCat[code] || {};
      // Ranking "prima della settimana" = punti correnti - punti ultima settimana
      const oldSorted = rk.map(a => ({ atleta_id:a.atleta_id, oldPts: a.punti-(recentInCat[a.atleta_id]||0) }))
                          .sort((a,b) => b.oldPts-a.oldPts);
      const oldPos = {};
      oldSorted.forEach((a,idx) => oldPos[a.atleta_id] = idx+1);
      rk.forEach((a, newIdx) => {
        const gain = (oldPos[a.atleta_id]||newIdx+1) - (newIdx+1);
        const recentPts = recentInCat[a.atleta_id]||0;
        if (gain > 0 && recentPts > 0) result.push({ atleta_id:a.atleta_id, cognome:a.cognome, nome:a.nome, team:a.team_attuale||a.team||'', team_id:a.team_id, code, gain, newPos:newIdx+1, oldPos:oldPos[a.atleta_id]||newIdx+1, recentPts });
      });
    }
    return result.sort((a,b)=>b.gain-a.gain||b.recentPts-a.recentPts).slice(0,12);
  })();

  // Posizioni a Rischio — top 5 per categoria con indicatore forma
  const rischioPerCat = catOrder.map((code, i) => {
    const rk = allRankings[i];
    if (!rk || rk.length < 2) return null;
    const form = form28ByCat[code] || {};
    const top5 = rk.slice(0,5).map((a, idx) => {
      const below = rk[idx+1] || null;
      const gapBelow = below ? a.punti - below.punti : null;
      const holderForm = form[a.atleta_id] || 0;
      const belowForm  = below ? (form[below.atleta_id]||0) : 0;
      let risk = 'stabile';
      if (gapBelow !== null && below) {
        if      (gapBelow <= 5  && belowForm > holderForm)      risk = 'critico';
        else if (gapBelow <= 15 && belowForm > holderForm)      risk = 'alto';
        else if (gapBelow <= 30 && belowForm > holderForm*1.2)  risk = 'medio';
      }
      return { pos:idx+1, atleta_id:a.atleta_id, cognome:a.cognome, nome:a.nome, punti:a.punti, gapBelow, holderForm, belowForm, risk };
    });
    return { code, top5 };
  }).filter(Boolean);

  // Smart insights ticker — Sport Intelligence narratives
  window._siResultsRaw = resultsRaw;
  const trendCut28Str = (() => { const d = new Date(lastRaceDate||new Date()); d.setDate(d.getDate()-28); return d.toISOString().split('T')[0]; })();
  const teamDom = siTeamDominance(resultsRaw, catOrder, trendCut28Str);
  const tickerItems = [];
  // Streaks
  if (formaBest[0]) {
    const { podioStreak, winStreak } = siStreak(formaBest[0].atleta_id, resultsRaw);
    if (winStreak >= 2) tickerItems.push(`👑 <strong>${formaBest[0].cognome.toUpperCase()}</strong> — ${winStreak} vittorie di fila in ${catLabel(formaBest[0].code)}`);
    else if (podioStreak >= 3) tickerItems.push(`🔥 <strong>${formaBest[0].cognome.toUpperCase()}</strong> — ${podioStreak} podi consecutivi in ${catLabel(formaBest[0].code)}`);
    else tickerItems.push(`🔥 <strong>IN FORMA:</strong> ${formaBest[0].cognome} ${formaBest[0].nome} — ${formaBest[0].pts} pt · ${catLabel(formaBest[0].code)}`);
  }
  for (const r of heroRaces.slice(0,3)) { const w = r.results?.find(x=>x.posizione===1); if (w) tickerItems.push(`🥇 <strong>${w.cognome.toUpperCase()}</strong> vince ${r.nome}`); }
  if (topScalatori[0]) tickerItems.push(`📈 <strong>SALE:</strong> ${topScalatori[0].cognome} ${topScalatori[0].nome} +${topScalatori[0].gain} posizioni in ${catLabel(topScalatori[0].code)}`);
  if (topScalatori[1]) tickerItems.push(`📈 <strong>SALE:</strong> ${topScalatori[1].cognome} ${topScalatori[1].nome} +${topScalatori[1].gain} posizioni in ${catLabel(topScalatori[1].code)}`);
  const tdTop = Object.values(teamDom)[0];
  if (tdTop) tickerItems.push(`🏆 <strong>DOMINA:</strong> ${tdTop.team} — ${tdTop.wins} vittorie in ${catLabel(tdTop.code)}`);
  if (topTeamTicker) tickerItems.push(`🏆 <strong>TEAM HOT:</strong> ${topTeamTicker.team} — ${topTeamTicker.pts} pt · ${topTeamTicker.vittorie} vitt.`);
  if (upcoming[0]) { const d = Math.round((new Date(upcoming[0].data)-new Date(todayStr))/86400000); tickerItems.push(`📅 <strong>PROSSIMA GARA${d===0?' OGGI':d===1?' DOMANI':''}:</strong> ${upcoming[0].nome}`); }
  if (formaBest.length > 1) { const f = formaBest[1]; const { podioStreak:ps } = siStreak(f.atleta_id, resultsRaw); tickerItems.push(ps>=2?`🚀 <strong>EMERGENTE:</strong> ${f.cognome} ${f.nome} — ${ps} podi in ${catLabel(f.code)}`:`📈 <strong>EMERGENTE:</strong> ${f.cognome} ${f.nome} — ${f.pts} pt · ${catLabel(f.code)}`); }

  // ── HTML SECTIONS (editorial v2) ──────────────────────────────
  const MONTHS_SHORT = ['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'];

  // ── 1. HERO ──────────────────────────────────────────────────
  // ── 1. HERO — cinematic with inline contextual selector ────────
  // ── 1. HERO ──────────────────────────────────────────────────
  const latestRace = heroRaces[0];
  const latestWinner = latestRace?.results?.find(r => r.posizione === 1);

  const recentRacesHtml = heroRaces.slice(0, 6).map((r, i) => {
    const w = r.results?.find(x => x.posizione === 1);
    const d = r.data ? new Date(r.data) : null;
    const dateStr = d ? `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}` : '';
    const rcCode = getRankingFileCode({categoria:r.categoria, genere:r.genere, tipo:r.tipo});
    return `<div class="em-race-row${i===0?' em-race-row--latest':''}" onclick="location.hash='#/risultati/${encodeURIComponent(r.id)}'">
      <span class="em-race-date">${dateStr}</span>
      <div class="em-race-info">
        <span class="em-race-name">${esc(r.nome)}</span>
        <span class="em-race-cat">${catLabel(rcCode||'')}</span>
      </div>
      ${w ? `<span class="em-race-winner">&#127945; ${esc(w.cognome)}</span>` : ''}
    </div>`;
  }).join('');

  // Context setter — animated zoom-into-hub transition
  window._heroSetContext = function(hubCode) {
    const page = document.querySelector('main.page');
    if (page) {
      page.classList.remove('page-enter');
      page.classList.add('page-exit');
    }
    setTimeout(function() {
      try { localStorage.setItem('itcContext', hubCode); } catch(e) {}
      window.location.hash = '#/hub/' + hubCode + '/';
    }, 160);
  };

  // Category banners builder — photo backgrounds with oblique clip-path split
  var _catBannerDefs = [
    { label: 'ESORDIENTI', m: 'esordienti-m', f: 'esordienti-f',
      photo: 'https://images.unsplash.com/photo-1571068316344-75bc76f77890?auto=format&fit=crop&w=1920&q=80',
      mTint: 'linear-gradient(to right,rgba(15,23,42,0.82),rgba(29,78,216,0.55))',
      fTint: 'linear-gradient(to left,rgba(15,5,25,0.82),rgba(190,24,93,0.55))' },
    { label: 'ALLIEVI',    m: 'allievi-m',    f: 'allievi-f',
      photo: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=1920&q=80',
      mTint: 'linear-gradient(to right,rgba(5,46,22,0.82),rgba(22,163,74,0.55))',
      fTint: 'linear-gradient(to left,rgba(59,7,100,0.82),rgba(147,51,234,0.55))' },
    { label: 'JUNIORES',   m: 'juniores-m',   f: 'juniores-f',
      photo: 'https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=1920&q=80',
      mTint: 'linear-gradient(to right,rgba(69,10,10,0.82),rgba(220,38,38,0.55))',
      fTint: 'linear-gradient(to left,rgba(80,7,36,0.82),rgba(219,39,119,0.55))' },
    { label: 'ELITE / U23', m: 'elite-m',     f: 'elite-f',
      photo: 'https://images.unsplash.com/photo-1541625602330-2277a4c46182?auto=format&fit=crop&w=1920&q=80',
      mTint: 'linear-gradient(to right,rgba(69,26,3,0.82),rgba(180,83,9,0.55))',
      fTint: 'linear-gradient(to left,rgba(80,7,36,0.82),rgba(225,29,72,0.55))' }
  ];
  const catBannersHtml = '<section class="cat-banners">' +
    _catBannerDefs.map(function(d) {
      var mOn = activeHub && activeHub._code === d.m ? ' cat-banner-on' : '';
      var fOn = activeHub && activeHub._code === d.f ? ' cat-banner-on' : '';
      var mBg = d.mTint + ', url(' + d.photo + ')';
      var fBg = d.fTint + ', url(' + d.photo + ')';
      return '<div class="cat-banner">' +
        '<div class="cat-banner-half cat-banner-m' + mOn + '" style="background-image:' + mBg + '" data-hub="' + d.m + '" onclick="window._heroSetContext(this.dataset.hub)">' +
          '<div class="cbi">' +
            '<div class="cbi-text">' +
              '<span class="cbi-name">' + d.label + '</span>' +
              '<span class="cbi-gender">&#9794; Maschile</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="cat-banner-half cat-banner-f' + fOn + '" style="background-image:' + fBg + '" data-hub="' + d.f + '" onclick="window._heroSetContext(this.dataset.hub)">' +
          '<div class="cbi-r">' +
            '<div class="cbi-text cbi-text-r">' +
              '<span class="cbi-name">' + d.label + '</span>' +
              '<span class="cbi-gender">&#9792; Femminile</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('') +
  '</section>';

  const heroHtml = `<section class="em-hero">
    <div class="em-hero-content em-hero-content--centered">
      <div class="em-hero-left">
        <div class="em-eyebrow">IL CICLISMO AGONISTICO ITALIANO</div>
        <h1 class="em-title">ITALIA<span class="em-title-red">CRIT</span></h1>
        <p class="em-subtitle">Classifiche &middot; Risultati &middot; Storie &middot; Statistiche</p>
        <div class="em-hero-ctas">
          <a href="#/classifica" class="em-btn-primary">Classifiche</a>
          <a href="#/risultati" class="em-btn-ghost">Risultati</a>
        </div>
      </div>
    </div>
    ${tickerItems.length ? `<div class="em-ticker-bar"><div class="em-ticker-inner"><span class="em-ticker-track">${[...tickerItems,...tickerItems].join(' &nbsp;&middot;&nbsp; ')}</span></div></div>` : ''}
  </section>`;

  // Last weekend races (all categories) for the home results section
  const homeLastWkKey = lastRaceDate ? weekendKey(lastRaceDate) : null;
  const homeWeekRaces = homeLastWkKey
    ? allRaces.filter(function(r){ return r.data && weekendKey(r.data) === homeLastWkKey; })
    : heroRaces;

  const recentResultsHtml = homeWeekRaces.length ? (() => {
    const rows = homeWeekRaces.map(function(r) {
      const w = r.results ? r.results.find(function(x){ return x.posizione === 1; }) : null;
      const d = r.data ? new Date(r.data) : null;
      const dateStr = d ? (d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()]) : '';
      const rcCode = getRankingFileCode({categoria:r.categoria, genere:r.genere, tipo:r.tipo});
      return '<div class="hub-last-row" onclick="location.hash=\'#/risultati/' + encodeURIComponent(r.id) + '\'">' +
        '<span class="hub-last-date">' + dateStr + '</span>' +
        '<span class="hub-last-cat">' + catLabel(rcCode||r.categoria||'') + '</span>' +
        '<span class="hub-last-name">' + esc(r.nome) + '</span>' +
        (w ? '<span class="hub-last-winner">&#127945; ' + esc(w.cognome) + ' ' + esc(w.nome) + '</span>'
           : '<span class="hub-last-winner" style="opacity:.35">—</span>') +
      '</div>';
    }).join('');
    return '<section class="hub-last-results hub-last-results--home">' +
      '<div class="hub-section-header hub-section-header--wide">' +
        '<div class="hub-section-label">🏁 ULTIMI RISULTATI</div>' +
        '<a href="#/risultati" class="hub-section-more">Tutti i risultati &rarr;</a>' +
      '</div>' +
      '<div class="hub-last-list">' + rows + '</div>' +
    '</section>';
  })() : '';

  // ── 2. UOMO DEL MOMENTO ───────────────────────────────────────
  const star = formaBest[0];
  const starStreak = star ? siStreak(star.atleta_id, resultsRaw) : null;
  const starMomentum = star ? siMomentum(star.atleta_id, resultsRaw, lastRaceDate) : null;
  const spotlightHtml = star ? `<section class="em-spotlight">
    <div class="em-spotlight-bg-name">${esc(star.cognome)}</div>
    <div class="em-spotlight-body">
      <div class="em-spot-meta">
        <span class="em-spot-badge">🔥 UOMO DEL MOMENTO</span>
        <span class="em-spot-cat">${catLabel(star.code)}</span>
        ${starStreak && starStreak.podioStreak >= 2 ? `<div class="si-streak-badge">${starStreak.winStreak>=2?'👑':'🔥'} ${starStreak.winStreak>=2?starStreak.winStreak+' vittorie':''+starStreak.podioStreak+' podi'} consecutivi</div>` : ''}
      </div>
      <h2 class="em-spot-name">${esc(star.cognome)}<br><span class="em-spot-firstname">${esc(star.nome)}</span></h2>
      <a href="#/team/${encodeURIComponent(star.team_id)}" class="em-spot-team">${esc(star.team||'')}</a>
      <div class="em-spot-stats">
        <div class="em-stat"><span class="em-stat-val">${star.pts}</span><span class="em-stat-lbl">punti 14gg</span></div>
        <div class="em-stat"><span class="em-stat-val">${star.vittorie}</span><span class="em-stat-lbl">vittorie</span></div>
        <div class="em-stat"><span class="em-stat-val">${star.podio}</span><span class="em-stat-lbl">podi</span></div>
        <div class="em-stat"><span class="em-stat-val">${star.gare}</span><span class="em-stat-lbl">gare</span></div>
      </div>
      <a href="#/atleta/${encodeURIComponent(star.atleta_id)}" class="em-spot-cta">Scheda atleta →</a>
    </div>
  </section>` : '';

  // ── 3. RIVALITÀ + NEWSROOM ───────────────────────────────────
  const rivalries = siRivalryFinder(resultsRaw);
  const rv = rivalries[0];
  const vsIdx = allRankings[1]?.length >= 2 ? 1 : (allRankings[0]?.length >= 2 ? 0 : -1);
  const vsRk = vsIdx >= 0 ? allRankings[vsIdx] : null;
  const vsCode = vsIdx >= 0 ? catOrder[vsIdx] : '';
  const vsA = vsRk?.[0], vsB = vsRk?.[1];

  const versusHtml = rv
    ? '<section class="em-versus">' +
        '<div class="em-versus-label">⚔ RIVALITÀ DI STAGIONE · ' + catLabel(rv.code) + ' · ' + rv.encounters + ' scontri diretti</div>' +
        '<div class="em-versus-ring">' +
          '<div class="em-vs-side em-vs-a">' +
            '<div class="em-vs-pos">' + rv.aWins + 'V</div>' +
            '<a href="#/atleta/' + encodeURIComponent(rv.aId) + '" class="em-vs-name">' + esc(rv.aCog) + '<br><small>' + esc(rv.aNom) + '</small></a>' +
            '<div class="em-vs-team">' + esc(rv.aTeam||'') + '</div>' +
          '</div>' +
          '<div class="em-vs-center"><div class="em-vs-vs">VS</div><div class="em-vs-gap">' + rv.encounters + ' sfide</div>' +
          '<div style="font-size:0.6rem;color:rgba(255,255,255,0.4);margin-top:4px">HEAD TO HEAD</div></div>' +
          '<div class="em-vs-side em-vs-b">' +
            '<div class="em-vs-pos">' + rv.bWins + 'V</div>' +
            '<a href="#/atleta/' + encodeURIComponent(rv.bId) + '" class="em-vs-name">' + esc(rv.bCog) + '<br><small>' + esc(rv.bNom) + '</small></a>' +
            '<div class="em-vs-team">' + esc(rv.bTeam||'') + '</div>' +
          '</div>' +
        '</div></section>'
    : (vsA && vsB)
      ? '<section class="em-versus">' +
          '<div class="em-versus-label">⚔ SFIDA IN CLASSIFICA · ' + catLabel(vsCode) + '</div>' +
          '<div class="em-versus-ring">' +
            '<div class="em-vs-side em-vs-a"><div class="em-vs-pos">1°</div>' +
            '<a href="#/atleta/' + encodeURIComponent(vsA.atleta_id) + '" class="em-vs-name">' + esc(vsA.cognome) + '<br><small>' + esc(vsA.nome) + '</small></a>' +
            '<div class="em-vs-pts">' + vsA.punti + ' <span>pt</span></div>' +
            '<div class="em-vs-team">' + esc(vsA.team_attuale||vsA.team||'') + '</div></div>' +
            '<div class="em-vs-center"><div class="em-vs-vs">VS</div><div class="em-vs-gap">+' + (vsA.punti - vsB.punti) + ' pt</div></div>' +
            '<div class="em-vs-side em-vs-b"><div class="em-vs-pos">2°</div>' +
            '<a href="#/atleta/' + encodeURIComponent(vsB.atleta_id) + '" class="em-vs-name">' + esc(vsB.cognome) + '<br><small>' + esc(vsB.nome) + '</small></a>' +
            '<div class="em-vs-pts">' + vsB.punti + ' <span>pt</span></div>' +
            '<div class="em-vs-team">' + esc(vsB.team_attuale||vsB.team||'') + '</div></div>' +
          '</div></section>'
      : '';

  // Newsroom feed
  const newsroomItems = siNewsroomFeed(resultsRaw, allRankings, catOrder, topScalatori, teamDom);
  const newsroomHtml = newsroomItems.length
    ? '<section class="em-newsroom">' +
        '<div class="em-newsroom-header">' +
          '<span class="em-newsroom-badge">📡 COSA STA SUCCEDENDO</span>' +
          '<a href="#/risultati" class="em-newsroom-all">Tutti i risultati →</a>' +
        '</div>' +
        '<div class="em-newsroom-feed">' +
          newsroomItems.map(function(item) {
            const clickAttr = item.atleta_id
              ? " onclick=\"location.hash='#/atleta/" + item.atleta_id + "'\""
              : item.team_id
                ? " onclick=\"location.hash='#/team/" + item.team_id + "'\""
                : '';
            return '<div class="em-news-item em-news-' + item.type + '"' + clickAttr + '>' +
              '<span class="em-news-icon">' + item.icon + '</span>' +
              '<div class="em-news-text">' + item.text + '</div>' +
              ((item.atleta_id || item.team_id) ? '<span class="em-news-arrow">→</span>' : '') +
            '</div>';
          }).join('') +
        '</div></section>'
    : '';

  // ── 4. CHI STA VOLANDO ────────────────────────────────────────
  const volandoHtml = topScalatori.length ? `<section class="em-volando">
    <div class="em-section-header">
      <span class="em-section-badge">📈 CHI STA VOLANDO</span>
      <span class="em-section-sub">Guadagni di posizione nell'ultima settimana</span>
    </div>
    <div class="em-volando-scroll">
      ${topScalatori.map(a => `<div class="em-vol-card" onclick="location.hash='#/atleta/${encodeURIComponent(a.atleta_id)}'">
        <div class="em-vol-gain">+${a.gain}</div>
        <div class="em-vol-name">${esc(a.cognome)} ${esc(a.nome)}</div>
        <div class="em-vol-team">${esc(a.team||'')}</div>
        <div class="em-vol-cat">${catLabel(a.code)}</div>
        <div class="em-vol-pts">${a.recentPts} pt</div>
      </div>`).join('')}
    </div>
  </section>` : '';

  // ── 5. PROSSIME GARE ─────────────────────────────────────────
  const upcomingHtml = upcoming.length ? `<section class="em-upcoming">
    <div class="em-section-header">
      <span class="em-section-badge">🗓 PROSSIME GARE</span>
    </div>
    <div class="em-upcoming-list">
      ${upcoming.map(g => {
        const d = new Date(g.data);
        const days = Math.round((d - new Date(todayStr)) / 86400000);
        const daysStr = days === 0 ? 'OGGI' : days === 1 ? 'DOMANI' : `fra ${days}gg`;
        return `<div class="em-ug-row" onclick="location.hash='#/calendario/${encodeURIComponent(g.id)}'">
          <span class="em-ug-days${days===0?' em-ug-oggi':''}">${daysStr}</span>
          <span class="em-ug-date">${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}</span>
          <span class="em-ug-name">${esc(g.nome)}</span>
          <span class="em-ug-cat">${esc(g.categoria||'')}</span>
        </div>`;
      }).join('')}
    </div>
  </section>` : '';

  // ── RACE PHOTO BAND ──────────────────────────────────────────
  const emBandHtml = `<div class="em-photo-band">
    <div class="em-photo-band-inner">
      <div class="em-photo-band-text">
        <small>📍 Ciclismo su Strada · Italia</small>
        In Gara Ogni Giorno
      </div>
      <a href="#/calendario" class="em-photo-band-cta">Calendario →</a>
    </div>
  </div>`;

  // ── Compact editorial — 3 insights (stesso componente em-newsroom di HUB) ──
  const flashItems = newsroomItems.slice(0, 3);
  const flashHtml = flashItems.length
    ? '<section class="em-newsroom em-newsroom--home">' +
        '<div class="em-newsroom-header">' +
          '<span class="em-newsroom-badge">⚡ IN EVIDENZA</span>' +
          '<a href="#/statistiche" class="em-newsroom-all">Statistiche &rarr;</a>' +
        '</div>' +
        '<div class="em-newsroom-feed">' +
          flashItems.map(function(item) {
            const click = item.atleta_id
              ? ' onclick="location.hash=\'#/atleta/' + item.atleta_id + '\'"'
              : item.team_id ? ' onclick="location.hash=\'#/team/' + item.team_id + '\'"' : '';
            return '<div class="em-news-item em-news-' + item.type + '"' + click + '>' +
              '<span class="em-news-icon">' + item.icon + '</span>' +
              '<div class="em-news-text">' + item.text + '</div>' +
              ((item.atleta_id || item.team_id) ? '<span class="em-news-arrow">&rarr;</span>' : '') +
            '</div>';
          }).join('') +
        '</div>' +
      '</section>'
    : '';

  // ══ ASSEMBLE ═════════════════════════════════════════════════
  setPage(
    heroHtml +
    catBannersHtml +
    recentResultsHtml +
    flashHtml +
    emBandHtml
  );
}

// ── FORMA DEL MOMENTO — pagina completa per categoria ─────────
async function renderForma(catCode) {
  if (!globalData) return;
  const { resultsRaw } = globalData;
  const label = catLabel(catCode);
  const lastRaceDate = resultsRaw.reduce((max, r) => (r.data||'') > max ? r.data : max, '');
  const trendCut = new Date(lastRaceDate || new Date());
  trendCut.setDate(trendCut.getDate() - 14);
  const trendCutStr = trendCut.toISOString().split('T')[0];

  const byAthlete = {};
  for (const r of resultsRaw) {
    if (!r.data || r.data < trendCutStr) continue;
    if (getRankingFileCode(r) !== catCode) continue;
    const aid = r.atleta_id;
    if (!byAthlete[aid]) byAthlete[aid] = { atleta_id:aid, cognome:r.cognome, nome:r.nome, team:r.team, team_id:r.team_id, pts:0, gare:0, vittorie:0, podio:0 };
    byAthlete[aid].pts += r.punti_effettivi || 0;
    byAthlete[aid].gare++;
    if (r.posizione === 1) byAthlete[aid].vittorie++;
    if (r.posizione <= 3) byAthlete[aid].podio++;
  }
  const ranked = Object.values(byAthlete).filter(a=>a.pts>0).sort((a,b)=>b.pts-a.pts);

  if (!ranked.length) {
    setPage(`<div style="margin-bottom:8px"><a href="#/" style="font-size:0.75rem;color:var(--text-muted);text-decoration:none">← Home</a></div>
    <div class="empty-state">Nessun dato per ${esc(label)} negli ultimi 14 giorni.</div>`);
    return;
  }

  const rows = ranked.map((a,i) => {
    const posColor = i===0?'var(--gold)':i===1?'var(--silver)':i===2?'var(--bronze)':'';
    return `<tr>
      <td class="r" style="font-family:var(--font-display);font-size:1.1rem;color:${posColor||'var(--text-muted)'}">${i+1}</td>
      <td><a href="#/atleta/${esc(a.atleta_id)}" class="link-primary" style="font-weight:600">${esc(a.cognome)} ${esc(a.nome)}</a></td>
      <td style="color:var(--text-muted)"><a href="#/team/${esc(a.team_id)}" style="color:var(--text-muted)">${esc(a.team)}</a></td>
      <td class="r" style="font-family:var(--font-display);font-size:1.2rem;color:var(--yellow-race)">${a.pts}</td>
      <td class="r" style="color:var(--text-secondary)">${a.gare}</td>
      <td class="r" style="color:var(--gold)">${a.vittorie||'—'}</td>
      <td class="r" style="color:var(--text-secondary)">${a.podio||'—'}</td>
    </tr>`;
  }).join('');

  setPage(`
    <div style="margin-bottom:16px">
      <a href="#/" style="font-size:0.75rem;color:var(--text-muted);text-decoration:none;font-family:var(--font-mono)">← Home</a>
    </div>
    <div class="section-header" style="margin-bottom:20px">
      <span class="section-title">FORMA DEL MOMENTO</span>
      <span class="section-line"></span>
      ${badgeCat(catCode)}
    </div>
    <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:20px;font-family:var(--font-mono)">
      Punti accumulati dal ${fmtDate(trendCutStr)} ad oggi · ${ranked.length} atleti classificati
    </div>
    <div class="results-table-wrap">
      <table class="results-table">
        <thead>
          <tr>
            <th class="r" style="width:36px">#</th>
            <th>ATLETA</th>
            <th>TEAM</th>
            <th class="r">PUNTI</th>
            <th class="r">GARE</th>
            <th class="r">VITT.</th>
            <th class="r">PODI</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `);
}

// ── CLASSIFICA ────────────────────────────────────────────────
window.navigateToRank = (cat, gender) => {
  rankGender = gender;
  rankCat = cat;
  rankFilter = '';
};

let rankGender = 'M';
let rankCat    = 'ES1_M';
let rankFilter = '';
let rankView   = 'atleti'; // 'atleti' | 'team'
let rankRegion = '';
let rankMonth  = '';

async function renderClassifica() {
  if ((rankGender === 'M' && rankCat.endsWith('_F')) ||
      (rankGender === 'F' && !rankCat.endsWith('_F'))) {
    rankCat = rankGender === 'M' ? 'ES1_M' : 'ES1_F';
  }

  const catsMale   = ['ES1_M','ES2_M','AL_M','JUN_M','ELI_M'];
  const catsFemale = ['ES1_F','ES2_F','AL_F','JUN_F','ELI_F'];
  const currentCats = rankGender === 'M' ? catsMale : catsFemale;

  const genderTabs = ['M','F'].map(g => `
    <button class="tab-btn ${rankGender===g?'active-gender':''}" id="tab-gender-${g}" onclick="setRankGender('${g}')">${g==='M'?'UOMINI':'DONNE'}</button>
  `).join('');
  const catTabs = currentCats.map(c => `
    <button class="tab-btn ${rankCat===c?'active-cat':''}" id="tab-cat-${c}" onclick="setRankCat('${c}')">${catLabel(c)}</button>
  `).join('');
  const viewTabs = `
    <div class="tab-group" role="tablist" aria-label="Vista" style="margin-left:auto">
      <button class="tab-btn ${rankView==='atleti'?'active-cat':''}" onclick="setRankView('atleti')">👤 ATLETI</button>
      <button class="tab-btn ${rankView==='team'?'active-cat':''}" onclick="setRankView('team')">🏢 TEAM</button>
    </div>`;

  const regions = [...new Set(globalData.resultsRaw.map(r => normalizeRegion(r.regione)).filter(Boolean))].sort();
  const regionOptions = regions.map(r => `<option value="${r}" ${rankRegion===r?'selected':''}>${esc(r)}</option>`).join('');
  
  const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  const monthOptions = monthNames.map((n, i) => {
    const v = String(i+1).padStart(2,'0');
    return `<option value="${v}" ${rankMonth===v?'selected':''}>${n}</option>`;
  }).join('');

  const _rkLastDate = globalData.resultsRaw.reduce((mx,r) => (r.data||'')>mx?r.data:mx, '');
  const _rk28cut = (()=>{ const d=new Date(_rkLastDate||new Date()); d.setDate(d.getDate()-28); return d.toISOString().split('T')[0]; })();
  const _rkTeamDom = siTeamDominance(globalData.resultsRaw, currentCats, _rk28cut);
  const _rkWin28 = {};
  for (const r of globalData.resultsRaw.filter(x => x.data >= _rk28cut && x.posizione === 1)) {
    const code = getRankingFileCode(r); if (!code || !currentCats.includes(code)) continue;
    if (!_rkWin28[r.atleta_id]) _rkWin28[r.atleta_id] = { atleta_id:r.atleta_id, cognome:r.cognome, nome:r.nome, code, wins:0 };
    _rkWin28[r.atleta_id].wins++;
  }
  const _rkTopWinner = Object.values(_rkWin28).sort((a,b)=>b.wins-a.wins)[0]||null;
  const _rkTopDom    = Object.values(_rkTeamDom).sort((a,b)=>b.wins-a.wins)[0]||null;
  const _rkIntelHtml = (_rkTopWinner||_rkTopDom)
    ? '<div class="rk-intel-strip">' +
        (_rkTopWinner
          ? "<div class=\"rk-intel-chip\" onclick=\"location.hash='#/atleta/" + encodeURIComponent(_rkTopWinner.atleta_id) + "'\">" +
              '<span class="rk-intel-icon">🔥</span>' +
              '<div><div class="rk-intel-label">RIDER ON FIRE</div>' +
              '<div class="rk-intel-val">' + esc(_rkTopWinner.cognome) + ' — ' + _rkTopWinner.wins + ' vittorie in 28gg</div></div></div>'
          : '') +
        (_rkTopDom
          ? "<div class=\"rk-intel-chip\" onclick=\"location.hash='#/team/" + encodeURIComponent(_rkTopDom.team_id) + "'\">" +
              '<span class="rk-intel-icon">🏆</span>' +
              '<div><div class="rk-intel-label">TEAM DOMINANTE</div>' +
              '<div class="rk-intel-val">' + esc(_rkTopDom.team) + ' — ' + _rkTopDom.wins + ' vitt · ' + catLabel(_rkTopDom.code) + '</div></div></div>'
          : '') +
      '</div>'
    : '';

  setPage(`
    <div class="pg-header">
      <div class="pg-eyebrow">🏆 CLASSIFICA UFFICIALE</div>
      <h1 class="pg-title">CLASSIFICHE</h1>
    </div>
    ${_rkIntelHtml}

    <div class="ranking-controls">
      <div class="tab-group" role="tablist" aria-label="Seleziona genere">${genderTabs}</div>
      <div class="tab-group" role="tablist" aria-label="Seleziona categoria">${catTabs}</div>
      
      <div class="calendar-controls" style="margin-top:16px; margin-bottom:16px;">
        <select class="cal-filter-select" onchange="window.setRankRegion(this.value)" aria-label="Filtra per regione">
          <option value="">Tutte le Regioni</option>
          ${regionOptions}
        </select>
        <select class="cal-filter-select" onchange="window.setRankMonth(this.value)" aria-label="Filtra per mese">
          <option value="">Tutti i Mesi</option>
          ${monthOptions}
        </select>
        <div class="ranking-filter-bar" style="margin:0; flex-grow:1">
          <input type="search" id="ranking-search"
            placeholder="${rankView==='atleti'?'Filtra nome…':'Filtra team…'}"
            value="${esc(rankFilter)}"
            oninput="setRankFilter(this.value)"
            aria-label="Filtra classifica" />
        </div>
      </div>

      <div class="ranking-filter-bar" style="border-top:1px solid var(--border-subtle); padding-top:12px">
        <span class="ranking-count" id="rank-count-label">Caricamento...</span>
        ${viewTabs}
      </div>
    </div>
    <div style="padding: 0 0 16px">
      <button class="btn-share" onclick="window.shareClassifica()" id="btn-share-class">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Condividi Classifica
      </button>
    </div>
    <div class="ranking-table-wrap" id="rank-table-container"></div>
  `);

  renderParallelRankings();

  await updateRankTable();
}

async function updateRankTable() {
  const container = document.getElementById('rank-table-container');
  const countSpan = document.getElementById('rank-count-label');
  if (!container || !countSpan) return;

  let tableHtml = '';
  let countLabel = '';

  // Se i filtri regione/mese sono attivi, ricalcoliamo dinamicamente dai risultati raw
  const isFiltered = rankRegion || rankMonth;
  
  if (rankView === 'atleti') {
    let ranking = [];
    if (!isFiltered) {
      ranking = await loadRanking(rankCat);
    } else {
      // Calcolo dinamico
      const { resultsRaw } = globalData;
      const agg = {};
      // Precompute calendar mapping to resolve regions missing in resultsRaw
      const calMap = {};
      globalData.calendar.forEach(g => calMap[g.id] = g);

      resultsRaw.forEach(r => {
        if (r.genere !== rankGender) return;
        // Check categoria
        const rCat = getRankingFileCode(r); 
        if (rCat !== rankCat) return;

        const calEntry = calMap[r.gara_id];
        const resolvedRegion = normalizeRegion(r.regione || (calEntry ? calEntry.regione : ''));

        if (rankRegion && resolvedRegion !== rankRegion) return;
        if (rankMonth && r.data && r.data.split('-')[1] !== rankMonth) return;

        if (!agg[r.atleta_id]) {
          agg[r.atleta_id] = { 
            atleta_id: r.atleta_id, cognome: r.cognome, nome: r.nome, 
            team_id: r.team_id, team_nome: r.team, punti: 0, gare: 0, 
            p1:0, p2:0, p3:0, pout:0 
          };
        }
        agg[r.atleta_id].punti += (r.punti_effettivi || 0);
        agg[r.atleta_id].gare++;
        if (r.posizione === 1) agg[r.atleta_id].p1++;
        else if (r.posizione === 2) agg[r.atleta_id].p2++;
        else if (r.posizione === 3) agg[r.atleta_id].p3++;
        else agg[r.atleta_id].pout++;
      });
      ranking = Object.values(agg).sort((a,b) => b.punti - a.punti);
      ranking.forEach((r, i) => r.pos = i+1);
    }

    // Ricalcola trend dinamicamente solo se rank_dopo_gara è disponibile nei risultati
    const { resultsByAtleta } = globalData;
    ranking.forEach(entry => {
      const res = resultsByAtleta[entry.atleta_id] || [];
      const r0 = res[0], r1 = res[1];
      const rk0 = r0?.rank_dopo_gara, rk1 = r1?.rank_dopo_gara;
      if (rk0 != null && rk1 != null) {
        // entrambi disponibili: calcola differenza tra le ultime due gare
        entry.trend = rk1 - rk0;
      } else if (rk0 != null && !r1) {
        // solo una gara: prima apparizione
        entry.trend = null;
      }
      // altrimenti lascia invariato il trend del JSON
    });

    const filtered = ranking.filter(r => {
      if (!rankFilter) return true;
      const q = rankFilter.toLowerCase();
      return (r.cognome||'').toLowerCase().includes(q) ||
             (r.nome||'').toLowerCase().includes(q) ||
             (r.team_nome||'').toLowerCase().includes(q);
    });
    countLabel = `${filtered.length} atleti`;

    const rows = filtered.map((r, i) => {
      const pClass = posClass(r.pos);
      return `<tr class="ranking-row" style="animation-delay:${Math.min(i,20)*30}ms">
        <td><span class="rank-num ${pClass}">${r.pos}</span></td>
        <td style="text-align:center;width:40px">${renderTrend(r)}</td>
        <td>
          <span class="rank-name"><a href="#/atleta/${esc(r.atleta_id)}">${esc(r.cognome)} ${esc(r.nome)}</a></span>
          <div class="td-team-mobile"><a href="#/team/${esc(r.team_id)}" style="color:var(--text-secondary)">${esc(r.team_nome)}</a></div>
        </td>
        <td class="hide-mobile"><a href="#/team/${esc(r.team_id)}" style="color:var(--text-secondary);font-size:.85rem">${esc(r.team_nome)}</a></td>
        <td class="r"><span class="rank-pts">${r.punti}</span></td>
        <td class="r hide-mobile" style="color:var(--text-secondary);font-family:var(--font-mono);font-size:.85rem">${r.gare||0}</td>
        <td class="hide-mobile">
          <div class="td-p-wrap">
            <span class="td-p p1" title="Vittorie">${r.p1||0}</span>
            <span class="td-p p2" title="Secondi Posti">${r.p2||0}</span>
            <span class="td-p p3" title="Terzi Posti">${r.p3||0}</span>
            <span class="td-p pout" title="Piazzamenti 4-10">${r.pout||0}</span>
          </div>
        </td>
      </tr>`;
    }).join('');

    tableHtml = `
      <table class="ranking-table">
        <thead><tr>
          <th style="width:50px">POS</th>
          <th style="width:40px" title="Trend (Progressione in classifica)">↕</th>
          <th>ATLETA</th>
          <th class="hide-mobile">TEAM</th>
          <th class="r">PUNTI</th>
          <th class="r hide-mobile">GARE</th>
          <th class="hide-mobile">PODI / TOP10</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="empty-state">Nessun dato</td></tr>'}</tbody>
      </table>`;

  } else {
    // ── TEAM RANKING ───────────────────────────────────────────
    let teamRanking = [];
    if (!isFiltered) {
      teamRanking = await loadTeamRanking(rankCat);
    } else {
      // Calcolo dinamico team
      const { resultsRaw } = globalData;
      const agg = {};
      const calMap = {};
      globalData.calendar.forEach(g => calMap[g.id] = g);

      resultsRaw.forEach(r => {
        if (r.genere !== rankGender) return;
        const rCat = getRankingFileCode(r); 
        if (rCat !== rankCat) return;

        const calEntry = calMap[r.gara_id];
        const resolvedRegion = normalizeRegion(r.regione || (calEntry ? calEntry.regione : ''));

        if (rankRegion && resolvedRegion !== rankRegion) return;
        if (rankMonth && r.data && r.data.split('-')[1] !== rankMonth) return;

        if (!agg[r.team_id]) {
          agg[r.team_id] = { team_id: r.team_id, team_nome: r.team, punti: 0, p1:0, p2:0, p3:0, pout:0, atleti: new Set() };
        }
        agg[r.team_id].punti += (r.punti_effettivi || 0);
        agg[r.team_id].atleti.add(r.atleta_id);
        if (r.posizione === 1) agg[r.team_id].p1++;
        else if (r.posizione === 2) agg[r.team_id].p2++;
        else if (r.posizione === 3) agg[r.team_id].p3++;
        else agg[r.team_id].pout++;
      });
      teamRanking = Object.values(agg).sort((a,b) => b.punti - a.punti);
      teamRanking.forEach((t, i) => { t.pos = i+1; t.n_atleti = t.atleti.size; });
    }

    const filtered = teamRanking.filter(t => {
      if (!rankFilter) return true;
      return (t.team_nome||'').toLowerCase().includes(rankFilter.toLowerCase());
    });
    countLabel = `${filtered.length} team`;

    const rows = filtered.map((t, i) => {
      const pClass = posClass(t.pos);
      return `<tr class="ranking-row" style="animation-delay:${Math.min(i,20)*30}ms">
        <td><span class="rank-num ${pClass}">${t.pos}</span></td>
        <td><span class="rank-name"><a href="#/team/${esc(t.team_id)}">${esc(t.team_nome)}</a></span></td>
        <td class="r"><span class="rank-pts">${t.punti}</span></td>
        <td class="hide-mobile">
          <div class="td-p-wrap">
            <span class="td-p p1">${t.p1||0}</span>
            <span class="td-p p2">${t.p2||0}</span>
            <span class="td-p p3">${t.p3||0}</span>
            <span class="td-p pout">${t.pout||0}</span>
          </div>
        </td>
        <td class="r hide-mobile" style="font-family:var(--font-mono);font-size:.85rem;color:var(--text-muted)">${t.n_atleti||0}</td>
      </tr>`;
    }).join('');

    tableHtml = `
      <table class="ranking-table">
        <thead><tr>
          <th style="width:50px">POS</th>
          <th>TEAM</th>
          <th class="r">PUNTI</th>
          <th class="hide-mobile">PODI / TOP10</th>
          <th class="r hide-mobile">ATLETI</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="empty-state">Nessun dato</td></tr>'}</tbody>
      </table>`;
  }

  container.innerHTML = tableHtml;
  countSpan.textContent = countLabel;
}

// ── ADMIN DASHBOARD ──────────────────────────────────────────
async function renderAdmin() {
  if (!globalData) return;
  const user = authUser();
  if (!user || user.role !== 'admin') {
    setPage(`<div style="text-align:center;padding:80px 20px">
      <h2 style="font-family:var(--font-display);color:var(--red-hot)">Accesso negato</h2>
      <p style="color:var(--text-muted);margin:16px 0">Questa sezione è riservata agli amministratori.</p>
      <a href="#/login" class="btn-action" style="background:var(--accent);color:white;text-decoration:none;padding:10px 24px;border-radius:6px">Vai al Login</a>
    </div>`);
    return;
  }

  // Carichiamo gli override salvati
  let overrides, resultsRaw;
  try {
    overrides = await loadJson('data/user_overrides.json') || {};
    resultsRaw = globalData.resultsRaw;
  } catch(e) {
    setPage(`<div style="padding:40px;color:var(--red-hot)">Errore caricamento admin: ${esc(e.message)}</div>`);
    return;
  }

  // Raggruppa per GARA EVENTO (Nome + Data), ignorando la categoria
  const raceMap = {};
  resultsRaw.forEach(r => {
    const eventId = slug(r.nome_gara) + "_" + r.data;
    if (!raceMap[eventId]) {
      const ov = overrides[eventId] || {};
      raceMap[eventId] = { 
        id: eventId, // ID EVENTO (Usato per l'override)
        nome: r.nome_gara, 
        data: r.data, 
        mult: ov.mult || r.moltiplicatore, 
        tipo: ov.tipo || r.tipo,
        cats: new Set(),
        pos_base: r.posizione
      };
    }
    raceMap[eventId].cats.add(r.categoria);
  });
  
  const races = Object.values(raceMap).sort((a,b) => (b.data||'').localeCompare(a.data||''));

  setPage(`
    <h1 style="font-family:var(--font-display);font-size:var(--size-h1);margin-bottom:8px">ADMIN DASHBOARD</h1>

    <div style="margin-bottom:32px">
      <button class="btn-action" onclick="triggerSync()" id="btn-sync" style="background:var(--accent); color:white; border:none">
        🔄 SINCRONIZZA & RICALCOLA
      </button>
    </div>

    <div style="margin-top:0">
      <h2 style="font-family:var(--font-display);font-size:1.2rem;margin-bottom:16px;border-bottom:2px solid var(--accent);padding-bottom:8px">
        📷 FOTO IN ATTESA DI APPROVAZIONE
      </h2>
      <div id="admin-photos-pending">
        <div style="color:var(--text-muted);padding:20px 0">Caricamento...</div>
      </div>
    </div>

    <div style="margin-top:32px">
      <h2 style="font-family:var(--font-display);font-size:1.2rem;margin-bottom:16px;border-bottom:2px solid var(--accent);padding-bottom:8px">
        🎬 VIDEO IN ATTESA DI APPROVAZIONE
      </h2>
      <div id="admin-videos-pending">
        <div style="color:var(--text-muted);padding:20px 0">Caricamento...</div>
      </div>
    </div>

  `);

  loadPendingRacePhotos();
  loadAdminPendingVideos();
}

async function loadPendingRacePhotos() {
  const container = document.getElementById('admin-photos-pending');
  if (!container) return;
  try {
    const token = authToken();
    const resp = await fetch(`${API_BASE}/admin/race-photos/pending`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} — riavvia il server`);
    const data = await resp.json();
    const photos = data.photos || [];
    if (!photos.length) {
      container.innerHTML = `<div style="color:var(--text-muted);padding:20px 0">Nessuna foto in attesa.</div>`;
      return;
    }
    container.innerHTML = `<div class="admin-photo-grid">${photos.map(p => `
      <div class="admin-photo-card" id="admin-photo-${p.id}">
        <img src="${PHOTOS_BASE}/photos/${esc(p.filename)}" alt="${esc(p.caption||'foto')}" onclick="openPhotoLightbox('${PHOTOS_BASE}/photos/${esc(p.filename)}')" style="cursor:zoom-in" />
        <div class="admin-photo-card-body">
          <div class="admin-photo-meta">
            <a href="#/gara/${encodeURIComponent(p.gara_id)}" style="color:var(--accent);font-weight:600;font-size:0.8rem">${esc(p.gara_id)}</a>
            <span style="color:var(--text-muted);font-size:0.75rem">${esc(p.display_name||p.email)} &mdash; ${(p.created_at||'').slice(0,10)}</span>
            ${p.photographer ? `<span style="font-size:0.8rem">📷 ${esc(p.photographer)}</span>` : ''}
            ${p.caption ? `<span style="font-size:0.8rem;font-style:italic">${esc(p.caption)}</span>` : ''}
          </div>
          <div class="admin-photo-actions">
            <button class="btn-approve" onclick="adminPhotoAction(${p.id},'approve')">✓ Approva</button>
            <button class="btn-reject"  onclick="adminPhotoAction(${p.id},'reject')">✗ Rifiuta</button>
          </div>
        </div>
      </div>
    `).join('')}</div>`;
  } catch(e) {
    container.innerHTML = `<div style="color:var(--red-hot);padding:20px 0">Errore caricamento foto: ${esc(e.message)}</div>`;
  }
}

async function loadAdminPendingVideos() {
  const container = document.getElementById('admin-videos-pending');
  if (!container) return;
  try {
    const data = await apiCall('/admin/videos/pending');
    const videos = data.videos || [];
    if (!videos.length) {
      container.innerHTML = `<div style="color:var(--text-muted);padding:20px 0">Nessun video in attesa.</div>`;
      return;
    }
    container.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">${videos.map(v => {
      const vidId = v.type === 'youtube' ? (v.url.match(/[?&]v=([^&]+)/) || [])[1] || '' : '';
      const thumb = vidId ? `https://img.youtube.com/vi/${vidId}/mqdefault.jpg` : '';
      return `
      <div id="apv-${v.id}" style="display:flex;gap:12px;align-items:flex-start;background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--r-md);padding:12px">
        ${thumb ? `<img src="${thumb}" style="width:120px;border-radius:var(--r-sm);flex-shrink:0;object-fit:cover" />` : `<div style="width:120px;height:68px;background:var(--bg-elevated);border-radius:var(--r-sm);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:2rem">📁</div>`}
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:0.875rem;margin-bottom:4px">${esc(v.title)}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:4px">
            <a href="#/gara/${esc(v.gara_id)}" style="color:var(--accent)">${esc(v.gara_id)}</a>
            &mdash; ${esc(v.submitted_by)} &mdash; ${v.submitted_at.slice(0,10)}
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:8px">
            ${v.type === 'youtube' ? `🔗 <a href="${esc(v.url)}" target="_blank" rel="noopener" style="color:var(--accent)">${esc(v.url)}</a>` : `📁 File caricato`}
          </div>
          <div style="display:flex;gap:8px">
            <button onclick="window.adminVideoAction('${esc(v.id)}','approve')" class="btn-approve">✓ Approva</button>
            <button onclick="window.adminVideoAction('${esc(v.id)}','reject')"  class="btn-reject">✗ Rifiuta</button>
          </div>
        </div>
      </div>`;
    }).join('')}</div>`;
  } catch(e) {
    container.innerHTML = `<div style="color:var(--red-hot);padding:20px 0">Errore: ${esc(e.message)}</div>`;
  }
}

window.adminVideoAction = async (id, action) => {
  try {
    await apiCall(`/admin/videos/pending/${id}/${action}`, { method: 'POST' });
    document.getElementById('apv-' + id)?.remove();
    const container = document.getElementById('admin-videos-pending');
    if (container && !container.querySelector('[id^="apv-"]')) {
      container.innerHTML = `<div style="color:var(--text-muted);padding:20px 0">Nessun video in attesa.</div>`;
    }
  } catch(e) { alert('Errore: ' + e.message); }
};

async function loadApprovedRacePhotos() {
  const container = document.getElementById('admin-photos-approved');
  if (!container) return;
  try {
    const token = authToken();
    const data = await fetch(`${API_BASE}/race-photos`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    const photos = data.photos || [];
    if (!photos.length) {
      container.innerHTML = `<div style="color:var(--text-muted);padding:20px 0">Nessuna foto approvata.</div>`;
      return;
    }
    container.innerHTML = `<div class="admin-photo-grid">${photos.map(p => `
      <div class="admin-photo-card" id="admin-approved-${p.id}">
        <img src="${PHOTOS_BASE}/photos/${esc(p.filename)}" alt="${esc(p.caption||'foto')}" onclick="window.adminOpenLightbox('${PHOTOS_BASE}/photos/${esc(p.filename)}')" style="cursor:zoom-in" />
        <div class="admin-photo-card-body">
          <div class="admin-photo-meta">
            <a href="#/gara/${encodeURIComponent(p.gara_id)}" style="color:var(--accent);font-weight:600;font-size:0.8rem">${esc(p.gara_id)}</a>
            <span style="color:var(--text-muted);font-size:0.75rem">${esc(p.display_name||'')} &mdash; ${(p.created_at||'').slice(0,10)}</span>
            ${p.photographer ? `<span style="font-size:0.8rem">📷 ${esc(p.photographer)}</span>` : ''}
            ${p.caption ? `<span style="font-size:0.8rem;font-style:italic">${esc(p.caption)}</span>` : ''}
          </div>
          <div class="admin-photo-actions">
            <button class="btn-approve" onclick="window.adminPanelEditPhoto(${p.id},'${esc(p.caption||'')}','${esc(p.photographer||'')}')">✏️ Modifica</button>
            <button class="btn-reject"  onclick="window.adminPanelDeletePhoto(${p.id})">🗑 Elimina</button>
          </div>
        </div>
      </div>
    `).join('')}</div>`;
  } catch(e) {
    container.innerHTML = `<div style="color:var(--red-hot);padding:20px 0">Errore: ${esc(e.message)}</div>`;
  }
}

window.adminPanelEditPhoto = (id, caption, photographer) => {
  const inpStyle = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:var(--r-sm);font-size:0.875rem;background:var(--bg-primary);color:var(--text-primary);margin-bottom:10px';
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `
    <div style="background:var(--bg-card);border-radius:var(--r-lg);padding:24px;width:100%;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,.25)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <strong>Modifica foto</strong>
        <button onclick="this.closest('[style*=fixed]').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text-muted)">✕</button>
      </div>
      <input id="ap-caption" type="text" placeholder="Didascalia" value="${esc(caption)}" style="${inpStyle}"/>
      <input id="ap-photographer" type="text" placeholder="Credit fotografo" value="${esc(photographer)}" style="${inpStyle}"/>
      <div id="ap-err" style="color:#EF4444;font-size:0.8rem;margin-bottom:8px;display:none"></div>
      <button onclick="window._adminSavePhoto(${id})" style="width:100%;padding:9px;background:var(--accent);color:#fff;border:none;border-radius:var(--r-sm);font-weight:600;cursor:pointer">Salva</button>
    </div>`;
  document.body.appendChild(overlay);
};

window._adminSavePhoto = async (id) => {
  const caption      = document.getElementById('ap-caption')?.value || '';
  const photographer = document.getElementById('ap-photographer')?.value || '';
  const errEl = document.getElementById('ap-err');
  try {
    const res = await fetch(`${API_BASE}/admin/race-photos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken()}` },
      body: JSON.stringify({ caption, photographer }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Errore');
    document.querySelector('[style*="position:fixed"][style*="9999"]')?.remove();
    loadApprovedRacePhotos();
  } catch(e) {
    if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; }
  }
};

window.adminPanelDeletePhoto = async (id) => {
  if (!confirm('Eliminare questa foto? L\'operazione non è reversibile.')) return;
  try {
    const res = await fetch(`${API_BASE}/admin/race-photos/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken()}` },
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Errore');
    const card = document.getElementById(`admin-approved-${id}`);
    if (card) { card.style.transition = 'opacity .3s'; card.style.opacity = '0'; setTimeout(() => card.remove(), 320); }
    _risPhotosMap = null; // invalida cache risultati
  } catch(e) { alert('Errore: ' + e.message); }
};

window.adminOpenLightbox = (src) => {
  const lb = document.createElement('div');
  lb.id = 'photo-lightbox';
  lb.onclick = () => lb.remove();
  lb.innerHTML = `<img src="${src}" alt="Foto gara"/>`;
  document.body.appendChild(lb);
};

window.adminPhotoAction = async function(id, action) {
  const token = authToken();
  try {
    await fetch(`${API_BASE}/admin/race-photos/${id}/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const card = document.getElementById(`admin-photo-${id}`);
    if (card) {
      card.style.transition = 'opacity 0.3s';
      card.style.opacity = '0';
      setTimeout(() => card.remove(), 320);
    }
    const grid = document.querySelector('.admin-photo-grid');
    if (grid && !grid.querySelector('.admin-photo-card:not([style*="opacity: 0"])')) {
      setTimeout(() => {
        const c = document.getElementById('admin-photos-pending');
        if (c) c.innerHTML = `<div style="color:var(--text-muted);padding:20px 0">Nessuna foto in attesa.</div>`;
      }, 400);
    }
  } catch(e) {
    alert('Errore: ' + e.message);
  }
};

function renderAdminRows(races) {
  return races.map(r => {
    const basePts = (r.pos_base === 1) ? 15 : (r.pos_base <= 10 ? (BASEPTS[r.pos_base] || 0) : 0);
    const simulatedPts = basePts * r.mult;
    const catList = Array.from(r.cats).map(c => badgeCat(c)).join(' ');
    
    return `
    <tr>
      <td style="font-family:var(--font-mono);font-size:0.8rem">${r.data}</td>
      <td>
        <div style="font-weight:700;font-size:0.9rem">${esc(r.nome)}</div>
        <div style="font-size:0.7rem;color:var(--text-muted)">${r.id}</div>
      </td>
      <td><div style="display:flex; flex-wrap:wrap; gap:4px">${catList}</div></td>
      <td class="r">
        <span style="font-weight:800; color:var(--red-hot); font-size:1.1rem">${simulatedPts}</span>
        <div style="font-size:0.6rem; color:var(--text-muted)">(${basePts} x ${r.mult})</div>
      </td>
      <td class="r">
        <div class="tab-group" style="justify-content:flex-end">
          <button class="tab-btn ${r.mult===1?'active-cat':''}" onclick="setOverride('${r.id}', 1, '${r.tipo}')">x1</button>
          <button class="tab-btn ${r.mult===2?'active-cat':''}" onclick="setOverride('${r.id}', 2, '${r.tipo}')">x2</button>
          <button class="tab-btn ${r.mult===3?'active-cat':''}" onclick="setOverride('${r.id}', 3, '${r.tipo}')">x3</button>
        </div>
      </td>
      <td>
        <select class="cal-filter-select" style="padding:4px 8px;font-size:0.8rem" onchange="setOverride('${r.id}', null, this.value)">
          <option value="regionale" ${r.tipo==='regionale'?'selected':''}>Regionale</option>
          <option value="nazionale" ${r.tipo==='nazionale'?'selected':''}>Nazionale</option>
          <option value="internazionale" ${r.tipo==='internazionale'?'selected':''}>Internazionale</option>
          <option value="campionato_regionale" ${r.tipo==='campionato_regionale'?'selected':''}>Campionato Regionale (x2)</option>
          <option value="campionato_italiano" ${r.tipo==='campionato_italiano'?'selected':''}>Campionato Italiano (x3)</option>
        </select>
      </td>
    </tr>
  `}).join('');
}

window.filterAdminRaces = (val) => {
  const q = val.toLowerCase();
  const { resultsRaw } = globalData;
  const raceMap = {};
  
  resultsRaw.forEach(r => {
    const eventId = slug(r.nome_gara) + "_" + r.data;
    if (r.nome_gara.toLowerCase().includes(q) && !raceMap[eventId]) {
      raceMap[eventId] = { 
        id: eventId, 
        nome: r.nome_gara, 
        data: r.data, 
        mult: r.moltiplicatore, 
        tipo: r.tipo, 
        cats: new Set(),
        pos_base: r.posizione
      };
    }
    if (raceMap[eventId]) raceMap[eventId].cats.add(r.categoria);
  });
  
  const filtered = Object.values(raceMap).sort((a,b) => (b.data||'').localeCompare(a.data||'')).slice(0, 50);
  const container = document.getElementById('admin-table-body');
  if (container) container.innerHTML = renderAdminRows(filtered);
};

window.setOverride = async (id, mult, tipo) => {
  const btnSync = document.getElementById('btn-sync');
  const originalText = btnSync.textContent;
  btnSync.textContent = "💾 SALVATAGGIO...";
  
  // Se il moltiplicatore è null, lo determiniamo in base al tipo
  if (mult === null) {
    if (tipo === 'campionato_regionale') mult = 2;
    else if (tipo === 'campionato_italiano') mult = 3;
    else {
      // Cerca il record attuale nei dati globali
      const race = globalData.resultsRaw.find(rx => rx.gara_id === id);
      mult = race ? race.moltiplicatore : 1;
    }
  }

  console.log("Saving override:", id, mult, tipo);
  try {
    const response = await fetch('/api/save_override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, mult, tipo })
    });
    
    if (response.ok) {
      // Aggiorna UI locale per TUTTI i record che appartengono a questo evento
      globalData.resultsRaw.forEach(row => {
        const rowEventId = slug(row.nome_gara) + "_" + row.data;
        if (rowEventId === id) {
          row.moltiplicatore = mult;
          row.tipo = tipo;
        }
      });
      // Forza re-render della riga
      const q = document.getElementById('admin-search')?.value || '';
      window.filterAdminRaces(q);
      btnSync.textContent = "✅ SALVATO!";
      setTimeout(() => { btnSync.textContent = originalText; }, 2000);
    }
  } catch (e) {
    alert("Errore nel salvataggio: " + e.message);
    btnSync.textContent = originalText;
  }
};

window.triggerSync = async () => {
  const btn = document.getElementById('btn-sync');
  btn.disabled = true;
  btn.textContent = "⌛ ELABORAZIONE IN CORSO...";
  try {
    const r = await fetch('/api/trigger_scraper', { method: 'POST' });
    if (r.ok) {
      alert("Sincronizzazione avviata! I dati si aggiorneranno tra circa 1-2 minuti.");
    }
  } catch (e) {
    alert("Errore: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 SINCRONIZZA & RICALCOLA";
  }
};

window.setRankGender = (g) => { rankGender = g; rankFilter = ''; rankRegion = ''; rankMonth = ''; renderClassifica(); };
window.setRankCat    = (c) => { rankCat = c; rankFilter = ''; rankRegion = ''; rankMonth = ''; renderClassifica(); };
window.setRankFilter = (v) => { rankFilter = v; updateRankTable(); };
window.setRankView   = (v) => { rankView = v; rankFilter = ''; rankRegion = ''; rankMonth = ''; renderClassifica(); };
window.setRankRegion = (v) => { rankRegion = v; updateRankTable(); };
window.setRankMonth  = (v) => { rankMonth = v; updateRankTable(); };

// ── PARALLEL RANKINGS ────────────────────────────────────────
async function renderParallelRankings() {
  const maleBox = document.getElementById('parallel-male-ranking');
  const femaleBox = document.getElementById('parallel-female-ranking');
  if (!maleBox || !femaleBox) return;

  const { resultsRaw } = globalData;
  const now = new Date();
  const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
  
  const maleCats = ['ELI_M', 'JUN_M', 'AL_M', 'ES2_M', 'ES1_M'];
  const femaleCats = ['ELI_F', 'JUN_F', 'AL_F', 'ES2_F', 'ES1_F'];

  const getLeaders = (cats) => {
    const leaders = {};
    cats.forEach(c => leaders[c] = { athlete: null, pts: -1 });

    resultsRaw.forEach(r => {
      if (!r.data) return;
      const rMonth = r.data.split('-')[1];
      if (rMonth !== currentMonth) return;

      const catCode = getRankingFileCode(r);
      if (leaders[catCode]) {
        if (!leaders[catCode].agg) leaders[catCode].agg = {};
        const aid = r.atleta_id;
        if (!leaders[catCode].agg[aid]) leaders[catCode].agg[aid] = { name: `${r.cognome} ${r.nome}`, pts: 0 };
        leaders[catCode].agg[aid].pts += (r.punti_effettivi || 0);
      }
    });

    // In ogni categoria, trova chi ha più punti
    return cats.map(c => {
      const agg = leaders[c].agg || {};
      const sorted = Object.values(agg).sort((a,b) => b.pts - a.pts);
      return { 
        cat: c, 
        athlete: sorted[0] || null 
      };
    });
  };

  const maleLeaders = getLeaders(maleCats);
  const femaleLeaders = getLeaders(femaleCats);

  const renderList = (list) => {
    return `
      <div style="display:flex; flex-direction:column; gap:8px">
        ${list.map(item => `
          <div style="display:flex; align-items:center; gap:10px; padding:8px 10px; background:var(--bg-secondary); border:1px solid var(--border-subtle); border-radius:4px; box-shadow: 0 2px 4px rgba(0,0,0,0.05)">
            <div style="width:110px">${badgeCat(item.cat)}</div>
            <div style="flex-grow:1; font-size:0.9rem; font-family:var(--font-heading); font-weight:600; text-transform:uppercase; color:var(--text-primary)">
              ${item.athlete ? `<a href="#/atleta/${esc(resultsRaw.find(r => `${r.cognome} ${r.nome}` === item.athlete.name)?.atleta_id)}">${esc(item.athlete.name)}</a>` : '<span style="color:var(--text-muted)">—</span>'}
            </div>
            <div class="rank-pts" style="font-size:1.1rem; min-width:35px; text-align:right">
              ${item.athlete ? item.athlete.pts : '0'}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  };

  maleBox.innerHTML = renderList(maleLeaders);
  femaleBox.innerHTML = renderList(femaleLeaders);
}

// ── ATLETA ────────────────────────────────────────────────────
async function renderAtleta(atleta_id) {
  if (!globalData) return;
  const { athletes, calendar } = globalData;

  const a = athletes[atleta_id];
  if (!a) return renderNotFound();

  // Lookup moltiplicatori dal calendario
  const calMap = {};
  for (const g of calendar) calMap[g.id] = g;

  const risultati = (a.risultati || []).sort((x,y) => (y.data||'').localeCompare(x.data||''));

  // Stats
  const p1 = risultati.filter(r => r.posizione === 1).length;
  const p2 = risultati.filter(r => r.posizione === 2).length;
  const p3 = risultati.filter(r => r.posizione === 3).length;
  const pout = risultati.filter(r => r.posizione >= 4 && r.posizione <= 10).length;
  const top10 = risultati.length;
  const media = top10 ? Math.round(a.punti_totali / top10) : 0;

  // Sparkline
  const sparkPoints = risultati.slice(0,20).reverse().map(r => r.punti_effettivi || 0);

  // Recupero ranking asincrono per evitare crash
  const rCode = getRankingFileCode(a.categoria);
  const [currentRanking, atletaOv] = await Promise.all([
    rCode ? loadRanking(rCode) : Promise.resolve([]),
    getEntityOverrides('atleta', atleta_id),
  ]);
  const aRankObj = currentRanking.find(x => x.atleta_id === a.id);
  const globalPos = aRankObj ? aRankObj.pos : '-';

  const initials = ((a.cognome||'?')[0] + (a.nome||'?')[0]).toUpperCase();
  const photoHtml = photoAreaHtml('atleta', atleta_id, atletaOv.photo_url || null, initials, 'circle');

  const headerHtml = `
    <div class="athlete-header">
      <div class="athlete-header-top">
        ${badgeCat(a.categoria)}
        ${a.genere === 'F' ? '<span class="badge-cat badge-genere-f">♀</span>' : ''}
        ${a.team_id ? `<a href="#/team/${esc(a.team_id)}" style="font-family:var(--font-heading);font-size:.8rem;color:var(--text-secondary);border:1px solid var(--border-subtle);padding:2px 10px;border-radius:2px">${esc(a.team_attuale)} →</a>` : ''}
      </div>
      <div class="profile-photo-row" style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
        ${photoHtml}
        <div class="athlete-header-name">
          <span class="athlete-cognome">${esc(a.cognome)}</span>
          <span class="athlete-nome">${esc(a.nome)}</span>
          <div class="athlete-pts-display">
            <div class="athlete-pts-dot"></div>
            <div>
              <div class="athlete-pts-value">${a.punti_totali}</div>
              <div class="athlete-pts-label">PUNTI STAGIONE</div>
            </div>
            ${globalPos !== '-' ? `
            <div class="athlete-pts-dot" style="background:var(--accent); margin-left:24px;"></div>
            <div>
              <div class="athlete-pts-value" style="color:var(--accent)">${globalPos}°</div>
              <div class="athlete-pts-label">CLASSIFICA GENERALE</div>
            </div>
            ` : ''}
          </div>
        </div>
      </div>
      <div class="athlete-stats-bar">
        <div class="athlete-stat">
          <span class="athlete-stat-val" style="color:var(--gold)">${p1}</span>
          <span class="athlete-stat-label">1° Posto</span>
        </div>
        <div class="athlete-stat">
          <span class="athlete-stat-val" style="color:var(--silver)">${p2}</span>
          <span class="athlete-stat-label">2° Posto</span>
        </div>
        <div class="athlete-stat">
          <span class="athlete-stat-val" style="color:var(--bronze)">${p3}</span>
          <span class="athlete-stat-label">3° Posto</span>
        </div>
        <div class="athlete-stat">
          <span class="athlete-stat-val" style="color:var(--text-muted)">${pout}</span>
          <span class="athlete-stat-label">4°-10° Posti</span>
        </div>
        <div class="athlete-stat">
          <span class="athlete-stat-val">${top10}</span>
          <span class="athlete-stat-label">Tot. Gare</span>
        </div>
        <div class="athlete-stat">
          <span class="athlete-stat-val" style="color:var(--yellow-race)">${media}</span>
          <span class="athlete-stat-label">Media pt/gara</span>
        </div>
      </div>
    </div>`;

  const sparkHtml = sparkPoints.length ? buildSparkline(sparkPoints, risultati.slice(0,20).reverse()) : '';

  const tableRows = risultati.map(r => {
    const mult = r.moltiplicatore || 1;
    const pClass = posClass(r.posizione);
    // Recupero rank atleta dopo la gara (già calcolato dallo scraper con tie-break)
    const rankVal = r.rank_dopo_gara;
    
    return `<tr>
      <td class="td-date">${fmtDateShort(r.data)}</td>
      <td class="td-race"><a href="#/gara/${esc(r.gara_id)}">${esc(r.nome_gara)}</a></td>
      <td>${badgeCat(a.categoria)}</td>
      <td class="td-pos ${pClass} ${r.posizione===1?'win':''}">${r.posizione}°</td>
      <td>${badgeMult(mult, r.tipo)}</td>
      <td style="text-align:right">${esc(r.km || '—')}</td>
      <td style="text-align:right">${esc(r.media || '—')}</td>
      <td class="td-pts">${r.punti_effettivi||0}</td>
    </tr>`;
  }).join('');

  window._shareAtletaData = {cognome:a.cognome,nome:a.nome,cat:catLabel(a.categoria),team:a.team_attuale||'',punti:a.punti_totali,pos:globalPos,p1:p1,p2:p2,p3:p3,gare:top10};

  // Sport Intelligence computations
  const { resultsRaw: _siRaw } = globalData;
  const _siLastDate = _siRaw.reduce((max, r) => (r.data||'') > max ? r.data : max, '');
  const aiStreak = siStreak(atleta_id, _siRaw);
  const aiMomentum = siMomentum(atleta_id, _siRaw, _siLastDate);
  const aiRivals = siRivals(atleta_id, _siRaw, rCode);
  const _aiStory = siAthleteStory(atleta_id, _siRaw);

  const siIntelPanelHtml = (_aiStory ? '<div class="si-athlete-story-badge">' + _aiStory + '</div>' : '') + `<div class="si-intel-panel">
    <div class="si-intel-momentum" style="--si-color:${aiMomentum.color}">
      <span class="si-intel-label">${aiMomentum.label}</span>
      ${aiMomentum.gare14>0 ? `<span class="si-intel-sub">${aiMomentum.gare14} gare · ${aiMomentum.vittorie14} vitt. · ${aiMomentum.podio14} podi (ultimi 14gg)</span>` : ''}
    </div>
    ${aiStreak.podioStreak >= 2 ? `<div class="si-intel-streak">
      ${aiStreak.winStreak>=2?'👑':'🔥'} <strong>${aiStreak.winStreak>=2?aiStreak.winStreak+' vittorie':aiStreak.podioStreak+' podi'} consecutivi</strong>
    </div>` : ''}
    ${aiRivals.length>0 ? `<div class="si-intel-rivals">
      <span class="si-intel-rivals-label">Rivali frequenti</span>
      ${aiRivals.map(r=>`<a href="#/atleta/${encodeURIComponent(r.atleta_id)}" class="si-rival-chip">${esc(r.cognome)} ${esc(r.nome[0])}. <small>${r.encounters} scontri</small></a>`).join('')}
    </div>` : ''}
  </div>`;

  setPage(`
    ${headerHtml}
    ${sparkHtml ? `<div class="sparkline-wrap"><div class="sparkline-title">ANDAMENTO PUNTI — STAGIONE ${new Date().getFullYear()}</div>${sparkHtml}</div>` : ''}
    <div style="margin: 8px 0 20px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn-share" onclick="window.triggerShareAtleta()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Condividi Profilo</button>
      ${adminEditBtn('atleta', atleta_id)}
    </div>
    ${siIntelPanelHtml}
    <div class="section-header" style="margin-top:24px">
      <span class="section-title">RISULTATI STAGIONE</span>
      <span class="section-line"></span>
    </div>
      <table class="results-table atleta-results">
        <thead><tr>
          <th>DATA</th><th>GARA</th><th>CAT</th><th>POS</th><th>MOLT</th><th style="text-align:right">KM</th><th style="text-align:right">MEDIA</th><th>PTS</th>
        </tr></thead>
        <tbody>${tableRows || '<tr><td colspan="8" class="empty-state">Nessun risultato</td></tr>'}</tbody>
      </table>
    </div>
  `);
}

function buildSparkline(values, risultati) {
  if (!values.length) return '';
  const W = 800, H = 80, pad = 10;
  const max = Math.max(...values, 1);
  const min = 0;
  const n = values.length;
  const xs = values.map((_, i) => pad + (i / Math.max(n - 1, 1)) * (W - 2 * pad));
  const ys = values.map(v => H - pad - ((v - min) / (max - min)) * (H - 2 * pad));

  // Path principale
  const pathD = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ');
  // Area
  const areaD = `${pathD} L ${xs[n-1].toFixed(1)} ${H} L ${xs[0].toFixed(1)} ${H} Z`;

  // Cerchi interattivi
  const circles = xs.map((x, i) => {
    const r = risultati[i];
    const label = r ? `${r.nome_gara} — ${r.punti_effettivi} pt` : `${values[i]} pt`;
    return `<circle class="spark-dot" cx="${x.toFixed(1)}" cy="${ys[i].toFixed(1)}" r="4"
      fill="var(--bg-card)" stroke="var(--red-hot)" stroke-width="2"
      data-label="${esc(label)}"
      onmouseenter="showSparkTip(event,this)" onmouseleave="hideSparkTip()"
      style="cursor:pointer"/>`;
  }).join('');

  return `<div style="position:relative">
    <svg class="sparkline-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--red-hot)" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="var(--red-hot)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}"
        stroke="var(--border-subtle)" stroke-dasharray="4 4" stroke-width="1"/>
      <path d="${areaD}" fill="url(#spark-grad)"/>
      <path d="${pathD}" stroke="var(--red-hot)" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      ${circles}
    </svg>
  </div>`;
}

window.showSparkTip = (evt, el) => {
  const tip = document.getElementById('sparkline-tooltip');
  tip.textContent = el.dataset.label;
  tip.style.display = 'block';
  tip.style.left = (evt.pageX + 10) + 'px';
  tip.style.top  = (evt.pageY - 28) + 'px';
};
window.hideSparkTip = () => {
  document.getElementById('sparkline-tooltip').style.display = 'none';
};

let teamViewCat = '';
let teamViewId = '';

// ── TEAM ──────────────────────────────────────────────────────
async function renderTeam(team_id) {
  if (!globalData) return;
  const { teams, athletes } = globalData;

  const t = teams[team_id];
  if (!t) return renderNotFound();

  // Reset category view if switching team
  if (teamViewId !== team_id) {
    teamViewId = team_id;
    teamViewCat = '';
  }

  // Find all distinct categories this team participated in
  const catPoints = {};
  (t.risultati||[]).forEach(r => {
    const c = getRankingFileCode(r) || r.categoria;
    if(c) catPoints[c] = (catPoints[c]||0) + (r.punti_effettivi||0);
  });
  const SORT_ORDER = ['ES1_M','ES1_F','ES2_M','ES2_F','AL_M','AL_F','JUN_M','JUN_F','ELI_M','ELI_F'];
  const teamCats = Object.keys(catPoints).sort((a,b) => {
    let ia = SORT_ORDER.indexOf(a);
    let ib = SORT_ORDER.indexOf(b);
    if(ia === -1) ia = 99;
    if(ib === -1) ib = 99;
    return ia - ib;
  });
  
  if (!teamViewCat || !teamCats.includes(teamViewCat)) {
    teamViewCat = teamCats[0] || '';
  }

  const catRisultati = (t.risultati||[]).filter(r => (getRankingFileCode(r) || r.categoria) === teamViewCat);
  const catPuntiTotali = catRisultati.reduce((sum, r) => sum + (r.punti_effettivi||0), 0);

  window.setTeamDetailCat = (cat) => {
    teamViewCat = cat;
    renderTeam(team_id);
  };

  const catTabsHtml = teamCats.length > 1 ? `
    <div class="tab-group" role="tablist" style="margin-top:24px; margin-bottom: 24px; display: flex; flex-wrap: wrap; gap: 8px;">
      ${teamCats.map(c => `
        <button class="tab-btn ${teamViewCat===c?'active-cat':''}" onclick="setTeamDetailCat('${c}')">${catLabel(c)}</button>
      `).join('')}
    </div>
  ` : '';
  const _teamNarr = siTeamNarrative(team_id, globalData.resultsRaw);
  const teamNarrHtml = _teamNarr ? '<div class="si-team-narrative">' + _teamNarr + '</div>' : '';

  // Atleti con punti (nella categoria selezionata)
  const atletiMap = {};
  catRisultati.forEach(r => {
    if (!atletiMap[r.atleta_id]) {
      atletiMap[r.atleta_id] = { id: r.atleta_id, ...athletes[r.atleta_id], puntiCat: 0 };
    }
    atletiMap[r.atleta_id].puntiCat += (r.punti_effettivi||0);
  });
  const atletiList = Object.values(atletiMap)
    .filter(a => a.puntiCat > 0)
    .sort((a,b) => b.puntiCat - a.puntiCat);

  const p1 = catRisultati.filter(r=>r.posizione===1).length;
  const p2 = catRisultati.filter(r=>r.posizione===2).length;
  const p3 = catRisultati.filter(r=>r.posizione===3).length;
  const pout = catRisultati.filter(r=>r.posizione>=4 && r.posizione<=10).length;

  const atletiRows = atletiList.map((a,i) => `
    <div class="cat-card-row">
      <span class="cat-pos ${posClass(i+1)}">${i+1}</span>
      <div>
        <div class="cat-rider-name"><a href="#/atleta/${esc(a.id)}">${esc(a.cognome)} ${esc(a.nome)}</a></div>
        <div class="cat-rider-team">${catLabel(a.categoria||'')}</div>
      </div>
      <span class="cat-pts">${a.puntiCat||0}</span>
    </div>`).join('');

  const risultatiRows = [...catRisultati]
    .sort((a,b) => a.posizione - b.posizione || (b.data||'').localeCompare(a.data||''))
    .slice(0, 30)
    .map(r => {
      // Per la scheda Team mostriamo il rank della squadra (con tie-break)
      const rankVal = r.team_rank_dopo_gara;
      return `<tr>
        <td class="td-date">${fmtDateShort(r.data)}</td>
        <td class="td-race">
          <a href="#/gara/${esc(r.gara_id)}">${esc(r.nome_gara)}</a>
          <div class="td-team-mobile"><a href="#/atleta/${esc(r.atleta_id)}" style="color:var(--text-secondary)">${esc(r.atleta_cognome)} ${esc(r.atleta_nome)}</a></div>
        </td>
        <td class="td-hide-mobile"><a href="#/atleta/${esc(r.atleta_id)}" style="color:var(--text-primary);font-family:var(--font-heading);font-weight:700">${esc(r.atleta_cognome)} ${esc(r.atleta_nome)}</a></td>
        <td class="td-pos ${posClass(r.posizione)}">${r.posizione}°</td>
        <td class="td-hide-mobile" style="text-align:center">${badgeMult(r.moltiplicatore || 1, r.tipo)}</td>
        <td class="td-hide-mobile" style="text-align:right">${esc(r.km || '—')}</td>
        <td class="td-hide-mobile" style="text-align:right">${esc(r.media || '—')}</td>
        <td class="td-hide-mobile" style="text-align:right">${rankVal ? `<span style="font-size:0.75rem;color:var(--text-muted)">${rankVal}°</span>` : ''}</td>
        <td class="td-pts">${r.punti_effettivi||0}</td>
      </tr>`;
    }).join('');

  // Caricamento classifiche team + override foto in parallelo
  const [teamRankings, teamOv] = await Promise.all([
    Promise.all(RANKING_CODES.map(c => loadTeamRanking(c))),
    getEntityOverrides('team', team_id),
  ]);
  const tCatRanks = [];
  teamRankings.forEach((rlist, idx) => {
    const code = RANKING_CODES[idx];
    const rk = (rlist || []).find(x => x.team_id === team_id);
    if (rk) tCatRanks.push({ cat: code, pos: rk.pos, pts: rk.punti });
  });
  const topC = tCatRanks.sort((a,b)=>b.pts - a.pts)[0];

  // Header stats
  const currentRank = tCatRanks.find(rk => rk.cat === teamViewCat);
  const rankHtml = currentRank ? `
      <div class="team-stat" style="border-right:1px solid var(--border-subtle); padding-right:16px; margin-right:6px">
        <span class="team-stat-val" style="color:var(--accent)">${currentRank.pos}°</span>
        <span class="team-stat-label">Cl. Gen. ${catLabel(teamViewCat)}</span>
      </div>` : '';

  const headerStats = `
    <div class="team-stats-row">
      ${rankHtml}
      <div class="team-stat">
        <span class="team-stat-val">${catPuntiTotali}</span>
        <span class="team-stat-label">Punti Stagionali</span>
      </div>
      <div class="team-stat">
        <span class="team-stat-val" style="color:var(--gold)">${p1}</span>
        <span class="team-stat-label">1°</span>
      </div>
      <div class="team-stat">
        <span class="team-stat-val" style="color:var(--silver)">${p2}</span>
        <span class="team-stat-label">2°</span>
      </div>
      <div class="team-stat">
        <span class="team-stat-val" style="color:var(--bronze)">${p3}</span>
        <span class="team-stat-label">3°</span>
      </div>
      <div class="team-stat">
        <span class="team-stat-val" style="color:var(--text-muted)">${pout}</span>
        <span class="team-stat-label">4-10</span>
      </div>
      <div class="team-stat">
        <span class="team-stat-val">${atletiList.length}</span>
        <span class="team-stat-label">Atleti</span>
      </div>
    </div>`;

  const teamInitials = t.nome.split(/\s+/).map(w=>w[0]||'').join('').toUpperCase().slice(0,3);
  const teamPhotoHtml = photoAreaHtml('team', team_id, teamOv.photo_url || null, teamInitials, 'square');

  window._shareTeamData = {nome:t.nome,cat:catLabel(teamViewCat),punti:catPuntiTotali,pos:currentRank?currentRank.pos:null,p1:p1,atleti:atletiList.slice(0,5)};
  setPage(`
    <div class="team-header">
      <div class="profile-photo-row" style="display:flex;gap:20px;align-items:center">
        ${teamPhotoHtml}
        <div style="min-width:0;overflow:hidden;flex:1">
          <div class="team-name-display">${esc(t.nome)}</div>
          ${headerStats}
        </div>
      </div>
    </div>
      <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn-share" onclick="window.triggerShareTeam()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Condividi Team</button>
        ${adminEditBtn('team', team_id)}
      </div>
    ${teamNarrHtml}
    ${catTabsHtml}
    <div class="section-header">
      <span class="section-title">ATLETI</span>
      <span class="section-line"></span>
      <span class="section-subtitle">Per contributo punti</span>
    </div>
    <div class="cat-card" style="margin-bottom:32px;border-left:3px solid var(--yellow-race)">
      <div class="cat-card-body">${atletiRows || '<div class="empty-state">Nessun atleta</div>'}</div>
    </div>
    <div class="section-header">
      <span class="section-title">RISULTATI TEAM</span>
      <span class="section-line"></span>
    </div>
    <div class="results-table-wrap">
      <table class="results-table team-results">
        <thead><tr>
          <th>DATA</th><th>GARA</th><th class="td-hide-mobile">ATLETA</th><th>POS</th><th class="td-hide-mobile" style="text-align:center">MOLT</th><th class="td-hide-mobile" style="text-align:right">KM</th><th class="td-hide-mobile" style="text-align:right">MEDIA</th><th class="td-hide-mobile" style="text-align:right">RNK</th><th>PTS</th>
        </tr></thead>
        <tbody>${risultatiRows || '<tr><td colspan="9" class="empty-state">Nessun risultato</td></tr>'}</tbody>
      </table>
    </div>
  `);
}

// ── Photo helpers (top-level so always available) ────────────
function openPhotoLightbox(src) {
  const lb = document.createElement('div');
  lb.id = 'photo-lightbox';
  lb.onclick = () => lb.remove();
  lb.innerHTML = `<img src="${src}" alt="Foto gara"/>`;
  document.body.appendChild(lb);
}
window.openPhotoLightbox = openPhotoLightbox;

function adminEditPhoto(id) {
  const card = document.getElementById(`gal-photo-${id}`);
  const caption      = card?.dataset.caption      || '';
  const photographer = card?.dataset.photographer || '';

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box';

  const box = document.createElement('div');
  box.style.cssText = 'background:#1e293b;color:#f1f5f9;border-radius:12px;padding:24px;width:100%;max-width:400px;box-shadow:0 8px 40px rgba(0,0,0,.5)';
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
      <strong style="font-size:1rem">Modifica foto</strong>
      <button id="ep-close" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#94a3b8;line-height:1">✕</button>
    </div>
    <label style="display:block;font-size:0.8rem;color:#94a3b8;margin-bottom:4px">Didascalia</label>
    <input id="ep-caption" type="text" style="display:block;width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #334155;border-radius:6px;font-size:0.875rem;background:#0f172a;color:#f1f5f9;margin-bottom:12px"/>
    <label style="display:block;font-size:0.8rem;color:#94a3b8;margin-bottom:4px">Credit fotografo</label>
    <input id="ep-photographer" type="text" style="display:block;width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #334155;border-radius:6px;font-size:0.875rem;background:#0f172a;color:#f1f5f9;margin-bottom:16px"/>
    <div id="ep-err" style="color:#f87171;font-size:0.8rem;margin-bottom:10px;display:none"></div>
    <button id="ep-save" style="display:block;width:100%;padding:10px;background:#2563eb;color:#fff;border:none;border-radius:6px;font-weight:700;font-size:0.9rem;cursor:pointer">Salva modifiche</button>`;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  document.getElementById('ep-caption').value      = caption;
  document.getElementById('ep-photographer').value = photographer;
  document.getElementById('ep-close').onclick = () => overlay.remove();
  document.getElementById('ep-save').onclick = async () => {
    const newCaption      = document.getElementById('ep-caption').value || '';
    const newPhotographer = document.getElementById('ep-photographer').value || '';
    const errEl  = document.getElementById('ep-err');
    const saveBtn = document.getElementById('ep-save');
    saveBtn.textContent = 'Salvataggio...';
    saveBtn.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/admin/race-photos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken()}` },
        body: JSON.stringify({ caption: newCaption, photographer: newPhotographer }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      overlay.remove();
      if (window._currentGaraId) renderGara(window._currentGaraId);
    } catch(e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
      saveBtn.textContent = 'Salva modifiche';
      saveBtn.disabled = false;
    }
  };
}
window.adminEditPhoto = adminEditPhoto;

function adminDeletePhoto(id) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box';
  const box = document.createElement('div');
  box.style.cssText = 'background:#1e293b;color:#f1f5f9;border-radius:12px;padding:28px;width:100%;max-width:360px;box-shadow:0 8px 40px rgba(0,0,0,.5);text-align:center';
  box.innerHTML = `
    <div style="font-size:2rem;margin-bottom:12px">🗑</div>
    <strong style="font-size:1rem;display:block;margin-bottom:8px">Eliminare questa foto?</strong>
    <p style="font-size:0.85rem;color:#94a3b8;margin:0 0 20px">L'operazione non è reversibile.</p>
    <div style="display:flex;gap:10px">
      <button id="del-cancel" style="flex:1;padding:10px;background:#334155;color:#f1f5f9;border:none;border-radius:6px;font-weight:600;cursor:pointer">Annulla</button>
      <button id="del-confirm" style="flex:1;padding:10px;background:#dc2626;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer">Elimina</button>
    </div>
    <div id="del-err" style="color:#f87171;font-size:0.8rem;margin-top:10px;display:none"></div>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  document.getElementById('del-cancel').onclick  = () => overlay.remove();
  document.getElementById('del-confirm').onclick = async () => {
    const btn = document.getElementById('del-confirm');
    const errEl = document.getElementById('del-err');
    btn.textContent = 'Eliminazione...';
    btn.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/admin/race-photos/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken()}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      overlay.remove();
      const card = document.getElementById(`gal-photo-${id}`);
      if (card) {
        card.style.transition = 'opacity .3s';
        card.style.opacity = '0';
        setTimeout(() => card.remove(), 320);
      }
      _risPhotosMap = null;
    } catch(e) {
      errEl.textContent = 'Errore: ' + e.message;
      errEl.style.display = 'block';
      btn.textContent = 'Elimina';
      btn.disabled = false;
    }
  };
}
window.adminDeletePhoto = adminDeletePhoto;

// ── ADMIN VIDEO ────────────────────────────────────────────────
window.adminDeleteVideo = async function(calId, idx) {
  if (!confirm('Eliminare questo video dalla gara?')) return;
  try {
    await apiCall(`/admin/videos/${encodeURIComponent(calId)}/${idx}`, { method: 'DELETE' });
    if (window._currentGaraId) renderGara(window._currentGaraId);
  } catch(e) { alert('Errore: ' + e.message); }
};

window.adminEditVideo = async function(calId, idx) {
  const newUrl = prompt('Inserisci il nuovo URL YouTube:');
  if (!newUrl) return;
  const newTitle = prompt('Titolo (lascia vuoto per non cambiarlo):') || undefined;
  try {
    await apiCall(`/admin/videos/${encodeURIComponent(calId)}/${idx}`, {
      method: 'PATCH',
      body: JSON.stringify({ url: newUrl, ...(newTitle ? { title: newTitle } : {}) })
    });
    if (window._currentGaraId) renderGara(window._currentGaraId);
  } catch(e) { alert('Errore: ' + e.message); }
};

// ── GARA ──────────────────────────────────────────────────────
async function renderGara(gara_id) {
  if (!globalData) return;
  const { resultsRaw, calendar } = globalData;

  const calEntry = calendar.find(g => g.id === gara_id);
  const results = resultsRaw.filter(r => r.gara_id === gara_id).sort((a,b) => a.posizione - b.posizione);

  if (!results.length && !calEntry) return renderNotFound();

  const name = results[0]?.nome_gara || calEntry?.nome || gara_id;
  const data = results[0]?.data || calEntry?.data || '';
  const cat  = results[0]?.categoria || calEntry?.categoria || '';
  // Usa moltiplicatore già calcolato dal scraper se disponibile
  const mult = results[0]?.moltiplicatore ||
    calEntry?.moltiplicatore ||
    multFromType(
      calEntry?.tipo || results[0]?.tipo || 'regionale',
      calEntry?.campionato_regionale || false,
      calEntry?.campionato_italiano  || false
    );
  const tipo = results[0]?.tipo || calEntry?.tipo || 'regionale';

  const tableRows = results.map(r => {
    const pts = r.punti_effettivi || (BASEPTS[r.posizione]||0) * mult;
    const pClass = posClass(r.posizione);
    return `<tr>
      <td class="td-pos ${pClass} ${r.posizione===1?'win':''}">${r.posizione}°</td>
      <td style="font-family:var(--font-heading);font-weight:700">
        <a href="#/atleta/${esc(r.atleta_id)}">${esc(r.cognome)} ${esc(r.nome)}</a>
        <div class="td-team-mobile"><a href="#/team/${esc(r.team_id)}" style="color:var(--text-secondary)">${esc(r.team)}</a></div>
      </td>
      <td class="td-hide-mobile"><a href="#/team/${esc(r.team_id)}" style="color:var(--text-secondary)">${esc(r.team)}</a></td>
      <td class="td-time">${esc(r.tempo||'S.T.')}</td>
      <td class="td-hide-mobile" style="text-align:right">${esc(r.km || '—')}</td>
      <td class="td-hide-mobile" style="text-align:right">${esc(r.media || '—')}</td>
      <td class="td-pts">${pts > 0 ? pts : '—'}</td>
    </tr>`;
  }).join('');

  const _calId = (globalData.garaToCalId || {})[gara_id] || gara_id;

  let detailsHtml = '';
  const _raceDetail = (globalData.raceDetails || {})[gara_id] || (globalData.raceDetails || {})[_calId];
  if (_raceDetail && _raceDetail.info) {
    const infoBlocks = _raceDetail.info.map(t => {
      let ft = t
        .replace(/(INFORMAZIONI GENERALI)/g, '<strong style="color:var(--primary); font-size:1.05rem; display:block; margin-top:12px; margin-bottom:6px;">$1</strong>')
        .replace(/(ORGANIZZATORE)/g, '<strong style="color:var(--primary); font-size:1.05rem; display:block; margin-top:20px; margin-bottom:6px;">$1</strong>')
        .replace(/(ISCRIZIONI)/g, '<strong style="color:var(--primary); font-size:1.05rem; display:block; margin-top:20px; margin-bottom:6px;">$1</strong>')
        .replace(/(RITROVO PROVE( \d+)?|RITROVO)/g, '<strong style="color:var(--primary); font-size:1.05rem; display:block; margin-top:20px; margin-bottom:6px;">$1 E PERCORSO</strong>');
      return `<div style="margin-bottom:8px; font-size:0.9rem; color:var(--text-secondary); line-height:1.6;">${ft}</div>`;
    }).join('');
    detailsHtml = `
      <div class="card" style="margin-top:24px; padding:24px;">
        <h3 style="margin-top:0; margin-bottom:16px; font-size:1.1rem; color:var(--primary);">Informazioni e Dettagli Tecnici</h3>
        ${infoBlocks}
        <div style="margin-top:16px;">
          <a href="${esc(_raceDetail.fci_url)}" target="_blank" class="btn-action" style="font-size:0.8rem; display:inline-block;">VAI ALLA SCHEDA FCI &rarr;</a>
        </div>
      </div>
    `;
  }

  // Video YouTube associati alla gara
  const garaVideos = (globalData.videos || {})[_calId] || (globalData.videos || {})[gara_id] || [];
  const featuredVideo = garaVideos[0] || null;
  const featuredVideoId = featuredVideo ? (featuredVideo.url.match(/[?&]v=([^&]+)/) || [])[1] || null : null;
  const extraVideos = garaVideos.slice(1);

  // Carica foto approvate in parallelo con il render
  let racePhotosHtml = '';
  let extraVideosHtml = '';
  try {
    const photosData = await fetch(`${API_BASE}/race-photos/${encodeURIComponent(gara_id)}`).then(r=>r.json()).catch(()=>({photos:[]}));
    const photos = photosData.photos || [];
    const user = authUser();
    const uploadBtn = user
      ? `<button class="race-photo-upload-btn" onclick="window.openRacePhotoUpload('${esc(gara_id)}')">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
           Carica foto
         </button>`
      : `<span style="font-size:0.8rem;color:var(--text-muted)">Accedi per caricare una foto</span>`;
    const isAdmin = user?.role === 'admin';

    // Hero: first photo + first video side by side (or full-width if only one)
    const featuredPhoto = photos[0] || null;
    const adminBtnStyle = 'padding:3px 7px;font-size:0.68rem;color:#fff;border:none;border-radius:4px;cursor:pointer;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.5)';
    const heroPhotoEl = featuredPhoto
      ? `<div class="gara-media-half gara-media-photo" onclick="window.openPhotoLightbox('${PHOTOS_BASE}/photos/${esc(featuredPhoto.filename)}')" style="cursor:zoom-in">
           <img id="gara-hero-img" src="${PHOTOS_BASE}/photos/${esc(featuredPhoto.filename)}" alt="${esc(featuredPhoto.caption||'Foto gara')}" loading="lazy"/>
           <div class="gara-photo-hint">🔍 Clicca per la foto intera</div>
           ${isAdmin ? `<div style="position:absolute;top:4px;right:4px;display:flex;flex-direction:column;gap:3px;z-index:10">
             <button onclick="event.stopPropagation();window.adminEditPhoto(${featuredPhoto.id})" style="${adminBtnStyle};background:#2563eb">✏️ Modifica</button>
             <button onclick="event.stopPropagation();window.adminDeletePhoto(${featuredPhoto.id})" style="${adminBtnStyle};background:#dc2626">🗑 Elimina</button>
           </div>` : ''}
         </div>`
      : '';
    const heroVideoEl = featuredVideoId
      ? `<div class="gara-media-half gara-media-video" onclick="window.openVideoModal('${featuredVideoId}','${esc((featuredVideo.title||'').replace(/'/g, "\\'"))}')">
           <img src="https://img.youtube.com/vi/${featuredVideoId}/hqdefault.jpg" alt="${esc(featuredVideo.title||'Video')}" loading="lazy"/>
           <div class="gara-media-play"><span>&#9658;</span></div>
           <div class="gara-media-channel">${esc(featuredVideo.channel||'')}</div>
           ${isAdmin ? `<div style="position:absolute;top:4px;right:4px;display:flex;flex-direction:column;gap:3px;z-index:10">
             <button onclick="event.stopPropagation();window.adminEditVideo('${esc(_calId)}',0)" style="${adminBtnStyle};background:#2563eb">✏️ Modifica</button>
             <button onclick="event.stopPropagation();window.adminDeleteVideo('${esc(_calId)}',0)" style="${adminBtnStyle};background:#dc2626">🗑 Elimina</button>
           </div>` : ''}
         </div>`
      : '';
    const heroMedia = (heroPhotoEl || heroVideoEl)
      ? `<div class="gara-hero-media${featuredPhoto && featuredVideoId ? ' gara-hero-split' : ''}">${heroPhotoEl}${heroVideoEl}</div>`
      : '';

    const extraPhotos = photos.slice(1);
    const gallery = extraPhotos.length
      ? `<div class="race-gallery">${extraPhotos.map(p=>`
          <div class="race-gallery-item" id="gal-photo-${p.id}"
            data-caption="${esc(p.caption||'')}"
            data-photographer="${esc(p.photographer||'')}">
            <img src="${PHOTOS_BASE}/photos/${esc(p.filename)}" alt="${esc(p.caption||'Foto gara')}" loading="lazy" onclick="window.openPhotoLightbox('${PHOTOS_BASE}/photos/${esc(p.filename)}')" style="cursor:zoom-in"/>
            <div class="race-gallery-caption">${[p.caption, p.photographer ? '📷 '+p.photographer : '', p.display_name].filter(Boolean).join(' — ')}</div>
            ${isAdmin ? `<div style="position:absolute;top:4px;right:4px;display:flex;flex-direction:column;gap:3px;z-index:10">
              <button onclick="event.stopPropagation();window.adminEditPhoto(${p.id})" style="padding:3px 7px;font-size:0.68rem;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.5)">&#9999;&#65039; Modifica</button>
              <button onclick="event.stopPropagation();window.adminDeletePhoto(${p.id})" style="padding:3px 7px;font-size:0.68rem;background:#dc2626;color:#fff;border:none;border-radius:4px;cursor:pointer;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.5)">&#128465; Elimina</button>
            </div>` : ''}
          </div>`).join('')}
        </div>`
      : (!featuredPhoto ? `<p style="color:var(--text-muted);font-size:0.875rem;margin:8px 0 0">Nessuna foto ancora. Sii il primo a condividerne una!</p>` : '');

    const addVideoBtn = user
      ? `<button class="race-photo-upload-btn" onclick="window.openVideoSubmit('${esc(gara_id)}','${esc(_calId)}')">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
           Aggiungi Video
         </button>`
      : '';

    racePhotosHtml = `
      <div class="comp-section" style="margin-top:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:${heroMedia ? '12px' : '0'}">
          <div class="comp-section-title" style="margin-bottom:0;border:none;padding:0">Foto & Video</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${uploadBtn}${addVideoBtn}</div>
        </div>
        ${heroMedia}
        ${gallery}
      </div>`;

    if (extraVideos.length) {
      extraVideosHtml = `
        <div class="comp-section" style="margin-top:12px">
          <div class="comp-section-title">Altri Video</div>
          <div class="gara-videos-grid">
            ${extraVideos.map((v, i) => {
              const vidId = (v.url.match(/[?&]v=([^&]+)/) || [])[1] || '';
              const thumb = vidId ? `https://img.youtube.com/vi/${vidId}/mqdefault.jpg` : '';
              const realIdx = i + 1;
              return `
                <div class="gara-video-card" style="cursor:pointer;position:relative" onclick="window.openVideoModal('${vidId}','${esc((v.title||'').replace(/'/g, "\\'"))}')">
                  ${thumb ? `<div class="gara-video-thumb">
                    <img src="${thumb}" alt="${esc(v.title)}" loading="lazy"/>
                    <div class="gara-video-play">&#9658;</div>
                  </div>` : ''}
                  <div class="gara-video-info">
                    <div class="gara-video-title">${esc(v.title)}</div>
                    <div class="gara-video-meta">${esc(v.channel)}</div>
                  </div>
                  ${isAdmin ? `<div style="position:absolute;top:4px;right:4px;display:flex;gap:3px;z-index:10">
                    <button onclick="event.stopPropagation();window.adminEditVideo('${esc(_calId)}',${realIdx})" style="${adminBtnStyle};background:#2563eb">✏️</button>
                    <button onclick="event.stopPropagation();window.adminDeleteVideo('${esc(_calId)}',${realIdx})" style="${adminBtnStyle};background:#dc2626">🗑</button>
                  </div>` : ''}
                </div>`;
            }).join('')}
          </div>
        </div>`;
    }
  } catch(e) { /* silent */ }

  window._shareGaraData = {name:name,date:fmtDate(data),cat:catLabel(cat),mult:mult,tipo:tipo,results:results.slice(0,10).map(r=>({cognome:r.cognome,nome:r.nome,team:r.team,punti_effettivi:r.punti_effettivi}))};

  // Sport Intelligence: race analysis
  const _garaLastDate = resultsRaw.reduce((max, r) => (r.data||'') > max ? r.data : max, '');
  const top5 = results.slice(0, 5);
  const participantCards = top5.map(r => {
    const mom = siMomentum(r.atleta_id, resultsRaw, _garaLastDate);
    const streak = siStreak(r.atleta_id, resultsRaw);
    const streakBadge = streak.winStreak >= 2 ? `👑${streak.winStreak}W` : streak.podioStreak >= 2 ? `🔥${streak.podioStreak}P` : '';
    return `<div class="si-participant-card">
      <div class="si-participant-pos">${r.posizione}° posto</div>
      <div class="si-participant-name"><a href="#/atleta/${encodeURIComponent(r.atleta_id)}" style="color:inherit;text-decoration:none">${esc(r.cognome)}<br><small style="font-weight:400">${esc(r.nome)}</small></a></div>
      <div class="si-participant-form" style="color:${mom.color}">${mom.label.replace(/^[^ ]+ /,'')}${streakBadge ? ' · '+streakBadge : ''}</div>
    </div>`;
  }).join('');
  const siRaceIntelHtml = top5.length ? `<div class="si-race-intel">
    <div class="si-race-intel-title">📊 ANALISI GARA — Forma dei protagonisti</div>
    <div class="si-race-participants">${participantCards}</div>
  </div>` : '';

  window._currentGaraId = gara_id;
  setPage(`
    <div class="race-header">
      <div class="race-name-display">${esc(name)}</div>
      <div class="race-meta-row">
        <span>${fmtDate(data)}</span>
        <span class="race-meta-sep">|</span>
        <span>${esc(catLabel(cat))}</span>
        <span class="race-meta-sep">|</span>
        <span style="text-transform:capitalize">${esc(tipo)}</span>
        <span class="race-meta-sep">|</span>
        ${badgeMult(mult, tipo, results[0]?.campionato_regionale || calEntry?.campionato_regionale, results[0]?.campionato_italiano || calEntry?.campionato_italiano)}
        ${results[0]?.km ? `<span class="race-meta-sep">|</span><span>${esc(results[0].km)} Km</span>` : ''}
        ${results[0]?.media ? `<span class="race-meta-sep">|</span><span>Media: ${esc(results[0].media)} Km/h</span>` : ''}
      </div>
    </div>
      <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn-share" onclick="window.triggerShareGara()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Condividi Risultati</button>
        ${adminEditBtn('gara', gara_id)}
      </div>
    ${racePhotosHtml}
    ${extraVideosHtml}
    ${siRaceIntelHtml}
    <div class="results-table-wrap">
      <table class="results-table">
        <thead><tr>
          <th>POS</th><th>ATLETA</th><th class="td-hide-mobile">TEAM</th><th>TEMPO</th><th class="td-hide-mobile" style="text-align:right">KM</th><th class="td-hide-mobile" style="text-align:right">MEDIA</th><th class="td-pts">PTS</th>
        </tr></thead>
        <tbody>${tableRows || '<tr><td colspan="7" class="empty-state">Nessuna classifica disponibile</td></tr>'}</tbody>
      </table>
    </div>
    ${detailsHtml}
  `);

  // Face detection per centrare il volto nell'hero photo
  (async () => {
    const img = document.getElementById('gara-hero-img');
    if (!img) return;
    const detect = async () => {
      if (!img.complete || img.naturalWidth === 0) return;
      if ('FaceDetector' in window) {
        try {
          const faces = await new FaceDetector({ fastMode: true }).detect(img);
          if (faces.length > 0) {
            const f = faces[0].boundingBox;
            const x = ((f.x + f.width / 2) / img.naturalWidth * 100).toFixed(1);
            const y = ((f.y + f.height / 2) / img.naturalHeight * 100).toFixed(1);
            img.style.objectPosition = `${x}% ${y}%`;
          }
        } catch { /* non supportato, rimane top center */ }
      }
    };
    if (img.complete) detect(); else img.addEventListener('load', detect, { once: true });
  })();

  // Upload foto gara
  window.openRacePhotoUpload = (garaId) => {
    const user = authUser();
    if (!user) return;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    const isAdmin = user.role === 'admin';
    const inpStyle = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:var(--r-sm);font-size:0.875rem;background:var(--bg-primary);color:var(--text-primary);margin-bottom:10px';
    overlay.innerHTML = `
      <div style="background:var(--bg-card);border-radius:var(--r-lg);padding:24px;width:100%;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,.2)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <strong style="font-size:1rem">Carica Foto Gara</strong>
          <button onclick="this.closest('[style*=fixed]').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text-muted)">✕</button>
        </div>
        ${!isAdmin ? `<p style="font-size:0.8rem;color:var(--text-muted);margin:0 0 14px">La foto sarà visibile dopo approvazione dell'amministratore.</p>` : ''}
        <input type="file" id="rp-file" accept="image/jpeg,image/png,image/webp" style="${inpStyle}"/>
        <input type="text" id="rp-caption" placeholder="Didascalia (facoltativa)" style="${inpStyle}"/>
        <input type="text" id="rp-photographer" placeholder="Credit fotografo (es. Mario Rossi)" style="${inpStyle}"/>
        <div id="rp-err" style="color:#EF4444;font-size:0.8rem;margin-bottom:8px;display:none"></div>
        <button id="rp-submit" onclick="window.submitRacePhoto('${esc(garaId)}')" style="width:100%;padding:9px;background:var(--red-hot);color:#fff;border:none;border-radius:var(--r-sm);font-weight:600;cursor:pointer">Invia</button>
      </div>`;
    document.body.appendChild(overlay);

    // Auto-compila la caption con vincitore, società e nome gara
    const gd = window._shareGaraData;
    if (gd) {
      const winner = gd.results?.[0];
      const autoCaption = winner
        ? `${winner.cognome} ${winner.nome} - ${winner.team} | ${gd.name}`
        : gd.name || '';
      document.getElementById('rp-caption').value = autoCaption;
    }
  };

  // ── AGGIUNGI VIDEO ──────────────────────────────────────────────────
  window.openVideoSubmit = (garaId, calId) => {
    const user = authUser();
    if (!user) return;
    const isAdmin = user.role === 'admin';
    const inpStyle = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:var(--r-sm);font-size:0.875rem;background:var(--bg-primary);color:var(--text-primary);margin-bottom:10px';
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML = `
      <div style="background:var(--bg-card);border-radius:var(--r-lg);padding:24px;width:100%;max-width:460px;box-shadow:0 8px 32px rgba(0,0,0,.3)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <strong style="font-size:1rem">Aggiungi Video</strong>
          <button onclick="this.closest('[style*=fixed]').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text-muted)">✕</button>
        </div>
        ${!isAdmin ? '<p style="font-size:0.8rem;color:var(--text-muted);margin:0 0 14px">Il video sarà visibile dopo approvazione dell\'amministratore.</p>' : ''}

        <div style="display:flex;gap:0;margin-bottom:16px;border-radius:var(--r-sm);overflow:hidden;border:1px solid var(--border-subtle)">
          <button id="vtab-url" onclick="window._switchVideoTab('url')"
            style="flex:1;padding:8px;border:none;cursor:pointer;font-size:0.82rem;font-weight:600;background:var(--red-hot);color:#fff">
            🔗 URL YouTube
          </button>
          <button id="vtab-file" onclick="window._switchVideoTab('file')"
            style="flex:1;padding:8px;border:none;cursor:pointer;font-size:0.82rem;font-weight:600;background:var(--bg-elevated);color:var(--text-secondary)">
            📁 Carica File
          </button>
        </div>

        <div id="vpanel-url">
          <input type="url" id="vurl-input" placeholder="https://www.youtube.com/watch?v=..." style="${inpStyle}"/>
          <input type="text" id="vurl-title" placeholder="Titolo (opzionale)" style="${inpStyle}"/>
          <div id="vurl-preview" style="margin-bottom:10px;display:none">
            <img id="vurl-thumb" src="" style="width:100%;border-radius:var(--r-sm);aspect-ratio:16/9;object-fit:cover"/>
          </div>
        </div>

        <div id="vpanel-file" style="display:none">
          <input type="file" id="vfile-input" accept="video/mp4,video/quicktime,video/webm,video/x-msvideo" style="${inpStyle}"/>
          <input type="text" id="vfile-title" placeholder="Titolo del video*" style="${inpStyle}"/>
          <div id="vfile-progress" style="display:none;margin-bottom:10px">
            <div style="background:var(--bg-elevated);border-radius:4px;height:6px;overflow:hidden">
              <div id="vfile-bar" style="height:100%;background:var(--red-hot);width:0%;transition:width .2s"></div>
            </div>
            <span id="vfile-pct" style="font-size:0.75rem;color:var(--text-muted)">0%</span>
          </div>
        </div>

        <div id="vsubmit-err" style="color:#EF4444;font-size:0.8rem;margin-bottom:8px;display:none"></div>
        <button id="vsubmit-btn" onclick="window._submitVideo('${esc(garaId)}','${esc(calId)}')"
          style="width:100%;padding:9px;background:var(--red-hot);color:#fff;border:none;border-radius:var(--r-sm);font-weight:600;cursor:pointer">
          Invia
        </button>
      </div>`;
    document.body.appendChild(overlay);

    // Preview thumb YouTube mentre si digita URL
    document.getElementById('vurl-input').addEventListener('input', function() {
      const m = this.value.match(/[?&]v=([^&]+)/);
      const preview = document.getElementById('vurl-preview');
      const thumb = document.getElementById('vurl-thumb');
      if (m) { thumb.src = `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg`; preview.style.display = 'block'; }
      else { preview.style.display = 'none'; }
    });
  };

  window._switchVideoTab = (tab) => {
    const isUrl = tab === 'url';
    document.getElementById('vpanel-url').style.display = isUrl ? '' : 'none';
    document.getElementById('vpanel-file').style.display = isUrl ? 'none' : '';
    document.getElementById('vtab-url').style.background = isUrl ? 'var(--red-hot)' : 'var(--bg-elevated)';
    document.getElementById('vtab-url').style.color = isUrl ? '#fff' : 'var(--text-secondary)';
    document.getElementById('vtab-file').style.background = isUrl ? 'var(--bg-elevated)' : 'var(--red-hot)';
    document.getElementById('vtab-file').style.color = isUrl ? 'var(--text-secondary)' : '#fff';
  };

  window._submitVideo = async (garaId, calId) => {
    const err = document.getElementById('vsubmit-err');
    const btn = document.getElementById('vsubmit-btn');
    err.style.display = 'none';
    const isFileTab = document.getElementById('vpanel-file').style.display !== 'none';

    if (isFileTab) {
      const file = document.getElementById('vfile-input')?.files[0];
      const title = document.getElementById('vfile-title')?.value.trim();
      if (!file) { err.textContent = 'Seleziona un file video'; err.style.display = 'block'; return; }
      if (!title) { err.textContent = 'Inserisci un titolo'; err.style.display = 'block'; return; }
      btn.disabled = true; btn.textContent = 'Caricamento…';
      document.getElementById('vfile-progress').style.display = 'block';
      const fd = new FormData();
      fd.append('gara_id', garaId);
      fd.append('cal_id', calId);
      fd.append('title', title);
      fd.append('video', file);
      try {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = e => {
          if (e.lengthComputable) {
            const pct = Math.round(e.loaded/e.total*100);
            document.getElementById('vfile-bar').style.width = pct + '%';
            document.getElementById('vfile-pct').textContent = pct + '%';
          }
        };
        await new Promise((resolve, reject) => {
          xhr.onload = () => {
            const d = JSON.parse(xhr.responseText);
            if (xhr.status >= 400) reject(new Error(d.error || `HTTP ${xhr.status}`));
            else resolve(d);
          };
          xhr.onerror = () => reject(new Error('Errore di rete'));
          xhr.open('POST', `${API_BASE}/videos/upload-file`);
          xhr.setRequestHeader('Authorization', `Bearer ${authToken()}`);
          xhr.send(fd);
        });
        document.querySelector('[style*="position:fixed"][style*="9999"]')?.remove();
        const user = authUser();
        alert(user?.role === 'admin' ? 'Video pubblicato!' : 'Video inviato! Sarà visibile dopo approvazione.');
        if (window._currentGaraId) renderGara(window._currentGaraId);
      } catch(e) { err.textContent = e.message; err.style.display = 'block'; btn.disabled = false; btn.textContent = 'Invia'; }
    } else {
      const url = document.getElementById('vurl-input')?.value.trim();
      const title = document.getElementById('vurl-title')?.value.trim();
      if (!url) { err.textContent = 'Inserisci un URL YouTube'; err.style.display = 'block'; return; }
      btn.disabled = true; btn.textContent = 'Invio…';
      try {
        await apiCall('/videos/submit', { method: 'POST', body: JSON.stringify({ gara_id: garaId, cal_id: calId, url, title }) });
        document.querySelector('[style*="position:fixed"][style*="9999"]')?.remove();
        const user = authUser();
        alert(user?.role === 'admin' ? 'Video pubblicato!' : 'Video inviato! Sarà visibile dopo approvazione.');
        if (window._currentGaraId) renderGara(window._currentGaraId);
      } catch(e) { err.textContent = e.message; err.style.display = 'block'; btn.disabled = false; btn.textContent = 'Invia'; }
    }
  };

  window.submitRacePhoto = async (garaId) => {
    const file = document.getElementById('rp-file')?.files[0];
    const caption = document.getElementById('rp-caption')?.value || '';
    const photographer = document.getElementById('rp-photographer')?.value || '';
    const errEl = document.getElementById('rp-err');
    if (!file) { errEl.textContent='Seleziona un file'; errEl.style.display='block'; return; }
    const btn = document.getElementById('rp-submit');
    btn.disabled = true; btn.textContent = 'Invio…';
    const fd = new FormData();
    // gara_id e altri campi testo PRIMA del file, così multer li ha nel filename callback
    fd.append('gara_id', garaId);
    fd.append('caption', caption);
    fd.append('photographer', photographer);
    fd.append('photo', file);
    try {
      const token = authToken();
      const res = await fetch(`${API_BASE}/race-photos/upload`, { method:'POST', headers:{ Authorization:`Bearer ${token}` }, body:fd });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`Errore HTTP ${res.status}`); }
      if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
      document.querySelector('[style*="position:fixed"][style*="9999"]')?.remove();
      if (data.status === 'approved') {
        alert('Foto pubblicata!');
        renderGara(window._currentGaraId);
      } else {
        alert('Foto inviata! Sarà visibile dopo approvazione.');
      }
    } catch(e) {
      errEl.textContent = e.message; errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Invia';
    }
  };

}

let calQGenere = '';
let calQTipo   = '';
let calQSearch = '';
let calQCat    = '';
let calQMonth  = '';
let calQRegione = '';

async function renderCalendario() {
  if (!globalData) return;
  const { calendar, resultsRaw } = globalData;

  // Mappa calendar.id → { byCategory, firstGaraId }
  // Match per data + prefisso id (il gara_id dei risultati ha suffissi extra rispetto al cal.id)
  const calendarResultsMap = {};
  for (const g of calendar) {
    if (!g.id || !g.data) continue;
    const calBase = g.id.replace(/_\d{4}-\d{2}-\d{2}$/, '');
    const matches = resultsRaw.filter(r => r.data === g.data && r.gara_id && r.gara_id.startsWith(calBase));
    if (!matches.length) continue;
    const byCategory = {};
    for (const r of matches) {
      const cat = r.categoria || 'N/D';
      if (!byCategory[cat]) byCategory[cat] = { gara_id: r.gara_id, results: [] };
      byCategory[cat].results.push(r);
    }
    calendarResultsMap[g.id] = { byCategory, firstGaraId: matches[0].gara_id };
  }

  const CAL_CAT_GROUPS = [
    { value: 'esordient', label: 'Esordienti' },
    { value: 'alliev',    label: 'Allievi' },
    { value: 'junior',    label: 'Juniores' },
    { value: 'elite',     label: 'Elite / U23' },
  ];
  const allRegions = [...new Set(calendar.map(g => g.regione).filter(Boolean))].sort();

  const render = () => {
    const today = new Date().toISOString().split('T')[0];

    let filtered = calendar
      .filter(g => !calQGenere || g.genere === calQGenere)
      .filter(g => {
        if (!calQCat) return true;
        const cat = (g.categoria || '').toLowerCase();
        if (calQCat === 'elite') return cat.includes('elite') || cat.includes('under');
        return cat.includes(calQCat);
      })
      .filter(g => !calQRegione || g.regione === calQRegione)
      .filter(g => {
         if (!calQTipo) return true;
         if (calQTipo === 'campionato_regionale') return g.campionato_regionale;
         if (calQTipo === 'campionato_italiano') return g.campionato_italiano;
         return g.tipo === calQTipo;
      })
      .filter(g => !calQSearch || (g.nome||'').toLowerCase().includes(calQSearch.toLowerCase()))
      .filter(g => {
         if (!calQMonth) return true;
         const gm = g.data ? g.data.split('-')[1] : '';
         return gm === calQMonth;
      });

    // Gare di oggi con risultati già disponibili → trattate come concluse
    const hasRes = (g) => !!(calendarResultsMap[g.id]);
    const future = filtered.filter(g => (g.data || '') > today || ((g.data||'') === today && !hasRes(g))).sort((a,b) => (a.data||'').localeCompare(b.data||''));
    const past   = filtered.filter(g => (g.data || '') < today || ((g.data||'') === today && hasRes(g))).sort((a,b) => (b.data||'').localeCompare(a.data||''));

    const renderItem = (g) => {
      const mult = g.moltiplicatore || multFromType(g.tipo, g.campionato_regionale, g.campionato_italiano);
      const day = g.data ? g.data.split('-')[2] : '—';
      const mon = g.data ? (['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'][parseInt(g.data.split('-')[1])-1]||'') : '';
      const isPast = (g.data || '') < today;
      const calMatch   = calendarResultsMap[g.id] || null;
      const byCategory = calMatch ? calMatch.byCategory : null;
      const hasResults = !!(byCategory && Object.keys(byCategory).length);
      // Link alla gara: usa il gara_id reale dai risultati se disponibile
      const garaLink   = calMatch ? calMatch.firstGaraId : g.id;

      let podioHtml = '';
      if (hasResults) {
        const catEntries = Object.entries(byCategory);
        podioHtml = catEntries.map(([catName, catData]) => {
          const top3 = (catData.results || []).sort((a,b) => a.posizione - b.posizione).slice(0,3);
          const cLabel = catLabel(catName) || catName;
          const firstRes = top3[0];
          const kmVal = firstRes?.km || '';
          const mediaVal = firstRes?.media || '';
          const techBit = (kmVal || mediaVal)
            ? `<span style="font-size:0.72rem;color:var(--text-muted);font-family:var(--font-mono)">${kmVal ? '📍 '+esc(kmVal)+' km' : ''}${kmVal&&mediaVal?' | ':''}${mediaVal ? '⚡ '+esc(mediaVal)+' km/h' : ''}</span>`
            : '';
          const rows = top3.map((r,i) => {
            const pClass = ['p1','p2','p3'][i] || '';
            return `<div style="display:grid;grid-template-columns:28px 1fr;align-items:center;gap:6px;padding:3px 0;">
              <div class="hero-pos ${pClass}" style="font-size:0.82rem;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;">${r.posizione}°</div>
              <div>
                <a href="#/atleta/${esc(r.atleta_id)}" style="font-weight:700;font-size:0.88rem;color:var(--text-primary)">${esc(r.cognome)} ${esc(r.nome)}</a>
                <span style="font-size:0.75rem;color:var(--text-muted);margin-left:6px">${esc(r.team)}</span>
              </div>
            </div>`;
          }).join('');
          return `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border-subtle);">
            ${catEntries.length > 1 ? `<div style="font-size:0.65rem;font-family:var(--font-mono);color:var(--accent);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">${cLabel}</div>` : ''}
            ${techBit}
            ${rows}
          </div>`;
        }).join('');
        const calVideos = (globalData.videos || {})[(globalData.garaToCalId||{})[garaLink] || toCalId(garaLink)] ||
                          (globalData.videos || {})[garaLink] || [];
        const calVideoBtn = calVideos.length
          ? `<a href="${esc(calVideos[0].url)}" target="_blank" rel="noopener" class="btn-action" style="font-size:0.72rem;padding:7px 12px;display:flex;align-items:center;gap:5px;white-space:nowrap;">▶ Video</a>`
          : '';
        podioHtml += `<div style="margin-top:10px;display:flex;gap:8px;align-items:center;">
          <a href="#/gara/${esc(garaLink)}" class="btn-action full" style="font-size:0.72rem;text-align:center;padding:7px 12px;flex:1;">VAI AI RISULTATI COMPLETI &rarr;</a>
          ${calVideoBtn}
        </div>`;
      }

      return `<div class="cal-item ${isPast?'cal-item-past':''} ${hasResults?'cal-item-has-results':''}">
        <div class="cal-item-header">
          <div class="cal-date-block" style="${isPast?'opacity:0.6':''}">
            <div class="cal-day">${day}</div>
            <div class="cal-month">${mon}</div>
          </div>
          <div style="flex:1;min-width:0">
            <div class="cal-name"><a href="#/gara/${esc(garaLink)}">${esc(g.nome)}</a></div>
            <div class="cal-cat">
              ${esc(catLabel(g.categoria)||'')} — <span style="text-transform:capitalize;color:var(--text-muted)">${esc(g.tipo)}</span>
              ${g.luogo || g.regione ? `<div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px;">📍 ${esc(g.luogo || '')} ${g.regione ? '('+esc(g.regione)+')' : ''}</div>` : ''}
            </div>
          </div>
          <div class="cal-badges" style="${isPast?'opacity:0.5':''}">
            ${badgeMult(mult, g.tipo, g.campionato_regionale, g.campionato_italiano)}
            ${g.genere==='F'?'<span class="badge-cat badge-genere-f">♀</span>':''}
            ${g.campionato_italiano?'<span class="badge-cat badge-mult-x3">CI</span>':''}
            ${g.campionato_regionale?'<span class="badge-cat badge-mult-x2">CR</span>':''}
          </div>
        </div>
        ${podioHtml}
      </div>`;
    };

    let html = '';
    if (future.length > 0) {
      html += `<div class="category-divider" style="margin-top:0">Prossime Gare</div>`;
      html += future.map(renderItem).join('');
    }
    if (past.length > 0) {
      html += `<div class="category-divider" style="color:var(--text-muted); border-color:var(--text-muted); opacity:0.6">Gare Concluse</div>`;
      html += past.map(renderItem).join('');
    }

    document.getElementById('cal-list').innerHTML = html || '<div class="empty-state">Nessuna gara trovata</div>';
    document.getElementById('cal-count').textContent = `${filtered.length} gare`;
  };

  setPage(`
    <div class="pg-header">
      <div class="pg-eyebrow">📅 STAGIONE 2025-2026</div>
      <h1 class="pg-title">CALENDARIO</h1>
    </div>
    <div class="calendar-controls">
      <select class="cal-filter-select" id="cal-month" onchange="window.calSetMonth(this.value)" aria-label="Filtra per mese">
        <option value="">Tutti i mesi</option>
        <option value="01" ${calQMonth==='01'?'selected':''}>Gennaio</option>
        <option value="02" ${calQMonth==='02'?'selected':''}>Febbraio</option>
        <option value="03" ${calQMonth==='03'?'selected':''}>Marzo</option>
        <option value="04" ${calQMonth==='04'?'selected':''}>Aprile</option>
        <option value="05" ${calQMonth==='05'?'selected':''}>Maggio</option>
        <option value="06" ${calQMonth==='06'?'selected':''}>Giugno</option>
        <option value="07" ${calQMonth==='07'?'selected':''}>Luglio</option>
        <option value="08" ${calQMonth==='08'?'selected':''}>Agosto</option>
        <option value="09" ${calQMonth==='09'?'selected':''}>Settembre</option>
        <option value="10" ${calQMonth==='10'?'selected':''}>Ottobre</option>
        <option value="11" ${calQMonth==='11'?'selected':''}>Novembre</option>
        <option value="12" ${calQMonth==='12'?'selected':''}>Dicembre</option>
      </select>
      <select class="cal-filter-select" id="cal-genere" onchange="calSetGenere(this.value)" aria-label="Filtra per genere">
        <option value="" ${calQGenere===''?'selected':''}>Tutti</option>
        <option value="M" ${calQGenere==='M'?'selected':''}>Uomini</option>
        <option value="F" ${calQGenere==='F'?'selected':''}>Donne</option>
      </select>
      <select class="cal-filter-select" id="cal-cat" onchange="calSetCat(this.value)" aria-label="Filtra per categoria">
        <option value="" ${calQCat===''?'selected':''}>Tutte Categorie</option>
        ${CAL_CAT_GROUPS.map(g => `<option value="${g.value}" ${g.value === calQCat ? 'selected' : ''}>${g.label}</option>`).join('')}
      </select>
      <select class="cal-filter-select" id="cal-tipo" onchange="calSetTipo(this.value)" aria-label="Filtra per tipo gara">
        <option value="" ${calQTipo===''?'selected':''}>Tutti i tipi</option>
        <option value="regionale" ${calQTipo==='regionale'?'selected':''}>Regionali ×1</option>
        <option value="nazionale" ${calQTipo==='nazionale'?'selected':''}>Nazionali ×2</option>
        <option value="internazionale" ${calQTipo==='internazionale'?'selected':''}>Internazionali ×3</option>
        <option value="campionato_regionale" ${calQTipo==='campionato_regionale'?'selected':''}>Campionati Regionali</option>
        <option value="campionato_italiano" ${calQTipo==='campionato_italiano'?'selected':''}>Campionati Italiani</option>
      </select>
      <select class="cal-filter-select" id="cal-regione" onchange="calSetRegione(this.value)" aria-label="Filtra per regione">
        <option value="" ${calQRegione===''?'selected':''}>Tutte le Regioni</option>
        ${allRegions.map(r => `<option value="${r}" ${r === calQRegione ? 'selected' : ''}>${esc(r)}</option>`).join('')}
      </select>
      <input type="search" class="cal-filter-select" id="cal-search" placeholder="Cerca gara…" oninput="calSetSearch(this.value)" aria-label="Cerca gara" style="width:200px" value="${calQSearch.replace(/"/g, '&quot;')}"/>
      <span class="ranking-count" id="cal-count">${calendar.length} gare</span>
    </div>
    <div class="calendar-list" id="cal-list"></div>
  `);

  window.calSetMonth  = (v) => { calQMonth = v; render(); };
  window.calSetGenere = (v) => { calQGenere = v; render(); };
  window.calSetCat    = (v) => { calQCat = v; render(); };
  window.calSetTipo   = (v) => { calQTipo = v; render(); };
  window.calSetSearch = (v) => { calQSearch = v; render(); };
  window.calSetRegione = (v) => { calQRegione = v; render(); };
  render();
}

// ── SEARCH GLOBALE ────────────────────────────────────────────
let atlGender = 'M';
let atlCat    = 'JUN_M';
let atlSearch = '';

let teamGender = 'M';
let teamCat    = 'JUN_M';
let teamSearch = '';

window.setAtlGender = (g) => { atlGender = g; renderAtletiList(); };
window.setAtlCat    = (c) => { atlCat = c; renderAtletiList(); };
window.setAtlSearch = (v) => { atlSearch = v; window.filterAtletiList(v); };

window.setTeamGender = (g) => { teamGender = g; renderTeamList(); };
window.setTeamCat    = (c) => { teamCat = c; renderTeamList(); };
window.setTeamSearch = (v) => { teamSearch = v; window.filterTeamList(v); };

async function renderAtletiList() {
  if (!globalData) return;
  const { athletes } = globalData;
  
  if ((atlGender === 'M' && atlCat.endsWith('_F')) || (atlGender === 'F' && !atlCat.endsWith('_F'))) {
    atlCat = atlGender === 'M' ? 'JUN_M' : 'ELI_F';
  }

  const catsM = ['ES1_M','ES2_M','AL_M','JUN_M','ELI_M'];
  const catsF = ['ES1_F','ES2_F','AL_F','JUN_F', 'ELI_F'];
  const currentCats = atlGender === 'M' ? catsM : catsF;

  const genderTabs = ['M','F'].map(g => `
    <button class="tab-btn ${atlGender===g?'active-gender':''}" onclick="setAtlGender('${g}')">${g==='M'?'UOMINI':'DONNE'}</button>
  `).join('');
  
  const catTabs = currentCats.map(c => `
    <button class="tab-btn ${atlCat===c?'active-cat':''}" onclick="setAtlCat('${c}')">${catLabel(c)}</button>
  `).join('');

  setPage(`
    <div class="content-wrapper">
      <div class="section-header">
        <h1 style="font-family:var(--font-display);font-size:var(--size-h1);margin-bottom:0">Atleti</h1>
        <span class="section-line"></span>
      </div>

      <div class="ranking-controls" style="margin-bottom:24px">
        <div class="tab-group">${genderTabs}</div>
        <div class="tab-group" style="margin-top:8px">${catTabs}</div>
        
        <div class="ranking-filter-bar" style="margin-top:16px">
          <input type="search" id="atleti-list-search" 
            placeholder="Cerca atleta per nome o cognome…" 
            value="${esc(atlSearch)}"
            oninput="window.setAtlSearch(this.value)" aria-label="Cerca atleta" />
        </div>
      </div>

      <div id="atleti-list-container"></div>
    </div>
  `);

  window.filterAtletiList = (q) => {
    const container = document.getElementById('atleti-list-container');
    const athletesList = Object.values(athletes).filter(a => a.categoria === atlCat);
    const ql = q.toLowerCase();
    const filtered = athletesList.filter(a => `${a.cognome} ${a.nome}`.toLowerCase().includes(ql))
                                .sort((a,b) => (a.cognome || '').localeCompare(b.cognome || ''));

    container.innerHTML = `
      <div class="ranking-table-wrap" style="margin-bottom:32px">
        <table class="ranking-table">
          <thead><tr><th>ATLETA</th><th>TEAM ATTUALE</th><th class="r">PUNTI TOT</th></tr></thead>
          <tbody>
            ${filtered.slice(0, 100).map(a => `
              <tr class="ranking-row">
                <td><a href="#/atleta/${esc(a.id)}"><strong>${esc(a.cognome)} ${esc(a.nome)}</strong></a></td>
                <td><a href="#/team/${esc(a.team_id)}" style="color:var(--text-secondary)">${esc(a.team_attuale)}</a></td>
                <td class="r"><span class="rank-pts">${a.punti_totali}</span></td>
              </tr>
            `).join('') || '<tr><td colspan="3" class="empty-state">Nessun atleta trovato in questa categoria</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  };
  window.filterAtletiList(atlSearch);
}

async function renderTeamList() {
  if (!globalData) return;
  const { teams } = globalData;

  if ((teamGender === 'M' && teamCat.endsWith('_F')) || (teamGender === 'F' && !teamCat.endsWith('_F'))) {
    teamCat = teamGender === 'M' ? 'JUN_M' : 'ELI_F';
  }

  const catsM = ['ES1_M','ES2_M','AL_M','JUN_M','ELI_M'];
  const catsF = ['ES1_F','ES2_F','AL_F','JUN_F', 'ELI_F'];
  const currentCats = teamGender === 'M' ? catsM : catsF;

  const genderTabs = ['M','F'].map(g => `
    <button class="tab-btn ${teamGender===g?'active-gender':''}" onclick="setTeamGender('${g}')">${g==='M'?'UOMINI':'DONNE'}</button>
  `).join('');
  
  const catTabs = currentCats.map(c => `
    <button class="tab-btn ${teamCat===c?'active-cat':''}" onclick="setTeamCat('${c}')">${catLabel(c)}</button>
  `).join('');

  setPage(`
    <div class="content-wrapper">
      <div class="section-header">
        <h1 style="font-family:var(--font-display);font-size:var(--size-h1);margin-bottom:0">Team</h1>
        <span class="section-line"></span>
      </div>

      <div class="ranking-controls" style="margin-bottom:24px">
        <div class="tab-group">${genderTabs}</div>
        <div class="tab-group" style="margin-top:8px">${catTabs}</div>
        
        <div class="ranking-filter-bar" style="margin-top:16px">
          <input type="search" id="team-list-search" 
            placeholder="Cerca team per nome…" 
            value="${esc(teamSearch)}"
            oninput="window.setTeamSearch(this.value)" aria-label="Cerca team" />
        </div>
      </div>

      <div id="team-list-container"></div>
    </div>
  `);

  window.filterTeamList = (q) => {
    const container = document.getElementById('team-list-container');
    // Filter teams that have results in the selected category via punti_per_cat
    const teamsList = Object.values(teams).filter(t => t.punti_per_cat && t.punti_per_cat[teamCat]);
    const ql = q.toLowerCase();
    const filtered = teamsList
      .filter(t => (t.nome || '').toLowerCase().includes(ql))
      .sort((a,b) => (b.punti_per_cat[teamCat] || 0) - (a.punti_per_cat[teamCat] || 0));

    container.innerHTML = `
      <div class="ranking-table-wrap">
        <table class="ranking-table">
          <thead><tr>
            <th>TEAM</th>
            <th class="r" style="width:80px">ATLETI</th>
            <th class="r" style="width:120px">PUNTI ${catLabel(teamCat)}</th>
          </tr></thead>
          <tbody>
            ${filtered.slice(0, 150).map((t, i) => `
              <tr class="ranking-row" style="animation-delay:${Math.min(i,20)*30}ms">
                <td><a href="#/team/${esc(t.id)}"><strong>${esc(t.nome)}</strong></a></td>
                <td class="r" style="color:var(--text-muted);font-size:0.85rem">${t.atleti ? t.atleti.length : 0}</td>
                <td class="r"><span class="rank-pts">${t.punti_per_cat[teamCat] || 0}</span></td>
              </tr>
            `).join('') || '<tr><td colspan="3" class="empty-state">Nessun team in questa categoria</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  };
  window.filterTeamList(teamSearch);
}

// ── UTILITY ──────────────────────────────────────────────────
const CAT_NOISE = new Set(['JUNIORES','ALLIEVE','ALLIEVI','ESORDIENTI','UNDER','DONNE','ELITE','HARELBEKE']);
function isRealRegion(reg) {
  if (!reg) return false;
  const u = reg.toUpperCase().trim();
  if (CAT_NOISE.has(u)) return false;
  if (u === 'ITALIA') return false;
  return normalizeRegion(u).length > 2;
}

const CAT_ORDER = [
  ['Elite-Under23','M'], ['Elite-Under23','F'],
  ['Juniores','M'], ['Juniores','F'],
  ['Allievi','M'], ['Allievi','F'],
  ['Esordienti 1° Anno','M'], ['Esordienti 1° Anno','F'],
  ['Esordienti 2° Anno','M'], ['Esordienti 2° Anno','F'],
];
function catGenLabel(cat, gen) {
  const g = gen === 'M' ? '♂' : '♀';
  return `${g} ${cat}`;
}

// ── STATISTICHE PAGE ─────────────────────────────────────────
async function renderStatistiche() {
  if (!globalData) return;
  const { resultsRaw, athletes, calendar } = globalData;

  // KPI globali (ridotto)
  const totalRaces = new Set(resultsRaw.map(r => r.gara_id)).size;
  const totalAthletes = Object.keys(athletes).length;
  const totalKm = Math.round(resultsRaw.reduce((s,r) => s+(parseFloat(r.km)||0), 0)).toLocaleString('it-IT');

  // Top per categoria/genere (vincitori e marcatori)
  const catBest = {}; // key = "cat|gen" -> { winner, scorer }
  resultsRaw.forEach(r => {
    const key = `${r.categoria}|${r.genere}`;
    if (!catBest[key]) catBest[key] = { wins:{}, pts:{} };
    const id = r.atleta_id;
    if (r.posizione === 1) { catBest[key].wins[id] = (catBest[key].wins[id]||0)+1; }
    catBest[key].pts[id] = (catBest[key].pts[id]||0)+(r.punti_effettivi||0);
  });

  // Gare per categoria/genere
  const garePerCat = {};
  resultsRaw.forEach(r => {
    const key = `${r.categoria}|${r.genere}`;
    if (!garePerCat[key]) garePerCat[key] = new Set();
    garePerCat[key].add(r.gara_id);
  });

  // Regioni M e F (solo regioni vere)
  const regM = {}, regF = {};
  const calByReg = {};
  calendar.forEach(g => {
    const reg = normalizeRegion(g.regione||'');
    if (isRealRegion(reg)) calByReg[reg] = (calByReg[reg]||0)+1;
  });
  resultsRaw.forEach(r => {
    const reg = normalizeRegion(r.regione||'');
    if (!isRealRegion(reg)) return;
    if (r.genere === 'M') { if (!regM[reg]) regM[reg]=new Set(); regM[reg].add(r.gara_id); }
    else { if (!regF[reg]) regF[reg]=new Set(); regF[reg].add(r.gara_id); }
  });

  const topRegM = Object.entries(regM).map(([r,s])=>({r,scraped:s.size,cal:calByReg[r]||0})).sort((a,b)=>b.scraped-a.scraped).slice(0,12);
  const topRegF = Object.entries(regF).map(([r,s])=>({r,scraped:s.size,cal:calByReg[r]||0})).sort((a,b)=>b.scraped-a.scraped).slice(0,12);

  const getName = (id) => {
    const a = athletes[id];
    return a ? `${a.cognome} ${a.nome}` : id.replace(/_/g,' ');
  };

  // Render top vincitori e marcatori per categoria
  const renderTopTable = (type) => {
    const cats = [...new Set(resultsRaw.map(r => `${r.categoria}|${r.genere}`))].sort();
    return cats.map(key => {
      const [cat, gen] = key.split('|');
      const d = catBest[key];
      if (!d) return '';
      const map = type === 'wins' ? d.wins : d.pts;
      const sorted = Object.entries(map).sort((a,b)=>b[1]-a[1]);
      if (!sorted.length) return '';
      const [id, val] = sorted[0];
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border-subtle);transition:background 0.12s" onmouseover="this.style.background='var(--bg-elevated)'" onmouseout="this.style.background=''">
          <div style="min-width:160px;font-size:0.75rem;font-family:var(--font-heading);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em">${catGenLabel(cat,gen)}</div>
          <div style="flex:1;font-family:var(--font-heading);font-weight:700;font-size:0.95rem">
            <a href="#/atleta/${esc(id)}" style="text-transform:uppercase">${esc(getName(id))}</a>
          </div>
          <div style="font-family:var(--font-display);font-size:1.4rem;color:${type==='wins'?'var(--yellow-race)':'var(--red-hot)'}">${val}${type==='wins'?'🏆':' pt'}</div>
        </div>`;
    }).join('');
  };

  // Render gare per categoria
  const gareTableHtml = [...new Set(resultsRaw.map(r=>`${r.categoria}|${r.genere}`))].sort().map(key => {
    const [cat,gen] = key.split('|');
    const n = garePerCat[key]?.size || 0;
    return `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border-subtle)">
        <div style="min-width:180px;font-family:var(--font-heading);font-size:0.85rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em">${catGenLabel(cat,gen)}</div>
        <div style="flex:1;height:8px;background:var(--bg-elevated);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${Math.round(n/Math.max(...Object.values(garePerCat).map(s=>s.size))*100)}%;background:linear-gradient(90deg,var(--cat-juniores),var(--cat-u23));border-radius:4px"></div>
        </div>
        <div style="min-width:60px;text-align:right;font-family:var(--font-display);font-size:1.3rem;color:var(--text-primary)">${n}</div>
      </div>`;
  }).join('');

  const regBar = (arr, label) => arr.map(({r,scraped,cal}) => {
    const pctS = cal ? Math.round(scraped/cal*100) : 100;
    return `
      <div style="padding:10px 0;border-bottom:1px solid var(--border-subtle)">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-family:var(--font-heading);font-weight:700;font-size:0.9rem">${esc(r)}</span>
          <span style="font-size:0.75rem;color:var(--text-muted)">${scraped}/${cal||'?'} gare (${pctS}%)</span>
        </div>
        <div style="height:10px;background:var(--bg-elevated);border-radius:5px;overflow:hidden;position:relative">
          <div style="height:100%;width:100%;background:rgba(255,255,255,0.08);position:absolute"></div>
          <div style="height:100%;width:${pctS}%;background:linear-gradient(90deg,var(--red-hot),var(--yellow-race));border-radius:5px;position:relative;transition:width 0.6s"></div>
        </div>
      </div>`;
  }).join('');

  // Sport Intelligence: season narratives
  const siWinCounts = {};
  const siPodioCounts = {};
  const siRaceCounts = {};
  const siMonthWins = {};
  const siCatRaceCounts = {};
  for (const r of resultsRaw) {
    if (!r.atleta_id || !r.data) continue;
    const id = r.atleta_id;
    siRaceCounts[id] = (siRaceCounts[id]||0) + 1;
    if (r.posizione <= 3) siPodioCounts[id] = (siPodioCounts[id]||0) + 1;
    if (r.posizione === 1) {
      siWinCounts[id] = (siWinCounts[id]||0) + 1;
      const month = r.data.slice(0,7);
      siMonthWins[month] = (siMonthWins[month]||0) + 1;
    }
    const catKey = catLabel(getRankingFileCode(r)||r.categoria)||r.categoria;
    siCatRaceCounts[catKey] = (siCatRaceCounts[catKey]||0) + 1;
  }
  const siTopWinner = Object.entries(siWinCounts).sort((a,b)=>b[1]-a[1])[0];
  const siTopWinnerAtleta = siTopWinner ? athletes[siTopWinner[0]] : null;
  const siTopWinnerName = siTopWinnerAtleta ? `${siTopWinnerAtleta.cognome} ${siTopWinnerAtleta.nome}` : '';
  const siConsistency = Object.entries(siRaceCounts)
    .filter(([id, g]) => g >= 5)
    .map(([id, g]) => ({ id, pct: Math.round(((siPodioCounts[id]||0)/g)*100), g }))
    .sort((a,b) => b.pct - a.pct)[0];
  const siConsistentAtleta = siConsistency ? athletes[siConsistency.id] : null;
  const siConsistentName = siConsistentAtleta ? `${siConsistentAtleta.cognome} ${siConsistentAtleta.nome}` : '';
  const siHottestMonth = Object.entries(siMonthWins).sort((a,b)=>b[1]-a[1])[0];
  const SI_MESI = ['','GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'];
  const siMonthLabel = siHottestMonth ? siHottestMonth[0].replace(/-(\d+)$/, (m,mm) => ' ' + (SI_MESI[parseInt(mm)]||mm)) : '';
  const siTopCat = Object.entries(siCatRaceCounts).sort((a,b)=>b[1]-a[1])[0];

  const siStoryCardsHtml = `<div class="si-stories-grid">
    ${siTopWinnerName ? `<div class="si-story-card">
      <div class="si-story-icon">👑</div>
      <div class="si-story-label">Dominatore della Stagione</div>
      <div class="si-story-value">${esc(siTopWinnerName)}</div>
      <div class="si-story-sub">${siTopWinner[1]} vittorie totali</div>
    </div>` : ''}
    ${siConsistentName ? `<div class="si-story-card">
      <div class="si-story-icon">🎯</div>
      <div class="si-story-label">Atleta più Costante</div>
      <div class="si-story-value">${esc(siConsistentName)}</div>
      <div class="si-story-sub">${siConsistency.pct}% podi su ${siConsistency.g} gare</div>
    </div>` : ''}
    ${siHottestMonth ? `<div class="si-story-card">
      <div class="si-story-icon">🔥</div>
      <div class="si-story-label">Mese più Caldo</div>
      <div class="si-story-value">${siMonthLabel}</div>
      <div class="si-story-sub">${siHottestMonth[1]} vittorie registrate</div>
    </div>` : ''}
    ${siTopCat ? `<div class="si-story-card">
      <div class="si-story-icon">📊</div>
      <div class="si-story-label">Categoria più Attiva</div>
      <div class="si-story-value" style="font-size:clamp(1rem,2.5vw,1.4rem)">${esc(siTopCat[0])}</div>
      <div class="si-story-sub">${siTopCat[1]} partecipazioni totali</div>
    </div>` : ''}
  </div>`;

  let activeRegTab = 'M';
  setPage(`
    <div class="pg-header">
      <div class="pg-eyebrow">📊 ANALISI & DATI</div>
      <h1 class="pg-title">STATISTICHE</h1>
    </div>

    <!-- SPORT INTELLIGENCE NARRATIVES -->
    ${siStoryCardsHtml}

    <!-- KPI -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;margin-bottom:40px">
      ${[['🏁',totalRaces,'Gare Scrapate'],['👤',totalAthletes,'Atleti'],['🛣️',totalKm,'Km Totali'],['📅',calendar.length,'Gare in Calendario']].map(([icon,val,label])=>`
        <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;padding:20px;text-align:center">
          <div style="font-size:1.8rem;margin-bottom:6px">${icon}</div>
          <div style="font-family:var(--font-display);font-size:2rem;color:var(--red-hot);line-height:1">${val}</div>
          <div style="font-family:var(--font-heading);font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.1em;margin-top:6px">${label}</div>
        </div>`).join('')}
    </div>

    <!-- TOP VINCITORI + TOP MARCATORI -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:24px;margin-bottom:40px">
      <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
        <div style="padding:14px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border-subtle);font-family:var(--font-heading);font-weight:700;text-transform:uppercase;letter-spacing:0.08em">🥇 Top Vincitore per Categoria</div>
        ${renderTopTable('wins')}
      </div>
      <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
        <div style="padding:14px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border-subtle);font-family:var(--font-heading);font-weight:700;text-transform:uppercase;letter-spacing:0.08em">🔥 Top Marcatore per Categoria</div>
        ${renderTopTable('pts')}
      </div>
    </div>

    <!-- GARE PER CATEGORIA -->
    <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden;margin-bottom:40px">
      <div style="padding:14px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border-subtle);font-family:var(--font-heading);font-weight:700;text-transform:uppercase;letter-spacing:0.08em">📊 Gare Disputate per Categoria</div>
      ${gareTableHtml}
    </div>

    <!-- ATTIVITA' PER REGIONE (tab M/F) -->
    <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden;margin-bottom:40px">
      <div style="padding:14px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;justify-content:space-between">
        <span style="font-family:var(--font-heading);font-weight:700;text-transform:uppercase;letter-spacing:0.08em">📍 Attività per Regione</span>
        <div style="display:flex;gap:6px">
          <button id="reg-tab-M" onclick="window.switchRegTab('M')" style="font-family:var(--font-heading);font-weight:700;font-size:0.8rem;padding:4px 14px;border-radius:20px;border:1px solid var(--red-hot);background:var(--red-hot);color:#fff;cursor:pointer">♂ Uomini</button>
          <button id="reg-tab-F" onclick="window.switchRegTab('F')" style="font-family:var(--font-heading);font-weight:700;font-size:0.8rem;padding:4px 14px;border-radius:20px;border:1px solid var(--border-subtle);background:none;color:var(--text-muted);cursor:pointer">♀ Donne</button>
        </div>
      </div>
      <div style="padding:16px">
        <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:12px">La barra mostra le gare scrapate rispetto al totale nel calendario. Formato: <strong>scrapate/calendario (% copertura)</strong></div>
        <div id="reg-content-M">${regBar(topRegM,'M')}</div>
        <div id="reg-content-F" style="display:none">${regBar(topRegF,'F')}</div>
      </div>
    </div>
  `);

  window.switchRegTab = (tab) => {
    document.getElementById('reg-content-M').style.display = tab==='M'?'':'none';
    document.getElementById('reg-content-F').style.display = tab==='F'?'':'none';
    const bM = document.getElementById('reg-tab-M');
    const bF = document.getElementById('reg-tab-F');
    bM.style.background = tab==='M'?'var(--red-hot)':'none';
    bM.style.color = tab==='M'?'#fff':'var(--text-muted)';
    bM.style.borderColor = tab==='M'?'var(--red-hot)':'var(--border-subtle)';
    bF.style.background = tab==='F'?'var(--cat-donne)':'none';
    bF.style.color = tab==='F'?'#fff':'var(--text-muted)';
    bF.style.borderColor = tab==='F'?'var(--cat-donne)':'var(--border-subtle)';
  };
}

// ── COMPARATORE ───────────────────────────────────────────────
let compA = '', compB = '', compMode = 'atleta', compCat = '', compGender = 'M';

// ── COMPARATORE AUTOCOMPLETE HELPERS ──────────────────────────
function buildCompAc(side, items, selectedId) {
  const sel = items.find(i => i.id === selectedId);
  const selLabel = sel ? sel.label : '';
  const htmlItems = items.map(item =>
    `<div class="comp-ac-item" data-id="${esc(item.id)}" data-label="${String(item.label).replace(/"/g,'&quot;')}"
       onclick="window.compAcPick('${side}',this)">
      <span class="comp-ac-name">${esc(item.label)}</span>
      ${item.sub ? `<span class="comp-ac-sub">${esc(item.sub)}</span>` : ''}
    </div>`
  ).join('');
  return `<div class="comp-ac" id="comp-ac-${side}">
    <input type="text" id="comp-ac-input-${side}" class="comp-ac-input cal-filter-select"
      placeholder="Cerca nome…" value="${String(selLabel).replace(/"/g,'&quot;')}" autocomplete="off"
      oninput="window.compAcFilter('${side}',this.value)"
      onfocus="window.compAcOpen('${side}')"
      onblur="setTimeout(()=>{var l=document.getElementById('comp-ac-list-${side}');if(l)l.style.display='none';},180)"
    />
    <div class="comp-ac-dropdown" id="comp-ac-list-${side}">
      ${htmlItems || '<div class="comp-ac-empty">Nessun risultato</div>'}
    </div>
  </div>`;
}

window.compAcFilter = (side, query) => {
  const list = document.getElementById(`comp-ac-list-${side}`);
  if (!list) return;
  const q = query.toLowerCase().trim();
  let vis = 0;
  list.querySelectorAll('.comp-ac-item').forEach(el => {
    const match = !q || (el.dataset.label||'').toLowerCase().includes(q);
    el.style.display = match ? '' : 'none';
    if (match) vis++;
  });
  list.style.display = vis > 0 ? 'block' : 'none';
};

window.compAcOpen = (side) => {
  const input = document.getElementById(`comp-ac-input-${side}`);
  const list  = document.getElementById(`comp-ac-list-${side}`);
  if (!list) return;
  window.compAcFilter(side, input?.value || '');
};

window.compAcPick = (side, el) => {
  const id    = el.dataset.id;
  const label = el.dataset.label;
  const input = document.getElementById(`comp-ac-input-${side}`);
  if (input) input.value = label;
  const list = document.getElementById(`comp-ac-list-${side}`);
  if (list) list.style.display = 'none';
  if (side === 'a') window.setCompA(id);
  else              window.setCompB(id);
};

async function renderComparatore() {
  if (!globalData) return;
  const { resultsRaw, athletes } = globalData;

  // Pre-seleziona la categoria del hub attivo (l'utente può sempre cambiare)
  if (activeHub && !compCat) {
    compGender = activeHub.gender;
    compCat = activeHub.mainCat;
  }

  const availCats = [...new Set(
    resultsRaw.filter(r => r.genere === compGender).map(r => r.categoria)
  )].sort();
  const catOpts = availCats.map(c =>
    `<option value="${esc(c)}" ${c === compCat ? 'selected' : ''}>${esc(c)}</option>`
  ).join('');
  const catFilter = r => r.genere === compGender && (!compCat || r.categoria === compCat);

  // ── STATS CALCULATOR ──────────────────────────────────────────
  const calcStats = arr => {
    const sorted = [...arr].sort((a,b) => (b.data||'').localeCompare(a.data||''));
    const wins  = arr.filter(r => r.posizione === 1).length;
    const podi  = arr.filter(r => r.posizione <= 3).length;
    const top5  = arr.filter(r => r.posizione <= 5).length;
    const gare  = new Set(arr.map(r => r.gara_id)).size;
    const pts   = arr.reduce((s,r) => s + (r.punti_effettivi||0), 0);
    const km    = Math.round(arr.reduce((s,r) => s + (parseFloat(r.km)||0), 0));
    const mArr  = arr.filter(r => r.media);
    const mediaKm = mArr.length
      ? (mArr.reduce((s,r) => s+(parseFloat(r.media)||0),0)/mArr.length).toFixed(1) : '—';
    const avgPos = arr.length
      ? (arr.reduce((s,r)=>s+r.posizione,0)/arr.length).toFixed(1) : '—';
    const recent8 = sorted.slice(0,8);
    const recentPts = sorted.slice(0,5).reduce((s,r)=>s+(r.punti_effettivi||0),0);
    const ptsPerRace = gare ? +(pts/gare).toFixed(1) : 0;
    const winRate    = gare ? +(wins/gare*100).toFixed(1) : 0;
    const podiumRate = gare ? +(podi/gare*100).toFixed(1) : 0;
    const ptsArr = arr.map(r=>r.punti_effettivi||0);
    const mean   = ptsArr.length ? ptsArr.reduce((s,v)=>s+v,0)/ptsArr.length : 0;
    const stdev  = ptsArr.length>1 ? Math.sqrt(ptsArr.reduce((s,v)=>s+(v-mean)**2,0)/ptsArr.length) : 0;
    const cv     = mean>0 ? stdev/mean : 1;
    const consistencyScore = Math.max(0, Math.round((1-Math.min(cv,1))*100));
    const aggressionIdx    = gare ? +((wins*3+podi*2+top5)/gare*10).toFixed(1) : 0;
    return { pts, wins, podi, top5, gare, km, mediaKm, avgPos, recent8, recentPts,
             ptsPerRace, winRate, podiumRate, consistencyScore, aggressionIdx };
  };

  // ── FORM PILLS ────────────────────────────────────────────────
  const formPills = results => {
    if (!results.length) return '<span style="color:var(--text-muted);font-size:0.8rem">—</span>';
    return results.map(r => {
      const p = r.posizione;
      let bg='#EEF1F4', col='#6B7280';
      if (p===1)      { bg='#D97706'; col='#fff'; }
      else if (p<=3)  { bg='#6B7280'; col='#fff'; }
      else if (p<=5)  { bg='rgba(255,107,0,0.75)'; col='#fff'; }
      return `<span class="form-pill" style="background:${bg};color:${col}">${p}°</span>`;
    }).join('');
  };

  // ── METRIC BAR ────────────────────────────────────────────────
  const mBar = (vA, vB, label, fmt='', hl=false) => {
    const nA=parseFloat(vA)||0, nB=parseFloat(vB)||0, tot=nA+nB||1;
    const pA=Math.round(nA/tot*100);
    const wA=nA>nB, wB=nB>nA;
    return `<div class="comp-bar-row${hl?' comp-bar-highlight':''}">
      <span class="comp-bar-val comp-bar-val-a${wA?' comp-bar-winner':''}">${vA}${fmt}</span>
      <div class="comp-bar-center">
        <div class="comp-bar-label">${label}</div>
        <div class="comp-bar-track">
          <div class="comp-bar-fill-a" style="width:${pA}%"></div>
          <div class="comp-bar-fill-b" style="width:${100-pA}%"></div>
        </div>
      </div>
      <span class="comp-bar-val comp-bar-val-b${wB?' comp-bar-winner':''}">${vB}${fmt}</span>
    </div>`;
  };

  // ── RADAR SVG ─────────────────────────────────────────────────
  const buildRadar = (sA, sB, nA, nB) => {
    const axes = [
      { label:'Vittorie',   vA:sA.wins,           vB:sB.wins           },
      { label:'Podi',       vA:sA.podi,           vB:sB.podi           },
      { label:'Costanza',   vA:sA.consistencyScore, vB:sB.consistencyScore },
      { label:'Attività',   vA:sA.gare,           vB:sB.gare           },
      { label:'Efficienza', vA:sA.ptsPerRace,     vB:sB.ptsPerRace     },
      { label:'Forma',      vA:sA.recentPts,      vB:sB.recentPts      },
    ];
    const N=axes.length, cx=130, cy=130, R=95;
    const norm = axes.map(a => { const mx=Math.max(a.vA,a.vB,1); return {label:a.label,nA:a.vA/mx,nB:a.vB/mx}; });
    const pt = (i,r) => { const a=i*(2*Math.PI/N)-Math.PI/2; return [cx+r*Math.cos(a), cy+r*Math.sin(a)]; };
    const circles = [0.25,0.5,0.75,1].map(f=>`<circle cx="${cx}" cy="${cy}" r="${R*f}" fill="none" stroke="rgba(0,0,0,0.06)" stroke-width="1"/>`).join('');
    const axLines = Array.from({length:N}).map((_,i)=>{ const [x,y]=pt(i,R); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(0,0,0,0.07)" stroke-width="1"/>`; }).join('');
    const poly = key => norm.map((_,i)=>{ const [x,y]=pt(i,R*norm[i][key]); return `${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ');
    const lbls = norm.map((m,i)=>{ const [x,y]=pt(i,R+20); return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-family="Inter,system-ui,sans-serif" font-size="9" fill="#9CA3AF" font-weight="600" letter-spacing="0.05em">${m.label.toUpperCase()}</text>`; }).join('');
    const dotsA = norm.map((_,i)=>{ const [x,y]=pt(i,R*norm[i].nA); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#FF6B00"/>`; }).join('');
    const dotsB = norm.map((_,i)=>{ const [x,y]=pt(i,R*norm[i].nB); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#10B981"/>`; }).join('');
    return `<div class="comp-section">
      <div class="comp-section-title">Radar Analitico</div>
      <div class="comp-radar-wrap">
        <svg viewBox="0 0 260 260" width="240" height="240" style="overflow:visible;flex-shrink:0">
          ${circles}${axLines}
          <polygon points="${poly('nB')}" fill="rgba(16,185,129,0.1)" stroke="#10B981" stroke-width="1.5"/>
          <polygon points="${poly('nA')}" fill="rgba(255,107,0,0.1)" stroke="#FF6B00" stroke-width="1.5"/>
          ${dotsA}${dotsB}${lbls}
        </svg>
        <div class="comp-radar-legend">
          <div class="comp-radar-leg-item"><span class="comp-radar-dot" style="background:#FF6B00"></span>${esc(nA)}</div>
          <div class="comp-radar-leg-item"><span class="comp-radar-dot" style="background:#10B981"></span>${esc(nB)}</div>
        </div>
      </div>
    </div>`;
  };

  // ── HEAD TO HEAD ──────────────────────────────────────────────
  const buildH2H = (aRes, bRes, nA, nB) => {
    const shared = aRes.filter(r => bRes.some(s => s.gara_id===r.gara_id));
    if (!shared.length) return `<div class="comp-section">
      <div class="comp-section-title">Testa a Testa Diretto</div>
      <div class="comp-empty">Nessuna gara in comune nel periodo selezionato</div>
    </div>`;
    let wA=0, wB=0;
    const rows = shared.map(r => {
      const br = bRes.find(s=>s.gara_id===r.gara_id);
      const w = r.posizione<br.posizione?'A':r.posizione>br.posizione?'B':'D';
      if(w==='A')wA++; else if(w==='B')wB++;
      return {gara:r.nome_gara,garaId:r.gara_id,data:r.data,posA:r.posizione,posB:br.posizione,w};
    }).sort((a,b)=>(b.data||'').localeCompare(a.data||''));
    const pA = Math.round(wA/shared.length*100);
    return `<div class="comp-section">
      <div class="comp-section-title">Testa a Testa Diretto</div>
      <div class="h2h-score-bar">
        <div class="h2h-score-side">
          <span class="h2h-score-num" style="color:#FF6B00">${wA}</span>
          <span class="h2h-score-label">${esc(nA)}</span>
        </div>
        <div class="h2h-score-center">
          <div class="h2h-bar-track"><div class="h2h-bar-fill" style="width:${pA}%"></div></div>
          <div class="h2h-score-sub">${shared.length} gare in comune</div>
        </div>
        <div class="h2h-score-side h2h-score-right">
          <span class="h2h-score-num" style="color:#10B981">${wB}</span>
          <span class="h2h-score-label">${esc(nB)}</span>
        </div>
      </div>
      <div class="results-table-wrap" style="margin-top:16px">
        <table class="results-table h2h-table">
          <thead><tr><th>DATA</th><th>GARA</th><th style="text-align:center">${esc(nA)}</th><th></th><th style="text-align:center">${esc(nB)}</th></tr></thead>
          <tbody>${rows.map(r=>`<tr class="${r.w==='A'?'h2h-win-a':r.w==='B'?'h2h-win-b':''}">
            <td class="td-date">${fmtDateShort(r.data)}</td>
            <td class="td-race"><a href="#/gara/${esc(r.garaId)}">${esc(r.gara)}</a></td>
            <td class="td-pos ${posClass(r.posA)}${r.w==='A'?' win':''}" style="text-align:center;font-weight:${r.w==='A'?700:400}">${r.posA}°</td>
            <td style="text-align:center;color:var(--text-muted);font-size:0.7rem">vs</td>
            <td class="td-pos ${posClass(r.posB)}${r.w==='B'?' win':''}" style="text-align:center;font-weight:${r.w==='B'?700:400}">${r.posB}°</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
  };

  // ── INSIGHTS ──────────────────────────────────────────────────
  const buildInsights = (sA, sB, nA, nB) => {
    const ins = [];
    const add = (cond, icon, text, side) => { if(cond) ins.push({icon,text,side}); };
    add(sA.winRate>sB.winRate*1.2,   '🏆', `<strong>${esc(nA)}</strong> ha un tasso vittorie superiore (${sA.winRate}% vs ${sB.winRate}%)`, 'a');
    add(sB.winRate>sA.winRate*1.2,   '🏆', `<strong>${esc(nB)}</strong> ha un tasso vittorie superiore (${sB.winRate}% vs ${sA.winRate}%)`, 'b');
    add(sA.consistencyScore>sB.consistencyScore+10, '📊', `<strong>${esc(nA)}</strong> è più costante nelle prestazioni (indice ${sA.consistencyScore} vs ${sB.consistencyScore})`, 'a');
    add(sB.consistencyScore>sA.consistencyScore+10, '📊', `<strong>${esc(nB)}</strong> è più costante nelle prestazioni (indice ${sB.consistencyScore} vs ${sA.consistencyScore})`, 'b');
    add(sA.recentPts>sB.recentPts*1.3, '🔥', `<strong>${esc(nA)}</strong> è in forma migliore nelle ultime 5 gare (${sA.recentPts} vs ${sB.recentPts} pt)`, 'a');
    add(sB.recentPts>sA.recentPts*1.3, '🔥', `<strong>${esc(nB)}</strong> è in forma migliore nelle ultime 5 gare (${sB.recentPts} vs ${sA.recentPts} pt)`, 'b');
    add(sA.podiumRate>sB.podiumRate*1.2, '🥇', `<strong>${esc(nA)}</strong> sale sul podio più frequentemente (${sA.podiumRate}% vs ${sB.podiumRate}%)`, 'a');
    add(sB.podiumRate>sA.podiumRate*1.2, '🥇', `<strong>${esc(nB)}</strong> sale sul podio più frequentemente (${sB.podiumRate}% vs ${sA.podiumRate}%)`, 'b');
    add(sA.ptsPerRace>sB.ptsPerRace*1.2, '⚡', `<strong>${esc(nA)}</strong> produce più punti per gara (${sA.ptsPerRace} vs ${sB.ptsPerRace} pt/gara)`, 'a');
    add(sB.ptsPerRace>sA.ptsPerRace*1.2, '⚡', `<strong>${esc(nB)}</strong> produce più punti per gara (${sB.ptsPerRace} vs ${sA.ptsPerRace} pt/gara)`, 'b');
    if (!ins.length) ins.push({icon:'⚖️', text:'Le statistiche dei due atleti sono molto equilibrate in questa stagione.', side:'n'});
    return `<div class="comp-section">
      <div class="comp-section-title">Analisi Intelligente</div>
      <div class="comp-insights">
        ${ins.map(i=>`<div class="comp-insight-item comp-insight-${i.side}">
          <span class="comp-insight-icon">${i.icon}</span>
          <span class="comp-insight-text">${i.text}</span>
        </div>`).join('')}
      </div>
    </div>`;
  };

  // ── ATHLETE BLOCK ─────────────────────────────────────────────
  const buildAthleteResult = () => {
    const validIds = new Set(
      resultsRaw.filter(r => r.genere===compGender && (!compCat||r.categoria===compCat)).map(r=>r.atleta_id)
    );
    const list = Object.values(athletes).filter(a=>validIds.has(a.id))
      .sort((a,b)=>(a.cognome||'').localeCompare(b.cognome||''));
    const opts = (sel) => list.map(a=>
      `<option value="${a.id}" ${a.id===sel?'selected':''}>${esc(a.cognome)} ${esc(a.nome)}</option>`
    ).join('');

    const acItems = list.map(a => ({ id: a.id, label: `${a.cognome} ${a.nome}`, sub: a.team_attuale||'' }));

    if (!compA || !compB || compA===compB) return `
      <div class="comp-selectors">
        <div class="comp-selector-group">
          <label class="comp-label">Atleta A</label>
          ${buildCompAc('a', acItems, compA)}
        </div>
        <div class="comp-vs-badge">VS</div>
        <div class="comp-selector-group">
          <label class="comp-label">Atleta B</label>
          ${buildCompAc('b', acItems, compB)}
        </div>
      </div>
      <div class="comp-empty-state">
        <div class="comp-empty-icon">⚔️</div>
        <div class="comp-empty-text">Seleziona due atleti per avviare il confronto</div>
      </div>`;

    const aD=athletes[compA], bD=athletes[compB];
    if (!aD||!bD) return '<div class="comp-empty">Dati non disponibili</div>';
    const aRes=resultsRaw.filter(r=>r.atleta_id===compA&&catFilter(r));
    const bRes=resultsRaw.filter(r=>r.atleta_id===compB&&catFilter(r));
    const sA=calcStats(aRes), sB=calcStats(bRes);
    const nA=`${aD.cognome} ${aD.nome}`, nB=`${bD.cognome} ${bD.nome}`;
    const iA=((aD.cognome||'?')[0]+(aD.nome||'?')[0]).toUpperCase();
    const iB=((bD.cognome||'?')[0]+(bD.nome||'?')[0]).toUpperCase();

    const advRows = [
      {l:'Tasso Vittorie',      vA:sA.winRate+'%',       vB:sB.winRate+'%',       nA:+sA.winRate,       nB:+sB.winRate},
      {l:'Tasso Podi',          vA:sA.podiumRate+'%',    vB:sB.podiumRate+'%',    nA:+sA.podiumRate,    nB:+sB.podiumRate},
      {l:'Indice Costanza',     vA:sA.consistencyScore,  vB:sB.consistencyScore,  nA:sA.consistencyScore, nB:sB.consistencyScore},
      {l:'Indice Aggressività', vA:sA.aggressionIdx,     vB:sB.aggressionIdx,     nA:sA.aggressionIdx,  nB:sB.aggressionIdx},
      {l:'Punti / Gara',        vA:sA.ptsPerRace,        vB:sB.ptsPerRace,        nA:sA.ptsPerRace,     nB:sB.ptsPerRace},
      {l:'Posizione Media',     vA:sA.avgPos+'°',        vB:sB.avgPos+'°',        nA:10-(+sA.avgPos||10), nB:10-(+sB.avgPos||10)},
      {l:'Forma Recente (5g)',  vA:sA.recentPts+' pt',   vB:sB.recentPts+' pt',   nA:sA.recentPts,      nB:sB.recentPts},
    ].map(m => {
      const tot=(m.nA||0)+(m.nB||0)||1, pA=Math.round((m.nA||0)/tot*100);
      const wA=m.nA>m.nB, wB=m.nB>m.nA;
      return `<div class="comp-bar-row">
        <span class="comp-bar-val comp-bar-val-a${wA?' comp-bar-winner':''}">${m.vA}</span>
        <div class="comp-bar-center">
          <div class="comp-bar-label">${m.l}</div>
          <div class="comp-bar-track">
            <div class="comp-bar-fill-a" style="width:${pA}%"></div>
            <div class="comp-bar-fill-b" style="width:${100-pA}%"></div>
          </div>
        </div>
        <span class="comp-bar-val comp-bar-val-b${wB?' comp-bar-winner':''}">${m.vB}</span>
      </div>`;
    }).join('');

    return `
      <div class="comp-selectors-compact">
        ${buildCompAc('a', acItems, compA)}
        <span class="comp-vs-sm">VS</span>
        ${buildCompAc('b', acItems, compB)}
      </div>
      <div class="comp-hero">
        <div class="comp-hero-side comp-hero-a">
          <div class="comp-hero-avatar comp-hero-avatar-a">${iA}</div>
          <div class="comp-hero-name">${esc(nA)}</div>
          <div class="comp-hero-meta">${esc(aD.team_attuale||'—')} · ${esc(aD.categoria||'—')}</div>
          <div class="comp-hero-form">${formPills(sA.recent8)}</div>
        </div>
        <div class="comp-hero-center"><div class="comp-vs-text">VS</div></div>
        <div class="comp-hero-side comp-hero-b">
          <div class="comp-hero-avatar comp-hero-avatar-b">${iB}</div>
          <div class="comp-hero-name">${esc(nB)}</div>
          <div class="comp-hero-meta">${esc(bD.team_attuale||'—')} · ${esc(bD.categoria||'—')}</div>
          <div class="comp-hero-form">${formPills(sB.recent8)}</div>
        </div>
      </div>
      <div class="comp-section">
        <div class="comp-section-title">Statistiche Stagionali</div>
        <div class="comp-stats-grid">
          ${mBar(sA.pts,  sB.pts,  'PUNTI',  ' pt', true)}
          ${mBar(sA.wins, sB.wins, 'VITTORIE')}
          ${mBar(sA.podi, sB.podi, 'PODI (TOP 3)')}
          ${mBar(sA.gare, sB.gare, 'GARE')}
          ${mBar(sA.km,   sB.km,   'KM', ' km')}
          ${mBar(sA.mediaKm, sB.mediaKm, 'VELOCITÀ MEDIA', ' km/h')}
        </div>
      </div>
      <div class="comp-section">
        <div class="comp-section-title">Metriche Avanzate</div>
        <div class="comp-stats-grid">${advRows}</div>
      </div>
      ${(()=>{
        const _stA = siAthleteStory(compA, resultsRaw)||'';
        const _stB = siAthleteStory(compB, resultsRaw)||'';
        const _mA = siMomentum(compA, resultsRaw, resultsRaw.reduce((mx,r)=>(r.data||'')>mx?r.data:mx,''));
        const _mB = siMomentum(compB, resultsRaw, resultsRaw.reduce((mx,r)=>(r.data||'')>mx?r.data:mx,''));
        const _rivals = siRivalryFinder(resultsRaw).find(p=>(p.aId===compA&&p.bId===compB)||(p.aId===compB&&p.bId===compA));
        const _h2hStr = _rivals
          ? esc(nA)+' '+_rivals.aWins+'V – '+_rivals.bWins+'V '+esc(nB)+' ('+_rivals.encounters+' scontri diretti)'
          : 'Nessun incontro diretto registrato';
        return '<div class="comp-duel-banner">' +
          '<div class="comp-duel-h2h">⚔ HEAD TO HEAD · ' + _h2hStr + '</div>' +
          '<div class="comp-duel-narratives">' +
            (_stA ? '<div class="comp-duel-story comp-duel-story-a">' + _stA + '</div>' : '') +
            (_stB ? '<div class="comp-duel-story comp-duel-story-b">' + _stB + '</div>' : '') +
          '</div>' +
          '<div class="comp-duel-momentum">' +
            '<span style="color:' + _mA.color + '">' + esc(nA.split(' ')[0]) + ': ' + _mA.label + '</span>' +
            ' &nbsp;·&nbsp; ' +
            '<span style="color:' + _mB.color + '">' + esc(nB.split(' ')[0]) + ': ' + _mB.label + '</span>' +
          '</div>' +
        '</div>';
      })()}
      ${buildH2H(aRes, bRes, nA, nB)}
      ${buildRadar(sA, sB, nA, nB)}
      ${buildInsights(sA, sB, nA, nB)}`;
  };

  // ── TEAM BLOCK ────────────────────────────────────────────────
  const buildTeamResult = () => {
    const teamMap = {};
    resultsRaw.filter(r=>r.genere===compGender&&(!compCat||r.categoria===compCat))
      .forEach(r=>{ if(r.team_id) teamMap[r.team_id]={id:r.team_id,nome:r.team}; });
    const list = Object.values(teamMap).sort((a,b)=>(a.nome||'').localeCompare(b.nome||''));
    const opts = (sel) => list.map(t=>
      `<option value="${t.id}" ${t.id===sel?'selected':''}>${esc(t.nome)}</option>`
    ).join('');

    const acItemsT = list.map(t => ({ id: t.id, label: t.nome, sub: '' }));

    if (!compA||!compB||compA===compB) return `
      <div class="comp-selectors">
        <div class="comp-selector-group">
          <label class="comp-label">Team A</label>
          ${buildCompAc('a', acItemsT, compA)}
        </div>
        <div class="comp-vs-badge">VS</div>
        <div class="comp-selector-group">
          <label class="comp-label">Team B</label>
          ${buildCompAc('b', acItemsT, compB)}
        </div>
      </div>
      <div class="comp-empty-state">
        <div class="comp-empty-icon">⚔️</div>
        <div class="comp-empty-text">Seleziona due team per avviare il confronto</div>
      </div>`;

    const nA=list.find(t=>t.id===compA)?.nome||compA;
    const nB=list.find(t=>t.id===compB)?.nome||compB;
    const aRes=resultsRaw.filter(r=>r.team_id===compA&&catFilter(r));
    const bRes=resultsRaw.filter(r=>r.team_id===compB&&catFilter(r));
    const stT = arr => {
      const wins=arr.filter(r=>r.posizione===1).length, podi=arr.filter(r=>r.posizione<=3).length;
      const gare=new Set(arr.map(r=>r.gara_id)).size, pts=arr.reduce((s,r)=>s+(r.punti_effettivi||0),0);
      const km=Math.round(arr.reduce((s,r)=>s+(parseFloat(r.km)||0),0));
      const atleti=new Set(arr.map(r=>r.atleta_id)).size;
      const ptsPerRace=gare?+(pts/gare).toFixed(1):0;
      const winRate=gare?+(wins/gare*100).toFixed(1):0;
      const podiumRate=gare?+(podi/gare*100).toFixed(1):0;
      const ptsArr=arr.map(r=>r.punti_effettivi||0), mean=ptsArr.length?ptsArr.reduce((s,v)=>s+v,0)/ptsArr.length:0;
      const stdev=ptsArr.length>1?Math.sqrt(ptsArr.reduce((s,v)=>s+(v-mean)**2,0)/ptsArr.length):0;
      const cv=mean>0?stdev/mean:1, consistencyScore=Math.max(0,Math.round((1-Math.min(cv,1))*100));
      const recent5pts=[...arr].sort((a,b)=>(b.data||'').localeCompare(a.data||'')).slice(0,5).reduce((s,r)=>s+(r.punti_effettivi||0),0);
      return {pts,wins,podi,gare,km,atleti,ptsPerRace,winRate,podiumRate,consistencyScore,recent5pts};
    };
    const sA=stT(aRes), sB=stT(bRes);
    const iA=nA.split(/\s+/).map(w=>w[0]||'').join('').toUpperCase().slice(0,3);
    const iB=nB.split(/\s+/).map(w=>w[0]||'').join('').toUpperCase().slice(0,3);

    const advRows = [
      {l:'Tasso Vittorie',    vA:sA.winRate+'%',    vB:sB.winRate+'%',    nA:+sA.winRate,       nB:+sB.winRate},
      {l:'Tasso Podi',        vA:sA.podiumRate+'%', vB:sB.podiumRate+'%', nA:+sA.podiumRate,    nB:+sB.podiumRate},
      {l:'Indice Costanza',   vA:sA.consistencyScore, vB:sB.consistencyScore, nA:sA.consistencyScore, nB:sB.consistencyScore},
      {l:'Punti / Gara',      vA:sA.ptsPerRace,     vB:sB.ptsPerRace,     nA:sA.ptsPerRace,     nB:sB.ptsPerRace},
      {l:'Forma Recente (5g)',vA:sA.recent5pts+' pt',vB:sB.recent5pts+' pt',nA:sA.recent5pts,   nB:sB.recent5pts},
    ].map(m=>{
      const tot=(m.nA||0)+(m.nB||0)||1, pA=Math.round((m.nA||0)/tot*100);
      const wA=m.nA>m.nB, wB=m.nB>m.nA;
      return `<div class="comp-bar-row">
        <span class="comp-bar-val comp-bar-val-a${wA?' comp-bar-winner':''}">${m.vA}</span>
        <div class="comp-bar-center"><div class="comp-bar-label">${m.l}</div>
          <div class="comp-bar-track"><div class="comp-bar-fill-a" style="width:${pA}%"></div><div class="comp-bar-fill-b" style="width:${100-pA}%"></div></div>
        </div>
        <span class="comp-bar-val comp-bar-val-b${wB?' comp-bar-winner':''}">${m.vB}</span>
      </div>`;
    }).join('');

    return `
      <div class="comp-selectors-compact">
        ${buildCompAc('a', acItemsT, compA)}
        <span class="comp-vs-sm">VS</span>
        ${buildCompAc('b', acItemsT, compB)}
      </div>
      <div class="comp-hero">
        <div class="comp-hero-side comp-hero-a">
          <div class="comp-hero-avatar comp-hero-avatar-a" style="border-radius:8px;font-size:1.1rem">${iA}</div>
          <div class="comp-hero-name">${esc(nA)}</div>
          <div class="comp-hero-meta">${sA.atleti} atleti · ${sA.gare} gare</div>
        </div>
        <div class="comp-hero-center"><div class="comp-vs-text">VS</div></div>
        <div class="comp-hero-side comp-hero-b">
          <div class="comp-hero-avatar comp-hero-avatar-b" style="border-radius:8px;font-size:1.1rem">${iB}</div>
          <div class="comp-hero-name">${esc(nB)}</div>
          <div class="comp-hero-meta">${sB.atleti} atleti · ${sB.gare} gare</div>
        </div>
      </div>
      <div class="comp-section">
        <div class="comp-section-title">Statistiche Team</div>
        <div class="comp-stats-grid">
          ${mBar(sA.pts,    sB.pts,    'PUNTI',              ' pt', true)}
          ${mBar(sA.wins,   sB.wins,   'VITTORIE')}
          ${mBar(sA.podi,   sB.podi,   'PODI')}
          ${mBar(sA.gare,   sB.gare,   'GARE')}
          ${mBar(sA.km,     sB.km,     'KM',                 ' km')}
          ${mBar(sA.atleti, sB.atleti, 'ATLETI SCHIERATI')}
        </div>
      </div>
      <div class="comp-section">
        <div class="comp-section-title">Metriche Avanzate</div>
        <div class="comp-stats-grid">${advRows}</div>
      </div>`;
  };

  setPage(`
    <div class="pg-header">
      <div class="pg-eyebrow">⚡ CONFRONTO ATLETI & TEAM</div>
      <h1 class="pg-title">COMPARATORE</h1>
    </div>
    <p style="color:var(--text-muted);margin-bottom:24px">Confronta atleti o team della stessa categoria e genere</p>
    <div class="comp-filter-bar">
      <div class="comp-mode-tabs">
        <button class="comp-tab ${compMode==='atleta'?'comp-tab-active-a':''}" onclick="window.setCompMode('atleta')">Atleti</button>
        <button class="comp-tab ${compMode==='team'?'comp-tab-active-b':''}" onclick="window.setCompMode('team')">Team</button>
      </div>
      <div style="flex:1;min-width:120px">
        <label class="comp-label">Genere</label>
        <select class="cal-filter-select" style="width:100%" onchange="window.setCompGender(this.value)">
          <option value="M" ${compGender==='M'?'selected':''}>♂ Uomini</option>
          <option value="F" ${compGender==='F'?'selected':''}>♀ Donne</option>
        </select>
      </div>
      <div style="flex:2;min-width:160px">
        <label class="comp-label">Categoria</label>
        <select class="cal-filter-select" style="width:100%" onchange="window.setCompCat(this.value)">
          <option value="">— Tutte —</option>${catOpts}
        </select>
      </div>
    </div>
    <div id="comp-content">${compMode==='atleta'?buildAthleteResult():buildTeamResult()}</div>
  `);

  window.setCompMode   = v => { compMode=v; compA=''; compB=''; renderComparatore(); };
  window.setCompGender = v => { compGender=v; compA=''; compB=''; renderComparatore(); };
  window.setCompCat    = v => { compCat=v; compA=''; compB=''; renderComparatore(); };
  window.setCompA      = v => { compA=v; renderComparatore(); };
  window.setCompB      = v => { compB=v; renderComparatore(); };
}

function renderRegolamento() {
  setPage(`
    <div class="pg-header">
      <div class="pg-eyebrow">Italiacrit · Sistema di Punteggio</div>
      <h1 class="pg-title">Regolamento</h1>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;margin-bottom:40px;">
      <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--r-lg);padding:28px;border-top:3px solid #E11D48;">
        <div style="font-size:0.58rem;font-weight:800;letter-spacing:0.2em;color:#E11D48;text-transform:uppercase;margin-bottom:16px;">Punteggio Base</div>
        <p style="color:var(--text-secondary);font-size:0.875rem;margin-bottom:20px;line-height:1.6">Posizioni di arrivo Top 10 nelle gare su strada.</p>
        <table class="ranking-table" style="width:100%">
          <thead><tr><th>POS</th><th>PUNTI</th></tr></thead>
          <tbody>
            <tr><td>1°</td><td><strong>15</strong></td></tr>
            <tr><td>2°</td><td>12</td></tr>
            <tr><td>3°</td><td>10</td></tr>
            <tr><td>4°</td><td>8</td></tr>
            <tr><td>5°</td><td>6</td></tr>
            <tr><td>6°</td><td>5</td></tr>
            <tr><td>7°</td><td>4</td></tr>
            <tr><td>8°</td><td>3</td></tr>
            <tr><td>9°</td><td>2</td></tr>
            <tr><td>10°</td><td>1</td></tr>
          </tbody>
        </table>
      </div>

      <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--r-lg);padding:28px;border-top:3px solid #E11D48;">
        <div style="font-size:0.58rem;font-weight:800;letter-spacing:0.2em;color:#E11D48;text-transform:uppercase;margin-bottom:16px;">Moltiplicatori Gara</div>
        <p style="color:var(--text-secondary);font-size:0.875rem;margin-bottom:20px;line-height:1.6">Il punteggio base viene moltiplicato in base al livello della competizione.</p>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div style="display:flex;align-items:center;gap:16px;padding:14px 16px;background:var(--bg-elevated);border-radius:var(--r-md);">
            <span style="font-family:'Inter Tight',sans-serif;font-size:1.6rem;font-weight:900;color:var(--text-muted);">×1</span>
            <div><div style="font-weight:700;font-size:0.875rem;color:var(--text-primary)">Regionale</div><div style="font-size:0.78rem;color:var(--text-secondary)">Gare di livello regionale standard</div></div>
          </div>
          <div style="display:flex;align-items:center;gap:16px;padding:14px 16px;background:var(--bg-elevated);border-radius:var(--r-md);">
            <span style="font-family:'Inter Tight',sans-serif;font-size:1.6rem;font-weight:900;color:var(--text-secondary);">×2</span>
            <div><div style="font-weight:700;font-size:0.875rem;color:var(--text-primary)">Nazionale</div><div style="font-size:0.78rem;color:var(--text-secondary)">Gare nazionali e Campionati Regionali</div></div>
          </div>
          <div style="display:flex;align-items:center;gap:16px;padding:14px 16px;background:var(--bg-elevated);border-radius:var(--r-md);">
            <span style="font-family:'Inter Tight',sans-serif;font-size:1.6rem;font-weight:900;color:#E11D48;">×3</span>
            <div><div style="font-weight:700;font-size:0.875rem;color:var(--text-primary)">Internazionale</div><div style="font-size:0.78rem;color:var(--text-secondary)">Calendario internazionale e Campionati Italiani</div></div>
          </div>
        </div>
      </div>

      <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--r-lg);padding:28px;border-top:3px solid #E11D48;">
        <div style="font-size:0.58rem;font-weight:800;letter-spacing:0.2em;color:#E11D48;text-transform:uppercase;margin-bottom:16px;">Classifiche Speciali</div>
        <p style="color:var(--text-secondary);font-size:0.875rem;margin-bottom:20px;line-height:1.6">Ranking aggiuntivi calcolati su sottoinsiemi di gare.</p>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div style="padding:14px 16px;background:var(--bg-elevated);border-radius:var(--r-md);">
            <div style="font-weight:700;font-size:0.875rem;color:var(--text-primary);margin-bottom:4px;">Ranking Regionale</div>
            <div style="font-size:0.8rem;color:var(--text-secondary);line-height:1.5">Punteggi ottenuti esclusivamente in gare svolte nella stessa regione.</div>
          </div>
          <div style="padding:14px 16px;background:var(--bg-elevated);border-radius:var(--r-md);">
            <div style="font-weight:700;font-size:0.875rem;color:var(--text-primary);margin-bottom:4px;">Ranking Mensile</div>
            <div style="font-size:0.8rem;color:var(--text-secondary);line-height:1.5">Punteggi ottenuti in un singolo mese solare.</div>
          </div>
        </div>
      </div>
    </div>

    <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--r-lg);padding:24px;border-left:3px solid var(--border-subtle);">
      <div style="font-size:0.58rem;font-weight:800;letter-spacing:0.2em;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px;">Nota</div>
      <p style="color:var(--text-secondary);font-size:0.875rem;line-height:1.6;margin:0">
        Il sistema di punteggio di <strong style="color:var(--text-primary)">Italiacrit</strong> è progettato per valorizzare la costanza e la qualità delle prestazioni sulle gare su strada. I dati sono elaborati a partire dai risultati ufficiali FCI. Progetto indipendente, non affiliato alla Federazione Ciclistica Italiana.
      </p>
    </div>
  `);
}

// ── NOT FOUND ─────────────────────────────────────────────────
function renderNotFound() {
  setPage(`
    <div class="not-found">
      <h2>404</h2>
      <p>Pagina non trovata — <a href="#/" style="color:var(--red-hot)">Torna alla home</a></p>
    </div>
  `);
}

// ── SEARCH GLOBALE ────────────────────────────────────────────
window.closeAllSearchDropdowns = () => {
  ['search-results-dropdown','drawer-search-dropdown'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
};

function bindSearch(inputId, dropdownId) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  if (!input || !dropdown) return;
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => doSearch(input.value, dropdown), 250);
  });
  input.addEventListener('blur', () => {
    setTimeout(() => { dropdown.style.display = 'none'; }, 200);
  });
}

function initSearch() {
  bindSearch('nav-search', 'search-results-dropdown');
  bindSearch('drawer-search', 'drawer-search-dropdown');
}

function doSearch(q, dropdown) {
  if (!dropdown) dropdown = document.getElementById('search-results-dropdown');
  if (!q.trim() || !globalData) {
    dropdown.style.display = 'none';
    return;
  }

  const { athletes, teams } = globalData;
  const ql = q.toLowerCase();
  const results = [];

  // Cerca atleti
  for (const [id, a] of Object.entries(athletes)) {
    const name = `${a.cognome||''} ${a.nome||''}`.toLowerCase();
    if (name.includes(ql)) {
      results.push({ type: 'atleta', id, display: `${a.cognome} ${a.nome}`, sub: a.team_attuale||'' });
    }
    if (results.length >= 5) break;
  }

  // Cerca team
  for (const [id, t] of Object.entries(teams)) {
    if ((t.nome||'').toLowerCase().includes(ql)) {
      results.push({ type: 'team', id, display: t.nome, sub: `${t.atleti?.length||0} atleti` });
    }
    if (results.length >= 8) break;
  }

  if (!results.length) {
    dropdown.innerHTML = '<div class="search-result-item"><span class="search-result-sub">Nessun risultato</span></div>';
    dropdown.style.display = 'block';
    return;
  }

  dropdown.innerHTML = results.map(r => `
    <div class="search-result-item" onclick="goTo('#/${r.type}/${r.id}'); window.closeAllSearchDropdowns()">
      <div>
        <div class="search-result-label">${r.type === 'atleta' ? 'ATLETA' : 'TEAM'}</div>
        <div class="search-result-name">${esc(r.display)}</div>
        <div class="search-result-sub">${esc(r.sub)}</div>
      </div>
    </div>`).join('');
  dropdown.style.display = 'block';
}

window.goTo = (hash) => { window.location.hash = hash; };

// Rimuove il suffisso categoria (_AL_M, _ES1_F…) per ottenere il calendario ID
function toCalId(garaId) {
  return (garaId || '').replace(/_[A-Z0-9]+_[MF]$/, '');
}

// Modal player YouTube
window.openVideoModal = (videoId, title) => {
  const overlay = document.createElement('div');
  overlay.className = 'video-modal-overlay';
  overlay.innerHTML = `
    <div class="video-modal-box">
      <button class="video-modal-close" onclick="this.closest('.video-modal-overlay').remove()">✕</button>
      <div class="video-modal-title">${esc(title)}</div>
      <div class="video-modal-player">
        <iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0"
                frameborder="0" allowfullscreen
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture">
        </iframe>
      </div>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};

// ── MOBILE MENU ───────────────────────────────────────────────
function initMobileMenu() {
  const hamburger = document.getElementById('nav-hamburger');
  const drawer    = document.getElementById('nav-drawer');
  if (!hamburger || !drawer) return;

  hamburger.addEventListener('click', () => {
    const isOpen = drawer.classList.toggle('open');
    hamburger.setAttribute('aria-expanded', isOpen);
  });

  // Chiudi drawer al click su link
  drawer.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      drawer.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
    });
  });
}

// ── CONSTANTS ─────────────────────────────────────────────────
// Spostato in alto

// ── RISULTATI FEED ──────────────────────────────────────────
let risQueryGenere = '';
let risQueryCat = '';
let risQueryMonth = '';
let risQueryRegion = '';
let risSearchQuery = '';
let _risSearchTimer = null;

window.risSetGenere = (v) => { risQueryGenere = v; renderRisultati(); };
window.risSetCat    = (v) => { risQueryCat = v; renderRisultati(); };
window.risSetMonth  = (v) => { risQueryMonth = v; renderRisultati(); };
window.risSetRegion = (v) => { risQueryRegion = v; renderRisultati(); };
window.risSetSearch = (v) => { 
  clearTimeout(_risSearchTimer); 
  _risSearchTimer = setTimeout(() => { risSearchQuery = v; renderRisultati(); }, 300);
};

let _risPhotosMap = null;
async function loadRisPhotos() {
  if (_risPhotosMap) return _risPhotosMap;
  try {
    const d = await fetch(`${API_BASE}/race-photos`).then(r => r.json()).catch(() => ({photos:[]}));
    _risPhotosMap = {};
    (d.photos || []).forEach(p => { if (!_risPhotosMap[p.gara_id]) _risPhotosMap[p.gara_id] = p; });
  } catch { _risPhotosMap = {}; }
  return _risPhotosMap;
}

async function renderRisultati() {
  if (!globalData) return;
  const { resultsRaw, calendar } = globalData;
  const photosMap = await loadRisPhotos();
  
  // Raggruppa per EVENTO: (nome_gara normalizzato, data, genere)
  // Questo evita che la stessa gara con categorie diverse appaia come doppia
  const eventMap = {};
  for (const r of resultsRaw) {
    const eventKey = r.nome_gara.trim().toUpperCase() + '|' + r.data + '|' + (r.genere||'M');
    if (!eventMap[eventKey]) {
      eventMap[eventKey] = {
        id: r.gara_id,          // gara_id del primo risultato (per link gara)
        nome: r.nome_gara,
        data: r.data,
        genere: r.genere,
        tipo: r.tipo,
        regione: r.regione,
        byCategory: {}          // risultati raggruppati per categoria
      };
    }
    const cat = r.categoria || 'N/D';
    if (!eventMap[eventKey].byCategory[cat]) {
      eventMap[eventKey].byCategory[cat] = { gara_id: r.gara_id, results: [] };
    }
    eventMap[eventKey].byCategory[cat].results.push(r);
  }

  for (const ev of Object.values(eventMap)) {
    const firstCat = Object.values(ev.byCategory)[0];
    const firstRes = firstCat ? firstCat.results[0] : null;
    ev.mult = firstRes?.moltiplicatore || 1;
    ev.tipo = firstRes?.tipo || 'regionale';
    ev.campionato_regionale = firstRes?.campionato_regionale || false;
    ev.campionato_italiano = firstRes?.campionato_italiano || false;
  }

  let races = Object.values(eventMap).sort((a,b) => (b.data||'').localeCompare(a.data||''));
  
  // Extract all regions, filtering out category false positives
  const badRegions = ['JUNIORES', 'ALLIEVE', 'ESORDIENTI', 'UNDER', 'ELITE', 'DONNE', 'UOMINI', 'ITALIA', 'PROVA', 'CAMPIONATO'];
  const allRegions = [...new Set(races.map(r => r.regione).filter(Boolean))].filter(r => !badRegions.includes(r.toUpperCase())).sort();

  // Apply filters
  if (risSearchQuery) {
    const q = risSearchQuery.toLowerCase();
    races = races.filter(r => r.nome.toLowerCase().includes(q) || (r.regione || '').toLowerCase().includes(q));
  }
  if (risQueryGenere) races = races.filter(r => r.genere === risQueryGenere);
  if (activeHub && activeHub.catFilter) {
    const cf = activeHub.catFilter.toLowerCase();
    races = races.filter(function(ev) {
      return Object.keys(ev.byCategory || {}).some(function(c) {
        return c.toLowerCase().includes(cf);
      });
    });
  }
  if (risQueryMonth)  races = races.filter(r => r.data && r.data.split('-')[1] === risQueryMonth);
  if (risQueryRegion) races = races.filter(r => r.regione === risQueryRegion);
  const allCatsSet = new Set();
  races.forEach(r => Object.keys(r.byCategory||{}).forEach(c => allCatsSet.add(c)));
  const allCats = [...allCatsSet].sort();
  if (risQueryCat) races = races.filter(r => r.byCategory && r.byCategory[risQueryCat]);

  // ── First render: build the persistent shell ──────────────────
  const appEl = document.getElementById('app');
  if (!appEl) return;
  const isFirstRender = !document.getElementById('ris-cards');
  if (isFirstRender) {
    const selectsHtml = `
      <select class="cal-filter-select" id="ris-sel-month" onchange="window.risSetMonth(this.value)" aria-label="Filtra per mese">
        <option value="">Tutti i mesi</option>
        ${['01','02','03','04','05','06','07','08','09','10','11','12'].map((m,i) =>
          `<option value="${m}">${['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'][i]}</option>`
        ).join('')}
      </select>
      <select class="cal-filter-select" id="ris-sel-genere" onchange="window.risSetGenere(this.value)" aria-label="Filtra per genere">
        <option value="">Tutti i generi</option>
        <option value="M">Uomini</option>
        <option value="F">Donne</option>
      </select>
      <select class="cal-filter-select" id="ris-sel-region" onchange="window.risSetRegion(this.value)" aria-label="Filtra per regione">
        <option value="">Tutte le regioni</option>
        ${allRegions.map(r => `<option value="${r}">${esc(r)}</option>`).join('')}
      </select>
      <select class="cal-filter-select" id="ris-sel-cat" onchange="window.risSetCat(this.value)" aria-label="Filtra per categoria">
        <option value="">Tutte le categorie</option>
      </select>`;

    setPage(`
      <div class="content-wrapper">
        <div class="section-header">
          <h1 style="font-family:var(--font-display);font-size:var(--size-h1);margin-bottom:0">Risultati</h1>
          <span class="section-line"></span>
        </div>
        <div class="calendar-controls">
          <input type="text" id="ris-search-input" class="cal-filter-select" placeholder="Cerca gara o regione..."
            style="width:100%;box-sizing:border-box;padding:12px 16px;margin-bottom:12px;"
            oninput="window.risSetSearch(this.value)" autocomplete="off">
          <div id="ris-selects">${selectsHtml}</div>
          <span class="ranking-count" id="ris-count"></span>
        </div>
        <div class="risultati-feed" style="margin-top:20px" id="ris-cards"></div>
      </div>
    `);
  }

  // ── Always: update selects state ──────────────────────────────
  const selMonth  = document.getElementById('ris-sel-month');
  const selGenere = document.getElementById('ris-sel-genere');
  const selRegion = document.getElementById('ris-sel-region');
  const selCat    = document.getElementById('ris-sel-cat');
  const countEl   = document.getElementById('ris-count');
  const cardsEl   = document.getElementById('ris-cards');

  if (selMonth)  selMonth.value  = risQueryMonth  || '';
  if (selGenere) selGenere.value = risQueryGenere || '';
  if (selRegion) {
    // Rebuild region options (they can change with filters)
    selRegion.innerHTML = `<option value="">Tutte le regioni</option>` +
      allRegions.map(r => `<option value="${r}"${r === risQueryRegion ? ' selected' : ''}>${esc(r)}</option>`).join('');
  }
  if (selCat) {
    selCat.innerHTML = `<option value="">Tutte le categorie</option>` +
      allCats.map(c => `<option value="${c}"${c === risQueryCat ? ' selected' : ''}>${catLabel(c)}</option>`).join('');
  }
  if (countEl) countEl.textContent = `${races.length} gare trovate`;

  // Always: rebuild only the cards area
  if (cardsEl) {
    cardsEl.innerHTML = races.map(race => {
      const mult = race.mult || 1;
      const categories = Object.entries(race.byCategory || {});

      // Una sezione per ogni categoria dell'evento
      // Foto featured a livello card (prima categoria che ha una foto)
      const featuredPhoto = Object.values(race.byCategory || {})
        .map(c => photosMap[c.gara_id]).find(Boolean);

      // Video: usa la mappa gara_id → calendar_id
      const raceCalId = (globalData.garaToCalId || {})[race.id] || toCalId(race.id);
      const raceVideos = (globalData.videos || {})[raceCalId] ||
                         (globalData.videos || {})[race.id] || [];
      const featuredVideo = raceVideos[0] || null;
      const featuredVideoId = featuredVideo
        ? (featuredVideo.url.match(/[?&]v=([^&]+)/) || [])[1] || null
        : null;

      const catSections = categories.map(([catName, catData]) => {
        const top3 = (catData.results || []).sort((a,b) => a.posizione - b.posizione).slice(0,3);
        const catGaraId = catData.gara_id;
        const cLabel = catLabel(catName) || catName;

        const firstRes = catData.results?.[0];
        const kmVal    = firstRes?.km    || '';
        const mediaVal = firstRes?.media || '';
        const techBit  = (kmVal || mediaVal)
          ? ' &nbsp;|&nbsp; ' +
            (kmVal ? '&#128205; ' + esc(kmVal) + ' km' : '') +
            (kmVal && mediaVal ? ' &nbsp;|&nbsp; ' : '') +
            (mediaVal ? '&#9889; ' + esc(mediaVal) + ' km/h' : '')
          : '';

        const podioRows = top3.map((r,i) => {
          const pClass = ['p1','p2','p3'][i] || 'pout';
          return '<div class="hero-podio-row" style="animation-delay:' + (i*60) + 'ms;grid-template-columns:32px 1fr;">' +
            '<div class="hero-pos ' + pClass + '" style="font-size:0.95rem">' + r.posizione + '&#176;</div>' +
            '<div>' +
              '<div class="hero-name"><a href="#/atleta/' + esc(r.atleta_id) + '">' + esc(r.cognome) + ' ' + esc(r.nome) + '</a></div>' +
              '<div class="hero-team"><a href="#/team/' + esc(r.team_id) + '" style="color:var(--text-secondary)">' + esc(r.team) + '</a></div>' +
            '</div>' +
          '</div>';
        }).join('');

        return `
          <div style="margin-bottom:16px;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;flex-wrap:wrap;">
              ${categories.length > 1 ? '<span style="font-size:0.65rem;font-family:var(--font-mono);color:var(--accent);text-transform:uppercase;letter-spacing:1px;">' + cLabel + '</span>' : ''}
              <span style="font-size:0.75rem;color:var(--text-muted);font-family:var(--font-mono)">${techBit}</span>
            </div>
            ${podioRows}
            <div style="padding-top:10px;margin-top:10px;border-top:1px solid var(--border-subtle);">
              <a href="#/gara/${esc(catGaraId)}" class="btn-action full" style="font-size:0.75rem;text-align:center;">VAI ALLA CLASSIFICA COMPLETA &rarr;</a>
            </div>
          </div>`;
      }).join(categories.length > 1 ? '<div style="border-top:2px solid var(--border-subtle);margin:16px 0;"></div>' : '');

      const photoEl = featuredPhoto
        ? `<a href="#/gara/${esc(race.id)}" class="ris-card-photo${featuredVideoId ? ' ris-media-half' : ''}">
             <img src="${PHOTOS_BASE}/photos/${esc(featuredPhoto.filename)}" alt="Foto gara" loading="lazy"/>
           </a>`
        : '';
      const videoEl = featuredVideoId
        ? `<div class="ris-card-video-thumb${featuredPhoto ? ' ris-media-half' : ''}"
               onclick="window.openVideoModal('${featuredVideoId}','${esc((featuredVideo.title||'').replace(/'/g,"\\'"))}')">
             <img src="https://img.youtube.com/vi/${featuredVideoId}/hqdefault.jpg"
                  alt="${esc(featuredVideo.title)}" loading="lazy"/>
             <div class="ris-video-play"><span>▶</span></div>
             <div class="ris-video-channel">${esc(featuredVideo.channel)}</div>
           </div>`
        : '';
      const mediaPanel = (photoEl || videoEl)
        ? `<div class="ris-card-media${featuredPhoto && featuredVideoId ? ' ris-card-media-split' : ''}">${photoEl}${videoEl}</div>`
        : '';

      return `
        <div class="hero-band ris-card">
          ${mediaPanel}
          <div class="ris-card-body">
            <div class="hero-label" style="font-size:0.6rem">RISULTATI GARA</div>
            <div class="hero-race-name"><a href="#/gara/${esc(race.id)}">${esc(race.nome)}</a></div>
            ${(()=>{ const _rn=siRaceNarrative(race.id,resultsRaw); return _rn?'<div class="ris-race-narrative">'+_rn+'</div>':''; })()}
            <div class="hero-race-meta" style="margin-bottom:16px;">
              <span>${fmtDate(race.data)}</span>
              ${badgeMult(race.mult, race.tipo, race.campionato_regionale, race.campionato_italiano)}
            </div>
            <div class="hero-divider" style="margin-bottom:12px;"></div>
            <div class="hero-podio">${catSections}</div>
          </div>
        </div>`;
    }).join('') || '<div class="empty-state">Nessuna gara trovata</div>';
  }
}

// ── SHARE ENGINE v3 ─────────────────────────────────────
window._shareGaraData=null; window._shareAtletaData=null; window._shareTeamData=null;

// SHARE ENGINE v3
const SHARE_PLATFORMS = {
  instagram: { w:1080, h:1350, label:'Instagram\nFeed', color:'#E1306C', cls:'plat-instagram' },
  story:     { w:1080, h:1920, label:'Story /\nReels', color:'#833AB4', cls:'plat-story' },
  facebook:  { w:1200, h:630,  label:'Facebook', color:'#1877F2', cls:'plat-facebook' },
  twitter:   { w:1200, h:675,  label:'Twitter/X', color:'#1DA1F2', cls:'plat-twitter' },
  whatsapp:  { w:1080, h:1080, label:'WhatsApp', color:'#25D366', cls:'plat-whatsapp' }
};
const SHARE_URL = 'italiacrit.it';
const SHARE_TAG = '#italiacrit #ciclismo';
window._shareGaraData = null; window._shareAtletaData = null; window._shareTeamData = null;
let _shareType, _sharePayload, _sharePlatKey = 'instagram';
let _shareLogoImg = null;

async function _getLogo() {
  if (_shareLogoImg) return _shareLogoImg;
  return new Promise(res => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { _shareLogoImg = img; res(img); };
    img.onerror = () => res(null);
    img.src = 'assets/logo.jpeg';
  });
}
function _bg(ctx, W, H) {
  const g = ctx.createLinearGradient(0,0,W,H);
  g.addColorStop(0,'#0f0f13'); g.addColorStop(1,'#1a1a22');
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  ctx.save(); ctx.globalAlpha=0.025; ctx.strokeStyle='#fff'; ctx.lineWidth=1;
  for(let i=-H;i<W+H;i+=14){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i+H,H);ctx.stroke();}
  ctx.restore();
}
function _header(ctx, logo, W, H) {
  const bH = Math.round(H*0.09);
  const g = ctx.createLinearGradient(0,0,W,0);
  g.addColorStop(0,'#e8001d'); g.addColorStop(1,'#9b0013');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,bH);
  if (logo) {
    const lH=Math.round(bH*0.72), lW=Math.round(lH*logo.naturalWidth/logo.naturalHeight);
    ctx.drawImage(logo,16,Math.round((bH-lH)/2),lW,lH);
  }
  const fs=Math.round(bH*0.3);
  ctx.font=`700 ${fs}px 'Barlow Condensed',sans-serif`;
  ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.textAlign='right';
  ctx.fillText('ITALIACRIT',W-16,Math.round(bH*0.6));
  ctx.font=`400 ${Math.round(fs*0.52)}px 'Barlow Condensed',sans-serif`;
  ctx.fillStyle='rgba(255,255,255,0.45)';
  ctx.fillText(SHARE_URL,W-16,Math.round(bH*0.87));
  ctx.textAlign='left';
}
function _footer(ctx, W, H) {
  const fH=Math.round(H*0.06); const y=H-fH;
  ctx.fillStyle='rgba(0,0,0,0.75)'; ctx.fillRect(0,y,W,fH);
  const s=3; ctx.fillStyle='#009246'; ctx.fillRect(0,y,W/3,s);
  ctx.fillStyle='#fff'; ctx.fillRect(W/3,y,W/3,s);
  ctx.fillStyle='#ce2b37'; ctx.fillRect(2*W/3,y,W/3,s);
  ctx.font=`500 ${Math.round(fH*0.32)}px 'Barlow Condensed',sans-serif`;
  ctx.fillStyle='rgba(255,255,255,0.38)'; ctx.textAlign='center';
  ctx.fillText(SHARE_TAG,W/2,y+Math.round(fH*0.66));
  ctx.textAlign='left';
}
function _wrap(ctx, txt, x, y, maxW, lH) {
  const words=txt.split(' '); let line='';
  for(const w of words){
    const t=line?line+' '+w:w;
    if(ctx.measureText(t).width>maxW&&line){ctx.fillText(line,x,y);y+=lH;line=w;}
    else line=t;
  }
  if(line) ctx.fillText(line,x,y);
  return y+lH;
}

// ── GARA CARD (top 10 + team) ──────────────────────────────
function _drawGara(ctx, W, H, d) {
  const { name, date, cat, mult, tipo, results } = d;
  const hB=Math.round(H*0.09), fB=Math.round(H*0.06), pad=Math.round(W*0.048);
  let y = hB + Math.round(H*0.04);

  // Nome gara
  const fsT = Math.round(W*(name.length>35?0.034:name.length>20?0.042:0.052));
  ctx.font=`900 ${fsT}px 'Bebas Neue',Impact,sans-serif`; ctx.fillStyle='#f0f0f0';
  y = _wrap(ctx, name.toUpperCase(), pad, y+fsT, W-pad*2, fsT*1.08);

  // Meta: data · cat · moltiplicatore
  const fsM=Math.round(W*0.024);
  ctx.font=`600 ${fsM}px 'Barlow Condensed',sans-serif`; ctx.fillStyle='#e8001d';
  ctx.fillText(`${date}  ·  ${cat}  ·  ×${mult}  ·  ${tipo}`, pad, y);
  y += fsM*1.5;
  ctx.fillStyle='rgba(232,0,29,0.25)'; ctx.fillRect(pad,y,W-pad*2,1); y+=8;

  // Top 10 rows
  const listH = H - fB - y - 4;
  const maxR = Math.min(results.length, 10);
  const rH = Math.round(listH / maxR);
  const posCol=['#f5c400','#b0b0b0','#cd7f32'];
  const fsPos=Math.round(rH*0.52), fsName=Math.round(rH*0.33), fsTeam=Math.round(rH*0.23), fsPts=Math.round(rH*0.42);

  results.slice(0, maxR).forEach((r, i) => {
    const ry = y + i*rH;
    // BG alternato
    if (i%2===0){ctx.fillStyle='rgba(255,255,255,0.022)';ctx.fillRect(pad,ry,W-pad*2,rH);}
    // BG speciale top 3
    if (i<3){ctx.fillStyle=`rgba(${i===0?'245,196,0':i===1?'176,176,176':'205,127,50'},0.06)`;ctx.fillRect(pad,ry,W-pad*2,rH);}
    // Posizione
    ctx.font=`900 ${fsPos}px 'Bebas Neue',Impact,sans-serif`;
    ctx.fillStyle=i<3?posCol[i]:'rgba(255,255,255,0.25)';
    ctx.fillText(i+1, pad+4, ry+rH*0.7);
    const posW=ctx.measureText('00').width+10;
    // Nome atleta
    ctx.font=`700 ${fsName}px 'Barlow Condensed',sans-serif`; ctx.fillStyle='#f0f0f0';
    ctx.fillText((`${r.cognome||''} ${r.nome||''}`).toUpperCase().substring(0,28), pad+posW, ry+rH*0.44);
    // Team
    ctx.font=`400 ${fsTeam}px 'Barlow Condensed',sans-serif`; ctx.fillStyle='#666';
    ctx.fillText((r.team||'').substring(0,32), pad+posW, ry+rH*0.76);
    // Punti
    ctx.font=`900 ${fsPts}px 'Bebas Neue',Impact,sans-serif`; ctx.fillStyle='#f5c400'; ctx.textAlign='right';
    ctx.fillText(`${r.punti_effettivi||0}pt`, W-pad, ry+rH*0.66);
    ctx.textAlign='left';
  });
}

// ── ATLETA CARD ────────────────────────────────────────────
function _drawAtleta(ctx, W, H, d) {
  const {cognome,nome,cat,team,punti,pos,p1,p2,p3,gare} = d;
  const hB=Math.round(H*0.09),fB=Math.round(H*0.06),pad=Math.round(W*0.048);
  let y = hB + Math.round(H*0.05);
  // Cognome
  const fsC=Math.round(W*(cognome.length>12?0.065:0.085));
  ctx.font=`900 ${fsC}px 'Bebas Neue',Impact,sans-serif`; ctx.fillStyle='#f0f0f0';
  y=_wrap(ctx,cognome.toUpperCase(),pad,y+fsC,W-pad*2,fsC*1.05);
  // Nome
  const fsN=Math.round(fsC*0.44);
  ctx.font=`600 ${fsN}px 'Barlow Condensed',sans-serif`; ctx.fillStyle='#e8001d';
  ctx.fillText(nome.toUpperCase(),pad,y); y+=fsN*1.4;
  // Cat + Team
  const fsI=Math.round(W*0.024);
  ctx.font=`600 ${fsI}px 'Barlow Condensed',sans-serif`; ctx.fillStyle='#777';
  ctx.fillText(cat,pad,y); y+=fsI*1.3;
  ctx.font=`400 ${fsI}px 'Barlow Condensed',sans-serif`; ctx.fillStyle='#555';
  ctx.fillText(team.substring(0,40),pad,y); y+=fsI*1.8;
  // Separatore
  ctx.fillStyle='rgba(232,0,29,0.25)'; ctx.fillRect(pad,y,W-pad*2,1); y+=Math.round(H*0.035);
  // Punti + Pos
  const fsP=Math.round(W*0.11);
  const g=ctx.createLinearGradient(pad,y,pad+fsP*3,y);
  g.addColorStop(0,'#e8001d'); g.addColorStop(1,'#f5c400');
  ctx.font=`900 ${fsP}px 'Bebas Neue',Impact,sans-serif`; ctx.fillStyle=g;
  ctx.fillText(punti,pad,y+fsP);
  const fsL=Math.round(W*0.019);
  ctx.font=`600 ${fsL}px 'Barlow Condensed',sans-serif`; ctx.fillStyle='rgba(255,255,255,0.38)';
  ctx.fillText('PUNTI STAGIONE',pad,y+fsP+fsL*1.4);
  if (pos&&pos!=='-') {
    ctx.font=`900 ${fsP}px 'Bebas Neue',Impact,sans-serif`; ctx.fillStyle='#f5c400'; ctx.textAlign='right';
    ctx.fillText(`${pos}°`,W-pad,y+fsP);
    ctx.font=`600 ${fsL}px 'Barlow Condensed',sans-serif`; ctx.fillStyle='rgba(255,255,255,0.38)';
    ctx.fillText('IN CLASSIFICA',W-pad,y+fsP+fsL*1.4); ctx.textAlign='left';
  }
  // Stat bar
  const stH=Math.round(H*0.12),stY=H-fB-stH-Math.round(H*0.01);
  ctx.fillStyle='rgba(255,255,255,0.04)'; ctx.fillRect(pad,stY,W-pad*2,stH);
  [['1°','#f5c400',p1],['2°','#b0b0b0',p2],['3°','#cd7f32',p3],['GARE','#f0f0f0',gare]].forEach(([l,c,v],i)=>{
    const sw=(W-pad*2)/4, sx=pad+i*sw+sw/2;
    ctx.font=`900 ${Math.round(stH*0.48)}px 'Bebas Neue',Impact,sans-serif`; ctx.fillStyle=c; ctx.textAlign='center';
    ctx.fillText(v,sx,stY+Math.round(stH*0.58));
    ctx.font=`600 ${Math.round(stH*0.2)}px 'Barlow Condensed',sans-serif`; ctx.fillStyle='rgba(255,255,255,0.35)';
    ctx.fillText(l,sx,stY+Math.round(stH*0.83));
  }); ctx.textAlign='left';
}

// ── TEAM CARD ──────────────────────────────────────────────
function _drawTeam(ctx, W, H, d) {
  const {nome,cat,punti,pos,atleti} = d;
  const hB=Math.round(H*0.09),fB=Math.round(H*0.06),pad=Math.round(W*0.048);
  let y=hB+Math.round(H*0.04);
  const fsN=Math.round(W*(nome.length>20?0.05:0.065));
  ctx.font=`900 ${fsN}px 'Bebas Neue',Impact,sans-serif`; ctx.fillStyle='#f0f0f0';
  y=_wrap(ctx,nome.toUpperCase(),pad,y+fsN,W-pad*2,fsN*1.08);
  ctx.font=`600 ${Math.round(W*0.026)}px 'Barlow Condensed',sans-serif`; ctx.fillStyle='#e8001d';
  ctx.fillText(cat,pad,y); y+=Math.round(W*0.026)*1.5;
  ctx.fillStyle='rgba(232,0,29,0.25)'; ctx.fillRect(pad,y,W-pad*2,1); y+=Math.round(H*0.03);
  const fsP=Math.round(W*0.1);
  const g=ctx.createLinearGradient(pad,y,pad+fsP*4,y);
  g.addColorStop(0,'#e8001d'); g.addColorStop(1,'#f5c400');
  ctx.font=`900 ${fsP}px 'Bebas Neue',Impact,sans-serif`; ctx.fillStyle=g;
  ctx.fillText(punti,pad,y+fsP);
  const fsL=Math.round(W*0.018);
  ctx.font=`600 ${fsL}px 'Barlow Condensed',sans-serif`; ctx.fillStyle='rgba(255,255,255,0.38)';
  ctx.fillText('PUNTI',pad,y+fsP+fsL*1.4);
  if(pos){ctx.font=`900 ${fsP}px 'Bebas Neue',Impact,sans-serif`;ctx.fillStyle='#f5c400';ctx.textAlign='right';ctx.fillText(`${pos}°`,W-pad,y+fsP);ctx.textAlign='left';}
  y+=fsP+Math.round(H*0.07);
  const lMax=Math.min(atleti.length,5),lH=H-fB-y-8,rH=Math.round(lH/lMax);
  ctx.fillStyle='rgba(255,255,255,0.03)'; ctx.fillRect(pad,y,W-pad*2,lH);
  atleti.slice(0,lMax).forEach((a,i)=>{
    const ry=y+i*rH,fsA=Math.round(rH*0.34),fsT=Math.round(rH*0.22);
    ctx.font=`700 ${fsA}px 'Barlow Condensed',sans-serif`; ctx.fillStyle=i===0?'#f5c400':'#f0f0f0';
    ctx.fillText(`${i+1}.  ${(a.cognome||'').toUpperCase()} ${(a.nome||'').toUpperCase()}`.substring(0,32),pad+8,ry+rH*0.44);
    ctx.font=`400 ${fsT}px 'Barlow Condensed',sans-serif`; ctx.fillStyle='#555';
    ctx.fillText((a.team||a.team_attuale||'').substring(0,36),pad+8,ry+rH*0.74);
    ctx.font=`900 ${Math.round(rH*0.42)}px 'Bebas Neue',Impact,sans-serif`; ctx.fillStyle='#f5c400'; ctx.textAlign='right';
    ctx.fillText(a.puntiCat||0,W-pad,ry+rH*0.55); ctx.textAlign='left';
  });
}

// ── CLASSIFICA CARD ────────────────────────────────────────
function _drawClass(ctx, W, H, d) {
  const {catLabel:cL,rows,scope,region} = d;
  const hB=Math.round(H*0.09),fB=Math.round(H*0.06),pad=Math.round(W*0.048);
  let y=hB+Math.round(H*0.025);
  const scopeTxt=scope==='regionale'?`REGIONALE — ${(region||'').toUpperCase()}`:'NAZIONALE';
  const fsSc=Math.round(W*0.026);
  ctx.font=`700 ${fsSc}px 'Barlow Condensed',sans-serif`; ctx.fillStyle=scope==='regionale'?'#f5c400':'#e8001d';
  ctx.fillText(scopeTxt,pad,y+fsSc); y+=fsSc*1.6;
  const fsT=Math.round(W*0.033);
  ctx.font=`400 ${fsT}px 'Bebas Neue',Impact,sans-serif`; ctx.fillStyle='rgba(255,255,255,0.35)';
  ctx.fillText('CLASSIFICA',pad,y+fsT); y+=fsT*1.05;
  const fsC=Math.round(W*0.065);
  ctx.font=`900 ${fsC}px 'Bebas Neue',Impact,sans-serif`; ctx.fillStyle='#f0f0f0';
  ctx.fillText(cL.toUpperCase(),pad,y+fsC); y+=fsC*1.05;
  ctx.fillStyle='#e8001d'; ctx.fillRect(pad,y,W-pad*2,2); y+=8;
  const avail=H-fB-y-4, maxR=Math.min(rows.length,10), rH=Math.round(avail/maxR);
  const posCol=['#f5c400','#b0b0b0','#cd7f32'];
  rows.slice(0,maxR).forEach((r,i)=>{
    const ry=y+i*rH;
    if(i%2===0){ctx.fillStyle='rgba(255,255,255,0.02)';ctx.fillRect(pad,ry,W-pad*2,rH);}
    const fsPos=Math.round(rH*0.58);
    ctx.font=`900 ${fsPos}px 'Bebas Neue',Impact,sans-serif`; ctx.fillStyle=i<3?posCol[i]:'rgba(255,255,255,0.25)';
    ctx.fillText(r.pos,pad,ry+rH*0.74);
    const pW=ctx.measureText('00').width+8;
    const fsN=Math.round(rH*0.36);
    ctx.font=`700 ${fsN}px 'Barlow Condensed',sans-serif`; ctx.fillStyle='#f0f0f0';
    ctx.fillText((`${r.cognome||''} ${r.nome||''}`).toUpperCase().trim().substring(0,26),pad+pW,ry+rH*0.44);
    ctx.font=`400 ${Math.round(fsN*0.7)}px 'Barlow Condensed',sans-serif`; ctx.fillStyle='#555';
    ctx.fillText((r.team||'').substring(0,28),pad+pW,ry+rH*0.78);
    ctx.font=`900 ${Math.round(rH*0.5)}px 'Bebas Neue',Impact,sans-serif`; ctx.fillStyle='#f5c400'; ctx.textAlign='right';
    ctx.fillText(r.punti,W-pad,ry+rH*0.7); ctx.textAlign='left';
  });
}

// ── Generatore canvas ──────────────────────────────────────
async function generateShareCanvas(type, payload, platKey) {
  const p=SHARE_PLATFORMS[platKey]||SHARE_PLATFORMS.instagram;
  const canvas=document.createElement('canvas'); canvas.width=p.w; canvas.height=p.h;
  const ctx=canvas.getContext('2d');
  const logo=await _getLogo();
  _bg(ctx,p.w,p.h); _header(ctx,logo,p.w,p.h); _footer(ctx,p.w,p.h);
  if(type==='gara')        _drawGara(ctx,p.w,p.h,payload);
  else if(type==='atleta') _drawAtleta(ctx,p.w,p.h,payload);
  else if(type==='team')   _drawTeam(ctx,p.w,p.h,payload);
  else if(type==='class')  _drawClass(ctx,p.w,p.h,payload);
  return canvas;
}

// ── SVG loghi social ────────────────────────────────────────
const _SVGS = {
  instagram: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>`,
  facebook: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`,
  twitter: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.213 5.567zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  whatsapp: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`,
  story: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="14" r="3"/><line x1="9" y1="6" x2="15" y2="6"/></svg>`,
  download: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
};

// ── Modale principale ──────────────────────────────────────
window.showShareModal = async function(type, payload) {
  _shareType=type; _sharePayload=payload; _sharePlatKey='instagram';
  const titles={gara:'Risultati Gara',atleta:'Profilo Atleta',team:'Profilo Team',class:'Classifica'};
  const platBtns = [
    {k:'instagram',label:'Instagram\nFeed',sz:'1080×1350'},
    {k:'story',label:'Story /\nReels',sz:'1080×1920'},
    {k:'facebook',label:'Facebook',sz:'1200×630'},
    {k:'twitter',label:'Twitter/X',sz:'1200×675'},
    {k:'whatsapp',label:'WhatsApp',sz:'1080×1080'},
  ].map(({k,label,sz})=>{
    const p=SHARE_PLATFORMS[k];
    return `<button class="share-plat-btn ${p.cls} ${k==='instagram'?'active':''}" id="sp-${k}" onclick="window.setSharePlat('${k}')" title="${sz}">
      <div class="share-plat-icon">${_SVGS[k]||''}</div>
      <span class="share-plat-label">${label.replace('\n','\n')}</span>
    </button>`;
  }).join('');

  document.body.insertAdjacentHTML('beforeend',`
  <div class="share-modal-overlay" id="share-overlay" onclick="if(event.target===this)window.closeShareModal()">
    <div class="share-modal" role="dialog">
      <div class="share-modal-header">
        <span class="share-modal-title">📤 ${titles[type]||'Condividi'}</span>
        <button class="share-modal-close" onclick="window.closeShareModal()">✕</button>
      </div>
      <div class="share-platforms">${platBtns}</div>
      <div class="share-size-label" id="share-size-lbl">Instagram Feed · 1080×1350 (4:5)</div>
      <div class="share-preview-wrap">
        <div class="share-generating" id="share-loading"><div class="share-spinner"></div> Generazione...</div>
        <img id="share-canvas-preview" style="display:none" alt="Anteprima"/>
      </div>
      <div class="share-actions">
        <button class="share-action-btn share-action-download" id="share-dl-btn" onclick="window.downloadShareCard()">⬇ Scarica PNG</button>
        <button class="share-action-btn share-action-native ${navigator.share?'':'hidden'}" onclick="window.nativeShare()">↗ Condividi</button>
      </div>
    </div>
  </div>`);
  await _refreshPreview();
};

window.closeShareModal=function(){const e=document.getElementById('share-overlay');if(e)e.remove();};

window.setSharePlat=async function(k){
  _sharePlatKey=k;
  document.querySelectorAll('.share-plat-btn').forEach(b=>b.classList.remove('active'));
  const btn=document.getElementById('sp-'+k); if(btn)btn.classList.add('active');
  const p=SHARE_PLATFORMS[k];
  const sizes={instagram:'1080×1350 (4:5)',story:'1080×1920 (9:16)',facebook:'1200×630 (1.91:1)',twitter:'1200×675 (16:9)',whatsapp:'1080×1080 (1:1)'};
  const names={instagram:'Instagram Feed',story:'Story / Reels',facebook:'Facebook',twitter:'Twitter/X',whatsapp:'WhatsApp'};
  const lbl=document.getElementById('share-size-lbl');
  if(lbl) lbl.textContent=`${names[k]} · ${sizes[k]}`;
  await _refreshPreview();
};

async function _refreshPreview(){
  const loading=document.getElementById('share-loading');
  const preview=document.getElementById('share-canvas-preview');
  if(!loading||!preview) return;
  loading.style.display='flex'; preview.style.display='none';
  try{
    const canvas=await generateShareCanvas(_shareType,_sharePayload,_sharePlatKey);
    preview.src=canvas.toDataURL('image/png');
    loading.style.display='none'; preview.style.display='block';
  }catch(e){loading.innerHTML='❌ Errore: '+e.message; console.error(e);}
}

window.downloadShareCard=async function(){
  const canvas=await generateShareCanvas(_shareType,_sharePayload,_sharePlatKey);
  const a=document.createElement('a');
  const p=SHARE_PLATFORMS[_sharePlatKey];
  a.download=`italiacrit-${_shareType}-${_sharePlatKey}-${p.w}x${p.h}.png`;
  a.href=canvas.toDataURL('image/png'); a.click();
};

window.nativeShare=async function(){
  try{
    const canvas=await generateShareCanvas(_shareType,_sharePayload,_sharePlatKey);
    canvas.toBlob(async blob=>{
      const f=new File([blob],`italiacrit-${_shareType}.png`,{type:'image/png'});
      await navigator.share({title:'ItaliacritResultati',files:[f]});
    },'image/png');
  }catch(e){console.warn(e);}
};

// ── Trigger functions ──────────────────────────────────────
window.triggerShareGara=function(){ if(window._shareGaraData) window.showShareModal('gara',window._shareGaraData); };
window.triggerShareAtleta=function(){ if(window._shareAtletaData) window.showShareModal('atleta',window._shareAtletaData); };
window.triggerShareTeam=function(){ if(window._shareTeamData) window.showShareModal('team',window._shareTeamData); };

window.shareClassifica=async function(){
  const ranking=await loadRanking(rankCat);
  if(!ranking||!ranking.length){alert('Carica prima la classifica!');return;}
  window.showShareModal('class',{
    catLabel:catLabel(rankCat),
    scope:rankRegion?'regionale':'nazionale',
    region:rankRegion||'',
    rows:ranking.slice(0,10).map(r=>({pos:r.pos,cognome:r.cognome||r.atleta_id,nome:r.nome||'',team:r.team||'',punti:r.punti}))
  });
};

// ── LOGIN ─────────────────────────────────────────────────────
function renderLogin() {
  if (authUser()) { window.location.hash = '/profilo'; return; }
  setPage(`
    <div class="auth-wrap">
      <div class="auth-card">
        <h1 class="auth-title">ACCEDI</h1>
        <p class="auth-sub">Bentornato su ItaliacritResultati</p>
        <div id="auth-error" class="auth-error" style="display:none"></div>
        <form id="login-form" class="auth-form" onsubmit="submitLogin(event)">
          <label class="auth-label">Email
            <input type="email" id="login-email" class="auth-input" placeholder="tua@email.it" required autocomplete="email" />
          </label>
          <label class="auth-label">Password
            <input type="password" id="login-pwd" class="auth-input" placeholder="••••••••" required autocomplete="current-password" />
          </label>
          <button type="submit" class="auth-btn" id="login-submit">ENTRA</button>
        </form>
        <p class="auth-switch">Non hai un account? <a href="#/register">Registrati</a></p>
      </div>
    </div>
  `);
}

window.submitLogin = async function(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const pwd   = document.getElementById('login-pwd').value;
  const errEl = document.getElementById('auth-error');
  const btn   = document.getElementById('login-submit');
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Accesso in corso…';
  try {
    const { token, user } = await apiCall('/auth/login', { method: 'POST', body: { email, password: pwd } });
    authSave(token, user);
    updateNavLoginState();
    window.location.hash = user.role === 'admin' ? '/admin' : '/profilo';
  } catch (err) {
    errEl.textContent = err.message; errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = 'ENTRA';
  }
};

// ── REGISTER ──────────────────────────────────────────────────
function renderRegister() {
  if (authUser()) { window.location.hash = '/profilo'; return; }
  setPage(`
    <div class="auth-wrap">
      <div class="auth-card">
        <h1 class="auth-title">REGISTRATI</h1>
        <p class="auth-sub">Crea il tuo account ItaliacritResultati</p>
        <div id="auth-error" class="auth-error" style="display:none"></div>
        <form id="reg-form" class="auth-form" onsubmit="submitRegister(event)">
          <label class="auth-label">Nome visualizzato
            <input type="text" id="reg-name" class="auth-input" placeholder="Es. Mario Rossi" required />
          </label>
          <label class="auth-label">Email
            <input type="email" id="reg-email" class="auth-input" placeholder="tua@email.it" required autocomplete="email" />
          </label>
          <label class="auth-label">Password
            <input type="password" id="reg-pwd" class="auth-input" placeholder="Minimo 6 caratteri" required autocomplete="new-password" minlength="6" />
          </label>
          <label class="auth-label">Tipo di account
            <select id="reg-role" class="auth-input">
              <option value="appassionato">Appassionato — seguo le gare</option>
              <option value="atleta">Atleta — voglio collegare il mio profilo</option>
              <option value="team">Team — gestisco una squadra</option>
              <option value="genitore">Genitore — seguo mio/a figlio/a</option>
              <option value="parente">Parente / Tifoso — seguo un atleta</option>
            </select>
          </label>
          <button type="submit" class="auth-btn" id="reg-submit">CREA ACCOUNT</button>
        </form>
        <p class="auth-switch">Hai già un account? <a href="#/login">Accedi</a></p>
      </div>
    </div>
  `);
}

window.submitRegister = async function(e) {
  e.preventDefault();
  const display_name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-pwd').value;
  const role  = document.getElementById('reg-role').value;
  const errEl = document.getElementById('auth-error');
  const btn   = document.getElementById('reg-submit');
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Registrazione…';
  try {
    const { token, user } = await apiCall('/auth/register', { method: 'POST', body: { email, password, role, display_name } });
    authSave(token, user);
    updateNavLoginState();
    window.location.hash = '/profilo';
  } catch (err) {
    errEl.textContent = err.message; errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = 'CREA ACCOUNT';
  }
};

// ── MY PROFILE ────────────────────────────────────────────────
async function renderMyProfile() {
  const user = authUser();
  if (!user) { window.location.hash = '/login'; return; }

  const roleLabels = {
    atleta:'Atleta', team:'Team', genitore:'Genitore', parente:'Parente / Tifoso', appassionato:'Appassionato', admin:'Amministratore'
  };

  let profileHtml = '';
  try {
    const { profile } = await apiCall('/profile');
    if (user.role === 'atleta') {
      if (!profile) {
        profileHtml = `
          <div class="auth-section">
            <h3 class="auth-section-title">Collega il tuo profilo atleta</h3>
            <p style="color:var(--text-muted);margin-bottom:16px;font-size:0.9rem">
              Cerca il tuo nome nelle classifiche e collegati per seguire facilmente i tuoi risultati.
            </p>
            <form onsubmit="submitLinkAthlete(event)" class="auth-form">
              <label class="auth-label">Cerca atleta nel DB
                <input type="text" id="link-search" class="auth-input" placeholder="Digita cognome…" oninput="searchAtletaForLink(this.value)" autocomplete="off" />
                <div id="link-results" style="margin-top:6px"></div>
                <input type="hidden" id="link-atleta-id" />
              </label>
              <label class="auth-label">Oppure inserisci codice FCI
                <input type="text" id="link-fci" class="auth-input" placeholder="Codice tessera FCI (opzionale)" />
              </label>
              <label class="auth-label">Nome
                <input type="text" id="link-fname" class="auth-input" placeholder="Nome" />
              </label>
              <label class="auth-label">Cognome
                <input type="text" id="link-lname" class="auth-input" placeholder="Cognome" />
              </label>
              <button type="submit" class="auth-btn">COLLEGA PROFILO</button>
            </form>
            <p style="font-size:0.8rem;color:var(--text-muted);margin-top:8px">
              Se non trovi il tuo profilo, compila comunque il form: verrà revisionato dall'admin.
            </p>
          </div>`;
      } else {
        const statusMap = { active:'✅ Verificato', pending:'⏳ In attesa di verifica', rejected:'❌ Rifiutato' };
        profileHtml = `
          <div class="auth-section">
            <h3 class="auth-section-title">Il tuo profilo atleta</h3>
            <div class="profile-info-row"><span>Stato</span><span>${statusMap[profile.status] || profile.status}</span></div>
            ${profile.atleta_id ? `<div class="profile-info-row"><span>Profilo</span><a href="#/atleta/${esc(profile.atleta_id)}">${esc(profile.first_name)} ${esc(profile.last_name)}</a></div>` : ''}
            ${profile.fci_code ? `<div class="profile-info-row"><span>Codice FCI</span><span>${esc(profile.fci_code)}</span></div>` : ''}
            ${profile.team ? `<div class="profile-info-row"><span>Team</span><span>${esc(profile.team)}</span></div>` : ''}
          </div>`;
      }
    } else if (user.role === 'team') {
      if (!profile) {
        profileHtml = `
          <div class="auth-section">
            <h3 class="auth-section-title">Collega il tuo team</h3>
            <form onsubmit="submitLinkTeam(event)" class="auth-form">
              <label class="auth-label">Nome team
                <input type="text" id="link-team-name" class="auth-input" placeholder="Nome squadra" required />
              </label>
              <button type="submit" class="auth-btn">COLLEGA TEAM</button>
            </form>
          </div>`;
      } else {
        const statusMap = { active:'✅ Verificato', pending:'⏳ In attesa di verifica', rejected:'❌ Rifiutato' };
        profileHtml = `
          <div class="auth-section">
            <h3 class="auth-section-title">Il tuo team</h3>
            <div class="profile-info-row"><span>Stato</span><span>${statusMap[profile.status] || profile.status}</span></div>
            ${profile.team_id ? `<div class="profile-info-row"><span>Profilo</span><a href="#/team/${esc(profile.team_id)}">${esc(profile.team_name)}</a></div>` : `<div class="profile-info-row"><span>Nome</span><span>${esc(profile.team_name)}</span></div>`}
          </div>`;
      }
    } else if (user.role === 'genitore' || user.role === 'parente') {
      const links = Array.isArray(profile) ? profile : [];
      const statusMap = { active:'✅', pending:'⏳', rejected:'❌' };
      profileHtml = `
        <div class="auth-section">
          <h3 class="auth-section-title">Atleti seguiti</h3>
          ${links.length ? links.map(l => `
            <div class="profile-info-row">
              <a href="#/atleta/${esc(l.linked_atleta_id)}">${esc(l.linked_atleta_id)}</a>
              <span>${statusMap[l.status] || l.status} ${esc(l.relation)}</span>
            </div>`).join('') : '<p style="color:var(--text-muted)">Nessun atleta collegato.</p>'}
          <form onsubmit="submitLinkFamily(event)" class="auth-form" style="margin-top:16px">
            <label class="auth-label">Cerca atleta
              <input type="text" id="link-search" class="auth-input" placeholder="Digita cognome…" oninput="searchAtletaForLink(this.value)" autocomplete="off" />
              <div id="link-results" style="margin-top:6px"></div>
              <input type="hidden" id="link-atleta-id" />
            </label>
            <button type="submit" class="auth-btn" style="margin-top:8px">AGGIUNGI ATLETA</button>
          </form>
        </div>`;
    }
  } catch (err) {
    profileHtml = `<p style="color:var(--text-muted)">Impossibile caricare il profilo: ${esc(err.message)}</p>`;
  }

  setPage(`
    <div class="auth-wrap">
      <div class="auth-card" style="max-width:560px">
        <h1 class="auth-title">IL MIO PROFILO</h1>
        <div class="auth-section">
          <div class="profile-info-row"><span>Nome</span><span>${esc(user.display_name)}</span></div>
          <div class="profile-info-row"><span>Email</span><span>${esc(user.email)}</span></div>
          <div class="profile-info-row"><span>Tipo</span><span>${roleLabels[user.role] || user.role}</span></div>
        </div>
        ${profileHtml}
        <div style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap">
          ${user.role === 'admin' ? `<a href="#/admin" class="auth-btn" style="text-decoration:none;text-align:center">PANNELLO ADMIN</a>` : ''}
          <button class="auth-btn auth-btn-outline" onclick="doLogout()">ESCI</button>
        </div>
      </div>
    </div>
  `);
}

window.doLogout = function() {
  authClear();
  updateNavLoginState();
  window.location.hash = '/';
};

window.searchAtletaForLink = function(q) {
  const container = document.getElementById('link-results');
  if (!container) return;
  if (!q || q.length < 2) { container.innerHTML = ''; return; }
  const { athletes } = globalData;
  const matches = Object.entries(athletes)
    .filter(([id, a]) => {
      const name = ((a.cognome || '') + ' ' + (a.nome || '')).toLowerCase();
      return name.includes(q.toLowerCase());
    })
    .slice(0, 8);
  container.innerHTML = matches.length
    ? matches.map(([id, a]) => `
        <div class="link-result-row" onclick="selectAtletaLink('${esc(id)}','${esc(a.cognome)} ${esc(a.nome)}')">
          <strong>${esc(a.cognome)} ${esc(a.nome)}</strong>
          <span style="color:var(--text-muted);font-size:0.8rem">${esc(a.team || '')}</span>
        </div>`).join('')
    : `<div style="padding:8px;color:var(--text-muted);font-size:0.85rem">Nessun risultato</div>`;
};

window.selectAtletaLink = function(id, label) {
  const inp = document.getElementById('link-search');
  const hid = document.getElementById('link-atleta-id');
  const res = document.getElementById('link-results');
  if (inp) inp.value = label;
  if (hid) hid.value = id;
  if (res) res.innerHTML = '';
};

window.submitLinkAthlete = async function(e) {
  e.preventDefault();
  const atleta_id = document.getElementById('link-atleta-id')?.value || null;
  const fci_code  = document.getElementById('link-fci')?.value.trim() || null;
  const first_name = document.getElementById('link-fname')?.value.trim() || null;
  const last_name  = document.getElementById('link-lname')?.value.trim() || null;
  try {
    await apiCall('/profile/link-athlete', { method: 'POST', body: { atleta_id, fci_code, first_name, last_name } });
    alert('Profilo collegato! ' + (atleta_id ? 'Attivo immediatamente.' : 'In attesa di verifica admin.'));
    renderMyProfile();
  } catch (err) { alert('Errore: ' + err.message); }
};

window.submitLinkTeam = async function(e) {
  e.preventDefault();
  const team_name = document.getElementById('link-team-name')?.value.trim();
  const { teams } = globalData;
  const match = Object.entries(teams).find(([id, t]) =>
    (t.nome || '').toLowerCase() === team_name.toLowerCase()
  );
  try {
    await apiCall('/profile/link-team', { method: 'POST', body: { team_id: match ? match[0] : null, team_name } });
    alert('Team collegato! ' + (match ? 'Attivo immediatamente.' : 'In attesa di verifica admin.'));
    renderMyProfile();
  } catch (err) { alert('Errore: ' + err.message); }
};

window.submitLinkFamily = async function(e) {
  e.preventDefault();
  const linked_atleta_id = document.getElementById('link-atleta-id')?.value;
  if (!linked_atleta_id) { alert('Seleziona prima un atleta dalla lista.'); return; }
  try {
    await apiCall('/profile/link-family', { method: 'POST', body: { linked_atleta_id } });
    alert('Atleta aggiunto! In attesa di verifica admin.');
    renderMyProfile();
  } catch (err) { alert('Errore: ' + err.message); }
};

