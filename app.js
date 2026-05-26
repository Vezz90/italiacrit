/* ============================================================
   ItaliacritResultati — app.js  v124
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

// ── YOUTUBE HELPER ────────────────────────────────────────────
// Estrae l'ID video da qualsiasi formato URL YouTube:
//   https://www.youtube.com/watch?v=ID
//   https://youtu.be/ID
//   https://youtube.com/shorts/ID
//   https://youtube.com/embed/ID
function ytId(url) {
  if (!url) return null;
  const m = url.match(/[?&]v=([^&\s]+)/)
    || url.match(/youtu\.be\/([^?&\s]+)/)
    || url.match(/youtube\.com\/(?:shorts|embed|live)\/([^?&\s]+)/);
  return m ? m[1] : null;
}

// ── TOAST ─────────────────────────────────────────────────────
// Notifica leggera in basso a destra, sparisce da sola dopo 3s.
// type: 'success' (verde) | 'info' (blu) | 'error' (rosso)
function showToast(msg, type = 'success') {
  const colors = { success: '#16a34a', info: '#2563eb', error: '#dc2626' };
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `position:fixed;bottom:24px;right:20px;z-index:99999;padding:10px 18px;border-radius:8px;background:${colors[type]||colors.success};color:#fff;font-size:.875rem;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.3);opacity:0;transition:opacity .2s;pointer-events:none`;
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; });
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 220); }, 3000);
}

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
  // Strategia video:
  // 1. In locale → file statico (immediato)
  // 2. In produzione → prova l'API Render con timeout 5s
  //    Se Render è in sleep (free tier) → fallback al file statico nel repo
  //    Dopo il caricamento iniziale, riprova in background e aggiorna globalData
  const videosPromise = IS_LOCAL
    ? loadJson('data/videos.json')
    : (async () => {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 5000); // 5s timeout
          const r = await fetch(`${API_BASE}/videos`, { signal: ctrl.signal });
          clearTimeout(timer);
          if (!r.ok) throw new Error('status ' + r.status);
          return await r.json();
        } catch {
          // Render in sleep o irraggiungibile: usa il file statico come fallback
          const fallback = await loadJson('data/videos.json');
          // Riprova in background dopo 8s (Render si sveglia in ~10-15s)
          setTimeout(async () => {
            try {
              const r2 = await fetch(`${API_BASE}/videos`);
              if (!r2.ok) return;
              const fresh = await r2.json();
              if (globalData) {
                globalData.videos = fresh;
                console.log('[videos] aggiornati da API dopo wake-up Render');
              }
            } catch { /* ignora */ }
          }, 8000);
          return fallback || {};
        }
      })();

  const [calendar, resultsRaw, athletes, teams, meta, raceDetails, videos] = await Promise.all([
    loadJson('data/calendar.json'),
    loadJson('data/results_raw.json'),
    loadJson('data/athletes.json'),
    loadJson('data/teams.json'),
    loadJson('data/meta.json'),
    loadJson('data/race_details.json'),
    videosPromise,
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

  // Normalizza cognome/nome in resultsRaw con i dati completi da athletes.
  // Lo scraper a volte tronca i cognomi composti (es. "DE ROSA" → solo "DE").
  // Il file athletes.json invece contiene il cognome registrato per intero.
  if (resultsRaw && athletes) {
    for (const r of resultsRaw) {
      const ath = athletes[r.atleta_id];
      if (ath) {
        if (ath.cognome) r.cognome = ath.cognome;
        if (ath.nome)    r.nome    = ath.nome;
      }
    }
  }

  // ── Calcolo rank_dopo_gara client-side ────────────────────────
  // Il campo non è scritto dallo scraper, quindi lo calcoliamo qui:
  // per ogni categoria, processiamo i risultati in ordine cronologico,
  // accumuliamo i punti_effettivi e dopo ogni gara assegniamo il rank.
  // Così ogni risultato porta il rank dell'atleta DOPO quella specifica gara.
  if (resultsRaw) {
    // Raggruppa per catCode
    const _byCode = {};
    for (const r of resultsRaw) {
      const code = getRankingFileCode(r);
      if (!code || !r.data || !r.atleta_id) continue;
      if (!_byCode[code]) _byCode[code] = [];
      _byCode[code].push(r);
    }
    for (const catRes of Object.values(_byCode)) {
      // Ordine crescente per data, poi per gara_id (più gare lo stesso giorno)
      catRes.sort((a, b) => a.data.localeCompare(b.data) || (a.gara_id||'').localeCompare(b.gara_id||''));
      const cumPts = {}; // atleta_id → punti cumulati
      let i = 0;
      while (i < catRes.length) {
        // Raggruppa tutti i risultati della stessa gara (stesso gara_id)
        const garaId = catRes[i].gara_id;
        let j = i;
        while (j < catRes.length && catRes[j].gara_id === garaId) j++;
        const raceSlice = catRes.slice(i, j);
        // Accumula punti di questa gara
        for (const r of raceSlice) {
          cumPts[r.atleta_id] = (cumPts[r.atleta_id] || 0) + (r.punti_effettivi || 0);
        }
        // Rank dopo questa gara: sort decrescente per punti cumulati
        const sorted = Object.entries(cumPts).sort(([, a], [, b]) => b - a);
        const rankMap = {};
        sorted.forEach(([id], idx) => { rankMap[id] = idx + 1; });
        // Assegna rank_dopo_gara a tutti i risultati di questa gara
        for (const r of raceSlice) r.rank_dopo_gara = rankMap[r.atleta_id] || null;
        i = j;
      }
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
    const calBaseNoEd = calBase.replace(/^\d+_/, '');
    const _nm2 = s => s
      .replace(/(?<![A-Z0-9])G_P(?![A-Z0-9])/g,'GRAN_PREMIO')
      .replace(/(?<![A-Z0-9])GP(?![A-Z0-9])/g,'GRAN_PREMIO')
      .replace(/(?<![A-Z0-9])GRANPREMIO(?![A-Z0-9])/g,'GRAN_PREMIO')
      .replace(/(?<![A-Z0-9])M_O(?![A-Z0-9])/g,'MEDAGLIA_ORO')
      .replace(/(?<![A-Z0-9])A_M(?![A-Z0-9])/g,'')
      .replace(/_+/g,'_').replace(/^_|_$/g,'');
    const calNorm2 = _nm2(calBaseNoEd);
    const calEd2   = calBase !== calBaseNoEd ? (calBase.match(/^(\d+)_/)||[])[1] : null;
    for (const r of (resultsRaw || [])) {
      if (!r.gara_id || r.data !== cal.data) continue;
      if (r.gara_id.startsWith(calBase)) { garaToCalId[r.gara_id] = cal.id; continue; }
      const garaBase = r.gara_id.replace(/^\d+_/,'').replace(/_\d{4}-\d{2}-\d{2}.*$/,'');
      if (garaBase === calBaseNoEd) { garaToCalId[r.gara_id] = cal.id; continue; }
      const garaNorm = _nm2(garaBase);
      if (calNorm2 === garaNorm) { garaToCalId[r.gara_id] = cal.id; continue; }
      if (garaNorm.length >= 8 && calNorm2.startsWith(garaNorm + '_')) { garaToCalId[r.gara_id] = cal.id; continue; }
      const garaEd = (r.gara_id.match(/^(\d+)_/)||[])[1];
      if (calEd2 && garaEd && calEd2 === garaEd) { garaToCalId[r.gara_id] = cal.id; continue; }
      { let i=0; while(i<calNorm2.length&&i<garaNorm.length&&calNorm2[i]===garaNorm[i]) i++;
        if (i>=18 && calNorm2.slice(0,i).endsWith('_')) garaToCalId[r.gara_id] = cal.id; }
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
  // Se genere non è disponibile (es. team results), lo ricaviamo dal suffisso gara_id
  if (obj.gara_id) {
    const m = obj.gara_id.match(/_([A-Z0-9]+)_([MF])$/);
    if (m) {
      let base = m[1];
      if (base.startsWith('AL')) base = 'AL';
      const gender = obj.genere === 'F' ? 'F' : obj.genere === 'M' ? 'M' : m[2];
      return `${base}_${gender}`;
    }
  }
  const gender = obj.genere === 'F' ? 'F' : 'M';
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

function renderTrend(r, showNew = true) {
  if (!r) return '';
  const t = r.trend;
  if (t === undefined || t === null) {
    return showNew ? `<span class="trend-indicator trend-new">NEW</span>` : '';
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
      <p style="font-size:0.72rem;color:var(--text-muted);margin-top:12px">Le modifiche sovrascrivono i dati originali localmente.</p>
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

  // ── Cinematic entry: prima visita ──────────────────────────────
  var _itcStored;
  try { _itcStored = localStorage.getItem('itcContext'); } catch(e) {}
  if (!_itcStored) {
    showCinematicEntry(false);
  }

  // Logo click: apre sempre la schermata cinematografica di selezione
  document.getElementById('nav-logo-link')?.addEventListener('click', function(e) {
    e.preventDefault();
    showCinematicEntry(true);
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
    // Returning user con hub attivo → vai direttamente all'hub editoriale
    if (activeHub && activeHub._code) {
      window.location.hash = '#/hub/' + activeHub._code + '/';
      return;
    }
    // Nessun hub: la cinematic gate È la home
    // Chiamare setPage crea il chip navbar e dà uno sfondo all'app
    setPage('<div style="min-height:100vh;background:var(--bg-primary)"></div>');
    if (!document.getElementById('itc-gate')) {
      showCinematicEntry(false);
    }
    return;
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
  const m_cal = match('/calendario/:id');
  if (m_cal) {
    if (activeHub) applyHubFilters(activeHub);
    return renderCalendario(decodeURIComponent(m_cal[1]));
  }
  if (match('/calendario')) {
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
  if (match('/news')) return renderNews();

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
  else if (hash.startsWith('#/news')) document.getElementById('nav-news')?.classList.add('active');
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
  app.innerHTML = `<main class="page page-enter">${html}</main>`;
  window.scrollTo({ top: 0, behavior: 'instant' });
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
        (isHot ? '<span class="hub-entry-hot-dot"></span>' : '') +
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

  // Hub di genere → selezione categoria
  if (hubCode === 'uomini' || hubCode === 'donne') {
    return renderGenderSelect(hubCode);
  }
  // Hub di categoria → layout dati (rider on fire, classifica, rivalità, newsroom, prossime gare)
  return _renderHubHomeLegacy(hubCode);
}

// ── LEGACY HUB (archivio — non più usato direttamente) ────────
async function _renderHubHomeLegacy(hubCode) {
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
        '<div class="em-spot-meta"><span class="em-spot-cat">' + catLabel(catCode) + '</span></div>' +
        '<p style="color:rgba(255,255,255,0.3);font-size:0.82rem;margin-top:12px">Nessun dato recente</p>' +
      '</div></section>';

    // Ranking context: find this athlete in the hub ranking for this catCode
    const spotRankEntry = (catCode === hub.mainCat ? hubRanking : (hubRankingES1||[])).find(function(e){ return e.atleta_id === ath.atleta_id; });
    const spotLeader    = (catCode === hub.mainCat ? hubRanking : (hubRankingES1||[]))[0];
    let rankContextHtml = '';
    if (spotRankEntry && spotLeader) {
      const spotPos = spotRankEntry.pos || (spotRankEntry === spotLeader ? 1 : '?');
      const spotGap = spotLeader.punti - spotRankEntry.punti;
      if (spotGap === 0)
        rankContextHtml = '<div class="em-spot-rank-ctx em-spot-rank-leader">LEADER IN CLASSIFICA · ' + spotRankEntry.punti + ' PT</div>';
      else
        rankContextHtml = '<div class="em-spot-rank-ctx">' + spotPos + '° IN CLASSIFICA · −' + spotGap + ' DAL LEADER</div>';
    }

    return '<section class="em-spotlight em-spotlight--half">' +
      '<div class="em-spotlight-bg-name">' + esc(ath.cognome) + '</div>' +
      '<div class="em-spotlight-body">' +
        '<div class="em-spot-meta">' +
          '<span class="em-spot-cat">' + catLabel(catCode) + '</span>' +
        '</div>' +
        rankContextHtml +
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
      '<div class="em-versus-label">SFIDA · ' + catLabel(catCode) + ' · ' + rv.encounters + ' scontri</div>' +
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
      '</div>' +
      '<div class="em-vs-comp-bar">' +
        '<button class="btn-share" onclick="window.openComparatoreVs(\'' + rv.aId + '\',\'' + rv.bId + '\',\'atleta\')">' +
          '⚖ Apri nel Comparatore' +
        '</button>' +
      '</div>' +
      '</section>';
  }

  // ── Helper: newsroom section ────────────────────────────────────
  function buildNewsHtml(resSet, label) {
    const items = siNewsroomFeed(resSet, [], [], [], {}).slice(0, 5);
    if (!items.length) return '';
    // Season-context sentence from buildWeeklyNarrative section 0
    let seasonContextHtml = '';
    try {
      const _ctxCat = hub.mainCat;
      const _ctxNarr = buildWeeklyNarrative([], resultsRaw, _ctxCat);
      if (_ctxNarr.length) {
        seasonContextHtml = '<div class="em-news-item em-news-context">' +
          '<div class="em-news-text" style="color:var(--text-secondary);font-style:italic">' + esc(_ctxNarr[0]) + '</div>' +
          '</div>';
      }
    } catch(e) {}
    return '<section class="em-newsroom">' +
      '<div class="em-newsroom-header"><span class="em-newsroom-badge">' + label + '</span></div>' +
      '<div class="em-newsroom-feed">' +
        seasonContextHtml +
        items.map(function(item) {
          const click = item.atleta_id
            ? ' onclick="location.hash=\'#/atleta/' + item.atleta_id + '\'"'
            : item.team_id ? ' onclick="location.hash=\'#/team/' + item.team_id + '\'"' : '';
          return '<div class="em-news-item em-news-' + item.type + '"' + click + '>' +
            '<div class="em-news-text">' + item.text + '</div>' +
            ((item.atleta_id || item.team_id) ? '<span class="em-news-arrow">→</span>' : '') +
          '</div>';
        }).join('') +
      '</div></section>';
  }

  // ── Helper: ranking section ─────────────────────────────────────
  function buildRankSection(ranking, catCode) {
    if (!ranking || !ranking.length) return '';
    const leaderPts = ranking[0].punti;
    return '<section class="hub-ranking-section">' +
      '<div class="hub-section-header">' +
        '<div class="hub-section-label">TOP CLASSIFICA · ' + catLabel(catCode) + '</div>' +
        '<a href="#/classifica" class="hub-section-more">Vedi tutto →</a>' +
      '</div>' +
      '<div class="hub-rank-list">' +
        ranking.map(function(a, i) {
          // Persistent trend: compare rank_dopo_gara now vs 3 races ago
          let trendHtml = '';
          const athHist = resultsRaw
            .filter(function(r){ return r.atleta_id === a.atleta_id && getRankingFileCode(r) === catCode && r.rank_dopo_gara; })
            .sort(function(a,b){ return b.data.localeCompare(a.data); });
          if (athHist.length >= 2) {
            const rNow = athHist[0].rank_dopo_gara;
            const rRef = athHist[Math.min(3, athHist.length-1)].rank_dopo_gara;
            const gain = rRef - rNow;
            if (gain >= 2)       trendHtml = '<span class="hub-rank-trend hub-rank-up">▲' + gain + '</span>';
            else if (gain <= -2) trendHtml = '<span class="hub-rank-trend hub-rank-down">▼' + Math.abs(gain) + '</span>';
          }
          // Gap to leader (il primo non ha badge — si vede dalla posizione)
          const gapHtml = i === 0
            ? ''
            : '<span class="hub-rank-gap">−' + (leaderPts - a.punti) + '</span>';
          return '<div class="hub-rank-row' + (i===0?' hub-rank-leader':'') + '" onclick="location.hash=\'#/atleta/' + encodeURIComponent(a.atleta_id) + '\'">' +
            '<span class="hub-rank-pos' + (i===0?' hub-rank-pos-1':i===1?' hub-rank-pos-2':i===2?' hub-rank-pos-3':'') + '">' + (i+1) + '</span>' +
            '<div class="hub-rank-info">' +
              '<div class="hub-rank-name">' + esc(a.cognome) + ' ' + esc(a.nome) + trendHtml + '</div>' +
              '<div class="hub-rank-team">' + esc(a.team_attuale||a.team||'') + '</div>' +
            '</div>' +
            gapHtml +
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

  // ── Championship tension data: movers nell'ultima settimana ──
  // Usa classifiche cumulative (non rank_dopo_gara personali) per evitare
  // confronti distoriti tra gare di settimane diverse.
  const champMoverLines = [];
  {
    const _hubCat = hub.mainCat;
    const _hubCutWeek = (function(){ const d = new Date(todayStr||new Date()); d.setDate(d.getDate()-7); return d.toISOString().split('T')[0]; })();
    const _hubRaw = resultsRaw.filter(function(r){
      return getRankingFileCode(r) === _hubCat && r.data && r.atleta_id && (r.punti_effettivi||0) > 0;
    });
    // Classifica attuale
    const _hubCurPts = {}, _hubPrevPts = {};
    for (var _hi = 0; _hi < _hubRaw.length; _hi++) {
      var _hr = _hubRaw[_hi];
      _hubCurPts[_hr.atleta_id] = (_hubCurPts[_hr.atleta_id]||0) + (_hr.punti_effettivi||0);
      if (_hr.data < _hubCutWeek) _hubPrevPts[_hr.atleta_id] = (_hubPrevPts[_hr.atleta_id]||0) + (_hr.punti_effettivi||0);
    }
    const _hubCurRankMap = {}, _hubPrevRankMap = {};
    Object.entries(_hubCurPts).sort(function(a,b){ return b[1]-a[1]; }).forEach(function(e,i){ _hubCurRankMap[e[0]] = i+1; });
    Object.entries(_hubPrevPts).sort(function(a,b){ return b[1]-a[1]; }).forEach(function(e,i){ _hubPrevRankMap[e[0]] = i+1; });
    for (var _hj = 0; _hj < hubRanking.length; _hj++) {
      var _he = hubRanking[_hj];
      var _rankNow  = _hubCurRankMap[_he.atleta_id];
      var _rankRef  = _hubPrevRankMap[_he.atleta_id];
      if (_rankNow == null || _rankRef == null) continue;
      var _gain = _rankRef - _rankNow;
      if (_gain >= 3)  champMoverLines.push('<strong>' + esc(_he.cognome).toUpperCase() + '</strong> sale di ' + _gain + ' posizioni — ora ' + _rankNow + '° in classifica');
      if (_gain <= -3) champMoverLines.push('<strong>' + esc(_he.cognome).toUpperCase() + '</strong> scende al ' + _rankNow + '° posto (−' + Math.abs(_gain) + ')');
    }
  }

  // ── Ticker ──────────────────────────────────────────────────────
  const tickerItems = [];
  // 1. Classification movements (persistent movers — no race wins)
  champMoverLines.slice(0, 2).forEach(function(l){ tickerItems.push(l); });
  // 2. (streak alert removed)
  // 3. Upcoming race
  if (upcomingAll[0]) {
    const dys = Math.round((new Date(upcomingAll[0].data) - new Date(todayStr)) / 86400000);
    tickerItems.push('PROSSIMA' + (dys===0?' OGGI':dys===1?' DOMANI':'') + ': <strong>' + esc(upcomingAll[0].nome) + '</strong>');
  }
  // 4. Title gap (always last as a heartbeat)
  if (hubRanking.length >= 2) {
    const gap12 = hubRanking[0].punti - hubRanking[1].punti;
    if (gap12 <= 15) tickerItems.push('LOTTA AL VERTICE — <strong>' + esc(hubRanking[0].cognome) + '</strong> guida con soli ' + gap12 + ' punti di margine');
    else tickerItems.push('CLASSIFICA — <strong>' + esc(hubRanking[0].cognome) + '</strong> in testa con ' + hubRanking[0].punti + ' pt');
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

  // ── Helper: build result rows (scoreboard style) ────────────────
  function buildLastRows(races) {
    return races.map(function(r) {
      const w = r.results.find(function(x){ return x.posizione === 1; });
      const d = new Date(r.data + 'T00:00:00');
      const dateStr = d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()];
      const rcCode = getRankingFileCode({gara_id:r.id, categoria:r.categoria, genere:r.genere, tipo:r.tipo});
      const catStr = catLabel(rcCode || r.categoria || '');
      const winnerStr = w ? esc(w.cognome) + ' ' + esc(w.nome) : '—';
      return '<div class="hlr-row" onclick="location.hash=\'#/gara/' + encodeURIComponent(r.id) + '\'">' +
        '<span class="hlr-date">' + dateStr + '</span>' +
        '<div class="hlr-info">' +
          '<div class="hlr-race-name">' + esc(r.nome) + '</div>' +
          '<div class="hlr-winner-name">' + winnerStr + '</div>' +
        '</div>' +
        '<span class="hlr-cat-badge">' + esc(catStr) + '</span>' +
      '</div>';
    }).join('');
  }

  // ── Championship status line (leader + top-3 gaps) ─────────────
  // buildChampStrip(ranking, annoLabel?) → HTML stringa di una singola strip.
  // annoLabel è opzionale: se passato appare come prefisso (es. "1° ANNO").
  function buildChampStrip(ranking, annoLabel) {
    if (!ranking || ranking.length < 2) return '';
    const l1 = ranking[0];
    const gap12 = l1.punti - ranking[1].punti;
    const l3 = ranking[2];
    const tension = gap12 === 0 ? 'PARITÀ IN VETTA' : gap12 <= 10 ? 'LOTTA APERTISSIMA' : gap12 <= 30 ? 'MARGINE RISICATO' : 'LEADER IN FUGA';
    return '<div class="hub-champ-status">' +
      (annoLabel ? '<span class="hub-champ-anno">' + annoLabel + '</span><span class="hub-champ-divider" aria-hidden="true">|</span>' : '') +
      '<span class="hub-champ-tension">' + tension + '</span>' +
      '<span class="hub-champ-sep" aria-hidden="true">·</span>' +
      '<span class="hub-champ-leader">' + esc(l1.cognome) + '</span>' +
      '<span class="hub-champ-pts">' + l1.punti + ' pt</span>' +
      '<span class="hub-champ-divider" aria-hidden="true">|</span>' +
      '<span class="hub-champ-rival">' + esc(ranking[1].cognome) + ' <em>−' + gap12 + '</em></span>' +
      (l3 ? '<span class="hub-champ-divider" aria-hidden="true">|</span><span class="hub-champ-rival">' + esc(l3.cognome) + ' <em>−' + (l1.punti - l3.punti) + '</em></span>' : '') +
    '</div>';
  }

  // Per gli esordienti: due strip affiancate (1° anno a sx, 2° a dx).
  // Per tutte le altre categorie: strip singola a piena larghezza.
  let champStatusHtml = '';
  if (isEsordienti) {
    const stripES1 = buildChampStrip(hubRankingES1, '1° ANNO');
    const stripES2 = buildChampStrip(hubRanking,    '2° ANNO');
    if (stripES1 || stripES2) {
      champStatusHtml = '<div class="hub-champ-dual">' + (stripES1||'') + (stripES2||'') + '</div>';
    }
  } else {
    champStatusHtml = buildChampStrip(hubRanking);
  }

  // ── 1. HERO — nome categoria, layout centrato ────────────────────
  const heroHtml = '<section class="em-hero">' +
    '<div class="em-hero-content em-hero-content--centered">' +
      '<div class="em-hero-left">' +
        '<div class="em-eyebrow">ITALIACRIT · ' + hub.icon + ' ' + hub.label.toUpperCase() + '</div>' +
        '<h1 class="em-title hub-cat-title">' + esc(hub.label.toUpperCase()) + '</h1>' +
        '<p class="em-subtitle">' + esc(hub.desc) + '</p>' +
      '</div>' +
    '</div>' +
    (tickerItems.length ? '<div class="em-ticker-bar"><div class="em-ticker-inner"><span class="em-ticker-track">' + [...tickerItems,...tickerItems].join(' &nbsp;&middot;&nbsp; ') + '</span></div></div>' : '') +
  '</section>';

  // ── 2. ULTIMI RISULTATI — piena larghezza, per categoria/genere ──
  let lastResultsHtml = '';
  if (lastWeekRaces.length) {
    // Format last weekend date for header
    const lastWkD = new Date(lastWkKey + 'T00:00:00');
    const lastWkSunD = new Date(lastWkD); lastWkSunD.setDate(lastWkD.getDate() + 1);
    const lastWkLabel = lastWkD.getDate() + '–' + lastWkSunD.getDate() + ' ' + MONTHS_SHORT[lastWkD.getMonth()];

    if (isEsordienti) {
      // Split ES1 / ES2 side by side — pass gara_id so getRankingFileCode extracts correctly
      const es1Races = lastWeekRaces.filter(function(r){ return getRankingFileCode({gara_id:r.id, categoria:r.categoria, genere:r.genere}) === es1Code; });
      const es2Races = lastWeekRaces.filter(function(r){ return getRankingFileCode({gara_id:r.id, categoria:r.categoria, genere:r.genere}) === es2Code; });
      const makeHalf = function(races, label) {
        if (!races.length) return '';
        return '<section class="hub-last-results hub-last-results--half">' +
          '<div class="hub-section-header">' +
            '<div class="hub-section-label">' + label.toUpperCase() + '</div>' +
          '</div>' +
          '<div class="hub-last-list hlr-list">' + buildLastRows(races) + '</div>' +
        '</section>';
      };
      lastResultsHtml = dualWrap(
        makeHalf(es1Races, '1° Anno'),
        makeHalf(es2Races, '2° Anno')
      );
    } else {
      lastResultsHtml =
        '<section class="hub-last-results">' +
          '<div class="hub-section-header">' +
            '<div class="hub-section-label">ULTIMI RISULTATI &nbsp;<span class="hub-wk-date">' + lastWkLabel + '</span></div>' +
            '<a href="#/risultati" class="hub-section-more">Tutti &rarr;</a>' +
          '</div>' +
          '<div class="hub-last-list hlr-list">' + buildLastRows(lastWeekRaces) + '</div>' +
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
        '<div class="hub-section-label">PROSSIMO FINE SETTIMANA &nbsp;<span class="hub-wk-date">' + wkLabel + '</span></div>' +
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

  setPage(heroHtml + champStatusHtml + lastResultsHtml + spotlightHtml + rankHtml + rivalHtml + newsHtml + upHtml);
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
  // Se su hub URL, vai alla classifica generale (senza riaprire la cinematic)
  if ((window.location.hash || '').startsWith('#/hub/')) {
    window.location.hash = '#/classifica';
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

// ════════════════════════════════════════════════════════════════════
//  CINEMATIC ENTRY GATEWAY
//  Premium sports broadcast opening sequence
// ════════════════════════════════════════════════════════════════════

var ENTRY_CATS = {
  M: [
    { code: 'elite-m',      label: 'ELITE / U23', color: '#F59E0B' },
    { code: 'juniores-m',   label: 'JUNIORES',    color: '#E11D48' },
    { code: 'allievi-m',    label: 'ALLIEVI',     color: '#10B981' },
    { code: 'esordienti-m', label: 'ESORDIENTI',  color: '#6366F1' }
  ],
  F: [
    { code: 'elite-f',      label: 'ELITE / U23', color: '#F472B6' },
    { code: 'juniores-f',   label: 'JUNIORES',    color: '#F43F5E' },
    { code: 'allievi-f',    label: 'ALLIEVE',     color: '#8B5CF6' },
    { code: 'esordienti-f', label: 'ESORDIENTI',  color: '#A78BFA' }
  ]
};

function _entryHideShell() {
  var nb = document.getElementById('navbar');
  var nd = document.getElementById('nav-drawer');
  var ft = document.querySelector('footer');
  if (nb) nb.style.visibility = 'hidden';
  if (nd) nd.style.display = 'none';
  if (ft) ft.style.visibility = 'hidden';
}
function _entryShowShell() {
  var nb = document.getElementById('navbar');
  var nd = document.getElementById('nav-drawer');
  var ft = document.querySelector('footer');
  if (nb) nb.style.visibility = '';
  if (nd) nd.style.display = '';
  if (ft) ft.style.visibility = '';
}

// ── Build gate HTML ──────────────────────────────────────────────
function _itcBuildGate() {
  return '<div class="itc-gate-grain"></div>' +

    '<header class="itc-gate-hdr">' +
      '<img src="assets/logo2.png" class="itc-gate-logo" alt="ItaliacritResultati"/>' +
      '<p class="itc-gate-tagline">The Home of Italian Cycling</p>' +
    '</header>' +

    '<div class="itc-gate-split" id="itc-split">' +
      '<div class="itc-gate-world itc-world-M" id="itc-world-M" onclick="window._itcGender(\'M\')">' +
        '<div class="itc-world-atmo itc-atmo-M"></div>' +
        '<div class="itc-world-glow"></div>' +
        '<div class="itc-world-lines"></div>' +
        '<div class="itc-world-body">' +
          '<span class="itc-world-pre">CICLISMO MASCHILE</span>' +
          '<span class="itc-world-word">MEN</span>' +
          '<span class="itc-world-enter">Entra nel mondo &#8594;</span>' +
        '</div>' +
      '</div>' +

      '<div class="itc-gate-divider"></div>' +

      '<div class="itc-gate-world itc-world-F" id="itc-world-F" onclick="window._itcGender(\'F\')">' +
        '<div class="itc-world-atmo itc-atmo-F"></div>' +
        '<div class="itc-world-glow"></div>' +
        '<div class="itc-world-lines"></div>' +
        '<div class="itc-world-body">' +
          '<span class="itc-world-pre">CICLISMO FEMMINILE</span>' +
          '<span class="itc-world-word">WOMEN</span>' +
          '<span class="itc-world-enter">&#8592; Entra nel mondo</span>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="itc-gate-cats" id="itc-cats"></div>' +

    '<button class="itc-gate-skip" onclick="window._itcSkip()">Esplora tutto il ciclismo &#8594;</button>';
}

// ── Show / hide gate ─────────────────────────────────────────────
function showCinematicEntry(asOverlay) {
  if (document.getElementById('itc-gate')) return; // already open
  _entryHideShell();
  document.body.style.overflow = 'hidden';

  var gate = document.createElement('div');
  gate.id  = 'itc-gate';
  gate.className = 'itc-gate' + (asOverlay ? ' itc-gate--overlay' : '');
  gate.innerHTML = _itcBuildGate();
  document.body.appendChild(gate);

  requestAnimationFrame(function() {
    requestAnimationFrame(function() { gate.classList.add('itc-gate--in'); });
  });
}

function _itcClose(hubCode) {
  var gate = document.getElementById('itc-gate');
  if (!gate) return;
  gate.classList.add('itc-gate--out');

  // Setup hub while gate is fading
  if (hubCode && HUB_CONFIG[hubCode]) {
    activeHub = Object.assign({}, HUB_CONFIG[hubCode]);
    activeHub._code = hubCode;
    applyHubFilters(activeHub);
    try { localStorage.setItem('itcContext', hubCode); } catch(e) {}
  }

  setTimeout(function() {
    _entryShowShell();
    document.body.style.overflow = '';
    if (gate.parentNode) gate.parentNode.removeChild(gate);
    if (hubCode) {
      window.location.hash = '#/hub/' + hubCode + '/';
    } else {
      // Skip: nessuna categoria selezionata → vai alla classifica generale
      try { localStorage.setItem('itcContext', 'skip'); } catch(e) {}
      window.location.hash = '#/classifica';
    }
  }, 550);
}

// ── Gender selection ─────────────────────────────────────────────
window._itcGender = function(gender) {
  var split   = document.getElementById('itc-split');
  var active  = document.getElementById('itc-world-' + gender);
  var other   = document.getElementById('itc-world-' + (gender === 'M' ? 'F' : 'M'));
  var div     = split ? split.querySelector('.itc-gate-divider') : null;
  var skipBtn = document.querySelector('.itc-gate-skip');

  if (!active || active.classList.contains('itc-world--expanding')) return;

  active.classList.add('itc-world--expanding');
  if (other) other.classList.add('itc-world--collapsing');
  if (div)   div.style.opacity = '0';
  if (skipBtn) skipBtn.style.opacity = '0';

  setTimeout(function() {
    var cats     = ENTRY_CATS[gender];
    var catsEl   = document.getElementById('itc-cats');
    var bgClass  = gender === 'M' ? 'itc-cats--M' : 'itc-cats--F';
    if (!catsEl) return;

    var rows = cats.map(function(c, i) {
      return '<div class="itc-cat-row" style="--i:' + i + ';--cc:' + c.color + '" onclick="window._itcCat(\'' + c.code + '\')">' +
        '<span class="itc-cat-idx">0' + (i + 1) + '</span>' +
        '<span class="itc-cat-name">' + c.label + '</span>' +
        '<span class="itc-cat-arr">&#8594;</span>' +
      '</div>';
    }).join('');

    catsEl.className = 'itc-gate-cats ' + bgClass;
    catsEl.innerHTML =
      '<button class="itc-cat-back" onclick="window._itcBack()">' +
        '&#8592; ' + (gender === 'M' ? 'UOMINI' : 'DONNE') +
      '</button>' +
      '<div class="itc-cat-title">SCEGLI LA TUA CATEGORIA</div>' +
      rows;

    requestAnimationFrame(function() {
      requestAnimationFrame(function() { catsEl.classList.add('itc-cats--in'); });
    });
  }, 420);
};

// ── Category selection ───────────────────────────────────────────
window._itcCat = function(hubCode) {
  var catsEl = document.getElementById('itc-cats');
  if (catsEl) catsEl.classList.add('itc-cats--out');
  setTimeout(function() { _itcClose(hubCode); }, 200);
};

// ── Back to split ────────────────────────────────────────────────
window._itcBack = function() {
  var catsEl  = document.getElementById('itc-cats');
  var skipBtn = document.querySelector('.itc-gate-skip');
  if (catsEl) {
    catsEl.classList.remove('itc-cats--in');
    catsEl.classList.add('itc-cats--out');
    setTimeout(function() {
      catsEl.className = 'itc-gate-cats';
      catsEl.innerHTML = '';
    }, 300);
  }
  var wM = document.getElementById('itc-world-M');
  var wF = document.getElementById('itc-world-F');
  var div = document.querySelector('.itc-gate-divider');
  setTimeout(function() {
    if (wM) wM.classList.remove('itc-world--expanding', 'itc-world--collapsing');
    if (wF) wF.classList.remove('itc-world--expanding', 'itc-world--collapsing');
    if (div) div.style.opacity = '';
    if (skipBtn) skipBtn.style.opacity = '';
  }, 150);
};

// ── Skip (no category) ───────────────────────────────────────────
window._itcSkip = function() { _itcClose(null); };

// ── Public: reopen from chip → compact picker ────────────────────
window.openContextSwitcher = function() { showCategoryPicker(); };

// ════════════════════════════════════════════════════════════════════
//  CATEGORY PICKER — compact drawer for in-session category switch
// ════════════════════════════════════════════════════════════════════

function _buildPickerRows(gender) {
  return ENTRY_CATS[gender].map(function(c) {
    var on = activeHub && activeHub._code === c.code;
    return '<div class="itc-pk-row' + (on ? ' itc-pk-row--on' : '') + '" style="--cc:' + c.color + '" onclick="window._itcPickCat(\'' + c.code + '\')">' +
      '<span class="itc-pk-dot" style="background:' + c.color + '"></span>' +
      '<span class="itc-pk-name">' + c.label + '</span>' +
      (on ? '<span class="itc-pk-cur">●</span>' : '<span class="itc-pk-arr">&#8594;</span>') +
    '</div>';
  }).join('');
}

function showCategoryPicker() {
  if (document.getElementById('itc-picker')) return;
  document.body.style.overflow = 'hidden';

  var el = document.createElement('div');
  el.id = 'itc-picker';
  el.className = 'itc-picker';
  el.innerHTML =
    '<div class="itc-pk-panel" id="itc-pk-panel">' +
      '<div class="itc-pk-head">' +
        '<span class="itc-pk-title">CAMBIA CATEGORIA</span>' +
        '<button class="itc-pk-close" onclick="window._closePicker()">&#10005;</button>' +
      '</div>' +
      '<div class="itc-pk-body">' +
        '<div class="itc-pk-section">' +
          '<div class="itc-pk-shdr itc-pk-M">&#9794; UOMINI</div>' +
          _buildPickerRows('M') +
        '</div>' +
        '<div class="itc-pk-sep"></div>' +
        '<div class="itc-pk-section">' +
          '<div class="itc-pk-shdr itc-pk-F">&#9792; DONNE</div>' +
          _buildPickerRows('F') +
        '</div>' +
      '</div>' +
      '<button class="itc-pk-all" onclick="window._itcPickCat(null)">Esplora tutto il ciclismo &#8594;</button>' +
    '</div>';

  document.body.appendChild(el);
  el.addEventListener('click', function(e) {
    if (e.target === el) window._closePicker();
  });
  requestAnimationFrame(function() {
    requestAnimationFrame(function() { el.classList.add('itc-picker--in'); });
  });
}

window._closePicker = function() {
  var p = document.getElementById('itc-picker');
  if (!p) return;
  p.classList.remove('itc-picker--in');
  p.classList.add('itc-picker--out');
  document.body.style.overflow = '';
  setTimeout(function() { if (p.parentNode) p.parentNode.removeChild(p); }, 340);
};

window._itcPickCat = function(hubCode) {
  window._closePicker();
  setTimeout(function() {
    if (!hubCode) { window.clearHubFilter(); return; }
    if (!HUB_CONFIG[hubCode]) return;
    activeHub = Object.assign({}, HUB_CONFIG[hubCode]);
    activeHub._code = hubCode;
    applyHubFilters(activeHub);
    try { localStorage.setItem('itcContext', hubCode); } catch(e) {}
    window.location.hash = '#/hub/' + hubCode + '/';
  }, 260);
};

function _routeEntryGate() {
  // Legacy — kept for compatibility but gate is now shown from load handler
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
  const myRes = resultsRaw
    .filter(r => r.atleta_id === athleteId && r.posizione && r.data)
    .sort((a, b) => a.data.localeCompare(b.data));

  // Keep legacy fields for callers that use them
  const cut14 = (() => { const d = new Date(lastRaceDate||new Date()); d.setDate(d.getDate()-14); return d.toISOString().split('T')[0]; })();
  const r14 = myRes.filter(r => r.data >= cut14);
  const pts14 = r14.reduce((s, r) => s + (r.punti_effettivi||0), 0);
  const pts28 = myRes.filter(r => { const cut28 = (() => { const d = new Date(lastRaceDate||new Date()); d.setDate(d.getDate()-28); return d.toISOString().split('T')[0]; })(); return r.data >= cut28 && r.data < cut14; }).reduce((s, r) => s + (r.punti_effettivi||0), 0);
  const gare14 = r14.length, podio14 = r14.filter(r=>r.posizione<=3).length, vittorie14 = r14.filter(r=>r.posizione===1).length;

  if (myRes.length < 4) {
    return { label: 'Dati insufficienti', trend: 'neutral', color: 'rgba(255,255,255,0.4)', pts14, pts28, gare14, podio14, vittorie14 };
  }

  // Season trajectory score (based on siSeasonArc logic)
  const arc = siSeasonArc(athleteId, resultsRaw);
  let seasonScore = 0; // 0=neutral, positive=good, negative=bad
  if (arc) {
    const improvement = arc.earlyAvg - arc.lateAvg;
    seasonScore = improvement / Math.max(arc.avgAll, 1);
    if (arc.trajectory === 'dominante') seasonScore = 1;
    else if (arc.trajectory === 'calo') seasonScore = Math.min(seasonScore, -0.3);
  }

  // Recent form score: last 20% of results by date
  const recentCount = Math.max(1, Math.ceil(myRes.length * 0.2));
  const recentRes = myRes.slice(-recentCount);
  const olderRes  = myRes.slice(0, -recentCount);
  const recentAvg = recentRes.reduce((s, r) => s + r.posizione, 0) / recentRes.length;
  const olderAvg  = olderRes.length ? olderRes.reduce((s, r) => s + r.posizione, 0) / olderRes.length : recentAvg;
  // positive = improving recently (lower pos is better)
  const recentScore = (olderAvg - recentAvg) / Math.max(olderAvg, 1);

  // Weighted blend: 60% season, 40% recent
  const blended = seasonScore * 0.6 + recentScore * 0.4;

  let label, trend, color;
  if (blended >= 0.4)       { label = 'In grande forma'; trend = 'up';      color = '#E11D48'; }
  else if (blended >= 0.12) { label = 'In crescita';     trend = 'up';      color = '#22c55e'; }
  else if (blended >= -0.1) { label = 'Stabile';         trend = 'neutral'; color = 'rgba(255,255,255,0.5)'; }
  else if (blended >= -0.3) { label = 'In calo';         trend = 'down';    color = '#f59e0b'; }
  else                      { label = 'Difficile momento'; trend = 'down';   color = '#ef4444'; }

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
  // Biggest mover (only topScalatori[0], drop [2])
  if (topScalatori[0]) items.push({ icon:'📈', text:'<strong>' + esc(topScalatori[0].cognome) + ' ' + esc(topScalatori[0].nome) + '</strong> sale di <strong>+' + topScalatori[0].gain + ' posizioni</strong> in ' + catLabel(topScalatori[0].code), type:'mover', atleta_id:topScalatori[0].atleta_id });
  // Team dominance
  for (const [code, td] of Object.entries(teamDom).slice(0,2)) {
    items.push({ icon:'🏆', text:'<strong>' + esc(td.team) + '</strong> domina in ' + catLabel(code) + ': <strong>' + td.wins + ' vittorie</strong> nell\'ultimo mese', type:'team', team_id:td.team_id });
  }
  // Close battles (from ranking)
  for (let i=0; i < Math.min(allRankings.length, catOrder.length); i++) {
    const rk = allRankings[i]; if (!rk || rk.length < 2) continue;
    const gap = rk[0].punti - rk[1].punti;
    if (gap <= 15) { items.push({ icon:'⚔', text:'Solo <strong>' + gap + ' punti</strong> separano <strong>' + esc(rk[0].cognome) + '</strong> e <strong>' + esc(rk[1].cognome) + '</strong> in ' + catLabel(catOrder[i]), type:'battle' }); break; }
  }
  // Full-season rivalry: top pair with close finishes (<3 positions apart)
  (() => {
    const pairs = {};
    const byRaceAll = {};
    for (const r of resultsRaw) {
      if (!r.gara_id || !r.posizione || !r.data) continue;
      if (!byRaceAll[r.gara_id]) byRaceAll[r.gara_id] = [];
      byRaceAll[r.gara_id].push(r);
    }
    for (const raceResults of Object.values(byRaceAll)) {
      const sorted = raceResults.slice().sort((a,b) => a.posizione - b.posizione);
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i+1; j < sorted.length; j++) {
          if (sorted[j].posizione - sorted[i].posizione >= 3) break;
          const a = sorted[i], b = sorted[j];
          if (a.atleta_id === b.atleta_id) continue;
          const key = [a.atleta_id, b.atleta_id].sort().join('|');
          if (!pairs[key]) pairs[key] = { aId:a.atleta_id, bId:b.atleta_id, aCog:a.cognome, bCog:b.cognome, close:0 };
          pairs[key].close++;
        }
      }
    }
    const topPair = Object.values(pairs).sort((a,b) => b.close - a.close)[0];
    if (!topPair || topPair.close < 3) return;
    // Check if they're close in ranking (≤20 pts) — look in allRankings
    for (let i = 0; i < allRankings.length; i++) {
      const rk = allRankings[i]; if (!rk) continue;
      const eA = rk.find(e => e.atleta_id === topPair.aId);
      const eB = rk.find(e => e.atleta_id === topPair.bId);
      if (eA && eB) {
        const gap = Math.abs(eA.punti - eB.punti);
        if (gap <= 20) {
          items.push({ icon:'⚔', text:'Solo <strong>' + gap + ' punti</strong> separano <strong>' + esc(topPair.aCog) + '</strong> e <strong>' + esc(topPair.bCog) + '</strong> in classifica.', type:'battle' });
        }
        break;
      }
    }
  })();
  // Full-season team dominance: team with >30% of wins
  (() => {
    const teamWinCounts = {};
    let totalWins = 0;
    for (const r of resultsRaw) {
      if (r.posizione !== 1 || !r.team_id) continue;
      teamWinCounts[r.team_id] = teamWinCounts[r.team_id] || { team:r.team, team_id:r.team_id, wins:0 };
      teamWinCounts[r.team_id].wins++;
      totalWins++;
    }
    if (!totalWins) return;
    const topTeam = Object.values(teamWinCounts).sort((a,b) => b.wins - a.wins)[0];
    if (topTeam && topTeam.wins / totalWins > 0.3) {
      items.push({ icon:'🏆', text:'<strong>' + esc(topTeam.team) + '</strong> domina la stagione: <strong>' + topTeam.wins + ' vittorie</strong> su ' + totalWins + ' totali.', type:'team', team_id:topTeam.team_id });
    }
  })();
  return items.slice(0, 8);
}

// siRaceNarrative — auto-generate story string for a race (text only, no emoji)
function siRaceNarrative(raceId, resultsRaw) {
  const results = resultsRaw.filter(r => r.gara_id === raceId && r.posizione).sort((a,b) => a.posizione - b.posizione);
  if (!results.length) return null;
  const w = results[0], p2 = results[1];
  const { winStreak, podioStreak } = siStreak(w.atleta_id, resultsRaw);
  if (winStreak >= 3) return esc(w.cognome) + ' è in striscia: ' + winStreak + 'ª vittoria di fila.';
  if (winStreak >= 2) return esc(w.cognome) + ' non si ferma: ' + winStreak + ' vittorie consecutive.';
  if (podioStreak >= 4) return esc(w.cognome) + ' inarrestabile — ' + podioStreak + ' podi di fila.';
  if (p2 && Math.abs((w.punti_effettivi||0)-(p2.punti_effettivi||0)) <= 2) return 'Duello al limite: ' + esc(w.cognome) + ' batte ' + esc(p2.cognome) + ' per pochissimi punti.';
  return 'Vince ' + esc(w.cognome) + ' ' + esc(w.nome) + (p2 ? ' davanti a ' + esc(p2.cognome) : '') + '.';
}

// siRaceImpact — compute race impact: insight chip + ranking movers
function siRaceImpact(catResults, resultsRaw) {
  if (!catResults || !catResults.length) return null;
  const sorted  = [...catResults].sort((a,b) => a.posizione - b.posizione);
  const winner  = sorted[0];
  const second  = sorted[1];
  const raceDate = winner?.data || '';
  const catCode  = winner ? getRankingFileCode(winner) : null;

  // Insight chip: race type label
  const { winStreak, podioStreak } = winner ? siStreak(winner.atleta_id, resultsRaw) : { winStreak:0, podioStreak:0 };
  const ptsDiff = (winner && second) ? Math.abs((winner.punti_effettivi||0) - (second.punti_effettivi||0)) : null;

  let insight = null;
  if (winStreak >= 3)         insight = winStreak + ' vittorie di fila';
  else if (winStreak >= 2)    insight = '2 vittorie consecutive';
  else if (podioStreak >= 3)  insight = podioStreak + ' podi consecutivi';
  else if (ptsDiff !== null && ptsDiff <= 3) insight = 'Volata ristretta';
  else if (ptsDiff !== null && ptsDiff >= 25) insight = 'Vittoria netta';

  // Ranking movers: compare rank_dopo_gara vs previous rank
  const gainers = [];
  for (const r of sorted.slice(0, 12)) {
    if (!r.atleta_id || !r.rank_dopo_gara) continue;
    const prevRes = resultsRaw.filter(x =>
      x.atleta_id === r.atleta_id &&
      x.data < raceDate &&
      x.rank_dopo_gara &&
      catCode && getRankingFileCode(x) === catCode
    ).sort((a,b) => b.data.localeCompare(a.data))[0];
    if (prevRes?.rank_dopo_gara) {
      const gain = prevRes.rank_dopo_gara - r.rank_dopo_gara; // positive = moved up
      if (gain !== 0) gainers.push({ cognome: r.cognome, nome: r.nome, atleta_id: r.atleta_id, gain, newRank: r.rank_dopo_gara });
    }
  }
  gainers.sort((a,b) => b.gain - a.gain);
  const topGainer = gainers[0]?.gain >= 2 ? gainers[0] : null;
  const topFaller = gainers[gainers.length-1]?.gain <= -3 ? gainers[gainers.length-1] : null;
  const hasShakeup = gainers.some(g => Math.abs(g.gain) >= 4);

  return { insight, topGainer, topFaller, hasShakeup };
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
  if (wins28 >= 5) return 'Squadra dominante — ' + wins28 + ' vittorie in ' + gare28 + ' gare (ultimi 28gg).';
  if (topWinner && topWinner.wins >= 2) return esc(topWinner.cognome) + ' trascina il team: ' + topWinner.wins + ' vittorie. ' + podi28 + ' podi totali su ' + gare28 + ' gare.';
  if (podi28 > 0) return podi28 + ' podi in ' + gare28 + ' gare nell\'ultimo mese' + (cats28.length > 1 ? ' in ' + cats28.length + ' categorie' : '') + '.';
  return gare28 + ' gare, ' + podi28 + ' podi nell\'ultimo mese.';
}

// ── TEAM INTELLIGENCE: Season Mission ─────────────────────────
function siTeamMission(teamId, resultsRaw, tCatRanks) {
  const allRes = resultsRaw.filter(r => r.team_id === teamId && r.posizione && r.data);
  if (!allRes.length) return { tag:'🏗', label:'IN COSTRUZIONE', desc:'Il team sta muovendo i primi passi stagionali', color:'var(--text-muted)' };
  const lastDate = allRes.reduce((mx,r) => r.data > mx ? r.data : mx, '');
  const cut28 = (() => { const d=new Date(lastDate); d.setDate(d.getDate()-28); return d.toISOString().split('T')[0]; })();
  const recent = allRes.filter(r => r.data >= cut28);
  const wins    = allRes.filter(r => r.posizione === 1).length;
  const wRec    = recent.filter(r => r.posizione === 1).length;
  const cats    = [...new Set(allRes.map(r => getRankingFileCode(r)).filter(Boolean))];
  const winners = [...new Set(allRes.filter(r => r.posizione === 1).map(r => r.atleta_id))];
  const topRank = (tCatRanks || []).slice().sort((a,b) => a.pos - b.pos)[0];
  if (topRank && topRank.pos === 1) return { tag:'👑', label:'SQUADRA DA BATTERE', desc:'Leader assoluti — la stagione è loro', color:'#f59e0b' };
  if (topRank && topRank.pos <= 3)  return { tag:'🎯', label:'IN CACCIA DEL TITOLO', desc:`${topRank.pos}° posto — a un passo dalla cima`, color:'var(--red-hot)' };
  if (wRec >= 3)  return { tag:'🔥', label:'MOMENTO DI FUOCO', desc:`${wRec} vittorie nelle ultime 4 settimane`, color:'var(--red-hot)' };
  if (cats.length >= 3) return { tag:'⚡', label:'FORZA TRASVERSALE', desc:`Presente in ${cats.length} categorie della stagione`, color:'#3b82f6' };
  if (winners.length >= 3) return { tag:'🏆', label:'SQUADRA PLURIVINCENTE', desc:`${winners.length} corridori diversi a segno`, color:'#10b981' };
  if (wins >= 3)  return { tag:'📈', label:'STAGIONE DI SPESSORE', desc:`${wins} vittorie stagionali`, color:'#10b981' };
  if (wins > 0)   return { tag:'💪', label:'IN RAMPA DI LANCIO', desc:`${wins} vittori${wins===1?'a':'e'} — il meglio deve ancora venire`, color:'var(--text-secondary)' };
  return { tag:'⏳', label:'IN CERCA DI FORMA', desc:'La vittoria è il prossimo obiettivo stagionale', color:'var(--text-muted)' };
}

// ── TEAM INTELLIGENCE: Strength Tags ──────────────────────────
function siTeamStrengths(teamId, resultsRaw) {
  const allRes = resultsRaw.filter(r => r.team_id === teamId && r.posizione && r.data);
  if (!allRes.length) return [];
  const wins    = allRes.filter(r => r.posizione === 1).length;
  const podi    = allRes.filter(r => r.posizione <= 3).length;
  const top10   = allRes.filter(r => r.posizione <= 10).length;
  const races   = new Set(allRes.map(r => r.gara_id)).size;
  const cats    = [...new Set(allRes.map(r => getRankingFileCode(r)).filter(Boolean))];
  const winners = [...new Set(allRes.filter(r => r.posizione === 1).map(r => r.atleta_id))];
  const winRate    = races > 0 ? wins / races : 0;
  const podioRate  = races > 0 ? podi / races : 0;
  const top10Rate  = races > 0 ? top10 / races : 0;
  const tags = [];
  if (winRate >= 0.4 && races >= 4) tags.push({ icon:'🔥', label:'Macchina da vittorie', desc:`Vince nel ${Math.round(winRate*100)}% delle gare` });
  else if (winners.length >= 3)     tags.push({ icon:'🎯', label:'Plurivittoria', desc:`${winners.length} corridori diversi a segno` });
  else if (wins >= 3)               tags.push({ icon:'🏆', label:'Squadra Vincente', desc:`${wins} vittorie stagionali` });
  if (podioRate >= 0.5 && races >= 5)         tags.push({ icon:'🥇', label:'Alta Consistenza', desc:`Podio nel ${Math.round(podioRate*100)}% delle gare` });
  else if (top10Rate >= 0.65 && races >= 5)   tags.push({ icon:'📊', label:'Top-10 Costante', desc:`Top-10 nel ${Math.round(top10Rate*100)}% delle gare` });
  if (cats.length >= 3)  tags.push({ icon:'⚡', label:'Multi-Categoria', desc:`${cats.length} categorie presidiate` });
  if (races >= 8 && podi / races >= 0.3) tags.push({ icon:'💎', label:'Presenza Costante', desc:`${races} gare disputate` });
  return tags.slice(0, 4);
}

// ── TEAM INTELLIGENCE: Momentum Score ─────────────────────────
function siTeamMomentumData(teamId, resultsRaw) {
  const allRes = resultsRaw.filter(r => r.team_id === teamId && r.posizione && r.data);
  if (!allRes.length) return { label:'Nessun dato', color:'var(--text-muted)', pct:50, delta:0 };
  const lastDate = allRes.reduce((mx,r) => r.data > mx ? r.data : mx, '');
  const cut14 = (() => { const d=new Date(lastDate); d.setDate(d.getDate()-14); return d.toISOString().split('T')[0]; })();
  const cut28 = (() => { const d=new Date(lastDate); d.setDate(d.getDate()-28); return d.toISOString().split('T')[0]; })();
  const recent = allRes.filter(r => r.data >= cut14);
  const prev   = allRes.filter(r => r.data >= cut28 && r.data < cut14);
  const ptsR = recent.reduce((s,r) => s+(r.punti_effettivi||0), 0);
  const ptsP = prev.reduce((s,r)   => s+(r.punti_effettivi||0), 0);
  const wR   = recent.filter(r => r.posizione === 1).length;
  const delta = ptsR - ptsP;
  const maxPts = Math.max(ptsR, ptsP, 1);
  const pct = Math.min(90, Math.max(10, Math.round(50 + (delta / maxPts) * 38)));
  if (wR >= 2 || delta > 20)  return { label:'🔥 In grande forma', color:'var(--red-hot)', pct, delta };
  if (delta > 5)              return { label:'📈 In crescita',      color:'#10b981',        pct, delta };
  if (Math.abs(delta) <= 5)   return { label:'➡ Forma stabile',    color:'var(--text-secondary)', pct:50, delta };
  if (delta < -10)            return { label:'📉 In calo',          color:'#6b7280',        pct, delta };
  return                             { label:'↘ Lieve calo',        color:'var(--text-muted)', pct, delta };
}

// siAthleteIdentity — racing style, specialty, strengths
function siAthleteIdentity(athleteId, resultsRaw) {
  const myRes = resultsRaw.filter(r => r.atleta_id === athleteId && r.posizione && r.data);
  if (!myRes.length) return null;
  const races  = new Set(myRes.map(r => r.gara_id)).size;
  const wins   = myRes.filter(r => r.posizione === 1).length;
  const podi   = myRes.filter(r => r.posizione <= 3).length;
  const top5   = myRes.filter(r => r.posizione <= 5).length;
  const top10  = myRes.filter(r => r.posizione <= 10).length;
  const winRate   = races ? wins   / races : 0;
  const podioRate = races ? podi   / races : 0;
  const top5Rate  = races ? top5   / races : 0;
  const top10Rate = races ? top10  / races : 0;
  let style, icon, desc;
  if (winRate >= 0.4 && races >= 4)     { style = 'DOMINATORE';        icon = '👑'; desc = 'Vince in quasi la metà delle gare disputate'; }
  else if (winRate >= 0.25 && races >= 3){ style = 'FINISSEUR PURO';   icon = '🎯'; desc = 'Corridore da vittoria — attacca per vincere'; }
  else if (podioRate >= 0.5 && wins===0) { style = 'UOMO DI PUNTA';    icon = '💎'; desc = 'Costantemente tra i migliori — manca solo il guizzo'; }
  else if (podioRate >= 0.4)             { style = 'CORRIDORE DA PODIO';icon = '🥇'; desc = `Podio nel ${Math.round(podioRate*100)}% delle gare`; }
  else if (top5Rate >= 0.5 && races >= 5){ style = 'SPECIALISTA TOP-5';icon = '📈'; desc = 'Regolare e competitivo nelle prime posizioni'; }
  else if (top10Rate >= 0.6 && races >= 5){ style = 'PRESENZA COSTANTE';icon = '⚙'; desc = 'Pilastro di squadra — sempre nei dieci'; }
  else if (races <= 3)                   { style = 'IN COSTRUZIONE';   icon = '🏗'; desc = 'Stagione agli inizi — dati in crescita'; }
  else                                   { style = 'IN EVOLUZIONE';    icon = '⏳'; desc = 'Alla ricerca del rendimento migliore'; }
  const strengths = [];
  if (winRate > 0.2)   strengths.push('Corridore da vittoria');
  if (podioRate > 0.4) strengths.push('Alta consistenza');
  if (top5Rate > 0.5)  strengths.push('Presenza costante');
  if (races >= 8)      strengths.push('Grande esperienza');
  return { style, icon, desc, strengths, winRate, podioRate, top5Rate, races, wins, podi, top5 };
}

// siBestMoment — best single result of the season
function siBestMoment(athleteId, resultsRaw) {
  const myRes = resultsRaw.filter(r => r.atleta_id === athleteId && r.posizione && r.data);
  if (!myRes.length) return null;
  const sorted  = [...myRes].sort((a,b) => a.posizione - b.posizione || b.data.localeCompare(a.data));
  const best    = sorted[0];
  const lastWin = myRes.filter(r=>r.posizione===1).sort((a,b)=>b.data.localeCompare(a.data))[0];
  return {
    best:    { pos:best.posizione, nome:best.nome_gara, data:best.data, pts:best.punti_effettivi||0, gara_id:best.gara_id },
    lastWin: (lastWin && lastWin.gara_id !== best.gara_id) ? { pos:1, nome:lastWin.nome_gara, data:lastWin.data, pts:lastWin.punti_effettivi||0, gara_id:lastWin.gara_id } : null,
  };
}

// siAthleteStory — generate season narrative label for athlete
function siSeasonArc(athleteId, resultsRaw) {
  const myRes = resultsRaw
    .filter(r => r.atleta_id === athleteId && r.posizione && r.data)
    .sort((a, b) => a.data.localeCompare(b.data));
  if (myRes.length < 4) return null;

  const n = myRes.length;
  const third = Math.floor(n / 3);
  const early = myRes.slice(0, third);
  const mid   = myRes.slice(third, third * 2);
  const late  = myRes.slice(third * 2);

  const avg = arr => arr.reduce((s, r) => s + r.posizione, 0) / arr.length;
  const earlyAvg = avg(early);
  const midAvg   = mid.length ? avg(mid) : earlyAvg;
  const lateAvg  = avg(late);
  const avgAll   = avg(myRes);

  const wins  = myRes.filter(r => r.posizione === 1).length;
  const podi  = myRes.filter(r => r.posizione <= 3).length;
  const winRate   = wins / n;
  const podioRate = podi / n;

  // consistency = low stddev of positions
  const variance = myRes.reduce((s, r) => s + Math.pow(r.posizione - avgAll, 2), 0) / n;
  const stddev = Math.sqrt(variance);
  const consistency = stddev < 3;

  // trajectory detection
  let trajectory;
  const improvement = earlyAvg - lateAvg; // positive = improved (lower pos = better)
  if (avgAll <= 3 && winRate >= 0.2) {
    trajectory = 'dominante';
  } else if (improvement >= 2 && lateAvg < earlyAvg) {
    trajectory = lateAvg < midAvg ? 'crescita' : 'esplosivo';
  } else if (improvement <= -2 && lateAvg > earlyAvg) {
    trajectory = 'calo';
  } else {
    trajectory = 'stabile';
  }

  return { trajectory, earlyAvg, midAvg, lateAvg, n, avgAll, podioRate, winRate, consistency, wins, podi };
}

function siAthleteStory(athleteId, resultsRaw) {
  const arc = siSeasonArc(athleteId, resultsRaw);
  if (!arc) return null;
  const { trajectory, n, wins, podi, winRate, podioRate, consistency } = arc;

  if (trajectory === 'dominante' && winRate > 0.3) {
    return `${n} gare, ${wins} vittorie: uno dei protagonisti della stagione.`;
  }
  if (trajectory === 'dominante') {
    return `Regolarmente sul podio nel corso della stagione.`;
  }
  if (trajectory === 'crescita') {
    return `Progressione costante nel corso della stagione.`;
  }
  if (trajectory === 'esplosivo') {
    return `Partenza difficile, ora regolarmente tra i migliori.`;
  }
  if (trajectory === 'calo') {
    return `Grande avvio, rendimento calato nelle ultime settimane.`;
  }
  if (trajectory === 'stabile' && consistency) {
    return `Corridore affidabile — sempre nella parte alta della classifica.`;
  }
  return null;
}


// ── Weekly ranking narrative ──────────────────────────────────
// Confronta rank_dopo_gara dell'ultima settimana di gare con la settimana prima,
// così gli spostamenti mostrano cosa è successo nel weekend appena corso.
function buildWeeklyNarrative(filtered, resultsRaw, catCode) {
  const lines = [];

  // Ancora temporale: ultima data in cui questa categoria ha gareggiato
  const allCatRes = resultsRaw.filter(r => getRankingFileCode(r) === catCode && r.rank_dopo_gara && r.data);
  const latestDate = allCatRes.reduce((mx, r) => r.data > mx ? r.data : mx, '');
  if (!latestDate) return lines;
  const cutWeek = (() => { const d = new Date(latestDate); d.setDate(d.getDate() - 7);  return d.toISOString().split('T')[0]; })();
  const cutPrev = (() => { const d = new Date(latestDate); d.setDate(d.getDate() - 14); return d.toISOString().split('T')[0]; })();

  // 0. Season context: leadership stability
  (() => {
    // Group results by gara_id, find who was rank 1 after each race, sorted by date
    const garaLeaders = {};
    for (const r of allCatRes) {
      if (r.rank_dopo_gara === 1) {
        if (!garaLeaders[r.gara_id] || r.data > garaLeaders[r.gara_id].data) {
          garaLeaders[r.gara_id] = { atleta_id: r.atleta_id, data: r.data };
        }
      }
    }
    const leaderHistory = Object.values(garaLeaders).sort((a, b) => a.data.localeCompare(b.data));
    if (!leaderHistory.length) return;

    // Count distinct leader changes
    const distinctLeaders = new Set(leaderHistory.map(l => l.atleta_id));
    let leaderChanges = 0;
    for (let i = 1; i < leaderHistory.length; i++) {
      if (leaderHistory[i].atleta_id !== leaderHistory[i-1].atleta_id) leaderChanges++;
    }

    // Check stability: last 3+ consecutive races same leader
    const last3 = leaderHistory.slice(-3);
    const stableTop = last3.length >= 3 && last3.every(l => l.atleta_id === last3[0].atleta_id);

    if (leaderChanges >= 3) {
      lines.push(`Il campionato ha già cambiato leader ${leaderChanges} volte.`);
    } else if (stableTop) {
      lines.push(`La classifica è stabile al vertice da settimane.`);
    }
  })();

  // 1. Situazione al vertice
  if (filtered.length >= 2) {
    const l1 = filtered[0], l2 = filtered[1], l3 = filtered[2];
    const gap12 = l1.punti - l2.punti;
    const gap13 = l3 ? l1.punti - l3.punti : null;
    if (gap12 === 0)
      lines.push(`Parità assoluta in vetta: ${l1.cognome} e ${l2.cognome} divisi da zero punti`);
    else if (gap12 <= 10)
      lines.push(`Lotta apertissima: ${l1.cognome} (1°, ${l1.punti} pt) guida con soli ${gap12} punti su ${l2.cognome} (2°)`);
    else if (gap12 <= 30)
      lines.push(`${l1.cognome} al comando (${l1.punti} pt), ${l2.cognome} a −${gap12} in seconda posizione`);
    else
      lines.push(`${l1.cognome} in fuga: ${l1.punti} punti, vantaggio di ${gap12} su ${l2.cognome} (2°)`);
    if (l3 && gap13 !== null && gap13 <= 40)
      lines.push(`Top-3 in ${gap13} punti — tutto ancora aperto per ${l3.cognome} (3°, ${l3.punti} pt)`);
  } else if (filtered.length === 1) {
    lines.push(`${filtered[0].cognome} solo al comando con ${filtered[0].punti} punti`);
  }

  // 2. Spostamenti settimana scorsa vs settimana prima
  // Calcoliamo due classifiche dai punti cumulati (non da rank_dopo_gara personali),
  // così i movimenti riflettono cosa è cambiato per TUTTI, non solo per chi ha gareggiato.
  // curRankMap  = classifica con tutti i risultati disponibili (oggi)
  // prevRankMap = classifica con soli i risultati di data < cutWeek (una settimana fa)
  const _allRaw = resultsRaw.filter(r =>
    getRankingFileCode(r) === catCode && r.data && r.atleta_id && (r.punti_effettivi || 0) > 0
  );
  const _curPts = {}, _prevPts = {};
  for (const r of _allRaw) {
    _curPts[r.atleta_id] = (_curPts[r.atleta_id] || 0) + (r.punti_effettivi || 0);
    if (r.data < cutWeek) _prevPts[r.atleta_id] = (_prevPts[r.atleta_id] || 0) + (r.punti_effettivi || 0);
  }
  const _curRankMap = {}, _prevRankMap = {};
  Object.entries(_curPts).sort(([,a],[,b]) => b-a).forEach(([id], i) => { _curRankMap[id] = i + 1; });
  Object.entries(_prevPts).sort(([,a],[,b]) => b-a).forEach(([id], i) => { _prevRankMap[id] = i + 1; });

  const movers = [];
  for (const entry of filtered) {
    const curRank  = _curRankMap[entry.atleta_id];
    const prevRank = _prevRankMap[entry.atleta_id];
    if (curRank == null || prevRank == null) continue;
    const gain = prevRank - curRank; // positivo = salito in classifica
    if (gain === 0) continue;
    const hadTop5LastWeek = _allRaw.some(r =>
      r.atleta_id === entry.atleta_id && r.data >= cutWeek && r.posizione && r.posizione <= 5
    );
    movers.push({ entry, gain, rankAfter: curRank, rankBefore: prevRank, hadTop5LastWeek });
  }
  movers.sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain));
  // Risers: top 5 nella gara + attualmente in top 30
  const risers  = movers.filter(m => m.gain >= 1 && m.hadTop5LastWeek && m.rankAfter <= 30).slice(0, 3);
  // Fallers: solo chi era già tra i primi 20
  const fallers = movers.filter(m => m.gain <= -2 && m.rankBefore <= 20).slice(0, 1);
  for (const m of risers) {
    const pos = m.gain === 1 ? 'una posizione' : `${m.gain} posizioni`;
    lines.push(`${m.entry.cognome} guadagna ${pos} e sale ${m.rankAfter}°`);
  }
  for (const m of fallers)
    lines.push(`${m.entry.cognome} perde ${Math.abs(m.gain)} posizion${Math.abs(m.gain)===1?'e':'i'} e scende al ${m.rankAfter}°`);

  // 3. Nuovi entrati in top-15 nell'ultima settimana: curRank ≤ 15, prevRank assente o > 15
  const newEntries = [];
  for (const entry of filtered) {
    if (entry.pos > 15) continue;
    const curRank  = _curRankMap[entry.atleta_id];
    const prevRank = _prevRankMap[entry.atleta_id];
    const racedLastWeek = _allRaw.some(r => r.atleta_id === entry.atleta_id && r.data >= cutWeek);
    if (racedLastWeek && curRank != null && curRank <= 15 && (prevRank == null || prevRank > 15)) {
      newEntries.push(entry);
    }
  }
  if (newEntries.length)
    lines.push(`Nuovi in top-15: ${newEntries.slice(0,3).map(r=>`${r.cognome} (${r.pos}°)`).join(', ')}`);

  return lines;
}

// ═══════════════════════════════════════════════════════════════
// SEASON EDITORIAL INTELLIGENCE AGENT (SEIA)
// Engine 1: Season Analysis — usa l'intera stagione, non solo le ultime gare
// ═══════════════════════════════════════════════════════════════
function seiaSeasonAnalysis(hubCode, resultsRaw, ranking) {
  const hub = HUB_CONFIG[hubCode];
  if (!hub) return null;
  const cat = hub.mainCat;
  const catRes = resultsRaw.filter(r =>
    hub.catCodes.includes(getRankingFileCode(r)) && r.genere === hub.gender
  );

  const lastDate  = catRes.reduce((mx,r)=>(r.data||'')>mx?r.data:mx,'');
  const firstDate = catRes.reduce((mn,r)=>(!mn||(r.data||'')<mn)?r.data:mn,'');

  const raceIds    = new Set(catRes.map(r=>r.gara_id));
  const totalRaces = raceIds.size;
  const msSpan     = new Date(lastDate) - new Date(firstDate);
  const weeksDuration = Math.max(1, Math.round(msSpan/(7*864e5)));

  let seasonPhase = 'early';
  if (weeksDuration >= 14) seasonPhase = 'late';
  else if (weeksDuration >= 7) seasonPhase = 'mid';

  const leader = ranking[0]||null;
  const second = ranking[1]||null;
  const third  = ranking[2]||null;
  const gap12  = leader&&second ? leader.punti-second.punti : null;
  const gap13  = leader&&third  ? leader.punti-third.punti  : null;

  const leaderRes  = leader ? catRes.filter(r=>r.atleta_id===leader.atleta_id) : [];
  const leaderWins = leaderRes.filter(r=>r.posizione===1).length;
  const leaderWinRate = leaderRes.length>0 ? leaderWins/leaderRes.length : 0;

  const isDominating  = gap12!==null && gap12>25 && leaderWinRate>=0.3;
  const isVeryClose   = gap12!==null && gap12<=10;
  const isClose       = gap12!==null && gap12<=28;

  // Recent form — last 28 days
  const cut4w = (()=>{const d=new Date(lastDate||new Date());d.setDate(d.getDate()-28);return d.toISOString().split('T')[0];})();
  const recentMap={};
  catRes.filter(r=>r.data>=cut4w).forEach(r=>{
    if(!recentMap[r.atleta_id]) recentMap[r.atleta_id]={aid:r.atleta_id,cog:r.cognome,nom:r.nome,team:r.team,pts:0,wins:0,gare:0};
    recentMap[r.atleta_id].pts+=(r.punti_effettivi||0);
    recentMap[r.atleta_id].gare++;
    if(r.posizione===1) recentMap[r.atleta_id].wins++;
  });
  const recentSorted = Object.values(recentMap).sort((a,b)=>b.pts-a.pts);
  const recentLeader = recentSorted[0]||null;
  const risingThreat = recentLeader&&leader&&recentLeader.aid!==leader.atleta_id ? recentLeader : null;

  // Rivalry
  const catOnly = catRes.filter(r=>getRankingFileCode(r)===cat);
  const rivalry = siRivalryFinder(catOnly)[0]||null;

  // Top team (among top-20)
  const teamMap={};
  ranking.slice(0,20).forEach(a=>{
    const tk=a.team_id||'?';
    if(!teamMap[tk]) teamMap[tk]={team:a.team_nome||a.team_attuale||tk,pts:0,count:0,top3:0};
    teamMap[tk].pts+=a.punti; teamMap[tk].count++;
    if((a.pos||99)<=3) teamMap[tk].top3++;
  });
  const topTeam = Object.values(teamMap).filter(t=>t.count>=2).sort((a,b)=>b.pts-a.pts)[0]||null;

  return {
    hubCode,cat,hub,catRes,totalRaces,weeksDuration,seasonPhase,
    firstDate,lastDate,leader,second,third,gap12,gap13,
    leaderRes,leaderWins,leaderWinRate,isDominating,isVeryClose,isClose,
    recentLeader,risingThreat,rivalry,topTeam,ranking
  };
}

// ── Engine 4: Content Generation ─────────────────────────────────
function seiaGenerateSeasonArticle(analysis) {
  if(!analysis||!analysis.leader) return null;
  const {cat,hub,hubCode,leader,second,third,gap12,gap13,leaderWins,leaderWinRate,
         leaderRes,totalRaces,weeksDuration,seasonPhase,isDominating,
         isVeryClose,isClose,risingThreat,rivalry,topTeam,ranking} = analysis;

  const catName = catLabel(cat);
  const ln  = leader.cognome;
  const lf  = leader.cognome+' '+leader.nome;
  const lpt = leader.punti;
  const lg  = leaderRes.length||leader.gare||1;
  const lte = leader.team_nome||leader.team_attuale||'';

  // TITOLO
  let title;
  if (isDominating && leaderWins>=4)
    title = `${ln} inarrestabile: la stagione ${catName} ha già un padrone`;
  else if (isDominating && leaderWins>=2)
    title = `${ln} in controllo: vantaggio, vittorie e una classifica che parla chiaro`;
  else if (isVeryClose && second)
    title = `${ln} e ${second.cognome}: la battaglia per la vetta che tiene in sospeso la stagione ${catName}`;
  else if (isClose && !isDominating && second)
    title = `La corsa è aperta: la stagione ${catName} non ha ancora un padrone`;
  else if (risingThreat && risingThreat.wins>=2)
    title = `${risingThreat.cog} scuote la stagione: la sfida al vertice si riapre`;
  else if (rivalry && rivalry.encounters>=4)
    title = `${rivalry.aCog} vs ${rivalry.bCog}: la rivalità che segna la stagione ${catName}`;
  else
    title = `${lf}: al comando di una stagione ${catName} ancora tutta da scrivere`;

  // INTRO
  let intro;
  if (isDominating) {
    intro = `${lf} non ha lasciato molti dubbi. ${leaderWins} vittori${leaderWins===1?'a':'e'} su ${lg} presenze — numeri che pochi possono permettersi in questa categoria — raccontano una stagione che ha trovato il suo protagonista. `
      +(gap12>40
        ?`${gap12} punti di vantaggio su ${second?.cognome||'il secondo'}: un margine che, se questa stagione fosse una corsa in linea, varrebbe già il traguardo.`
        :`${gap12} punti separano ${ln} da ${second?.cognome||'il secondo'}: abbastanza per respirare, non abbastanza per smettere di correre.`);
  } else if (isVeryClose) {
    intro = `${gap12} punti. È questo il confine sottile che separa ${ln} da ${second?.cognome||'il suo inseguitore'} nella classifica ${catName}. `
      +`Ogni gara diventa una resa dei conti, ogni weekend un'occasione per ribaltare un equilibrio che non si è mai davvero stabilizzato. `
      +`In una stagione simile, la testa conta quanto le gambe.`;
  } else if (isClose) {
    intro = `La classifica ${catName} ha il volto di ${ln}, ma i conti sono ancora aperti. `
      +`${lpt} punti in ${totalRaces} gare disputate, ${gap12} di vantaggio su ${second?.cognome||'il secondo'}: `
      +`un margine da difendere e, per chi lo insegue, ancora tutto da costruire.`;
  } else {
    intro = `Stagione ${catName}: ${totalRaces} gare, ${ranking.length} corridori in classifica, `
      +`e un nome che emerge sopra tutti — ${lf}. `
      +`Con ${lpt} punti${leaderWins>0?' e '+leaderWins+' vittori'+(leaderWins===1?'a':'e')+'':''}, `
      +`il corridore di ${lte||'la sua squadra'} tiene le redini di una stagione ancora in divenire.`;
  }

  // SEZIONI
  const sections = [];

  // § 1 — La vetta
  let s1 = `${ln} guida con ${lpt} punti${leaderWins>0?' e '+leaderWins+' vittori'+(leaderWins===1?'a':'e'):''}. `;
  if (second&&third) {
    s1 += `${second.cognome} (${second.punti} pt) e ${third.cognome} (${third.punti} pt) formano una top-3 `;
    s1 += isVeryClose
      ?`compressa in ${gap13} punti — un fazzoletto che può ribaltarsi in un solo weekend.`
      :isClose
        ?`separata da distacchi ancora combattibili. La classifica è viva.`
        :` con distacchi che pesano ma non escludono ancora nessuno dalla lotta.`;
  } else if (second) {
    s1 += `${second.cognome} insegue a ${gap12} punti: un distacco `
      +(isClose?`che tiene aperta ogni possibilità.`:`che si è allargato nelle ultime settimane.`);
  }
  sections.push({heading:'Il quadro in vetta', body:s1});

  // § 2 — Rivalità o minaccia emergente
  if (rivalry&&rivalry.encounters>=3) {
    const rv=rivalry;
    let s2=`Due nomi che tornano sui tabelloni degli ${catName} con frequenza non casuale: ${rv.aCog} e ${rv.bCog}. `;
    s2+=`${rv.encounters} scontri diretti in stagione`;
    if (rv.aWins>rv.bWins)
      s2+=`, con ${rv.aCog} in vantaggio ${rv.aWins} a ${rv.bWins}. Un divario che esiste, ma che ${rv.bCog} non ha mai smesso di contestare.`;
    else if (rv.bWins>rv.aWins)
      s2+=`, con ${rv.bCog} avanti ${rv.bWins} a ${rv.aWins}. Ogni incrocio è una partita a sé.`;
    else
      s2+=` e il conto in perfetta parità: ${rv.aWins} vittorie per parte. La prossima sfida diretta vale doppio.`;
    sections.push({heading:'La rivalità che segna la stagione', body:s2});
  } else if (risingThreat) {
    const rt=risingThreat;
    const rtPos = ranking.findIndex(r=>r.atleta_id===rt.aid)+1;
    let s2=`Il nome che scorre sulle labbra nelle ultime settimane è quello di ${rt.cog}. `;
    s2+=`Con ${rt.pts} punti nell'ultimo mese — il rendimento più alto della categoria in quel periodo — `;
    s2+=rt.wins>0
      ?`e ${rt.wins} vittori${rt.wins===1?'a':'e'} recenti, è lui il protagonista di questo momento di stagione.`
      :`ha costruito una progressione che lo rende difficile da ignorare.`;
    if (rtPos>0&&rtPos<=15) {
      const ptGap=ranking[0].punti-(ranking[rtPos-1]?.punti||0);
      s2+=` Attualmente ${rtPos}° in classifica, a ${ptGap} punti dalla vetta: `
        +(ptGap<=30?`abbastanza vicino da crederci davvero.`:`lontano ma non impossibile.`);
    }
    sections.push({heading:'La minaccia che cresce', body:s2});
  }

  // § 3 — Dimensione di squadra
  if (topTeam) {
    let s3=`Nell'analisi di questa stagione ${catName}, non si può ignorare il peso di ${topTeam.team}. `;
    s3+=topTeam.count>=3
      ?`Con ${topTeam.count} corridori nei piani alti della classifica, il team ha costruito un blocco di forza che condiziona le strategie di tutti gli avversari.`
      :`Due atleti ai vertici della classifica: una doppia presenza che si traduce in più opzioni tattiche e più pressione sugli avversari.`;
    if (topTeam.top3>0)
      s3+=` ${topTeam.top3===1?'Un corridore nella top-3':topTeam.top3+' corridori nella top-3'} assoluta. Numeri che parlano di un team costruito per vincere.`;
    sections.push({heading:'La dimensione di squadra', body:s3});
  }

  // CONCLUSIONE
  let conclusion;
  if (seasonPhase==='early')
    conclusion=`Siamo nelle prime settimane della stagione ${catName}. Le gerarchie sono fluide, i protagonisti ancora in assestamento. `
      +`Ogni weekend aggiunge mattoni alla classifica e, potenzialmente, cambia il racconto. Il titolo è ancora un'ipotesi; chi lo vincerà lo deciderà nelle gare che verranno.`;
  else if (seasonPhase==='mid')
    conclusion=`La stagione è nel pieno del suo corso. Le tendenze si consolidano, i caratteri emergono, e la classifica prende forma. `
      +(isDominating
        ?`${ln} sembra aver trovato il proprio ritmo. Fermarlo adesso richiederebbe qualcosa di straordinario.`
        :isClose
          ?`La lotta per il titolo è aperta. Ogni punto ha un peso che, a fine stagione, potrebbe fare la differenza.`
          :`Chi ha costruito la stagione con intelligenza e costanza è pronto a raccogliere i frutti.`);
  else
    conclusion=`Il finale di stagione è alle porte. I punti pesano il doppio, la pressione sale, i margini d'errore si restringono. `
      +(isDominating
        ?`${ln} parte da favorito. Qualcosa di imprevisto dovrebbe cambiare le sorti di una stagione che sembra già scritta.`
        :`Nulla è ancora deciso. Le prossime settimane diranno chi aveva la mentalità — oltre alle gambe — per arrivare dove conta.`);

  return {
    id:`season_${cat}_${analysis.lastDate||'2026'}`,
    type:'season_story', category:cat, hubCode,
    title, intro, sections, conclusion,
    importance:100,
    generatedAt:new Date().toISOString().split('T')[0],
    leaderAtletaId:leader?.atleta_id, leaderName:ln
  };
}

function seiaGenerateSecondaryArticles(analysis) {
  const arts=[];
  const {cat,leader,second,ranking,rivalry,risingThreat,topTeam,gap12,isVeryClose,isDominating} = analysis;

  // Rivalità
  if (rivalry&&rivalry.encounters>=4) {
    arts.push({
      id:`rivalry_${cat}`,type:'rivalry',category:cat,
      title:`${rivalry.aCog} vs ${rivalry.bCog}: ${rivalry.encounters} sfide, una sola rivalità`,
      intro:`${rivalry.encounters} incontri diretti. Ogni volta che si trovano allo stesso traguardo, la storia della stagione cambia.`,
      preview:`${rivalry.aWins} vittorie contro ${rivalry.bWins}: il bilancio lascia aperto ogni scenario.`,
      linkA:`#/atleta/${encodeURIComponent(rivalry.aId)}`,
      linkB:`#/atleta/${encodeURIComponent(rivalry.bId)}`,
      nameA:rivalry.aCog, nameB:rivalry.bCog
    });
  }

  // Momentum
  if (risingThreat&&risingThreat.wins>=1) {
    const rtPos=ranking.findIndex(r=>r.atleta_id===risingThreat.aid)+1;
    arts.push({
      id:`momentum_${cat}_${risingThreat.aid}`,type:'momentum',category:cat,
      title:`${risingThreat.cog}: il momento di un corridore che non si può ignorare`,
      intro:`${risingThreat.wins} vittori${risingThreat.wins===1?'a':'e'} recenti e il rendimento più alto della categoria nell'ultimo mese.`,
      preview:rtPos>0?`Attualmente ${rtPos}° in classifica — e in ascesa.`:'Una progressione che parla da sola.',
      athleteId:risingThreat.aid
    });
  }

  // Scenario
  if (isVeryClose&&second&&gap12!==null) {
    arts.push({
      id:`scenario_${cat}_title`,type:'scenario',category:cat,
      title:`Come si ribalta tutto: lo scenario che può riscrivere la classifica ${catLabel(cat)}`,
      intro:`${gap12} punti tra il primo e il secondo. In una gara con moltiplicatore, questo distacco sparisce in un pomeriggio.`,
      preview:`I numeri che spiegano perché la lotta al titolo è matematicamente ancora aperta.`
    });
  }

  // Team
  if (topTeam&&topTeam.count>=2&&arts.length<3) {
    arts.push({
      id:`team_${cat}_${topTeam.team}`,type:'team',category:cat,
      title:`${topTeam.team}: la forza collettiva che ridisegna la categoria`,
      intro:`${topTeam.count} corridori nei piani alti della classifica non è un caso. È un sistema che funziona.`,
      preview:'Il modello che trasforma una squadra in fattore determinante di stagione.'
    });
  }

  return arts.slice(0,3);
}

function seiaContextLine(analysis) {
  const {leader,second,gap12,totalRaces,seasonPhase,risingThreat,rivalry,isDominating,isVeryClose} = analysis;
  if (!leader) return '';
  if (isVeryClose&&second)
    return `${leader.cognome} e ${second.cognome} separati da ${gap12} punti — ogni gara può cambiare tutto.`;
  if (isDominating)
    return `${leader.cognome} comanda con ${gap12} punti di vantaggio dopo ${totalRaces} gare disputate.`;
  if (risingThreat&&risingThreat.wins>=1)
    return `${risingThreat.cog} è il corridore del momento — ${risingThreat.wins} vittori${risingThreat.wins===1?'a':'e'} nell'ultimo mese.`;
  if (rivalry&&rivalry.encounters>=3)
    return `La rivalità stagionale: ${rivalry.aCog} vs ${rivalry.bCog}, ${rivalry.encounters} scontri diretti.`;
  if (seasonPhase==='late')
    return `Finale di stagione: ${totalRaces} gare disputate, la classifica inizia a scrivere la storia.`;
  return `Stagione in corso — ${totalRaces} gare, ${leader.cognome} al comando.`;
}

// ── Rendering editoriale ──────────────────────────────────────────
function buildEditorialHeroHtml(hub, article, analysis) {
  const {leader,totalRaces,seasonPhase,gap12,isVeryClose,isDominating} = analysis;
  const phaseLabel = seasonPhase==='early'?'Inizio stagione':seasonPhase==='mid'?'Stagione in corso':'Finale di stagione';
  const situationLine = isVeryClose&&gap12!==null
    ? `Lotta aperta · ${gap12} pt di distacco`
    : isDominating
      ? `${leader?.cognome||''} in fuga`
      : `${totalRaces} gare disputate`;

  return `<section class="editorial-hero" style="background:${hub.gradient||'var(--bg-secondary)'}">
    <div class="editorial-hero-inner">
      <div class="editorial-hero-eyebrow">${esc(hub.label)} · ${phaseLabel}</div>
      <h1 class="editorial-hero-title">${article?esc(article.title):'Stagione '+esc(catLabel(analysis.cat))}</h1>
      <div class="editorial-hero-meta">
        <span class="editorial-hero-situation">${esc(situationLine)}</span>
        ${leader?`<a href="#/atleta/${encodeURIComponent(leader.atleta_id)}" class="editorial-hero-leader">${esc(leader.cognome)} ${esc(leader.nome)} · ${leader.punti} pt</a>`:''}
      </div>
    </div>
    <div class="editorial-subnav-wrap">
      ${buildHubSubnav(Object.assign({},hub,{_code:analysis.hubCode}))}
    </div>
  </section>`;
}

function buildMainArticleHtml(article, analysis) {
  if (!article) return '';
  const {leader,second,rivalry} = analysis;
  const byline = `Analisi editoriale · ${new Date(article.generatedAt).toLocaleDateString('it-IT',{day:'2-digit',month:'long',year:'numeric'})}`;
  let sectionsHtml = article.sections.map(s=>
    `<div class="article-section">
      <h3 class="article-section-heading">${esc(s.heading)}</h3>
      <p class="article-section-body">${esc(s.body)}</p>
    </div>`
  ).join('');

  // Inline data hook (leader card)
  let dataHookHtml = '';
  if (leader) {
    const gap = second ? `−${leader.punti-second.punti} su ${second.cognome}` : '';
    dataHookHtml = `<div class="article-data-hook">
      <a href="#/atleta/${encodeURIComponent(leader.atleta_id)}" class="adh-leader">
        <span class="adh-pos">1°</span>
        <span class="adh-name">${esc(leader.cognome)} ${esc(leader.nome)}</span>
        <span class="adh-pts">${leader.punti} pt</span>
        ${gap?`<span class="adh-gap">${gap}</span>`:''}
      </a>
      ${second?`<a href="#/atleta/${encodeURIComponent(second.atleta_id)}" class="adh-second">
        <span class="adh-pos">2°</span>
        <span class="adh-name">${esc(second.cognome)} ${esc(second.nome)}</span>
        <span class="adh-pts">${second.punti} pt</span>
      </a>`:''}
    </div>`;
  }

  return `<article class="main-season-article">
    <header class="article-header">
      <div class="article-eyebrow">Racconto di stagione · ${esc(catLabel(article.category))}</div>
      <h2 class="article-title">${esc(article.title)}</h2>
      <div class="article-byline">${byline}</div>
    </header>
    <div class="article-intro">${esc(article.intro)}</div>
    ${dataHookHtml}
    <div class="article-body">${sectionsHtml}</div>
    <footer class="article-footer">
      <p class="article-conclusion">${esc(article.conclusion)}</p>
      <a href="#/hub/${esc(article.hubCode)}/classifica" class="article-cta">Classifica completa →</a>
    </footer>
  </article>`;
}

function buildSecondaryArticlesHtml(articles) {
  if (!articles.length) return '';
  const cards = articles.map(a => {
    const typeLabels = {rivalry:'Rivalità',momentum:'Momento',team:'Squadra',scenario:'Scenario'};
    const typeLabel = typeLabels[a.type]||'Analisi';
    let cta = '';
    if (a.type==='rivalry'&&a.linkA)
      cta=`<div class="sec-art-cta"><a href="${a.linkA}">${esc(a.nameA)}</a> · <a href="${a.linkB}">${esc(a.nameB)}</a></div>`;
    else if (a.type==='momentum'&&a.athleteId)
      cta=`<div class="sec-art-cta"><a href="#/atleta/${encodeURIComponent(a.athleteId)}">Scheda atleta →</a></div>`;
    else
      cta=`<div class="sec-art-cta"><a href="#/hub/${esc(a.hubCode||a.category)}/classifica">Classifica →</a></div>`;

    return `<div class="sec-article sec-article-${esc(a.type)}">
      <div class="sec-art-type">${typeLabel}</div>
      <h3 class="sec-art-title">${esc(a.title)}</h3>
      <p class="sec-art-intro">${esc(a.intro)}</p>
      <p class="sec-art-preview">${esc(a.preview)}</p>
      ${cta}
    </div>`;
  }).join('');
  return `<section class="secondary-articles"><div class="sec-articles-grid">${cards}</div></section>`;
}

function buildHubDataNavHtml(hubCode) {
  const tabs=[
    {sub:'classifica',label:'Classifica'},
    {sub:'risultati', label:'Risultati'},
    {sub:'atleti',    label:'Atleti'},
    {sub:'team',      label:'Team'},
    {sub:'calendario',label:'Calendario'},
    {sub:'statistiche',label:'Stats'},
  ];
  return `<nav class="hub-data-nav" aria-label="Dati della categoria">
    <div class="hub-data-nav-label">ESPLORA</div>
    <div class="hub-data-nav-tabs">
      ${tabs.map(t=>`<a href="#/hub/${esc(hubCode)}/${t.sub}" class="hub-data-tab">${t.label}</a>`).join('')}
    </div>
  </nav>`;
}

// ── renderGenderSelect — pagina scelta categoria ──────────────────
async function renderGenderSelect(hubCode) {
  if (!globalData) return;
  const hub = HUB_CONFIG[hubCode];
  const isMale = hubCode==='uomini';
  const catCodes = isMale
    ? ['elite-m','juniores-m','allievi-m','esordienti-m']
    : ['elite-f','juniores-f','allievi-f','esordienti-f'];

  // Quick stats per categoria
  const stats={};
  for (const code of catCodes) {
    const h = HUB_CONFIG[code];
    const res = globalData.resultsRaw.filter(r=>h.catCodes.includes(getRankingFileCode(r)));
    const wins = res.filter(r=>r.posizione===1).sort((a,b)=>b.data.localeCompare(a.data));
    const races = new Set(res.map(r=>r.gara_id)).size;
    const last = wins[0]||null;
    stats[code]={races, lastWinner:last?esc(last.cognome)+' '+esc(last.nome):null, lastDate:last?.data};
  }

  const cards = catCodes.map(code=>{
    const h=HUB_CONFIG[code], s=stats[code];
    return `<a href="#/hub/${code}" class="cat-entry-card">
      <div class="cat-entry-label">${esc(h.label)}</div>
      <div class="cat-entry-desc">${esc(h.desc)}</div>
      ${s.races>0?`<div class="cat-entry-stat">${s.races} gar${s.races===1?'a':'e'} disputat${s.races===1?'a':'e'}</div>`:''}
      ${s.lastWinner?`<div class="cat-entry-winner">Ultimo vincitore: ${s.lastWinner}</div>`:''}
    </a>`;
  }).join('');

  setPage(`<div class="gender-select-page">
    <div class="gender-select-header">
      <a href="#/" class="gender-select-back">← Home</a>
      <h1 class="gender-select-title">${esc(hub.label)}</h1>
      <div class="gender-select-sub">Seleziona la categoria</div>
    </div>
    <div class="cat-entry-grid">${cards}</div>
    <div class="gender-select-footer">
      <a href="#/news" class="gender-news-link">Tutte le storie della stagione →</a>
    </div>
  </div>`);
}

// ── renderEditorialHub — HUB editoriale per categoria ────────────
async function renderEditorialHub(hubCode) {
  if (!globalData) return;
  const hub = HUB_CONFIG[hubCode];
  if (!hub) { renderNotFound(); return; }
  const cat = hub.mainCat;

  // Loading state
  setPage(`<div class="pg-header" style="background:${hub.gradient||'var(--bg-secondary)'}">
    <div class="pg-eyebrow">${esc(hub.label)}</div>
    <h1 class="pg-title" style="color:#fff">Caricamento…</h1>
  </div>`);

  try {
    const ranking = await loadRanking(cat);
    const analysis = seiaSeasonAnalysis(hubCode, globalData.resultsRaw, ranking);
    if (!analysis) { renderNotFound(); return; }

    const article    = seiaGenerateSeasonArticle(analysis);
    const secondary  = seiaGenerateSecondaryArticles(analysis);
    const contextLine= seiaContextLine(analysis);

    const heroHtml      = buildEditorialHeroHtml(hub, article, analysis);
    const articleHtml   = buildMainArticleHtml(article, analysis);
    const secondaryHtml = buildSecondaryArticlesHtml(secondary);
    const contextHtml   = contextLine
      ? `<div class="hub-context-line"><div class="hub-context-inner">${esc(contextLine)}</div></div>`
      : '';
    const datNavHtml    = buildHubDataNavHtml(hubCode);

    setPage(heroHtml + articleHtml + secondaryHtml + contextHtml + datNavHtml);
  } catch(e) {
    console.error('[renderEditorialHub]', hubCode, e);
    setPage(`<div class="pg-header">
      <div class="pg-eyebrow">${esc(hub.label)}</div>
      <h1 class="pg-title">Errore nel caricamento</h1>
      <p style="color:var(--text-muted);margin-top:12px">${esc(e.message||'Errore sconosciuto')}</p>
      <p style="color:var(--text-muted);font-size:.8rem;margin-top:4px">
        <a href="#/hub/${esc(hubCode)}/classifica" style="color:var(--accent)">Vai alla classifica →</a>
      </p>
    </div>`);
  }
}

// ── renderNews — archivio editoriale globale ─────────────────────
async function renderNews() {
  if (!globalData) return;

  // Determina categoria attiva — se nessuna, mostra tutte
  const newsHub     = (activeHub && activeHub._code && HUB_CONFIG[activeHub._code]) ? activeHub : null;
  const hubCodesToRender = newsHub
    ? [newsHub._code]
    : ['elite-m','juniores-m','allievi-m','esordienti-m',
       'elite-f','juniores-f','allievi-f','esordienti-f'];

  const newsHubObj  = newsHub ? HUB_CONFIG[newsHub._code] : null;
  const heroEyebrow = newsHubObj ? `STAGIONE 2026 · ${newsHubObj.label.toUpperCase()}` : 'STAGIONE 2026';

  // Hero identico agli altri pg-header (Risultati, Classifica, ecc.) — sfondo #0F172A standard
  setPage(`<div class="pg-header">
    <div class="pg-eyebrow">${esc(heroEyebrow)}</div>
    <h1 class="pg-title">Storie della stagione</h1>
  </div>
  <div class="news-page">
    <div class="news-grid-toolbar">
      <span id="news-count" class="news-count-badge"></span>
    </div>
    <div class="news-grid" id="news-grid-inner">
      <p style="color:var(--text-muted);padding:32px 0;grid-column:1/-1">Caricamento articoli…</p>
    </div>
  </div>`);

  try {
    const { resultsRaw } = globalData;

    const allArticles = [];

    for (const hc of hubCodesToRender) {
      const hub = HUB_CONFIG[hc];
      if (!hub) continue;
      const cat = hub.mainCat;
      try {
        const ranking  = await loadRanking(cat);
        if (!ranking || !ranking.length) continue;
        const analysis = seiaSeasonAnalysis(hc, resultsRaw, ranking);
        if (!analysis || !analysis.leader) continue;
        const main     = seiaGenerateSeasonArticle(analysis);
        if (main) allArticles.push({...main, hubCode:hc, hub});
        const secondary = seiaGenerateSecondaryArticles(analysis);
        secondary.forEach(a => allArticles.push({...a, hubCode:hc, hub}));
      } catch(e) {
        console.warn('[renderNews] hub', hc, e.message);
      }
    }

    // Ordina: season_story prima, poi per categoria
    allArticles.sort((a,b) => {
      if (a.type==='season_story' && b.type!=='season_story') return -1;
      if (b.type==='season_story' && a.type!=='season_story') return 1;
      return (a.category||'').localeCompare(b.category||'');
    });

    const typeLabels = {
      season_story:'Racconto di stagione', rivalry:'Rivalità',
      momentum:'Momento', team:'Squadra', scenario:'Scenario'
    };
    const typeColors = {
      season_story:'var(--text-primary)', rivalry:'var(--red-hot)',
      momentum:'#10B981', team:'#3B82F6', scenario:'#8B5CF6'
    };

    const cards = allArticles.map(a => {
      const tl = typeLabels[a.type] || a.type;
      const tc = typeColors[a.type] || 'var(--text-muted)';
      const hubLabel = a.hub ? esc(a.hub.label) : esc(catLabel(a.category));
      let cta = '';
      if (a.type==='season_story')
        cta = `<a href="#/hub/${esc(a.hubCode)}" class="news-card-cta">Leggi il racconto →</a>`;
      else if (a.type==='rivalry' && a.linkA)
        cta = `<a href="${a.linkA}" class="news-card-cta">${esc(a.nameA)} vs ${esc(a.nameB)} →</a>`;
      else if (a.type==='momentum' && a.athleteId)
        cta = `<a href="#/atleta/${encodeURIComponent(a.athleteId)}" class="news-card-cta">Scheda atleta →</a>`;
      else
        cta = `<a href="#/hub/${esc(a.hubCode)}/classifica" class="news-card-cta">Classifica →</a>`;

      return `<div class="news-card news-card-${esc(a.type)}">
        <div class="news-card-meta">
          <span class="news-card-type" style="color:${tc}">${tl}</span>
          <span class="news-card-cat">${hubLabel}</span>
        </div>
        <h3 class="news-card-title">${esc(a.title)}</h3>
        <p class="news-card-intro">${esc(a.intro||a.preview||'')}</p>
        ${cta}
      </div>`;
    }).join('');

    // Aggiorna il grid in-place (evita flash del pg-header)
    const grid = document.getElementById('news-grid-inner');
    if (grid) {
      grid.innerHTML = cards ||
        '<p style="color:var(--text-muted);padding:32px;grid-column:1/-1">Nessun articolo disponibile — dati insufficienti per generare storie.</p>';
    }
    const badge = document.getElementById('news-count');
    if (badge && allArticles.length) badge.textContent = allArticles.length + ' articoli';
  } catch(e) {
    console.error('[renderNews]', e);
    const grid = document.getElementById('news-grid-inner');
    if (grid) grid.innerHTML = `<p style="color:var(--text-muted);padding:32px;grid-column:1/-1">Errore: ${esc(e.message)}</p>`;
  }
}

// ── HOME — la cinematic gate è la home; questa funzione è fallback di emergenza ─
async function renderHome() {
  // Fallback: apre la cinematic se non è già aperta
  if (!document.getElementById('itc-gate')) {
    showCinematicEntry(true);
  }
}

// ── OLD HOME (archivio) — rimossa: logica banner/spotlight ora nel SEIA ──
async function _renderHomeOld_UNUSED() {
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
  if (formaBest[0]) {
    tickerItems.push(`<strong>${formaBest[0].cognome} ${formaBest[0].nome}</strong> — ${formaBest[0].pts} pt · ${catLabel(formaBest[0].code)}`);
  }
  for (const r of heroRaces.slice(0,3)) { const w = r.results?.find(x=>x.posizione===1); if (w) tickerItems.push(`🥇 <strong>${w.cognome.toUpperCase()}</strong> vince ${r.nome}`); }
  if (topScalatori[0]) tickerItems.push(`📈 <strong>SALE:</strong> ${topScalatori[0].cognome} ${topScalatori[0].nome} +${topScalatori[0].gain} posizioni in ${catLabel(topScalatori[0].code)}`);
  if (topScalatori[1]) tickerItems.push(`📈 <strong>SALE:</strong> ${topScalatori[1].cognome} ${topScalatori[1].nome} +${topScalatori[1].gain} posizioni in ${catLabel(topScalatori[1].code)}`);
  const tdTop = Object.values(teamDom)[0];
  if (tdTop) tickerItems.push(`🏆 <strong>DOMINA:</strong> ${tdTop.team} — ${tdTop.wins} vittorie in ${catLabel(tdTop.code)}`);
  if (topTeamTicker) tickerItems.push(`🏆 <strong>TEAM HOT:</strong> ${topTeamTicker.team} — ${topTeamTicker.pts} pt · ${topTeamTicker.vittorie} vitt.`);
  if (upcoming[0]) { const d = Math.round((new Date(upcoming[0].data)-new Date(todayStr))/86400000); tickerItems.push(`📅 <strong>PROSSIMA GARA${d===0?' OGGI':d===1?' DOMANI':''}:</strong> ${upcoming[0].nome}`); }
  if (formaBest.length > 1) { const f = formaBest[1]; tickerItems.push(`<strong>${f.cognome} ${f.nome}</strong> — ${f.pts} pt · ${catLabel(f.code)}`); }

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
        <img src="assets/logo2.png" class="em-hero-logo" alt="ItaliacritResultati" />
        <p class="em-subtitle">Classifiche &middot; Risultati &middot; Storie &middot; Statistiche</p>
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
      const catStr = catLabel(rcCode || r.categoria || '');
      const winnerStr = w ? esc(w.cognome) + ' ' + esc(w.nome) : '—';
      return '<div class="hlr-row" onclick="location.hash=\'#/gara/' + encodeURIComponent(r.id) + '\'">' +
        '<span class="hlr-date">' + dateStr + '</span>' +
        '<div class="hlr-info">' +
          '<div class="hlr-race-name">' + esc(r.nome) + '</div>' +
          '<div class="hlr-winner-name">' + winnerStr + '</div>' +
        '</div>' +
        '<span class="hlr-cat-badge">' + esc(catStr) + '</span>' +
      '</div>';
    }).join('');
    return '<section class="hub-last-results hub-last-results--home">' +
      '<div class="hub-section-header hub-section-header--wide">' +
        '<div class="hub-section-label">🏁 ULTIMI RISULTATI</div>' +
        '<a href="#/risultati" class="hub-section-more">Tutti i risultati &rarr;</a>' +
      '</div>' +
      '<div class="hub-last-list hlr-list">' + rows + '</div>' +
    '</section>';
  })() : '';

  // ── 2. UOMO DEL MOMENTO ───────────────────────────────────────
  const star = formaBest[0];
  const starMomentum = star ? siMomentum(star.atleta_id, resultsRaw, lastRaceDate) : null;
  const spotlightHtml = star ? `<section class="em-spotlight">
    <div class="em-spotlight-bg-name">${esc(star.cognome)}</div>
    <div class="em-spotlight-body">
      <div class="em-spot-meta">
        <span class="em-spot-cat">${catLabel(star.code)}</span>
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

  const flashHtml = '';

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
      <button class="tab-btn ${rankView==='atleti'?'active-cat':''}" onclick="setRankView('atleti')">ATLETI</button>
      <button class="tab-btn ${rankView==='team'?'active-cat':''}" onclick="setRankView('team')">TEAM</button>
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
  const _rkTeamDom = siTeamDominance(globalData.resultsRaw, [rankCat], _rk28cut);
  const _rkWin28 = {};
  for (const r of globalData.resultsRaw.filter(x => x.data >= _rk28cut && x.posizione === 1)) {
    const code = getRankingFileCode(r); if (!code || code !== rankCat) continue;
    if (!_rkWin28[r.atleta_id]) _rkWin28[r.atleta_id] = { atleta_id:r.atleta_id, cognome:r.cognome, nome:r.nome, code, wins:0 };
    _rkWin28[r.atleta_id].wins++;
  }
  const _rkTopWinner = Object.values(_rkWin28).sort((a,b)=>b.wins-a.wins)[0]||null;
  const _rkTopDom    = _rkTeamDom[rankCat] || null;
  const _rkIntelParts = [];
  if (_rkTopWinner) _rkIntelParts.push(
    '<a href="#/atleta/' + encodeURIComponent(_rkTopWinner.atleta_id) + '" class="rk-intel-link">' + esc(_rkTopWinner.cognome) + '</a>' +
    ' — ' + _rkTopWinner.wins + ' vittori' + (_rkTopWinner.wins === 1 ? 'a' : 'e') + ' nelle ultime 4 settimane'
  );
  if (_rkTopDom) _rkIntelParts.push(
    '<a href="#/team/' + encodeURIComponent(_rkTopDom.team_id) + '" class="rk-intel-link">' + esc(_rkTopDom.team) + '</a>' +
    ' il team più vincente in questa categoria'
  );
  const _rkIntelHtml = _rkIntelParts.length
    ? '<p class="rk-intel-line">' + _rkIntelParts.join(' &middot; ') + '</p>'
    : '';

  setPage(`
    <div class="pg-header">
      <div class="pg-eyebrow">CLASSIFICA UFFICIALE</div>
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

    // Ricalcola trend: classifica prima dell'ultimo giorno di gara vs classifica attuale.
    // NON usiamo rank_dopo_gara perché confronta due snapshot personali dell'atleta,
    // ignorando che altri corridori abbiano gareggiato nel frattempo e modificato la graduatoria.
    // Il confronto corretto è: posizione PRIMA delle gare dell'ultimo giorno vs posizione DOPO.
    {
      const catResults = globalData.resultsRaw.filter(r =>
        getRankingFileCode(r) === rankCat && r.data && r.atleta_id && (r.punti_effettivi || 0) > 0
      );
      // Ultimo giorno con risultati in questa categoria
      const latestDate = catResults.reduce((mx, r) => r.data > mx ? r.data : mx, '');

      if (latestDate) {
        // Ranking attuale (punti cumulati con TUTTI i risultati disponibili)
        const curPts = {};
        for (const r of catResults) {
          curPts[r.atleta_id] = (curPts[r.atleta_id] || 0) + (r.punti_effettivi || 0);
        }
        const curRankMap = {};
        Object.entries(curPts).sort(([,a],[,b]) => b-a).forEach(([id], i) => { curRankMap[id] = i + 1; });

        // Ranking prima dell'ultimo giorno (esclude risultati di latestDate)
        const prevPts = {};
        for (const r of catResults.filter(r => r.data < latestDate)) {
          prevPts[r.atleta_id] = (prevPts[r.atleta_id] || 0) + (r.punti_effettivi || 0);
        }
        const prevRankMap = {};
        Object.entries(prevPts).sort(([,a],[,b]) => b-a).forEach(([id], i) => { prevRankMap[id] = i + 1; });

        ranking.forEach(entry => {
          const cur  = curRankMap[entry.atleta_id];
          const prev = prevRankMap[entry.atleta_id];
          if (cur != null && prev != null) {
            entry.trend = prev - cur; // positivo = salita, negativo = discesa
          } else if (cur != null && prev == null) {
            entry.trend = null; // nuovo in classifica nell'ultimo giorno
          }
          // altrimenti lascia invariato il trend del JSON
        });
      }
    }

    const filtered = ranking.filter(r => {
      if (!rankFilter) return true;
      const q = rankFilter.toLowerCase();
      return (r.cognome||'').toLowerCase().includes(q) ||
             (r.nome||'').toLowerCase().includes(q) ||
             (r.team_nome||'').toLowerCase().includes(q);
    });
    countLabel = `${filtered.length} atleti`;

    // ── Championship intelligence ─────────────────────────────
    const _rkLastDate2 = globalData.resultsRaw.reduce((mx,r)=>(r.data||'')>mx?r.data:mx,'');
    const leaderPts    = filtered[0]?.punti || 0;

    // Precompute momentum for top 20 (text only, no emoji)
    const _momCache2 = {};
    for (const entry of filtered.slice(0, 20)) {
      _momCache2[entry.atleta_id] = siMomentum(entry.atleta_id, globalData.resultsRaw, _rkLastDate2);
    }

    // Weekly storytelling banner
    let storyHtml = '';
    if (!isFiltered) {
      const storyLines = buildWeeklyNarrative(filtered, globalData.resultsRaw, rankCat);
      if (storyLines.length) {
        storyHtml = `
          <div class="rk-story-banner">
            <div class="rk-story-label">NOVITÀ IN CLASSIFICA</div>
            <div class="rk-story-lines">
              ${storyLines.map(l => `<div class="rk-story-line">${l}</div>`).join('')}
            </div>
          </div>`;
      }
    }

    const rows = filtered.map((r, i) => {
      const pClass = posClass(r.pos);
      const tier   = r.pos === 1 ? 'rk-tier-1' : r.pos <= 3 ? 'rk-tier-top3' : r.pos <= 10 ? 'rk-tier-top10' : '';
      const gap    = r.pos === 1
        ? ''
        : `<span class="rk-gap-label">−${leaderPts - r.punti}</span>`;
      return `<tr class="ranking-row ${tier}" style="animation-delay:${Math.min(i,20)*30}ms">
        <td><span class="rank-num ${pClass}">${r.pos}</span></td>
        <td style="text-align:center;width:40px">${renderTrend(r)}</td>
        <td>
          <div class="rk-athlete-cell">
            <span class="rank-name"><a href="#/atleta/${esc(r.atleta_id)}">${esc(r.cognome)} ${esc(r.nome)}</a></span>
            <div class="td-team-mobile"><a href="#/team/${esc(r.team_id)}" style="color:var(--text-secondary)">${esc(r.team_nome)}</a></div>
          </div>
        </td>
        <td class="hide-mobile"><a href="#/team/${esc(r.team_id)}" style="color:var(--text-secondary);font-size:.85rem">${esc(r.team_nome)}</a></td>
        <td class="r">
          <div class="rk-pts-cell">
            <span class="rank-pts">${r.punti}</span>
            ${gap}
          </div>
        </td>
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

    tableHtml = storyHtml + `
      <table class="ranking-table">
        <thead><tr>
          <th style="width:50px">POS</th>
          <th style="width:40px" title="Variazione">↕</th>
          <th>ATLETA</th>
          <th class="hide-mobile">TEAM</th>
          <th class="r">PUNTI</th>
          <th class="hide-mobile">1° / 2° / 3° / TOP10</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="empty-state">Nessun dato</td></tr>'}</tbody>
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
        <td style="text-align:center;width:40px">${renderTrend(t, false)}</td>
        <td><span class="rank-name"><a href="#/team/${esc(t.team_id)}">${esc(t.team_nome)}</a></span></td>
        <td class="r"><span class="rank-pts">${t.punti}</span></td>
        <td class="r hide-mobile" style="font-family:var(--font-mono);font-size:.85rem;color:var(--text-muted)">${t.n_atleti||0}</td>
      </tr>`;
    }).join('');

    tableHtml = `
      <table class="ranking-table">
        <thead><tr>
          <th style="width:50px">POS</th>
          <th style="width:40px" title="Variazione">↕</th>
          <th>TEAM</th>
          <th class="r">PUNTI</th>
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

    <!-- ═══════════════════════════════════════════════════════ -->
    <!-- XPIX AUTO-FOTO                                         -->
    <!-- ═══════════════════════════════════════════════════════ -->
    <div style="margin-top:40px">
      <h2 style="font-family:var(--font-display);font-size:1.2rem;margin-bottom:4px;border-bottom:2px solid #0ea5e9;padding-bottom:8px;display:flex;align-items:center;gap:8px">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        XPIX AUTO-FOTO
      </h2>
      <p style="font-size:.8rem;color:var(--text-muted);margin:0 0 12px">
        Scarica automaticamente le foto watermarked da xpix.it e abbinale alle gare. Clicca Sync per aggiornare.
      </p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
        <button onclick="window.xpixSync()" id="xpix-sync-btn"
          style="background:#0ea5e9;color:#fff;border:none;padding:9px 20px;border-radius:6px;font-weight:700;cursor:pointer;font-size:.875rem">
          🔄 Sincronizza Xpix
        </button>
        <span id="xpix-sync-status" style="font-size:.8rem;color:var(--text-muted)"></span>
      </div>
      <div id="xpix-queue-container">
        <div style="color:var(--text-muted);font-size:.85rem">Premi "Sincronizza Xpix" per scaricare le foto.</div>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════ -->
    <!-- ITALIACICLISMO AUTO-FOTO                               -->
    <!-- ═══════════════════════════════════════════════════════ -->
    <div style="margin-top:40px">
      <h2 style="font-family:var(--font-display);font-size:1.2rem;margin-bottom:4px;border-bottom:2px solid #8b5cf6;padding-bottom:8px;display:flex;align-items:center;gap:8px">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        ITALIACICLISMO.NET AUTO-FOTO
      </h2>
      <p style="font-size:.8rem;color:var(--text-muted);margin:0 0 12px">
        Scarica automaticamente le foto da italiaciclismo.net (HTTP) e abbinale alle gare.
      </p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
        <button onclick="window.icSync()" id="ic-sync-btn"
          style="background:#8b5cf6;color:#fff;border:none;padding:9px 20px;border-radius:6px;font-weight:700;cursor:pointer;font-size:.875rem">
          🔄 Sincronizza ItaliaCiclismo
        </button>
        <span id="ic-sync-status" style="font-size:.8rem;color:var(--text-muted)"></span>
      </div>
      <div id="ic-queue-container">
        <div style="color:var(--text-muted);font-size:.85rem">Premi "Sincronizza ItaliaCiclismo" per scaricare le foto.</div>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════ -->
    <!-- YOUTUBE AUTO-SYNC                                       -->
    <!-- ═══════════════════════════════════════════════════════ -->
    <div style="margin-top:40px">
      <h2 style="font-family:var(--font-display);font-size:1.2rem;margin-bottom:4px;border-bottom:2px solid #ef4444;padding-bottom:8px;display:flex;align-items:center;gap:8px">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#ef4444"><path d="M23.5 6.2s-.3-1.8-1-2.6c-1-.9-2-.9-2.5-1C17.1 2.4 12 2.4 12 2.4s-5.1 0-8 .2c-.5.1-1.5.1-2.5 1-.7.8-1 2.6-1 2.6S.2 8.2.2 10.2v1.8c0 2 .3 4 .3 4s.3 1.8 1 2.6c1 .9 2.2.9 2.8 1 2 .2 8.7.2 8.7.2s5.1 0 8-.2c.5-.1 1.5-.1 2.5-1 .7-.8 1-2.6 1-2.6s.3-2 .3-4v-1.8c0-2-.3-4-.3-4zM9.7 15.1V8.6l6.7 3.3-6.7 3.2z"/></svg>
        YOUTUBE AUTO-SYNC
      </h2>
      <p style="font-size:.8rem;color:var(--text-muted);margin:0 0 12px">
        Scarica automaticamente i video dai canali YouTube configurati e abbinali alle gare. Clicca Sync per aggiornare.
      </p>

      <!-- Controlli sync -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
        <button onclick="window.ytSync()" id="yt-sync-btn"
          style="background:#ef4444;color:#fff;border:none;padding:9px 20px;border-radius:6px;font-weight:700;cursor:pointer;font-size:.875rem">
          🔄 Sincronizza Canali
        </button>
        <button onclick="window.ytShowChannels()" id="yt-channels-btn"
          style="background:var(--bg-card);border:1px solid var(--border);color:var(--text-primary);padding:9px 16px;border-radius:6px;cursor:pointer;font-size:.875rem">
          ⚙️ Gestisci Canali
        </button>
        <span id="yt-sync-status" style="font-size:.8rem;color:var(--text-muted)"></span>
      </div>

      <!-- Channel manager (nascosto) -->
      <div id="yt-channels-panel" style="display:none;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px">
        <div style="font-weight:700;font-size:.875rem;margin-bottom:10px">Canali YouTube configurati</div>
        <div id="yt-channels-list"></div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button onclick="window.ytAddChannel()"
            style="background:var(--accent);color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-size:.8rem">+ Aggiungi canale</button>
          <button onclick="window.ytSaveChannels()"
            style="background:#16a34a;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-size:.8rem">💾 Salva</button>
        </div>
      </div>

      <!-- Coda matching -->
      <div id="yt-queue-container">
        <div style="color:var(--text-muted);font-size:.85rem">Premi "Sincronizza Canali" per scaricare i video.</div>
      </div>
    </div>

    <div style="margin-top:40px">
      <h2 style="font-family:var(--font-display);font-size:1.2rem;margin-bottom:8px;border-bottom:2px solid var(--accent);padding-bottom:8px">
        🎥 GESTIONE VIDEO APPROVATI
      </h2>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;align-items:center">
        <button class="btn-action" onclick="window.adminShowAddVideo()" style="background:var(--accent);color:white;border:none;padding:8px 18px;border-radius:6px;font-size:.85rem">+ Aggiungi video</button>
        <input type="search" id="admin-video-search" placeholder="Filtra per nome gara…" oninput="window.adminFilterVideos(this.value)"
          style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text-primary);font-size:.85rem;flex:1;min-width:180px" />
      </div>
      <div id="admin-add-video-form" style="display:none;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px">
        <div style="font-weight:700;margin-bottom:12px;font-size:.9rem">Aggiungi video manualmente</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div>
            <label style="font-size:.8rem;color:var(--text-muted);display:block;margin-bottom:4px">Cerca gara (id calendario)</label>
            <input type="search" id="avf-race-search" placeholder="Digita nome gara…" oninput="window.adminSearchCalRace(this.value)"
              style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input,var(--bg-card));color:var(--text-primary);font-size:.85rem;box-sizing:border-box" />
            <div id="avf-race-results" style="display:none;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;max-height:180px;overflow-y:auto;margin-top:4px"></div>
            <div id="avf-race-selected" style="font-size:.8rem;color:var(--accent);margin-top:4px;font-weight:600"></div>
          </div>
          <input type="url" id="avf-url" placeholder="URL YouTube (https://www.youtube.com/watch?v=...)"
            oninput="window.adminUrlOembed(this.value)"
            style="padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input,var(--bg-card));color:var(--text-primary);font-size:.85rem" />
          <input type="text" id="avf-title" placeholder="Titolo — compilato automaticamente dall'URL"
            style="padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input,var(--bg-card));color:var(--text-primary);font-size:.85rem" />
          <input type="text" id="avf-channel" placeholder="Autore / Canale — compilato automaticamente dall'URL"
            style="padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input,var(--bg-card));color:var(--text-primary);font-size:.85rem" />
          <div style="display:flex;gap:8px">
            <button onclick="window.adminSubmitAddVideo()" style="background:var(--accent);color:white;border:none;padding:8px 20px;border-radius:6px;font-weight:600;cursor:pointer">Aggiungi</button>
            <button onclick="window.adminShowAddVideo(false)" style="background:transparent;color:var(--text-muted);border:1px solid var(--border);padding:8px 16px;border-radius:6px;cursor:pointer">Annulla</button>
          </div>
        </div>
      </div>
      <div id="admin-videos-all">
        <div style="color:var(--text-muted);padding:20px 0">Caricamento...</div>
      </div>
    </div>

  `);

  loadPendingRacePhotos();
  loadAdminPendingVideos();
  loadAdminAllVideos();
  loadXpixQueue();
  loadICQueue();
  loadYTQueue();
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

// ── VIDEO HELPERS ────────────────────────────────────────────────────────────

// Ricarica videos.json dal server e aggiorna globalData.videos in memoria
// Va chiamato dopo ogni modifica (approva, aggiungi, elimina, modifica)
async function refreshVideos() {
  try {
    const fresh = await fetch(`${API_BASE}/videos`).then(r => r.json());
    if (fresh && globalData) globalData.videos = fresh;
  } catch { /* non bloccante */ }
}

// ── VIDEO IN ATTESA (inviati dagli utenti) ───────────────────────────────────

async function loadAdminPendingVideos() {
  const container = document.getElementById('admin-videos-pending');
  if (!container) return;
  try {
    const { videos } = await apiCall('/admin/videos/pending');
    if (!videos.length) {
      container.innerHTML = `<div style="color:var(--text-muted);padding:20px 0">Nessun video in attesa.</div>`;
      return;
    }
    const calMap = {};
    (globalData?.calendar || []).forEach(g => { calMap[g.id] = g; });

    container.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px">${videos.map(v => {
      const vidId = ytId(v.url || '') || '';
      const thumb = vidId ? `https://img.youtube.com/vi/${vidId}/mqdefault.jpg` : '';
      const calId = v.cal_id || v.gara_id;
      const cal   = calMap[calId];
      const raceName = cal ? `${cal.nome}${cal.data ? ' — ' + cal.data : ''}` : calId;
      return `
      <div id="apv-${v.id}" style="display:flex;gap:12px;align-items:flex-start;background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--r-md);padding:12px">
        ${thumb
          ? `<img src="${thumb}" style="width:110px;height:62px;border-radius:var(--r-sm);flex-shrink:0;object-fit:cover;cursor:pointer" onclick="window.open('${esc(v.url)}','_blank')" />`
          : `<div style="width:110px;height:62px;background:var(--bg-elevated);border-radius:var(--r-sm);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:2rem">🎬</div>`}
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:.875rem;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(v.title)}</div>
          <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:4px">
            👤 ${esc(v.submitted_by||'')} &nbsp;•&nbsp; ${esc((v.submitted_at||'').slice(0,10))}
          </div>
          <div style="font-size:.75rem;margin-bottom:8px">
            <span style="color:var(--text-muted)">Gara: </span>
            <a href="#/calendario/${encodeURIComponent(calId)}" style="color:var(--accent);font-weight:600">${esc(raceName)}</a>
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
    if (action === 'approve') {
      await refreshVideos(); // aggiorna globalData.videos in memoria
      loadAdminAllVideos();
    }
  } catch(e) { alert('Errore: ' + e.message); }
};

// ══════════════════════════════════════════════════════════════════════════════
// YOUTUBE AUTO-SYNC — funzioni frontend
// ══════════════════════════════════════════════════════════════════════════════

// ── Normalizzazione testo per il matching ─────────────────────────────────────
const _YT_STOPWORDS = new Set([
  'il','la','lo','gli','le','di','da','del','della','dei','delle','degli',
  'per','con','a','e','in','è','un','una','ai','al','alla','allo','alle','agli',
  'che','si','non','su','ma','o','se','ed','mi','ti','ci','vi','ne',
  'trofeo','memorial','coppa','gran','premio','gp','gara','corsa',
  'ciclismo','ciclistica','ciclistico','cicli','anno','edizione','bike',
]);

function _ytNorm(str) {
  return (str || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // rimuovi accenti
    .replace(/[°^°'`\-–—()[\]{}|/:.,;!?*#@&+%]/g, ' ')
    .replace(/\d+[°^]/g, '')           // "63^" "14°" → rimuovi
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, '')  // date (26/04/2026)
    .replace(/\b\d{4}\b/g, '')         // anni 4 cifre
    .replace(/\b\d+\b/g, '')           // numeri rimasti
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length >= 3 && !_YT_STOPWORDS.has(w));
}

// ── Estrai categoria dal titolo video ────────────────────────────────────────
function _ytExtractCat(title) {
  const t = (title || '').toLowerCase();
  if (/juniores?|junior/i.test(t))   return 'JUN';
  if (/allievi|allieva|alliev/i.test(t)) return 'AL';
  if (/esordienti|esordient/i.test(t)) return 'ES';
  if (/elite|élite/i.test(t))         return 'ELI';
  if (/under.?23|u\.?23/i.test(t))    return 'U23';
  if (/giovanissim/i.test(t))         return 'GIO';
  return null;
}

// ── Score di matching titolo video ↔ gara ────────────────────────────────────
function _ytScore(videoTitle, race) {
  const vtWords = new Set(_ytNorm(videoTitle));
  const rWords  = new Set(_ytNorm(race.nome_gara));
  if (!vtWords.size || !rWords.size) return 0;

  let overlap = 0;
  for (const w of vtWords) { if (rWords.has(w)) overlap++; }
  const ratio = overlap / Math.max(vtWords.size, rWords.size);

  // Bonus categoria
  const vtCat  = _ytExtractCat(videoTitle);
  const raceCat = race.categoria || '';
  let catBonus = 0;
  if (vtCat && raceCat.startsWith(vtCat)) catBonus = 0.25;

  // Bonus data: anno dal titolo vs anno della gara
  const ytYear = (videoTitle.match(/\b(202\d)\b/) || [])[1];
  const raceYear = (race.data || '').slice(0, 4);
  const dateBonus = (ytYear && raceYear && ytYear === raceYear) ? 0.1 : 0;

  return Math.min(1, ratio + catBonus + dateBonus);
}

// ── Trova le migliori gare candidate per un video ───────────────────────────
function _ytFindMatches(videoTitle, maxResults = 5) {
  const races = (globalData?.resultsRaw || []);
  // Deduplica per gara_id
  const seen = new Set();
  const unique = races.filter(r => { if (seen.has(r.gara_id)) return false; seen.add(r.gara_id); return true; });

  return unique
    .map(r => ({ race: r, score: _ytScore(videoTitle, r) }))
    .filter(x => x.score > 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

// ── Stato locale della queue ──────────────────────────────────────────────────
let _ytQueue = [];
let _ytChannels = [];
let _ytItemGaraMap = {}; // id → gara_id selezionato

// ── Carica e mostra la queue ──────────────────────────────────────────────────
async function loadYTQueue() {
  const container = document.getElementById('yt-queue-container');
  if (!container) return;
  try {
    const { queue } = await apiCall('/admin/youtube/queue', { method: 'GET' });
    _ytQueue = queue || [];
    renderYTQueue();
  } catch (e) {
    if (container) container.innerHTML = `<div style="color:var(--text-muted);font-size:.85rem">Errore caricamento queue: ${esc(e.message)}</div>`;
  }
}

function renderYTQueue() {
  const container = document.getElementById('yt-queue-container');
  if (!container) return;

  const pending   = _ytQueue.filter(q => q.status === 'pending');
  const dismissed = _ytQueue.filter(q => q.status === 'dismissed').length;
  const approved  = _ytQueue.filter(q => q.status === 'approved').length;

  if (!_ytQueue.length) {
    container.innerHTML = `<div style="color:var(--text-muted);font-size:.85rem;padding:16px 0">Nessun video in coda. Clicca "Sincronizza Canali".</div>`;
    return;
  }

  const stats = `<div style="font-size:.8rem;color:var(--text-muted);margin-bottom:12px">
    📋 In attesa: <strong style="color:var(--text-primary)">${pending.length}</strong>
    &nbsp;•&nbsp; ✓ Approvati: ${approved}
    &nbsp;•&nbsp; ✗ Scartati: ${dismissed}
  </div>`;

  if (!pending.length) {
    container.innerHTML = stats + `<div style="color:var(--text-muted);font-size:.85rem">Tutti i video sono stati elaborati.</div>`;
    return;
  }

  const rows = pending.map(item => {
    const matches   = _ytFindMatches(item.title);
    const best      = matches[0];
    const score     = best ? Math.round(best.score * 100) : 0;
    const scoreColor = score >= 70 ? '#16a34a' : score >= 40 ? '#d97706' : '#6b7280';
    const bestGaraId = _ytItemGaraMap[item.id] || (best ? best.race.gara_id : '');
    const bestRaceName = best
      ? `${best.race.nome_gara} — ${best.race.categoria || ''} ${best.race.genere || ''} (${best.race.data || ''})`
      : 'Nessuna corrispondenza trovata';

    const optionsHtml = matches.map(m => {
      const genLabel = m.race.genere === 'F' ? '♀ ' : m.race.genere === 'M' ? '♂ ' : '';
      const label = `${genLabel}${m.race.nome_gara} — ${m.race.categoria||''} (${m.race.data||''}) [${Math.round(m.score*100)}%]`;
      const sel   = m.race.gara_id === bestGaraId ? ' selected' : '';
      return `<option value="${esc(m.race.gara_id)}"${sel}>${esc(label)}</option>`;
    }).join('');

    return `
    <div id="ytq-${esc(item.id)}" style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px;display:flex;gap:12px;align-items:flex-start">
      <!-- Thumbnail -->
      <img src="${esc(item.thumbnail||'')}" alt="" style="width:100px;height:60px;border-radius:5px;object-fit:cover;flex-shrink:0;cursor:pointer"
        onerror="this.style.display='none'" onclick="window.open('${esc(item.url)}','_blank')" />
      <!-- Info -->
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:.85rem;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(item.title)}">${esc(item.title)}</div>
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:6px">
          📺 ${esc(item.channel_name||'')} &nbsp;•&nbsp; 📅 ${esc(item.published_at||'')}
          ${score ? `&nbsp;•&nbsp; <span style="color:${scoreColor};font-weight:700">${score}% match</span>` : ''}
        </div>
        <!-- Selezione gara -->
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
          <select onchange="window.ytSetGara('${esc(item.id)}', this.value)"
            style="flex:1;min-width:180px;padding:5px 8px;border:1px solid var(--border);border-radius:5px;background:var(--bg-primary);color:var(--text-primary);font-size:.78rem">
            <option value="">— Seleziona gara —</option>
            ${optionsHtml}
            <option value="__search__">🔍 Cerca altra gara…</option>
          </select>
        </div>
        <div id="ytq-search-${esc(item.id)}" style="display:none;margin-bottom:6px">
          <input type="text" placeholder="Cerca gara per nome…" oninput="window.ytSearchGara('${esc(item.id)}',this.value)"
            style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid var(--border);border-radius:5px;background:var(--bg-primary);color:var(--text-primary);font-size:.78rem" />
          <div id="ytq-sr-${esc(item.id)}" style="background:var(--bg-card);border:1px solid var(--border);border-radius:5px;max-height:160px;overflow-y:auto;margin-top:2px"></div>
        </div>
        <!-- Azioni -->
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button onclick="window.ytApprove('${esc(item.id)}')"
            style="background:#16a34a;color:#fff;border:none;padding:5px 14px;border-radius:5px;cursor:pointer;font-size:.78rem;font-weight:700">
            ✓ Pubblica
          </button>
          <button onclick="window.ytDismiss('${esc(item.id)}')"
            style="background:transparent;border:1px solid #ef4444;color:#ef4444;padding:5px 12px;border-radius:5px;cursor:pointer;font-size:.78rem">
            ✗ Scarta
          </button>
        </div>
      </div>
    </div>`;
  }).join('');

  container.innerHTML = stats + rows;
}

// ── Sync ─────────────────────────────────────────────────────────────────────
window.ytSync = async () => {
  const btn    = document.getElementById('yt-sync-btn');
  const status = document.getElementById('yt-sync-status');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Sincronizzazione…'; }
  if (status) status.textContent = '';
  try {
    const r = await apiCall('/admin/youtube/sync', { method: 'POST' });
    if (status) status.textContent = `✓ +${r.added} nuovi video trovati (totale in coda: ${r.total})`;
    await loadYTQueue();
  } catch (e) {
    if (status) status.textContent = '✗ Errore: ' + e.message;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Sincronizza Canali'; }
  }
};

// ── Imposta gara per un item della queue ─────────────────────────────────────
window.ytSetGara = (id, garaId) => {
  if (garaId === '__search__') {
    const sr = document.getElementById('ytq-search-' + id);
    if (sr) sr.style.display = 'block';
    return;
  }
  _ytItemGaraMap[id] = garaId;
};

// ── Cerca gara per nome (ricerca live) ───────────────────────────────────────
window.ytSearchGara = (id, q) => {
  const resultsEl = document.getElementById('ytq-sr-' + id);
  if (!resultsEl) return;
  if (!q || q.length < 2) { resultsEl.innerHTML = ''; return; }
  const seen = new Set();
  const matches = (globalData?.resultsRaw || [])
    .filter(r => {
      if (seen.has(r.gara_id)) return false;
      seen.add(r.gara_id);
      return (r.nome_gara||'').toLowerCase().includes(q.toLowerCase())
          || r.gara_id.toLowerCase().includes(q.toLowerCase());
    })
    .sort((a, b) => (b.data||'').localeCompare(a.data||''))
    .slice(0, 8);

  resultsEl.innerHTML = matches.map(r => {
    const label = `${r.nome_gara} — ${r.categoria||''} ${r.genere||''} (${r.data||''})`;
    return `<div onclick="window.ytPickGara('${esc(id)}','${esc(r.gara_id)}')"
      style="padding:6px 10px;cursor:pointer;font-size:.78rem;border-bottom:1px solid var(--border-subtle);hover:background:var(--bg-elevated)">
      ${esc(label)}
    </div>`;
  }).join('') || '<div style="padding:6px 10px;font-size:.78rem;color:var(--text-muted)">Nessun risultato</div>';
};

window.ytPickGara = (id, garaId) => {
  _ytItemGaraMap[id] = garaId;
  const sr = document.getElementById('ytq-search-' + id);
  if (sr) sr.style.display = 'none';
  // Aggiorna il select per mostrare la selezione
  const sel = document.querySelector(`#ytq-${id} select`);
  if (sel) {
    // Rimuovi opzioni extra e aggiungi quella selezionata se non c'è
    const existing = [...sel.options].find(o => o.value === garaId);
    if (!existing) {
      const r = (globalData?.resultsRaw || []).find(x => x.gara_id === garaId);
      if (r) {
        const opt = document.createElement('option');
        opt.value = garaId;
        opt.textContent = `${r.nome_gara} — ${r.categoria||''} ${r.genere||''} (${r.data||''})`;
        sel.insertBefore(opt, sel.firstChild);
      }
    }
    sel.value = garaId;
  }
};

// ── Approva e pubblica ────────────────────────────────────────────────────────
window.ytApprove = async (id) => {
  const garaId = _ytItemGaraMap[id]
    || document.querySelector(`#ytq-${id} select`)?.value
    || '';
  if (!garaId || garaId === '__search__') { showToast('Seleziona prima una gara', 'error'); return; }
  const item = _ytQueue.find(q => q.id === id);
  if (!item) return;
  try {
    await apiCall(`/admin/youtube/queue/${id}/approve`, {
      method: 'POST',
      body: { gara_id: garaId, title: item.title, channel: item.channel_name },
    });
    document.getElementById('ytq-' + id)?.remove();
    item.status = 'approved';
    showToast('✓ Video pubblicato!');
    await refreshVideos();
    loadAdminAllVideos();
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

// ── Scarta ────────────────────────────────────────────────────────────────────
window.ytDismiss = async (id) => {
  try {
    await apiCall(`/admin/youtube/queue/${id}`, { method: 'DELETE' });
    document.getElementById('ytq-' + id)?.remove();
    const item = _ytQueue.find(q => q.id === id);
    if (item) item.status = 'dismissed';
    showToast('Video scartato', 'info');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

// ── Gestione canali ───────────────────────────────────────────────────────────
window.ytShowChannels = async () => {
  const panel = document.getElementById('yt-channels-panel');
  if (!panel) return;
  const visible = panel.style.display !== 'none';
  if (visible) { panel.style.display = 'none'; return; }
  try {
    const { channels } = await apiCall('/admin/youtube/channels', { method: 'GET' });
    _ytChannels = channels || [];
    renderYTChannelsList();
    panel.style.display = 'block';
  } catch (e) { showToast('Errore caricamento canali: ' + e.message, 'error'); }
};

function renderYTChannelsList() {
  const el = document.getElementById('yt-channels-list');
  if (!el) return;
  const inpS = 'padding:5px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-primary);color:var(--text-primary);font-size:.78rem';
  el.innerHTML = _ytChannels.map((ch, i) => `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap" id="ytch-row-${i}">
      <input type="text" value="${esc(ch.name)}" oninput="window._ytChEdit(${i},'name',this.value)"
        placeholder="Nome" style="${inpS};flex:1;min-width:100px" />
      <select onchange="window._ytChEdit(${i},'type',this.value)"
        style="${inpS}">
        <option value="channel_id"${ch.type==='channel_id'?' selected':''}>Channel ID (UC...)</option>
        <option value="username"${ch.type==='username'?' selected':''}>Username</option>
      </select>
      <input type="text" value="${esc(ch.value)}" oninput="window._ytChEdit(${i},'value',this.value)"
        placeholder="ID o username" style="${inpS};flex:2;min-width:140px" />
      <label style="display:flex;align-items:center;gap:4px;font-size:.78rem;cursor:pointer">
        <input type="checkbox" ${ch.enabled?'checked':''} onchange="window._ytChEdit(${i},'enabled',this.checked)" />
        Attivo
      </label>
      <button onclick="window._ytChRemove(${i})" style="background:transparent;border:1px solid #ef4444;color:#ef4444;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:.75rem">✕</button>
    </div>`).join('') || '<div style="color:var(--text-muted);font-size:.8rem">Nessun canale configurato.</div>';
}

window._ytChEdit = (i, key, val) => {
  if (_ytChannels[i]) _ytChannels[i][key] = val;
};
window._ytChRemove = (i) => {
  _ytChannels.splice(i, 1);
  renderYTChannelsList();
};
window.ytAddChannel = () => {
  _ytChannels.push({ id: 'ch_' + Date.now(), name: '', type: 'channel_id', value: '', enabled: true });
  renderYTChannelsList();
};
window.ytSaveChannels = async () => {
  // Assegna ID se mancante
  _ytChannels.forEach((ch, i) => { if (!ch.id) ch.id = 'ch_' + i; });
  try {
    await apiCall('/admin/youtube/channels', { method: 'PUT', body: { channels: _ytChannels } });
    showToast('✓ Canali salvati!');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

// ══════════════════════════════════════════════════════════════════════════════
// XPIX AUTO-FOTO — funzioni frontend
// ══════════════════════════════════════════════════════════════════════════════

let _xpixQueue = [];
let _xpixItemGaraMap = {};   // id → gara_id selezionato

// Riusa le stesse funzioni di normalizzazione/scoring di YouTube
function _xpixScore(albumName, race) {
  // Strip province codes "(Fi)", "(Vi)", "(Mo)" etc. from album name
  const cleanAlbum = albumName.replace(/\([A-Z]{2}\)/g, '').replace(/\s+/g, ' ');
  return _ytScore(cleanAlbum, race);
}

function _xpixFindMatches(albumName, maxResults = 12) {
  const races = (globalData?.resultsRaw || []);
  const seen = new Set();
  // Deduplicazione: per Esordienti mostra solo ES1 (canonico), non ES2 separato
  const unique = races.filter(r => {
    // Normalizza ES2 → ES1 per deduplicare
    const key = (r.gara_id || '').replace(/_ES2_([MF])$/, '_ES1_$1');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique
    .map(r => ({ race: r, score: _xpixScore(albumName, r) }))
    .filter(x => x.score > 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

async function loadXpixQueue() {
  const container = document.getElementById('xpix-queue-container');
  if (!container) return;
  try {
    const { queue } = await apiCall('/admin/xpix/queue', { method: 'GET' });
    _xpixQueue = queue || [];
    renderXpixQueue();
  } catch (e) {
    if (container) container.innerHTML = `<div style="color:var(--text-muted);font-size:.85rem">Errore caricamento queue xpix: ${esc(e.message)}</div>`;
  }
}

function renderXpixQueue() {
  const container = document.getElementById('xpix-queue-container');
  if (!container) return;

  const pending   = _xpixQueue.filter(q => q.status === 'pending');
  const dismissed = _xpixQueue.filter(q => q.status === 'dismissed').length;
  const approved  = _xpixQueue.filter(q => q.status === 'approved').length;

  if (!_xpixQueue.length) {
    container.innerHTML = `<div style="color:var(--text-muted);font-size:.85rem;padding:16px 0">Nessuna foto in coda. Clicca "Sincronizza Xpix".</div>`;
    return;
  }

  const stats = `<div style="font-size:.8rem;color:var(--text-muted);margin-bottom:12px">
    📋 In attesa: <strong style="color:var(--text-primary)">${pending.length}</strong>
    &nbsp;•&nbsp; ✓ Approvate: ${approved}
    &nbsp;•&nbsp; ✗ Scartate: ${dismissed}
  </div>`;

  if (!pending.length) {
    container.innerHTML = stats + `<div style="color:var(--text-muted);font-size:.85rem">Tutte le foto sono state elaborate.</div>`;
    return;
  }

  const rows = pending.map(item => {
    const matches     = _xpixFindMatches(item.album_name);
    const best        = matches[0];
    const score       = best ? Math.round(best.score * 100) : 0;
    const scoreColor  = score >= 70 ? '#16a34a' : score >= 40 ? '#d97706' : '#6b7280';
    const bestGaraId  = _xpixItemGaraMap[item.id] || (best ? best.race.gara_id : '');

    const optionsHtml = matches.map(m => {
      const genLabel = m.race.genere === 'F' ? '♀ ' : m.race.genere === 'M' ? '♂ ' : '';
      const label = `${genLabel}${m.race.nome_gara} — ${m.race.categoria||''} (${m.race.data||''}) [${Math.round(m.score*100)}%]`;
      const sel   = m.race.gara_id === bestGaraId ? ' selected' : '';
      return `<option value="${esc(m.race.gara_id)}"${sel}>${esc(label)}</option>`;
    }).join('');

    // Griglia foto selezionabili
    const allPhotos = item.photos && item.photos.length ? item.photos : (item.photo_url ? [item.photo_url] : []);
    const photosGridHtml = allPhotos.map((url, pi) => {
      const isSelected = (url === (item.photo_url || allPhotos[0]));
      return `<img src="${esc(url)}" data-url="${esc(url)}" data-id="${esc(item.id)}"
        onclick="window.xpixSelectPhoto('${esc(item.id)}',this)"
        style="width:80px;height:54px;object-fit:cover;border-radius:4px;cursor:pointer;border:2px solid ${isSelected ? '#0ea5e9' : 'transparent'};transition:border-color .15s;flex-shrink:0"
        onerror="this.style.display='none'" title="Clicca per selezionare" />`;
    }).join('');

    return `
    <div id="xpixq-${esc(item.id)}" style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px">
      <!-- Header: nome album + meta -->
      <div style="font-weight:600;font-size:.85rem;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(item.album_name)}">${esc(item.album_name)}</div>
      <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:8px">
        📸 ${item.photo_count||'?'} foto totali
        ${score ? `&nbsp;•&nbsp; <span style="color:${scoreColor};font-weight:700">${score}% match</span>` : ''}
        &nbsp;•&nbsp; <a href="${esc(item.album_page||'#')}" target="_blank" style="color:var(--accent)">Apri album completo ↗</a>
      </div>
      <!-- Griglia foto: clicca per selezionare quella da pubblicare -->
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;padding:8px;background:var(--bg-elevated);border-radius:6px">
        <div style="width:100%;font-size:.72rem;color:var(--text-muted);margin-bottom:4px">👇 Clicca la foto da usare (bordo blu = selezionata)</div>
        ${photosGridHtml || '<span style="font-size:.8rem;color:var(--text-muted)">Nessuna foto disponibile</span>'}
      </div>
      <!-- Selezione gara + azioni -->
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
        <select onchange="window.xpixSetGara('${esc(item.id)}', this.value)"
          style="flex:1;min-width:180px;padding:5px 8px;border:1px solid var(--border);border-radius:5px;background:var(--bg-primary);color:var(--text-primary);font-size:.78rem">
          <option value="">— Seleziona gara —</option>
          ${optionsHtml}
          <option value="__search__">🔍 Cerca altra gara…</option>
        </select>
      </div>
      <div id="xpixq-search-${esc(item.id)}" style="display:none;margin-bottom:6px">
        <input type="text" placeholder="Cerca gara per nome…" oninput="window.xpixSearchGara('${esc(item.id)}',this.value)"
          style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid var(--border);border-radius:5px;background:var(--bg-primary);color:var(--text-primary);font-size:.78rem" />
        <div id="xpixq-sr-${esc(item.id)}" style="background:var(--bg-card);border:1px solid var(--border);border-radius:5px;max-height:160px;overflow-y:auto;margin-top:2px"></div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button onclick="window.xpixApprove('${esc(item.id)}')"
          style="background:#16a34a;color:#fff;border:none;padding:5px 14px;border-radius:5px;cursor:pointer;font-size:.78rem;font-weight:700">
          ✓ Pubblica foto selezionata
        </button>
        <button onclick="window.xpixRefreshPhotos('${esc(item.id)}')"
          style="background:transparent;border:1px solid #0ea5e9;color:#0ea5e9;padding:5px 12px;border-radius:5px;cursor:pointer;font-size:.78rem"
          title="Ricarica tutte le foto dell'album dal sito xpix.it">
          🔄 Ricarica foto
        </button>
        <button onclick="window.xpixDismiss('${esc(item.id)}')"
          style="background:transparent;border:1px solid #ef4444;color:#ef4444;padding:5px 12px;border-radius:5px;cursor:pointer;font-size:.78rem">
          ✗ Scarta album
        </button>
      </div>
    </div>`;
  }).join('');

  container.innerHTML = stats + rows;
}

window.xpixSync = async () => {
  const btn    = document.getElementById('xpix-sync-btn');
  const status = document.getElementById('xpix-sync-status');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Sincronizzazione…'; }
  if (status) status.textContent = 'Download album in corso, può richiedere ~30s…';
  try {
    const r = await apiCall('/admin/xpix/sync', { method: 'POST' });
    if (status) status.textContent = `✓ +${r.added} nuovi album trovati (totale in coda: ${r.total})`;
    await loadXpixQueue();
  } catch (e) {
    if (status) status.textContent = '✗ Errore: ' + e.message;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Sincronizza Xpix'; }
  }
};

// Mappa id → URL foto selezionata dall'admin
const _xpixItemPhotoMap = {};

window.xpixSelectPhoto = (id, imgEl) => {
  // Deseleziona tutte le foto del blocco
  const block = document.getElementById('xpixq-' + id);
  if (block) block.querySelectorAll('img[data-url]').forEach(el => { el.style.borderColor = 'transparent'; });
  // Seleziona questa
  imgEl.style.borderColor = '#0ea5e9';
  _xpixItemPhotoMap[id] = imgEl.dataset.url;
};

window.xpixSetGara = (id, garaId) => {
  if (garaId === '__search__') {
    const sr = document.getElementById('xpixq-search-' + id);
    if (sr) sr.style.display = 'block';
    return;
  }
  _xpixItemGaraMap[id] = garaId;
};

window.xpixSearchGara = (id, q) => {
  const resultsEl = document.getElementById('xpixq-sr-' + id);
  if (!resultsEl) return;
  if (!q || q.length < 2) { resultsEl.innerHTML = ''; return; }
  const seen = new Set();
  const matches = (globalData?.resultsRaw || [])
    .filter(r => {
      if (seen.has(r.gara_id)) return false;
      seen.add(r.gara_id);
      return (r.nome_gara||'').toLowerCase().includes(q.toLowerCase())
          || r.gara_id.toLowerCase().includes(q.toLowerCase());
    })
    .sort((a, b) => (b.data||'').localeCompare(a.data||''))
    .slice(0, 8);
  resultsEl.innerHTML = matches.map(r => {
    const label = `${r.nome_gara} — ${r.categoria||''} ${r.genere||''} (${r.data||''})`;
    return `<div onclick="window.xpixPickGara('${esc(id)}','${esc(r.gara_id)}')"
      style="padding:6px 10px;cursor:pointer;font-size:.78rem;border-bottom:1px solid var(--border-subtle)">
      ${esc(label)}
    </div>`;
  }).join('') || '<div style="padding:6px 10px;font-size:.78rem;color:var(--text-muted)">Nessun risultato</div>';
};

window.xpixPickGara = (id, garaId) => {
  _xpixItemGaraMap[id] = garaId;
  const sr = document.getElementById('xpixq-search-' + id);
  if (sr) sr.style.display = 'none';
  const sel = document.querySelector(`#xpixq-${id} select`);
  if (sel) {
    const existing = [...sel.options].find(o => o.value === garaId);
    if (!existing) {
      const r = (globalData?.resultsRaw || []).find(x => x.gara_id === garaId);
      if (r) {
        const opt = document.createElement('option');
        opt.value = garaId;
        opt.textContent = `${r.nome_gara} — ${r.categoria||''} ${r.genere||''} (${r.data||''})`;
        sel.insertBefore(opt, sel.firstChild);
      }
    }
    sel.value = garaId;
  }
};

window.xpixApprove = async (id) => {
  const garaId = _xpixItemGaraMap[id]
    || document.querySelector(`#xpixq-${id} select`)?.value
    || '';
  if (!garaId || garaId === '__search__') { showToast('Seleziona prima una gara', 'error'); return; }
  const item = _xpixQueue.find(q => q.id === id);
  const selectedPhotoUrl = _xpixItemPhotoMap[id] || item?.photo_url;
  if (!selectedPhotoUrl) { showToast('Nessuna foto selezionata', 'error'); return; }
  try {
    await apiCall(`/admin/xpix/queue/${id}/approve`, {
      method: 'POST',
      body: { gara_id: garaId, selected_photo_url: selectedPhotoUrl },
    });
    if (item) {
      if (!item._approvedFor) item._approvedFor = [];
      item._approvedFor.push(garaId);
      item.status = 'approved';
    }
    _risPhotosMap = null;
    // Mostra banner "pubblicato" dentro il blocco, senza rimuoverlo
    // così l'admin può subito approvare anche per la versione femminile/altra categoria
    const block = document.getElementById('xpixq-' + id);
    if (block) {
      const banner = block.querySelector('.xpix-approved-banner') || document.createElement('div');
      banner.className = 'xpix-approved-banner';
      banner.style.cssText = 'background:#16a34a22;border:1px solid #16a34a;border-radius:5px;padding:6px 10px;font-size:.78rem;color:#16a34a;margin-bottom:6px;font-weight:600';
      const approvedList = (item._approvedFor || [garaId]).map(g => `<span style="display:inline-block;background:#16a34a33;border-radius:3px;padding:1px 5px;margin:1px">${esc(g)}</span>`).join(' ');
      banner.innerHTML = `✓ Pubblicato per: ${approvedList} &nbsp;—&nbsp; <span style="font-weight:400;color:var(--text-muted)">Puoi selezionare un'altra gara (es. versione ♀) e pubblicare di nuovo</span>`;
      if (!block.querySelector('.xpix-approved-banner')) block.insertBefore(banner, block.firstChild);
      else block.replaceChild(banner, block.querySelector('.xpix-approved-banner'));
      // Reset selezione gara per permettere subito una seconda approvazione
      _xpixItemGaraMap[id] = '';
      const sel = block.querySelector('select');
      if (sel) sel.value = '';
    }
    showToast('✓ Foto pubblicata per ' + garaId.split('_').slice(0,4).join(' '));
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

window.xpixDismiss = async (id) => {
  try {
    await apiCall(`/admin/xpix/queue/${id}`, { method: 'DELETE' });
    document.getElementById('xpixq-' + id)?.remove();
    const item = _xpixQueue.find(q => q.id === id);
    if (item) item.status = 'dismissed';
    showToast('Foto scartata', 'info');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

window.xpixRefreshPhotos = async (id) => {
  const block = document.getElementById('xpixq-' + id);
  const btn   = block?.querySelector('button[onclick*="xpixRefreshPhotos"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Caricamento…'; }
  try {
    const r = await apiCall(`/admin/xpix/queue/${id}/refresh-photos`, { method: 'POST' });
    if (!r.ok) throw new Error(r.error || 'Errore');

    // Aggiorna item locale nella queue e ri-renderizza
    const item = _xpixQueue.find(q => q.id === id);
    if (item) {
      item.photos    = r.photos || [];
      item.photo_url = r.photos?.[0] || item.photo_url;
    }
    renderXpixQueue();
    showToast(`${r.photos_count} foto caricate`, 'success');
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Ricarica foto'; }
    showToast('Errore: ' + e.message, 'error');
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// ITALIACICLISMO.NET AUTO-FOTO — funzioni frontend
// ══════════════════════════════════════════════════════════════════════════════

let _icQueue = [];
let _icItemGaraMap  = {};
let _icItemPhotoMap = {};

function _icScore(icName, icDate, race) {
  // Usa la stessa logica di xpix/yt ma con data esatta come bonus maggiore
  const base = _ytScore(icName, race);
  const dateExact = icDate && race.data && icDate === race.data ? 0.3 : 0;
  return Math.min(1, base + dateExact);
}

function _icFindMatches(name, date, maxResults = 5) {
  const races = (globalData?.resultsRaw || []);
  const seen = new Set();
  const unique = races.filter(r => { if (seen.has(r.gara_id)) return false; seen.add(r.gara_id); return true; });
  return unique
    .map(r => ({ race: r, score: _icScore(name, date, r) }))
    .filter(x => x.score > 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

async function loadICQueue() {
  const container = document.getElementById('ic-queue-container');
  if (!container) return;
  try {
    const { queue } = await apiCall('/admin/ic/queue', { method: 'GET' });
    _icQueue = queue || [];
    renderICQueue();
  } catch (e) {
    if (container) container.innerHTML = `<div style="color:var(--text-muted);font-size:.85rem">Errore caricamento queue IC: ${esc(e.message)}</div>`;
  }
}

function renderICQueue() {
  const container = document.getElementById('ic-queue-container');
  if (!container) return;
  const pending   = _icQueue.filter(q => q.status === 'pending');
  const dismissed = _icQueue.filter(q => q.status === 'dismissed').length;
  const approved  = _icQueue.filter(q => q.status === 'approved').length;

  if (!_icQueue.length) {
    container.innerHTML = `<div style="color:var(--text-muted);font-size:.85rem;padding:16px 0">Nessuna foto in coda. Clicca "Sincronizza ItaliaCiclismo".</div>`;
    return;
  }
  const stats = `<div style="font-size:.8rem;color:var(--text-muted);margin-bottom:12px">
    📋 In attesa: <strong style="color:var(--text-primary)">${pending.length}</strong>
    &nbsp;•&nbsp; ✓ Approvate: ${approved} &nbsp;•&nbsp; ✗ Scartate: ${dismissed}
  </div>`;
  if (!pending.length) {
    container.innerHTML = stats + `<div style="color:var(--text-muted);font-size:.85rem">Tutte le foto sono state elaborate.</div>`;
    return;
  }

  const rows = pending.map(item => {
    const matches    = _icFindMatches(item.name, item.date);
    const best       = matches[0];
    const score      = best ? Math.round(best.score * 100) : 0;
    const scoreColor = score >= 70 ? '#16a34a' : score >= 40 ? '#d97706' : '#6b7280';
    const bestGaraId = _icItemGaraMap[item.id] || (best ? best.race.gara_id : '');
    const optionsHtml = matches.map(m => {
      const genLabel = m.race.genere === 'F' ? '♀ ' : m.race.genere === 'M' ? '♂ ' : '';
      const label = `${genLabel}${m.race.nome_gara} — ${m.race.categoria||''} (${m.race.data||''}) [${Math.round(m.score*100)}%]`;
      return `<option value="${esc(m.race.gara_id)}"${m.race.gara_id===bestGaraId?' selected':''}>${esc(label)}</option>`;
    }).join('');
    const allPhotos  = item.photos?.length ? item.photos : (item.photo_url ? [item.photo_url] : []);
    const photosGrid = allPhotos.map(url => `
      <img src="${esc(url)}" data-url="${esc(url)}" data-id="${esc(item.id)}"
        onclick="window.icSelectPhoto('${esc(item.id)}',this)"
        style="width:80px;height:54px;object-fit:cover;border-radius:4px;cursor:pointer;border:2px solid ${url===(item.photo_url||allPhotos[0])?'#8b5cf6':'transparent'};transition:border-color .15s;flex-shrink:0"
        onerror="this.style.display='none'" />`).join('');

    return `
    <div id="icq-${esc(item.id)}" style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px">
      <div style="font-weight:600;font-size:.85rem;margin-bottom:4px">${esc(item.name)}</div>
      <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:8px">
        📅 ${esc(item.date||'')} &nbsp;•&nbsp; 🏷 ${esc(item.categoria||'')}
        ${score ? `&nbsp;•&nbsp; <span style="color:${scoreColor};font-weight:700">${score}% match</span>` : ''}
        &nbsp;•&nbsp; <a href="${esc(item.gara_url||'#')}" target="_blank" style="color:var(--accent)">Apri pagina gara ↗</a>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;padding:8px;background:var(--bg-elevated);border-radius:6px">
        <div style="width:100%;font-size:.72rem;color:var(--text-muted);margin-bottom:4px">👇 Clicca la foto da usare</div>
        ${photosGrid || '<span style="font-size:.8rem;color:var(--text-muted)">Nessuna foto</span>'}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
        <select onchange="window.icSetGara('${esc(item.id)}',this.value)"
          style="flex:1;min-width:180px;padding:5px 8px;border:1px solid var(--border);border-radius:5px;background:var(--bg-primary);color:var(--text-primary);font-size:.78rem">
          <option value="">— Seleziona gara —</option>
          ${optionsHtml}
          <option value="__search__">🔍 Cerca altra gara…</option>
        </select>
      </div>
      <div id="icq-search-${esc(item.id)}" style="display:none;margin-bottom:6px">
        <input type="text" placeholder="Cerca gara per nome…" oninput="window.icSearchGara('${esc(item.id)}',this.value)"
          style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid var(--border);border-radius:5px;background:var(--bg-primary);color:var(--text-primary);font-size:.78rem" />
        <div id="icq-sr-${esc(item.id)}" style="background:var(--bg-card);border:1px solid var(--border);border-radius:5px;max-height:160px;overflow-y:auto;margin-top:2px"></div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button onclick="window.icApprove('${esc(item.id)}')"
          style="background:#16a34a;color:#fff;border:none;padding:5px 14px;border-radius:5px;cursor:pointer;font-size:.78rem;font-weight:700">✓ Pubblica foto</button>
        <button onclick="window.icDismiss('${esc(item.id)}')"
          style="background:transparent;border:1px solid #ef4444;color:#ef4444;padding:5px 12px;border-radius:5px;cursor:pointer;font-size:.78rem">✗ Scarta</button>
      </div>
    </div>`;
  }).join('');
  container.innerHTML = stats + rows;
}

window.icSync = async () => {
  const btn = document.getElementById('ic-sync-btn');
  const status = document.getElementById('ic-sync-status');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Sincronizzazione…'; }
  if (status) status.textContent = 'Download in corso…';
  try {
    const r = await apiCall('/admin/ic/sync', { method: 'POST' });
    if (status) status.textContent = `✓ +${r.added} nuove gare trovate`;
    await loadICQueue();
  } catch (e) {
    if (status) status.textContent = '✗ Errore: ' + e.message;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Sincronizza ItaliaCiclismo'; }
  }
};

window.icSelectPhoto = (id, imgEl) => {
  const block = document.getElementById('icq-' + id);
  if (block) block.querySelectorAll('img[data-url]').forEach(el => { el.style.borderColor = 'transparent'; });
  imgEl.style.borderColor = '#8b5cf6';
  _icItemPhotoMap[id] = imgEl.dataset.url;
};
window.icSetGara = (id, garaId) => {
  if (garaId === '__search__') { const sr = document.getElementById('icq-search-'+id); if(sr) sr.style.display='block'; return; }
  _icItemGaraMap[id] = garaId;
};
window.icSearchGara = (id, q) => {
  const el = document.getElementById('icq-sr-'+id); if (!el) return;
  if (!q || q.length < 2) { el.innerHTML = ''; return; }
  const seen = new Set();
  const matches = (globalData?.resultsRaw||[]).filter(r => { if(seen.has(r.gara_id))return false; seen.add(r.gara_id);
    return (r.nome_gara||'').toLowerCase().includes(q.toLowerCase()) || r.gara_id.toLowerCase().includes(q.toLowerCase());
  }).sort((a,b)=>(b.data||'').localeCompare(a.data||'')).slice(0,8);
  el.innerHTML = matches.map(r => `<div onclick="window.icPickGara('${esc(id)}','${esc(r.gara_id)}')"
    style="padding:6px 10px;cursor:pointer;font-size:.78rem;border-bottom:1px solid var(--border-subtle)">
    ${esc(r.nome_gara)} — ${esc(r.categoria||'')} ${esc(r.genere||'')} (${esc(r.data||'')})
  </div>`).join('') || '<div style="padding:6px 10px;font-size:.78rem;color:var(--text-muted)">Nessun risultato</div>';
};
window.icPickGara = (id, garaId) => {
  _icItemGaraMap[id] = garaId;
  const sr = document.getElementById('icq-search-'+id); if(sr) sr.style.display='none';
  const sel = document.querySelector(`#icq-${id} select`);
  if (sel) {
    const r = (globalData?.resultsRaw||[]).find(x=>x.gara_id===garaId);
    if (r && ![...sel.options].find(o=>o.value===garaId)) {
      const opt = document.createElement('option'); opt.value=garaId;
      opt.textContent=`${r.nome_gara} — ${r.categoria||''} ${r.genere||''} (${r.data||''})`;
      sel.insertBefore(opt, sel.firstChild);
    }
    sel.value = garaId;
  }
};
window.icApprove = async (id) => {
  const garaId = _icItemGaraMap[id] || document.querySelector(`#icq-${id} select`)?.value || '';
  if (!garaId || garaId==='__search__') { showToast('Seleziona prima una gara','error'); return; }
  const item = _icQueue.find(q=>q.id===id);
  const selectedPhotoUrl = _icItemPhotoMap[id] || item?.photo_url;
  if (!selectedPhotoUrl) { showToast('Nessuna foto selezionata','error'); return; }
  try {
    await apiCall(`/admin/ic/queue/${id}/approve`, { method:'POST', body:{ gara_id:garaId, selected_photo_url:selectedPhotoUrl } });
    document.getElementById('icq-'+id)?.remove();
    const it = _icQueue.find(q=>q.id===id); if(it) it.status='approved';
    _risPhotosMap = null;
    showToast('✓ Foto pubblicata!');
  } catch(e) { showToast('Errore: '+e.message,'error'); }
};
window.icDismiss = async (id) => {
  try {
    await apiCall(`/admin/ic/queue/${id}`,{method:'DELETE'});
    document.getElementById('icq-'+id)?.remove();
    const it=_icQueue.find(q=>q.id===id); if(it) it.status='dismissed';
    showToast('Foto scartata','info');
  } catch(e) { showToast('Errore: '+e.message,'error'); }
};

// ── GESTIONE VIDEO APPROVATI ─────────────────────────────────────────────────

let _adminVideosData = {}; // cache locale per filtro
let _adminVideoFilter = '';

async function loadAdminAllVideos() {
  const container = document.getElementById('admin-videos-all');
  if (!container) return;
  container.innerHTML = `<div style="color:var(--text-muted);padding:20px 0">Caricamento...</div>`;
  try {
    _adminVideosData = await apiCall('/admin/videos', { method: 'GET' });
    renderAdminVideosAll();
  } catch(e) {
    container.innerHTML = `<div style="color:var(--red-hot);padding:20px 0">Errore: ${esc(e.message)}</div>`;
  }
}

function renderAdminVideosAll() {
  const container = document.getElementById('admin-videos-all');
  if (!container) return;
  // Mappa gara_id → prima risultato (per nome + categoria + data)
  const garaMap = {};
  (globalData?.resultsRaw || []).forEach(r => { if (!garaMap[r.gara_id]) garaMap[r.gara_id] = r; });
  // Fallback: calendario
  const calMap = {};
  (globalData?.calendar || []).forEach(g => calMap[g.id] = g);

  const entries = Object.entries(_adminVideosData)
    .filter(([garaId]) => {
      if (!_adminVideoFilter) return true;
      const q = _adminVideoFilter.toLowerCase();
      const r = garaMap[garaId];
      const cal = calMap[garaId];
      return garaId.toLowerCase().includes(q)
        || (r?.nome_gara||'').toLowerCase().includes(q)
        || (r?.categoria||'').toLowerCase().includes(q)
        || (cal?.nome||'').toLowerCase().includes(q);
    })
    .sort(([a],[b]) => {
      const da = garaMap[a]?.data || calMap[a]?.data || a;
      const db = garaMap[b]?.data || calMap[b]?.data || b;
      return db.localeCompare(da);
    });

  if (!entries.length) {
    container.innerHTML = `<div style="color:var(--text-muted);padding:20px 0">${_adminVideoFilter ? 'Nessun risultato.' : 'Nessun video approvato.'}</div>`;
    return;
  }

  container.innerHTML = entries.map(([calId, vids]) => {
    const r = garaMap[calId];
    const cal = calMap[calId];
    const raceName = r?.nome_gara || cal?.nome || calId;
    const catBadge = r?.categoria ? ` <span style="background:var(--accent);color:#fff;border-radius:3px;padding:1px 5px;font-size:.7rem">${esc(r.categoria)} ${r.genere||''}</span>` : '';
    const raceDate = r?.data || cal?.data || '';

    const videoRows = vids.map((v, idx) => {
      const vidId = ytId(v.url) || '';
      const thumb = vidId ? `https://img.youtube.com/vi/${vidId}/mqdefault.jpg` : '';

      return `
      <div class="admin-video-row" id="avr-${esc(calId)}-${idx}" style="display:flex;gap:12px;align-items:flex-start;padding:10px;border-bottom:1px solid var(--border-subtle)">
        ${thumb ? `<img src="${thumb}" alt="thumb" style="width:90px;height:60px;object-fit:cover;border-radius:4px;flex-shrink:0;cursor:pointer" onclick="window.open('${esc(v.url)}','_blank')" />` : `<div style="width:90px;height:60px;background:var(--bg-elevated,rgba(128,128,128,.1));border-radius:4px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:1.5rem">🎬</div>`}
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:.85rem;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(v.title)}</div>
          <div style="font-size:.75rem;color:var(--text-muted)">${esc(v.channel||'')} &nbsp;•&nbsp; ${esc(v.published_at||'')}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
          <button onclick="window.adminVideoEdit('${esc(calId)}',${idx})" style="background:var(--bg-card);border:1px solid var(--border);padding:4px 10px;border-radius:4px;cursor:pointer;font-size:.75rem;color:var(--text-primary)">✏️ Modifica</button>
          <button onclick="window.adminVideoDelete('${esc(calId)}',${idx})" style="background:transparent;border:1px solid #ef4444;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:.75rem;color:#ef4444">🗑️ Elimina</button>
        </div>
      </div>`;
    }).join('');

    return `
    <div class="admin-video-race-block" style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;margin-bottom:12px;overflow:hidden">
      <div style="padding:10px 14px;background:var(--bg-elevated,rgba(128,128,128,.08));display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px">
          <a href="#/gara/${encodeURIComponent(calId)}" style="color:var(--accent);font-weight:700;font-size:.9rem;text-decoration:none">${esc(raceName)}</a>
          ${catBadge}
          ${raceDate ? `<span style="color:var(--text-muted);font-size:.75rem;margin-left:4px">${fmtDate(raceDate)}</span>` : ''}
          <span style="color:var(--text-muted);font-size:.75rem">•&nbsp;${vids.length} video</span>
        </div>
        <button onclick="window.adminShowAddVideoForRace('${esc(calId)}')" style="background:transparent;border:1px solid var(--accent);color:var(--accent);padding:3px 10px;border-radius:4px;cursor:pointer;font-size:.75rem;flex-shrink:0">+ video</button>
      </div>
      ${videoRows}
    </div>`;
  }).join('');
}

window.adminFilterVideos = (q) => {
  _adminVideoFilter = q.trim();
  renderAdminVideosAll();
};

window.adminVideoDelete = async (calId, idx) => {
  if (!confirm(`Eliminare questo video?`)) return;
  try {
    await apiCall(`/admin/videos/${encodeURIComponent(calId)}/${idx}`, { method: 'DELETE' });
    if (_adminVideosData[calId]) {
      _adminVideosData[calId].splice(idx, 1);
      if (!_adminVideosData[calId].length) delete _adminVideosData[calId];
    }
    await refreshVideos();
    renderAdminVideosAll();
  } catch(e) { alert('Errore: ' + e.message); }
};

window.adminVideoEdit = (calId, idx) => {
  const v = _adminVideosData[calId]?.[idx];
  if (!v) return;
  const inpS = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:.875rem;background:var(--bg-card);color:var(--text-primary);margin-bottom:10px';
  const overlay = document.createElement('div');
  overlay.id = 'admin-video-edit-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `
    <div style="background:var(--bg-card);border-radius:12px;padding:24px;width:100%;max-width:440px;box-shadow:0 8px 32px rgba(0,0,0,.3)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <strong style="font-size:1rem">✏️ Modifica Video</strong>
        <button onclick="document.getElementById('admin-video-edit-overlay').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text-muted)">✕</button>
      </div>
      <label style="font-size:.8rem;color:var(--text-muted);display:block;margin-bottom:3px">URL YouTube</label>
      <input id="ave-url" type="url" value="${esc(v.url||'')}" style="${inpS}"/>
      <label style="font-size:.8rem;color:var(--text-muted);display:block;margin-bottom:3px">Titolo</label>
      <input id="ave-title" type="text" value="${esc(v.title||'')}" style="${inpS}"/>
      <label style="font-size:.8rem;color:var(--text-muted);display:block;margin-bottom:3px">Autore / Canale</label>
      <input id="ave-channel" type="text" value="${esc(v.channel||'')}" placeholder="Autore o nome canale" style="${inpS}"/>
      <div id="ave-err" style="color:#EF4444;font-size:.8rem;margin-bottom:8px;display:none"></div>
      <div style="display:flex;gap:8px">
        <button onclick="window._adminVideoEditSave('${esc(calId)}',${idx})"
          style="flex:1;padding:9px;background:var(--accent);color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer">Salva</button>
        <button onclick="document.getElementById('admin-video-edit-overlay').remove()"
          style="padding:9px 16px;background:transparent;border:1px solid var(--border);border-radius:6px;cursor:pointer;color:var(--text-muted)">Annulla</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
};

window._adminVideoEditSave = async (calId, idx) => {
  const url     = document.getElementById('ave-url')?.value.trim();
  const title   = document.getElementById('ave-title')?.value.trim();
  const channel = document.getElementById('ave-channel')?.value.trim();
  const errEl   = document.getElementById('ave-err');
  if (!url) { errEl.textContent = 'URL obbligatorio'; errEl.style.display = 'block'; return; }
  try {
    await apiCall(`/admin/videos/${encodeURIComponent(calId)}/${idx}`, {
      method: 'PATCH',
      body: { url, title, channel },
    });
    const v = _adminVideosData[calId]?.[idx];
    if (v) { v.url = url; v.title = title; v.channel = channel; }
    document.getElementById('admin-video-edit-overlay')?.remove();
    await refreshVideos();
    renderAdminVideosAll();
  } catch(e) { errEl.textContent = 'Errore: ' + e.message; errEl.style.display = 'block'; }
};

// ── FORM AGGIUNGI VIDEO ──────────────────────────────────────────────────────


let _avfSelectedCalId = null;

// oEmbed auto-fill per il form admin (avf-url → avf-title + avf-channel)
let _avfOembedTimer = null;
window.adminUrlOembed = (url) => {
  clearTimeout(_avfOembedTimer);
  const vid = ytId(url);
  if (!vid) return;
  _avfOembedTimer = setTimeout(async () => {
    try {
      const d = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`).then(r => r.json());
      const titleEl   = document.getElementById('avf-title');
      const channelEl = document.getElementById('avf-channel');
      if (titleEl   && !titleEl._manual)   titleEl.value   = d.title       || '';
      if (channelEl && !channelEl._manual) channelEl.value = d.author_name || '';
    } catch { /* oEmbed non disponibile */ }
  }, 600);
};

window.adminShowAddVideo = (show = true) => {
  const f = document.getElementById('admin-add-video-form');
  if (f) f.style.display = show ? 'block' : 'none';
  if (show) {
    _avfSelectedCalId = null;
    document.getElementById('avf-race-search').value = '';
    const _avfUrl = document.getElementById('avf-url');
    const _avfTitle = document.getElementById('avf-title');
    const _avfChan  = document.getElementById('avf-channel');
    if (_avfUrl)   { _avfUrl.value = ''; }
    if (_avfTitle) { _avfTitle.value = ''; _avfTitle._manual = false; }
    if (_avfChan)  { _avfChan.value = '';  _avfChan._manual  = false; }
    document.getElementById('avf-race-selected').textContent = '';
    document.getElementById('avf-race-results').style.display = 'none';
  }
};

window.adminShowAddVideoForRace = (garaId) => {
  window.adminShowAddVideo(true);
  // garaId è ora un gara_id completo (con categoria), non un cal.id
  const r = (globalData?.resultsRaw || []).find(x => x.gara_id === garaId);
  _avfSelectedCalId = garaId;
  const label = r ? `${r.nome_gara||garaId} — ${r.categoria||''} ${r.genere||''}`.trim() : garaId;
  const sel = document.getElementById('avf-race-selected');
  const search = document.getElementById('avf-race-search');
  if (sel) sel.textContent = `✔ ${label}`;
  if (search) search.value = label;
  document.getElementById('admin-add-video-form')?.scrollIntoView({ behavior:'smooth', block:'start' });
};

// Cerca gare per categoria da resultsRaw (ogni riga = gara_id unico con categoria)
window.adminSearchCalRace = (q) => {
  const res = document.getElementById('avf-race-results');
  if (!res) return;
  if (!q || q.length < 2) { res.style.display = 'none'; return; }
  const seen = new Set();
  const matches = (globalData?.resultsRaw || [])
    .filter(r => {
      if (seen.has(r.gara_id)) return false;
      seen.add(r.gara_id);
      const name = (r.nome_gara || r.gara_id || '').toLowerCase();
      const cat  = (r.categoria || '').toLowerCase();
      return name.includes(q.toLowerCase()) || cat.includes(q.toLowerCase()) || r.gara_id.toLowerCase().includes(q.toLowerCase());
    })
    .sort((a,b) => (b.data||'').localeCompare(a.data||''))
    .slice(0, 15);
  if (!matches.length) { res.style.display = 'none'; return; }
  res.style.display = 'block';
  res.innerHTML = matches.map(r => {
    const label = `${esc(r.nome_gara||r.gara_id)}`;
    const badge = r.categoria ? `<span style="background:var(--accent);color:#fff;border-radius:3px;padding:1px 5px;font-size:.7rem;margin-left:6px">${esc(r.categoria)} ${r.genere||''}</span>` : '';
    return `<div onclick="window.adminSelectCalRace('${esc(r.gara_id)}','${esc(r.nome_gara||r.gara_id)} — ${esc(r.categoria||'')} ${r.genere||''}')"
      style="padding:8px 12px;cursor:pointer;font-size:.82rem;border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;gap:4px">
      <strong>${label}</strong>${badge}
      <span style="color:var(--text-muted);font-size:.75rem;margin-left:auto">${r.data||''}</span>
    </div>`;
  }).join('');
};

window.adminSelectCalRace = (calId, nome) => {
  _avfSelectedCalId = calId;
  const sel = document.getElementById('avf-race-selected');
  const res = document.getElementById('avf-race-results');
  const search = document.getElementById('avf-race-search');
  if (sel) sel.textContent = `✔ ${nome}`;
  if (search) search.value = nome;
  if (res) res.style.display = 'none';
};

window.adminSubmitAddVideo = async () => {
  if (!_avfSelectedCalId) { alert('Seleziona prima una gara.'); return; }
  const url     = document.getElementById('avf-url').value.trim();
  const title   = document.getElementById('avf-title').value.trim();
  const channel = document.getElementById('avf-channel').value.trim();
  if (!url) { alert('Inserisci un URL YouTube.'); return; }
  try {
    await apiCall(`/admin/videos/${encodeURIComponent(_avfSelectedCalId)}`, {
      method: 'POST',
      body: { url, title, channel: channel || 'Admin' },
    });
    window.adminShowAddVideo(false);
    await refreshVideos();
    await loadAdminAllVideos();
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
    document.getElementById('modal-overlay')?.remove();
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
  btn.textContent = "⌛ RICARICAMENTO...";
  try {
    await loadAllData();
    alert("Dati ricaricati con successo.");
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
// ── Sezione Media per profili atleta/team ─────────────────────────────────────
// risultati: array con {gara_id, nome_gara, data, posizione, atleta_cognome?, atleta_nome?}
// photosMap: { [gara_id]: photoObj }  (da loadRisPhotos)
// videos:    { [gara_id]: [videoObj] } (globalData.videos)
// opts.showAthleteName: mostra nome atleta su ogni card (per profili team)
function buildProfileMedia(risultati, photosMap, videos, opts = {}) {
  const { showAthleteName = false, maxItems = 8 } = opts;
  const _vids = videos || {};
  const _photos = photosMap || {};

  // Scorri risultati dal più recente al più vecchio
  const sorted = [...(risultati || [])].sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  const winPhotos = [];   // pos=1 + foto disponibile
  const top10Vids = [];   // pos≤10 + video disponibile
  const seenPG = new Set();
  const seenVG = new Set();

  for (const r of sorted) {
    const photo = _photos[r.gara_id];
    // Cerca video: prima chiave esatta, poi varianti categoria
    let videoArr = _vids[r.gara_id] || [];
    if (!videoArr.length) {
      // Cerca chiavi che iniziano con la base del gara_id (es. senza _JUN_M)
      const baseKey = r.gara_id.replace(/_[A-Z0-9]+_[MF]$/, '');
      for (const [k, v] of Object.entries(_vids)) {
        if (k.startsWith(baseKey) && v.length) { videoArr = v; break; }
      }
    }

    const _pos = Number(r.posizione);
    if (_pos === 1 && photo && !seenPG.has(r.gara_id)) {
      seenPG.add(r.gara_id);
      winPhotos.push({ r, photo });
    }
    if (_pos >= 1 && _pos <= 10 && videoArr.length && !seenVG.has(r.gara_id)) {
      seenVG.add(r.gara_id);
      top10Vids.push({ r, video: videoArr[0] });
    }
  }

  const photos = winPhotos.slice(0, maxItems);
  const vids   = top10Vids.slice(0, maxItems);
  if (!photos.length && !vids.length) return '';

  const posLabel = p => { p = Number(p); return p === 1 ? '🥇 1°' : p === 2 ? '🥈 2°' : p === 3 ? '🥉 3°' : `${p}°`; };
  const posColor = p => { p = Number(p); return p === 1 ? 'var(--gold)' : p === 2 ? 'var(--silver)' : p === 3 ? 'var(--bronze)' : 'var(--text-muted)'; };

  const photoCard = ({ r, photo }) => {
    const _photoSrc = photo.url || (photo.filename ? `${PHOTOS_BASE}/photos/${photo.filename}` : '');
    const ath = showAthleteName && r.atleta_cognome
      ? `<div class="profile-media-athlete">${esc(r.atleta_cognome)} ${esc(r.atleta_nome || '')}</div>` : '';
    return `<div class="profile-media-card profile-media-photo" style="cursor:zoom-in" onclick="openPhotoLightbox('${esc(_photoSrc)}')">
      <div class="profile-media-thumb">
        <img src="${esc(_photoSrc)}" alt="${esc(r.nome_gara)}" loading="lazy" onerror="this.style.display='none'" />
        <div class="profile-media-badge" style="color:${posColor(r.posizione)}">${posLabel(r.posizione)}</div>
      </div>
      <div class="profile-media-info">${ath}
        <div class="profile-media-race">${esc(r.nome_gara)}</div>
        <div class="profile-media-meta">${fmtDateShort(r.data)}</div>
      </div>
    </div>`;
  };

  const videoCard = ({ r, video }) => {
    const vid   = ytId(video.url);
    const thumb = vid ? `https://img.youtube.com/vi/${vid}/mqdefault.jpg` : '';
    const ath   = showAthleteName && r.atleta_cognome
      ? `<div class="profile-media-athlete">${esc(r.atleta_cognome)} ${esc(r.atleta_nome || '')}</div>` : '';
    const _vtitle = esc((video.title || r.nome_gara || '').replace(/'/g, "\\'"));
    const _vclick = vid
      ? `window.openVideoModal('${vid}','${_vtitle}')`
      : `window.open('${esc(video.url)}','_blank')`;
    return `<div class="profile-media-card profile-media-video" style="cursor:pointer" onclick="${_vclick.replace(/"/g,'&quot;')}">
      <div class="profile-media-thumb">
        ${thumb ? `<img src="${thumb}" alt="${esc(video.title||'')}" loading="lazy" />` : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem;color:var(--text-muted)">🎬</div>'}
        <div class="profile-media-play-btn"><div class="profile-media-play-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg></div></div>
        <div class="profile-media-badge" style="color:${posColor(r.posizione)}">${posLabel(r.posizione)}</div>
      </div>
      <div class="profile-media-info">${ath}
        <div class="profile-media-race">${esc(r.nome_gara)}</div>
        <div class="profile-media-meta">${fmtDateShort(r.data)}${video.channel ? ` · ${esc(video.channel)}` : ''}</div>
      </div>
    </div>`;
  };

  let inner = '';
  if (photos.length && vids.length) {
    inner = `
      <div style="margin-bottom:18px">
        <div class="profile-media-sub-title">📸 FOTO VITTORIE</div>
        <div class="profile-media-grid">${photos.map(photoCard).join('')}</div>
      </div>
      <div>
        <div class="profile-media-sub-title">🎬 VIDEO</div>
        <div class="profile-media-grid">${vids.map(videoCard).join('')}</div>
      </div>`;
  } else if (photos.length) {
    inner = `<div class="profile-media-sub-title">📸 FOTO VITTORIE</div>
      <div class="profile-media-grid">${photos.map(photoCard).join('')}</div>`;
  } else {
    inner = `<div class="profile-media-sub-title">🎬 VIDEO</div>
      <div class="profile-media-grid">${vids.map(videoCard).join('')}</div>`;
  }

  return `
  <div class="section-header" style="margin-top:28px">
    <span class="section-title">MEDIA</span>
    <span class="section-line"></span>
  </div>
  <div class="profile-media-section">${inner}</div>`;
}

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
  const [currentRanking, atletaOv, photosMap] = await Promise.all([
    rCode ? loadRanking(rCode) : Promise.resolve([]),
    getEntityOverrides('atleta', atleta_id),
    loadRisPhotos(),
  ]);
  const aRankObj = currentRanking.find(x => x.atleta_id === a.id);
  const globalPos = aRankObj ? aRankObj.pos : '-';

  // Apply admin overrides to display fields
  const displayCognome = atletaOv.cognome || a.cognome || '';
  const displayNome    = atletaOv.nome    || a.nome    || '';
  const displayTeam    = atletaOv.team    || a.team_attuale || '';

  const initials = ((displayCognome||'?')[0] + (displayNome||'?')[0]).toUpperCase();
  const photoHtml = photoAreaHtml('atleta', atleta_id, atletaOv.photo_url || null, initials, 'circle');

  const headerHtml = `
    <div class="athlete-header">
      <div class="athlete-header-top">
        ${badgeCat(a.categoria)}
        ${a.genere === 'F' ? '<span class="badge-cat badge-genere-f">♀</span>' : ''}
        ${a.team_id ? `<a href="#/team/${esc(a.team_id)}" style="font-family:var(--font-heading);font-size:.8rem;color:var(--text-secondary);border:1px solid var(--border-subtle);padding:2px 10px;border-radius:2px">${esc(displayTeam)} →</a>` : ''}
      </div>
      <div class="profile-photo-row" style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
        ${photoHtml}
        <div class="athlete-header-name">
          <span class="athlete-cognome">${esc(displayCognome)}</span>
          <span class="athlete-nome">${esc(displayNome)}</span>
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

  window._shareAtletaData = {cognome:displayCognome,nome:displayNome,cat:catLabel(a.categoria),team:displayTeam,punti:a.punti_totali,pos:globalPos,p1:p1,p2:p2,p3:p3,gare:top10};

  // Sport Intelligence computations
  const { resultsRaw: _siRaw } = globalData;
  const _siLastDate = _siRaw.reduce((max, r) => (r.data||'') > max ? r.data : max, '');
  const aiStreak    = siStreak(atleta_id, _siRaw);
  const aiMomentum  = siMomentum(atleta_id, _siRaw, _siLastDate);
  const aiRivals    = siRivals(atleta_id, _siRaw, rCode);
  const _aiStory    = siAthleteStory(atleta_id, _siRaw);
  const aiIdentity  = siAthleteIdentity(atleta_id, _siRaw);
  const aiHeroMom   = siBestMoment(atleta_id, _siRaw);

  // ── HERO SEASON CARD ─────────────────────────────────────────
  const _narrativeParts = [];
  if (p1 > 0) _narrativeParts.push(`${p1} vittori${p1===1?'a':'e'} in ${top10} gar${top10===1?'a':'e'}`);
  else if (p2+p3 > 0) _narrativeParts.push(`${p2+p3} podi in ${top10} gar${top10===1?'a':'e'}`);
  else if (top10 > 0) _narrativeParts.push(`${top10} gar${top10===1?'a':'e'} disputat${top10===1?'a':'e'}`);
  if (aiStreak.winStreak >= 2) _narrativeParts.push(`${aiStreak.winStreak} vittorie consecutive`);
  else if (aiStreak.podioStreak >= 2) _narrativeParts.push(`${aiStreak.podioStreak} podi di fila`);

  const heroHtml = `
    <div class="athlete-hero-card">
      <div class="athlete-hero-left">
        ${_aiStory ? `<div class="athlete-hero-story">${_aiStory}</div>` : ''}
        <div class="athlete-hero-form" style="color:${aiMomentum.color}">${aiMomentum.label}</div>
        ${_narrativeParts.length ? `<div class="athlete-hero-narrative">${_narrativeParts.join(' · ')}</div>` : ''}
        ${aiMomentum.gare14 > 0 ? `<div class="athlete-hero-recent">${aiMomentum.gare14} gar${aiMomentum.gare14===1?'a':'e'} · ${aiMomentum.vittorie14} vitt. · ${aiMomentum.podio14} podi nelle ultime 2 settimane</div>` : ''}
      </div>
      ${aiHeroMom ? `<div class="athlete-hero-right">
        <div class="athlete-hero-moment-label">MIGLIOR RISULTATO</div>
        <div class="athlete-hero-moment-pos" style="color:${aiHeroMom.best.pos===1?'var(--gold)':aiHeroMom.best.pos<=3?'var(--silver)':'var(--text-primary)'}">${aiHeroMom.best.pos}°</div>
        <div class="athlete-hero-moment-race"><a href="#/gara/${esc(aiHeroMom.best.gara_id)}">${esc(aiHeroMom.best.nome)}</a></div>
        <div class="athlete-hero-moment-date">${fmtDateShort(aiHeroMom.best.data)} · ${aiHeroMom.best.pts} pt</div>
        ${aiHeroMom.lastWin ? `<div class="athlete-hero-moment-label" style="margin-top:14px">ULTIMA VITTORIA</div>
        <div class="athlete-hero-moment-race"><a href="#/gara/${esc(aiHeroMom.lastWin.gara_id)}">${esc(aiHeroMom.lastWin.nome)}</a></div>
        <div class="athlete-hero-moment-date">${fmtDateShort(aiHeroMom.lastWin.data)}</div>` : ''}
      </div>` : ''}
    </div>`;

  // ── ATHLETE IDENTITY STRIP ───────────────────────────────────
  const _rivalHtml = aiRivals.length ? aiRivals.map(r => `
    <div class="ath-rival-item">
      <a href="#/atleta/${encodeURIComponent(r.atleta_id)}" class="ath-rival-name">${esc(r.cognome)} ${esc(r.nome[0])}.</a>
      <span class="ath-rival-meta">${r.encounters} sfid${r.encounters===1?'a':'e'}${r.wins>0?' · '+r.wins+' vinte':''}</span>
    </div>`).join('') : `<p class="ath-empty-note">Dati rivalità insufficienti</p>`;


  const _identityHtml = aiIdentity ? `
    <div class="ath-identity-strip">
      <div class="ath-identity-card">
        <div class="ath-identity-label">RIVALITÀ</div>
        ${_rivalHtml}
      </div>
      <div class="ath-identity-card">
        <div class="ath-identity-label">STILE DI GARA</div>
        <div class="ath-style-tag">${aiIdentity.style}</div>
        <div class="ath-style-desc">${aiIdentity.desc}</div>
        ${aiIdentity.strengths.length ? `<div class="ath-strengths-line">${aiIdentity.strengths.join(', ')}</div>` : ''}
      </div>
      <div class="ath-identity-card">
        <div class="ath-identity-label">STATISTICHE CHIAVE</div>
        <div class="ath-stat-block">
          <div class="ath-stat-row"><span>Vittorie</span><strong style="color:var(--gold)">${aiIdentity.wins}</strong></div>
          <div class="ath-stat-row"><span>Podi</span><strong style="color:var(--silver)">${aiIdentity.podi}</strong></div>
          <div class="ath-stat-row"><span>Top-5</span><strong>${aiIdentity.top5}</strong></div>
          <div class="ath-stat-row"><span>Win rate</span><strong>${Math.round(aiIdentity.winRate*100)}%</strong></div>
          <div class="ath-stat-row"><span>Podio rate</span><strong>${Math.round(aiIdentity.podioRate*100)}%</strong></div>
          <div class="ath-stat-row"><span>Gare disputate</span><strong>${aiIdentity.races}</strong></div>
        </div>
      </div>
    </div>` : '';

  setPage(`
    ${headerHtml}
    ${sparkHtml ? `<div class="sparkline-wrap"><div class="sparkline-title">ANDAMENTO PUNTI — STAGIONE ${new Date().getFullYear()}</div>${sparkHtml}</div>` : ''}
    <div style="margin: 8px 0 20px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn-share" onclick="window.triggerShareAtleta()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Condividi Profilo</button>
      <button class="btn-share" onclick="window.openComparatore('${esc(atleta_id)}','atleta')">⚖ Compara</button>
      ${adminEditBtn('atleta', atleta_id)}
    </div>
    ${buildProfileMedia(risultati, photosMap, globalData.videos)}
    <div class="section-header" style="margin-top:28px">
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
  const [teamRankings, teamOv, teamPhotosMap] = await Promise.all([
    Promise.all(RANKING_CODES.map(c => loadTeamRanking(c))),
    getEntityOverrides('team', team_id),
    loadRisPhotos(),
  ]);
  const tCatRanks = [];
  teamRankings.forEach((rlist, idx) => {
    const code = RANKING_CODES[idx];
    const rk = (rlist || []).find(x => x.team_id === team_id);
    if (rk) tCatRanks.push({ cat: code, pos: rk.pos, pts: rk.punti });
  });
  const topC = tCatRanks.slice().sort((a,b)=>b.pts - a.pts)[0];

  // ── INTELLIGENCE ──────────────────────────────────────────────
  const allTeamRes  = globalData.resultsRaw.filter(r => r.team_id === team_id && r.posizione && r.data);
  const lastDateGlobal = allTeamRes.reduce((mx,r) => r.data > mx ? r.data : mx, '');

  // Category-scoped raw for per-cat mission/strengths/momentum
  const catScopedRaw = globalData.resultsRaw.filter(r => (getRankingFileCode(r)||r.categoria) === teamViewCat);
  const catCatRanks  = tCatRanks.filter(rk => rk.cat === teamViewCat);

  const mission   = siTeamMission(team_id, catScopedRaw, catCatRanks);
  const strengths = siTeamStrengths(team_id, catScopedRaw);
  const momentum  = siTeamMomentumData(team_id, catScopedRaw);

  // Cat-scoped quick stats for the mission card
  const _catRes = allTeamRes.filter(r => (getRankingFileCode(r)||r.categoria) === teamViewCat);
  const catWins  = _catRes.filter(r => r.posizione === 1).length;
  const catPodi  = _catRes.filter(r => r.posizione <= 3).length;
  const catGare  = new Set(_catRes.map(r => r.gara_id)).size;

  // Global dominance bars (all cats — used inside identity card)
  const winsByCat = {};
  for (const r of allTeamRes.filter(x => x.posizione === 1)) {
    const code = getRankingFileCode(r) || r.categoria;
    if (code) winsByCat[code] = (winsByCat[code]||0) + 1;
  }
  const maxCatWins = Math.max(...Object.values(winsByCat), 1);

  // Top performers — per categoria selezionata
  const catPerfMap = {};
  for (const r of catRisultati) {
    if (!catPerfMap[r.atleta_id]) {
      const ath = athletes[r.atleta_id] || {};
      catPerfMap[r.atleta_id] = {
        id: r.atleta_id,
        cognome: ath.cognome || r.atleta_cognome || r.cognome || '',
        nome:    ath.nome    || r.atleta_nome    || r.nome    || '',
        pts: 0, wins: 0
      };
    }
    catPerfMap[r.atleta_id].pts += r.punti_effettivi||0;
    if (r.posizione === 1) catPerfMap[r.atleta_id].wins++;
  }
  const topPerformers = Object.values(catPerfMap).sort((a,b) => b.pts - a.pts).slice(0, 6);
  const _rankAccents = ['var(--gold)','var(--silver)','var(--bronze)','var(--text-muted)','var(--text-muted)','var(--text-muted)'];
  const topPerfHtml = topPerformers.length ? topPerformers.map((p,i) => {
    return `<div class="team-performer-card">
      <div class="team-perf-rank" style="color:${_rankAccents[i]}">${i+1}</div>
      <div class="team-perf-info">
        <div class="team-perf-name"><a href="#/atleta/${esc(p.id)}">${esc(p.cognome)} <span style="font-weight:400">${esc(p.nome)}</span></a></div>
      </div>
      <div class="team-perf-right">
        <div class="team-perf-pts">${p.pts}<small>pts</small></div>
      </div>
    </div>`;
  }).join('') : '<div class="empty-state">Nessun risultato stagionale</div>';

  // Identity strip HTML
  const identityHtml = `
    <div class="team-identity-strip">
      <div class="team-intel-card">
        <div class="team-intel-label">MISSIONE — ${catLabel(teamViewCat)}</div>
        <div class="team-mission-tag" style="color:${mission.color}">${mission.label}</div>
        <div class="team-mission-desc">${mission.desc}</div>
        <div class="team-cat-quickstats">
          ${catWins > 0 ? `<span class="team-cat-quickstat">${catWins} vittorie</span>` : ''}
          ${catPodi > catWins ? `<span class="team-cat-quickstat">${catPodi} podi</span>` : ''}
        </div>
      </div>
      <div class="team-intel-card">
        <div class="team-intel-label">PUNTI DI FORZA</div>
        ${strengths.length ? `<div class="team-strength-list">${strengths.map(s=>`
          <div class="team-strength-item">
            <div><div class="team-strength-name">${s.label}</div><div class="team-strength-desc">${s.desc}</div></div>
          </div>`).join('')}</div>`
        : '<p style="color:var(--text-muted);font-size:0.8rem;margin:8px 0 0">Dati in costruzione — torna dopo qualche gara.</p>'}
      </div>
      <div class="team-intel-card">
        <div class="team-intel-label">FORMA ATTUALE</div>
        <div class="team-momentum-label" style="color:${momentum.color}">${momentum.label}</div>
        <div class="team-momentum-track">
          <div class="team-momentum-fill" style="width:${momentum.pct}%;background:${momentum.color}"></div>
          <div class="team-momentum-marker" style="left:${momentum.pct}%"></div>
        </div>
        <div class="team-momentum-sub">Ultime 2 settimane vs precedenti</div>
        <div class="team-intel-label" style="margin-top:18px;margin-bottom:4px">IDENTITÀ STAGIONALE</div>
        <div style="font-size:0.82rem;color:var(--text-secondary);line-height:1.5">
          ${(() => {
            const races = new Set(allTeamRes.map(r=>r.gara_id)).size;
            const podi  = allTeamRes.filter(r=>r.posizione<=3).length;
            const cats  = [...new Set(allTeamRes.map(r=>getRankingFileCode(r)).filter(Boolean))];
            const bestCatRank = tCatRanks.slice().sort((a,b)=>a.pos-b.pos)[0];
            let lines = [];
            if (races)  lines.push(`<strong>${races}</strong> gare disputate`);
            if (podi)   lines.push(`<strong>${podi}</strong> podi stagionali`);
            if (cats.length > 1) lines.push(`Presente in <strong>${cats.length}</strong> categorie`);
            if (bestCatRank) lines.push(`Miglior ranking: <strong>${bestCatRank.pos}°</strong> in ${catLabel(bestCatRank.cat)}`);
            return lines.join(' · ') || 'Stagione in corso.';
          })()}
        </div>
      </div>
    </div>`;

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
      <button class="btn-share" onclick="window.openComparatore('${esc(team_id)}','team')">⚖ Compara</button>
      ${adminEditBtn('team', team_id)}
    </div>

    ${catTabsHtml}

    <div class="section-header" style="margin-top:28px">
      <span class="section-title">CORRIDORI CHIAVE</span>
      <span class="section-line"></span>
      <span class="section-subtitle">${catLabel(teamViewCat)}</span>
    </div>
    <div class="team-performers-list" style="margin-bottom:28px">${topPerfHtml}</div>

    ${buildProfileMedia(allTeamRes, teamPhotosMap, globalData.videos, { showAthleteName: true })}
    <div class="section-header" style="margin-top:28px">
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
  overlay.id = 'modal-overlay';
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
      body: { url: newUrl, ...(newTitle ? { title: newTitle } : {}) },
    });
    if (window._currentGaraId) renderGara(window._currentGaraId);
  } catch(e) { alert('Errore: ' + e.message); }
};

// ── GARA ──────────────────────────────────────────────────────
async function renderGara(gara_id) {
  if (!globalData) return;
  const { resultsRaw, calendar } = globalData;

  // ES1/ES2 Esordienti: canonicalize to ES1 and merge both results in one page
  const esMatch = gara_id.match(/^(.+)_ES([12])_([MF])$/);
  let isEsordienti = false, es1GaraId = gara_id, es2GaraId = null;
  if (esMatch) {
    isEsordienti = true;
    const base = esMatch[1], gender = esMatch[3];
    es1GaraId = `${base}_ES1_${gender}`;
    es2GaraId = `${base}_ES2_${gender}`;
  }
  const primaryGaraId = es1GaraId; // canonical ID for photos, videos, URL

  const calEntry = calendar.find(g => g.id === primaryGaraId) || calendar.find(g => g.id === gara_id);
  const results1 = resultsRaw.filter(r => r.gara_id === es1GaraId).sort((a,b) => a.posizione - b.posizione);
  const results2 = isEsordienti ? resultsRaw.filter(r => r.gara_id === es2GaraId).sort((a,b) => a.posizione - b.posizione) : [];
  const results = [...results1, ...results2];

  if (!results.length && !calEntry) return renderNotFound();

  const name = results[0]?.nome_gara || calEntry?.nome || gara_id;
  const data = results[0]?.data || calEntry?.data || '';
  const cat  = isEsordienti ? 'Esordienti' : (results[0]?.categoria || calEntry?.categoria || '');
  // Usa moltiplicatore già calcolato dal scraper se disponibile
  const mult = results[0]?.moltiplicatore ||
    calEntry?.moltiplicatore ||
    multFromType(
      calEntry?.tipo || results[0]?.tipo || 'regionale',
      calEntry?.campionato_regionale || false,
      calEntry?.campionato_italiano  || false
    );
  const tipo = results[0]?.tipo || calEntry?.tipo || 'regionale';

  const _buildRows = (arr) => arr.map(r => {
    const pts = r.punti_effettivi || (BASEPTS[r.posizione]||0) * mult;
    const pClass = posClass(r.posizione);
    const rkTag = r.rank_dopo_gara ? `<span class="ris-rank-pos">${r.rank_dopo_gara}° class.</span>` : '';
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
      <td class="td-pts">${pts > 0 ? pts : '—'}${rkTag}</td>
    </tr>`;
  }).join('');
  const _esCatHeader = (label) =>
    `<tr><td colspan="7" style="background:var(--bg-card);color:var(--primary);font-family:var(--font-heading);font-weight:800;font-size:0.78rem;letter-spacing:.08em;text-transform:uppercase;padding:10px 14px;border-bottom:2px solid var(--primary)">${label}</td></tr>`;
  let tableRows;
  if (isEsordienti) {
    tableRows =
      _esCatHeader('Esordienti 1° Anno') +
      (_buildRows(results1) || '<tr><td colspan="7" class="empty-state">Nessuna classifica disponibile</td></tr>') +
      (results2.length ? _esCatHeader('Esordienti 2° Anno') + _buildRows(results2) : '');
  } else {
    tableRows = _buildRows(results);
  }

  const _calId = (globalData.garaToCalId || {})[primaryGaraId] || (globalData.garaToCalId || {})[gara_id] || primaryGaraId;

  let detailsHtml = '';
  const _raceDetail = (globalData.raceDetails || {})[primaryGaraId] || (globalData.raceDetails || {})[gara_id] || (globalData.raceDetails || {})[_calId];
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
  // Avvia fetch in background senza timeout — se Render è in sleep (50s+) la pagina
  // si renderizza subito con i dati locali, poi si aggiorna automaticamente con i video
  // quando Render risponde (anche dopo 30-60s).
  fetch(`${API_BASE}/videos`)
    .then(r => r.ok ? r.json() : null)
    .then(fresh => {
      if (!fresh || !globalData) return;
      console.log('[video-debug] API /videos risposta:', JSON.stringify(fresh).slice(0,300));
      const changed = JSON.stringify(globalData.videos) !== JSON.stringify(fresh);
      globalData.videos = fresh;
      if (changed && window._currentGaraId === gara_id) renderGara(gara_id);
    })
    .catch(e => console.warn('[video-debug] fetch fallito:', e.message));

  // Lookup multi-livello: prima per gara_id COMPLETO (con categoria) per evitare
  // che categorie diverse della stessa gara condividano i video, poi fallback
  // al calId per retrocompatibilità con video inseriti prima di questa fix.
  const _vids = globalData.videos || {};
  const _calIdStripped = _calId.replace(/_[A-Z0-9]+_[MF]$/, ''); // rimuove _JUN_M, _ELI_M ecc.
  // Unisce video da tutte le chiavi possibili (nuova + legacy) e deduplica per URL
  const _videoKeys = [
    primaryGaraId,
    gara_id,
    _calId,
    _calIdStripped !== _calId ? _calIdStripped : null,
    primaryGaraId.replace(/_[A-Z0-9]+_[MF]$/, ''),
  ].filter(Boolean);
  const _seenVideoUrls = new Set();
  const garaVideos = _videoKeys
    .flatMap(k => _vids[k] || [])
    .filter(v => { if (_seenVideoUrls.has(v.url)) return false; _seenVideoUrls.add(v.url); return true; });
  const featuredVideo = garaVideos[0] || null;
  const featuredVideoId = featuredVideo ? ytId(featuredVideo.url) : null;
  const extraVideos = garaVideos.slice(1);

  // ── Media section: video (sempre) + foto (se server disponibile) ──────────
  // I video vengono costruiti FUORI dal try così appaiono sempre, anche se
  // il caricamento delle foto fallisce.
  let racePhotosHtml = '';
  let extraVideosHtml = '';
  const _user    = authUser();
  const _isAdmin = _user?.role === 'admin';
  const _adminBtnStyle = 'padding:3px 7px;font-size:0.68rem;color:#fff;border:none;border-radius:4px;cursor:pointer;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.5)';

  // Pulsante "Aggiungi Video" (sempre, se loggato)
  const _addVideoBtn = _user
    ? `<button class="race-photo-upload-btn" onclick="window.openVideoSubmit('${esc(primaryGaraId)}','${esc(_calId)}')">
         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
         Aggiungi Video
       </button>`
    : '';

  // Helper: costruisce un elemento video (usato per hero e side-by-side)
  const _buildVideoEl = (v, idx, cls = 'gara-media-half gara-media-video') => {
    const vId = ytId(v.url);
    if (!vId) return '';
    return `<div class="${cls}" onclick="window.openVideoModal('${vId}','${esc((v.title||'').replace(/'/g, "\\'"))}')">
      <img src="https://img.youtube.com/vi/${vId}/hqdefault.jpg" alt="${esc(v.title||'Video')}" loading="lazy"/>
      <div class="gara-media-play"><span>&#9658;</span></div>
      ${v.channel ? `<div class="gara-media-channel">${esc(v.channel)}</div>` : ''}
      ${_isAdmin ? `<div style="position:absolute;top:4px;right:4px;display:flex;flex-direction:column;gap:3px;z-index:10">
        <button onclick="event.stopPropagation();window.adminEditVideo('${esc(primaryGaraId)}',${idx})" style="${_adminBtnStyle};background:#2563eb">✏️ Modifica</button>
        <button onclick="event.stopPropagation();window.adminDeleteVideo('${esc(primaryGaraId)}',${idx})" style="${_adminBtnStyle};background:#dc2626">🗑 Elimina</button>
      </div>` : ''}
      ${v.title ? `<div class="gara-video-hero-caption">${esc(v.title)}</div>` : ''}
    </div>`;
  };

  // Hero video (sempre visibile se esiste) — il layout finale dipende dalle foto,
  // quindi viene assemblato DOPO il blocco foto qui sotto.
  const _heroVideoEl = featuredVideoId ? _buildVideoEl(featuredVideo, 0) : '';

  // Extra video cards (sempre visibili)
  // L'indice di partenza degli "extra" dipende da quanti video vanno in hero:
  // verrà ricalcolato dopo le foto. Qui prepariamo solo la funzione di render.
  const _buildExtraVideos = (startIdx) => {
    const extras = garaVideos.slice(startIdx);
    if (!extras.length) return '';
    return `
      <div class="comp-section" style="margin-top:12px">
        <div class="comp-section-title">Altri Video</div>
        <div class="gara-videos-grid">
          ${extras.map((v, i) => {
            const vidId = ytId(v.url) || '';
            const thumb = vidId ? `https://img.youtube.com/vi/${vidId}/mqdefault.jpg` : '';
            const realIdx = startIdx + i;
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
                ${_isAdmin ? `<div style="position:absolute;top:4px;right:4px;display:flex;gap:3px;z-index:10">
                  <button onclick="event.stopPropagation();window.adminEditVideo('${esc(primaryGaraId)}',${realIdx})" style="${_adminBtnStyle};background:#2563eb">✏️</button>
                  <button onclick="event.stopPropagation();window.adminDeleteVideo('${esc(primaryGaraId)}',${realIdx})" style="${_adminBtnStyle};background:#dc2626">🗑</button>
                </div>` : ''}
              </div>`;
          }).join('')}
        </div>
      </div>`;
  };

  // Foto approvate — in try separato: se fallisce i video sono già pronti
  let _heroPhotoEl = '';
  let _gallery     = '';
  let _uploadBtn   = _user
    ? `<button class="race-photo-upload-btn" onclick="window.openRacePhotoUpload('${esc(primaryGaraId)}')">
         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
         Carica foto
       </button>`
    : `<span style="font-size:0.8rem;color:var(--text-muted)">Accedi per caricare una foto</span>`;
  try {
    const photosData = await fetch(`${API_BASE}/race-photos/${encodeURIComponent(primaryGaraId)}`).then(r=>r.json()).catch(()=>({photos:[]}));
    const photos = photosData.photos || [];
    const featuredPhoto = photos[0] || null;
    _heroPhotoEl = featuredPhoto
      ? `<div class="gara-media-half gara-media-photo" onclick="window.openPhotoLightbox('${PHOTOS_BASE}/photos/${esc(featuredPhoto.filename)}')" style="cursor:zoom-in">
           <img id="gara-hero-img" src="${PHOTOS_BASE}/photos/${esc(featuredPhoto.filename)}" alt="${esc(featuredPhoto.caption||'Foto gara')}" loading="lazy"/>
           <div class="gara-photo-hint">🔍 Clicca per la foto intera</div>
           ${_isAdmin ? `<div style="position:absolute;top:4px;right:4px;display:flex;flex-direction:column;gap:3px;z-index:10">
             <button onclick="event.stopPropagation();window.adminEditPhoto(${featuredPhoto.id})" style="${_adminBtnStyle};background:#2563eb">✏️ Modifica</button>
             <button onclick="event.stopPropagation();window.adminDeletePhoto(${featuredPhoto.id})" style="${_adminBtnStyle};background:#dc2626">🗑 Elimina</button>
           </div>` : ''}
         </div>`
      : '';
    const extraPhotos = photos.slice(1);
    _gallery = extraPhotos.length
      ? `<div class="race-gallery">${extraPhotos.map(p=>`
          <div class="race-gallery-item" id="gal-photo-${p.id}"
            data-caption="${esc(p.caption||'')}"
            data-photographer="${esc(p.photographer||'')}">
            <img src="${PHOTOS_BASE}/photos/${esc(p.filename)}" alt="${esc(p.caption||'Foto gara')}" loading="lazy" onclick="window.openPhotoLightbox('${PHOTOS_BASE}/photos/${esc(p.filename)}')" style="cursor:zoom-in"/>
            <div class="race-gallery-caption">${[p.caption, p.photographer ? '📷 '+p.photographer : '', p.display_name].filter(Boolean).join(' — ')}</div>
            ${_isAdmin ? `<div style="position:absolute;top:4px;right:4px;display:flex;flex-direction:column;gap:3px;z-index:10">
              <button onclick="event.stopPropagation();window.adminEditPhoto(${p.id})" style="padding:3px 7px;font-size:0.68rem;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.5)">&#9999;&#65039; Modifica</button>
              <button onclick="event.stopPropagation();window.adminDeletePhoto(${p.id})" style="padding:3px 7px;font-size:0.68rem;background:#dc2626;color:#fff;border:none;border-radius:4px;cursor:pointer;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.5)">&#128465; Elimina</button>
            </div>` : ''}
          </div>`).join('')}
        </div>`
      : (!featuredPhoto ? `<p style="color:var(--text-muted);font-size:0.875rem;margin:8px 0 0">Nessuna foto ancora. Sii il primo a condividerne una!</p>` : '');

    // Fallback: se non ci sono foto caricate manualmente, usa xpix o IC
    if (!featuredPhoto) {
      const _pm = await loadRisPhotos();
      // Prova tutte le varianti possibili del gara_id (incluse ES1/ES2 per Esordienti)
      const _esBase  = primaryGaraId.replace(/_ES[12]_([MF])$/, '');
      const _es2Id   = primaryGaraId.replace(/_ES1_([MF])$/, '_ES2_$1');
      const _extPhoto = _pm[primaryGaraId]
                     || _pm[gara_id]
                     || _pm[_es2Id]
                     || _pm[_esBase + '_ES1_M'] || _pm[_esBase + '_ES1_F']
                     || _pm[_esBase + '_ES2_M'] || _pm[_esBase + '_ES2_F'];
      if (_extPhoto?.url) {
        const _src = esc(_extPhoto.url);
        const _srcLabel = _extPhoto.source === 'xpix' ? 'xpix.it' : 'italiaciclismo.net';
        _heroPhotoEl = `<div class="gara-media-half gara-media-photo" onclick="window.openPhotoLightbox('${_src}')" style="cursor:zoom-in">
           <img id="gara-hero-img" src="${_src}" alt="Foto gara" loading="lazy"/>
           <div class="gara-photo-hint">🔍 Clicca per la foto intera</div>
           <div style="position:absolute;bottom:6px;left:8px;font-size:0.65rem;color:rgba(255,255,255,.7);background:rgba(0,0,0,.45);padding:2px 6px;border-radius:3px">📷 ${_srcLabel}</div>
         </div>`;
        _gallery = '';
      }
    }
  } catch(e) { console.error('renderGara photos:', e); }

  // Assembla sezione media (foto + video combinati)
  // Regola layout:
  // • foto + video      → foto sinistra, video destra, extra video sotto
  // • solo video ×1     → video hero larghezza piena, nessun extra
  // • solo video ×2+    → primo + secondo fianco a fianco, resto come extra
  // • solo foto         → foto a sinistra, nessun video
  let _heroMedia = '';
  let _extraVideoStartIdx = 1;

  if (_heroPhotoEl && _heroVideoEl) {
    // foto sinistra + video destra
    _heroMedia = `<div class="gara-hero-media gara-hero-split">${_heroPhotoEl}${_heroVideoEl}</div>`;
    _extraVideoStartIdx = 1;
  } else if (_heroPhotoEl) {
    // solo foto
    _heroMedia = `<div class="gara-hero-media">${_heroPhotoEl}</div>`;
    _extraVideoStartIdx = 0;
  } else if (_heroVideoEl && garaVideos.length >= 2) {
    // nessuna foto + 2+ video → side by side
    const _video2El = _buildVideoEl(garaVideos[1], 1);
    _heroMedia = `<div class="gara-hero-media gara-hero-split">${_heroVideoEl}${_video2El}</div>`;
    _extraVideoStartIdx = 2;
  } else if (_heroVideoEl) {
    // nessuna foto + 1 solo video → full width
    _heroMedia = `<div class="gara-hero-media">${_heroVideoEl}</div>`;
    _extraVideoStartIdx = 1;
  }

  extraVideosHtml = _buildExtraVideos(_extraVideoStartIdx);

  racePhotosHtml = `
    <div class="comp-section" style="margin-top:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:${_heroMedia ? '12px' : '0'}">
        <div class="comp-section-title" style="margin-bottom:0;border:none;padding:0">Foto & Video</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${_uploadBtn}${_addVideoBtn}</div>
      </div>
      ${_heroMedia}
      ${_gallery}
    </div>`;

  window._shareGaraData = {name:name,date:fmtDate(data),cat:catLabel(cat),mult:mult,tipo:tipo,results:results1.slice(0,10).map(r=>({cognome:r.cognome,nome:r.nome,team:r.team,punti_effettivi:r.punti_effettivi}))};

  const siRaceIntelHtml = '';

  window._currentGaraId = primaryGaraId;
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
        ${badgeMult(mult, tipo, results1[0]?.campionato_regionale || calEntry?.campionato_regionale, results1[0]?.campionato_italiano || calEntry?.campionato_italiano)}
        ${results1[0]?.km ? `<span class="race-meta-sep">|</span><span>${esc(results1[0].km)} Km</span>` : ''}
        ${results1[0]?.media ? `<span class="race-meta-sep">|</span><span>Media: ${esc(results1[0].media)} Km/h</span>` : ''}
      </div>
    </div>
      <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn-share" onclick="window.triggerShareGara()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Condividi Risultati</button>
        ${adminEditBtn('gara', primaryGaraId)}
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
    overlay.id = 'modal-overlay';
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
    // Nome gara da _shareGaraData (già disponibile in renderGara) o da resultsRaw
    const _gd = window._shareGaraData;
    const _raceName = _gd?.name
      || (globalData?.resultsRaw||[]).find(r => r.gara_id === garaId)?.nome_gara
      || '';
    const inpStyle = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:var(--r-sm);font-size:0.875rem;background:var(--bg-primary);color:var(--text-primary);margin-bottom:10px';
    const overlay = document.createElement('div');
    overlay.id = 'modal-overlay';
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
          <div style="position:relative">
            <input type="text" id="vurl-title" placeholder="Titolo" style="${inpStyle}" value="${esc(_raceName)}"/>
            <span id="vurl-title-hint" style="position:absolute;right:8px;top:50%;transform:translateY(-70%);font-size:.7rem;color:var(--text-muted);pointer-events:none">auto</span>
          </div>
          <div style="position:relative">
            <input type="text" id="vurl-channel" placeholder="Autore / Canale" style="${inpStyle}"/>
            <span id="vurl-channel-hint" style="position:absolute;right:8px;top:50%;transform:translateY(-70%);font-size:.7rem;color:var(--text-muted);pointer-events:none">auto</span>
          </div>
          <div id="vurl-preview" style="margin-bottom:10px;display:none">
            <img id="vurl-thumb" src="" style="width:100%;border-radius:var(--r-sm);aspect-ratio:16/9;object-fit:cover"/>
          </div>
        </div>

        <div id="vpanel-file" style="display:none">
          <input type="file" id="vfile-input" accept="video/mp4,video/quicktime,video/webm,video/x-msvideo" style="${inpStyle}"/>
          <input type="text" id="vfile-title" placeholder="Titolo del video*" style="${inpStyle}" value="${esc(_raceName)}"/>
          <input type="text" id="vfile-channel" placeholder="Autore / Canale (opzionale)" style="${inpStyle}"/>
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

    // Segna i campi come "modificati manualmente" se l'utente digita
    const titleEl   = document.getElementById('vurl-title');
    const channelEl = document.getElementById('vurl-channel');
    titleEl.addEventListener('input',   () => { titleEl._manual = true;   document.getElementById('vurl-title-hint').style.display   = 'none'; });
    channelEl.addEventListener('input', () => { channelEl._manual = true; document.getElementById('vurl-channel-hint').style.display = 'none'; });

    // URL input: preview thumbnail + fetch oEmbed per titolo e canale automatici
    let _oembedTimer = null;
    document.getElementById('vurl-input').addEventListener('input', function() {
      const url = this.value.trim();
      const _vid = ytId(url);
      const preview = document.getElementById('vurl-preview');
      const thumb   = document.getElementById('vurl-thumb');
      if (_vid) { thumb.src = `https://img.youtube.com/vi/${_vid}/hqdefault.jpg`; preview.style.display = 'block'; }
      else { preview.style.display = 'none'; }

      // Fetch oEmbed con debounce 600ms
      clearTimeout(_oembedTimer);
      if (!url || !_vid) return;
      _oembedTimer = setTimeout(async () => {
        try {
          const d = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`).then(r => r.json());
          if (d.title   && !titleEl._manual)   { titleEl.value   = d.title;       document.getElementById('vurl-title-hint').style.display   = 'none'; }
          if (d.author_name && !channelEl._manual) { channelEl.value = d.author_name; document.getElementById('vurl-channel-hint').style.display = 'none'; }
        } catch { /* oEmbed non disponibile, mantieni valori esistenti */ }
      }, 600);
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
      const file    = document.getElementById('vfile-input')?.files[0];
      const title   = document.getElementById('vfile-title')?.value.trim();
      const channel = document.getElementById('vfile-channel')?.value.trim();
      if (!file) { err.textContent = 'Seleziona un file video'; err.style.display = 'block'; return; }
      if (!title) { err.textContent = 'Inserisci un titolo'; err.style.display = 'block'; return; }
      btn.disabled = true; btn.textContent = 'Caricamento…';
      document.getElementById('vfile-progress').style.display = 'block';
      const fd = new FormData();
      fd.append('gara_id', garaId);
      fd.append('cal_id', calId);
      fd.append('title', title);
      fd.append('channel', channel || '');
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
        document.getElementById('modal-overlay')?.remove();
        const user = authUser();
        showToast(user?.role === 'admin' ? '✓ Video pubblicato!' : '✓ Video inviato — in attesa di approvazione');
        if (window._currentGaraId) renderGara(window._currentGaraId);
      } catch(e) { err.textContent = e.message; err.style.display = 'block'; btn.disabled = false; btn.textContent = 'Invia'; }
    } else {
      const url     = document.getElementById('vurl-input')?.value.trim();
      const title   = document.getElementById('vurl-title')?.value.trim();
      const channel = document.getElementById('vurl-channel')?.value.trim();
      if (!url) { err.textContent = 'Inserisci un URL YouTube'; err.style.display = 'block'; return; }
      btn.disabled = true; btn.textContent = 'Invio…';
      try {
        await apiCall('/videos/submit', { method: 'POST', body: { gara_id: garaId, cal_id: calId, url, title, channel } });
        document.getElementById('modal-overlay')?.remove();
        const user = authUser();
        showToast(user?.role === 'admin' ? '✓ Video pubblicato!' : '✓ Video inviato — in attesa di approvazione');
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
      document.getElementById('modal-overlay')?.remove();
      if (data.status === 'approved') {
        showToast('✓ Foto pubblicata!');
        renderGara(window._currentGaraId);
      } else {
        showToast('✓ Foto inviata — in attesa di approvazione', 'info');
      }
    } catch(e) {
      errEl.textContent = e.message; errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Invia';
    }
  };

}

let calQGenere  = '';
let calQTipo    = '';
let calQSearch  = '';
let calQCat     = '';
let calQMonth   = '';
let calQRegione = '';
let calView     = 'lista';   // 'lista' | 'mappa'
let _calMap     = null;      // istanza Leaflet
let _calCluster = null;      // istanza MarkerCluster
let _raceDetailsCache = null; // cache race_details.json

// Deriva il genere da campo categoria/nome (il JSON calendar non ha campo genere)
function _calDeriveGender(g) {
  const t = ((g.categoria || '') + ' ' + (g.nome || '')).toLowerCase();
  if (/donne|femmin|women/.test(t)) return 'F';
  if (/maschile/.test(t)) return 'M';
  // gare promiscue / professionistiche senza genere → mostra sempre
  if (/promiscua|multicategor|pista pi|coppa nazioni|world tour|proseries|classe 1 pro|uci pro|2\.cup/.test(t)) return '';
  return 'M'; // default: maschile per categorie agonistiche senza prefisso
}

async function renderCalendario(highlightId) {
  if (!globalData) return;
  // Se arriva un deep-link a una gara specifica, forza la vista lista
  // (altrimenti con calView='mappa' verrebbe rerenderizzata la mappa al posto della card)
  if (highlightId) calView = 'lista';
  const { calendar, resultsRaw } = globalData;

  // Mappa calendar.id → { byCategory, firstGaraId }
  // Match per data + prefisso id (il gara_id dei risultati ha suffissi extra rispetto al cal.id)
  const calendarResultsMap = {};
  for (const g of calendar) {
    if (!g.id || !g.data) continue;
    const calBase = g.id.replace(/_\d{4}-\d{2}-\d{2}$/, '');
    const calBaseNoEd = calBase.replace(/^\d+_/, '');
    const _nm = s => s
      .replace(/(?<![A-Z0-9])G_P(?![A-Z0-9])/g,'GRAN_PREMIO')
      .replace(/(?<![A-Z0-9])GP(?![A-Z0-9])/g,'GRAN_PREMIO')
      .replace(/(?<![A-Z0-9])GRANPREMIO(?![A-Z0-9])/g,'GRAN_PREMIO')
      .replace(/(?<![A-Z0-9])M_O(?![A-Z0-9])/g,'MEDAGLIA_ORO')
      .replace(/(?<![A-Z0-9])A_M(?![A-Z0-9])/g,'')
      .replace(/_+/g,'_').replace(/^_|_$/g,'');
    const calNorm = _nm(calBaseNoEd);
    const calEd   = calBase !== calBaseNoEd ? (calBase.match(/^(\d+)_/)||[])[1] : null;
    const matches = resultsRaw.filter(r => {
      if (!r.gara_id || r.data !== g.data) return false;
      if (r.gara_id.startsWith(calBase)) return true;
      const garaBase = r.gara_id.replace(/^\d+_/,'').replace(/_\d{4}-\d{2}-\d{2}.*$/,'');
      if (garaBase === calBaseNoEd) return true;
      const garaNorm = _nm(garaBase);
      if (calNorm === garaNorm) return true;
      if (garaNorm.length >= 8 && calNorm.startsWith(garaNorm + '_')) return true;
      const garaEd = (r.gara_id.match(/^(\d+)_/)||[])[1];
      if (calEd && garaEd && calEd === garaEd) return true;
      // Step 6: prefisso comune ≥18 chars che termina con _ (stessa gara, nomi parzialmente diversi)
      { let i=0; while(i<calNorm.length&&i<garaNorm.length&&calNorm[i]===garaNorm[i]) i++;
        if (i>=18 && calNorm.slice(0,i).endsWith('_')) return true; }
      return false;
    });
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
      .filter(g => {
        if (!calQGenere) return true;
        const gn = _calDeriveGender(g);
        return gn === '' || gn === calQGenere; // '' = gara promiscua/pro → sempre visibile
      })
      .filter(g => {
        if (!calQCat) return true;
        const cat = (g.categoria || '').toLowerCase();
        if (calQCat === 'elite') return cat.includes('elite') || cat.includes('under');
        if (calQCat === 'alliev') return cat.includes('alliev') || cat.includes('alliev');
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

      return `<div id="cal-${esc(g.id)}" class="cal-item ${isPast?'cal-item-past':''} ${hasResults?'cal-item-has-results':''}">
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

    // Deep-link highlight: se highlightId è presente, scrolla e illumina la card
    if (highlightId) {
      const target = document.getElementById('cal-' + highlightId);
      if (target) {
        requestAnimationFrame(() => {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.classList.add('cal-item-highlight');
          setTimeout(() => target.classList.remove('cal-item-highlight'), 2800);
        });
      }
    }

    // Se la mappa è attiva, aggiornala con i dati filtrati
    if (calView === 'mappa') renderCalMap(filtered, calendarResultsMap);
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
    <div class="cal-view-toggle">
      <button id="cal-view-lista" class="cal-view-btn ${calView==='lista'?'active':''}" onclick="window.calSetView('lista')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
        Lista
      </button>
      <button id="cal-view-mappa" class="cal-view-btn ${calView==='mappa'?'active':''}" onclick="window.calSetView('mappa')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
        Mappa
      </button>
    </div>
    <div class="calendar-list" id="cal-list" style="${calView==='mappa'?'display:none':''}"></div>
    <div id="cal-map" style="${calView==='lista'?'display:none':'display:block'}"></div>
  `);

  window.calSetMonth  = (v) => { calQMonth = v; render(); };
  window.calSetGenere = (v) => { calQGenere = v; render(); };
  window.calSetCat    = (v) => { calQCat = v; render(); };
  window.calSetTipo   = (v) => { calQTipo = v; render(); };
  window.calSetSearch = (v) => { calQSearch = v; render(); };
  window.calSetRegione = (v) => { calQRegione = v; render(); };

  window.calSetView = (v) => {
    calView = v;
    const list = document.getElementById('cal-list');
    const map  = document.getElementById('cal-map');
    document.querySelectorAll('.cal-view-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('cal-view-' + v)?.classList.add('active');
    if (v === 'mappa') {
      if (list) list.style.display = 'none';
      if (map)  map.style.display  = 'block';
      // Rilancia render per passare filtered e calendarResultsMap a renderCalMap
      render();
    } else {
      if (map)  map.style.display  = 'none';
      if (list) list.style.display = 'block';
    }
  };

  render();
}

// ── CALENDARIO — Vista Mappa con Leaflet ──────────────────────────────
async function _loadLeaflet() {
  if (window.L) return; // già caricato
  // CSS Leaflet + MarkerCluster
  for (const href of [
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
    'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css',
  ]) {
    if (!document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href;
      document.head.appendChild(link);
    }
  }
  // JS Leaflet + MarkerCluster (in sequenza)
  await _loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
  await _loadScript('https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js');
}

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function _loadRaceDetails() {
  if (_raceDetailsCache) return _raceDetailsCache;
  try {
    const res = await fetch('data/race_details.json');
    _raceDetailsCache = await res.json();
  } catch(e) {
    _raceDetailsCache = {};
  }
  return _raceDetailsCache;
}

// ── Geocoding client-side con localStorage cache ──────────────────────
// v2: usa 'in' operator per distinguere null (già provato) da undefined (mai provato)
const GEO_CACHE_KEY = 'itc_geo_v2';  // bump = invalida cache vecchia (v1 usava check errato)
function _geoLoad() {
  try { return JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}'); } catch { return {}; }
}
function _geoSave(cache) {
  try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache)); } catch {}
}
async function _geoLookup(query) {
  const cache = _geoLoad();
  // Usa 'in' per distinguere "mai cercato" da "cercato ma fallito" (null)
  if (query in cache) return cache[query];
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&countrycodes=it&format=json&limit=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'it' } });
    const data = await res.json();
    if (data && data[0]) {
      const coords = [parseFloat(data[0].lat), parseFloat(data[0].lon)];
      cache[query] = coords;
      _geoSave(cache);
      return coords;
    }
  } catch {}
  // Salva null = "abbiamo già provato, non trovato" — non riprovare mai più
  cache[query] = null;
  _geoSave(cache);
  return null;
}
function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function renderCalMap(filtered, calendarResultsMap) {
  calendarResultsMap = calendarResultsMap || {};
  const container = document.getElementById('cal-map');
  if (!container) return;

  // Reset mappa precedente
  if (_calMap) { _calMap.remove(); _calMap = null; _calCluster = null; }
  container.innerHTML = '';
  container.style.height = '560px';

  try {
    await _loadLeaflet();
    const details = await _loadRaceDetails();
    const L = window.L;

    _calMap = L.map(container, { center: [42.5, 12.5], zoom: 6 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
      maxZoom: 18
    }).addTo(_calMap);
    _calCluster = L.markerClusterGroup({ maxClusterRadius: 40 });
    _calCluster.addTo(_calMap);

    const today = new Date().toISOString().split('T')[0];
    const geoCache = _geoLoad();

    // Centroidi regionali (fallback immediato quando il geocoding non è ancora avvenuto)
    const REGION_COORDS = {
      'ABRUZZO':               [42.35, 13.45],
      'BASILICATA':            [40.64, 15.97],
      'BOLZANO':               [46.50, 11.35],
      'CALABRIA':              [38.91, 16.59],
      'CAMPANIA':              [40.84, 14.67],
      'EMILIA_ROMAGNA':        [44.50, 11.34],
      'FRIULI_VENEZIA_GIULIA': [46.05, 13.30],
      'LAZIO':                 [41.90, 12.48],
      'LIGURIA':               [44.35,  8.60],
      'LOMBARDIA':             [45.47,  9.19],
      'MARCHE':                [43.61, 13.51],
      'MOLISE':                [41.56, 14.66],
      'PIEMONTE':              [44.90,  7.95],
      'PUGLIA':                [40.80, 16.55],
      'SARDEGNA':              [40.12,  9.01],
      'SICILIA':               [37.60, 14.02],
      'TOSCANA':               [43.47, 11.22],
      'TRENTO':                [46.10, 11.20],
      'UMBRIA':                [43.11, 12.39],
      'VAL_D_AOSTA':           [45.74,  7.32],
      'VENETO':                [45.44, 11.87],
    };
    // Normalizza la stringa regione per la lookup
    const normReg = s => (s||'').toUpperCase().replace(/[^A-Z]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');
    // Jitter deterministico basato sull'id della gara (stessa gara = stessa posizione tra sessioni)
    const _sh = s => { let h=5381; for(let i=0;i<s.length;i++) h=((h<<5)+h)^s.charCodeAt(i); return h>>>0; };
    const regionJitter = id => [
      ((_sh(id)        % 2000) - 1000) / 1000 * 0.30,  // ±0.30° lat ≈ ±33 km
      ((_sh(id+'~lng') % 2000) - 1000) / 1000 * 0.45,  // ±0.45° lng
    ];

    // Costruisce lista di query in ordine di precisione (si prova la prima, poi le fallback)
    const buildGeoQueries = (g, det) => {
      const qs = [];
      if (det.indirizzo_ritrovo && det.luogo_ritrovo)
        qs.push(`${det.indirizzo_ritrovo}, ${det.luogo_ritrovo}, Italia`);
      if (det.luogo_ritrovo)
        qs.push(`${det.luogo_ritrovo}, Italia`);
      if (g.luogo && g.regione)
        qs.push(`${g.luogo}, ${g.regione}, Italia`);
      if (g.luogo)
        qs.push(`${g.luogo}, Italia`);
      return qs;
    };
    // Prima query con coords valide in cache
    const getCachedCoords = qs => { for(const q of qs) if(Array.isArray(geoCache[q])) return geoCache[q]; return null; };

    // Funzione che aggiunge un pin; restituisce il marker Leaflet
    const addPin = (g, det, lat, lng, isApprox = false) => {
      const isPast   = (g.data || '') < today;
      const dateStr  = g.data ? new Date(g.data + 'T00:00:00').toLocaleDateString('it-IT', { day:'numeric', month:'long' }) : '';
      const catStr   = catLabel(g.categoria) || g.categoria || '';
      const genIcon  = g.genere === 'F' ? '♀' : '♂';
      const cat      = (g.categoria || '').toLowerCase();
      const pinColor = g.genere === 'F'         ? '#EC4899'
        : cat.includes('elite')                 ? '#E11D48'
        : cat.includes('junior')                ? '#F97316'
        : cat.includes('alliev')                ? '#8B5CF6'
        : cat.includes('esordient')             ? '#10B981'
        : '#6B7280';
      const opacity  = isPast ? '0.5' : '1';
      // Pin approssimativo (posizione regionale): teardrop grigio con ? — sempre visibile
      const fillColor = isApprox ? '#9CA3AF' : pinColor;

      const icon = L.divIcon({
        className: '',
        html: isApprox
          ? `<svg width="24" height="32" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg" style="opacity:${opacity};filter:drop-shadow(0 2px 2px rgba(0,0,0,.3))">
               <path d="M12 0C5.373 0 0 5.373 0 12c0 8.5 12 20 12 20S24 20.5 24 12C24 5.373 18.627 0 12 0z" fill="${fillColor}"/>
               <text x="12" y="16" text-anchor="middle" font-size="11" font-weight="bold" fill="white" font-family="system-ui,sans-serif">?</text>
             </svg>`
          : `<svg width="24" height="32" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg" style="opacity:${opacity};filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))">
               <path d="M12 0C5.373 0 0 5.373 0 12c0 8.5 12 20 12 20S24 20.5 24 12C24 5.373 18.627 0 12 0z" fill="${fillColor}"/>
               <circle cx="12" cy="11" r="4.5" fill="white"/>
             </svg>`,
        iconSize: [24, 32],
        iconAnchor: [12, 32],
        popupAnchor: [0, -32]
      });

      // Destinazione: gara PASSATA → risultati; gara FUTURA → calendario
      const calMatch = calendarResultsMap[g.id];
      const navHash  = (isPast && calMatch)
        ? `#/gara/${encodeURIComponent(calMatch.firstGaraId)}`
        : `#/calendario/${encodeURIComponent(g.id)}`;
      const navLabel = (isPast && calMatch) ? '→ Vai ai Risultati' : '→ Vedi nel Calendario';
      const navColor = (isPast && calMatch) ? '#E11D48' : '#6366F1';
      // Inline onclick — unico modo affidabile per navigare da dentro un popup Leaflet
      const navOnclick = `event.stopPropagation();location.hash='${navHash.replace(/'/g,"\\'")}';`;

      const luogoDisplay = det.luogo_ritrovo || g.luogo || '';
      const popupContent = `
        <div style="font-family:system-ui,sans-serif;font-size:13px;line-height:1.5">
          <div style="font-weight:700;margin-bottom:3px;font-size:14px">${esc(g.nome)}</div>
          <div style="color:#666;margin-bottom:2px">${dateStr} ${genIcon}</div>
          <div style="color:#666;margin-bottom:6px">${catStr}</div>
          ${luogoDisplay ? `<div style="font-size:12px;color:#888">📍 ${esc(luogoDisplay)}</div>` : ''}
          ${isApprox ? `<div style="font-size:10px;color:#bbb;margin-top:2px">📌 posizione indicativa (${g.regione})</div>` : ''}
          <button onclick="${navOnclick}"
            style="margin-top:10px;width:100%;padding:7px 0;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;background:${navColor};color:#fff">
            ${navLabel}
          </button>
        </div>`;

      const popup = L.popup({ maxWidth: 240 }).setContent(popupContent);
      const marker = L.marker([lat, lng], { icon }).bindPopup(popup);
      marker.addTo(_calCluster);
      return marker;
    };

    // ── Passata 1: aggiungi TUTTE le gare immediatamente ─────────────────────
    // Priorità: lat/lng scraper → localStorage cache → centroide regionale + jitter
    const approxMarkers = {}; // g.id → marker per i pin approssimativi (da aggiornare)
    for (const g of filtered) {
      const det = details[g.id] || {};
      let lat = det.lat || null, lng = det.lng || null, isApprox = false;
      if (!lat) {
        const cached = getCachedCoords(buildGeoQueries(g, det));
        if (cached) [lat, lng] = cached;
      }
      if (!lat) {
        // Fallback: centroide regionale + jitter deterministico
        const rk = normReg(g.regione);
        const [clat, clng] = REGION_COORDS[rk] || [42.5, 12.5];
        const [jlat, jlng] = regionJitter(g.id);
        lat = clat + jlat; lng = clng + jlng;
        isApprox = true;
      }
      const marker = addPin(g, det, lat, lng, isApprox);
      if (isApprox) approxMarkers[g.id] = marker;
    }

    // Zoom iniziale sull'Italia intera (tutti i pin già presenti)
    if (_calCluster.getLayers().length > 0 && _calCluster.getBounds().isValid()) {
      _calMap.fitBounds(_calCluster.getBounds(), { padding: [40, 40], maxZoom: 10 });
    }

    // ── Passata 2: geocodifica in background le gare approssimate ────────────
    // Aggiorna il pin dal cerchio tratteggiato al teardrop preciso man mano che
    // Nominatim risponde. I risultati vengono salvati in localStorage per le sessioni future.
    const toGeocode = [];
    for (const g of Object.keys(approxMarkers)) {
      const gObj = filtered.find(x => x.id === g);
      if (!gObj) continue;
      const det = details[g] || {};
      const queries = buildGeoQueries(gObj, det);
      if (queries.some(q => !(q in geoCache))) toGeocode.push({ g: gObj, det, queries });
    }

    let progressEl = null;
    if (toGeocode.length > 0) {
      progressEl = document.createElement('div');
      progressEl.style.cssText = 'position:absolute;bottom:12px;left:50%;transform:translateX(-50%);z-index:1000;background:rgba(0,0,0,.7);color:#fff;font-size:0.72rem;padding:6px 14px;border-radius:20px;pointer-events:none';
      progressEl.textContent = `Precisione mappa: 0/${toGeocode.length}…`;
      container.style.position = 'relative';
      container.appendChild(progressEl);
    }

    let done = 0;
    for (const { g, det, queries } of toGeocode) {
      if (calView !== 'mappa' || !document.getElementById('cal-map')) break;
      let coords = null;
      for (const q of queries) {
        if (q in geoCache) { if (Array.isArray(geoCache[q])) { coords = geoCache[q]; break; } continue; }
        coords = await _geoLookup(q);
        await _sleep(1100);
        if (coords) break;
      }
      done++;
      if (progressEl) progressEl.textContent = `Precisione mappa: ${done}/${toGeocode.length}…`;
      if (coords && approxMarkers[g.id]) {
        // Rimuovi pin approssimativo e aggiungi pin preciso
        _calCluster.removeLayer(approxMarkers[g.id]);
        delete approxMarkers[g.id];
        addPin(g, det, coords[0], coords[1], false);
      }
    }

    if (progressEl) progressEl.remove();

  } catch(e) {
    console.error('[renderCalMap]', e);
    if (container) container.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text-muted)">Errore: ${esc(e.message)}</div>`;
  }
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

  // ── Editorial intelligence section (stats page top) ──────────
  // 1. Championship overview
  const siIntelRaces = new Set(resultsRaw.map(r => r.gara_id)).size;
  const siIntelAthletes = new Set(resultsRaw.filter(r => r.punti_effettivi > 0).map(r => r.atleta_id)).size;

  // Find overall leader (across all categories): athlete with most wins or points
  // We derive a simple cross-cat top from siWinCounts
  const siIntelLeader = siTopWinner ? athletes[siTopWinner[0]] : null;
  const siIntelLeaderName = siIntelLeader ? `${siIntelLeader.cognome} ${siIntelLeader.nome}` : null;
  const siIntelLeaderWins = siTopWinner ? siTopWinner[1] : 0;

  // Best trajectory: athlete whose siSeasonArc shows most improvement
  let siBestArcId = null, siBestImprovement = -Infinity;
  const siArcCandidates = Object.entries(siRaceCounts).filter(([id, g]) => g >= 5);
  for (const [id] of siArcCandidates.slice(0, 60)) { // sample up to 60 for perf
    const arc = siSeasonArc(id, resultsRaw);
    if (!arc) continue;
    const improvement = arc.earlyAvg - arc.lateAvg;
    if (improvement > siBestImprovement) { siBestImprovement = improvement; siBestArcId = id; }
  }
  const siBestArcAtleta = siBestArcId ? athletes[siBestArcId] : null;
  const siBestArcName = siBestArcAtleta ? `${siBestArcAtleta.cognome} ${siBestArcAtleta.nome}` : null;

  // Most consistent: lowest position stddev, ≥5 races
  let siMostConsistentId = null, siLowestStddev = Infinity;
  for (const [id] of siArcCandidates) {
    const arc = siSeasonArc(id, resultsRaw);
    if (!arc || arc.n < 5) continue;
    const myPos = resultsRaw.filter(r => r.atleta_id === id && r.posizione && r.data).map(r => r.posizione);
    const mn = myPos.reduce((s,v)=>s+v,0)/myPos.length;
    const sd = Math.sqrt(myPos.reduce((s,v)=>s+Math.pow(v-mn,2),0)/myPos.length);
    if (sd < siLowestStddev) { siLowestStddev = sd; siMostConsistentId = id; }
  }
  const siMostConsistentAtleta = siMostConsistentId ? athletes[siMostConsistentId] : null;
  const siMostConsistentName = siMostConsistentAtleta ? `${siMostConsistentAtleta.cognome} ${siMostConsistentAtleta.nome}` : null;

  // Team with most wins in season
  const siTeamWinMap = {};
  let siTotalWins = 0;
  for (const r of resultsRaw) {
    if (r.posizione !== 1 || !r.team_id) continue;
    if (!siTeamWinMap[r.team_id]) siTeamWinMap[r.team_id] = { team:r.team, wins:0 };
    siTeamWinMap[r.team_id].wins++;
    siTotalWins++;
  }
  const siTopTeam = Object.values(siTeamWinMap).sort((a,b) => b.wins - a.wins)[0];

  // Top rivalry pair (season-long close finishes)
  const siRivPairs = {};
  const siByRaceAll = {};
  for (const r of resultsRaw) {
    if (!r.gara_id || !r.posizione || !r.data) continue;
    if (!siByRaceAll[r.gara_id]) siByRaceAll[r.gara_id] = [];
    siByRaceAll[r.gara_id].push(r);
  }
  for (const raceResults of Object.values(siByRaceAll)) {
    const sorted = raceResults.slice().sort((a,b) => a.posizione - b.posizione);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i+1; j < sorted.length; j++) {
        if (sorted[j].posizione - sorted[i].posizione >= 3) break;
        const a = sorted[i], b = sorted[j];
        if (a.atleta_id === b.atleta_id) continue;
        const key = [a.atleta_id, b.atleta_id].sort().join('|');
        if (!siRivPairs[key]) siRivPairs[key] = { aCog:a.cognome, bCog:b.cognome, aId:a.atleta_id, bId:b.atleta_id, close:0 };
        siRivPairs[key].close++;
      }
    }
  }
  const siTopRiv = Object.values(siRivPairs).filter(p => p.close >= 3).sort((a,b) => b.close - a.close)[0];

  // Build the editorial HTML
  const siOverviewParts = [];
  if (siIntelRaces > 0) siOverviewParts.push(`${siIntelRaces} gare disputate`);
  if (siIntelAthletes > 0) siOverviewParts.push(`${siIntelAthletes} atleti classificati`);
  const siOverviewBase = siOverviewParts.join(', ');
  const siOverviewLeader = siIntelLeaderName ? ` ${esc(siIntelLeaderName)} guida la stagione con ${siIntelLeaderWins} vittorie.` : '';

  const siDynamicsSentences = [];
  if (siBestArcName && siBestImprovement > 1) {
    siDynamicsSentences.push(`<strong style="color:var(--text-primary)">${esc(siBestArcName)}</strong> è l'atleta con la progressione più marcata della stagione.`);
  }
  if (siMostConsistentName) {
    siDynamicsSentences.push(`<strong style="color:var(--text-primary)">${esc(siMostConsistentName)}</strong> è il corridore più regolare, con la minor varianza nei piazzamenti.`);
  }
  if (siTopTeam && siTotalWins > 0) {
    const teamPct = Math.round(siTopTeam.wins / siTotalWins * 100);
    siDynamicsSentences.push(`<strong style="color:var(--text-primary)">${esc(siTopTeam.team)}</strong> è la squadra più vincente: ${siTopTeam.wins} successi (${teamPct}% del totale).`);
  }

  const siRivalrySentences = [];
  if (siTopRiv) {
    siRivalrySentences.push(`La rivalità più accesa della stagione oppone <strong style="color:var(--text-primary)">${esc(siTopRiv.aCog)}</strong> e <strong style="color:var(--text-primary)">${esc(siTopRiv.bCog)}</strong>: ${siTopRiv.close} arrivi ravvicinati.`);
  }

  const siIntelHtml = (siOverviewBase || siDynamicsSentences.length || siRivalrySentences.length) ? `
  <section class="stats-intel-section">
    <div class="stats-intel-lead">
      ${siOverviewBase ? `<p style="font-family:var(--font-heading);font-size:1.05rem;color:var(--text-primary);margin:0 0 12px 0;line-height:1.5">Stagione in corso: ${siOverviewBase}.${siOverviewLeader}</p>` : ''}
      ${siDynamicsSentences.map(s => `<p style="color:var(--text-secondary);margin:0 0 8px 0;line-height:1.6;font-size:0.95rem">${s}</p>`).join('')}
      ${siRivalrySentences.map(s => `<p style="color:var(--text-secondary);margin:0 0 8px 0;line-height:1.6;font-size:0.95rem">${s}</p>`).join('')}
    </div>
  </section>` : '';

  let activeRegTab = 'M';
  setPage(`
    <div class="pg-header">
      <div class="pg-eyebrow">📊 ANALISI & DATI</div>
      <h1 class="pg-title">STATISTICHE</h1>
    </div>

    <!-- EDITORIAL INTELLIGENCE SECTION -->
    ${siIntelHtml}

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

window.openComparatore = (id, mode, gender, cat) => {
  compMode = mode || 'atleta'; compA = id; compB = '';
  if (gender) compGender = gender;
  if (cat) compCat = cat;
  location.hash = '#/comparatore';
};
window.openComparatoreVs = (aId, bId, mode, gender, cat) => {
  compMode = mode || 'atleta'; compA = aId; compB = bId;
  if (gender) compGender = gender;
  if (cat) compCat = cat;
  location.hash = '#/comparatore';
};

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

  // Categorie per dropdown — usa codici normalizzati per coerenza con activeHub.mainCat
  const availCats = [...new Set(
    resultsRaw.filter(r => r.genere === compGender)
      .map(r => getRankingFileCode(r)).filter(Boolean)
  )].sort();
  const catOpts = availCats.map(c =>
    `<option value="${esc(c)}" ${c === compCat ? 'selected' : ''}>${esc(catLabel(c))}</option>`
  ).join('');
  // Filtro categoria usa getRankingFileCode per confrontare con il codice normalizzato
  const catFilter = r => r.genere === compGender && (!compCat || getRankingFileCode(r) === compCat);

  // ── STATS CALCULATOR ──────────────────────────────────────────
  // NOTA: arr contiene solo i piazzamenti registrati, NON tutte le gare disputate.
  // I corridori gareggiano ~1 volta a settimana — i dati mostrano solo dove hanno un risultato.
  const calcStats = arr => {
    const sorted = [...arr].sort((a,b) => (b.data||'').localeCompare(a.data||''));
    const wins   = arr.filter(r => r.posizione === 1).length;
    const podi   = arr.filter(r => r.posizione <= 3).length;
    const top5   = arr.filter(r => r.posizione <= 5).length;
    const top10  = arr.filter(r => r.posizione <= 10).length;
    const piazzamenti = arr.length;                          // righe risultato, NON gare totali
    const gare   = new Set(arr.map(r => r.gara_id)).size;   // gare distinte con risultato
    const pts    = arr.reduce((s,r) => s + (r.punti_effettivi||0), 0);
    const km     = Math.round(arr.reduce((s,r) => s + (parseFloat(r.km)||0), 0));
    const mArr   = arr.filter(r => r.media && parseFloat(r.media) > 0);
    const mediaKm = mArr.length
      ? (mArr.reduce((s,r) => s+(parseFloat(r.media)||0),0)/mArr.length).toFixed(1) : '—';
    const avgPos = piazzamenti
      ? (arr.reduce((s,r)=>s+r.posizione,0)/piazzamenti).toFixed(1) : '—';
    const recent8   = sorted.slice(0,8);
    const recent5   = sorted.slice(0,5);
    const recent5pts = recent5.reduce((s,r)=>s+(r.punti_effettivi||0),0);
    const ptsPerResult = piazzamenti ? +(pts/piazzamenti).toFixed(1) : 0;
    const vittorie  = sorted.filter(r=>r.posizione===1).slice(0,5);
    // ── Metriche derivate (calcolate SUI RISULTATI REGISTRATI) ──────
    // convRate/podioRate/consistRate: % calcolate su piazzamenti, non su gare totali
    const convRate    = piazzamenti ? Math.round(wins/piazzamenti*100) : 0;
    const podioRate   = piazzamenti ? Math.round(podi/piazzamenti*100) : 0;
    const consistRate = piazzamenti ? Math.round(top10/piazzamenti*100) : 0;
    const bestPos     = arr.length ? Math.min(...arr.map(r=>r.posizione)) : null;
    const maxKm       = arr.length ? Math.max(...arr.map(r=>parseFloat(r.km)||0)) : 0;
    // Trend: posizione media ultimi 3 vs 3 precedenti (desc per data)
    const t3  = sorted.slice(0,3);
    const t3p = sorted.slice(3,6);
    const avgT3  = t3.length  ? t3.reduce((s,r)=>s+r.posizione,0)/t3.length  : null;
    const avgT3p = t3p.length ? t3p.reduce((s,r)=>s+r.posizione,0)/t3p.length : null;
    let trend;
    if      (avgT3 === null)      trend = {label:'—',            color:'var(--text-muted)'};
    else if (avgT3p === null)     trend = {label:'→ Stabile',    color:'#F59E0B'};
    else {
      const delta = avgT3p - avgT3;   // positivo = miglioramento (pos bassa = meglio)
      trend = delta > 2  ? {label:'↑ In crescita', color:'#10B981'}
            : delta < -2 ? {label:'↓ In calo',     color:'#EF4444'}
            :              {label:'→ Stabile',      color:'#F59E0B'};
    }
    return { pts, wins, podi, top5, top10, piazzamenti, gare, km, mediaKm,
             avgPos, recent8, recent5, recent5pts, ptsPerResult, vittorie,
             convRate, podioRate, consistRate, bestPos, maxKm, trend };
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

  // Radar rimosso — sostituito con dati reali

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

  // ── METRICA BAR INVERSA (vince il valore più basso, es. posizione) ─
  const mBarInv = (vA, vB, label, fmt='') => {
    const nA=parseFloat(vA)||99, nB=parseFloat(vB)||99;
    const iA=1/Math.max(nA,0.01), iB=1/Math.max(nB,0.01), tot=iA+iB||1;
    const pA=Math.round(iA/tot*100);
    const wA=nA<nB, wB=nB<nA;
    return `<div class="comp-bar-row">
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

  // ── SCOREBOARD (conta metriche vinte) ─────────────────────────
  const buildScoreboard = (sA, sB, nA, nB) => {
    let scoreA=0, scoreB=0;
    const cmp = (a, b, inv=false) => {
      if(a===b) return;
      (inv ? a<b : a>b) ? scoreA++ : scoreB++;
    };
    cmp(sA.pts,          sB.pts);
    cmp(sA.wins,         sB.wins);
    cmp(sA.podi,         sB.podi);
    cmp(sA.top5,         sB.top5);
    cmp(sA.top10,        sB.top10);
    cmp(sA.km,           sB.km);
    cmp(sA.convRate,     sB.convRate);
    cmp(sA.consistRate,  sB.consistRate);
    cmp(sA.recent5pts,   sB.recent5pts);
    cmp(parseFloat(sA.avgPos)||99, parseFloat(sB.avgPos)||99, true);
    const leadA=scoreA>scoreB, leadB=scoreB>scoreA;
    const leaderName = leadA ? nA.split(' ')[0] : leadB ? nB.split(' ')[0] : null;
    const sub = leaderName
      ? `${esc(leaderName)} conduce su ${scoreA+scoreB} metriche`
      : 'Confronto in equilibrio';
    return `<div class="comp-scoreboard">
      <div class="comp-score-a" style="color:#FF6B00">${scoreA}</div>
      <div class="comp-score-mid">
        <div class="comp-score-title">METRICHE VINTE</div>
        <div class="comp-score-sub">${sub}</div>
      </div>
      <div class="comp-score-b" style="color:#10B981">${scoreB}</div>
    </div>`;
  };

  // ── BADGES (chi primeggia in cosa) ────────────────────────────
  const buildBadges = (sA, sB, nA, nB) => {
    const bA=[], bB=[];
    if(sA.pts    > sB.pts)    bA.push('⚡ Top scorer');  else if(sB.pts    > sA.pts)    bB.push('⚡ Top scorer');
    if(sA.wins   > sB.wins)   bA.push('🏆 Più vittorie'); else if(sB.wins   > sA.wins)   bB.push('🏆 Più vittorie');
    if(sA.recent5pts > sB.recent5pts) bA.push('🔥 Forma migliore'); else if(sB.recent5pts > sA.recent5pts) bB.push('🔥 Forma migliore');
    if(sA.consistRate > sB.consistRate) bA.push('🎯 Più regolare'); else if(sB.consistRate > sA.consistRate) bB.push('🎯 Più regolare');
    if(sA.km     > sB.km)     bA.push('🛣️ Più km');      else if(sB.km     > sA.km)     bB.push('🛣️ Più km');
    if(sA.convRate > sB.convRate) bA.push('⚔️ Miglior conversione'); else if(sB.convRate > sA.convRate) bB.push('⚔️ Miglior conversione');
    if(!bA.length && !bB.length) return '';
    const chips = (arr, col) => arr.map(b=>`<span class="comp-badge" style="border-color:${col};color:${col}">${b}</span>`).join('');
    return `<div class="comp-badge-row">
      <div class="comp-badges-side comp-badges-a">${chips(bA,'#FF6B00')}</div>
      <div class="comp-badges-mid"></div>
      <div class="comp-badges-side comp-badges-b">${chips(bB,'#10B981')}</div>
    </div>`;
  };

  // ── PROFILO DI RENDIMENTO (metriche derivate + distanza) ──────
  const buildProfileSection = (sA, sB, nA, nB, aRes, bRes) => {
    // Segmentazione per distanza gara
    const byDist = res => ({
      short: res.filter(r=>(parseFloat(r.km)||0)<80),
      mid:   res.filter(r=>(parseFloat(r.km)||0)>=80&&(parseFloat(r.km)||0)<130),
      long:  res.filter(r=>(parseFloat(r.km)||0)>=130),
    });
    const dA=byDist(aRes), dB=byDist(bRes);
    const distRow = (label, arrA, arrB) => {
      if(!arrA.length&&!arrB.length) return '';
      const ptsA=arrA.reduce((s,r)=>s+(r.punti_effettivi||0),0);
      const ptsB=arrB.reduce((s,r)=>s+(r.punti_effettivi||0),0);
      const wA=arrA.filter(r=>r.posizione===1).length;
      const wB=arrB.filter(r=>r.posizione===1).length;
      const winA=ptsA>ptsB, winB=ptsB>ptsA;
      return `<tr>
        <td style="text-align:right;padding:7px 12px 7px 0;font-size:0.82rem;font-weight:${winA?700:400};color:${winA?'#FF6B00':'var(--text-secondary)'}">
          ${ptsA} pt${wA?` · <strong style="font-size:.7rem">${wA}V</strong>`:''}
        </td>
        <td class="comp-dist-lbl">${label}</td>
        <td style="text-align:left;padding:7px 0 7px 12px;font-size:0.82rem;font-weight:${winB?700:400};color:${winB?'#10B981':'var(--text-secondary)'}">
          ${ptsB} pt${wB?` · <strong style="font-size:.7rem">${wB}V</strong>`:''}
        </td>
      </tr>`;
    };
    const hasDist = dA.short.length||dA.mid.length||dA.long.length||dB.short.length||dB.mid.length||dB.long.length;
    return `<div class="comp-section">
      <div class="comp-section-title">Profilo di Rendimento</div>
      <div class="comp-stats-grid">
        ${mBar(sA.convRate,    sB.convRate,    'VITTORIE SUI RISULTATI', '%')}
        ${mBar(sA.podioRate,   sB.podioRate,   'PODI SUI RISULTATI',     '%')}
        ${mBar(sA.consistRate, sB.consistRate, 'REGOLARITÀ TOP-10',      '%')}
      </div>
      <div class="comp-trend-row">
        <div style="text-align:right">
          <div class="comp-trend-val" style="color:${sA.trend.color}">${sA.trend.label}</div>
          <div class="comp-trend-lbl">ultimi 6 risultati</div>
        </div>
        <div class="comp-trend-mid">TREND</div>
        <div>
          <div class="comp-trend-val" style="color:${sB.trend.color}">${sB.trend.label}</div>
          <div class="comp-trend-lbl">ultimi 6 risultati</div>
        </div>
      </div>
      ${hasDist ? `<table class="comp-dist-table">
        <thead><tr>
          <th style="text-align:right">${esc(nA.split(' ')[0])}</th>
          <th class="comp-dist-lbl">DISTANZA</th>
          <th style="text-align:left">${esc(nB.split(' ')[0])}</th>
        </tr></thead>
        <tbody>
          ${distRow('CORTA < 80 km',   dA.short, dB.short)}
          ${distRow('MEDIA 80–130 km', dA.mid,   dB.mid)}
          ${distRow('LUNGA > 130 km',  dA.long,  dB.long)}
        </tbody>
      </table>` : ''}
    </div>`;
  };

  // ── ULTIMI RISULTATI (tabella reale, niente testo generato) ────
  const buildRecentResults = (res, name, color) => {
    const sorted = [...res].sort((a,b)=>(b.data||'').localeCompare(a.data||'')).slice(0,10);
    if (!sorted.length) return `<div style="color:var(--text-muted);padding:12px 0;font-size:0.82rem">Nessun risultato</div>`;
    return `<div class="comp-recent-table">
      <div class="comp-recent-name" style="color:${color};font-weight:700;font-size:0.75rem;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px">${esc(name)}</div>
      <table class="results-table" style="font-size:0.8rem;width:100%">
        <thead><tr><th>DATA</th><th>GARA</th><th style="text-align:center">POS</th><th style="text-align:right">PT</th></tr></thead>
        <tbody>${sorted.map(r=>`<tr>
          <td class="td-date" style="white-space:nowrap">${fmtDateShort(r.data)}</td>
          <td class="td-race" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            <a href="#/gara/${esc(r.gara_id)}">${esc(r.nome_gara)}</a>
          </td>
          <td class="td-pos ${posClass(r.posizione)}" style="text-align:center;font-weight:700">${r.posizione}°</td>
          <td style="text-align:right;color:var(--text-muted);font-size:0.75rem">${r.punti_effettivi||0}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
  };

  // ── ATHLETE BLOCK ─────────────────────────────────────────────
  const buildAthleteResult = () => {
    const validIds = new Set(
      resultsRaw.filter(r => r.genere===compGender && (!compCat||getRankingFileCode(r)===compCat)).map(r=>r.atleta_id)
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
      {l:'TOP 5',                  vA:sA.top5,               vB:sB.top5,               nA:sA.top5,            nB:sB.top5},
      {l:'TOP 10',                 vA:sA.top10,              vB:sB.top10,              nA:sA.top10,           nB:sB.top10},
      {l:'PUNTI / PIAZZAMENTO',    vA:sA.ptsPerResult+' pt', vB:sB.ptsPerResult+' pt', nA:sA.ptsPerResult,    nB:sB.ptsPerResult},
      {l:'POSIZIONE MEDIA',        vA:sA.avgPos+'°',         vB:sB.avgPos+'°',         nA:10-(+sA.avgPos||10), nB:10-(+sB.avgPos||10)},
      {l:'FORMA RECENTE (5 ris.)', vA:sA.recent5pts+' pt',  vB:sB.recent5pts+' pt',  nA:sA.recent5pts,      nB:sB.recent5pts},
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
          <div class="comp-hero-tri">
            <div class="comp-hero-tri-item">
              <div class="comp-hero-tri-val" style="color:#FF6B00">${sA.wins}</div>
              <div class="comp-hero-tri-lbl">VITT.</div>
            </div>
            <div class="comp-hero-tri-item">
              <div class="comp-hero-tri-val">${sA.podi}</div>
              <div class="comp-hero-tri-lbl">PODI</div>
            </div>
            <div class="comp-hero-tri-item">
              <div class="comp-hero-tri-val">${sA.pts}</div>
              <div class="comp-hero-tri-lbl">PT</div>
            </div>
          </div>
          <div class="comp-hero-form">${formPills(sA.recent8)}</div>
          <div class="comp-hero-trend" style="color:${sA.trend.color}">${sA.trend.label}</div>
        </div>
        <div class="comp-hero-center"><div class="comp-vs-text">VS</div></div>
        <div class="comp-hero-side comp-hero-b">
          <div class="comp-hero-avatar comp-hero-avatar-b">${iB}</div>
          <div class="comp-hero-name">${esc(nB)}</div>
          <div class="comp-hero-meta">${esc(bD.team_attuale||'—')} · ${esc(bD.categoria||'—')}</div>
          <div class="comp-hero-tri">
            <div class="comp-hero-tri-item">
              <div class="comp-hero-tri-val" style="color:#10B981">${sB.wins}</div>
              <div class="comp-hero-tri-lbl">VITT.</div>
            </div>
            <div class="comp-hero-tri-item">
              <div class="comp-hero-tri-val">${sB.podi}</div>
              <div class="comp-hero-tri-lbl">PODI</div>
            </div>
            <div class="comp-hero-tri-item">
              <div class="comp-hero-tri-val">${sB.pts}</div>
              <div class="comp-hero-tri-lbl">PT</div>
            </div>
          </div>
          <div class="comp-hero-form">${formPills(sB.recent8)}</div>
          <div class="comp-hero-trend" style="color:${sB.trend.color}">${sB.trend.label}</div>
        </div>
      </div>

      ${buildScoreboard(sA, sB, nA, nB)}
      ${buildBadges(sA, sB, nA, nB)}

      <div class="comp-section">
        <div class="comp-section-title">Statistiche Stagionali</div>
        <div class="comp-stats-grid">
          ${mBar(sA.pts,     sB.pts,     'PUNTI',              ' pt', true)}
          ${mBar(sA.wins,    sB.wins,    'VITTORIE')}
          ${mBar(sA.podi,    sB.podi,    'PODI (TOP 3)')}
          ${mBar(sA.gare,    sB.gare,    'GARE CON RISULTATO')}
          ${mBar(sA.km,      sB.km,      'KM',                 ' km')}
          ${mBar(sA.mediaKm, sB.mediaKm, 'VELOCITÀ MEDIA',     ' km/h')}
          ${sA.bestPos && sB.bestPos ? mBarInv(sA.bestPos+'°', sB.bestPos+'°', 'MIGLIOR PIAZZAMENTO') : ''}
        </div>
      </div>

      ${buildProfileSection(sA, sB, nA, nB, aRes, bRes)}

      <div class="comp-section">
        <div class="comp-section-title">Metriche di Rendimento</div>
        <div class="comp-stats-grid">${advRows}</div>
      </div>

      ${buildH2H(aRes, bRes, nA, nB)}

      <div class="comp-section">
        <div class="comp-section-title">Ultimi Risultati</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
          <div>${buildRecentResults(aRes, nA, '#FF6B00')}</div>
          <div>${buildRecentResults(bRes, nB, '#10B981')}</div>
        </div>
      </div>`;
  };

  // ── TEAM BLOCK ────────────────────────────────────────────────
  const buildTeamResult = () => {
    const teamMap = {};
    resultsRaw.filter(r=>r.genere===compGender&&(!compCat||getRankingFileCode(r)===compCat))
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
      const sorted = [...arr].sort((a,b)=>(b.data||'').localeCompare(a.data||''));
      const wins  = arr.filter(r=>r.posizione===1).length;
      const podi  = arr.filter(r=>r.posizione<=3).length;
      const top5  = arr.filter(r=>r.posizione<=5).length;
      const top10 = arr.filter(r=>r.posizione<=10).length;
      const gare  = new Set(arr.map(r=>r.gara_id)).size;
      const piazzamenti = arr.length;
      const pts   = arr.reduce((s,r)=>s+(r.punti_effettivi||0),0);
      const km    = Math.round(arr.reduce((s,r)=>s+(parseFloat(r.km)||0),0));
      const atleti = new Set(arr.map(r=>r.atleta_id)).size;
      const ptsPerResult = piazzamenti?+(pts/piazzamenti).toFixed(1):0;
      const avgPos = piazzamenti?(arr.reduce((s,r)=>s+r.posizione,0)/piazzamenti).toFixed(1):'—';
      const recent5pts = sorted.slice(0,5).reduce((s,r)=>s+(r.punti_effettivi||0),0);
      const convRate    = piazzamenti ? Math.round(wins/piazzamenti*100) : 0;
      const podioRate   = piazzamenti ? Math.round(podi/piazzamenti*100) : 0;
      const consistRate = piazzamenti ? Math.round(top10/piazzamenti*100) : 0;
      const t3=sorted.slice(0,3), t3p=sorted.slice(3,6);
      const avgT3=t3.length?t3.reduce((s,r)=>s+r.posizione,0)/t3.length:null;
      const avgT3p=t3p.length?t3p.reduce((s,r)=>s+r.posizione,0)/t3p.length:null;
      let trend;
      if(avgT3===null)     trend={label:'—',color:'var(--text-muted)'};
      else if(!avgT3p)     trend={label:'→ Stabile',color:'#F59E0B'};
      else {
        const delta=avgT3p-avgT3;
        trend=delta>2?{label:'↑ In crescita',color:'#10B981'}:delta<-2?{label:'↓ In calo',color:'#EF4444'}:{label:'→ Stabile',color:'#F59E0B'};
      }
      return {pts,wins,podi,top5,top10,gare,piazzamenti,km,atleti,ptsPerResult,avgPos,
              recent5pts,convRate,podioRate,consistRate,trend};
    };
    const sA=stT(aRes), sB=stT(bRes);
    const iA=nA.split(/\s+/).map(w=>w[0]||'').join('').toUpperCase().slice(0,3);
    const iB=nB.split(/\s+/).map(w=>w[0]||'').join('').toUpperCase().slice(0,3);

    const advRows = [
      {l:'TOP 5',                  vA:sA.top5,               vB:sB.top5,               nA:sA.top5,            nB:sB.top5},
      {l:'TOP 10',                 vA:sA.top10,              vB:sB.top10,              nA:sA.top10,           nB:sB.top10},
      {l:'PUNTI / PIAZZAMENTO',    vA:sA.ptsPerResult+' pt', vB:sB.ptsPerResult+' pt', nA:sA.ptsPerResult,    nB:sB.ptsPerResult},
      {l:'POSIZIONE MEDIA',        vA:sA.avgPos+'°',         vB:sB.avgPos+'°',         nA:10-(+sA.avgPos||10), nB:10-(+sB.avgPos||10)},
      {l:'FORMA RECENTE (5 ris.)', vA:sA.recent5pts+' pt',  vB:sB.recent5pts+' pt',  nA:sA.recent5pts,      nB:sB.recent5pts},
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
          <div class="comp-hero-avatar comp-hero-avatar-a" style="border-radius:10px;font-size:1.1rem">${iA}</div>
          <div class="comp-hero-name">${esc(nA)}</div>
          <div class="comp-hero-meta">${sA.atleti} corridori schierati</div>
          <div class="comp-hero-tri">
            <div class="comp-hero-tri-item">
              <div class="comp-hero-tri-val" style="color:#FF6B00">${sA.wins}</div>
              <div class="comp-hero-tri-lbl">VITT.</div>
            </div>
            <div class="comp-hero-tri-item">
              <div class="comp-hero-tri-val">${sA.podi}</div>
              <div class="comp-hero-tri-lbl">PODI</div>
            </div>
            <div class="comp-hero-tri-item">
              <div class="comp-hero-tri-val">${sA.pts}</div>
              <div class="comp-hero-tri-lbl">PT</div>
            </div>
          </div>
          <div class="comp-hero-trend" style="color:${sA.trend.color}">${sA.trend.label}</div>
        </div>
        <div class="comp-hero-center"><div class="comp-vs-text">VS</div></div>
        <div class="comp-hero-side comp-hero-b">
          <div class="comp-hero-avatar comp-hero-avatar-b" style="border-radius:10px;font-size:1.1rem">${iB}</div>
          <div class="comp-hero-name">${esc(nB)}</div>
          <div class="comp-hero-meta">${sB.atleti} corridori schierati</div>
          <div class="comp-hero-tri">
            <div class="comp-hero-tri-item">
              <div class="comp-hero-tri-val" style="color:#10B981">${sB.wins}</div>
              <div class="comp-hero-tri-lbl">VITT.</div>
            </div>
            <div class="comp-hero-tri-item">
              <div class="comp-hero-tri-val">${sB.podi}</div>
              <div class="comp-hero-tri-lbl">PODI</div>
            </div>
            <div class="comp-hero-tri-item">
              <div class="comp-hero-tri-val">${sB.pts}</div>
              <div class="comp-hero-tri-lbl">PT</div>
            </div>
          </div>
          <div class="comp-hero-trend" style="color:${sB.trend.color}">${sB.trend.label}</div>
        </div>
      </div>

      ${buildScoreboard(sA, sB, nA, nB)}
      ${buildBadges(sA, sB, nA, nB)}

      <div class="comp-section">
        <div class="comp-section-title">Statistiche Team</div>
        <div class="comp-stats-grid">
          ${mBar(sA.pts,    sB.pts,    'PUNTI',              ' pt', true)}
          ${mBar(sA.wins,   sB.wins,   'VITTORIE')}
          ${mBar(sA.podi,   sB.podi,   'PODI (TOP 3)')}
          ${mBar(sA.gare,   sB.gare,   'GARE CON RISULTATO')}
          ${mBar(sA.km,     sB.km,     'KM',                 ' km')}
          ${mBar(sA.atleti, sB.atleti, 'CORRIDORI SCHIERATI')}
        </div>
      </div>

      <div class="comp-section">
        <div class="comp-section-title">Profilo di Rendimento</div>
        <div class="comp-stats-grid">
          ${mBar(sA.convRate,    sB.convRate,    'VITTORIE SUI RISULTATI', '%')}
          ${mBar(sA.podioRate,   sB.podioRate,   'PODI SUI RISULTATI',     '%')}
          ${mBar(sA.consistRate, sB.consistRate, 'REGOLARITÀ TOP-10',      '%')}
        </div>
        <div class="comp-trend-row">
          <div style="text-align:right">
            <div class="comp-trend-val" style="color:${sA.trend.color}">${sA.trend.label}</div>
            <div class="comp-trend-lbl">ultimi 6 risultati</div>
          </div>
          <div class="comp-trend-mid">TREND</div>
          <div>
            <div class="comp-trend-val" style="color:${sB.trend.color}">${sB.trend.label}</div>
            <div class="comp-trend-lbl">ultimi 6 risultati</div>
          </div>
        </div>
      </div>

      <div class="comp-section">
        <div class="comp-section-title">Metriche di Rendimento</div>
        <div class="comp-stats-grid">${advRows}</div>
      </div>

      <div class="comp-section">
        <div class="comp-section-title">Ultimi Risultati</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
          <div>${buildRecentResults(aRes, nA, '#FF6B00')}</div>
          <div>${buildRecentResults(bRes, nB, '#10B981')}</div>
        </div>
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
    const [d1, d2, d3] = await Promise.all([
      fetch(`${API_BASE}/race-photos`).then(r => r.json()).catch(() => ({ photos: [] })),
      fetch(`${API_BASE}/xpix-photos`).then(r => r.json()).catch(() => ({ photos: [] })),
      fetch(`${API_BASE}/ic-photos`).then(r => r.json()).catch(() => ({ photos: [] })),
    ]);
    _risPhotosMap = {};
    // Priorità: italiaciclismo < xpix < uploaded
    (d3.photos || []).forEach(p => { if (p.gara_id && !_risPhotosMap[p.gara_id]) _risPhotosMap[p.gara_id] = p; });
    (d2.photos || []).forEach(p => { if (p.gara_id && !_risPhotosMap[p.gara_id]) _risPhotosMap[p.gara_id] = p; });
    (d1.photos || []).forEach(p => { if (p.gara_id) _risPhotosMap[p.gara_id] = p; });
  } catch { _risPhotosMap = {}; }
  return _risPhotosMap;
}

async function renderRisultati() {
  if (!globalData) return;
  const { resultsRaw, calendar } = globalData;
  const photosMap = await loadRisPhotos();

  // Raggruppa per gara_id — ogni categoria ha il proprio card separato.
  // Eccezione: Esordienti 1°/2° anno (ES1/ES2) corrono insieme → stesso card.
  const eventMap = {};
  for (const r of resultsRaw) {
    // Normalizza ES1 e ES2 alla stessa chiave (gareggiano insieme)
    const eventKey = (r.gara_id || '').replace(/_ES[12]_([MF])$/, '_ES_$1')
                     || (r.nome_gara.trim().toUpperCase() + '|' + r.data + '|' + (r.genere||'M'));
    // For ES1/ES2: canonical id always uses ES1 so the race page link is consistent
    const canonicalGaraId = (r.gara_id || '').replace(/_ES[12]_([MF])$/, '_ES1_$1') || r.gara_id;
    if (!eventMap[eventKey]) {
      eventMap[eventKey] = {
        id: canonicalGaraId,
        nome: r.nome_gara,
        data: r.data,
        genere: r.genere,
        tipo: r.tipo,
        regione: r.regione,
        byCategory: {}
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
        ? ytId(featuredVideo.url)
        : null;

      const catSections = categories.map(([catName, catData]) => {
        const sortedCatRes = (catData.results || []).sort((a,b) => a.posizione - b.posizione);
        const top3 = sortedCatRes.slice(0,3);
        const catGaraId = catData.gara_id;
        const cLabel = catLabel(catName) || catName;

        const firstRes = catData.results?.[0];
        const kmVal    = firstRes?.km    || '';
        const mediaVal = firstRes?.media || '';
        const techBit  = [
          kmVal    ? esc(kmVal) + ' km'    : '',
          mediaVal ? esc(mediaVal) + ' km/h' : ''
        ].filter(Boolean).join(' · ');

        const podioRows = top3.map((r,i) => {
          const pClass = ['p1','p2','p3'][i] || 'pout';
          // rank_dopo_gara è calcolato in loadAll() per ogni risultato
          const rkPos = r.rank_dopo_gara;
          const rkHtml = rkPos ? '<span class="ris-rank-pos">' + rkPos + '° class.</span>' : '';
          return '<div class="hero-podio-row ris-podio-row" style="animation-delay:' + (i*60) + 'ms">' +
            '<div class="hero-pos ' + pClass + '">' + r.posizione + '&#176;</div>' +
            '<div class="ris-podio-info">' +
              '<div class="hero-name"><a href="#/atleta/' + esc(r.atleta_id) + '">' + esc(r.cognome) + ' ' + esc(r.nome) + '</a>' + rkHtml + '</div>' +
              '<div class="hero-team"><a href="#/team/' + esc(r.team_id) + '" style="color:var(--text-secondary)">' + esc(r.team) + '</a></div>' +
            '</div>' +
          '</div>';
        }).join('');

        // Race impact
        const impact = siRaceImpact(sortedCatRes, resultsRaw);
        const impactStrip = impact ? (() => {
          const parts = [];
          if (impact.insight) parts.push(`<span class="ris-insight-chip">${impact.insight}</span>`);
          if (impact.topGainer) parts.push(`<span class="ris-mover ris-mover-up">+${impact.topGainer.gain} ${esc(impact.topGainer.cognome)}</span>`);
          if (impact.topFaller) parts.push(`<span class="ris-mover ris-mover-down">${impact.topFaller.gain} ${esc(impact.topFaller.cognome)}</span>`);
          if (impact.hasShakeup && !impact.topGainer && !impact.topFaller) parts.push(`<span class="ris-insight-chip ris-chip-shakeup">Scossone in classifica</span>`);
          return parts.length ? `<div class="ris-impact-strip">${parts.join('')}</div>` : '';
        })() : '';

        return `
          <div class="ris-cat-section">
            ${categories.length > 1 ? `<div class="ris-cat-label">${cLabel}</div>` : ''}
            ${techBit ? `<div class="ris-tech-bit">${techBit}</div>` : ''}
            ${podioRows}
            ${impactStrip}
            <div class="ris-full-link">
              <a href="#/gara/${esc(catGaraId)}" class="btn-action full" style="font-size:0.75rem;text-align:center;">CLASSIFICA COMPLETA &rarr;</a>
            </div>
          </div>`;
      }).join(categories.length > 1 ? '<div class="ris-cat-divider"></div>' : '');

      const _photoSrcRis = featuredPhoto?.url || (featuredPhoto?.filename ? `${PHOTOS_BASE}/photos/${featuredPhoto.filename}` : '');
      const photoEl = _photoSrcRis
        ? `<a href="#/gara/${esc(race.id)}" class="ris-card-photo${featuredVideoId ? ' ris-media-half' : ''}">
             <img src="${esc(_photoSrcRis)}" alt="Foto gara" loading="lazy"/>
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

      const cardTier = race.campionato_italiano ? 'ris-card-ci'
                    : race.campionato_regionale ? 'ris-card-cr'
                    : (race.mult >= 2)          ? 'ris-card-premium'
                    : '';
      const importanceBadge = race.campionato_italiano
        ? '<span class="ris-importance-badge ris-badge-ci">CAMPIONATO ITALIANO</span>'
        : race.campionato_regionale
        ? '<span class="ris-importance-badge ris-badge-cr">CAMP. REGIONALE</span>'
        : race.mult >= 2
        ? `<span class="ris-importance-badge ris-badge-mult">GARA MOLTIPLICATORE ×${race.mult}</span>`
        : '';

      const _raceNarr = siRaceNarrative(race.id, resultsRaw);

      return `
        <div class="hero-band ris-card ${cardTier}">
          ${mediaPanel}
          <div class="ris-card-body">
            ${importanceBadge}
            <div class="hero-race-name"><a href="#/gara/${esc(race.id)}">${esc(race.nome)}</a></div>
            ${_raceNarr ? `<div class="ris-race-narrative">${_raceNarr}</div>` : ''}
            <div class="hero-race-meta" style="margin-bottom:14px;">
              <span>${fmtDate(race.data)}</span>
              ${race.regione ? `<span class="ris-region-tag">${esc(race.regione)}</span>` : ''}
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
    img.src = 'assets/logo2.png';
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
      <div style="width:100%;max-width:420px">
        <div class="auth-brand">
          <div class="auth-brand-name">ITALIACRIT</div>
          <div class="auth-brand-sub">Risultati Ciclismo Italiano</div>
        </div>
        <div class="auth-card">
          <div class="auth-card-header">
            <h1 class="auth-title">Bentornato</h1>
            <p class="auth-sub">Accedi per caricare foto, video e seguire i tuoi atleti</p>
          </div>
          <div id="auth-error" class="auth-error" style="display:none"></div>
          <form id="login-form" class="auth-form" onsubmit="submitLogin(event)" style="display:flex;flex-direction:column;gap:0">
            <div class="auth-field">
              <label class="auth-label" for="login-email">Email</label>
              <div class="auth-input-wrap">
                <svg class="auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>
                <input type="email" id="login-email" class="auth-input" placeholder="tua@email.it" required autocomplete="email" />
              </div>
            </div>
            <div class="auth-field">
              <label class="auth-label" for="login-pwd">Password</label>
              <div class="auth-input-wrap">
                <svg class="auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <input type="password" id="login-pwd" class="auth-input" placeholder="••••••••" required autocomplete="current-password" />
              </div>
            </div>
            <button type="submit" class="auth-btn" id="login-submit">
              Accedi
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          </form>
          <div class="auth-divider"><span>Non hai un account?</span></div>
          <a href="#/register" class="auth-btn auth-btn-secondary">Crea il tuo account</a>
        </div>
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
      <div style="width:100%;max-width:420px">
        <div class="auth-brand">
          <div class="auth-brand-name">ITALIACRIT</div>
          <div class="auth-brand-sub">Risultati Ciclismo Italiano</div>
        </div>
        <div class="auth-card">
          <div class="auth-card-header">
            <h1 class="auth-title">Crea account</h1>
            <p class="auth-sub">Unisciti alla community del ciclismo agonistico italiano</p>
          </div>
          <div id="auth-error" class="auth-error" style="display:none"></div>
          <form id="reg-form" class="auth-form" onsubmit="submitRegister(event)" style="display:flex;flex-direction:column;gap:0">
            <div class="auth-field">
              <label class="auth-label" for="reg-name">Nome visualizzato</label>
              <div class="auth-input-wrap">
                <svg class="auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                <input type="text" id="reg-name" class="auth-input" placeholder="Es. Mario Rossi" required />
              </div>
            </div>
            <div class="auth-field">
              <label class="auth-label" for="reg-email">Email</label>
              <div class="auth-input-wrap">
                <svg class="auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>
                <input type="email" id="reg-email" class="auth-input" placeholder="tua@email.it" required autocomplete="email" />
              </div>
            </div>
            <div class="auth-field">
              <label class="auth-label" for="reg-pwd">Password</label>
              <div class="auth-input-wrap">
                <svg class="auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <input type="password" id="reg-pwd" class="auth-input" placeholder="Minimo 6 caratteri" required autocomplete="new-password" minlength="6" />
              </div>
            </div>
            <div class="auth-field">
              <label class="auth-label" for="reg-role">Ruolo</label>
              <div class="auth-input-wrap">
                <svg class="auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                <select id="reg-role" class="auth-input" style="appearance:auto;cursor:pointer">
                  <option value="appassionato">Appassionato — seguo le gare</option>
                  <option value="atleta">Atleta — voglio collegare il mio profilo</option>
                  <option value="team">Team — gestisco una squadra</option>
                  <option value="genitore">Genitore — seguo mio/a figlio/a</option>
                  <option value="parente">Parente / Tifoso — seguo un atleta</option>
                </select>
              </div>
            </div>
            <button type="submit" class="auth-btn" id="reg-submit">
              Crea il mio account
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          </form>
          <div class="auth-divider"><span>Hai già un account?</span></div>
          <a href="#/login" class="auth-btn auth-btn-secondary">Accedi</a>
        </div>
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

