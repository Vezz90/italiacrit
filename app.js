/* ============================================================
   ItaliacritResultati — app.js  v203
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
// Ricarica l'utente dal server (ruolo, nome…) e aggiorna token+localStorage.
// Serve a propagare i cambi di ruolo fatti dall'admin senza ri-login manuale.
async function refreshUser() {
  if (!authToken()) return null;
  try {
    const { user, token } = await apiCall('/auth/me');
    if (user) {
      authSave(token || authToken(), user);
      try { updateNavLoginState(); } catch {}
    }
    return user;
  } catch { return null; }
}

// ── ENTITY OVERRIDES / PHOTO ──────────────────────────────────
const _ovCache = {};
// Fallback statico (committato nel repo) per dati come i social ufficiali.
// Le modifiche da backend/admin hanno comunque la precedenza.
let _staticSocials = null;
async function _loadStaticSocials() {
  if (_staticSocials) return _staticSocials;
  try {
    _staticSocials = await fetch('data/entity_socials.json').then(r => r.ok ? r.json() : {});
  } catch { _staticSocials = {}; }
  return _staticSocials;
}
async function getEntityOverrides(type, id) {
  const key = `${type}:${id}`;
  if (_ovCache[key]) return _ovCache[key];
  const base = (await _loadStaticSocials())[key] || {};
  try {
    const { overrides } = await apiCall(`/admin/override/entity/${type}/${encodeURIComponent(id)}`);
    // Ignora i valori vuoti del backend così non cancellano il fallback statico
    const clean = {};
    for (const [k, v] of Object.entries(overrides || {})) {
      if (v !== null && v !== undefined && String(v).trim() !== '') clean[k] = v;
    }
    _ovCache[key] = { ...base, ...clean };
  } catch { _ovCache[key] = { ...base }; }
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
  const hasPhoto = !!photoUrl;
  // Icona matita se la foto esiste già (modifica), fotocamera se va caricata.
  const camIcon = hasPhoto
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
         <path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>
       </svg>`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
         <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
         <circle cx="12" cy="13" r="4"/>
       </svg>`;
  const camBtn = canUp ? `
    <button class="photo-cam-btn ${hasPhoto ? 'photo-cam-btn--edit' : ''}" title="${hasPhoto ? 'Modifica foto' : 'Carica foto'}"
      onclick="triggerPhotoUpload('${esc(entityType)}','${esc(entityId)}')">
      ${camIcon}
    </button>
    <input type="file" id="photo-file-${esc(entityId)}" accept="image/jpeg,image/png,image/webp"
      style="display:none" onchange="handlePhotoUpload(event,'${esc(entityType)}','${esc(entityId)}')">` : '';
  return `<div class="photo-area" style="width:${size}px;height:${size}px;flex-shrink:0;position:relative">
    ${imgEl}${camBtn}
  </div>`;
}

// ── SOCIAL LINKS (atleta / team) ──────────────────────────────
// Normalizza un handle o URL in un link pulito
function _normSocialUrl(kind, raw) {
  if (!raw) return '';
  let v = String(raw).trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  v = v.replace(/^@/, '');
  if (kind === 'instagram') return 'https://instagram.com/' + v.replace(/^.*instagram\.com\//i, '');
  if (kind === 'facebook')  return 'https://facebook.com/'  + v.replace(/^.*facebook\.com\//i, '');
  if (kind === 'strava')    return 'https://www.strava.com/athletes/' + v.replace(/^.*strava\.com\/athletes\//i, '');
  if (kind === 'website')   return 'https://' + v;
  return v;
}

// Costruisce la riga di icone social a partire dagli override entità
function entitySocialLinksHtml(ov, kinds) {
  if (!ov) return '';
  const want = k => !kinds || kinds.includes(k);
  const out = [];
  if (want('instagram') && ov.instagram) {
    out.push(`<a href="${esc(_normSocialUrl('instagram', ov.instagram))}" target="_blank" rel="noopener" class="media-profile-link" aria-label="Instagram"><svg class="social-icon social-icon-ig" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg> Instagram</a>`);
  }
  if (want('facebook') && ov.facebook) {
    out.push(`<a href="${esc(_normSocialUrl('facebook', ov.facebook))}" target="_blank" rel="noopener" class="media-profile-link" aria-label="Facebook"><svg class="social-icon social-icon-fb" viewBox="0 0 24 24"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg> Facebook</a>`);
  }
  if (want('strava') && ov.strava) {
    out.push(`<a href="${esc(_normSocialUrl('strava', ov.strava))}" target="_blank" rel="noopener" class="media-profile-link" aria-label="Strava"><svg class="social-icon social-icon-strava" viewBox="0 0 24 24"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg> Strava</a>`);
  }
  if (want('website') && ov.website) {
    out.push(`<a href="${esc(_normSocialUrl('website', ov.website))}" target="_blank" rel="noopener" class="media-profile-link" aria-label="Sito"><svg class="social-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> Sito</a>`);
  }
  if (!out.length) return '';
  return `<div class="media-profile-links profile-social-links">${out.join('')}</div>`;
}

// ── BANDIERE NAZIONALI ────────────────────────────────────────
// Mappa nome nazione (IT) → codice ISO a 2 lettere per generare l'emoji bandiera
const NATION_ISO = {
  'ITALIA':'IT','AUSTRIA':'AT','BELGIO':'BE','DANIMARCA':'DK','ESTONIA':'EE',
  'FINLANDIA':'FI','FRANCIA':'FR','GERMANIA':'DE','GRAN BRETAGNA':'GB','REGNO UNITO':'GB',
  'IRLANDA':'IE','LETTONIA':'LV','LITUANIA':'LT','LUSSEMBURGO':'LU','NORVEGIA':'NO',
  'OLANDA':'NL','PAESI BASSI':'NL','POLONIA':'PL','PORTOGALLO':'PT','REPUBBLICA CECA':'CZ',
  'ROMANIA':'RO','SLOVACCHIA':'SK','SLOVENIA':'SI','SPAGNA':'ES','SVEZIA':'SE',
  'SVIZZERA':'CH','UCRAINA':'UA','UNGHERIA':'HU','CROAZIA':'HR','SERBIA':'RS',
  'GRECIA':'GR','TURCHIA':'TR','SAN MARINO':'SM','STATI UNITI':'US','USA':'US',
  'COLOMBIA':'CO','AUSTRALIA':'AU','GIAPPONE':'JP','BIELORUSSIA':'BY','BULGARIA':'BG',
};
function _isoToFlag(iso) {
  return iso.toUpperCase().replace(/./g, c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65));
}
// Restituisce il codice ISO se il nome team è una nazionale, altrimenti null.
// Riconosce solo i nomi che SONO una nazione (evita falsi positivi tipo "ITALIA NUOVA BOLOGNA").
function nationIso(teamName) {
  if (!teamName) return null;
  let u = String(teamName).toUpperCase().trim();
  u = u.replace(/\s+NATIONAL\s+TEAM$/, '').replace(/^NAZIONALE\s+/, '').trim();
  if (u === 'PARALIMPICA') u = 'ITALIA'; // Nazionale Paralimpica Italiana
  return NATION_ISO[u] || null;
}
// Emoji bandiera (con spazio finale) da anteporre al nome di una nazionale, o '' se non è una nazionale.
function nationFlagPrefix(teamName) {
  const iso = nationIso(teamName);
  return iso ? _isoToFlag(iso) + ' ' : '';
}

window.triggerPhotoUpload = function(entityType, entityId) {
  document.getElementById(`photo-file-${entityId}`)?.click();
};

// Avvio: legge il file scelto e apre l'editor di ritaglio invece di caricarlo subito.
window.handlePhotoUpload = function(evt, entityType, entityId) {
  const file = evt.target.files[0];
  if (evt.target) evt.target.value = ''; // consente di riselezionare lo stesso file
  if (!file) return;
  if (!/^image\//.test(file.type)) { alert('Seleziona un file immagine (JPG, PNG o WebP).'); return; }
  const reader = new FileReader();
  reader.onload = e => _openPhotoCropper(e.target.result, entityType, entityId, file.name);
  reader.readAsDataURL(file);
};

// Editor di ritaglio: zoom (slider/rotella) + trascinamento, anteprima live su canvas.
function _openPhotoCropper(dataUrl, entityType, entityId, filename) {
  const isCircle = entityType !== 'team';
  const V = 300, OUT = 512; // viewport anteprima e dimensione esportata
  const img = new Image();
  img.onload = () => {
    const overlay = document.createElement('div');
    overlay.id = 'crop-overlay';
    overlay.className = 'crop-overlay';
    overlay.innerHTML = `
      <div class="crop-modal">
        <div class="crop-title">Ritaglia la foto</div>
        <div class="crop-stage" style="width:${V}px;height:${V}px">
          <canvas id="crop-canvas" width="${V}" height="${V}"></canvas>
          <div class="crop-frame ${isCircle ? 'crop-frame--circle' : ''}"></div>
        </div>
        <div class="crop-controls">
          <span class="crop-zoom-ico" aria-hidden="true">−</span>
          <input type="range" id="crop-zoom" min="1" max="4" step="0.01" value="1" aria-label="Zoom">
          <span class="crop-zoom-ico" aria-hidden="true">+</span>
        </div>
        <p class="crop-hint">Trascina per spostare · slider o rotella per lo zoom</p>
        <div class="crop-actions">
          <button class="auth-btn auth-btn-outline" id="crop-cancel">Annulla</button>
          <button class="auth-btn" id="crop-save">Salva foto</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const canvas = overlay.querySelector('#crop-canvas');
    const ctx = canvas.getContext('2d');
    const baseScale = Math.max(V / img.width, V / img.height); // "cover"
    let zoom = 1, scale = baseScale, ox = (V - img.width * scale) / 2, oy = (V - img.height * scale) / 2;

    function clamp() {
      const w = img.width * scale, h = img.height * scale;
      ox = Math.min(0, Math.max(V - w, ox));
      oy = Math.min(0, Math.max(V - h, oy));
    }
    function draw() {
      ctx.fillStyle = '#0c0c0c';
      ctx.fillRect(0, 0, V, V);
      ctx.drawImage(img, ox, oy, img.width * scale, img.height * scale);
    }
    function setZoom(z) {
      const prev = scale;
      zoom = z; scale = baseScale * zoom;
      ox = V / 2 - (V / 2 - ox) * (scale / prev);
      oy = V / 2 - (V / 2 - oy) * (scale / prev);
      clamp(); draw();
    }
    clamp(); draw();

    const zoomEl = overlay.querySelector('#crop-zoom');
    zoomEl.addEventListener('input', () => setZoom(parseFloat(zoomEl.value)));

    let dragging = false, lx = 0, ly = 0;
    const onMove = e => {
      if (!dragging) return;
      const p = e.touches ? e.touches[0] : e;
      ox += p.clientX - lx; oy += p.clientY - ly; lx = p.clientX; ly = p.clientY;
      clamp(); draw();
      if (e.cancelable) e.preventDefault();
    };
    const onUp = () => { dragging = false; };
    const onDown = e => { dragging = true; const p = e.touches ? e.touches[0] : e; lx = p.clientX; ly = p.clientY; };
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    const onWheel = e => {
      e.preventDefault();
      const nz = Math.min(4, Math.max(1, zoom + (e.deltaY < 0 ? 0.12 : -0.12)));
      zoomEl.value = nz; setZoom(nz);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    function close() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
      overlay.remove();
    }
    overlay.querySelector('#crop-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#crop-save').addEventListener('click', () => {
      const out = document.createElement('canvas');
      out.width = OUT; out.height = OUT;
      const octx = out.getContext('2d');
      octx.fillStyle = '#ffffff';
      octx.fillRect(0, 0, OUT, OUT);
      const r = OUT / V;
      octx.drawImage(img, ox * r, oy * r, img.width * scale * r, img.height * scale * r);
      out.toBlob(blob => {
        close();
        const name = (filename || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
        _uploadPhotoBlob(blob, entityType, entityId, name);
      }, 'image/jpeg', 0.9);
    });
  };
  img.src = dataUrl;
}

// Carica l'immagine ritagliata sul server e aggiorna subito la UI.
async function _uploadPhotoBlob(blob, entityType, entityId, filename) {
  const btn = document.querySelector(`.photo-cam-btn`);
  if (btn) { btn.style.opacity = '0.5'; btn.style.pointerEvents = 'none'; }
  const fd = new FormData();
  // I campi testo devono venire PRIMA del file per essere disponibili in multer
  fd.append('entity_type', entityType);
  fd.append('entity_id', entityId);
  fd.append('photo', blob, filename || 'photo.jpg');
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
      // Cache-busting: l'URL della foto resta lo stesso dopo la sostituzione,
      // serve un parametro per forzare il browser a scaricare la nuova immagine.
      newImg.src = `${MEDIA_BASE}${data.photo_url}?t=${Date.now()}`;
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
}

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

// Estrae un messaggio d'errore leggibile da una Response (anche se il corpo è HTML)
async function _resErr(res) {
  let msg = `HTTP ${res.status}`;
  try {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const j = await res.json();
      if (j && j.error) msg = j.error;
    } else if (res.status === 404) {
      msg = 'Endpoint non trovato sul server (404). La rotta potrebbe non essere ancora deployata su Render.';
    } else if (res.status === 405) {
      msg = 'Metodo non consentito sul server (405).';
    } else {
      msg = `Errore server (HTTP ${res.status}).`;
    }
  } catch { /* lascia il messaggio di default */ }
  return msg;
}

// Richiesta su /admin/users/:id con fallback automatico se PATCH non è gestito dal backend
async function _adminUserReq(userId, opts) {
  let res = await fetch(`${API_BASE}/admin/users/${userId}`, opts);
  // Se la rotta/metodo non esiste, prova convenzioni alternative comuni
  if (!res.ok && (res.status === 404 || res.status === 405) && opts.method === 'PATCH') {
    try { res = await fetch(`${API_BASE}/admin/users/${userId}/role`, { ...opts, method: 'POST' }); }
    catch { /* mantiene la prima response */ }
  }
  return res;
}

function updateNavLoginState() {
  const user = authUser();
  const link = document.getElementById('nav-login');
  const drawerLink = document.getElementById('drawer-login');
  const bell    = document.getElementById('notif-bell');
  const msgBell = document.getElementById('msg-bell');
  const navMsg  = document.getElementById('nav-msg');
  const drawerMsg = document.getElementById('drawer-msg');
  if (user) {
    const label = user.display_name?.split(' ')[0] || 'Profilo';
    if (link)       { link.textContent = label; link.href = '#/profilo'; link.id = 'nav-login'; }
    if (drawerLink) { drawerLink.textContent = label; drawerLink.href = '#/profilo'; }
    if (bell)    bell.style.display = 'flex';
    if (msgBell) msgBell.style.display = 'flex';
    // nav-msg (desktop) sempre nascosto: l'icona busta nel navbar gestisce i msg su desktop
    if (navMsg)  navMsg.style.display = 'none';
    if (drawerMsg) { drawerMsg.style.display = ''; }
    const drawerSectionMsg = document.getElementById('drawer-section-msg');
    if (drawerSectionMsg) drawerSectionMsg.style.display = '';
    startNotifPolling();
    startMsgPolling();
  } else {
    if (link)       { link.textContent = 'Login'; link.href = '#/login'; }
    if (drawerLink) { drawerLink.textContent = 'Login / Profilo'; drawerLink.href = '#/login'; }
    if (bell)    bell.style.display = 'none';
    if (msgBell) msgBell.style.display = 'none';
    if (navMsg)  navMsg.style.display = 'none';
    if (drawerMsg) drawerMsg.style.display = 'none';
    const drawerSectionMsg = document.getElementById('drawer-section-msg');
    if (drawerSectionMsg) drawerSectionMsg.style.display = 'none';
    stopNotifPolling();
    stopMsgPolling();
  }
}

// ── NOTIFICATION SYSTEM ────────────────────────────────────────────────────────
let _notifPollTimer = null;

function startNotifPolling() {
  if (_notifPollTimer) return; // già attivo
  refreshNotifCount(); // subito al login
  _notifPollTimer = setInterval(refreshNotifCount, 60_000); // ogni minuto
}
function stopNotifPolling() {
  if (_notifPollTimer) { clearInterval(_notifPollTimer); _notifPollTimer = null; }
  const badge = document.getElementById('notif-badge');
  if (badge) { badge.style.display = 'none'; badge.textContent = '0'; }
}

async function refreshNotifCount() {
  const token = authToken();
  if (!token) return;
  try {
    const d = await fetch(`${API_BASE}/notifications/count`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    const count = d.count || 0;
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  } catch { /* silenzioso */ }
}

window.toggleNotifPanel = function() {
  const existing = document.getElementById('notif-panel');
  if (existing) { existing.remove(); return; }
  renderNotifPanel();
  // Chiudi cliccando fuori
  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      const panel = document.getElementById('notif-panel');
      const bell  = document.getElementById('notif-bell');
      if (panel && !panel.contains(e.target) && !bell?.contains(e.target)) {
        panel.remove();
        document.removeEventListener('click', handler);
      }
    });
  }, 50);
};

async function renderNotifPanel() {
  const token = authToken();
  if (!token) return;
  const panel = document.createElement('div');
  panel.id = 'notif-panel';
  panel.className = 'notif-panel';
  panel.innerHTML = `
    <div class="notif-panel-head">
      <span>🔔 Notifiche</span>
      <button onclick="window._notifMarkAllRead()">Segna tutte come lette</button>
    </div>
    <div class="notif-list" id="notif-list"><div class="notif-empty">Caricamento…</div></div>`;
  document.body.appendChild(panel);

  try {
    // Carica e segna come lette in parallelo
    const [d] = await Promise.all([
      fetch(`${API_BASE}/notifications`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      fetch(`${API_BASE}/notifications/read-all`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } }).catch(() => {}),
    ]);
    // Azzera badge subito
    const badge = document.getElementById('notif-badge');
    if (badge) badge.style.display = 'none';

    const notifications = d.notifications || [];
    const listEl = document.getElementById('notif-list');
    if (!listEl) return;
    if (!notifications.length) {
      listEl.innerHTML = '<div class="notif-empty">Nessuna notifica</div>';
      return;
    }
    listEl.innerHTML = notifications.map(n => {
      const ago = formatTimeAgo(n.created_at);
      const cls = n.read ? 'notif-item read' : 'notif-item unread';
      return `<div class="${cls}" data-id="${n.id}">
        <div class="notif-dot"></div>
        <div class="notif-content">
          <div class="notif-title">${esc(n.title)}</div>
          ${n.body ? `<div class="notif-body">${esc(n.body)}</div>` : ''}
          <div class="notif-time">${ago}</div>
        </div>
        <button class="notif-del" onclick="window._notifDelete(${n.id},this)" title="Elimina">✕</button>
      </div>`;
    }).join('');
  } catch(e) {
    const listEl = document.getElementById('notif-list');
    if (listEl) listEl.innerHTML = `<div class="notif-empty">Errore: ${esc(e.message)}</div>`;
  }
}

window._notifMarkAllRead = async function() {
  const token = authToken();
  if (!token) return;
  await fetch(`${API_BASE}/notifications/read-all`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  document.querySelectorAll('.notif-item.unread').forEach(el => el.classList.replace('unread', 'read'));
  const badge = document.getElementById('notif-badge');
  if (badge) badge.style.display = 'none';
};

window._notifDelete = async function(id, btn) {
  const token = authToken();
  if (!token) return;
  btn.closest('.notif-item')?.remove();
  await fetch(`${API_BASE}/notifications/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  // Se non ci sono più items, mostra empty state
  const list = document.getElementById('notif-list');
  if (list && !list.querySelector('.notif-item')) {
    list.innerHTML = '<div class="notif-empty">Nessuna notifica</div>';
  }
};

function formatTimeAgo(isoStr) {
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 60)   return 'adesso';
  if (diff < 3600) return `${Math.floor(diff/60)} min fa`;
  if (diff < 86400) return `${Math.floor(diff/3600)} ore fa`;
  return `${Math.floor(diff/86400)} giorni fa`;
}

// ── MESSAGE POLLING ────────────────────────────────────────────────────────────
let _msgPollTimer = null;

function startMsgPolling() {
  if (_msgPollTimer) return;
  refreshMsgCount();
  _msgPollTimer = setInterval(refreshMsgCount, 30_000); // ogni 30s
}
function stopMsgPolling() {
  if (_msgPollTimer) { clearInterval(_msgPollTimer); _msgPollTimer = null; }
  const badge = document.getElementById('msg-badge');
  if (badge) { badge.style.display = 'none'; badge.textContent = '0'; }
  const drawerBadge = document.getElementById('drawer-msg-badge');
  if (drawerBadge) { drawerBadge.style.display = 'none'; drawerBadge.textContent = '0'; }
}

async function refreshMsgCount() {
  const token = authToken();
  if (!token) return;
  try {
    const d = await fetch(`${API_BASE}/messages/unread-count`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    const count = d.count || 0;
    // Badge icona busta desktop
    const badge = document.getElementById('msg-badge');
    if (badge) {
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }
    // Badge link Messaggi nel drawer mobile
    const drawerBadge = document.getElementById('drawer-msg-badge');
    if (drawerBadge) {
      if (count > 0) {
        drawerBadge.textContent = count > 99 ? '99+' : count;
        drawerBadge.style.display = 'inline-flex';
      } else {
        drawerBadge.style.display = 'none';
      }
    }
  } catch { /* silenzioso */ }
}

// ── INBOX & MESSAGING ─────────────────────────────────────────────────────────
async function renderInbox(activeConvId) {
  const user = authUser();
  if (!user) { window.location.hash = '#/login'; return; }

  setPage(`<div class="loading-bar"></div>`);

  // Carica conversazioni
  let conversations = [];
  try {
    const d = await apiCall('/messages/conversations');
    conversations = d.conversations || [];
  } catch(e) {
    setPage(`<div class="error-msg">Errore caricamento: ${esc(e.message)}</div>`);
    return;
  }

  // Se non c'è una convo attiva ma ce n'è una, apri la prima (solo desktop)
  if (!activeConvId && conversations.length > 0 && window.innerWidth > 700) {
    activeConvId = conversations[0].id;
  }

  const convListHtml = conversations.length
    ? conversations.map(c => {
        const initial = (c.other_display_name || '?')[0].toUpperCase();
        const unreadHtml = c.unread_count > 0
          ? `<span class="msg-conv-badge">${c.unread_count}</span>` : '';
        const isActive = String(c.id) === String(activeConvId);
        const isUnread = c.unread_count > 0;
        const cls = `msg-conv-item${isActive?' active':''}${isUnread?' unread':''}`;
        const roleIcon = { atleta: '🚴', team: '👥', media: '📷', admin: '⚙' }[c.other_role] || '👤';
        return `<div class="${cls}" onclick="window._msgOpenConv(${c.id})" data-conv-id="${c.id}">
          <div class="msg-conv-avatar">${initial}</div>
          <div class="msg-conv-info">
            <div class="msg-conv-name">
              <span>${roleIcon} ${esc(c.other_display_name || 'Utente')}</span>
              <span class="msg-conv-time">${c.last_at ? formatTimeAgo(c.last_at) : ''}</span>
            </div>
            <div class="msg-conv-preview">${esc(c.last_msg || 'Nessun messaggio')}</div>
          </div>
          ${unreadHtml}
        </div>`;
      }).join('')
    : `<div class="msg-inbox-empty">📭 Nessuna conversazione<br/><span style="font-size:.75rem">Avvia una chat dal profilo di un atleta, team o fotografo</span></div>`;

  setPage(`
    <div class="comp-section" style="padding:0;max-width:1100px;margin:20px auto">
      <div class="msg-layout" id="msg-layout">
        <div class="msg-inbox-panel">
          <div class="msg-inbox-head">
            <span>✉ Messaggi</span>
          </div>
          <div class="msg-new-search">
            <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="search" id="msg-user-search" placeholder="Cerca utente per inviare un messaggio…" autocomplete="off"
              oninput="window._msgUserSearch(this.value)" onfocus="window._msgUserSearch(this.value)" />
            <div class="msg-user-results" id="msg-user-results" style="display:none"></div>
          </div>
          <div class="msg-conv-list" id="msg-conv-list">${convListHtml}</div>
        </div>
        <div class="msg-thread-panel" id="msg-thread-panel">
          <div class="msg-thread-empty" id="msg-thread-empty">
            ${activeConvId ? '<div class="loading-bar"></div>' : '← Seleziona una conversazione'}
          </div>
        </div>
      </div>
    </div>`);

  if (activeConvId) {
    await _msgLoadThread(activeConvId);
  }

  // Ricerca utente per nuova conversazione
  let _msgSearchTimer = null;
  window._msgUserSearch = function(q) {
    clearTimeout(_msgSearchTimer);
    const box = document.getElementById('msg-user-results');
    if (!box) return;
    if (!q || q.trim().length < 2) { box.style.display = 'none'; return; }
    _msgSearchTimer = setTimeout(async () => {
      try {
        const d = await apiCall(`/users/search?q=${encodeURIComponent(q.trim())}`);
        const users = d.users || [];
        if (!users.length) { box.innerHTML = '<div style="padding:12px 14px;font-size:.8rem;color:var(--text-muted)">Nessun utente trovato</div>'; box.style.display = 'block'; return; }
        const roleIcon = { atleta:'🚴', team:'👥', media:'📷', admin:'⚙️' };
        box.innerHTML = users.map(u => `
          <div class="msg-user-result-item" onclick="window._msgStartFromSearch(${u.id},'${esc(u.display_name||'Utente')}')">
            <div class="msg-user-result-avatar">${(u.display_name||'?')[0].toUpperCase()}</div>
            <div>
              <div class="msg-user-result-name">${esc(u.display_name||'Utente')}</div>
              <div class="msg-user-result-role">${roleIcon[u.role]||'👤'} ${u.role}</div>
            </div>
          </div>`).join('');
        box.style.display = 'block';
      } catch { box.style.display = 'none'; }
    }, 280);
  };
  window._msgStartFromSearch = async function(userId, userName) {
    const box = document.getElementById('msg-user-results');
    const inp = document.getElementById('msg-user-search');
    if (box) box.style.display = 'none';
    if (inp) inp.value = '';
    await window.startConversation(userId, userName);
  };
  // Chiudi risultati se clicchi fuori
  document.addEventListener('click', function(e) {
    const box = document.getElementById('msg-user-results');
    const wrap = document.querySelector('.msg-new-search');
    if (box && wrap && !wrap.contains(e.target)) box.style.display = 'none';
  }, { capture: true });

  window._msgOpenConv = async (convId) => {
    // Aggiorna attivo nella lista
    document.querySelectorAll('.msg-conv-item').forEach(el => {
      el.classList.toggle('active', String(el.dataset.convId) === String(convId));
    });
    // Mobile: mostra thread
    document.getElementById('msg-layout')?.classList.add('thread-open');
    window.history.replaceState(null, '', `#/messaggi/${convId}`);
    await _msgLoadThread(convId);
  };
}

async function _msgLoadThread(convId) {
  const threadPanel = document.getElementById('msg-thread-panel');
  if (!threadPanel) return;
  const user = authUser();

  // Spinner
  threadPanel.innerHTML = `<div class="msg-thread-empty"><div class="loading-bar" style="width:60%"></div></div>`;

  try {
    const d = await apiCall(`/messages/conversations/${convId}`);
    const { conversation: conv, messages } = d;
    const other_user_id = conv.user_a === user.id ? conv.user_b : conv.user_a;

    // Aggrega per data
    let lastDate = '';
    const msgsHtml = messages.map(m => {
      const isSent = m.sender_id === user.id;
      const msgDate = new Date(m.created_at).toLocaleDateString('it-IT', { day:'numeric', month:'long' });
      const dateSep = msgDate !== lastDate
        ? `<div class="msg-date-sep">${msgDate}</div>`
        : '';
      lastDate = msgDate;
      const timeStr = new Date(m.created_at).toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' });
      return `${dateSep}
        <div class="msg-bubble-wrap ${isSent ? 'sent' : 'received'}">
          <div class="msg-bubble">${_msgRenderBody(m.body)}</div>
          <div class="msg-bubble-time">${timeStr}</div>
        </div>`;
    }).join('');

    // Ottieni nome dell'altro utente (già nella convo se caricata dall'inbox)
    const convItem = document.querySelector(`[data-conv-id="${convId}"]`);
    const otherName = convItem?.querySelector('.msg-conv-name span')?.textContent || 'Utente';

    threadPanel.innerHTML = `
      <div class="msg-thread-head">
        <button class="msg-back-btn" onclick="document.getElementById('msg-layout')?.classList.remove('thread-open');window.history.replaceState(null,'','#/messaggi')">←</button>
        <div class="msg-conv-avatar">${otherName.replace(/^[^ ]+ /,'')[0]?.toUpperCase() || '?'}</div>
        <div class="msg-thread-head-info">
          <span>${otherName}</span>
          <span class="msg-thread-head-sub">Attivo ora</span>
        </div>
      </div>
      <div class="msg-thread-body" id="msg-thread-body">
        ${msgsHtml || '<div style="text-align:center;color:var(--text-muted);padding:40px;font-size:.85rem">Scrivi il primo messaggio 👇</div>'}
      </div>
      <div class="msg-input-area">
        <div class="msg-attach-wrap">
          <button class="msg-attach-btn" onclick="window._msgToggleAttach(${convId})" title="Allega foto, video o link" aria-label="Allega">＋</button>
          <div class="msg-attach-menu" id="msg-attach-menu" style="display:none">
            <button onclick="window._msgAttachUrl(${convId},'foto')">🖼️ Foto (link)</button>
            <button onclick="window._msgAttachUrl(${convId},'video')">🎬 Video (link)</button>
            <button onclick="window._msgAttachUrl(${convId},'link')">🔗 Link</button>
            <button onclick="window._msgAttachFromCollection(${convId})">📸 Dalla raccolta</button>
          </div>
        </div>
        <textarea id="msg-input" placeholder="Scrivi un messaggio…" rows="1"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();window._msgSend(${convId})}"
          oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"></textarea>
        <button class="msg-send-btn" onclick="window._msgSend(${convId})" title="Invia">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>`;

    // Scroll all fondo
    const body = document.getElementById('msg-thread-body');
    if (body) body.scrollTop = body.scrollHeight;

    // Azzera badge unread per questa convo nella lista
    const convItem2 = document.querySelector(`[data-conv-id="${convId}"]`);
    if (convItem2) {
      convItem2.classList.remove('unread');
      convItem2.querySelector('.msg-conv-badge')?.remove();
    }
    // Rifresca conteggio globale
    refreshMsgCount();

  } catch(e) {
    threadPanel.innerHTML = `<div class="msg-thread-empty">Errore: ${esc(e.message)}</div>`;
  }

  // Polling auto ogni 8s per nuovi messaggi mentre la chat è aperta
  clearInterval(window._msgThreadPoll);
  window._msgThreadPoll = setInterval(async () => {
    if (!document.getElementById('msg-thread-body')) { clearInterval(window._msgThreadPoll); return; }
    try {
      const d = await apiCall(`/messages/conversations/${convId}`);
      const body = document.getElementById('msg-thread-body');
      if (!body) return;
      const { messages } = d;
      const user = authUser();
      let lastDate = '';
      const msgsHtml = messages.map(m => {
        const isSent = m.sender_id === user.id;
        const msgDate = new Date(m.created_at).toLocaleDateString('it-IT', { day:'numeric', month:'long' });
        const dateSep = msgDate !== lastDate ? `<div class="msg-date-sep">${msgDate}</div>` : '';
        lastDate = msgDate;
        const timeStr = new Date(m.created_at).toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' });
        return `${dateSep}<div class="msg-bubble-wrap ${isSent?'sent':'received'}"><div class="msg-bubble">${_msgRenderBody(m.body)}</div><div class="msg-bubble-time">${timeStr}</div></div>`;
      }).join('');
      const wasAtBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
      body.innerHTML = msgsHtml;
      if (wasAtBottom) body.scrollTop = body.scrollHeight;
      refreshMsgCount();
    } catch {}
  }, 8000);
}

// Renderizza il corpo di un messaggio rilevando URL → foto / video / link
function _msgRenderBody(body) {
  if (!body) return '';
  const urlRe = /(https?:\/\/[^\s]+)/g;
  let out = '', last = 0, m;
  while ((m = urlRe.exec(body)) !== null) {
    out += esc(body.slice(last, m.index));
    const raw = m[0];
    const clean = raw.replace(/[)\].,;!?'"]+$/, '');
    const lower = clean.toLowerCase().split('?')[0].split('#')[0];
    if (/\.(jpe?g|png|gif|webp|avif|bmp|svg)$/.test(lower)) {
      out += `<a href="${esc(clean)}" target="_blank" rel="noopener"><img class="msg-media" src="${esc(clean)}" loading="lazy" alt="foto condivisa"/></a>`;
    } else if (/\.(mp4|webm|mov|m4v|ogg)$/.test(lower)) {
      out += `<video class="msg-media" src="${esc(clean)}" controls preload="metadata"></video>`;
    } else if (/(youtube\.com\/watch|youtu\.be\/|vimeo\.com\/)/.test(lower)) {
      out += `<a class="msg-link" href="${esc(clean)}" target="_blank" rel="noopener">▶ ${esc(clean)}</a>`;
    } else {
      out += `<a class="msg-link" href="${esc(clean)}" target="_blank" rel="noopener">🔗 ${esc(clean)}</a>`;
    }
    last = m.index + raw.length;
  }
  out += esc(body.slice(last));
  return out;
}

// Invio generico (riusabile da allegati e raccolta)
window._msgSendBody = async function(convId, text) {
  const body = (text || '').trim();
  if (!body) return;
  try {
    await apiCall(`/messages/conversations/${convId}/send`, { method: 'POST', body: { body } });
    await _msgLoadThread(convId);
  } catch(e) {
    showToast('Errore invio: ' + e.message, 'error');
  }
};

window._msgSend = async function(convId) {
  const input = document.getElementById('msg-input');
  const body = input?.value.trim();
  if (!body) return;
  input.value = '';
  input.style.height = 'auto';
  try {
    await apiCall(`/messages/conversations/${convId}/send`, {
      method: 'POST',
      body: { body },
    });
    // Ricarica thread
    await _msgLoadThread(convId);
  } catch(e) {
    showToast('Errore invio: ' + e.message, 'error');
    if (input) input.value = body; // rimetti il testo
  }
};

// ── Allegati: foto / video / link / raccolta ──────────────────
window._msgToggleAttach = function() {
  const menu = document.getElementById('msg-attach-menu');
  if (menu) menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
};
window._msgAttachUrl = function(convId, kind) {
  const menu = document.getElementById('msg-attach-menu');
  if (menu) menu.style.display = 'none';
  const label = kind === 'foto' ? 'Incolla il link della foto (jpg, png, webp…)'
            : kind === 'video' ? 'Incolla il link del video (mp4, YouTube, Vimeo…)'
            : 'Incolla il link da condividere';
  const url = prompt(label, '');
  if (!url || !url.trim()) return;
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) { showToast('Inserisci un link valido (http/https)', 'error'); return; }
  const caption = prompt('Aggiungi un commento (opzionale):', '') || '';
  const body = caption.trim() ? `${caption.trim()}\n${u}` : u;
  window._msgSendBody(convId, body);
};
window._msgAttachFromCollection = function(convId) {
  const menu = document.getElementById('msg-attach-menu');
  if (menu) menu.style.display = 'none';
  const items = (typeof getMediaCollection === 'function') ? getMediaCollection() : [];
  if (!items.length) { showToast('La tua raccolta è vuota. Salva foto/video con ＋ nelle gallery.', 'info'); return; }
  window._msgPickerItems = items;
  const grid = items.map((it, i) => `
    <div class="msg-pick-item" onclick="window._msgSendCollItem(${convId}, ${i})" title="${esc(it.title || '')}">
      ${it.type === 'video'
        ? '<div class="msg-pick-vid">🎬</div>'
        : `<img src="${esc(it.url)}" loading="lazy" alt=""/>`}
      <span class="msg-pick-type">${it.type === 'video' ? '🎬' : '📷'}</span>
    </div>`).join('');
  const ov = document.createElement('div');
  ov.className = 'msg-picker-overlay';
  ov.id = 'msg-picker-overlay';
  ov.onclick = (e) => { if (e.target === ov) window._msgClosePicker(); };
  ov.innerHTML = `
    <div class="msg-picker-box">
      <div class="msg-picker-head">
        <span>📸 Condividi dalla raccolta</span>
        <button onclick="window._msgClosePicker()" aria-label="Chiudi">✕</button>
      </div>
      <div class="msg-picker-grid">${grid}</div>
    </div>`;
  document.body.appendChild(ov);
};
window._msgSendCollItem = function(convId, idx) {
  const it = (window._msgPickerItems || [])[idx];
  window._msgClosePicker();
  if (it && it.url) {
    const body = it.title ? `${it.title}\n${it.url}` : it.url;
    window._msgSendBody(convId, body);
  }
};
window._msgClosePicker = function() {
  document.getElementById('msg-picker-overlay')?.remove();
};

// Avvia conversazione da bottone su profilo esterno
window.startConversation = async function(otherUserId, otherName) {
  const user = authUser();
  if (!user) { showToast('Accedi per inviare messaggi', 'info'); window.location.hash = '#/login'; return; }
  if (otherUserId === user.id) { showToast('Non puoi scrivere a te stesso 😅', 'info'); return; }
  try {
    showToast('Apertura chat…', 'info');
    const d = await apiCall('/messages/conversations', { method: 'POST', body: { other_user_id: otherUserId } });
    window.location.hash = `#/messaggi/${d.conversation_id}`;
  } catch(e) {
    showToast('Errore: ' + e.message, 'error');
  }
};

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

  const [calendar, resultsRaw, athletes, teams, meta, raceDetails, videos, extraRoster] = await Promise.all([
    loadJson('data/calendar.json'),
    loadJson('data/results_raw.json'),
    loadJson('data/athletes.json'),
    loadJson('data/teams.json'),
    loadJson('data/meta.json'),
    loadJson('data/race_details.json'),
    videosPromise,
    loadJson('data/extra_roster.json').catch(() => ({})),
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

  // ── Merge roster manuali (data/extra_roster.json) ─────────────
  // Aggiunge atleti senza risultati (0 punti) ai team, per dare
  // continuità anche a chi non ha ancora gareggiato o non è nei dati FCI.
  // Non sovrascrive MAI chi esiste già.
  const athletesMerged = athletes ? { ...athletes } : {};
  const teamsMerged    = teams    ? { ...teams }    : {};
  for (const tid in (extraRoster || {})) {
    const entry = extraRoster[tid];
    if (!entry || !Array.isArray(entry.atleti)) continue;
    // Crea il team se non esiste
    if (!teamsMerged[tid]) {
      teamsMerged[tid] = { id: tid, nome: entry.nome || tid, atleti: [], punti_totali: 0, risultati: [] };
    }
    const teamNome = entry.nome || teamsMerged[tid].nome || tid;
    const teamAtleti = Array.isArray(teamsMerged[tid].atleti) ? [...teamsMerged[tid].atleti] : [];
    for (const p of entry.atleti) {
      if (!p || (!p.cognome && !p.nome)) continue;
      // ID atleta: preferisci quello esplicito, altrimenti genera da cognome+nome
      const aid = p.atleta_id
        ? String(p.atleta_id).toUpperCase()
        : (slug((p.cognome||'') + '_' + (p.nome||'')) || '').toUpperCase();
      if (!aid) continue;
      if (!athletesMerged[aid]) {
        athletesMerged[aid] = {
          atleta_id: aid,
          nome: p.nome || '',
          cognome: p.cognome || '',
          team_attuale: teamNome,
          team_id: tid,
          categoria: p.categoria || '',
          genere: p.genere || 'M',
          punti_totali: 0,
          risultati: [],
          roster_only: true,
        };
      }
      if (!teamAtleti.includes(aid)) teamAtleti.push(aid);
    }
    teamsMerged[tid].atleti = teamAtleti;
  }

  return {
    calendar: calendar || [],
    resultsRaw: resultsRaw || [],
    athletes: athletesMerged,
    teams: teamsMerged,
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

// ── Home navigation — va all'hub salvato o alla home ─────────────
window.goHome = function(e) {
  if (e) e.preventDefault();
  try {
    const saved = localStorage.getItem('itcContext');
    window.location.hash = (saved && HUB_CONFIG[saved]) ? '#/hub/' + saved : '#/';
  } catch { window.location.hash = '#/'; }
};

// ── Athlete view tracking (Popular Today / Trending) ──────────────
function trackAthleteView(atleta_id, cognome, nome) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const key   = 'itc_views_' + today;
    const views = JSON.parse(localStorage.getItem(key) || '{}');
    if (!views[atleta_id]) views[atleta_id] = { cognome, nome, count: 0 };
    views[atleta_id].count++;
    localStorage.setItem(key, JSON.stringify(views));
    // Pulisci chiavi vecchie (tieni solo ultimi 7gg)
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('itc_views_') && k !== key) {
        const d = k.replace('itc_views_', '');
        if (d < new Date(Date.now() - 7*86400000).toISOString().split('T')[0])
          localStorage.removeItem(k);
      }
    }
  } catch {}
}

function getPopularAthletes(limit = 10) {
  try {
    const agg = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = 'itc_views_' + d.toISOString().split('T')[0];
      const views = JSON.parse(localStorage.getItem(key) || '{}');
      for (const [id, v] of Object.entries(views)) {
        if (!agg[id]) agg[id] = { cognome: v.cognome, nome: v.nome, count: 0 };
        agg[id].count += v.count * (i === 0 ? 2 : 1); // oggi vale doppio
      }
    }
    return Object.entries(agg)
      .map(([id, v]) => ({ atleta_id: id, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  } catch { return []; }
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
    { key: 'nome',         label: 'Nome',    type: 'text' },
    { key: 'cognome',      label: 'Cognome', type: 'text' },
    { key: 'team',         label: 'Team',    type: 'text' },
    { key: 'anno_nascita', label: 'Anno di nascita (es. 2009)', type: 'text' },
    { key: 'instagram', label: 'Instagram (@handle o URL)', type: 'text' },
    { key: 'facebook',  label: 'Facebook (URL o pagina)',   type: 'text' },
    { key: 'strava',    label: 'Strava (ID o URL profilo)', type: 'text' },
    { key: 'website',   label: 'Sito web (URL)',            type: 'text' },
  ],
  team: [
    { key: 'nome',      label: 'Nome team', type: 'text' },
    { key: 'instagram', label: 'Instagram (@handle o URL)', type: 'text' },
    { key: 'facebook',  label: 'Facebook (URL o pagina)',   type: 'text' },
    { key: 'strava',    label: 'Strava (club ID o URL)',    type: 'text' },
    { key: 'website',   label: 'Sito web (URL)',            type: 'text' },
  ],
};

function adminEditBtn(entityType, entityId) {
  if (authUser()?.role !== 'admin') return '';
  return `<button class="admin-edit-btn" onclick="openAdminEdit('${esc(entityType)}','${esc(entityId)}')">✏ Modifica</button>`;
}

window.openAdminEdit = async function(entityType, entityId) {
  const fields = ADMIN_EDIT_FIELDS[entityType] || [];
  // Carica i valori esistenti: prima il fallback statico (entity_socials.json),
  // poi gli override dal backend che hanno la precedenza. Così i dati già
  // presenti (Instagram/Facebook ecc.) restano precompilati e non vengono persi.
  let current = {};
  try { current = { ...((await _loadStaticSocials())[entityType + ':' + entityId] || {}) }; } catch(_) {}
  try {
    const { overrides } = await apiCall(`/admin/override/entity/${entityType}/${encodeURIComponent(entityId)}`);
    if (overrides) current = { ...current, ...overrides };
  } catch(_) {}
  // Memorizza i valori iniziali per salvare solo ciò che cambia
  window._adminEditCurrent = { ...current };

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
    const initial = window._adminEditCurrent || {};
    for (const f of fields) {
      const el = document.getElementById('aedit-' + f.key);
      if (!el) continue;
      const val = el.value.trim();
      // Salva solo i campi effettivamente modificati: evita di sovrascrivere
      // con stringa vuota i dati già presenti che non sono stati toccati.
      if (val === String(initial[f.key] ?? '').trim()) continue;
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
  initNavDropdowns();

  // Logo click → cinematic entry
  document.getElementById('nav-logo-link')?.addEventListener('click', function(e) {
    e.preventDefault();
    window.location.hash = '#/';
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

  // Hub — barre animate (sia generale #/hub che per categoria #/hub/CODE/)
  if (hash === '#/hub' || hash === '#/hub/') return renderHubBars();
  if (hash.startsWith('#/hub/')) {
    const hubParts = hash.slice(6).split('/');
    const hubCode = hubParts[0];
    const hubSub  = hubParts[1] || '';
    if (HUB_CONFIG[hubCode]) {
      activeHub = Object.assign({}, HUB_CONFIG[hubCode]);
      activeHub._code = hubCode;
      applyHubFilters(activeHub);
      try { localStorage.setItem('itcContext', hubCode); } catch(e) {}
      // Sotto-pagine specifiche (classifica/atleti/team interne all'hub) rimangono
      if (hubSub && hubSub !== 'home') return renderHubSubpage(hubCode, hubSub);
      // Home hub → nuove barre
      return renderHubBars();
    }
  }
  // activeHub persists as global filter — cleared only by clearHubFilter()

  // Restore saved context (no gate — users land directly on homepage)
  _softRestoreContext();

  const match = (pattern) => {
    const re = new RegExp('^' + pattern.replace(/:[^/]+/g, '([^/]+)') + '$');
    return hash.replace('#', '').match(re);
  };

  if (match('/')) return renderHome();
  // Classifica con categoria+vista encode nell'URL: #/classifica/ES1_M/atleti
  const _mClassCatView = match('/classifica/:cat/:view');
  if (_mClassCatView) {
    rankCat    = decodeURIComponent(_mClassCatView[1]);
    rankGender = rankCat.endsWith('_F') ? 'F' : 'M';
    rankView   = _mClassCatView[2] || 'atleti';
    rankFilter = ''; rankRegion = ''; rankMonth = ''; rankSort = 'punti';
    return renderClassifica();
  }
  const _mClassCat = match('/classifica/:cat');
  if (_mClassCat) {
    rankCat    = decodeURIComponent(_mClassCat[1]);
    rankGender = rankCat.endsWith('_F') ? 'F' : 'M';
    rankView   = 'atleti';
    rankFilter = ''; rankRegion = ''; rankMonth = ''; rankSort = 'punti';
    return renderClassifica();
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
  const m_stats = match('/statistiche/:cat');
  if (m_stats) return renderStatistiche(decodeURIComponent(m_stats[1]));
  if (match('/statistiche')) return renderStatistiche(null);
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
  const m_media = match('/media/:id');
  if (m_media) return renderMediaProfile(m_media[1]);
  const m_msgConv = match('/messaggi/:id');
  if (m_msgConv) return renderInbox(m_msgConv[1]);
  if (match('/messaggi')) return renderInbox(null);
  const m_forma = match('/forma/:cat');
  if (m_forma) return renderForma(m_forma[1]);
  renderNotFound();
}

function updateNavActive(hash) {
  // Rimuovi active da tutti
  document.querySelectorAll('.nav-link, .nav-group-btn, .nav-group-item').forEach(el => el.classList.remove('active'));
  updateNavLoginState();

  const seg = (hash.replace(/^#\//, '').split('/')[0] || '');

  const CLASS_SEGS   = ['classifica', 'atleti', 'team', 'atleta'];
  const ANALISI_SEGS = ['statistiche', 'comparatore'];
  const ACCOUNT_SEGS = ['login', 'register', 'profilo'];

  if (seg === 'risultati' || seg === 'gara') {
    document.getElementById('nav-risultati')?.classList.add('active');
  } else if (seg === 'calendario') {
    document.getElementById('nav-cal')?.classList.add('active');
  } else if (CLASS_SEGS.includes(seg)) {
    document.getElementById('nav-class-btn')?.classList.add('active');
    document.getElementById('nav-class')?.classList.toggle('active',  seg === 'classifica');
    document.getElementById('nav-atleti')?.classList.toggle('active', seg === 'atleti');
    document.getElementById('nav-team')?.classList.toggle('active',   seg === 'team');
  } else if (ANALISI_SEGS.includes(seg)) {
    document.getElementById('nav-analisi-btn')?.classList.add('active');
    document.getElementById('nav-stats')?.classList.toggle('active', seg === 'statistiche');
    document.getElementById('nav-comp')?.classList.toggle('active',  seg === 'comparatore');
  } else if (seg === 'messaggi') {
    document.getElementById('nav-msg')?.classList.add('active');
  } else if (ACCOUNT_SEGS.includes(seg)) {
    document.getElementById('nav-login')?.classList.add('active');
  }
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
              '<div class="hub-rank-team">' + (a.team_id ? '<a href="#/team/' + encodeURIComponent(a.team_id) + '" onclick="event.stopPropagation()">' + esc(a.team_nome||a.team_attuale||a.team||'') + '</a>' : esc(a.team_nome||a.team_attuale||a.team||'')) + '</div>' +
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
    // In tutti i casi va all'hub con le barre animate.
    // I filtri di categoria sono già applicati da applyHubFilters() sopra.
    if (!hubCode) {
      try { localStorage.setItem('itcContext', 'skip'); } catch(e) {}
    }
    window.location.hash = '#/hub';
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

// ── computeHotScore — forma 0-100 ────────────────────────────────
function computeHotScore(atleta_id, resultsRaw, catCode) {
  const lastDate = resultsRaw.reduce((mx,r)=>(r.data||'')>mx?r.data:mx,'');
  const cut14 = (()=>{ const d=new Date(lastDate||new Date()); d.setDate(d.getDate()-14); return d.toISOString().split('T')[0]; })();
  const recent = resultsRaw
    .filter(r=>r.atleta_id===atleta_id && getRankingFileCode(r)===catCode && r.data>=cut14)
    .sort((a,b)=>b.data.localeCompare(a.data));
  if (!recent.length) return 0;
  const pts14 = recent.reduce((s,r)=>s+(r.punti_effettivi||0),0);
  const ptsScore = Math.min(40,(pts14/50)*40);
  const wins = recent.filter(r=>r.posizione===1).length;
  const winsScore = Math.min(20,wins*10);
  const avgPos = recent.slice(0,5).reduce((s,r)=>s+(r.posizione||99),0)/Math.min(recent.length,5);
  const trendScore = Math.max(0,30-(avgPos-1)*2);
  let streak=0;
  for(const r of recent){ if((r.punti_effettivi||0)>0) streak++; else break; }
  const streakScore = Math.min(10,streak*2);
  return Math.round(ptsScore+winsScore+trendScore+streakScore);
}

// ── getAthleteBadges — badge dinamici ─────────────────────────────
function getAthleteBadges(atleta_id, resultsRaw, catCode, rankingEntry) {
  const badges = [];
  const lastDate = resultsRaw.reduce((mx,r)=>(r.data||'')>mx?r.data:mx,'');
  const cut14 = (()=>{ const d=new Date(lastDate||new Date()); d.setDate(d.getDate()-14); return d.toISOString().split('T')[0]; })();
  const cut7  = (()=>{ const d=new Date(lastDate||new Date()); d.setDate(d.getDate()-7);  return d.toISOString().split('T')[0]; })();
  const r14 = resultsRaw.filter(r=>r.atleta_id===atleta_id&&getRankingFileCode(r)===catCode&&r.data>=cut14);
  const r7  = resultsRaw.filter(r=>r.atleta_id===atleta_id&&getRankingFileCode(r)===catCode&&r.data>=cut7);
  const wins14=r14.filter(r=>r.posizione===1).length;
  const wins7=r7.filter(r=>r.posizione===1).length;
  if (wins14>=2) badges.push({icon:'🔥',label:'ON FIRE',cls:'badge-fire'});
  else if (wins7>=1) badges.push({icon:'⚡',label:'IN FORMA',cls:'badge-hot'});
  const sorted=resultsRaw.filter(r=>r.atleta_id===atleta_id&&getRankingFileCode(r)===catCode&&r.data).sort((a,b)=>b.data.localeCompare(a.data));
  let str=0; for(const r of sorted){if((r.punti_effettivi||0)>0)str++;else break;}
  if(str>=5) badges.push({icon:'💪',label:'STREAK '+str,cls:'badge-streak'});
  else if(str>=3) badges.push({icon:'📈',label:'SERIE '+str,cls:'badge-streak'});
  if(rankingEntry && rankingEntry.pos===1) badges.push({icon:'👑',label:'LEADER',cls:'badge-leader'});
  if(rankingEntry){
    const hist=resultsRaw.filter(r=>r.atleta_id===atleta_id&&getRankingFileCode(r)===catCode&&r.rank_dopo_gara).sort((a,b)=>b.data.localeCompare(a.data));
    if(hist.length>=2){
      const gain=hist[Math.min(3,hist.length-1)].rank_dopo_gara-hist[0].rank_dopo_gara;
      if(gain>=5) badges.push({icon:'🚀',label:'↑'+gain,cls:'badge-up'});
    }
  }
  return badges.slice(0,3);
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

// ═══════════════════════════════════════════════════════════════
// RANKING NARRATIVE METRICS
// Client-side only — computed from existing resultsRaw JSON data.
// ═══════════════════════════════════════════════════════════════

// Time-decayed momentum score 0–100.
// Recent points count exponentially more (half-life 21 days).
function calcRankMomentum(athleteId, resultsRaw, refDate, catCode) {
  const HALF_LIFE = 21;
  const ref = new Date(refDate || new Date());
  const res = resultsRaw.filter(r =>
    r.atleta_id === athleteId &&
    (!catCode || getRankingFileCode(r) === catCode) &&
    r.data && (r.punti_effettivi || 0) > 0
  );
  if (!res.length) return 0;
  let wSum = 0, wTotal = 0;
  for (const r of res) {
    const days = Math.max(0, (ref - new Date(r.data)) / 86400000);
    const w = Math.pow(0.5, days / HALF_LIFE);
    wSum   += (r.punti_effettivi || 0) * w;
    wTotal += w;
  }
  const wavg = wTotal > 0 ? wSum / wTotal : 0;
  // Normalize: ~25 weighted-avg pts ≈ 100. Clamp at 100.
  return Math.min(100, Math.round(wavg / 25 * 100));
}

// Form delta: avg pts/race in last 15 days vs prior 15 days.
// Positive = in crescita, negative = in calo.
function calcFormDelta(athleteId, resultsRaw, refDate, catCode) {
  const ref  = new Date(refDate || new Date());
  const cut15 = new Date(ref); cut15.setDate(ref.getDate() - 15);
  const cut30 = new Date(ref); cut30.setDate(ref.getDate() - 30);
  const c15s  = cut15.toISOString().split('T')[0];
  const c30s  = cut30.toISOString().split('T')[0];
  const res   = resultsRaw.filter(r =>
    r.atleta_id === athleteId && (!catCode || getRankingFileCode(r) === catCode) && r.data
  );
  const recent = res.filter(r => r.data >= c15s);
  const prev   = res.filter(r => r.data >= c30s && r.data < c15s);
  const rAvg   = recent.length ? recent.reduce((s,r)=>s+(r.punti_effettivi||0),0)/recent.length : 0;
  const pAvg   = prev.length   ? prev.reduce((s,r)=>s+(r.punti_effettivi||0),0)/prev.length     : 0;
  return rAvg - pAvg;
}

// Leadership safety 0–100 (100 = completely safe, 0 = about to be overtaken).
// Based on how many races the best challenger needs to close the gap.
function calcLeadershipSafety(leaderPts, challengerPts, challengerLast4Results) {
  const gap = leaderPts - challengerPts;
  if (gap <= 0) return 0;
  const avgPts = challengerLast4Results.length
    ? challengerLast4Results.reduce((s,r)=>s+(r.punti_effettivi||0),0) / challengerLast4Results.length
    : 0;
  const racesNeeded = avgPts > 0 ? gap / avgPts : Infinity;
  // 100 if needs >10 races; 0 if gap already closed.
  return Math.min(100, Math.max(0, Math.round(Math.min(racesNeeded / 10, 1) * 100)));
}

// Pick the single most dramatic badge for an athlete.
// Returns {emoji, label, cls} or null.
function getRankBadge(entry, ranking, resultsRaw, catCode, refDate, momentum, formDelta, daysIdle) {
  const pos      = entry.pos;
  const leaderPts = ranking[0]?.punti || 1;
  const pctOfTotal = entry.punti / leaderPts;
  const trend    = entry.trend || 0;

  // 👑 DOMINANTE — leader with wide gap and high win rate
  if (pos === 1 && pctOfTotal > 0.28 && ranking[1] && entry.punti - ranking[1].punti > 25)
    return { emoji: '👑', label: 'DOMINANTE', cls: 'badge-dominant' };

  // 🔥 IN FIAMME — very high momentum
  if (momentum >= 78)
    return { emoji: '🔥', label: 'IN FIAMME', cls: 'badge-fire' };

  // ⚡ SURGE — big jump this week
  if (trend >= 5 && pos <= 30)
    return { emoji: '⚡', label: `+${trend} SURGE`, cls: 'badge-surge' };

  // 🔄 RIMONTA — entered top 5 from outside top 10
  if (pos <= 5 && trend !== null && trend !== undefined && (pos + trend) > 10)
    return { emoji: '🔄', label: 'RIMONTA', cls: 'badge-comeback' };

  // 📈 IN CRESCITA — strong positive form delta
  if (formDelta > 6)
    return { emoji: '📈', label: 'IN CRESCITA', cls: 'badge-growing' };

  // 💀 FERMO — not raced in 21+ days
  if (daysIdle > 21)
    return { emoji: '💀', label: `FERMO ${daysIdle}gg`, cls: 'badge-idle' };

  // ⚠ A RISCHIO — in top 5 but form in decline
  if (pos <= 5 && formDelta < -8)
    return { emoji: '⚠', label: 'A RISCHIO', cls: 'badge-risk' };

  // ▼ IN CALO
  if (formDelta < -5 && pos <= 15)
    return { emoji: '▼', label: 'IN CALO', cls: 'badge-down' };

  return null;
}

// ── WATCHLIST ────────────────────────────────────────────────────
function getWatchlist() {
  try { return JSON.parse(localStorage.getItem('itc_watchlist') || '[]'); } catch { return []; }
}
function isWatched(atleta_id) {
  return getWatchlist().some(w => w.id === atleta_id);
}
window.toggleWatch = function(atleta_id, cognome, nome, type) {
  let list = getWatchlist();
  const idx = list.findIndex(w => w.id === atleta_id);
  if (idx >= 0) { list.splice(idx, 1); }
  else { list.push({ id: atleta_id, cognome, nome, type: type || 'atleta', ts: Date.now() }); }
  try { localStorage.setItem('itc_watchlist', JSON.stringify(list)); } catch {}
  const added = idx < 0;
  const btn = document.getElementById('watch-btn-' + atleta_id);
  if (btn) {
    btn.classList.toggle('watch-btn--active', added);
    btn.innerHTML = added
      ? '<span>★</span> Seguito'
      : '<span>☆</span> Segui';
  }
  return added;
};
// Helper per i team: recupera il nome dal globalData (team_id è uno slug sicuro)
window.toggleWatchTeam = function(team_id) {
  const t = (globalData && globalData.teams) ? globalData.teams[team_id] : null;
  return window.toggleWatch(team_id, (t && t.nome) || team_id, '', 'team');
};

// ══════════════════════════════════════════════════════════════
//  DASHBOARD "SKILLS" — servizi personali (localStorage)
// ══════════════════════════════════════════════════════════════

/* ── Raccoglitore Foto & Video ── */
function getMediaCollection() {
  try { return JSON.parse(localStorage.getItem('itc_media_collection') || '[]'); } catch { return []; }
}
function isInCollection(uid) {
  return getMediaCollection().some(m => m.uid === uid);
}
window.toggleMediaCollect = function(uid, type, url, title, gara) {
  let list = getMediaCollection();
  const idx = list.findIndex(m => m.uid === uid);
  if (idx >= 0) { list.splice(idx, 1); }
  else { list.unshift({ uid, type, url, title: title||'', gara: gara||'', ts: Date.now() }); }
  try { localStorage.setItem('itc_media_collection', JSON.stringify(list.slice(0, 200))); } catch {}
  const added = idx < 0;
  const btn = document.getElementById('collect-btn-' + uid);
  if (btn) {
    btn.classList.toggle('collect-btn--active', added);
    btn.title = added ? 'Nella tua raccolta' : 'Salva nella raccolta';
    btn.textContent = added ? '✓' : '＋';
  }
  // Refresh dashboard collection card if open
  if (typeof window._refreshCollectionCard === 'function') window._refreshCollectionCard();
  return added;
};
window.removeFromCollection = function(uid) {
  let list = getMediaCollection().filter(m => m.uid !== uid);
  try { localStorage.setItem('itc_media_collection', JSON.stringify(list)); } catch {}
  if (typeof window._refreshCollectionCard === 'function') window._refreshCollectionCard();
};

/* ── Calendario personale (gare seguite) ── */
function getMyRaces() {
  try { return JSON.parse(localStorage.getItem('itc_my_races') || '[]'); } catch { return []; }
}
function isMyRace(garaId) {
  return getMyRaces().some(r => r.id === garaId);
}
window.toggleMyRace = function(garaId, nome, data) {
  let list = getMyRaces();
  const idx = list.findIndex(r => r.id === garaId);
  if (idx >= 0) { list.splice(idx, 1); }
  else { list.push({ id: garaId, nome: nome||'', data: data||'', ts: Date.now() }); }
  try { localStorage.setItem('itc_my_races', JSON.stringify(list)); } catch {}
  const added = idx < 0;
  const btn = document.getElementById('myrace-btn-' + garaId);
  if (btn) btn.classList.toggle('active', added);
  return added;
};

/* ── Preferenze notifiche ── */
function getNotifPrefs() {
  try {
    const stored = localStorage.getItem('itc_notif_prefs');
    // Default: tutte le notifiche attive finché l'utente non le disattiva esplicitamente
    const defaults = { risultati: true, classifica: true, gare: true, foto: true };
    return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
  } catch { return { risultati: true, classifica: true, gare: true, foto: true }; }
}
window.setNotifPref = function(key, val) {
  const p = getNotifPrefs();
  p[key] = val;
  try { localStorage.setItem('itc_notif_prefs', JSON.stringify(p)); } catch {}
};

/* ── Obiettivi atleta ── */
function getAthleteGoals() {
  try { return JSON.parse(localStorage.getItem('itc_athlete_goals') || '[]'); } catch { return []; }
}
window.addAthleteGoal = function(text) {
  if (!text || !text.trim()) return;
  const list = getAthleteGoals();
  list.push({ id: Date.now(), text: text.trim(), done: false });
  try { localStorage.setItem('itc_athlete_goals', JSON.stringify(list)); } catch {}
  if (typeof window._refreshGoalsCard === 'function') window._refreshGoalsCard();
};
window.toggleAthleteGoal = function(id) {
  const list = getAthleteGoals();
  const g = list.find(x => x.id === id);
  if (g) g.done = !g.done;
  try { localStorage.setItem('itc_athlete_goals', JSON.stringify(list)); } catch {}
  if (typeof window._refreshGoalsCard === 'function') window._refreshGoalsCard();
};
window.removeAthleteGoal = function(id) {
  const list = getAthleteGoals().filter(x => x.id !== id);
  try { localStorage.setItem('itc_athlete_goals', JSON.stringify(list)); } catch {}
  if (typeof window._refreshGoalsCard === 'function') window._refreshGoalsCard();
};

// Generate a single impactful narrative headline for the season pulse banner.
function generateNarrativeHeadline(ranking, resultsRaw, catCode, refDate) {
  if (!ranking.length) return '';
  const leader  = ranking[0];
  const second  = ranking[1];
  const third   = ranking[2];
  const gap12   = second ? leader.punti - second.punti : null;

  const ref  = new Date(refDate || new Date());
  const c15s = (() => { const d = new Date(ref); d.setDate(d.getDate()-15); return d.toISOString().split('T')[0]; })();
  const c28s = (() => { const d = new Date(ref); d.setDate(d.getDate()-28); return d.toISOString().split('T')[0]; })();

  // Challenger's recent scoring pace
  const challLast = second ? resultsRaw.filter(r =>
    r.atleta_id === second.atleta_id && getRankingFileCode(r) === catCode && r.data >= c15s
  ) : [];
  const challPts15 = challLast.reduce((s,r)=>s+(r.punti_effettivi||0),0);

  // Leader's last race date
  const leaderLastRace = resultsRaw.filter(r =>
    r.atleta_id === leader.atleta_id && getRankingFileCode(r) === catCode && r.data
  ).reduce((mx,r)=>r.data>mx?r.data:mx,'');
  const leaderIdle = leaderLastRace
    ? Math.floor((ref - new Date(leaderLastRace)) / 86400000)
    : 999;

  // Biggest mover in top 30
  const bigMover = ranking.slice(0, 30)
    .filter(r => (r.trend||0) >= 5)
    .sort((a,b)=>(b.trend||0)-(a.trend||0))[0] || null;

  // Tight top-3
  const tightTop3 = third && (leader.punti - third.punti) <= 40;

  // Scenario selection
  if (gap12 !== null && gap12 <= 10 && second)
    return `⚔ Lotta al vertice: ${leader.cognome.toUpperCase()} guida su ${second.cognome.toUpperCase()} con soli ${gap12} punti`;
  if (gap12 !== null && gap12 <= 35 && challPts15 > 15 && second)
    return `🔥 ${second.cognome.toUpperCase()} in rimonta: −${gap12}pt da ${leader.cognome.toUpperCase()}, forma stellare nelle ultime 2 settimane`;
  if (leaderIdle > 21 && second)
    return `💀 ${leader.cognome.toUpperCase()} fermo da ${leaderIdle}gg — ${second.cognome.toUpperCase()} si avvicina`;
  if (bigMover)
    return `⚡ ${bigMover.cognome.toUpperCase()} scuote la classifica: +${bigMover.trend} posizioni in una settimana`;
  if (tightTop3 && third && second)
    return `🎯 Top-3 in ${leader.punti - third.punti} punti — ${leader.cognome.toUpperCase()}, ${second.cognome.toUpperCase()}, ${third.cognome.toUpperCase()} in battaglia aperta`;
  if (gap12 !== null && gap12 > 120)
    return `👑 ${leader.cognome.toUpperCase()} domina: ${leader.punti} punti, ${gap12}pt di vantaggio sulla concorrenza`;
  return `${leader.cognome.toUpperCase()} al comando con ${leader.punti} punti — la stagione continua`;
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

// ── computeTeamRanking — classifica squadre cumulativa ad una data ───
// Restituisce array ordinato { team_id, team, punti, wins, riders, pos }
function computeTeamRanking(resSet, catCode, beforeDate) {
  const pts={}, meta={};
  for(const r of resSet) {
    if(getRankingFileCode(r)!==catCode||!r.team_id||!r.data) continue;
    if(beforeDate&&r.data>=beforeDate) continue;
    const k=r.team_id;
    pts[k]=(pts[k]||0)+(r.punti_effettivi||0);
    if(!meta[k]) meta[k]={team:r.team||k,wins:0,podi:0,riders:new Set()};
    if(r.posizione===1) meta[k].wins++;
    if(r.posizione<=3)  meta[k].podi++;
    if(r.atleta_id) meta[k].riders.add(r.atleta_id);
  }
  return Object.entries(pts).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a)
    .map(([id,punti],i)=>({team_id:id,team:meta[id]?.team||id,punti,wins:meta[id]?.wins||0,podi:meta[id]?.podi||0,riders:meta[id]?.riders.size||0,pos:i+1}));
}

// ── computeTeamHotScore — forma team 0-100 ────────────────────────────
function computeTeamHotScore(team_id, resSet, catCode) {
  const lastDate=resSet.reduce((mx,r)=>(r.data||'')>mx?r.data:mx,'');
  const cut14=(()=>{const d=new Date(lastDate||new Date());d.setDate(d.getDate()-14);return d.toISOString().split('T')[0];})();
  const recent=resSet.filter(r=>r.team_id===team_id&&getRankingFileCode(r)===catCode&&r.data>=cut14);
  if(!recent.length) return 0;
  const catTotalPts=Math.max(1,resSet.filter(r=>getRankingFileCode(r)===catCode&&r.data>=cut14).reduce((s,r)=>s+(r.punti_effettivi||0),0));
  const teamPts=recent.reduce((s,r)=>s+(r.punti_effettivi||0),0);
  const shareScore=Math.min(40,(teamPts/catTotalPts)*200);
  const winsScore=Math.min(30,recent.filter(r=>r.posizione===1).length*10);
  const riders=new Set(recent.filter(r=>(r.punti_effettivi||0)>0).map(r=>r.atleta_id)).size;
  const coverageScore=Math.min(20,riders*5);
  const podiScore=Math.min(10,recent.filter(r=>r.posizione<=3).length*2);
  return Math.round(shareScore+winsScore+coverageScore+podiScore);
}

// ── computeRankSnapshot — classifica cumulativa ad una data ──────────
// beforeDate = null → snapshot attuale; altrimenti snapshot a quella data.
function computeRankSnapshot(resSet, catCode, beforeDate) {
  const pts = {};
  for (const r of resSet) {
    if (getRankingFileCode(r) !== catCode || !r.atleta_id || !r.data) continue;
    if (beforeDate && r.data >= beforeDate) continue;
    pts[r.atleta_id] = (pts[r.atleta_id] || 0) + (r.punti_effettivi || 0);
  }
  const rankMap = {};
  Object.entries(pts).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a)
    .forEach(([id],i) => { rankMap[id] = i + 1; });
  return rankMap;
}

// ── siFormRivalryFinder — rivalità basata sulla forma recente ─────────
// Non richiede scontri diretti: trova la coppia di atleti più "narrativa"
// considerando: vicinanza in classifica, forma ultimi 30gg, scontri recenti.
function siFormRivalryFinder(resSet, catCode, ranking, lastDate) {
  if (!ranking || ranking.length < 2) return null;
  const cut30 = (()=>{const d=new Date(lastDate||new Date());d.setDate(d.getDate()-30);return d.toISOString().split('T')[0];})();

  // Statistiche recenti per atleta
  const stats = {};
  for (const r of resSet) {
    if (getRankingFileCode(r)!==catCode||!r.atleta_id||!r.data||r.data<cut30) continue;
    if (!stats[r.atleta_id]) stats[r.atleta_id]={pts:0,wins:0,podi:0,races:0};
    stats[r.atleta_id].pts  +=(r.punti_effettivi||0);
    stats[r.atleta_id].races++;
    if (r.posizione===1) stats[r.atleta_id].wins++;
    if (r.posizione<=3)  stats[r.atleta_id].podi++;
  }

  // Scontri diretti recenti (bonus)
  const meetMap = {};
  const byRace = {};
  for (const r of resSet) {
    if (getRankingFileCode(r)!==catCode||!r.gara_id||!r.data||r.data<cut30) continue;
    if (!byRace[r.gara_id]) byRace[r.gara_id]=[];
    byRace[r.gara_id].push(r);
  }
  for (const raceRes of Object.values(byRace)) {
    const top = raceRes.filter(r=>r.posizione<=8).sort((a,b)=>a.posizione-b.posizione);
    for (let i=0;i<top.length-1;i++) for(let j=i+1;j<top.length&&j<=i+4;j++) {
      const key=[top[i].atleta_id,top[j].atleta_id].sort().join('|');
      if(!meetMap[key]) meetMap[key]={meets:0,wins:{}};
      meetMap[key].meets++;
      const wId=top[i].posizione<top[j].posizione?top[i].atleta_id:top[j].atleta_id;
      meetMap[key].wins[wId]=(meetMap[key].wins[wId]||0)+1;
    }
  }

  // Valuta tutte le coppie nel top-12 classificato
  const top12 = ranking.slice(0,12);
  const leaderPts = ranking[0].punti;
  let best=null, bestScore=-1;
  for (let i=0;i<top12.length-1;i++) {
    for (let j=i+1;j<top12.length;j++) {
      const a=top12[i], b=top12[j];
      const sA=stats[a.atleta_id]||{pts:0,wins:0,podi:0,races:0};
      const sB=stats[b.atleta_id]||{pts:0,wins:0,podi:0,races:0};
      if(sA.races===0&&sB.races===0) continue;
      const ptsGap=Math.abs(a.punti-b.punti);
      const tension=Math.max(0,60-ptsGap*0.8);
      const formAvg=(sA.pts+sB.pts)/2;
      const meet=meetMap[[a.atleta_id,b.atleta_id].sort().join('|')]||{meets:0,wins:{}};
      const score=tension*0.5 + formAvg*0.15 + (sA.races>0?10:0) + (sB.races>0?10:0)
                + meet.meets*4 + (sA.wins>0&&sB.wins>0?25:0) - (j-i-1)*6;
      if(score>bestScore) {
        bestScore=score;
        const aWinsVs=meet.wins[a.atleta_id]||0, bWinsVs=meet.wins[b.atleta_id]||0;
        best={
          aId:a.atleta_id, bId:b.atleta_id,
          aCog:a.cognome,  bCog:b.cognome,
          aNom:a.nome,     bNom:b.nome,
          aTeam:a.team_attuale||a.team||'', bTeam:b.team_attuale||b.team||'',
          aPts:a.punti, bPts:b.punti, ptsGap,
          aRecentPts:sA.pts, bRecentPts:sB.pts,
          aRecentWins:sA.wins, bRecentWins:sB.wins,
          aWinsVs, bWinsVs, directMeets:meet.meets,
        };
      }
    }
  }
  return best;
}

// ── buildRichNewsItems — feed editoriale con analisi completa ─────────
function buildRichNewsItems(resSet, ranking, catCode, lastDate) {
  const items = [];
  const cut30 = (()=>{const d=new Date(lastDate||new Date());d.setDate(d.getDate()-30);return d.toISOString().split('T')[0];})();
  const cut14 = (()=>{const d=new Date(lastDate||new Date());d.setDate(d.getDate()-14);return d.toISOString().split('T')[0];})();
  const cut7  = (()=>{const d=new Date(lastDate||new Date());d.setDate(d.getDate()-7); return d.toISOString().split('T')[0];})();

  // 1. Ultimi vincitori (max 2, ultimi 14gg)
  const byRace={};
  for(const r of resSet.filter(r=>r.data>=cut14&&r.posizione<=1)){
    if(!byRace[r.gara_id]) byRace[r.gara_id]={nome:r.nome_gara,data:r.data,results:[]};
    byRace[r.gara_id].results.push(r);
  }
  for(const race of Object.values(byRace).sort((a,b)=>b.data.localeCompare(a.data)).slice(0,2)){
    const w=race.results[0];
    if(w){
      const rPos=ranking.findIndex(r=>r.atleta_id===w.atleta_id);
      const ctx=rPos>=0?` (${rPos+1}° in classifica)`:'';
      items.push({icon:'🥇',text:`<strong>${esc(w.cognome)} ${esc(w.nome)}</strong> vince <em>${esc(race.nome)}</em>${ctx}`,atleta_id:w.atleta_id});
    }
  }

  // 2. Analisi gap in vetta
  if(ranking.length>=2){
    const gap=ranking[0].punti-ranking[1].punti;
    const snapOld=computeRankSnapshot(resSet,catCode,cut14);
    const leader=ranking[0];
    const wasLeader=snapOld[leader.atleta_id]===1;
    if(gap<=10){
      items.push({icon:'⚔',text:`<strong>${esc(leader.cognome)}</strong> e <strong>${esc(ranking[1].cognome)}</strong> separati da soli <strong>${gap} punti</strong> — la vetta è contesa`});
    } else if(gap<=30){
      const gainingText=wasLeader?'conserva il vantaggio':'ha recuperato terreno';
      items.push({icon:'📊',text:`<strong>${esc(leader.cognome)}</strong> guida con ${leader.punti} pt — ${esc(ranking[1].cognome)} insegue a ${gap} punti`});
    } else {
      items.push({icon:'📊',text:`<strong>${esc(leader.cognome)}</strong> in testa con ${leader.punti} pt, margine solido su ${esc(ranking[1].cognome)} (−${gap})`});
    }
  }

  // 3. Scalatore del momento (maggior guadagno posizioni ultimi 14gg)
  if(ranking.length>3){
    const snapNow=computeRankSnapshot(resSet,catCode,null);
    const snapOld=computeRankSnapshot(resSet,catCode,cut14);
    let best=null,bestGain=2;
    for(const a of ranking){
      const now=snapNow[a.atleta_id]||999, old=snapOld[a.atleta_id]||999;
      const gain=old-now;
      const recentPts=resSet.filter(r=>r.atleta_id===a.atleta_id&&r.data>=cut14).reduce((s,r)=>s+(r.punti_effettivi||0),0);
      if(gain>bestGain&&recentPts>0){bestGain=gain;best=a;}
    }
    if(best){
      const pos=ranking.indexOf(best)+1;
      items.push({icon:'🚀',text:`<strong>${esc(best.cognome)} ${esc(best.nome)}</strong> guadagna +${bestGain} posizioni in 2 settimane — ora <strong>${pos}°</strong>`,atleta_id:best.atleta_id});
    }
  }

  // 4. Streak podio
  const checked=new Set();
  let bestStreak=null,bestStreakLen=3;
  for(const a of ranking.slice(0,20)){
    if(checked.has(a.atleta_id)) continue; checked.add(a.atleta_id);
    const streak=siStreak(a.atleta_id,resSet);
    if(streak.podioStreak>=bestStreakLen){bestStreakLen=streak.podioStreak;bestStreak=a;}
  }
  if(bestStreak){
    const pos=ranking.indexOf(bestStreak)+1;
    items.push({icon:'🔥',text:`<strong>${esc(bestStreak.cognome)} ${esc(bestStreak.nome)}</strong> è sul podio da <strong>${bestStreakLen} gare consecutive</strong>${pos>0?' · '+pos+'° in classifica':''}`,atleta_id:bestStreak.atleta_id});
  }

  // 5. Squadra dominante (ultimo mese)
  const teamW={};
  for(const r of resSet.filter(r=>r.data>=cut30&&r.posizione===1&&r.team)){
    const k=r.team_id||r.team;
    if(!teamW[k]) teamW[k]={name:r.team,id:r.team_id,wins:0};
    teamW[k].wins++;
  }
  const topTeam=Object.values(teamW).sort((a,b)=>b.wins-a.wins)[0];
  if(topTeam&&topTeam.wins>=2)
    items.push({icon:'🏆',text:`<strong>${esc(topTeam.name)}</strong> — squadra più vincente dell'ultimo mese con <strong>${topTeam.wins} vittorie</strong>`,team_id:topTeam.id});

  // 6. Corridore sottovalutato (alto Hot Score, fuori top-5)
  if(ranking.length>5){
    let sleeper=null,sleeperScore=55;
    for(const a of ranking.slice(5,20)){
      const s=computeHotScore(a.atleta_id,resSet,catCode);
      if(s>sleeperScore){sleeperScore=s;sleeper=a;}
    }
    if(sleeper){
      const pos=ranking.indexOf(sleeper)+1;
      items.push({icon:'💡',text:`<strong>${esc(sleeper.cognome)} ${esc(sleeper.nome)}</strong> è il corridore più in forma fuori dalla top-5 — ${pos}°, forma score <strong>${sleeperScore}/100</strong>`,atleta_id:sleeper.atleta_id});
    }
  }

  // 7. Prossimo sorpasso (chi ha il momentum per salire)
  if(ranking.length>=3){
    const snapNow=computeRankSnapshot(resSet,catCode,null);
    const snapOld=computeRankSnapshot(resSet,catCode,cut30);
    for(const a of ranking.slice(1,8)){
      const nowPos=snapNow[a.atleta_id]||999, oldPos=snapOld[a.atleta_id]||999;
      if(nowPos<oldPos&&a.atleta_id!==ranking[0].atleta_id){
        const target=ranking[ranking.indexOf(a)-1];
        if(target){
          const gapTarget=target.punti-a.punti;
          const recentPts=resSet.filter(r=>r.atleta_id===a.atleta_id&&r.data>=cut14).reduce((s,r)=>s+(r.punti_effettivi||0),0);
          if(gapTarget>0&&gapTarget<40&&recentPts>0){
            items.push({icon:'⚡',text:`<strong>${esc(a.cognome)} ${esc(a.nome)}</strong> è in ascesa: solo <strong>${gapTarget} punti</strong> da <strong>${esc(target.cognome)}</strong>`,atleta_id:a.atleta_id});
            break;
          }
        }
      }
    }
  }

  return items.slice(0,7);
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

// ── Team ranking narrative ─────────────────────────────────────
function generateTeamNarrativeHeadline(teamRanking, resultsRaw, catCode) {
  if (!teamRanking.length) return '';
  const leader = teamRanking[0];
  const second = teamRanking[1];
  const third  = teamRanking[2];
  const gap12  = second ? leader.punti - second.punti : null;

  // 2nd team's recent scoring pace (last 15 days)
  const c15s = (() => { const d = new Date(); d.setDate(d.getDate() - 15); return d.toISOString().split('T')[0]; })();
  const challPts15 = second ? resultsRaw.filter(r =>
    r.team_id === second.team_id && getRankingFileCode(r) === catCode && (r.data || '') >= c15s
  ).reduce((s, r) => s + (r.punti_effettivi || 0), 0) : 0;

  // Biggest positive mover (from trend computed in updateRankTable)
  const bigMover  = teamRanking.slice(0, 20).filter(t => (t.trend || 0) >= 3)
    .sort((a, b) => (b.trend || 0) - (a.trend || 0))[0] || null;
  const bigFaller = teamRanking.slice(0, 15).filter(t => (t.trend || 0) <= -3)
    .sort((a, b) => (a.trend || 0) - (b.trend || 0))[0] || null;

  const tightTop3 = third && (leader.punti - third.punti) <= 30;

  if (gap12 !== null && gap12 <= 10 && second)
    return `⚔ Lotta al vertice: ${esc(leader.team_nome)} guida su ${esc(second.team_nome)} con soli ${gap12} punti`;
  if (gap12 !== null && gap12 <= 40 && challPts15 > 12 && second)
    return `🔥 ${esc(second.team_nome)} in rimonta: a soli −${gap12} pt da ${esc(leader.team_nome)}`;
  if (bigFaller && bigFaller.trend <= -4)
    return `📉 ${esc(bigFaller.team_nome)} crolla di ${Math.abs(bigFaller.trend)} posizioni — la classifica cambia faccia`;
  if (bigMover && bigMover.trend >= 4)
    return `⚡ ${esc(bigMover.team_nome)} vola: +${bigMover.trend} posizioni nell'ultima tornata`;
  if (tightTop3 && third && second)
    return `🎯 Top-3 in ${leader.punti - third.punti} pt — ${esc(leader.team_nome)}, ${esc(second.team_nome)}, ${esc(third.team_nome)} in battaglia aperta`;
  if (gap12 !== null && gap12 > 100)
    return `👑 ${esc(leader.team_nome)} domina: ${leader.punti} pt, +${gap12} sulla concorrenza`;
  return `${esc(leader.team_nome)} al comando con ${leader.punti} pt — la stagione entra nel vivo`;
}

function buildTeamWeeklyNarrative(teamRanking, resultsRaw, catCode) {
  const lines = [];
  if (teamRanking.length < 2) return lines;

  const l1 = teamRanking[0], l2 = teamRanking[1], l3 = teamRanking[2];
  const gap12 = l1.punti - l2.punti;
  const gap13 = l3 ? l1.punti - l3.punti : null;

  // 1. Leadership situation
  if (gap12 === 0)
    lines.push(`Parità assoluta in vetta: ${esc(l1.team_nome)} e ${esc(l2.team_nome)} divisi da zero punti`);
  else if (gap12 <= 10)
    lines.push(`Lotta apertissima: ${esc(l1.team_nome)} (${l1.punti} pt) guida di soli ${gap12} pt su ${esc(l2.team_nome)}`);
  else if (gap12 <= 35)
    lines.push(`${esc(l1.team_nome)} al vertice (${l1.punti} pt), ${esc(l2.team_nome)} a −${gap12} pt in seconda posizione`);
  else
    lines.push(`${esc(l1.team_nome)} in fuga con ${l1.punti} pt — +${gap12} su ${esc(l2.team_nome)} (2°)`);
  if (l3 && gap13 !== null && gap13 <= 40)
    lines.push(`Top-3 in ${gap13} pt: ${esc(l3.team_nome)} (3°, ${l3.punti} pt) ancora pienamente in corsa`);

  // 2. Weekly movers (from trend field)
  const risers  = teamRanking.slice(0, 20).filter(t => (t.trend || 0) >= 2)
    .sort((a, b) => (b.trend || 0) - (a.trend || 0)).slice(0, 3);
  const fallers = teamRanking.slice(0, 15).filter(t => (t.trend || 0) <= -2)
    .sort((a, b) => (a.trend || 0) - (b.trend || 0)).slice(0, 2);
  for (const t of risers) {
    const n = t.trend === 1 ? 'una posizione' : `${t.trend} posizioni`;
    lines.push(`↑ ${esc(t.team_nome)} guadagna ${n} e sale ${t.pos}°`);
  }
  for (const t of fallers) {
    const n = Math.abs(t.trend) === 1 ? 'una posizione' : `${Math.abs(t.trend)} posizioni`;
    lines.push(`↓ ${esc(t.team_nome)} perde ${n} e scende al ${t.pos}°`);
  }

  // 3. Micro-gap alert: teams separated by ≤5 pt (outside top-2, already shown)
  for (let i = 1; i < Math.min(teamRanking.length - 1, 10); i++) {
    const ta = teamRanking[i], tb = teamRanking[i + 1];
    const g = ta.punti - tb.punti;
    if (g > 0 && g <= 5) {
      lines.push(`⚠ Solo ${g} pt tra ${esc(ta.team_nome)} (${ta.pos}°) e ${esc(tb.team_nome)} (${tb.pos}°)`);
      break;
    }
  }

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

// ── HOME — Cinematic entry (M/F + categoria) ──────────────────────
function renderHome() {
  showCinematicEntry(false);
}

// ── HUB DASHBOARD — Landing page con dati, classifiche e rivalità ─
async function renderHubBars() {
  const hub = activeHub || null;
  // No hub = general nav bars fallback
  if (!hub || !hub._code) return _renderNavBars();
  if (!globalData) { setPage('<div class="loading-bar"></div>'); return; }

  const hubCode   = hub._code;
  const hubColor  = hub.color || '#FF6B00';
  const catCodes  = hub.catCodes || [];
  const { resultsRaw, calendar } = globalData;

  // ── Load photos ──────────────────────────────────────────────────
  let allPhotos = [];
  try {
    const [d1,d2] = await Promise.all([
      fetch(`${API_BASE}/race-photos`).then(r=>r.json()).catch(()=>({photos:[]})),
      fetch(`${API_BASE}/xpix-photos`).then(r=>r.json()).catch(()=>({photos:[]})),
    ]);
    const rawP=[];
    (d1.photos||[]).forEach(p=>{ if(p.filename) rawP.push({url:`${PHOTOS_BASE}/photos/${p.filename}`,gara_id:p.gara_id||''}); });
    (d2.photos||[]).forEach(p=>{ if(p.url) rawP.push({url:p.url,gara_id:p.gara_id||''}); });
    const catP=catCodes.length?rawP.filter(p=>catCodes.some(c=>p.gara_id.includes(c))):rawP;
    allPhotos=catP.length>=3?catP:rawP;
    for(let i=allPhotos.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[allPhotos[i],allPhotos[j]]=[allPhotos[j],allPhotos[i]];}
  } catch {}
  const pickPh = i => allPhotos[i%allPhotos.length]?.url||null;

  // ── Ranking + race data ──────────────────────────────────────────
  const es1Code       = hub.catCodes.find(c=>c.startsWith('ES1'));
  const mainCat       = hub.mainCat;
  const isEsordienti  = !!es1Code;
  // Full ranking per i movers (tutto il campo); top10 per la rank card
  const _hubRankFull   = await loadRanking(mainCat);
  const _hubRankES1Full= es1Code ? await loadRanking(es1Code) : null;
  const hubRanking    = _hubRankFull.slice(0, 3);
  const hubRankingES1 = _hubRankES1Full ? _hubRankES1Full.slice(0, 3) : null;
  const hubRes    = resultsRaw.filter(r=>r.genere===hub.gender&&hub.catCodes.includes(getRankingFileCode(r)));
  const hubResES2 = isEsordienti?hubRes.filter(r=>getRankingFileCode(r)===mainCat):hubRes;
  const hubResES1 = isEsordienti?hubRes.filter(r=>getRankingFileCode(r)===es1Code):[];
  const lastDate  = hubRes.reduce((mx,r)=>(r.data||'')>mx?r.data:mx,'');
  const todayStr  = new Date().toISOString().split('T')[0];
  const cut14     = (()=>{const d=new Date(lastDate||new Date());d.setDate(d.getDate()-14);return d.toISOString().split('T')[0];})();
  const cut7      = (()=>{const d=new Date(lastDate||new Date());d.setDate(d.getDate()-7); return d.toISOString().split('T')[0];})();

  // ── Rider on fire ────────────────────────────────────────────────
  function computeFireForSet(resSet) {
    const fm={};
    resSet.filter(r=>r.data>=cut14).forEach(r=>{
      if(!fm[r.atleta_id]) fm[r.atleta_id]={atleta_id:r.atleta_id,cognome:r.cognome,nome:r.nome,team:r.team,wins:0,podi:0,pts:0,code:getRankingFileCode(r)};
      if(r.posizione===1) fm[r.atleta_id].wins++;
      if(r.posizione<=3)  fm[r.atleta_id].podi++;
      fm[r.atleta_id].pts+=(r.punti_effettivi||0);
    });
    return Object.values(fm).sort((a,b)=>b.wins-a.wins||b.podi-a.podi||b.pts-a.pts)[0]||null;
  }
  const fireAth    = computeFireForSet(hubResES2);
  const fireAthES1 = isEsordienti?computeFireForSet(hubResES1):null;

  // ── Movers — basati su snapshot di classifica reali ──────────────
  // Confronto: classifica attuale vs classifica PRIMA dell'ultima gara
  const lastDateES2 = hubResES2.reduce((mx,r)=>(r.data||'')>mx?r.data:mx,'') || lastDate;
  const lastDateES1 = hubResES1.reduce((mx,r)=>(r.data||'')>mx?r.data:mx,'') || lastDate;
  const _snapNow          = computeRankSnapshot(hubResES2, mainCat, null);
  const _snapBeforeLast   = computeRankSnapshot(hubResES2, mainCat, lastDateES2);
  const _snapNowE1        = es1Code?computeRankSnapshot(hubResES1,es1Code,null):{};
  const _snapBeforeLastE1 = es1Code?computeRankSnapshot(hubResES1,es1Code,lastDateES1):{};
  // ── Movers: usa snapshot before-last (= logica identica alla classifica page) ──
  function computeMovers(ranking, snapNow, snapBefore, posLimit = 30) {
    const list = ranking.map(a => {
      const now = snapNow[a.atleta_id], old = snapBefore[a.atleta_id];
      if (!now || !old) return null;
      const gain = old - now; // positivo = salito, negativo = sceso
      return { atleta_id:a.atleta_id, cognome:a.cognome, nome:a.nome,
               team:a.team_attuale||a.team||'', pos:now, gain, pts:a.punti||0 };
    }).filter(Boolean);
    return {
      // UP: arrivati/rimasti dentro top posLimit
      up: list.filter(m => m.gain >= 1 && m.pos <= posLimit).sort((a,b) => b.gain - a.gain).slice(0, 5),
      // DOWN: erano dentro top posLimit e sono scesi
      dn: list.filter(m => m.gain <= -1 && (m.pos - m.gain) <= posLimit).sort((a,b) => a.gain - b.gain).slice(0, 5),
    };
  }
  // Usa il ranking COMPLETO per i movers (non limitato a top10)
  const movers    = computeMovers(_hubRankFull,    _snapNow,   _snapBeforeLast);
  const moversES1 = isEsordienti && _hubRankES1Full
    ? computeMovers(_hubRankES1Full, _snapNowE1, _snapBeforeLastE1)
    : { up: [], dn: [] };

  // Pre-carica foto atleta on fire:
  // 1° priorità: foto profilo da entity override
  // 2° fallback: prima foto di vittoria disponibile tra le race photos
  const _allPhotosMap = {};
  allPhotos.forEach(p => { if (p.gara_id && !_allPhotosMap[p.gara_id]) _allPhotosMap[p.gara_id] = p.url; });

  function pickAthPhoto(athObj, resSet) {
    // Prova override prima
    // (restituisce promise — chiamato sempre con await)
    return getEntityOverrides('atleta', athObj.atleta_id)
      .then(ov => {
        if (ov.photo_url) return `${MEDIA_BASE}${ov.photo_url}`;
        // Fallback: cerca una gara vinta con foto disponibile
        const wins = [...resSet]
          .filter(r => r.atleta_id === athObj.atleta_id && r.posizione === 1)
          .sort((a, b) => (b.data || '').localeCompare(a.data || ''));
        for (const w of wins) {
          if (_allPhotosMap[w.gara_id]) return _allPhotosMap[w.gara_id];
          // Prova anche con match parziale (tronca suffisso _CAT_G)
          const base = w.gara_id.replace(/_[A-Z0-9]+_[MF]$/, '');
          const key = Object.keys(_allPhotosMap).find(k => k.startsWith(base));
          if (key) return _allPhotosMap[key];
        }
        return null;
      })
      .catch(() => null);
  }

  let fireAthPhoto    = null;
  let fireAthES1Photo = null;
  if (fireAth)    fireAthPhoto    = await pickAthPhoto(fireAth,    hubResES2);
  if (fireAthES1) fireAthES1Photo = await pickAthPhoto(fireAthES1, hubResES1);

  // ── Team ranking & movers ─────────────────────────────────────────
  const _teamRankFull       = computeTeamRanking(hubResES2, mainCat, null);
  const _teamRankNow        = _teamRankFull.slice(0, 3);
  const _teamRank14         = computeTeamRanking(hubResES2, mainCat, cut14);
  const _teamRankBeforeLast = computeTeamRanking(hubResES2, mainCat, lastDateES2);
  // Snapshot maps: team_id → posizione (full ranking for movers coverage)
  const _teamSnapNow        = Object.fromEntries(_teamRankFull.map(t=>[t.team_id,t.pos]));
  const _teamSnap14         = Object.fromEntries(_teamRank14.map(t=>[t.team_id,t.pos]));
  const _teamSnapBeforeLast = Object.fromEntries(_teamRankBeforeLast.map(t=>[t.team_id,t.pos]));
  // Team of the moment — team con hot score più alto negli ultimi 14gg
  let _teamOfMoment = null;
  {
    let bestScore = -1;
    for (const t of _teamRankNow) {
      const s = computeTeamHotScore(t.team_id, hubResES2, mainCat);
      if (s > bestScore) { bestScore = s; _teamOfMoment = { ...t, score: s }; }
    }
  }
  let _teamOfMomentPhoto = null;
  if (_teamOfMoment) {
    try { const ov=await getEntityOverrides('team',_teamOfMoment.team_id); if(ov.photo_url) _teamOfMomentPhoto=`${MEDIA_BASE}${ov.photo_url}`; } catch {}
  }

  // ── ES1 team data (solo per hub esordienti) ───────────────────────
  let _teamRankFullES1 = [], _teamRankNowES1 = [];
  let _teamSnapNowES1 = {}, _teamSnap14ES1 = {}, _teamSnapBeforeLastES1 = {};
  let _teamOfMomentES1 = null, _teamOfMomentES1Photo = null;
  if (isEsordienti && es1Code) {
    _teamRankFullES1             = computeTeamRanking(hubResES1, es1Code, null);
    _teamRankNowES1              = _teamRankFullES1.slice(0, 3);
    const _teamRank14ES1tmp      = computeTeamRanking(hubResES1, es1Code, cut14);
    const _teamRankBLES1tmp      = computeTeamRanking(hubResES1, es1Code, lastDateES1);
    _teamSnapNowES1              = Object.fromEntries(_teamRankFullES1.map(t=>[t.team_id,t.pos]));
    _teamSnap14ES1               = Object.fromEntries(_teamRank14ES1tmp.map(t=>[t.team_id,t.pos]));
    _teamSnapBeforeLastES1       = Object.fromEntries(_teamRankBLES1tmp.map(t=>[t.team_id,t.pos]));
    let bestScoreES1 = -1;
    for (const t of _teamRankNowES1) {
      const s = computeTeamHotScore(t.team_id, hubResES1, es1Code);
      if (s > bestScoreES1) { bestScoreES1 = s; _teamOfMomentES1 = { ...t, score: s }; }
    }
    if (_teamOfMomentES1) {
      try { const ov=await getEntityOverrides('team',_teamOfMomentES1.team_id); if(ov.photo_url) _teamOfMomentES1Photo=`${MEDIA_BASE}${ov.photo_url}`; } catch {}
    }
  }

  // ── Championship bar ─────────────────────────────────────────────
  function champBar(ranking, label) {
    if(!ranking.length) return '';
    const l=ranking[0], gap12=ranking.length>1?l.punti-ranking[1].punti:0;
    const tension=gap12===0?'PARITÀ IN VETTA':gap12<=10?'LOTTA ACCESA':gap12<=30?'MARGINE RISICATO':'LEADER IN FUGA';
    return `<div class="itc-champ-bar" style="--hub-color:${hubColor}">
      ${label?`<span class="itc-champ-label">${label}</span><span class="itc-champ-sep">|</span>`:''}
      <span class="itc-champ-tension">${tension}</span>
      <span class="itc-champ-sep">·</span>
      <span class="itc-champ-leader">${esc(l.cognome)}</span>
      <span class="itc-champ-pts">${l.punti} pt</span>
      ${ranking[1]?`<span class="itc-champ-sep">|</span><span class="itc-champ-gap">${esc(ranking[1].cognome)} <em>−${gap12}</em></span>`:''}
      ${ranking[2]?`<span class="itc-champ-sep">|</span><span class="itc-champ-gap">${esc(ranking[2].cognome)} <em>−${l.punti-ranking[2].punti}</em></span>`:''}
      <a href="#/classifica" class="itc-champ-link">Classifica →</a>
    </div>`;
  }

  // ── Rider on fire card ───────────────────────────────────────────
  function buildFireCard(ath, catCode, ranking, photoUrl) {
    if(!ath) return '';
    const score      = computeHotScore(ath.atleta_id, resultsRaw, catCode);
    const scoreColor = score>=80?'#E11D48':score>=55?'#F59E0B':'#10B981';
    const rankEntry  = ranking.find(r=>r.atleta_id===ath.atleta_id);
    const snapN      = catCode===mainCat?_snapNow:_snapNowE1;
    const badges     = getAthleteBadges(ath.atleta_id, resultsRaw, catCode, rankEntry);
    const rankPos    = rankEntry?ranking.indexOf(rankEntry)+1:null;
    const gap        = rankEntry&&ranking[0]?ranking[0].punti-rankEntry.punti:null;
    const rankCtx    = rankPos===1
      ? `<div class="itc-fire-rank-ctx itc-fire-rank-leader">👑 LEADER IN CLASSIFICA · ${rankEntry.punti} PT</div>`
      : rankPos
        ? `<div class="itc-fire-rank-ctx">${rankPos}° in classifica${gap?' · −'+gap+' dal leader':''}</div>`
        : '';
    const badgesHtml = badges.length
      ? `<div class="itc-badges">${badges.map(b=>`<span class="itc-badge itc-${b.cls}">${b.icon} ${b.label}</span>`).join('')}</div>`
      : '';
    // Sfondo: foto atleta portrait (face top-center) oppure watermark cognome
    let bgHtml;
    if (photoUrl) {
      bgHtml = `<div class="itc-fire-bg itc-fire-bg--portrait" style="background-image:url('${photoUrl}')"></div>`;
    } else {
      bgHtml = `<div class="itc-fire-bg itc-fire-bg--neutral">
        <div class="itc-fire-watermark">${esc(ath.cognome.toUpperCase())}</div>
      </div>`;
    }
    return `<div class="itc-fire" style="--hub-color:${hubColor}">
      ${bgHtml}
      <div class="itc-fire-overlay"></div>
      <div class="itc-fire-content">
        <div class="itc-fire-eyebrow">🔥 RIDER OF THE MOMENT · ${esc(catLabel(catCode))}</div>
        ${rankCtx}
        <h2 class="itc-fire-name">${esc(ath.cognome)}<br><span class="itc-fire-firstname">${esc(ath.nome)}</span></h2>
        <div class="itc-fire-team">${esc(ath.team||'')}</div>
        ${badgesHtml}
        <div class="itc-fire-stats">
          <div class="itc-fire-stat"><span class="itc-fire-val">${ath.pts}</span><span class="itc-fire-lbl">punti 14gg</span></div>
          <div class="itc-fire-stat"><span class="itc-fire-val">${ath.wins}</span><span class="itc-fire-lbl">vittorie</span></div>
          <div class="itc-fire-stat"><span class="itc-fire-val">${ath.podi}</span><span class="itc-fire-lbl">podi</span></div>
          <div class="itc-fire-stat itc-fire-score"><span class="itc-fire-val" style="color:${scoreColor}">${score}</span><span class="itc-fire-lbl">hot score</span></div>
        </div>
        <div class="itc-hot-wrap">
          <div class="itc-hot-label">FORMA</div>
          <div class="itc-hot-track"><div class="itc-hot-fill" style="width:${score}%;background:${scoreColor}"></div></div>
          <div class="itc-hot-val" style="color:${scoreColor}">${score}<span style="opacity:.5;font-size:.55rem">/100</span></div>
        </div>
        <div class="itc-fire-ctas">
          <a href="#/atleta/${encodeURIComponent(ath.atleta_id)}" class="itc-fire-cta-primary">Scheda atleta →</a>
          <button class="itc-fire-cta-sec" onclick="event.preventDefault();window.location.hash='#/comparatore'">⚖ Confronta</button>
        </div>
      </div>
    </div>`;
  }

  // ── Team lookup da resultsRaw (fallback se team_nome mancante nel JSON classifica) ──
  const _hubTeamLookup = {};
  resultsRaw.forEach(r => {
    if (!r.atleta_id || !r.team) return;
    const cur = _hubTeamLookup[r.atleta_id];
    if (!cur || (r.data || '') > cur.date) {
      _hubTeamLookup[r.atleta_id] = { team: r.team, team_id: r.team_id || '', date: r.data || '' };
    }
  });

  // ── Rank card con trend snapshot-based ───────────────────────────
  function buildRankCard(ranking, catCode, title, snapNow, snapBefore) {
    if(!ranking.length) return '';
    const leaderPts=ranking[0].punti;
    const rows=ranking.map((a,i)=>{
      // Trend: confronto posizione PRIMA dell'ultima gara vs ora
      let trendHtml='';
      const posNow=snapNow?snapNow[a.atleta_id]:null;
      const posOld=snapBefore?snapBefore[a.atleta_id]:null;
      if(posNow&&posOld){
        const gain=posOld-posNow;
        if(gain>=1)      trendHtml=`<span class="itc-rank-trend up">▲${gain}</span>`;
        else if(gain<=-1)trendHtml=`<span class="itc-rank-trend dn">▼${Math.abs(gain)}</span>`;
      }
      // Team: JSON field con fallback a resultsRaw
      const _tlu = _hubTeamLookup[a.atleta_id] || {};
      const teamName = a.team_nome || a.team_attuale || a.team || _tlu.team || '';
      const teamId   = a.team_id || _tlu.team_id || '';
      const teamHtml = teamName
        ? (teamId ? `<a href="#/team/${encodeURIComponent(teamId)}" onclick="event.stopPropagation()">${esc(teamName)}</a>` : esc(teamName))
        : '';
      const gap=i===0?'':`<span class="itc-rank-gap">−${leaderPts-a.punti}</span>`;
      return `<div class="itc-rank-row${i===0?' itc-rank-row--leader':''}" onclick="location.hash='#/atleta/${encodeURIComponent(a.atleta_id)}'">
        <span class="itc-rank-pos itc-rank-pos-${i<3?i+1:'x'}">${i+1}</span>
        <div class="itc-rank-info">
          <div class="itc-rank-name">${esc(a.cognome)} ${esc(a.nome)}${trendHtml}</div>
          ${teamHtml ? `<div class="itc-rank-sub">${teamHtml}</div>` : ''}
        </div>
        ${gap}
        <span class="itc-rank-pts">${a.punti}<small>pt</small></span>
      </div>`;
    }).join('');
    return `<div class="itc-card itc-rank-card">
      <div class="itc-card-hdr"><span class="itc-card-title">TOP CLASSIFICA${title?' · '+title:''}</span><a href="#/classifica/${catCode}/atleti" class="itc-card-more">Vedi tutto →</a></div>
      ${rows}
    </div>`;
  }

  // ── Weekly Digest ─────────────────────────────────────────────
  function buildWeeklyDigestCard() {
    const cut7 = (()=>{ const d=new Date(lastDate||new Date()); d.setDate(d.getDate()-7); return d.toISOString().split('T')[0]; })();
    const recent = hubRes.filter(r=>r.data>=cut7&&r.posizione);
    if (!recent.length) return '';
    const races = new Set(recent.map(r=>r.gara_id)).size;
    const items = [];
    // Vittorie
    const wins = recent.filter(r=>r.posizione===1);
    wins.slice(0,2).forEach(w=>{ items.push(`🏆 <strong>${esc(w.cognome)}</strong> vince — ${esc(w.nome_gara||'')}`); });
    // Top mover
    const catRes = hubRes.filter(r=>r.posizione&&(r.punti_effettivi||0)>0);
    const snapNow2 = computeRankSnapshot(catRes, mainCat, null);
    const snapBef2 = computeRankSnapshot(catRes, mainCat, lastDate);
    let topMover=null, topGain=0;
    for(const [aid,posNow] of Object.entries(snapNow2)){
      const posBef=snapBef2[aid]; if(!posBef) continue;
      const gain=posBef-posNow;
      if(gain>topGain&&posNow<=20){topGain=gain;topMover={aid,posNow};}
    }
    if(topMover&&topGain>=2){
      const r0=recent.find(r=>r.atleta_id===topMover.aid);
      if(r0) items.push(`📈 <strong>${esc(r0.cognome)}</strong> sale ${topGain} posizioni (${topMover.posNow}°)`);
    }
    // Gap leader
    if(hubRanking.length>=2){
      const gap=hubRanking[0].punti-hubRanking[1].punti;
      if(gap<25) items.push(`⚔ Solo ${gap} pt tra <strong>${esc(hubRanking[0].cognome)}</strong> e <strong>${esc(hubRanking[1].cognome)}</strong>`);
    }
    if(!items.length) return '';
    const d=new Date(lastDate||new Date());
    const s=new Date(d); s.setDate(d.getDate()-6);
    const weekLbl=`${s.getDate()}–${d.getDate()} ${d.toLocaleDateString('it-IT',{month:'short'})}`;
    return `<div class="itc-card itc-digest-card">
      <div class="itc-card-hdr"><span class="itc-card-title">📅 QUESTA SETTIMANA</span><span class="itc-digest-week">${weekLbl} · ${races} gar${races===1?'a':'e'}</span></div>
      <div class="itc-digest-list">${items.map(it=>`<div class="itc-digest-item">${it}</div>`).join('')}</div>
    </div>`;
  }

  // ── Atleta della settimana (MVP) ──────────────────────────────
  function buildMVPCard() {
    const cut7=(()=>{ const d=new Date(lastDate||new Date()); d.setDate(d.getDate()-7); return d.toISOString().split('T')[0]; })();
    const agg={};
    hubRes.filter(r=>r.data>=cut7&&r.posizione).forEach(r=>{
      const k=r.atleta_id;
      if(!agg[k]) agg[k]={atleta_id:k,cognome:r.cognome,nome:r.nome,team:r.team,wins:0,podi:0,pts:0,races:0};
      agg[k].races++; agg[k].pts+=(r.punti_effettivi||0);
      if(r.posizione===1) agg[k].wins++;
      if(r.posizione<=3) agg[k].podi++;
    });
    const sorted=Object.values(agg).sort((a,b)=>b.wins-a.wins||b.pts-a.pts);
    const mvp=sorted[0]; if(!mvp||mvp.races<1) return '';
    const rEntry=hubRanking.find(r=>r.atleta_id===mvp.atleta_id);
    const pos=rEntry?.pos;
    const streak=(()=>{
      const rs=hubRes.filter(r=>r.atleta_id===mvp.atleta_id&&r.posizione).sort((a,b)=>(b.data||'').localeCompare(a.data||''));
      let s=0; for(const r of rs){if(r.posizione===1)s++;else break;} return s;
    })();
    return `<div class="itc-card itc-mvp-card" onclick="location.hash='#/atleta/${encodeURIComponent(mvp.atleta_id)}'">
      <div class="itc-card-hdr"><span class="itc-card-title">🏆 ATLETA DELLA SETTIMANA</span></div>
      <div class="itc-mvp-body">
        <div class="itc-mvp-crown">🏆</div>
        <div class="itc-mvp-info">
          <div class="itc-mvp-name">${esc(mvp.cognome)} ${esc(mvp.nome)}</div>
          <div class="itc-mvp-team">${esc(mvp.team||'')}</div>
          <div class="itc-mvp-stats">
            ${mvp.wins>0?`<span class="itc-mvp-stat itc-mvp-stat--win">${mvp.wins} vittori${mvp.wins>1?'e':'a'}</span>`:''}
            ${mvp.podi>mvp.wins?`<span class="itc-mvp-stat itc-mvp-stat--pod">${mvp.podi} podi</span>`:''}
            <span class="itc-mvp-stat itc-mvp-stat--pts">${mvp.pts} pt</span>
            ${pos?`<span class="itc-mvp-stat">${pos}° in classifica</span>`:''}
            ${streak>=2?`<span class="itc-mvp-stat itc-mvp-stat--streak">🔥 ${streak} di fila</span>`:''}
          </div>
        </div>
      </div>
    </div>`;
  }

  // ── Il colpo di giornata (Upset) ──────────────────────────────
  function buildUpsetCard() {
    const cut14=(()=>{ const d=new Date(lastDate||new Date()); d.setDate(d.getDate()-14); return d.toISOString().split('T')[0]; })();
    let bestUpset=null, bestScore=0;
    const recentWins=hubRes.filter(r=>r.data>=cut14&&r.posizione===1);
    for(const win of recentWins){
      const wRank=hubRanking.find(r=>r.atleta_id===win.atleta_id);
      if(!wRank||wRank.pos<=5) continue;
      const gaceParticipants=hubRes.filter(r=>r.gara_id===win.gara_id&&r.posizione>1&&r.posizione<=5);
      const topBeaten=gaceParticipants
        .map(r=>({...r,rp:(hubRanking.find(rx=>rx.atleta_id===r.atleta_id)?.pos||999)}))
        .sort((a,b)=>a.rp-b.rp)[0];
      if(!topBeaten||topBeaten.rp>=wRank.pos) continue;
      const score=(wRank.pos-topBeaten.rp)*(win.punti_effettivi||10);
      if(score>bestScore){bestScore=score;bestUpset={win,wPos:wRank.pos,beaten:topBeaten,bPos:topBeaten.rp};}
    }
    if(!bestUpset) return '';
    const {win,wPos,beaten,bPos}=bestUpset;
    return `<div class="itc-card itc-upset-card" onclick="location.hash='#/gara/${encodeURIComponent(win.gara_id)}'">
      <div class="itc-card-hdr"><span class="itc-card-title">😱 IL COLPO DI GIORNATA</span></div>
      <div class="itc-upset-body">
        <div class="itc-upset-side">
          <div class="itc-upset-cls itc-upset-cls--winner">${wPos}° CL.</div>
          <div class="itc-upset-name">${esc(win.cognome)} ${esc(win.nome)}</div>
          <div class="itc-upset-role">VINCITORE</div>
        </div>
        <div class="itc-upset-vs">1°</div>
        <div class="itc-upset-side itc-upset-side--beaten">
          <div class="itc-upset-cls itc-upset-cls--beaten">${bPos}° CL.</div>
          <div class="itc-upset-name">${esc(beaten.cognome)} ${esc(beaten.nome)}</div>
          <div class="itc-upset-role">${beaten.posizione}° nella gara</div>
        </div>
      </div>
      <div class="itc-upset-race">${esc(win.nome_gara||'')} · ${fmtDateShort(win.data)}</div>
    </div>`;
  }

  // ── Talento Emergente (Rookie Spotlight) ──────────────────────
  function buildRookieCard() {
    const year=new Date().getFullYear().toString();
    const allIds=new Set(hubRes.map(r=>r.atleta_id));
    const candidates=[];
    for(const aid of allIds){
      const all=globalData.resultsRaw.filter(r=>r.atleta_id===aid);
      if(!all.length) continue;
      const firstYear=all.reduce((mn,r)=>(r.data||'')<mn?r.data:mn,'9999').slice(0,4);
      if(firstYear!==year) continue;
      const rEntry=hubRanking.find(r=>r.atleta_id===aid);
      if(!rEntry||rEntry.pos>35) continue;
      const rc=hubRes.filter(r=>r.atleta_id===aid&&r.posizione);
      if(rc.length<2) continue;
      const wins=rc.filter(r=>r.posizione===1).length;
      const podi=rc.filter(r=>r.posizione<=3).length;
      const pts=rc.reduce((s,r)=>s+(r.punti_effettivi||0),0);
      candidates.push({atleta_id:aid,cognome:rc[0].cognome,nome:rc[0].nome,team:rc[0].team,pos:rEntry.pos,wins,podi,pts,races:rc.length});
    }
    if(!candidates.length) return '';
    const rookie=candidates.sort((a,b)=>a.pos-b.pos||b.wins-a.wins)[0];
    return `<div class="itc-card itc-rookie-card" onclick="location.hash='#/atleta/${encodeURIComponent(rookie.atleta_id)}'">
      <div class="itc-card-hdr"><span class="itc-card-title">🌱 TALENTO EMERGENTE</span></div>
      <div class="itc-rookie-body">
        <div class="itc-rookie-icon">🌱</div>
        <div class="itc-rookie-info">
          <div class="itc-rookie-name">${esc(rookie.cognome)} ${esc(rookie.nome)}</div>
          <div class="itc-rookie-team">${esc(rookie.team||'')} · prima stagione</div>
          <div class="itc-rookie-pos">${rookie.pos}° in classifica</div>
          <div class="itc-rookie-stats">
            ${rookie.wins>0?`<span>${rookie.wins} vitt.</span>`:''}
            ${rookie.podi>0?`<span>${rookie.podi} podi</span>`:''}
            <span>${rookie.pts} pt in ${rookie.races} gare</span>
          </div>
        </div>
      </div>
    </div>`;
  }

  // ── I tuoi atleti (Watchlist) ─────────────────────────────────
  function buildWatchlistCard() {
    const wl=getWatchlist();
    if(!wl.length) return `<div class="itc-card itc-watchlist-card">
      <div class="itc-card-hdr"><span class="itc-card-title">⭐ I TUOI ATLETI</span></div>
      <div class="itc-watchlist-empty">
        Apri la scheda di un atleta e premi <strong>⭐ Segui</strong> per tenerlo d'occhio.
      </div>
    </div>`;
    const rows=wl.map(w=>{
      const isTeam = w.type === 'team';
      if (isTeam) {
        const tk = (globalData && globalData.teams) ? globalData.teams[w.id] : null;
        const sub = tk ? `${(tk.atleti||[]).length} atleti · ${tk.punti_totali||0} pt` : 'Team';
        return `<div class="itc-watchlist-row" onclick="location.hash='#/team/${encodeURIComponent(w.id)}'">
          <div class="itc-watchlist-info">
            <div class="itc-watchlist-name">${esc(w.cognome||w.id)} <span class="itc-wl-streak">TEAM</span></div>
            <div class="itc-watchlist-sub">${sub}</div>
          </div>
          <button class="itc-wl-remove" onclick="event.stopPropagation();window.toggleWatch('${w.id.replace(/'/g,"\\'")}','','','team');this.closest('.itc-watchlist-row').remove()" title="Rimuovi">✕</button>
        </div>`;
      }
      const re=hubRanking.find(r=>r.atleta_id===w.id);
      const pos=re?.pos, pts=re?.punti;
      const rs=hubRes.filter(r=>r.atleta_id===w.id&&r.posizione).sort((a,b)=>(b.data||'').localeCompare(a.data||''));
      let streak=0,stype='';
      for(const r of rs){if(r.posizione===1)streak++;else break;}
      if(streak>=2) stype=`🔥×${streak}`;
      else{streak=0;for(const r of rs){if(r.posizione<=3)streak++;else break;}if(streak>=2)stype=`⚡×${streak}`;}
      return `<div class="itc-watchlist-row" onclick="location.hash='#/atleta/${encodeURIComponent(w.id)}'">
        <div class="itc-watchlist-info">
          <div class="itc-watchlist-name">${esc(w.cognome)} ${esc(w.nome)}${stype?` <span class="itc-wl-streak">${stype}</span>`:''}</div>
          <div class="itc-watchlist-sub">${pos?`${pos}° · ${pts||0} pt`:'Fuori categoria'}</div>
        </div>
        <button class="itc-wl-remove" onclick="event.stopPropagation();window.toggleWatch('${w.id.replace(/'/g,"\\'")}','${(w.cognome||'').replace(/'/g,"\\'")}','${(w.nome||'').replace(/'/g,"\\'")}');this.closest('.itc-watchlist-row').remove()" title="Rimuovi">✕</button>
      </div>`;
    }).join('');
    return `<div class="itc-card itc-watchlist-card">
      <div class="itc-card-hdr"><span class="itc-card-title">⭐ I TUOI ATLETI</span></div>
      ${rows}
    </div>`;
  }

  // ── Movers card (corposo: 5 su + 5 giù) ──────────────────────────
  function buildMoversCard(mv, title) {
    if (!mv.up.length && !mv.dn.length) return '';
    const mkRow = (m, dir) => {
      const isUp = dir === 'up';
      const gainLabel = isUp ? `+${m.gain}` : `${m.gain}`;
      const prevPos   = isUp ? m.pos + m.gain : m.pos + m.gain; // pos è quella attuale; gain è old-now
      return `<div class="itc-mover itc-mover--${dir}" onclick="location.hash='#/atleta/${encodeURIComponent(m.atleta_id)}'">
        <div class="itc-mover-badge itc-mover-badge--${dir}">${gainLabel}</div>
        <div class="itc-mover-info">
          <span class="itc-mover-name">${esc(m.cognome)} <span style="font-weight:400">${esc(m.nome)}</span></span>
          <span class="itc-mover-detail">${esc(m.team||'')}</span>
        </div>
        <div class="itc-mover-pos-wrap">
          <span class="itc-mover-prev-pos">${prevPos}°</span>
          <span class="itc-mover-arrow">${isUp ? '→' : '→'}</span>
          <span class="itc-mover-now-pos" style="color:${isUp?'#10B981':'#EF4444'}">${m.pos}°</span>
        </div>
      </div>`;
    };
    const upSection = mv.up.length ? `
      <div class="itc-mover-section-lbl itc-mover-section-up">▲ IN SALITA</div>
      ${mv.up.map(m => mkRow(m, 'up')).join('')}` : '';
    const dnSection = mv.dn.length ? `
      <div class="itc-mover-section-lbl itc-mover-section-dn">▼ IN DISCESA</div>
      ${mv.dn.map(m => mkRow(m, 'dn')).join('')}` : '';
    return `<div class="itc-card itc-movers-card">
      <div class="itc-card-hdr"><span class="itc-card-title">📈 MOVERS${title ? ' · ' + title : ''}</span></div>
      ${upSection}${dnSection}
    </div>`;
  }

  // ── VS Rivalità — basata su forma recente, non solo scontri diretti ─
  function buildVsCard(resSet, rankingForVs, catCodeForVs) {
    const rv=siFormRivalryFinder(resSet, catCodeForVs, rankingForVs, lastDate);
    if(!rv) return '';
    // Barra forma recente (punti ultimi 30gg): aPct = quota di A sul totale
    const totalRecent=(rv.aRecentPts||0)+(rv.bRecentPts||0);
    const aPct=totalRecent>0?Math.round((rv.aRecentPts/totalRecent)*100):50;
    // Etichetta: se ci sono scontri diretti la menzioniamo, altrimenti solo forma
    const encounterNote=rv.directMeets>0
      ? `${rv.directMeets} scontri diretti`
      : 'nessuno scontro diretto';
    const ptsGapNote=`${rv.ptsGap} pt di distacco in classifica`;
    return `<div class="itc-card itc-vs-card">
      <div class="itc-card-hdr">
        <span class="itc-card-title">⚔ RIVALITÀ DEL MOMENTO</span>
        <span class="itc-vs-encounters">${ptsGapNote}</span>
      </div>
      <div class="itc-vs-ring">
        <div class="itc-vs-side itc-vs-a" onclick="location.hash='#/atleta/${encodeURIComponent(rv.aId)}'">
          <div class="itc-vs-wins">${rv.aRecentWins>0?rv.aRecentWins+'V':'–'}</div>
          <div class="itc-vs-name">${esc(rv.aCog)}<br><small>${esc(rv.aNom)}</small></div>
          <div class="itc-vs-team">${esc(rv.aTeam||'')}</div>
          <div class="itc-vs-recent-pts">${rv.aRecentPts} pt / 30gg</div>
        </div>
        <div class="itc-vs-center">
          <div class="itc-vs-vs">VS</div>
          <div class="itc-vs-bar-wrap">
            <div class="itc-vs-bar-a" style="width:${aPct}%;background:${hubColor}"></div>
            <div class="itc-vs-bar-b" style="width:${100-aPct}%"></div>
          </div>
          <div class="itc-vs-bar-label">FORMA</div>
        </div>
        <div class="itc-vs-side itc-vs-b" onclick="location.hash='#/atleta/${encodeURIComponent(rv.bId)}'">
          <div class="itc-vs-wins">${rv.bRecentWins>0?rv.bRecentWins+'V':'–'}</div>
          <div class="itc-vs-name">${esc(rv.bCog)}<br><small>${esc(rv.bNom)}</small></div>
          <div class="itc-vs-team">${esc(rv.bTeam||'')}</div>
          <div class="itc-vs-recent-pts">${rv.bRecentPts} pt / 30gg</div>
        </div>
      </div>
      <div class="itc-vs-note">${encounterNote}</div>
      <div class="itc-vs-footer">
        <button class="itc-vs-cta" onclick="window.openComparatoreVs('${rv.aId}','${rv.bId}','atleta')">⚖ Confronta nel Comparatore</button>
      </div>
    </div>`;
  }

  // ── Feed notizie — analisi editoriale completa ────────────────────
  function buildFeedCard(resSet, rankingForFeed, catCodeForFeed) {
    const items=buildRichNewsItems(resSet, rankingForFeed, catCodeForFeed, lastDate);
    if(!items.length) return '';
    return `<div class="itc-card itc-feed-card">
      <div class="itc-card-hdr"><span class="itc-card-title">📰 NOTIZIE & ANALISI</span><a href="#/risultati" class="itc-card-more">Tutti i risultati →</a></div>
      ${items.map(item=>{
        const click=item.atleta_id?`onclick="location.hash='#/atleta/${encodeURIComponent(item.atleta_id)}'"`:item.team_id?`onclick="location.hash='#/team/${encodeURIComponent(item.team_id)}'"`:'';
        return `<div class="itc-feed-item${click?' itc-feed-item--link':''}" ${click}>
          <span class="itc-feed-icon">${item.icon||'📌'}</span>
          <div class="itc-feed-text">${item.text}</div>
          ${(item.atleta_id||item.team_id)?'<span class="itc-feed-arrow">→</span>':''}
        </div>`;
      }).join('')}
    </div>`;
  }

  // ── Prossime gare ─────────────────────────────────────────────────
  function buildCalCard() {
    const upcoming=calendar.filter(g=>{
      if(g.genere&&g.genere!==hub.gender) return false;
      if(hub.catFilter&&!(g.categoria||'').toLowerCase().includes(hub.catFilter.toLowerCase())) return false;
      return (g.data||'')>=todayStr;
    }).sort((a,b)=>a.data.localeCompare(b.data)).slice(0,4);
    if(!upcoming.length) return '';
    const DAY=['DOM','LUN','MAR','MER','GIO','VEN','SAB'];
    const MESI=['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
    return `<div class="itc-card itc-cal-card">
      <div class="itc-card-hdr"><span class="itc-card-title">📅 PROSSIME GARE</span><a href="#/calendario" class="itc-card-more">Calendario →</a></div>
      ${upcoming.map(g=>{
        const gd=new Date(g.data+'T00:00:00');
        const days=Math.round((gd-new Date(todayStr+'T00:00:00'))/86400000);
        const dayLbl=days===0?'OGGI':days===1?'DOMANI':DAY[gd.getDay()]+' '+gd.getDate()+' '+MESI[gd.getMonth()];
        const isCR=g.campionato_regionale||g.tipo==='CR', isCI=g.campionato_italiano||g.tipo==='CI';
        return `<div class="itc-cal-row" onclick="location.hash='#/calendario/${encodeURIComponent(g.id)}'">
          <span class="itc-cal-day${days<=1?' itc-cal-day--near':''}">${dayLbl}</span>
          <div class="itc-cal-info">
            <div class="itc-cal-name">${esc(g.nome)}${isCR?' <span class="itc-cal-badge cr">CR</span>':''}${isCI?' <span class="itc-cal-badge ci">CI</span>':''}</div>
            <div class="itc-cal-loc">${esc(g.luogo||g.regione||'')}</div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  // ── Team of the Moment card ──────────────────────────────────────
  function buildTeamFireCard(team, photoUrl, teamSnapNow, teamSnap14, title) {
    if (!team) return '';
    const sNow = teamSnapNow || _teamSnapNow;
    const s14  = teamSnap14  || _teamSnap14;
    const score = team.score ?? 0;
    const scoreColor = score>=80?'#E11D48':score>=55?'#F59E0B':'#10B981';
    const posNow = sNow[team.team_id], pos14 = s14[team.team_id];
    let trendHtml = '';
    if (posNow && pos14) {
      const gain = pos14 - posNow;
      if (gain >= 1) trendHtml = ` <span class="itc-rank-trend up" style="font-size:.9rem">▲${gain}</span>`;
      else if (gain <= -1) trendHtml = ` <span class="itc-rank-trend dn" style="font-size:.9rem">▼${Math.abs(gain)}</span>`;
    }
    let bgHtml;
    if (photoUrl) {
      bgHtml = `<div class="itc-fire-bg itc-fire-bg--portrait" style="background-image:url('${photoUrl}')"></div>`;
    } else {
      bgHtml = `<div class="itc-fire-bg itc-fire-bg--neutral">
        <div class="itc-fire-watermark" style="font-size:clamp(2.5rem,10vw,8rem);word-break:break-word;padding:1rem">${esc(team.team.toUpperCase())}</div>
      </div>`;
    }
    return `<div class="itc-fire itc-team-fire" style="--hub-color:${hubColor}">
      ${bgHtml}
      <div class="itc-fire-overlay"></div>
      <div class="itc-fire-content">
        <div class="itc-fire-eyebrow">🏆 TEAM OF THE MOMENT${title?' · '+esc(title):''}</div>
        <h2 class="itc-fire-name" style="font-size:clamp(1.2rem,3vw,2rem);line-height:1.15">${esc(team.team)}${trendHtml}</h2>
        <div class="itc-fire-stats">
          <div class="itc-fire-stat"><span class="itc-fire-val">${team.punti}</span><span class="itc-fire-lbl">punti</span></div>
          <div class="itc-fire-stat"><span class="itc-fire-val">${team.wins}</span><span class="itc-fire-lbl">vittorie</span></div>
          <div class="itc-fire-stat"><span class="itc-fire-val">${team.podi}</span><span class="itc-fire-lbl">podi</span></div>
          <div class="itc-fire-stat itc-fire-score"><span class="itc-fire-val" style="color:${scoreColor}">${score}</span><span class="itc-fire-lbl">forma</span></div>
        </div>
        <div class="itc-hot-wrap">
          <div class="itc-hot-label">FORMA TEAM</div>
          <div class="itc-hot-track"><div class="itc-hot-fill" style="width:${score}%;background:${scoreColor}"></div></div>
          <div class="itc-hot-val" style="color:${scoreColor}">${score}<span style="opacity:.5;font-size:.55rem">/100</span></div>
        </div>
        <div class="itc-fire-ctas">
          <a href="#/team/${encodeURIComponent(team.team_id)}" class="itc-fire-cta-primary">Scheda team →</a>
        </div>
      </div>
    </div>`;
  }

  // ── Top Team ranking card ─────────────────────────────────────────
  function buildTeamRankCard(teamRank, snapNow, snapBefore, title, catCode) {
    if (!teamRank.length) return '';
    const sNow  = snapNow   || _teamSnapNow;
    const sBef  = snapBefore|| _teamSnapBeforeLast;
    const leaderPts = teamRank[0].punti;
    const rows = teamRank.map((t, i) => {
      // Trend: before-last vs now (come classifica page)
      const posNow = sNow[t.team_id], posOld = sBef[t.team_id];
      let trendHtml = '';
      if (posNow && posOld) {
        const gain = posOld - posNow;
        if (gain >= 1)       trendHtml = `<span class="itc-rank-trend up">▲${gain}</span>`;
        else if (gain <= -1) trendHtml = `<span class="itc-rank-trend dn">▼${Math.abs(gain)}</span>`;
      }
      const gap = i === 0 ? '' : `<span class="itc-rank-gap">−${leaderPts - t.punti}</span>`;
      return `<div class="itc-rank-row${i===0?' itc-rank-row--leader':''}" onclick="location.hash='#/team/${encodeURIComponent(t.team_id)}'">
        <span class="itc-rank-pos itc-rank-pos-${i<3?i+1:'x'}">${i+1}</span>
        <div class="itc-rank-info">
          <div class="itc-rank-name">${esc(t.team)}${trendHtml}</div>
          <div class="itc-rank-sub">${t.riders} atleti · ${t.wins} vitt. · ${t.podi} podi</div>
        </div>
        ${gap}
        <span class="itc-rank-pts">${t.punti}<small>pt</small></span>
      </div>`;
    }).join('');
    const resolvedCat = catCode || mainCat;
    return `<div class="itc-card itc-rank-card">
      <div class="itc-card-hdr"><span class="itc-card-title">🏆 TOP TEAM${title?' · '+esc(title):''}</span><a href="#/classifica/${resolvedCat}/team" class="itc-card-more">Vedi tutti →</a></div>
      ${rows}
    </div>`;
  }

  // ── Team movers card ──────────────────────────────────────────────
  function buildTeamMoversCard(teamRank, snapNow, snapBefore, title) {
    const sNow = snapNow   || _teamSnapNow;
    const sBef = snapBefore|| _teamSnapBeforeLast;
    const TEAM_POS_LIMIT = 20;
    const up = [], dn = [];
    for (const t of teamRank) {
      const now = sNow[t.team_id], old = sBef[t.team_id];
      if (!now || !old) continue;
      const gain = old - now;
      // UP: arrivati dentro top 20
      if (gain >= 1 && now <= TEAM_POS_LIMIT) up.push({ ...t, gain, pos: now });
      // DOWN: erano in top 20 e sono scesi
      else if (gain <= -1 && (now - gain) <= TEAM_POS_LIMIT) dn.push({ ...t, gain, pos: now });
    }
    up.sort((a,b)=>b.gain-a.gain); dn.sort((a,b)=>a.gain-b.gain);
    const up5 = up.slice(0, 5), dn5 = dn.slice(0, 5);
    if (!up5.length && !dn5.length) return '';
    const mkRow = (t, dir) => {
      const isUp    = dir === 'up';
      const gainLbl = isUp ? `+${t.gain}` : `${t.gain}`;
      const prevPos = t.pos + t.gain; // gain = old - now, so old = pos + gain
      return `<div class="itc-mover itc-mover--${dir}" onclick="location.hash='#/team/${encodeURIComponent(t.team_id)}'">
        <div class="itc-mover-badge itc-mover-badge--${dir}">${gainLbl}</div>
        <div class="itc-mover-info">
          <span class="itc-mover-name">${esc(t.team)}</span>
          <span class="itc-mover-detail">${t.riders || ''} atleti · ${t.wins || 0} vitt.</span>
        </div>
        <div class="itc-mover-pos-wrap">
          <span class="itc-mover-prev-pos">${prevPos}°</span>
          <span class="itc-mover-arrow">→</span>
          <span class="itc-mover-now-pos" style="color:${isUp ? '#10B981' : '#EF4444'}">${t.pos}°</span>
        </div>
      </div>`;
    };
    const upSection = up5.length ? `
      <div class="itc-mover-section-lbl itc-mover-section-up">▲ IN SALITA</div>
      ${up5.map(t => mkRow(t, 'up')).join('')}` : '';
    const dnSection = dn5.length ? `
      <div class="itc-mover-section-lbl itc-mover-section-dn">▼ IN DISCESA</div>
      ${dn5.map(t => mkRow(t, 'dn')).join('')}` : '';
    return `<div class="itc-card itc-movers-card">
      <div class="itc-card-hdr"><span class="itc-card-title">📈 TEAM MOVERS${title?' · '+esc(title):''}</span></div>
      ${upSection}${dnSection}
    </div>`;
  }

  // ── Team VS Rivalry card ─────────────────────────────────────────
  function buildTeamVsCard(teamRank) {
    if (teamRank.length < 2) return '';
    // Cerca la coppia più narrativa: adiacente in classifica + entrambe attive
    let rv = null;
    for (let i = 0; i < Math.min(teamRank.length - 1, 6) && !rv; i++) {
      const a = teamRank[i], b = teamRank[i+1];
      const aAct = hubResES2.filter(r => r.team_id === a.team_id && r.data >= cut14).length;
      const bAct = hubResES2.filter(r => r.team_id === b.team_id && r.data >= cut14).length;
      if (aAct > 0 && bAct > 0) rv = { a, b };
    }
    if (!rv) rv = { a: teamRank[0], b: teamRank[1] };
    const { a, b } = rv;
    const gap = a.punti - b.punti;
    const aRec = hubResES2.filter(r=>r.team_id===a.team_id&&r.data>=cut14).reduce((s,r)=>s+(r.punti_effettivi||0),0);
    const bRec = hubResES2.filter(r=>r.team_id===b.team_id&&r.data>=cut14).reduce((s,r)=>s+(r.punti_effettivi||0),0);
    const total = Math.max(1, aRec + bRec);
    const aPct  = Math.round(aRec / total * 100);
    return `<div class="itc-card itc-vs-card">
      <div class="itc-card-hdr">
        <span class="itc-card-title">⚔ RIVALITÀ TEAM</span>
        <span class="itc-vs-encounters">${gap} pt distacco</span>
      </div>
      <div class="itc-vs-ring">
        <div class="itc-vs-side itc-vs-a" onclick="location.hash='#/team/${encodeURIComponent(a.team_id)}'">
          <div class="itc-vs-wins">${a.wins}V</div>
          <div class="itc-vs-name">${esc(a.team)}</div>
          <div class="itc-vs-recent-pts">${aRec} pt / 14gg</div>
        </div>
        <div class="itc-vs-center">
          <div class="itc-vs-vs">VS</div>
          <div class="itc-vs-bar-wrap">
            <div class="itc-vs-bar-a" style="width:${aPct}%;background:${hubColor}"></div>
            <div class="itc-vs-bar-b" style="width:${100-aPct}%"></div>
          </div>
          <div class="itc-vs-bar-label">FORMA</div>
        </div>
        <div class="itc-vs-side itc-vs-b" onclick="location.hash='#/team/${encodeURIComponent(b.team_id)}'">
          <div class="itc-vs-wins">${b.wins}V</div>
          <div class="itc-vs-name">${esc(b.team)}</div>
          <div class="itc-vs-recent-pts">${bRec} pt / 14gg</div>
        </div>
      </div>
      <div class="itc-vs-footer">
        <button class="itc-vs-cta" onclick="window.openComparatoreVs('${a.team_id}','${b.team_id}','team')">⚖ Confronta</button>
      </div>
    </div>`;
  }

  // ── Team News & Analysis feed ─────────────────────────────────────
  function buildTeamFeedCard(teamRank, resSet, catCode) {
    if (!teamRank.length) return '';
    const items = [];
    // 1. Situazione in vetta
    if (teamRank.length >= 2) {
      const gap = teamRank[0].punti - teamRank[1].punti;
      items.push({ icon:'🏆', text: gap <= 15
        ? `<strong>${esc(teamRank[0].team)}</strong> guida con ${teamRank[0].punti} pt — solo ${gap} pt su <strong>${esc(teamRank[1].team)}</strong>`
        : `<strong>${esc(teamRank[0].team)}</strong> in testa con ${teamRank[0].punti} pt, +${gap} su ${esc(teamRank[1].team)}` });
    }
    // 2. Team più vincente ultimi 14gg
    const teamWins14 = {};
    for (const r of resSet.filter(r=>r.data>=cut14&&r.posizione===1&&r.team_id)) {
      if (!teamWins14[r.team_id]) teamWins14[r.team_id] = { name: r.team, wins: 0 };
      teamWins14[r.team_id].wins++;
    }
    const topW = Object.values(teamWins14).sort((a,b)=>b.wins-a.wins)[0];
    if (topW && topW.wins >= 2)
      items.push({ icon:'🥇', text:`<strong>${esc(topW.name)}</strong> è la squadra più vincente negli ultimi 14 giorni: <strong>${topW.wins} vittorie</strong>` });
    // 3. Maggior scalatore team (snapshot-based)
    {
      let bestGain = 1, bestTeam = null;
      for (const t of teamRank) {
        const now = _teamSnapNow[t.team_id] || 99, old = _teamSnap14[t.team_id] || 99;
        if (old - now > bestGain) { bestGain = old - now; bestTeam = t; }
      }
      if (bestTeam)
        items.push({ icon:'🚀', text:`<strong>${esc(bestTeam.team)}</strong> guadagna <strong>+${bestGain} posizioni</strong> nella classifica squadre` });
    }
    // 4. Team con più atleti a punti (profondità rosa)
    const riders14 = {};
    for (const r of resSet.filter(r=>r.data>=cut14&&(r.punti_effettivi||0)>0&&r.team_id)) {
      if (!riders14[r.team_id]) riders14[r.team_id] = { name: r.team, riders: new Set() };
      riders14[r.team_id].riders.add(r.atleta_id);
    }
    const deepest = Object.values(riders14).sort((a,b)=>b.riders.size-a.riders.size)[0];
    if (deepest && deepest.riders.size >= 3)
      items.push({ icon:'👥', text:`<strong>${esc(deepest.name)}</strong> porta <strong>${deepest.riders.size} corridori</strong> a punti negli ultimi 14 giorni` });
    // 5. Team in calo (segnale negativo)
    {
      let worstDrop = -1, worstTeam = null;
      for (const t of teamRank) {
        const now = _teamSnapNow[t.team_id] || 99, old = _teamSnap14[t.team_id] || 99;
        if (now - old > worstDrop) { worstDrop = now - old; worstTeam = t; }
      }
      if (worstTeam && worstDrop >= 2)
        items.push({ icon:'📉', text:`<strong>${esc(worstTeam.team)}</strong> scende di ${worstDrop} posizioni nelle ultime 2 settimane` });
    }
    if (!items.length) return '';
    return `<div class="itc-card itc-feed-card">
      <div class="itc-card-hdr"><span class="itc-card-title">📊 ANALISI TEAM</span><a href="#/team" class="itc-card-more">Classifica →</a></div>
      ${items.map(item=>`<div class="itc-feed-item">
        <span class="itc-feed-icon">${item.icon||'📌'}</span>
        <div class="itc-feed-text">${item.text}</div>
      </div>`).join('')}
    </div>`;
  }

  // ── Popular riders / Trending ─────────────────────────────────────
  function buildPopularCard(resSet, catCode) {
    const hubIds = new Set(resSet.map(r=>r.atleta_id).filter(Boolean));
    const localViews = getPopularAthletes(20).filter(a=>hubIds.has(a.atleta_id));
    // Se ci sono abbastanza view locali, usale; altrimenti usa trending per punti
    const hasRealViews = localViews.reduce((s,a)=>s+a.count,0) >= 3;
    let items = localViews.slice(0, 10);
    if (!hasRealViews) {
      // Trending: atleti con più punti negli ultimi 7gg
      const trending = {};
      for (const r of resSet.filter(r=>r.data>=cut7&&(r.punti_effettivi||0)>0&&r.atleta_id)) {
        if (!trending[r.atleta_id])
          trending[r.atleta_id] = { atleta_id:r.atleta_id, cognome:r.cognome, nome:r.nome, count:r.punti_effettivi||0 };
        else trending[r.atleta_id].count += (r.punti_effettivi||0);
      }
      items = Object.values(trending).sort((a,b)=>b.count-a.count).slice(0,10);
    }
    if (!items.length) return '';
    const title = hasRealViews ? '👁 POPOLARI OGGI' : '📈 TRENDING';
    return `<div class="itc-card itc-popular-card">
      <div class="itc-card-hdr"><span class="itc-card-title">${title}</span></div>
      ${items.map((a,i)=>`<div class="itc-popular-row" onclick="location.hash='#/atleta/${encodeURIComponent(a.atleta_id)}'">
        <span class="itc-popular-rank">${i+1}</span>
        <div class="itc-popular-info">
          <span class="itc-popular-name">${esc(a.cognome)} ${esc(a.nome)}</span>
        </div>
        ${hasRealViews?`<span class="itc-popular-count">${a.count}</span>`:''}
      </div>`).join('')}
    </div>`;
  }

  // ── Ticker ───────────────────────────────────────────────────────
  const tickItems=[];
  if(hubRanking.length>=2){const g12=hubRanking[0].punti-hubRanking[1].punti;tickItems.push(g12<=15?`LOTTA AL VERTICE — <strong>${esc(hubRanking[0].cognome)}</strong> guida con soli ${g12} pt`:`<strong>${esc(hubRanking[0].cognome)}</strong> in testa con ${hubRanking[0].punti} pt`);}
  if(fireAth) tickItems.push(`🔥 RIDER OF MOMENT: <strong>${esc(fireAth.cognome)} ${esc(fireAth.nome)}</strong> · ${fireAth.wins} vittorie ultimi 14gg`);
  if(movers.up[0]) tickItems.push(`📈 <strong>${esc(movers.up[0].cognome)}</strong> sale di +${movers.up[0].gain} posizioni`);
  const nextRace=calendar.find(g=>{if(g.genere&&g.genere!==hub.gender)return false;if(hub.catFilter&&!(g.categoria||'').toLowerCase().includes(hub.catFilter.toLowerCase()))return false;return(g.data||'')>=todayStr;});
  if(nextRace) tickItems.push(`📅 PROSSIMA: <strong>${esc(nextRace.nome)}</strong>`);
  const tickerHtml=tickItems.length?`<div class="itc-ticker"><div class="itc-ticker-track">${[...tickItems,...tickItems].join(' &nbsp;·&nbsp; ')}</div></div>`:'';

  // ── Build sections ────────────────────────────────────────────────
  const champHtml = isEsordienti
    ? (champBar(hubRankingES1||[],'1° ANNO')+champBar(hubRanking,'2° ANNO'))
    : champBar(hubRanking,'');

  // Rider sections
  const _rFireHtml = isEsordienti
    ? `<div class="itc-dual">${buildFireCard(fireAthES1,es1Code,hubRankingES1||[],fireAthES1Photo)}${buildFireCard(fireAth,mainCat,hubRanking,fireAthPhoto)}</div>`
    : buildFireCard(fireAth,mainCat,hubRanking,fireAthPhoto);
  const _rRankHtml = isEsordienti
    ? `<div class="itc-dual">${buildRankCard(hubRankingES1||[],es1Code,'1° Anno',_snapNowE1,_snapBeforeLastE1)}${buildRankCard(hubRanking,mainCat,'2° Anno',_snapNow,_snapBeforeLast)}</div>`
    : buildRankCard(hubRanking,mainCat,'',_snapNow,_snapBeforeLast);
  const _rMovHtml = isEsordienti
    ? `<div class="itc-dual">${buildMoversCard(moversES1,'1° Anno')}${buildMoversCard(movers,'2° Anno')}</div>`
    : buildMoversCard(movers,'');
  const _rVsHtml   = buildVsCard(hubRes, hubRanking, mainCat);
  const _rFeedHtml = buildFeedCard(hubRes, hubRanking, mainCat);

  // Team sections — per esordienti mostra ES1 e ES2 in dual
  const _tFireHtml = isEsordienti
    ? `<div class="itc-dual">${buildTeamFireCard(_teamOfMomentES1,_teamOfMomentES1Photo,_teamSnapNowES1,_teamSnap14ES1,'1° Anno')}${buildTeamFireCard(_teamOfMoment,_teamOfMomentPhoto,_teamSnapNow,_teamSnap14,'2° Anno')}</div>`
    : buildTeamFireCard(_teamOfMoment, _teamOfMomentPhoto, _teamSnapNow, _teamSnap14, '');
  const _tRankHtml = isEsordienti
    ? `<div class="itc-dual">${buildTeamRankCard(_teamRankNowES1,_teamSnapNowES1,_teamSnapBeforeLastES1,'1° Anno',es1Code)}${buildTeamRankCard(_teamRankNow,_teamSnapNow,_teamSnapBeforeLast,'2° Anno',mainCat)}</div>`
    : buildTeamRankCard(_teamRankNow, _teamSnapNow, _teamSnapBeforeLast, '', mainCat);
  const _tMovHtml = isEsordienti
    ? `<div class="itc-dual">${buildTeamMoversCard(_teamRankFullES1,_teamSnapNowES1,_teamSnapBeforeLastES1,'1° Anno')}${buildTeamMoversCard(_teamRankFull,_teamSnapNow,_teamSnapBeforeLast,'2° Anno')}</div>`
    : buildTeamMoversCard(_teamRankFull, _teamSnapNow, _teamSnapBeforeLast, '');
  const _tVsHtml   = buildTeamVsCard(_teamRankNow);
  const _tFeedHtml = buildTeamFeedCard(_teamRankNow, hubResES2, mainCat);

  // Calendar + Popular
  const _calHtml     = buildCalCard();
  const _popularHtml = buildPopularCard(hubRes, mainCat);

  // Gamification cards
  const _digestHtml   = buildWeeklyDigestCard();
  const _mvpHtml      = buildMVPCard();
  const _upsetHtml    = buildUpsetCard();
  const _rookieHtml   = buildRookieCard();
  const _watchHtml    = buildWatchlistCard();

  // Layout: per esordienti i blocchi rider sono già itc-dual internamente
  // → non li annidiamo in altro dual; team va sotto.
  // Per tutti gli altri: ogni riga = itc-dual rider|team.
  const sectionsInner = isEsordienti ? `
    ${_rFireHtml}
    ${_tFireHtml}
    ${_rRankHtml}
    ${_tRankHtml}
    ${_rMovHtml}
    ${_tMovHtml}
    <div class="itc-dual">${_rVsHtml}${_tVsHtml}</div>
    <div class="itc-dual">${_upsetHtml||''}${_watchHtml}</div>
    <div class="itc-dual">${_rFeedHtml}${_tFeedHtml}</div>
    <div class="itc-dual">${_popularHtml}${_calHtml}</div>
  ` : `
    <div class="itc-dual">${_rFireHtml}${_tFireHtml}</div>
    <div class="itc-dual">${_rRankHtml}${_tRankHtml}</div>
    <div class="itc-dual">${_rMovHtml}${_tMovHtml}</div>
    <div class="itc-dual">${_rVsHtml}${_tVsHtml}</div>
    <div class="itc-dual">${_upsetHtml||''}${_watchHtml}</div>
    <div class="itc-dual">${_rFeedHtml}${_tFeedHtml}</div>
    <div class="itc-dual">${_popularHtml}${_calHtml}</div>
  `;

  const athCount    = new Set(hubRes.map(r=>r.atleta_id).filter(Boolean)).size;
  const raceCount   = new Set(hubRes.map(r=>r.gara_id).filter(Boolean)).size;
  const genderLabel = hub.gender==='M'?'MASCHILE':hub.gender==='F'?'FEMMINILE':'';
  const heroPh      = pickPh(0);
  const subnav      = buildHubSubnav(hub);

  setPage(`
    <div class="itc-dash">
      <div class="itc-dash-hero" style="${heroPh?`background-image:url('${heroPh}')`:''}" id="itc-hero-bg">
        <div class="itc-hero-bg2"></div>
        <div class="itc-dash-hero-overlay" style="--hub-color:${hubColor}"></div>
        <div class="itc-dash-hero-content">
          <div class="itc-dash-eyebrow" style="color:${hubColor}">${hub.icon} ${genderLabel}</div>
          <h1 class="itc-dash-title">${esc(hub.label.toUpperCase())}</h1>
          <div class="itc-dash-meta">${athCount} atleti · ${raceCount} gare · ${esc(hub.desc)}</div>
          <button class="hub-clear-filter" onclick="window.clearHubFilter();window.location.hash='#/'">← Cambia categoria</button>
        </div>
      </div>
      ${subnav}
      ${tickerHtml}
      ${champHtml}
      <div class="itc-sections">
        ${sectionsInner}
      </div>
    </div>
  `);

  // ── Hero slideshow ───────────────────────────────────────────────
  if (allPhotos.length > 1) {
    const heroEl = document.getElementById('itc-hero-bg');
    const bg2    = heroEl?.querySelector('.itc-hero-bg2');
    if (heroEl && bg2) {
      let idx = 1;
      const slide = () => {
        if (!document.contains(heroEl)) return;
        const next = allPhotos[idx % allPhotos.length].url;
        bg2.style.backgroundImage = `url('${next}')`;
        bg2.classList.add('active');
        setTimeout(() => { heroEl.style.backgroundImage = `url('${next}')`; bg2.classList.remove('active'); idx++; }, 1400);
      };
      const t = setInterval(slide, 6000);
      window.addEventListener('hashchange', ()=>clearInterval(t), {once:true});
    }
  }
}

// ── Fallback: nav bars animate per #/hub senza categoria ───────────
async function _renderNavBars() {
  const BARS = [
    { href:'#/risultati',   num:'01', label:'Risultati',   desc:'Gare recenti, podi e classifiche per categoria e regione', subs: null },
    { href:'#/classifica',  num:'02', label:'Classifiche', desc:'Ranking atleti, team e classifica generale della stagione',
      subs:[{l:'Classifica',h:'#/classifica'},{l:'Atleti',h:'#/atleti'},{l:'Team',h:'#/team'}] },
    { href:'#/calendario',  num:'03', label:'Calendario',  desc:'Prossime gare e calendario stagionale completo', subs: null },
    { href:'#/statistiche', num:'04', label:'Analisi',     desc:'Statistiche, comparatore atleti e trend stagionali',
      subs:[{l:'Statistiche',h:'#/statistiche'},{l:'Comparatore',h:'#/comparatore'}] },
  ];

  // ── Hub context ────────────────────────────────────────────────
  const hub      = activeHub || null;
  const hubColor = hub ? (hub.color || '#FF6B00') : '#FF6B00';
  const catCodes = hub ? (hub.catCodes || []) : [];
  const eyebrow  = hub
    ? `${hub.icon || ''} ${hub.gender === 'M' ? 'Maschile' : hub.gender === 'F' ? 'Femminile' : ''}`
    : 'Ciclismo Agonistico Italiano';
  const heroTitle = hub ? hub.label.toUpperCase() : 'Italiacrit<br>Risultati';
  const heroSub   = hub
    ? `${hub.desc || ''} — scegli una sezione.`
    : 'Classifiche, risultati e statistiche del ciclismo su strada italiano.';

  // ── Carica solo foto (niente video) ───────────────────────────
  let allPhotos = [];
  try {
    const [d1, d2] = await Promise.all([
      fetch(`${API_BASE}/race-photos`).then(r => r.json()).catch(() => ({ photos: [] })),
      fetch(`${API_BASE}/xpix-photos`).then(r => r.json()).catch(() => ({ photos: [] })),
    ]);
    const rawPhotos = [];
    (d1.photos || []).forEach(p => {
      if (p.filename) rawPhotos.push({ url: `${PHOTOS_BASE}/photos/${p.filename}`, gara_id: p.gara_id || '' });
    });
    (d2.photos || []).forEach(p => {
      if (p.url) rawPhotos.push({ url: p.url, gara_id: p.gara_id || '' });
    });

    // Filtra per categoria se hub attivo
    const catPhotos = catCodes.length
      ? rawPhotos.filter(p => catCodes.some(code => p.gara_id.includes(code)))
      : rawPhotos;

    // Usa foto categoria se ne abbiamo abbastanza, altrimenti tutte
    allPhotos = catPhotos.length >= 4 ? catPhotos : rawPhotos;

    // Shuffle
    for (let i = allPhotos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allPhotos[i], allPhotos[j]] = [allPhotos[j], allPhotos[i]];
    }
  } catch { /* fallback: dark bg */ }

  const pickPhoto = i => allPhotos[i % allPhotos.length]?.url || null;

  // ── Build bars HTML ───────────────────────────────────────────
  // Alterna sinistra/destra: 0→sx, 1→dx, 2→sx, 3→dx
  // NOTA: i sub-item usano <span onclick> NON <a> perché il bar stesso è già <a>
  //       (nested <a> è HTML invalido e causa overflow fuori dal ban)
  const barsHtml = BARS.map((b, i) => {
    const isRight = i % 2 === 1;
    const pic     = pickPhoto(i);

    const subsHtml = b.subs
      ? `<div class="hub-bar-subs">${b.subs.map(s =>
          `<span class="hub-bar-sub-item" onclick="event.preventDefault();event.stopPropagation();window.location.hash='${s.h}'">${esc(s.l)}</span>`
        ).join('')}</div>`
      : '';

    return `
      <a href="${b.href}" class="hub-bar${isRight ? ' hub-bar--right' : ''}" style="transition-delay:${i * 110}ms">
        <div class="hub-bar-bg" style="${pic ? `background-image:url('${pic}')` : ''}"></div>
        <div class="hub-bar-overlay"></div>
        <div class="hub-bar-inner">
          <div class="hub-bar-stripe" style="background:${hubColor}"></div>
          <div class="hub-bar-num">${b.num}</div>
          <div class="hub-bar-text">
            <div class="hub-bar-label">${esc(b.label)}</div>
            <div class="hub-bar-desc">${b.desc}</div>
            ${subsHtml}
          </div>
          <div class="hub-bar-arrow">→</div>
        </div>
      </a>`;
  }).join('');

  // ── Hero ───────────────────────────────────────────────────────
  const heroPic   = pickPhoto(0);
  const heroStyle = heroPic ? `background-image:url('${heroPic}')` : '';

  setPage(`
    <div class="hub-page">
      <div class="hub-hero" style="${heroStyle}">
        <div class="hub-hero-overlay"></div>
        <div class="hub-hero-content">
          <div class="hub-hero-eyebrow" style="color:${hubColor}">${eyebrow}</div>
          <div class="hub-hero-title">${heroTitle}</div>
          <div class="hub-hero-sub">${heroSub}</div>
          ${hub ? `<button class="hub-clear-filter" onclick="window.clearHubFilter();window.location.hash='#/hub'">✕ Rimuovi filtro</button>` : ''}
        </div>
      </div>
      <div class="hub-bars">${barsHtml}</div>
    </div>
  `);

  // ── Scroll-reveal ──────────────────────────────────────────────
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('hub-visible'); obs.unobserve(e.target); }
    });
  }, { threshold: 0.06 });
  document.querySelectorAll('.hub-bar').forEach(b => obs.observe(b));

  // ── Hero slideshow: cambia foto ogni 6s con crossfade ──────────
  if (allPhotos.length > 1) {
    const hero = document.querySelector('.hub-hero');
    if (hero) {
      const bg2 = document.createElement('div');
      bg2.className = 'hub-hero-bg2';
      hero.prepend(bg2);
      let idx = 1;
      const slide = () => {
        if (!document.contains(hero)) return;
        const next = allPhotos[idx % allPhotos.length].url;
        bg2.style.backgroundImage = `url('${next}')`;
        bg2.classList.add('active');
        setTimeout(() => {
          hero.style.backgroundImage = `url('${next}')`;
          bg2.classList.remove('active');
          idx++;
        }, 1400);
      };
      const timer = setInterval(slide, 6000);
      const cleanup = () => { clearInterval(timer); window.removeEventListener('hashchange', cleanup); };
      window.addEventListener('hashchange', cleanup);
    }
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
let rankSort   = 'punti';  // 'punti' | 'momentum' | 'form'

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
            placeholder="${rankView==='atleti'?'Cerca atleta o team…':'Filtra team…'}"
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
  let _rankPhotosQueue = null;

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

    // ── Pre-compute narrative metrics for top 30 ──────────────
    const _refDate = globalData.resultsRaw.reduce((mx,r)=>(r.data||'')>mx?r.data:mx,'')
      || new Date().toISOString().split('T')[0];
    const _metricCache = {};
    for (const entry of filtered.slice(0, 30)) {
      const id  = entry.atleta_id;
      const mom = calcRankMomentum(id, globalData.resultsRaw, _refDate, rankCat);
      const fd  = calcFormDelta(id, globalData.resultsRaw, _refDate, rankCat);
      const lr  = globalData.resultsRaw
        .filter(r => r.atleta_id === id && getRankingFileCode(r) === rankCat && r.data)
        .reduce((mx,r) => r.data > mx ? r.data : mx, '');
      const di  = lr ? Math.floor((new Date(_refDate) - new Date(lr)) / 86400000) : 999;
      const bdg = getRankBadge(entry, filtered, globalData.resultsRaw, rankCat, _refDate, mom, fd, di);
      _metricCache[id] = { momentum: mom, formDelta: fd, daysIdle: di, badge: bdg };
    }
    const leaderPts = filtered[0]?.punti || 0;

    // ── Apply sort ────────────────────────────────────────────
    let displayList = [...filtered];
    if (rankSort === 'momentum') {
      displayList.sort((a,b) =>
        ((_metricCache[b.atleta_id]?.momentum ?? -1) - (_metricCache[a.atleta_id]?.momentum ?? -1))
      );
    } else if (rankSort === 'form') {
      displayList.sort((a,b) =>
        ((_metricCache[b.atleta_id]?.formDelta ?? -999) - (_metricCache[a.atleta_id]?.formDelta ?? -999))
      );
    }

    // ── Narrative headline banner ─────────────────────────────
    let storyHtml = '';
    // Determina se la ricerca corrisponde a un TEAM (più corridori della stessa squadra)
    const _q = (rankFilter || '').toLowerCase().trim();
    const _teamMatches = _q ? filtered.filter(r => (r.team_nome||'').toLowerCase().includes(_q)) : [];
    const _nameMatches = _q ? filtered.filter(r => (r.cognome||'').toLowerCase().includes(_q) || (r.nome||'').toLowerCase().includes(_q)) : [];
    const _isTeamSearch = _teamMatches.length >= 2 && _teamMatches.length >= _nameMatches.length;

    if (rankFilter && _isTeamSearch) {
      // ── Banner TEAM: tutte le posizioni dei corridori della squadra ──
      const byTeam = {};
      _teamMatches.forEach(r => { const t = r.team_nome || '—'; (byTeam[t] = byTeam[t] || []).push(r); });
      const teamsSorted = Object.entries(byTeam).sort((a,b) => b[1].length - a[1].length);
      const [mainTeam, riders] = teamsSorted[0];
      // riders mantiene l'ordine di classifica (filtered è ordinato per punti)
      const totalPts = riders.reduce((s,r) => s + (r.punti||0), 0);
      const podi     = riders.reduce((s,r) => s + ((r.p1||0)+(r.p2||0)+(r.p3||0)), 0);
      const wins     = riders.reduce((s,r) => s + (r.p1||0), 0);
      const best     = riders[0];
      const top10    = riders.filter(r => r.pos <= 10).length;
      const detailParts = [
        `<span class="rk-narrative-detail">🏅 Miglior posizione: ${best.pos}° — ${esc(best.cognome)} ${esc(best.nome)}</span>`,
        `<span class="rk-narrative-detail">${totalPts} pt totali</span>`,
      ];
      if (top10 > 0) detailParts.push(`<span class="rk-narrative-detail">${top10} nei primi 10</span>`);
      if (wins > 0)  detailParts.push(`<span class="rk-narrative-detail">${wins} vittori${wins===1?'a':'e'}</span>`);
      else if (podi > 0) detailParts.push(`<span class="rk-narrative-detail">${podi} podi</span>`);
      if (teamsSorted.length > 1) detailParts.push(`<span class="rk-narrative-detail">+${teamsSorted.length-1} altri team nel filtro</span>`);
      storyHtml = `
        <div class="rk-narrative rk-narrative--team">
          <div class="rk-narrative-label">🚩 TEAM IN CLASSIFICA · ${esc(mainTeam)}</div>
          <div class="rk-narrative-headline">${riders.length} atlet${riders.length===1?'a':'i'} in ${catLabel(rankCat)}</div>
          <div class="rk-narrative-details">${detailParts.join('')}</div>
        </div>`;
    } else if (rankFilter && filtered.length >= 1) {
      // Ricerca attiva: mostra la situazione in classifica del corridore trovato
      const ath = filtered[0];
      const leaderFull = ranking[0];
      const gapToLeader = leaderFull && ath.atleta_id !== leaderFull.atleta_id
        ? leaderFull.punti - ath.punti : 0;
      const metrics = _metricCache[ath.atleta_id];
      const badge = metrics?.badge;
      // Challenger info
      const above = ranking.find(r => r.pos === ath.pos - 1);
      const below  = ranking.find(r => r.pos === ath.pos + 1);
      const parts = [];
      if (ath.pos === 1) parts.push(`Leader della classifica con ${ath.punti} pt`);
      else parts.push(`${ath.pos}° in classifica · ${ath.punti} pt · −${gapToLeader} dal leader`);
      if (above && ath.pos > 1) parts.push(`${above.punti - ath.punti} pt da ${esc(above.cognome)}`);
      if (below) parts.push(`+${ath.punti - below.punti} pt su ${esc(below.cognome)}`);
      const badgeHtml2 = badge ? `<span class="rk-badge-pill ${badge.cls}">${badge.emoji} ${badge.label}</span>` : '';
      storyHtml = `
        <div class="rk-narrative rk-narrative--athlete">
          <div class="rk-narrative-label">SITUAZIONE IN CLASSIFICA · ${esc(ath.cognome)} ${esc(ath.nome)}</div>
          <div class="rk-narrative-headline">${parts[0]}${badgeHtml2 ? ' ' + badgeHtml2 : ''}</div>
          ${parts.slice(1).length ? `<div class="rk-narrative-details">${parts.slice(1).map(l=>`<span class="rk-narrative-detail">${l}</span>`).join('')}</div>` : ''}
        </div>`;
    } else if (!isFiltered) {
      const headline   = generateNarrativeHeadline(ranking, globalData.resultsRaw, rankCat, _refDate);
      const storyLines = buildWeeklyNarrative(ranking, globalData.resultsRaw, rankCat);
      const detailsHtml = storyLines.length
        ? `<div class="rk-narrative-details">${storyLines.map(l=>`<span class="rk-narrative-detail">${l}</span>`).join('')}</div>`
        : '';
      if (headline || storyLines.length) {
        storyHtml = `
          <div class="rk-narrative">
            <div class="rk-narrative-label">SITUATION IN CLASSIFICA</div>
            ${headline ? `<div class="rk-narrative-headline">${headline}</div>` : ''}
            ${detailsHtml}
          </div>`;
      }
    }

    // ── Battle zone detection (only meaningful when sorted by pts) ─
    let battleZoneStart = -1, battleZoneEnd = -1;
    if (rankSort === 'punti' && leaderPts > 0 && filtered.length >= 6) {
      for (let zi = 2; zi < Math.min(filtered.length - 3, 18); zi++) {
        const spread3 = filtered[zi].punti - filtered[zi+3].punti;
        if (spread3 / leaderPts < 0.06) {
          battleZoneStart = zi;
          for (let zj = zi+1; zj < Math.min(filtered.length, 22); zj++) {
            if ((filtered[zi].punti - filtered[zj].punti) / leaderPts < 0.10)
              battleZoneEnd = zj;
            else break;
          }
          if (battleZoneEnd > battleZoneStart) break;
          else { battleZoneStart = -1; battleZoneEnd = -1; }
        }
      }
    }

    const sortBar = '';

    // ── Build rows ────────────────────────────────────────────
    const rows = displayList.map((r, i) => {
      const pClass  = posClass(r.pos);
      const tier    = r.pos === 1 ? 'rk-tier-1' : r.pos <= 3 ? 'rk-tier-top3' : r.pos <= 10 ? 'rk-tier-top10' : '';
      const gap     = r.pos === 1
        ? `<span class="rk-leader-tag">LEADER</span>`
        : `<span class="rk-gap-label">−${leaderPts - r.punti}</span>`;

      const metrics = _metricCache[r.atleta_id];

      // Momentum mini-bar
      const mom      = metrics?.momentum ?? 0;
      const fd       = metrics?.formDelta ?? 0;
      const momColor = mom >= 70 ? '#10B981' : mom >= 40 ? '#F59E0B' : '#6B7280';
      const momBar   = `<div class="rk-momentum-wrap" title="Momentum ${mom}/100">
        <div class="rk-momentum-bar" style="width:${mom}%;background:${momColor}"></div>
      </div>`;

      // Badge
      const badge = metrics?.badge;
      const badgeHtml = badge
        ? `<span class="rk-badge-pill ${badge.cls}">${badge.emoji} ${badge.label}</span>`
        : '';

      // Leader safety gauge (row 1 only)
      let extraHtml = '';
      if (r.pos === 1 && filtered[1]) {
        const chall  = filtered[1];
        const c28s   = (() => { const d = new Date(_refDate); d.setDate(d.getDate()-28); return d.toISOString().split('T')[0]; })();
        const cRes4  = globalData.resultsRaw.filter(rr =>
          rr.atleta_id === chall.atleta_id && getRankingFileCode(rr) === rankCat && rr.data >= c28s
        );
        const safety = calcLeadershipSafety(r.punti, chall.punti, cRes4);
        const sColor = safety > 65 ? '#10B981' : safety > 35 ? '#F59E0B' : '#EF4444';
        const sLabel = safety > 65 ? 'Leadership sicura' : safety > 35 ? 'Sotto pressione' : '⚠ A rischio';
        extraHtml = `<div class="rk-leader-gauge-wrap">
          <div class="rk-leader-gauge-track">
            <div class="rk-leader-gauge-fill" style="width:${safety}%;background:${sColor}"></div>
          </div>
          <span class="rk-leader-gauge-lbl" style="color:${sColor}">${sLabel}</span>
        </div>`;
      }
      // Catch-up hint for positions 2-3
      if (r.pos >= 2 && r.pos <= 3 && leaderPts > 0) {
        const myRes = globalData.resultsRaw.filter(rr =>
          rr.atleta_id === r.atleta_id && getRankingFileCode(rr) === rankCat && (rr.punti_effettivi||0) > 0
        );
        const myAvg = myRes.length ? myRes.reduce((s,rr)=>s+(rr.punti_effettivi||0),0)/myRes.length : 0;
        const gapPts = leaderPts - r.punti;
        if (myAvg > 0 && gapPts > 0) {
          const races = Math.ceil(gapPts / myAvg);
          if (races <= 8)
            extraHtml += `<span class="rk-catchup">~${races} gar${races===1?'a':'e'} dal 1°</span>`;
        }
      }

      // Zone separator row injected before battleZoneStart
      let zoneSep = '';
      if (rankSort === 'punti' && i === battleZoneStart) {
        const cnt      = battleZoneEnd - battleZoneStart + 1;
        const spanPts  = filtered[battleZoneStart].punti
          - (filtered[Math.min(battleZoneEnd, filtered.length-1)]?.punti || 0);
        zoneSep = `<tr class="rk-zone-sep">
          <td colspan="6">⚔ ZONA BATTAGLIA — ${cnt} atleti in ${spanPts} punti</td>
        </tr>`;
      }

      return `${zoneSep}<tr class="ranking-row ${tier}" style="animation-delay:${Math.min(i,20)*30}ms">
        <td><span class="rank-num ${pClass}">${r.pos}</span></td>
        <td style="text-align:center;width:40px">${renderTrend(r)}</td>
        <td>
          <div class="rk-athlete-cell">
            <div class="rk-athlete-name-row">
              <span class="rk-av-wrap hide-mobile" data-aid="${esc(r.atleta_id)}"></span>
              <span class="rank-name"><a href="#/atleta/${esc(r.atleta_id)}">${esc(r.cognome)} ${esc(r.nome)}</a></span>
              ${badgeHtml}
            </div>
            <div class="td-team-mobile"><a href="#/team/${esc(r.team_id)}" style="color:var(--text-secondary)">${esc(r.team_nome)}</a></div>
            ${momBar}
            ${extraHtml}
          </div>
        </td>
        <td class="hide-mobile rk-team-cell"><span class="rk-tl-wrap" data-tid="${esc(r.team_id||'')}"></span><a href="#/team/${esc(r.team_id)}" style="color:var(--text-secondary);font-size:.85rem">${nationFlagPrefix(r.team_nome)}${esc(r.team_nome)}</a></td>
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

    _rankPhotosQueue = displayList;
    tableHtml = storyHtml + sortBar + `
      <table class="ranking-table rk-table-narrative">
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

    // ── Trend team: snapshot prima dell'ultimo giorno di gara ──────
    if (!isFiltered) {
      const _tResRaw = globalData.resultsRaw.filter(r => getRankingFileCode(r) === rankCat);
      const _tLastDate = _tResRaw.reduce((mx,r)=>(r.data||'')>mx?r.data:mx,'');
      if (_tLastDate) {
        const _snapNow    = Object.fromEntries(computeTeamRanking(_tResRaw, rankCat, null).map(t=>[t.team_id,t.pos]));
        const _snapBefore = Object.fromEntries(computeTeamRanking(_tResRaw, rankCat, _tLastDate).map(t=>[t.team_id,t.pos]));
        teamRanking.forEach(t => {
          const now = _snapNow[t.team_id], old = _snapBefore[t.team_id];
          t.trend = (now && old) ? old - now : null;
        });
      }
    }

    const filtered = teamRanking.filter(t => {
      if (!rankFilter) return true;
      return (t.team_nome||'').toLowerCase().includes(rankFilter.toLowerCase());
    });
    countLabel = `${filtered.length} team`;

    // ── Team narrative banner ──────────────────────────────────
    let teamStoryHtml = '';
    if (rankFilter && filtered.length >= 1) {
      // Ricerca attiva: situazione specifica del team
      const tm = filtered[0];
      const leaderFull = teamRanking[0];
      const gapToLeader = leaderFull && tm.team_id !== leaderFull.team_id
        ? leaderFull.punti - tm.punti : 0;
      const above = teamRanking.find(t => t.pos === tm.pos - 1);
      const below  = teamRanking.find(t => t.pos === tm.pos + 1);
      const parts = [];
      if (tm.pos === 1) parts.push(`Leader della classifica con ${tm.punti} pt`);
      else parts.push(`${tm.pos}° in classifica · ${tm.punti} pt · −${gapToLeader} dal leader`);
      if (above && tm.pos > 1) parts.push(`${above.punti - tm.punti} pt da ${esc(above.team_nome)}`);
      if (below) parts.push(`+${tm.punti - below.punti} pt su ${esc(below.team_nome)}`);
      if (tm.n_atleti) parts.push(`${tm.n_atleti} atleti in classifica`);
      if ((tm.trend || 0) > 0) parts.push(`In risalita di ${tm.trend} posizion${tm.trend===1?'e':'i'} ↑`);
      else if ((tm.trend || 0) < 0) parts.push(`In calo di ${Math.abs(tm.trend)} posizion${Math.abs(tm.trend)===1?'e':'i'} ↓`);
      teamStoryHtml = `
        <div class="rk-narrative rk-narrative--athlete">
          <div class="rk-narrative-label">SITUAZIONE IN CLASSIFICA · ${esc(tm.team_nome)}</div>
          <div class="rk-narrative-headline">${parts[0]}</div>
          ${parts.slice(1).length ? `<div class="rk-narrative-details">${parts.slice(1).map(l=>`<span class="rk-narrative-detail">${l}</span>`).join('')}</div>` : ''}
        </div>`;
    } else if (!isFiltered && teamRanking.length >= 2) {
      // Vista generale: headline + storia settimanale
      const headline   = generateTeamNarrativeHeadline(teamRanking, globalData.resultsRaw, rankCat);
      const storyLines = buildTeamWeeklyNarrative(teamRanking, globalData.resultsRaw, rankCat);
      const detailsHtml = storyLines.length
        ? `<div class="rk-narrative-details">${storyLines.map(l=>`<span class="rk-narrative-detail">${l}</span>`).join('')}</div>`
        : '';
      if (headline || storyLines.length) {
        teamStoryHtml = `
          <div class="rk-narrative">
            <div class="rk-narrative-label">SITUAZIONE IN CLASSIFICA</div>
            ${headline ? `<div class="rk-narrative-headline">${headline}</div>` : ''}
            ${detailsHtml}
          </div>`;
      }
    }

    const leaderTeamPts = teamRanking[0]?.punti || 0;
    const rows = filtered.map((t, i) => {
      const pClass = posClass(t.pos);
      const gap = t.pos === 1
        ? `<span class="rk-leader-tag">LEADER</span>`
        : `<span class="rk-gap-label">−${leaderTeamPts - t.punti}</span>`;
      return `<tr class="ranking-row" style="animation-delay:${Math.min(i,20)*30}ms">
        <td><span class="rank-num ${pClass}">${t.pos}</span></td>
        <td style="text-align:center;width:40px">${renderTrend(t, false)}</td>
        <td>
          <div class="rk-athlete-cell">
            <div class="rk-athlete-name-row">
              <span class="rk-tl-wrap" data-tid="${esc(t.team_id||'')}"></span>
              <span class="rank-name"><a href="#/team/${esc(t.team_id)}">${nationFlagPrefix(t.team_nome)}${esc(t.team_nome)}</a></span>
            </div>
          </div>
        </td>
        <td class="r">
          <div class="rk-pts-cell">
            <span class="rank-pts">${t.punti}</span>
            ${gap}
          </div>
        </td>
        <td class="r hide-mobile" style="font-family:var(--font-mono);font-size:.85rem;color:var(--text-muted)">${t.n_atleti||0}</td>
      </tr>`;
    }).join('');
    _rankPhotosQueue = filtered; // per logo team

    tableHtml = teamStoryHtml + `
      <table class="ranking-table rk-table-narrative">
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
  if (_rankPhotosQueue) _injectRankPhotos(_rankPhotosQueue.slice(0, 60));
}

async function _injectRankPhotos(items) {
  if (!items || !items.length) return;
  const tableEl = document.querySelector('.ranking-table');
  if (!tableEl) return;

  // Atleti — foto profilo (batch da 8)
  const hasAthletes = items.some(a => a.atleta_id);
  if (hasAthletes) {
    const batchSize = 8;
    for (let i = 0; i < items.length; i += batchSize) {
      if (!document.contains(tableEl)) return;
      await Promise.all(items.slice(i, i + batchSize).map(async a => {
        if (!a.atleta_id) return;
        const span = tableEl.querySelector(`.rk-av-wrap[data-aid="${CSS.escape(a.atleta_id)}"]`);
        if (!span) return;
        const ov = await getEntityOverrides('atleta', a.atleta_id).catch(() => ({}));
        if (ov.photo_url && document.contains(span))
          span.innerHTML = `<img src="${MEDIA_BASE}${esc(ov.photo_url)}" alt="" class="rk-av-img" onerror="this.parentElement.style.display='none'">`;
      }));
    }
  }

  // Team — logo (team unici, sia classifica atleti che classifica team)
  if (!document.contains(tableEl)) return;
  const teamIds = [...new Set(items.map(a => a.team_id || a.team_id).filter(Boolean))];
  await Promise.all(teamIds.map(async tid => {
    const ov = await getEntityOverrides('team', tid).catch(() => ({}));
    if (!ov.photo_url) return;
    tableEl.querySelectorAll(`.rk-tl-wrap[data-tid="${CSS.escape(tid)}"]`).forEach(span => {
      if (document.contains(span))
        span.innerHTML = `<img src="${MEDIA_BASE}${esc(ov.photo_url)}" alt="" class="rk-tl-img" onerror="this.remove()">`;
    });
  }));
}

// ── ADMIN DASHBOARD ──────────────────────────────────────────
let _adminSection = 'overview';

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

  setPage(`
    <div class="admin-shell">
      <!-- ── SIDEBAR ── -->
      <aside class="admin-sidebar">
        <div class="admin-sidebar-title">GESTIONALE</div>

        <div class="admin-nav-group">Generale</div>
        <div class="admin-nav-item" data-section="overview" onclick="adminNav('overview')">
          <span class="admin-nav-icon">📊</span> Dashboard
        </div>
        <div class="admin-nav-item" data-section="sync" onclick="adminNav('sync')">
          <span class="admin-nav-icon">🔄</span> Sincronizza dati
        </div>

        <div class="admin-nav-group">Foto</div>
        <div class="admin-nav-item" data-section="foto-pending" onclick="adminNav('foto-pending')">
          <span class="admin-nav-icon">📥</span> In attesa
          <span class="admin-nav-badge" id="badge-foto-pending"></span>
        </div>
        <div class="admin-nav-item" data-section="foto-xpix" onclick="adminNav('foto-xpix')">
          <span class="admin-nav-icon" style="color:#0ea5e9">◈</span> xpix Auto-Sync
          <span class="admin-nav-badge" id="badge-xpix"></span>
        </div>

        <div class="admin-nav-group">Video</div>
        <div class="admin-nav-item" data-section="video-pending" onclick="adminNav('video-pending')">
          <span class="admin-nav-icon">📥</span> In attesa
          <span class="admin-nav-badge" id="badge-video-pending"></span>
        </div>
        <div class="admin-nav-item" data-section="video-yt" onclick="adminNav('video-yt')">
          <span class="admin-nav-icon" style="color:#ef4444">▶</span> YouTube Auto-Sync
          <span class="admin-nav-badge" id="badge-yt"></span>
        </div>
        <div class="admin-nav-item" data-section="video-tutti" onclick="adminNav('video-tutti')">
          <span class="admin-nav-icon">🎥</span> Tutti i video
        </div>

        <div class="admin-nav-group">Archivio Foto</div>
        <div class="admin-nav-item" data-section="foto-tutti" onclick="adminNav('foto-tutti')">
          <span class="admin-nav-icon">🖼️</span> Tutte le foto
        </div>

        <div class="admin-nav-group">Media / Fotografi</div>
        <div class="admin-nav-item" data-section="media-profiles" onclick="adminNav('media-profiles')">
          <span class="admin-nav-icon">📷</span> Profili media
        </div>
        <div class="admin-nav-item" data-section="media-seed" onclick="adminNav('media-seed')">
          <span class="admin-nav-icon">🌱</span> Seed xpix
        </div>

        <div class="admin-nav-group">Utenti</div>
        <div class="admin-nav-item" data-section="utenti-lista" onclick="adminNav('utenti-lista')">
          <span class="admin-nav-icon">👥</span> Lista utenti
        </div>
        <div class="admin-nav-item" data-section="utenti-pending" onclick="adminNav('utenti-pending')">
          <span class="admin-nav-icon">📥</span> Profili in attesa
          <span class="admin-nav-badge" id="badge-profili-pending"></span>
        </div>

        <div class="admin-nav-group">Gestione contenuti</div>
        <div class="admin-nav-item" data-section="atleti-gestione" onclick="adminNav('atleti-gestione')">
          <span class="admin-nav-icon">🚴</span> Atleti
        </div>
        <div class="admin-nav-item" data-section="gare-gestione" onclick="adminNav('gare-gestione')">
          <span class="admin-nav-icon">🏁</span> Gare / Risultati
        </div>

        <div class="admin-nav-group">Struttura sito</div>
        <div class="admin-nav-item" data-section="pannelli-ruolo" onclick="adminNav('pannelli-ruolo')">
          <span class="admin-nav-icon">👤</span> Pannelli per ruolo
        </div>
        <div class="admin-nav-item" data-section="page-gallery" onclick="adminNav('page-gallery')">
          <span class="admin-nav-icon">🗂️</span> Conformazione pagine
        </div>
      </aside>

      <!-- ── MAIN CONTENT ── -->
      <main class="admin-main" id="admin-main">
        <div class="admin-loading">Caricamento…</div>
      </main>
    </div>
  `);

  // Carica la sezione di default
  adminNav(_adminSection);
}

window.adminNav = async function(section) {
  _adminSection = section;

  // Aggiorna active nella sidebar
  document.querySelectorAll('.admin-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.section === section);
  });

  const main = document.getElementById('admin-main');
  if (!main) return;
  main.innerHTML = '<div class="admin-loading">Caricamento…</div>';

  switch (section) {

    // ── OVERVIEW ──────────────────────────────────────────────
    case 'overview': {
      main.innerHTML = `
        <div class="admin-page-header">
          <h1 class="admin-page-title">📊 Dashboard</h1>
          <p class="admin-page-sub">Benvenuto nel pannello di gestione ItaliacritResultati.</p>
        </div>
        <div class="admin-overview-grid">
          <div class="admin-stat-card" onclick="adminNav('foto-pending')" style="cursor:pointer">
            <div class="admin-stat-icon">📷</div>
            <div class="admin-stat-label">Foto in attesa</div>
            <div class="admin-stat-value" id="ov-foto-pending">—</div>
          </div>
          <div class="admin-stat-card" onclick="adminNav('foto-xpix')" style="cursor:pointer">
            <div class="admin-stat-icon" style="color:#0ea5e9">◈</div>
            <div class="admin-stat-label">xpix in coda</div>
            <div class="admin-stat-value" id="ov-xpix">—</div>
          </div>
          <div class="admin-stat-card" onclick="adminNav('video-pending')" style="cursor:pointer">
            <div class="admin-stat-icon">🎬</div>
            <div class="admin-stat-label">Video in attesa</div>
            <div class="admin-stat-value" id="ov-video-pending">—</div>
          </div>
          <div class="admin-stat-card" onclick="adminNav('video-yt')" style="cursor:pointer">
            <div class="admin-stat-icon" style="color:#ef4444">▶</div>
            <div class="admin-stat-label">YouTube in coda</div>
            <div class="admin-stat-value" id="ov-yt">—</div>
          </div>
          <div class="admin-stat-card" onclick="adminNav('utenti-pending')" style="cursor:pointer">
            <div class="admin-stat-icon">📥</div>
            <div class="admin-stat-label">Profili in attesa</div>
            <div class="admin-stat-value" id="ov-profili-pending">—</div>
          </div>
          <div class="admin-stat-card" onclick="adminNav('utenti-lista')" style="cursor:pointer">
            <div class="admin-stat-icon">👥</div>
            <div class="admin-stat-label">Utenti registrati</div>
            <div class="admin-stat-value" id="ov-utenti">—</div>
          </div>
        </div>`;
      // Carica i contatori
      try {
        const [photos, xpixQ, vidPend, ytQ, pendProf, usersD] = await Promise.all([
          apiCall('/admin/race-photos/pending').catch(()=>({photos:[]})),
          apiCall('/admin/xpix/queue').catch(()=>({queue:[]})),
          apiCall('/admin/videos/pending').catch(()=>({videos:[]})),
          apiCall('/admin/yt/queue').catch(()=>({queue:[]})),
          fetch(`${API_BASE}/admin/pending`, { headers: { Authorization: `Bearer ${authToken()}` } }).then(r=>r.json()).catch(()=>({pending:[]})),
          fetch(`${API_BASE}/admin/users`,   { headers: { Authorization: `Bearer ${authToken()}` } }).then(r=>r.json()).catch(()=>({users:[]})),
        ]);
        const setPending = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
        const fotoPend    = (photos.photos||[]).length;
        const xpixPend    = (xpixQ.queue||[]).filter(q=>q.status==='pending').length;
        const vidPend2    = (vidPend.videos||[]).length;
        const ytPend      = (ytQ.queue||[]).filter(q=>q.status==='pending').length;
        const profPend    = (pendProf.pending||[]).length;
        const utentiCount = (usersD.users||[]).length;
        setPending('ov-foto-pending', fotoPend);
        setPending('ov-xpix', xpixPend);
        setPending('ov-video-pending', vidPend2);
        setPending('ov-yt', ytPend);
        setPending('ov-profili-pending', profPend);
        setPending('ov-utenti', utentiCount);
        // Aggiorna badge sidebar
        const setBadge = (id, n) => { const el = document.getElementById(id); if (el) { el.textContent = n > 0 ? n : ''; el.style.display = n > 0 ? '' : 'none'; } };
        setBadge('badge-foto-pending', fotoPend);
        setBadge('badge-xpix', xpixPend);
        setBadge('badge-video-pending', vidPend2);
        setBadge('badge-yt', ytPend);
        setBadge('badge-profili-pending', profPend);
      } catch(e) { /* ignora */ }

      // Sezione account di prova
      main.innerHTML += `
        <div style="margin-top:28px;padding:18px 20px;border:1px solid var(--border-subtle);border-radius:10px;background:var(--bg-elevated)">
          <div style="font-family:var(--font-display);font-weight:800;font-size:1rem;margin-bottom:6px">🧪 Account di prova</div>
          <p style="font-size:.82rem;color:var(--text-muted);margin:0 0 12px;line-height:1.5">Crea 7 account di prova (atleta, team, media-foto, media-video, genitore, parente, appassionato) con profili già collegati e approvati. Se esistono già, non vengono ricreati.</p>
          <button class="dash-btn dash-btn--outline" id="seed-test-btn" onclick="window.seedTestAccounts()">Crea account di prova</button>
          <div id="seed-test-result" style="margin-top:12px;font-size:.82rem"></div>
        </div>`;
      break;
    }

    // ── SYNC ──────────────────────────────────────────────────
    case 'sync': {
      main.innerHTML = `
        <div class="admin-page-header">
          <h1 class="admin-page-title">🔄 Sincronizza dati</h1>
          <p class="admin-page-sub">Ricalcola classifiche, punti e aggiorna i dati dal CSV.</p>
        </div>
        <div class="admin-action-card">
          <div style="font-size:.9rem;color:var(--text-secondary);margin-bottom:16px">
            Avvia la sincronizzazione completa: scarica il CSV FCI, ricalcola i punti e aggiorna tutte le classifiche.
          </div>
          <button class="btn-action" onclick="triggerSync()" id="btn-sync" style="background:var(--accent);color:white;border:none;font-size:1rem;padding:12px 28px">
            🔄 SINCRONIZZA &amp; RICALCOLA
          </button>
          <div id="sync-status-msg" style="margin-top:12px;font-size:.85rem;color:var(--text-muted)"></div>
        </div>`;
      break;
    }

    // ── FOTO IN ATTESA ────────────────────────────────────────
    case 'foto-pending': {
      main.innerHTML = `
        <div class="admin-page-header">
          <h1 class="admin-page-title">📥 Foto in attesa di approvazione</h1>
          <p class="admin-page-sub">Foto caricate dagli utenti — approva o rifiuta.</p>
        </div>
        <div id="admin-photos-pending"><div class="admin-loading">Caricamento…</div></div>`;
      loadPendingRacePhotos();
      break;
    }

    // ── XPIX ─────────────────────────────────────────────────
    case 'foto-xpix': {
      main.innerHTML = `
        <div class="admin-page-header">
          <h1 class="admin-page-title" style="color:#0ea5e9">◈ xpix Auto-Sync</h1>
          <p class="admin-page-sub">Foto watermarked da xpix.it — sincronizza, seleziona e pubblica.</p>
        </div>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:20px;flex-wrap:wrap">
          <button onclick="window.xpixSync()" id="xpix-sync-btn"
            style="background:#0ea5e9;color:#fff;border:none;padding:10px 22px;border-radius:6px;font-weight:700;cursor:pointer;font-size:.875rem">
            🔄 Sincronizza xpix
          </button>
          <span id="xpix-sync-status" style="font-size:.8rem;color:var(--text-muted)"></span>
        </div>
        <div id="xpix-queue-container">
          <div class="admin-loading">Caricamento coda…</div>
        </div>`;
      loadXpixQueue();
      break;
    }

    // ── VIDEO IN ATTESA ───────────────────────────────────────
    case 'video-pending': {
      main.innerHTML = `
        <div class="admin-page-header">
          <h1 class="admin-page-title">📥 Video in attesa di approvazione</h1>
          <p class="admin-page-sub">Video proposti dagli utenti — approva o rifiuta.</p>
        </div>
        <div id="admin-videos-pending"><div class="admin-loading">Caricamento…</div></div>`;
      loadAdminPendingVideos();
      break;
    }

    // ── YOUTUBE AUTO-SYNC ─────────────────────────────────────
    case 'video-yt': {
      main.innerHTML = `
        <div class="admin-page-header">
          <h1 class="admin-page-title" style="color:#ef4444">▶ YouTube Auto-Sync</h1>
          <p class="admin-page-sub">Video dai canali YouTube configurati — sincronizza e abbina alle gare.</p>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
          <button onclick="window.ytSync()" id="yt-sync-btn"
            style="background:#ef4444;color:#fff;border:none;padding:10px 22px;border-radius:6px;font-weight:700;cursor:pointer;font-size:.875rem">
            🔄 Sincronizza Canali
          </button>
          <button onclick="window.ytShowChannels()" id="yt-channels-btn"
            style="background:var(--bg-card);border:1px solid var(--border);color:var(--text-primary);padding:10px 18px;border-radius:6px;cursor:pointer;font-size:.875rem">
            ⚙️ Gestisci Canali
          </button>
          <span id="yt-sync-status" style="font-size:.8rem;color:var(--text-muted)"></span>
        </div>
        <div id="yt-channels-panel" style="display:none;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px">
          <div style="font-weight:700;font-size:.875rem;margin-bottom:10px">Canali YouTube configurati</div>
          <div id="yt-channels-list"></div>
          <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
            <button onclick="window.ytAddChannel()" style="background:var(--accent);color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-size:.8rem">+ Aggiungi canale</button>
            <button onclick="window.ytSaveChannels()" style="background:#16a34a;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-size:.8rem">💾 Salva</button>
          </div>
        </div>
        <div id="yt-queue-container">
          <div class="admin-loading">Caricamento coda…</div>
        </div>`;
      loadYTQueue();
      break;
    }

    // ── TUTTI I VIDEO ─────────────────────────────────────────
    case 'video-tutti': {
      main.innerHTML = `
        <div class="admin-page-header">
          <h1 class="admin-page-title">🎥 Gestione video approvati</h1>
          <p class="admin-page-sub">Visualizza, modifica ed elimina tutti i video pubblicati.</p>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;align-items:center">
          <button class="btn-action" onclick="window.adminShowAddVideo()" style="background:var(--accent);color:white;border:none;padding:9px 18px;border-radius:6px;font-size:.875rem">+ Aggiungi video</button>
          <input type="search" id="admin-video-search" placeholder="Filtra per nome gara…" oninput="window.adminFilterVideos(this.value)"
            style="padding:9px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text-primary);font-size:.875rem;flex:1;min-width:180px" />
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
            <input type="url" id="avf-url" placeholder="URL YouTube (https://www.youtube.com/watch?v=...)" oninput="window.adminUrlOembed(this.value)"
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
        <div id="admin-videos-all"><div class="admin-loading">Caricamento…</div></div>`;
      loadAdminAllVideos();
      break;
    }

    case 'foto-tutti': {
      main.innerHTML = `
        <div class="admin-page-header">
          <h1 class="admin-page-title">🖼️ Tutte le foto</h1>
          <p class="admin-page-sub">Archivio completo foto approvate — caricate dagli utenti, xpix.it e italiaciclismo.net.</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">
          <button id="foto-tutti-tab-up"   onclick="adminFotoTuttiTab('uploaded')"   style="padding:7px 16px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:#fff;font-weight:700;cursor:pointer;font-size:.82rem">📤 Caricate</button>
          <button id="foto-tutti-tab-xpix" onclick="adminFotoTuttiTab('xpix')"      style="padding:7px 16px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text-secondary);cursor:pointer;font-size:.82rem">📸 xpix.it</button>
        </div>
        <div id="foto-tutti-body"><div class="admin-loading">Caricamento…</div></div>`;
      window._adminFotoTuttiCache = {};
      window.adminFotoTuttiTab = async (tab) => {
        ['uploaded','xpix'].forEach(t => {
          const btn = document.getElementById('foto-tutti-tab-' + t);
          if (!btn) return;
          if (t === tab) { btn.style.background = 'var(--accent)'; btn.style.color = '#fff'; btn.style.borderColor = 'var(--accent)'; btn.style.fontWeight = '700'; }
          else           { btn.style.background = 'transparent'; btn.style.color = 'var(--text-secondary)'; btn.style.borderColor = 'var(--border)'; btn.style.fontWeight = '400'; }
        });
        const body = document.getElementById('foto-tutti-body');
        if (!body) return;
        if (window._adminFotoTuttiCache[tab]) { body.innerHTML = window._adminFotoTuttiCache[tab]; return; }
        body.innerHTML = `<div class="admin-loading">Caricamento…</div>`;
        try {
          const token = authToken();
          let photos = [];
          if (tab === 'uploaded') {
            const d = await fetch(`${API_BASE}/race-photos`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
            photos = (d.photos || []).map(p => ({
              src: `${PHOTOS_BASE}/photos/${esc(p.filename)}`,
              gara_id: p.gara_id, credit: p.photographer || p.display_name || '',
              caption: p.caption || '', source: 'uploaded', id: p.id,
              date: (p.created_at||'').slice(0,10),
            }));
          } else if (tab === 'xpix') {
            const d = await fetch(`${API_BASE}/xpix-photos`).then(r => r.json());
            photos = (d.photos || []).map(p => ({
              src: p.url, gara_id: p.gara_id, credit: 'xpix.it',
              caption: p.album_name || '', source: 'xpix', id: null,
              date: (p.approved_at||'').slice(0,10),
            }));
          } else {
            const d = await fetch(`${API_BASE}/ic-photos`).then(r => r.json());
            photos = (d.photos || []).map(p => ({
              src: p.url, gara_id: p.gara_id, credit: 'italiaciclismo.net',
              caption: '', source: 'ic', id: null,
              date: (p.approved_at||'').slice(0,10),
            }));
          }
          if (!photos.length) {
            const html = `<div style="color:var(--text-muted);padding:24px 0">Nessuna foto in questa categoria.</div>`;
            window._adminFotoTuttiCache[tab] = html;
            body.innerHTML = html;
            return;
          }
          const html = `
            <div style="margin-bottom:10px;font-size:.8rem;color:var(--text-muted)">${photos.length} foto</div>
            <div class="admin-photo-grid">${photos.map(p => `
              <div class="admin-photo-card">
                <img src="${p.src}" alt="${esc(p.caption||'foto')}" onclick="window.adminOpenLightbox('${p.src}')" style="cursor:zoom-in" loading="lazy" />
                <div class="admin-photo-card-body">
                  <div class="admin-photo-meta">
                    <a href="#/gara/${encodeURIComponent(p.gara_id)}" style="color:var(--accent);font-weight:600;font-size:0.78rem">${esc(p.gara_id)}</a>
                    <span style="font-size:.75rem;color:var(--text-muted)">${p.date}</span>
                    ${p.credit ? `<span style="font-size:.78rem">📷 ${esc(p.credit)}</span>` : ''}
                    ${p.caption ? `<span style="font-size:.75rem;font-style:italic;color:var(--text-muted)">${esc(p.caption)}</span>` : ''}
                  </div>
                  ${p.source === 'uploaded' && p.id ? `
                  <div class="admin-photo-actions">
                    <button class="btn-approve" onclick="window.adminPanelEditPhoto(${p.id},'${esc(p.caption||'')}','${esc(p.credit||'')}')">✏️</button>
                    <button class="btn-reject"  onclick="window.adminPanelDeletePhoto(${p.id})">🗑</button>
                  </div>` : ''}
                </div>
              </div>
            `).join('')}</div>`;
          window._adminFotoTuttiCache[tab] = html;
          body.innerHTML = html;
        } catch(e) {
          body.innerHTML = `<div style="color:var(--red-hot);padding:20px 0">Errore: ${esc(e.message)}</div>`;
        }
      };
      window.adminFotoTuttiTab('uploaded');
      break;
    }

    case 'utenti-lista': {
      const ROLES_ALL = ['atleta','team','genitore','parente','appassionato','media','admin'];
      const roleColor = r => ({'admin':'#e8001d','atleta':'#3b82f6','team':'#8b5cf6','media':'#0ea5e9','genitore':'#22c55e','parente':'#f59e0b','appassionato':'#64748b'}[r]||'#64748b');
      main.innerHTML = `
        <div class="admin-page-header">
          <h1 class="admin-page-title">👥 Gestione utenti</h1>
          <p class="admin-page-sub">Visualizza, modifica ruolo ed elimina gli account registrati.</p>
        </div>
        <div style="display:flex;gap:10px;margin-bottom:14px;align-items:center;flex-wrap:wrap">
          <input type="search" id="utenti-search" placeholder="Cerca per email o nome…" oninput="window.adminFilterUtenti(this.value)"
            style="padding:9px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text-primary);font-size:.875rem;flex:1;min-width:180px" />
          <select id="utenti-role-filter" onchange="window.adminFilterUtenti(document.getElementById('utenti-search').value)"
            style="padding:9px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text-primary);font-size:.875rem">
            <option value="">Tutti i ruoli</option>
            ${ROLES_ALL.map(r=>`<option value="${r}">${r}</option>`).join('')}
          </select>
        </div>
        <div id="admin-utenti-msg" style="display:none;padding:8px 14px;border-radius:6px;margin-bottom:10px;font-size:.85rem"></div>
        <div id="admin-utenti-body"><div class="admin-loading">Caricamento…</div></div>`;
      (async () => {
        const body = document.getElementById('admin-utenti-body');
        if (!body) return;
        try {
          const d = await fetch(`${API_BASE}/admin/users`, { headers: { Authorization: `Bearer ${authToken()}` } }).then(r => r.json());
          const users = d.users || [];
          window._adminUtentiAll = users;

          window.adminFilterUtenti = (q) => {
            const rf = (document.getElementById('utenti-role-filter')?.value)||'';
            let list = users;
            if (q) list = list.filter(u => (u.email||'').toLowerCase().includes(q.toLowerCase()) || (u.display_name||'').toLowerCase().includes(q.toLowerCase()));
            if (rf) list = list.filter(u => (u.role||'') === rf);
            window._adminRenderUtenti(list);
          };

          window._adminShowMsg = (msg, ok) => {
            const el = document.getElementById('admin-utenti-msg');
            if (!el) return;
            el.textContent = msg;
            el.style.display = 'block';
            el.style.background = ok ? 'rgba(34,197,94,.12)' : 'rgba(239,68,68,.12)';
            el.style.color = ok ? '#22c55e' : '#ef4444';
            setTimeout(() => { if (el) el.style.display = 'none'; }, 3500);
          };

          window.adminChangeRole = async (userId, newRole) => {
            try {
              const res = await _adminUserReq(userId, {
                method: 'PATCH',
                headers: { 'Content-Type':'application/json', Authorization:`Bearer ${authToken()}` },
                body: JSON.stringify({ role: newRole }),
              });
              if (!res.ok) throw new Error(await _resErr(res));
              const u = window._adminUtentiAll.find(x => x.id === userId);
              if (u) u.role = newRole;
              window._adminShowMsg(`✅ Ruolo di ${u?.email||userId} aggiornato a "${newRole}"`, true);
              window.adminFilterUtenti(document.getElementById('utenti-search')?.value||'');
            } catch(e) {
              window._adminShowMsg(`❌ Errore: ${e.message}`, false);
            }
          };

          window.adminDeleteUser = async (userId, email) => {
            if (!confirm(`Eliminare definitivamente l'utente "${email}"?\nQuesta operazione non può essere annullata.`)) return;
            try {
              const res = await fetch(`${API_BASE}/admin/users/${userId}`, {
                method: 'DELETE',
                headers: { Authorization:`Bearer ${authToken()}` },
              });
              if (!res.ok) throw new Error(await _resErr(res));
              window._adminUtentiAll = window._adminUtentiAll.filter(u => u.id !== userId);
              window._adminShowMsg(`✅ Utente "${email}" eliminato`, true);
              window.adminFilterUtenti(document.getElementById('utenti-search')?.value||'');
            } catch(e) {
              window._adminShowMsg(`❌ Errore eliminazione: ${e.message}`, false);
            }
          };

          window.adminViewUserProfile = (userId) => {
            const u = window._adminUtentiAll.find(x => x.id === userId);
            if (!u) return;
            const panel = document.getElementById('admin-user-detail');
            if (panel) panel.remove();
            const linked = u.linked_atleta_id || u.atleta_id || u.team_id || '';
            document.body.insertAdjacentHTML('beforeend', `
              <div id="admin-user-detail" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px" onclick="if(event.target===this)this.remove()">
                <div style="background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:14px;padding:28px 32px;max-width:480px;width:100%;max-height:85vh;overflow-y:auto" onclick="event.stopPropagation()">
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
                    <h3 style="font-family:var(--font-display);font-weight:800;font-size:1.1rem;margin:0">Dettaglio utente</h3>
                    <button onclick="document.getElementById('admin-user-detail').remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--text-muted)">✕</button>
                  </div>
                  <div style="display:flex;flex-direction:column;gap:10px;font-size:.88rem">
                    <div style="display:flex;gap:8px"><span style="color:var(--text-muted);min-width:110px">ID</span><span>${esc(String(u.id))}</span></div>
                    <div style="display:flex;gap:8px"><span style="color:var(--text-muted);min-width:110px">Email</span><strong>${esc(u.email||'—')}</strong></div>
                    <div style="display:flex;gap:8px"><span style="color:var(--text-muted);min-width:110px">Nome</span><span>${esc(u.display_name||'—')}</span></div>
                    <div style="display:flex;gap:8px"><span style="color:var(--text-muted);min-width:110px">Ruolo</span>
                      <select onchange="window.adminChangeRole(${u.id},this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:5px;background:var(--bg-base);color:var(--text-primary);font-size:.85rem">
                        ${ROLES_ALL.map(r=>`<option value="${r}" ${r===u.role?'selected':''}>${r}</option>`).join('')}
                      </select>
                    </div>
                    <div style="display:flex;gap:8px"><span style="color:var(--text-muted);min-width:110px">Registrato</span><span>${(u.created_at||'—').toString().slice(0,10)}</span></div>
                    <div style="display:flex;gap:8px"><span style="color:var(--text-muted);min-width:110px">Ultimo accesso</span><span>${(u.last_login||'—').toString().slice(0,10)}</span></div>
                    ${linked ? `<div style="display:flex;gap:8px"><span style="color:var(--text-muted);min-width:110px">Profilo collegato</span><a href="#/atleta/${esc(String(linked))}" onclick="document.getElementById('admin-user-detail').remove()" style="color:var(--accent)">${esc(String(linked))}</a></div>` : ''}
                  </div>
                  <div style="margin-top:20px;display:flex;gap:10px">
                    ${u.role==='atleta'&&linked ? `<a href="#/atleta/${esc(String(linked))}" onclick="document.getElementById('admin-user-detail').remove()" class="dash-btn dash-btn--outline dash-btn--sm">🚴 Vai al profilo atleta</a>` : ''}
                    <button onclick="window.adminDeleteUser(${u.id},'${esc(u.email||'')}');document.getElementById('admin-user-detail').remove()" class="dash-btn dash-btn--danger dash-btn--sm">🗑 Elimina utente</button>
                  </div>
                </div>
              </div>`);
          };

          window._adminRenderUtenti = (list) => {
            const b = document.getElementById('admin-utenti-body');
            if (!b) return;
            if (!list.length) { b.innerHTML = `<div style="color:var(--text-muted);padding:24px 0">Nessun utente trovato.</div>`; return; }
            b.innerHTML = `
              <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:8px">${list.length} utenti</div>
              <div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;font-size:.83rem">
                <thead>
                  <tr style="border-bottom:2px solid var(--border)">
                    <th style="text-align:left;padding:8px 10px;color:var(--text-muted);font-weight:600">Email</th>
                    <th style="text-align:left;padding:8px 10px;color:var(--text-muted);font-weight:600">Nome</th>
                    <th style="text-align:left;padding:8px 10px;color:var(--text-muted);font-weight:600">Ruolo</th>
                    <th style="text-align:left;padding:8px 10px;color:var(--text-muted);font-weight:600">Registrato</th>
                    <th style="text-align:left;padding:8px 10px;color:var(--text-muted);font-weight:600">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  ${list.map(u => `
                    <tr style="border-bottom:1px solid var(--border);transition:background .15s" onmouseover="this.style.background='var(--bg-elevated)'" onmouseout="this.style.background=''">
                      <td style="padding:9px 10px">${esc(u.email||'')}</td>
                      <td style="padding:9px 10px;font-weight:600">${esc(u.display_name||'—')}</td>
                      <td style="padding:9px 10px">
                        <select onchange="window.adminChangeRole(${u.id},this.value)"
                          style="padding:3px 7px;border:1px solid var(--border);border-radius:5px;background:var(--bg-base);color:${roleColor(u.role)};font-size:.78rem;font-weight:700;cursor:pointer">
                          ${ROLES_ALL.map(r=>`<option value="${r}" ${r===u.role?'selected':''}>${r}</option>`).join('')}
                        </select>
                      </td>
                      <td style="padding:9px 10px;color:var(--text-muted)">${(u.created_at||'').slice(0,10)}</td>
                      <td style="padding:9px 10px">
                        <div style="display:flex;gap:6px">
                          <button onclick="window.adminViewUserProfile(${u.id})" title="Dettaglio" style="padding:5px 10px;border:1px solid var(--border);border-radius:5px;background:transparent;color:var(--text-muted);cursor:pointer;font-size:.78rem">👁 Dettaglio</button>
                          <button onclick="window.adminDeleteUser(${u.id},'${esc((u.email||'').replace(/'/g,''))}',)" title="Elimina" style="padding:5px 8px;border:1px solid rgba(239,68,68,.4);border-radius:5px;background:transparent;color:#ef4444;cursor:pointer;font-size:.78rem">🗑</button>
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
              </div>`;
          };
          window._adminRenderUtenti(users);
        } catch(e) {
          if (body) body.innerHTML = `<div style="color:var(--red-hot);padding:20px 0">Errore: ${esc(e.message)}</div>`;
        }
      })();
      break;
    }

    case 'utenti-pending': {
      main.innerHTML = `
        <div class="admin-page-header">
          <h1 class="admin-page-title">📥 Profili in attesa</h1>
          <p class="admin-page-sub">Richieste di collegamento atleta, team o familiare in attesa di approvazione.</p>
        </div>
        <div id="admin-pending-body"><div class="admin-loading">Caricamento…</div></div>`;
      (async () => {
        const body = document.getElementById('admin-pending-body');
        if (!body) return;
        const loadPending = async () => {
          body.innerHTML = `<div class="admin-loading">Caricamento…</div>`;
          try {
            const d = await fetch(`${API_BASE}/admin/pending`, { headers: { Authorization: `Bearer ${authToken()}` } }).then(r => r.json());
            const pending = d.pending || [];
            const badge = document.getElementById('badge-profili-pending');
            if (badge) badge.textContent = pending.length || '';
            if (!pending.length) {
              body.innerHTML = `<div style="color:var(--text-muted);padding:24px 0">✅ Nessun profilo in attesa di approvazione.</div>`;
              return;
            }
            const typeLabel = { athlete: '🏅 Atleta', team: '🚴 Team', family: '👨‍👩‍👦 Familiare' };
            body.innerHTML = `
              <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:14px">${pending.length} richiesta${pending.length !== 1 ? 'e' : ''} in attesa</div>
              <div style="display:flex;flex-direction:column;gap:12px">
              ${pending.map(p => `
                <div id="pending-card-${p.type}-${p.id}" style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
                  <div style="flex:1;min-width:200px">
                    <div style="font-weight:700;font-size:.9rem;margin-bottom:4px">
                      <span style="padding:2px 8px;border-radius:10px;font-size:.72rem;font-weight:700;background:var(--bg-elevated);color:var(--text-muted);margin-right:8px">${typeLabel[p.type]||p.type}</span>
                      ${esc(p.name||'—')}
                    </div>
                    <div style="font-size:.78rem;color:var(--text-muted)">
                      <span>${esc(p.email||'')}</span>
                      ${p.fci_code ? `<span style="margin-left:10px">FCI: ${esc(p.fci_code)}</span>` : ''}
                      ${p.atleta_id ? `<span style="margin-left:10px">→ atleta #${esc(String(p.atleta_id))}</span>` : ''}
                      <span style="margin-left:10px">${(p.created_at||'').slice(0,10)}</span>
                    </div>
                  </div>
                  <div style="display:flex;gap:8px">
                    <button class="btn-approve" onclick="window.adminPendingAction('${p.type}',${p.id},'approve')" style="padding:7px 16px;font-size:.82rem">✓ Approva</button>
                    <button class="btn-reject"  onclick="window.adminPendingAction('${p.type}',${p.id},'reject')"  style="padding:7px 14px;font-size:.82rem">✗ Rifiuta</button>
                  </div>
                </div>
              `).join('')}
              </div>`;
          } catch(e) {
            body.innerHTML = `<div style="color:var(--red-hot);padding:20px 0">Errore: ${esc(e.message)}</div>`;
          }
        };
        window.adminPendingAction = async (type, id, action) => {
          const card = document.getElementById(`pending-card-${type}-${id}`);
          if (card) { card.style.opacity = '.4'; card.style.pointerEvents = 'none'; }
          try {
            const res = await fetch(`${API_BASE}/admin/${action}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken()}` },
              body: JSON.stringify({ type, id }),
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Errore');
            await loadPending();
          } catch(e) {
            if (card) { card.style.opacity = ''; card.style.pointerEvents = ''; }
            alert('Errore: ' + e.message);
          }
        };
        await loadPending();
      })();
      break;
    }

    case 'media-profiles': {
      main.innerHTML = `
        <div class="admin-page-header">
          <h1 class="admin-page-title">📷 Profili Media / Fotografi</h1>
          <p class="admin-page-sub">Tutti i profili fotografo registrati sulla piattaforma.</p>
        </div>
        <div id="admin-media-profiles-body"><div class="admin-loading">Caricamento…</div></div>`;
      (async () => {
        const body = document.getElementById('admin-media-profiles-body');
        if (!body) return;
        try {
          const d = await fetch(`${API_BASE}/media/profiles`).then(r => r.json());
          const profiles = d.profiles || [];
          if (!profiles.length) { body.innerHTML = `<div style="color:var(--text-muted);padding:24px 0">Nessun profilo media approvato.</div>`; return; }
          body.innerHTML = `
            <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:12px">${profiles.length} profili approvati</div>
            <div style="display:flex;flex-direction:column;gap:10px">
            ${profiles.map(p => `
              <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
                <div style="font-size:1.5rem">📷</div>
                <div style="flex:1;min-width:160px">
                  <a href="#/media/${p.id}" style="font-weight:700;color:var(--accent)">${esc(p.display_name)}</a>
                  ${p.bio ? `<div style="font-size:.78rem;color:var(--text-muted);margin-top:2px">${esc(p.bio)}</div>` : ''}
                  <div style="font-size:.72rem;color:var(--text-muted);margin-top:2px">${(p.created_at||'').slice(0,10)}</div>
                </div>
                <div style="display:flex;gap:8px">
                  ${p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noopener" style="font-size:.78rem;color:var(--accent)">🌐</a>` : ''}
                  ${p.instagram ? `<a href="https://instagram.com/${esc(p.instagram.replace('@',''))}" target="_blank" rel="noopener" style="font-size:.78rem;color:var(--accent)">📸</a>` : ''}
                </div>
              </div>`).join('')}
            </div>`;
        } catch(e) {
          body.innerHTML = `<div style="color:var(--red-hot);padding:20px 0">Errore: ${esc(e.message)}</div>`;
        }
      })();
      break;
    }

    case 'media-seed': {
      main.innerHTML = `
        <div class="admin-page-header">
          <h1 class="admin-page-title">🌱 Seed xpix → Media Albums</h1>
          <p class="admin-page-sub">Importa le foto xpix già approvate come album del profilo "xpix.it".</p>
        </div>
        <div class="admin-action-card">
          <div style="font-size:.9rem;color:var(--text-secondary);margin-bottom:16px;line-height:1.6">
            <p style="margin:0 0 8px">Questa operazione:</p>
            <ul style="margin:0;padding-left:20px;font-size:.85rem;color:var(--text-muted)">
              <li>Crea (o trova) un profilo media "xpix.it" di sistema</li>
              <li>Per ogni foto xpix approvata, crea un album collegato alla gara</li>
              <li>Popola ogni album con tutte le foto dalla coda xpix</li>
              <li>Salta gli album già presenti (idempotente)</li>
            </ul>
          </div>
          <button id="seed-xpix-btn" onclick="window.adminSeedXpix()" style="background:#0ea5e9;color:#fff;border:none;padding:11px 24px;border-radius:6px;font-weight:700;cursor:pointer;font-size:.9rem">
            🌱 Avvia importazione xpix
          </button>
          <div id="seed-xpix-status" style="margin-top:14px;font-size:.85rem;color:var(--text-muted)"></div>
        </div>`;
      window.adminSeedXpix = async () => {
        const btn  = document.getElementById('seed-xpix-btn');
        const stat = document.getElementById('seed-xpix-status');
        btn.disabled = true; btn.textContent = '⏳ Importazione in corso…';
        stat.textContent = '';
        try {
          const d = await fetch(`${API_BASE}/admin/media/seed-xpix`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${authToken()}` },
          }).then(r => r.json());
          if (d.error) throw new Error(d.error);
          stat.innerHTML = `✅ Importazione completata — <strong>${d.created}</strong> album creati, ${d.skipped} già presenti.<br>
            Profilo xpix.it: <a href="#/media/${d.profile_id}" style="color:var(--accent)">#/media/${d.profile_id}</a>`;
          btn.textContent = '✓ Completato';
          _mediaProfilesCache = null; // invalida cache ricerca
        } catch(e) {
          stat.innerHTML = `<span style="color:var(--red-hot)">Errore: ${esc(e.message)}</span>`;
          btn.disabled = false; btn.textContent = '🌱 Avvia importazione xpix';
        }
      };
      break;
    }

    case 'pannelli-ruolo': {
      // Visual map of what each role sees in their dashboard
      const ROLE_PANELS = [
        { role:'atleta', icon:'🚴', label:'Atleta', color:'#3b82f6', sections:[
          { name:'Hero (nome, email, badge ruolo)', type:'always' },
          { name:'Stato profilo + link profilo pubblico', type:'always' },
          { name:'Statistiche: gare, vittorie, podi', type:'active' },
          { name:'Posizioni in classifica (per categoria)', type:'active' },
          { name:'Ultimi 6 risultati personali', type:'active' },
          { name:'Prossime gare in calendario', type:'active' },
          { name:'Azioni rapide (classifiche, risultati, stats…)', type:'always' },
          { name:'Form collega profilo FCI', type:'noprofile' },
        ]},
        { role:'team', icon:'👥', label:'Team Manager', color:'#8b5cf6', sections:[
          { name:'Hero (nome, email, badge ruolo)', type:'always' },
          { name:'Stato profilo team + link pubblico', type:'always' },
          { name:'Statistiche: atleti, risultati, vittorie', type:'active' },
          { name:'Posizioni classifica team (per categoria)', type:'active' },
          { name:'Ultimi 6 risultati della squadra', type:'active' },
          { name:'Azioni rapide (class. team, atleti…)', type:'always' },
          { name:'Form collega team', type:'noprofile' },
        ]},
        { role:'genitore', icon:'👨‍👧', label:'Genitore', color:'#22c55e', sections:[
          { name:'Hero (nome, email, badge ruolo)', type:'always' },
          { name:'Schede atleti collegati (card per ognuno)', type:'active' },
          { name:'Per ogni atleta: pos. classifica + ultimi 3 risultati', type:'active' },
          { name:'Richieste collegamento in attesa', type:'pending' },
          { name:'Form aggiungi atleta (cerca per cognome)', type:'always' },
          { name:'Esplora rapido', type:'always' },
        ]},
        { role:'parente', icon:'❤️', label:'Parente / Tifoso', color:'#f59e0b', sections:[
          { name:'Come Genitore — stessa struttura', type:'always' },
          { name:'Card atleti seguiti con stats + risultati', type:'active' },
          { name:'Form aggiungi atleta', type:'always' },
        ]},
        { role:'appassionato', icon:'🏆', label:'Appassionato', color:'#64748b', sections:[
          { name:'Hero (nome, email, badge ruolo)', type:'always' },
          { name:'Watchlist (atleti aggiunti con ★)', type:'active' },
          { name:'Per ogni atleta in watchlist: pos. + ultima gara', type:'active' },
          { name:'Top risultati ultimi 30 giorni (podi)', type:'always' },
          { name:'Griglia esplora (7 sezioni del sito)', type:'always' },
          { name:'Messaggio "watchlist vuota" + link atleti', type:'empty' },
        ]},
        { role:'media', icon:'📷', label:'Media / Fotografo', color:'#0ea5e9', sections:[
          { name:'Hero (nome, email, badge ruolo)', type:'always' },
          { name:'Stato profilo + link profilo pubblico', type:'always' },
          { name:'Nome, bio, link social', type:'active' },
          { name:'Lista album con anteprime + contatori foto', type:'active' },
          { name:'Pulsante nuovo album', type:'active' },
          { name:'Azioni rapide (nuovo album, calendario…)', type:'active' },
          { name:'Form creazione profilo (nome, bio, social)', type:'noprofile' },
        ]},
        { role:'admin', icon:'⚙️', label:'Amministratore', color:'#e8001d', sections:[
          { name:'Hero (nome, email, badge ruolo)', type:'always' },
          { name:'Statistiche DB: risultati, gare, atleti, cal.', type:'always' },
          { name:'6 shortcut rapidi al pannello admin', type:'always' },
          { name:'Link diretto → Gestionale completo', type:'always' },
        ]},
      ];
      const typeTag = t => {
        const map = { always:'sempre visibile', active:'solo se profilo attivo', noprofile:'solo senza profilo', pending:'solo se ci sono richieste', empty:'solo se lista vuota' };
        const col = { always:'#22c55e', active:'#3b82f6', noprofile:'#f59e0b', pending:'#f59e0b', empty:'#64748b' };
        return `<span style="font-size:.65rem;padding:1px 6px;border-radius:10px;background:${col[t]||'#64748b'}22;color:${col[t]||'#64748b'};border:1px solid ${col[t]||'#64748b'}44;margin-left:6px;white-space:nowrap">${map[t]||t}</span>`;
      };
      main.innerHTML = `
        <div class="admin-page-header">
          <h1 class="admin-page-title">👤 Pannelli per ruolo</h1>
          <p class="admin-page-sub">Struttura del dashboard personale per ogni tipologia di utente registrato.</p>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:18px">
          ${ROLE_PANELS.map(p => `
            <div style="background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:12px;overflow:hidden">
              <div style="padding:14px 18px;border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;gap:10px;background:${p.color}14">
                <span style="font-size:1.3rem">${p.icon}</span>
                <span style="font-family:var(--font-display);font-weight:800;font-size:.95rem;color:${p.color}">${p.label}</span>
                <code style="margin-left:auto;font-size:.7rem;color:var(--text-muted);background:var(--bg-base);padding:2px 6px;border-radius:4px">${p.role}</code>
              </div>
              <div style="padding:14px 18px;display:flex;flex-direction:column;gap:5px">
                ${p.sections.map(s => `
                  <div style="display:flex;align-items:center;font-size:.8rem;color:var(--text-secondary);padding:3px 0;border-bottom:1px solid var(--border-subtle)">
                    <span style="width:6px;height:6px;border-radius:50%;background:${p.color};flex-shrink:0;margin-right:8px"></span>
                    <span style="flex:1">${s.name}</span>
                    ${typeTag(s.type)}
                  </div>`).join('')}
              </div>
            </div>`).join('')}
        </div>
        <div style="margin-top:24px;padding:14px 18px;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:10px;font-size:.8rem;color:var(--text-muted);line-height:1.8">
          <strong style="color:var(--text-primary)">Legenda stati:</strong>
          &nbsp;<span style="color:#22c55e">● sempre visibile</span> — mostrato a tutti gli utenti con quel ruolo
          &nbsp;<span style="color:#3b82f6">● solo se profilo attivo</span> — richiede profilo approvato collegato
          &nbsp;<span style="color:#f59e0b">● condizionale</span> — appare solo in certi scenari
          &nbsp;<span style="color:#64748b">● fallback</span> — mostrato quando la lista principale è vuota
        </div>`;
      break;
    }

    case 'atleti-gestione': {
      const res = globalData?.resultsRaw || [];
      // Aggregate unique athletes
      const atMap = {};
      res.forEach(r => {
        const aid = r.atleta_id;
        if (!aid) return;
        if (!atMap[aid]) atMap[aid] = { atleta_id:aid, cognome:r.cognome||'', nome:r.nome||'', team:r.team||'', gare:0, vittorie:0, podi:0, pts:0, lastGara:'' };
        atMap[aid].gare++;
        if (r.posizione===1||r.pos===1||r.pos==='1'||r.posizione==='1') atMap[aid].vittorie++;
        if ([1,2,3,'1','2','3'].includes(r.posizione||r.pos)) atMap[aid].podi++;
        atMap[aid].pts += (r.punti_effettivi||0);
        if ((r.data||'') > atMap[aid].lastGara) atMap[aid].lastGara = r.data||'';
      });
      const atletiList = Object.values(atMap).sort((a,b)=>(b.cognome||'').localeCompare(a.cognome||''));

      main.innerHTML = `
        <div class="admin-page-header">
          <h1 class="admin-page-title">🚴 Gestione atleti</h1>
          <p class="admin-page-sub">${atletiList.length} atleti nel database. Visualizza, modifica e gestisci i profili.</p>
        </div>
        <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
          <input type="search" id="atleti-search" placeholder="Cerca per cognome, nome o team…" oninput="window.adminFilterAtleti(this.value)"
            style="padding:9px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text-primary);font-size:.875rem;flex:1;min-width:200px" />
        </div>
        <div id="admin-atleti-msg" style="display:none;padding:8px 14px;border-radius:6px;margin-bottom:10px;font-size:.85rem"></div>
        <div id="admin-atleti-body"></div>`;

      window._adminAtletiAll = atletiList;
      window.adminFilterAtleti = (q) => {
        const ql = q.toLowerCase();
        const list = q ? atletiList.filter(a =>
          (a.cognome||'').toLowerCase().includes(ql) ||
          (a.nome||'').toLowerCase().includes(ql) ||
          (a.team||'').toLowerCase().includes(ql) ||
          (a.atleta_id||'').toString().toLowerCase().includes(ql)
        ) : atletiList;
        window._adminRenderAtleti(list.slice(0,100));
      };

      window._adminShowAtletiMsg = (msg, ok) => {
        const el = document.getElementById('admin-atleti-msg');
        if (!el) return;
        el.textContent = msg; el.style.display = 'block';
        el.style.background = ok ? 'rgba(34,197,94,.12)' : 'rgba(239,68,68,.12)';
        el.style.color = ok ? '#22c55e' : '#ef4444';
        setTimeout(() => { if (el) el.style.display = 'none'; }, 3000);
      };

      window.adminEditAtleta = (aid) => {
        const a = window._adminAtletiAll.find(x => x.atleta_id === aid);
        if (!a) return;
        document.getElementById('admin-atleta-modal')?.remove();
        document.body.insertAdjacentHTML('beforeend', `
          <div id="admin-atleta-modal" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px" onclick="if(event.target===this)this.remove()">
            <div style="background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:14px;padding:28px 32px;max-width:500px;width:100%" onclick="event.stopPropagation()">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
                <h3 style="font-family:var(--font-display);font-weight:800;font-size:1.05rem;margin:0">✏️ Modifica atleta</h3>
                <button onclick="document.getElementById('admin-atleta-modal').remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--text-muted)">✕</button>
              </div>
              <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:14px">ID: <code>${esc(String(a.atleta_id))}</code> · ${a.gare} gare · ${a.vittorie} vittorie</div>
              <div style="display:flex;flex-direction:column;gap:10px">
                <label style="font-size:.82rem;color:var(--text-muted)">Cognome
                  <input id="ae-cognome" value="${esc(a.cognome)}" style="display:block;width:100%;margin-top:4px;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-base);color:var(--text-primary);font-size:.9rem" />
                </label>
                <label style="font-size:.82rem;color:var(--text-muted)">Nome
                  <input id="ae-nome" value="${esc(a.nome)}" style="display:block;width:100%;margin-top:4px;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-base);color:var(--text-primary);font-size:.9rem" />
                </label>
                <label style="font-size:.82rem;color:var(--text-muted)">Team
                  <input id="ae-team" value="${esc(a.team)}" style="display:block;width:100%;margin-top:4px;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-base);color:var(--text-primary);font-size:.9rem" />
                </label>
              </div>
              <div style="margin-top:18px;display:flex;gap:10px;justify-content:flex-end">
                <button onclick="document.getElementById('admin-atleta-modal').remove()" class="dash-btn dash-btn--outline dash-btn--sm">Annulla</button>
                <button onclick="window.adminSaveAtleta('${esc(String(a.atleta_id))}')" class="dash-btn dash-btn--primary dash-btn--sm">💾 Salva modifiche</button>
              </div>
            </div>
          </div>`);
      };

      window.adminSaveAtleta = async (aid) => {
        const cognome = document.getElementById('ae-cognome')?.value.trim();
        const nome    = document.getElementById('ae-nome')?.value.trim();
        const team    = document.getElementById('ae-team')?.value.trim();
        document.getElementById('admin-atleta-modal')?.remove();
        try {
          const res = await fetch(`${API_BASE}/admin/atleti/${encodeURIComponent(aid)}`, {
            method: 'PATCH',
            headers: { 'Content-Type':'application/json', Authorization:`Bearer ${authToken()}` },
            body: JSON.stringify({ cognome, nome, team }),
          });
          if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
          // Update local cache
          const a = window._adminAtletiAll.find(x => String(x.atleta_id) === String(aid));
          if (a) { a.cognome = cognome||a.cognome; a.nome = nome||a.nome; a.team = team||a.team; }
          window._adminShowAtletiMsg(`✅ Atleta aggiornato`, true);
          window.adminFilterAtleti(document.getElementById('atleti-search')?.value||'');
        } catch(e) {
          window._adminShowAtletiMsg(`❌ Errore: ${e.message}`, false);
        }
      };

      window._adminRenderAtleti = (list) => {
        const b = document.getElementById('admin-atleti-body');
        if (!b) return;
        if (!list.length) { b.innerHTML = `<div style="color:var(--text-muted);padding:24px 0">Nessun atleta trovato.</div>`; return; }
        b.innerHTML = `
          <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:8px">${list.length} atleti (max 100 mostrati — usa la ricerca)</div>
          <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:.83rem">
            <thead>
              <tr style="border-bottom:2px solid var(--border)">
                <th style="text-align:left;padding:8px 10px;color:var(--text-muted);font-weight:600">Atleta</th>
                <th style="text-align:left;padding:8px 10px;color:var(--text-muted);font-weight:600">Team</th>
                <th style="text-align:right;padding:8px 10px;color:var(--text-muted);font-weight:600">Gare</th>
                <th style="text-align:right;padding:8px 10px;color:var(--text-muted);font-weight:600">Vittorie</th>
                <th style="text-align:right;padding:8px 10px;color:var(--text-muted);font-weight:600">Podi</th>
                <th style="text-align:left;padding:8px 10px;color:var(--text-muted);font-weight:600">Ultima gara</th>
                <th style="text-align:left;padding:8px 10px;color:var(--text-muted);font-weight:600">Azioni</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(a => `
                <tr style="border-bottom:1px solid var(--border);transition:background .15s" onmouseover="this.style.background='var(--bg-elevated)'" onmouseout="this.style.background=''">
                  <td style="padding:9px 10px">
                    <a href="#/atleta/${esc(String(a.atleta_id))}" style="font-weight:700;color:var(--accent);text-decoration:none">${esc(a.cognome)} ${esc(a.nome)}</a>
                    <div style="font-size:.7rem;color:var(--text-muted)">${esc(String(a.atleta_id))}</div>
                  </td>
                  <td style="padding:9px 10px;color:var(--text-secondary)">${esc(a.team||'—')}</td>
                  <td style="padding:9px 10px;text-align:right">${a.gare}</td>
                  <td style="padding:9px 10px;text-align:right;font-weight:${a.vittorie>0?'700':'400'};color:${a.vittorie>0?'var(--accent)':'var(--text-muted)'}">${a.vittorie}</td>
                  <td style="padding:9px 10px;text-align:right;color:var(--text-muted)">${a.podi}</td>
                  <td style="padding:9px 10px;color:var(--text-muted);font-size:.8rem">${(a.lastGara||'').slice(0,10)}</td>
                  <td style="padding:9px 10px">
                    <div style="display:flex;gap:6px">
                      <a href="#/atleta/${esc(String(a.atleta_id))}" title="Vai al profilo" style="padding:5px 8px;border:1px solid var(--border);border-radius:5px;background:transparent;color:var(--text-muted);cursor:pointer;font-size:.78rem;text-decoration:none">👁</a>
                      <button onclick="window.adminEditAtleta('${esc(String(a.atleta_id))}')" title="Modifica" style="padding:5px 8px;border:1px solid var(--border);border-radius:5px;background:transparent;color:var(--text-muted);cursor:pointer;font-size:.78rem">✏️</button>
                    </div>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
          </div>`;
      };
      window._adminRenderAtleti(atletiList.slice(0,100));
      break;
    }

    case 'gare-gestione': {
      const res = globalData?.resultsRaw || [];
      // Aggregate unique races
      const garaMap = {};
      res.forEach(r => {
        const gid = r.gara_id || r.gara_slug || r.gara;
        if (!gid) return;
        if (!garaMap[gid]) garaMap[gid] = {
          gara_id: gid, nome: r.gara||gid, data: r.data||'', cat: r.cat||r.categoria||'',
          tipo: r.tipo||'', km: r.km||'', media: r.media||'', n_atleti: 0
        };
        garaMap[gid].n_atleti++;
        if ((r.data||'') > garaMap[gid].data) garaMap[gid].data = r.data||'';
      });
      const gareList = Object.values(garaMap).sort((a,b)=>(b.data||'').localeCompare(a.data||''));

      main.innerHTML = `
        <div class="admin-page-header">
          <h1 class="admin-page-title">🏁 Gestione gare</h1>
          <p class="admin-page-sub">${gareList.length} gare nel database.</p>
        </div>
        <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
          <input type="search" id="gare-search" placeholder="Cerca per nome gara, categoria…" oninput="window.adminFilterGare(this.value)"
            style="padding:9px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text-primary);font-size:.875rem;flex:1;min-width:200px" />
          <select id="gare-year-filter" onchange="window.adminFilterGare(document.getElementById('gare-search').value)"
            style="padding:9px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text-primary);font-size:.875rem">
            <option value="">Tutti gli anni</option>
            ${[...new Set(gareList.map(g=>(g.data||'').slice(0,4)).filter(Boolean))].sort((a,b)=>b.localeCompare(a)).map(y=>`<option value="${y}">${y}</option>`).join('')}
          </select>
        </div>
        <div id="admin-gare-msg" style="display:none;padding:8px 14px;border-radius:6px;margin-bottom:10px;font-size:.85rem"></div>
        <div id="admin-gare-body"></div>`;

      window._adminGareAll = gareList;
      window.adminFilterGare = (q) => {
        const ql = q.toLowerCase();
        const yf = document.getElementById('gare-year-filter')?.value||'';
        let list = gareList;
        if (q) list = list.filter(g => (g.nome||'').toLowerCase().includes(ql) || (g.cat||'').toLowerCase().includes(ql) || (g.gara_id||'').toLowerCase().includes(ql));
        if (yf) list = list.filter(g => (g.data||'').startsWith(yf));
        window._adminRenderGare(list.slice(0,100));
      };

      window._adminShowGareMsg = (msg, ok) => {
        const el = document.getElementById('admin-gare-msg');
        if (!el) return;
        el.textContent = msg; el.style.display = 'block';
        el.style.background = ok ? 'rgba(34,197,94,.12)' : 'rgba(239,68,68,.12)';
        el.style.color = ok ? '#22c55e' : '#ef4444';
        setTimeout(() => { if (el) el.style.display = 'none'; }, 3000);
      };

      window.adminEditGara = (gid) => {
        const g = window._adminGareAll.find(x => x.gara_id === gid);
        if (!g) return;
        document.getElementById('admin-gara-modal')?.remove();
        document.body.insertAdjacentHTML('beforeend', `
          <div id="admin-gara-modal" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px" onclick="if(event.target===this)this.remove()">
            <div style="background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:14px;padding:28px 32px;max-width:520px;width:100%" onclick="event.stopPropagation()">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
                <h3 style="font-family:var(--font-display);font-weight:800;font-size:1.05rem;margin:0">✏️ Modifica gara</h3>
                <button onclick="document.getElementById('admin-gara-modal').remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--text-muted)">✕</button>
              </div>
              <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:14px">ID: <code>${esc(gid)}</code> · ${g.n_atleti} iscritti</div>
              <div style="display:flex;flex-direction:column;gap:10px">
                <label style="font-size:.82rem;color:var(--text-muted)">Nome gara
                  <input id="ge-nome" value="${esc(g.nome)}" style="display:block;width:100%;margin-top:4px;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-base);color:var(--text-primary);font-size:.9rem" />
                </label>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                  <label style="font-size:.82rem;color:var(--text-muted)">Data
                    <input id="ge-data" type="date" value="${esc(g.data||'')}" style="display:block;width:100%;margin-top:4px;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-base);color:var(--text-primary);font-size:.9rem" />
                  </label>
                  <label style="font-size:.82rem;color:var(--text-muted)">Categoria
                    <input id="ge-cat" value="${esc(g.cat||'')}" style="display:block;width:100%;margin-top:4px;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-base);color:var(--text-primary);font-size:.9rem" />
                  </label>
                  <label style="font-size:.82rem;color:var(--text-muted)">Km
                    <input id="ge-km" value="${esc(String(g.km||''))}" style="display:block;width:100%;margin-top:4px;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-base);color:var(--text-primary);font-size:.9rem" />
                  </label>
                  <label style="font-size:.82rem;color:var(--text-muted)">Media km/h
                    <input id="ge-media" value="${esc(String(g.media||''))}" style="display:block;width:100%;margin-top:4px;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-base);color:var(--text-primary);font-size:.9rem" />
                  </label>
                </div>
                <label style="font-size:.82rem;color:var(--text-muted)">Tipo
                  <input id="ge-tipo" value="${esc(g.tipo||'')}" placeholder="es. Criterium, Circuito, Road Race…" style="display:block;width:100%;margin-top:4px;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-base);color:var(--text-primary);font-size:.9rem" />
                </label>
              </div>
              <div style="margin-top:18px;display:flex;gap:10px;justify-content:flex-end">
                <button onclick="document.getElementById('admin-gara-modal').remove()" class="dash-btn dash-btn--outline dash-btn--sm">Annulla</button>
                <button onclick="window.adminSaveGara('${esc(gid)}')" class="dash-btn dash-btn--primary dash-btn--sm">💾 Salva</button>
              </div>
            </div>
          </div>`);
      };

      window.adminSaveGara = async (gid) => {
        const payload = {
          nome:  document.getElementById('ge-nome')?.value.trim(),
          data:  document.getElementById('ge-data')?.value,
          cat:   document.getElementById('ge-cat')?.value.trim(),
          km:    document.getElementById('ge-km')?.value.trim(),
          media: document.getElementById('ge-media')?.value.trim(),
          tipo:  document.getElementById('ge-tipo')?.value.trim(),
        };
        document.getElementById('admin-gara-modal')?.remove();
        try {
          const res = await fetch(`${API_BASE}/admin/gare/${encodeURIComponent(gid)}`, {
            method: 'PATCH',
            headers: { 'Content-Type':'application/json', Authorization:`Bearer ${authToken()}` },
            body: JSON.stringify(payload),
          });
          if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
          const g = window._adminGareAll.find(x => x.gara_id === gid);
          if (g) Object.assign(g, payload);
          window._adminShowGareMsg(`✅ Gara aggiornata`, true);
          window.adminFilterGare(document.getElementById('gare-search')?.value||'');
        } catch(e) {
          window._adminShowGareMsg(`❌ Errore: ${e.message}`, false);
        }
      };

      window.adminDeleteGara = async (gid, nome) => {
        if (!confirm(`Eliminare tutti i risultati della gara "${nome}"?\nQuesta operazione non può essere annullata.`)) return;
        try {
          const res = await fetch(`${API_BASE}/admin/gare/${encodeURIComponent(gid)}`, {
            method: 'DELETE',
            headers: { Authorization:`Bearer ${authToken()}` },
          });
          if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
          window._adminGareAll = window._adminGareAll.filter(g => g.gara_id !== gid);
          window._adminShowGareMsg(`✅ Gara "${nome}" eliminata`, true);
          window.adminFilterGare(document.getElementById('gare-search')?.value||'');
        } catch(e) {
          window._adminShowGareMsg(`❌ Errore: ${e.message}`, false);
        }
      };

      window.adminViewGaraRisultati = (gid) => {
        const nome = (window._adminGareAll.find(x=>x.gara_id===gid)||{}).nome || gid;
        const results = (globalData?.resultsRaw||[]).filter(r=>(r.gara_id||r.gara_slug||r.gara)===gid)
          .sort((a,b)=>(a.posizione||a.pos||99)-(b.posizione||b.pos||99));
        document.getElementById('admin-gara-res-modal')?.remove();
        document.body.insertAdjacentHTML('beforeend', `
          <div id="admin-gara-res-modal" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px" onclick="if(event.target===this)this.remove()">
            <div style="background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:14px;padding:28px 32px;max-width:600px;width:100%;max-height:80vh;overflow-y:auto" onclick="event.stopPropagation()">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
                <h3 style="font-family:var(--font-display);font-weight:800;font-size:1rem;margin:0">📋 ${esc(nome)}</h3>
                <button onclick="document.getElementById('admin-gara-res-modal').remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--text-muted)">✕</button>
              </div>
              <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:12px">${results.length} risultati</div>
              <table style="width:100%;border-collapse:collapse;font-size:.82rem">
                <thead><tr style="border-bottom:2px solid var(--border)">
                  <th style="text-align:left;padding:6px 8px;color:var(--text-muted);font-weight:600">Pos</th>
                  <th style="text-align:left;padding:6px 8px;color:var(--text-muted);font-weight:600">Atleta</th>
                  <th style="text-align:left;padding:6px 8px;color:var(--text-muted);font-weight:600">Team</th>
                  <th style="text-align:right;padding:6px 8px;color:var(--text-muted);font-weight:600">Punti</th>
                </tr></thead>
                <tbody>
                  ${results.slice(0,30).map(r=>`
                    <tr style="border-bottom:1px solid var(--border)">
                      <td style="padding:6px 8px;font-weight:700;color:${(r.posizione||r.pos)<=3?'var(--accent)':'var(--text-primary)'}">${r.posizione||r.pos||'–'}</td>
                      <td style="padding:6px 8px"><a href="#/atleta/${esc(String(r.atleta_id||''))}" onclick="document.getElementById('admin-gara-res-modal').remove()" style="color:var(--accent);text-decoration:none;font-weight:600">${esc((r.cognome||'')+' '+(r.nome||''))}</a></td>
                      <td style="padding:6px 8px;color:var(--text-muted)">${esc(r.team||'—')}</td>
                      <td style="padding:6px 8px;text-align:right">${r.punti_effettivi||'—'}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
              ${results.length>30?`<div style="font-size:.75rem;color:var(--text-muted);margin-top:8px">+${results.length-30} altri risultati</div>`:''}
              <div style="margin-top:16px;display:flex;gap:10px">
                <a href="#/gara/${esc(gid)}" onclick="document.getElementById('admin-gara-res-modal').remove()" class="dash-btn dash-btn--outline dash-btn--sm">🔗 Pagina pubblica →</a>
                <button onclick="window.adminDeleteGara('${esc(gid)}','${esc(nome.replace(/'/g,''))}');document.getElementById('admin-gara-res-modal').remove()" class="dash-btn dash-btn--danger dash-btn--sm">🗑 Elimina gara</button>
              </div>
            </div>
          </div>`);
      };

      window._adminRenderGare = (list) => {
        const b = document.getElementById('admin-gare-body');
        if (!b) return;
        if (!list.length) { b.innerHTML = `<div style="color:var(--text-muted);padding:24px 0">Nessuna gara trovata.</div>`; return; }
        b.innerHTML = `
          <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:8px">${list.length} gare (max 100 — usa i filtri)</div>
          <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:.83rem">
            <thead>
              <tr style="border-bottom:2px solid var(--border)">
                <th style="text-align:left;padding:8px 10px;color:var(--text-muted);font-weight:600">Gara</th>
                <th style="text-align:left;padding:8px 10px;color:var(--text-muted);font-weight:600">Data</th>
                <th style="text-align:left;padding:8px 10px;color:var(--text-muted);font-weight:600">Cat.</th>
                <th style="text-align:right;padding:8px 10px;color:var(--text-muted);font-weight:600">Atleti</th>
                <th style="text-align:left;padding:8px 10px;color:var(--text-muted);font-weight:600">Km / Media</th>
                <th style="text-align:left;padding:8px 10px;color:var(--text-muted);font-weight:600">Azioni</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(g => `
                <tr style="border-bottom:1px solid var(--border);transition:background .15s" onmouseover="this.style.background='var(--bg-elevated)'" onmouseout="this.style.background=''">
                  <td style="padding:9px 10px">
                    <div style="font-weight:600;color:var(--text-primary)">${esc((g.nome||'').slice(0,40))}</div>
                    <div style="font-size:.7rem;color:var(--text-muted)">${esc(g.gara_id||'')}</div>
                  </td>
                  <td style="padding:9px 10px;color:var(--text-muted);white-space:nowrap">${(g.data||'').slice(0,10)}</td>
                  <td style="padding:9px 10px">
                    <span style="padding:2px 7px;border-radius:10px;font-size:.72rem;font-weight:700;background:rgba(232,0,29,.1);color:var(--accent)">${esc(g.cat||'—')}</span>
                  </td>
                  <td style="padding:9px 10px;text-align:right">${g.n_atleti}</td>
                  <td style="padding:9px 10px;color:var(--text-muted);font-size:.8rem">${g.km ? `${g.km} km` : '—'}${g.media ? ` · ${g.media} km/h` : ''}</td>
                  <td style="padding:9px 10px">
                    <div style="display:flex;gap:6px">
                      <button onclick="window.adminViewGaraRisultati('${esc(g.gara_id||'')}')" title="Vedi risultati" style="padding:5px 8px;border:1px solid var(--border);border-radius:5px;background:transparent;color:var(--text-muted);cursor:pointer;font-size:.78rem">📋</button>
                      <button onclick="window.adminEditGara('${esc(g.gara_id||'')}')" title="Modifica" style="padding:5px 8px;border:1px solid var(--border);border-radius:5px;background:transparent;color:var(--text-muted);cursor:pointer;font-size:.78rem">✏️</button>
                      <button onclick="window.adminDeleteGara('${esc(g.gara_id||'')}','${esc((g.nome||'').slice(0,30).replace(/'/g,''))}')" title="Elimina" style="padding:5px 8px;border:1px solid rgba(239,68,68,.4);border-radius:5px;background:transparent;color:#ef4444;cursor:pointer;font-size:.78rem">🗑</button>
                    </div>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
          </div>`;
      };
      window._adminRenderGare(gareList.slice(0,100));
      break;
    }

    case 'page-gallery': {
      const PAGES = [
        { icon:'🏠', title:'Home',          route:'#/',             sections:[
          {label:'Hero banner',        color:''},
          {label:'Countdown prossima gara', color:'gold'},
          {label:'Ultime gare (card)', color:''},
          {label:'Narrative classifica', color:'blue'},
          {label:'Classifica rapida (top 5)', color:''},
          {label:'Foto in evidenza',   color:'green'},
          {label:'Calendario prossime', color:'gold'},
        ]},
        { icon:'📋', title:'Risultati',     route:'#/risultati',    sections:[
          {label:'Filtri categoria / anno', color:''},
          {label:'Lista gare (data, nome, cat)', color:''},
          {label:'Risultati gara (modale / inline)', color:'blue'},
          {label:'Pulsante condivisione grafica', color:'green'},
          {label:'Link foto / video gara', color:'gold'},
        ]},
        { icon:'🏆', title:'Classifica',    route:'#/classifica',   sections:[
          {label:'Selettore categoria + anno', color:''},
          {label:'Narrative banner (headline + storia)', color:'blue'},
          {label:'Tabella classifica atleti', color:''},
          {label:'Sparkline trend punteggi', color:'green'},
          {label:'Pulsante condivisione', color:'gold'},
        ]},
        { icon:'👤', title:'Atleti',        route:'#/atleti',       sections:[
          {label:'Ricerca per nome / team', color:''},
          {label:'Griglia atleti (card)', color:''},
          {label:'Paginazione',            color:'gray'},
        ]},
        { icon:'🚴', title:'Scheda atleta', route:'#/atleta/:id',   sections:[
          {label:'Header (nome, team, stato forma)', color:''},
          {label:'Statistiche (gare, vittorie, podi, punti)', color:'blue'},
          {label:'Grafico trend punti (sparkline)', color:'green'},
          {label:'Tabella risultati stagione', color:''},
          {label:'Storico stagioni precedenti', color:'gray'},
          {label:'Foto / album collegati', color:'gold'},
          {label:'Comparatore rapido', color:''},
          {label:'Watchlist toggle ★', color:'gold'},
        ]},
        { icon:'👥', title:'Team',          route:'#/team',         sections:[
          {label:'Narrative banner team', color:'blue'},
          {label:'Tabella classifica team', color:''},
          {label:'Pulsante condivisione', color:'gold'},
        ]},
        { icon:'🏢', title:'Scheda team',   route:'#/team/:id',     sections:[
          {label:'Header (nome, categoria)', color:''},
          {label:'Statistiche team', color:'blue'},
          {label:'Roster atleti attivi', color:''},
          {label:'Ultimi risultati squadra', color:''},
          {label:'Trend stagionale', color:'green'},
        ]},
        { icon:'📅', title:'Calendario',    route:'#/calendario',   sections:[
          {label:'Filtro categoria / mese', color:''},
          {label:'Lista gare future', color:''},
          {label:'Gare già disputate (link risultato)', color:'gray'},
        ]},
        { icon:'📊', title:'Statistiche',   route:'#/statistiche',  sections:[
          {label:'Selettore categoria + metrica', color:''},
          {label:'Grafici vittorie per team', color:'blue'},
          {label:'Grafici distribuzione punteggi', color:'green'},
          {label:'Top atleti / top team', color:''},
          {label:'Heatmap attività gare', color:'gold'},
        ]},
        { icon:'⚖️', title:'Comparatore',   route:'#/comparatore',  sections:[
          {label:'Selezione 2 atleti (autocomplete)', color:''},
          {label:'Statistiche a confronto', color:'blue'},
          {label:'Grafico radar o bar comparato', color:'green'},
          {label:'Risultati comuni (stessa gara)', color:''},
        ]},
        { icon:'📷', title:'Media',         route:'#/media/:id',    sections:[
          {label:'Header fotografo (nome, bio, social)', color:''},
          {label:'Griglia album', color:''},
          {label:'Lightbox foto', color:'green'},
          {label:'Collegamento gara', color:'gold'},
        ]},
        { icon:'🔐', title:'Login / Profilo',route:'#/login',       sections:[
          {label:'Form login / registrazione', color:''},
          {label:'Dashboard ruolo (post-login)', color:'blue'},
          {label:'Collega profilo atleta/team', color:'gold'},
        ]},
        { icon:'⚙️', title:'Admin',         route:'#/admin',        sections:[
          {label:'Sidebar navigazione sezioni', color:''},
          {label:'Dashboard overview + stats', color:'blue'},
          {label:'Gestione foto (pending / xpix / IC)', color:''},
          {label:'Gestione video (pending / YouTube)', color:''},
          {label:'Gestione media / fotografi', color:'green'},
          {label:'Lista utenti + profili in attesa', color:'gold'},
          {label:'Sync dati FCI', color:''},
          {label:'Conformazione pagine (questa)', color:'gray'},
        ]},
      ];
      const dotClass = c => c ? `pg-comp-dot pg-comp-dot--${c}` : 'pg-comp-dot';
      main.innerHTML = `
        <div class="admin-page-header">
          <h1 class="admin-page-title">🗂️ Conformazione Pagine</h1>
          <p class="admin-page-sub">Struttura e componenti di ogni pagina del sito.</p>
        </div>
        <div class="pg-gallery">
          ${PAGES.map(p => `
            <div class="pg-card">
              <div class="pg-card-header">
                <span class="pg-card-icon">${p.icon}</span>
                <span class="pg-card-title">${p.title}</span>
                <span class="pg-card-route">${p.route}</span>
              </div>
              <div class="pg-card-body">
                <div class="pg-section-label">Sezioni / Componenti</div>
                ${p.sections.map(s => `
                  <div class="pg-comp-row">
                    <div class="${dotClass(s.color)}"></div>
                    <span>${s.label}</span>
                  </div>`).join('')}
              </div>
            </div>`).join('')}
        </div>`;
      break;
    }
  }
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

  // ── Sezione approvate: mostra con pulsante "Rimuovi da gara"
  const approvedList  = _xpixQueue.filter(q => q.status === 'approved');
  const dismissedList = _xpixQueue.filter(q => q.status === 'dismissed');

  const approvedHtml = approvedList.length ? `
    <details style="margin-bottom:14px">
      <summary style="font-weight:700;font-size:.85rem;cursor:pointer;padding:8px 0;color:var(--text-primary)">
        ✓ Approvate (${approvedList.length}) — clicca per gestirle
      </summary>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
        ${approvedList.map(item => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:6px;flex-wrap:wrap">
          <div style="flex:1;min-width:0">
            <div style="font-size:.82rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(item.album_name)}</div>
            <div style="font-size:.72rem;color:var(--text-muted)">
              Gara: <strong>${esc(item.approved_gara_id||item.approved_gara_ids?.[0]||'—')}</strong>
            </div>
          </div>
          <button onclick="window.xpixRemoveFromGara('${esc(item.id)}','${esc(item.approved_gara_id||item.approved_gara_ids?.[0]||'')}',this)"
            style="flex:0 0 auto;background:transparent;border:1px solid #ef4444;color:#ef4444;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:.75rem;white-space:nowrap">
            🗑 Rimuovi da gara
          </button>
        </div>`).join('')}
      </div>
    </details>` : '';

  const dismissedHtml = dismissedList.length ? `
    <details style="margin-bottom:14px">
      <summary style="font-weight:700;font-size:.85rem;cursor:pointer;padding:8px 0;color:var(--text-primary)">
        ✗ Scartati (${dismissedList.length}) — clicca per recuperarli
      </summary>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
        ${dismissedList.map(item => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:6px;flex-wrap:wrap">
          <div style="flex:1;min-width:0">
            <div style="font-size:.82rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(item.album_name)}</div>
            <div style="font-size:.72rem;color:var(--text-muted)">Scartato — clicca per rimettere in coda</div>
          </div>
          <button onclick="window.xpixRestore('${esc(item.id)}',this)"
            style="flex:0 0 auto;background:transparent;border:1px solid #16a34a;color:#16a34a;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:.75rem;white-space:nowrap">
            ↩ Ripristina
          </button>
        </div>`).join('')}
      </div>
    </details>` : '';

  if (!pending.length) {
    container.innerHTML = stats + approvedHtml + dismissedHtml +
      `<div style="color:var(--text-muted);font-size:.85rem">Nessun album in attesa.</div>`;
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

  container.innerHTML = stats + approvedHtml + dismissedHtml + rows;
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

// Rimuove la foto xpix da una gara (senza scartare l'album dalla coda)
window.xpixRemoveFromGara = async (id, garaId, btn) => {
  if (!garaId) { showToast('Nessuna gara collegata', 'error'); return; }
  if (!confirm(`Rimuovere la foto dalla gara "${garaId}"? L'album tornerà in coda.`)) return;
  if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }
  try {
    await apiCall(`/admin/xpix/photos/${encodeURIComponent(garaId)}`, { method: 'DELETE' });
    // Rimette l'album in pending
    await apiCall(`/admin/xpix/queue/${id}/restore`, { method: 'PATCH' });
    const item = _xpixQueue.find(q => q.id === id);
    if (item) { item.status = 'pending'; delete item.approved_gara_id; delete item.approved_gara_ids; }
    showToast('Foto rimossa dalla gara — album di nuovo in coda');
    renderXpixQueue();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '🗑 Rimuovi da gara'; }
    showToast('Errore: ' + e.message, 'error');
  }
};

// Ripristina un album scartato → lo rimette in pending
window.xpixRestore = async (id, btn) => {
  if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }
  try {
    await apiCall(`/admin/xpix/queue/${id}/restore`, { method: 'PATCH' });
    const item = _xpixQueue.find(q => q.id === id);
    if (item) { item.status = 'pending'; }
    showToast('Album ripristinato — è di nuovo in coda');
    renderXpixQueue();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '↩ Ripristina'; }
    showToast('Errore: ' + e.message, 'error');
  }
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

// Naviga alla classifica impostando categoria/view senza doppio render
window.navToRankCat  = (catCode, view) => {
  rankCat    = catCode;
  rankGender = catCode.endsWith('_F') ? 'F' : 'M';
  rankView   = view || 'atleti';
  rankFilter = ''; rankRegion = ''; rankMonth = ''; rankSort = 'punti';
  window.location.hash = '#/classifica';
};
window.setRankGender = (g) => { rankGender = g; rankFilter = ''; rankRegion = ''; rankMonth = ''; rankSort = 'punti'; renderClassifica(); };
window.setRankCat    = (c) => { rankCat = c; rankFilter = ''; rankRegion = ''; rankMonth = ''; rankSort = 'punti'; renderClassifica(); };
window.setRankFilter = (v) => { rankFilter = v; updateRankTable(); };
window.setRankView   = (v) => { rankView = v; rankFilter = ''; rankRegion = ''; rankMonth = ''; rankSort = 'punti'; renderClassifica(); };
window.setRankRegion = (v) => { rankRegion = v; updateRankTable(); };
window.setRankMonth  = (v) => { rankMonth = v; updateRankTable(); };
window.setRankSort   = (s) => { rankSort = s; updateRankTable(); };

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
    // Foto: prima ricerca esatta, poi fallback senza suffisso categoria
    const photo = _photos[r.gara_id] || (() => {
      const base = r.gara_id ? r.gara_id.replace(/_[A-Z0-9]+_[MF]$/, '') : '';
      return base && base !== r.gara_id ? _photos[base] : null;
    })();

    // Categoria estratta dal gara_id corrente (es. "JUN_M") — usata per il guard sul fallback video
    const _catSuffix = (r.gara_id && r.gara_id.match(/_([A-Z0-9]+_[MF])$/) || [])[1] || null;

    // Cerca video: prima chiave esatta, poi varianti con la stessa categoria
    let videoArr = _vids[r.gara_id] || [];
    if (!videoArr.length) {
      // Cerca chiavi che iniziano con la base del gara_id (es. senza _JUN_M)
      // Guard: accetta solo video della stessa categoria per evitare cross-category leak
      const baseKey = r.gara_id ? r.gara_id.replace(/_[A-Z0-9]+_[MF]$/, '') : '';
      for (const [k, v] of Object.entries(_vids)) {
        if (k.startsWith(baseKey) && v.length) {
          // Se il video ha un suffisso categoria diverso da quello del risultato → salta
          const kSuffix = (k.match(/_([A-Z0-9]+_[MF])$/) || [])[1] || null;
          if (_catSuffix && kSuffix && kSuffix !== _catSuffix) continue;
          videoArr = v; break;
        }
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

  // Registra visualizzazione per Popular Today
  trackAthleteView(atleta_id, a.cognome || '', a.nome || '');

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
        ${atletaOv.anno_nascita ? `<span class="badge-cat">Classe ${esc(atletaOv.anno_nascita)}</span>` : ''}
        ${a.genere === 'F' ? '<span class="badge-cat badge-genere-f">♀</span>' : ''}
        ${a.team_id ? `<a href="#/team/${esc(a.team_id)}" style="font-family:var(--font-heading);font-size:.8rem;color:var(--text-secondary);border:1px solid var(--border-subtle);padding:2px 10px;border-radius:2px">${esc(displayTeam)} →</a>` : ''}
      </div>
      <div class="profile-photo-row" style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
        ${photoHtml}
        <div class="athlete-header-name">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px">
            <span class="athlete-cognome">${esc(displayCognome)}</span>
            <span class="athlete-nome">${esc(displayNome)}</span>
            <span id="atleta-msg-btn"></span>
          </div>
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
          ${entitySocialLinksHtml(atletaOv, ['instagram','facebook','strava','website'])}
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

  // Build badge strip
  const _badges = getAthleteBadges(atleta_id, globalData.resultsRaw, rCode, aRankObj);
  const _badgeStripHtml = _badges.length ? `
    <div class="ath-badge-strip">
      ${_badges.map(b => `<span class="ath-badge ath-badge--${b.cls||'default'}">${b.icon} ${b.label}</span>`).join('')}
    </div>` : '';

  // Watch button state
  const _watched = isWatched(atleta_id);

  setPage(`
    ${headerHtml}
    ${_badgeStripHtml}
    ${sparkHtml ? `<div class="sparkline-wrap"><div class="sparkline-title">ANDAMENTO PUNTI — STAGIONE ${new Date().getFullYear()}</div>${sparkHtml}</div>` : ''}
    <div style="margin: 8px 0 20px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn-share" onclick="window.triggerShareAtleta()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Condividi Profilo</button>
      <button class="btn-share" onclick="window.openComparatore('${esc(atleta_id)}','atleta')">⚖ Compara</button>
      <button class="watch-btn ${_watched ? 'watch-btn--active' : ''}" id="watch-btn-${esc(atleta_id)}" onclick="window.toggleWatch('${esc(atleta_id)}','${esc(displayCognome)}','${esc(displayNome)}')">${_watched ? '<span>★</span> Seguito' : '<span>☆</span> Segui'}</button>
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

  // Inject bottone messaggio in modo async (lookup non blocca il render)
  _injectMsgBtn('atleta-msg-btn', atleta_id, null, null);
}

// Inietta bottone "Scrivi messaggio" dopo aver verificato se l'utente ha un account
async function _injectMsgBtn(spanId, atleta_id, team_name, media_profile_id) {
  const span = document.getElementById(spanId);
  if (!span) return;
  const loggedUser = authUser();
  if (!loggedUser) return; // non loggato — non mostrare nulla
  try {
    const params = new URLSearchParams();
    if (atleta_id)        params.set('atleta_id', atleta_id);
    if (team_name)        params.set('team_name', team_name);
    if (media_profile_id) params.set('media_profile_id', media_profile_id);
    const d = await apiCall(`/users/lookup?${params}`);
    if (!d.user || d.user.id === loggedUser.id) return; // stesso utente o non trovato
    span.innerHTML = `<button class="btn-msg-write" onclick="window.startConversation(${d.user.id},'${esc(d.user.display_name || 'Utente')}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      Contatta
    </button>`;
  } catch { /* silenzioso — feature opzionale */ }
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
  // Corridori: tutti gli atleti del team da TUTTE le categorie (non solo quella selezionata)
  // puntiCat = punti nel tab selezionato; puntiTot = punti totali di tutte le categorie
  const atletiMap = {};
  (t.risultati||[]).forEach(r => {
    if (!r.atleta_id) return;
    if (!atletiMap[r.atleta_id]) {
      atletiMap[r.atleta_id] = { id: r.atleta_id, ...athletes[r.atleta_id], puntiCat: 0, puntiTot: 0 };
    }
    atletiMap[r.atleta_id].puntiTot += (r.punti_effettivi||0);
    // puntiCat = punti solo nella categoria del tab selezionato
    if ((getRankingFileCode(r) || r.categoria) === teamViewCat) {
      atletiMap[r.atleta_id].puntiCat += (r.punti_effettivi||0);
    }
  });
  const atletiList = Object.values(atletiMap)
    .sort((a,b) => b.puntiTot - a.puntiTot || (a.cognome||'').localeCompare(b.cognome||''));

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
      <span class="cat-pts" title="${a.puntiCat > 0 ? a.puntiCat+' pt in questa cat.' : a.puntiTot+' pt totali'}">${a.puntiCat > 0 ? a.puntiCat : (a.puntiTot > 0 ? `<span style="opacity:.5;font-size:.8em">${a.puntiTot}</span>` : '—')}</span>
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
  const _teamWatched = isWatched(team_id);
  setPage(`
    <div class="team-header">
      <div class="team-header-identity">
        ${teamPhotoHtml}
        <div class="team-header-name-block">
          <div class="team-name-display">${nationFlagPrefix(t.nome)}${esc(t.nome)}</div>
          <span id="team-msg-btn"></span>
          ${entitySocialLinksHtml(teamOv, ['instagram','facebook','strava','website'])}
        </div>
      </div>
      ${headerStats}
    </div>
    <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn-share" onclick="window.triggerShareTeam()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Condividi Team</button>
      <button class="watch-btn ${_teamWatched ? 'watch-btn--active' : ''}" id="watch-btn-${esc(team_id)}" onclick="window.toggleWatchTeam('${esc(team_id)}')">${_teamWatched ? '<span>★</span> Seguito' : '<span>☆</span> Segui'}</button>
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

    ${buildProfileMedia(
      globalData.resultsRaw.filter(r =>
        r.team_id === team_id &&
        r.posizione &&
        r.data &&
        (getRankingFileCode(r) || r.categoria) === teamViewCat
      ),
      teamPhotosMap,
      globalData.videos,
      { showAthleteName: true }
    )}
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

  // Bottone messaggio team (async, non blocca il render)
  // Cerchiamo il team_profile tramite nome team
  _injectMsgBtn('team-msg-btn', null, team_id, null);
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

// Admin: rimuove la foto xpix direttamente dalla scheda gara
window.adminRemoveXpixFromRace = async function(garaId) {
  if (!confirm('Rimuovere la foto xpix da questa gara?')) return;
  try {
    await apiCall(`/admin/xpix/photos/${encodeURIComponent(garaId)}`, { method: 'DELETE' });
    _risPhotosMap = null; // invalida cache
    showToast('Foto rimossa ✓');
    // Ricarica la pagina gara per aggiornare la UI
    setTimeout(() => route(), 300);
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

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

// ── MEDIA PROFILE PAGE ────────────────────────────────────────
async function renderMediaProfile(profileId) {
  setPage(`<div class="loading-bar"></div>`);
  try {
    const d = await fetch(`${API_BASE}/media/profile/${profileId}`).then(r => r.json());
    if (d.error) { renderNotFound(); return; }
    const { profile, albums, stats } = d;

    const albumsHtml = albums.length
      ? `<div class="media-album-grid">${albums.map(a => {
          const cover = a.first_ext_url || (a.first_filename ? `${PHOTOS_BASE}/photos/${a.first_filename}` : '');
          return `<a href="#/media/${profile.id}/album/${a.id}" class="media-album-card" onclick="window._renderMediaAlbum(${a.id},${profile.id});return false;">
            <div class="media-album-cover">
              ${cover ? `<img src="${esc(cover)}" loading="lazy" alt="${esc(a.title)}"/>` : `<div class="media-album-cover-empty">📷</div>`}
              <div class="media-album-count">${a.photo_count} foto</div>
            </div>
            <div class="media-album-title">${esc(a.title)}</div>
            ${a.gara_id ? `<div class="media-album-gara"><a href="#/gara/${encodeURIComponent(a.gara_id)}" onclick="event.stopPropagation()" style="color:var(--accent);font-size:.72rem">→ Vedi gara</a></div>` : ''}
          </a>`;
        }).join('')}</div>`
      : `<p style="color:var(--text-muted);padding:24px 0">Nessun album ancora.</p>`;

    const loggedUser = authUser();
    const isOwner = loggedUser && profile.user_id && loggedUser.id === profile.user_id;
    const canMsg  = loggedUser && profile.user_id && !isOwner;
    const msgBtn  = canMsg
      ? `<button class="btn-msg-write" onclick="window.startConversation(${profile.user_id},'${esc(profile.display_name)}')">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
           Scrivi messaggio
         </button>` : '';

    setPage(`
      <div class="media-profile-header">
        <div class="media-profile-avatar">📷</div>
        <div>
          <h1 class="media-profile-name">${esc(profile.display_name)}</h1>
          ${profile.bio ? `<p class="media-profile-bio">${esc(profile.bio)}</p>` : ''}
          <div class="media-profile-links">
            ${profile.website ? `<a href="${esc(profile.website)}" target="_blank" rel="noopener" class="media-profile-link"><svg class="social-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg> Sito web</a>` : ''}
            ${profile.instagram ? `<a href="https://instagram.com/${esc(profile.instagram.replace('@',''))}" target="_blank" rel="noopener" class="media-profile-link"><svg class="social-icon social-icon-ig" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg> ${esc(profile.instagram)}</a>` : ''}
            ${profile.facebook ? `<a href="${profile.facebook.startsWith('http') ? esc(profile.facebook) : 'https://facebook.com/'+esc(profile.facebook)}" target="_blank" rel="noopener" class="media-profile-link"><svg class="social-icon social-icon-fb" viewBox="0 0 24 24"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg> Facebook</a>` : ''}
            ${msgBtn}
          </div>
          <div class="media-profile-stats">
            <span>${albums.length} album</span>
            <span style="margin:0 8px;color:var(--border)">·</span>
            <span>${stats?.total || 0} foto</span>
          </div>
        </div>
      </div>
      <div id="media-album-area">
        <div class="comp-section-title" style="margin-bottom:16px">Album</div>
        ${albumsHtml}
      </div>
    `);
  } catch(e) {
    setPage(`<div style="padding:48px;color:var(--text-muted);text-align:center">Errore nel caricamento del profilo: ${esc(e.message)}</div>`);
  }
}

window._renderMediaAlbum = async function(albumId, profileId) {
  const area = document.getElementById('media-album-area');
  if (!area) return;
  area.innerHTML = `<div class="admin-loading">Caricamento album…</div>`;
  try {
    const [albumData, photosData] = await Promise.all([
      fetch(`${API_BASE}/media/profile/${profileId}`).then(r => r.json()),
      fetch(`${API_BASE}/media/album/${albumId}/photos`).then(r => r.json()),
    ]);
    const album  = albumData.albums?.find(a => a.id == albumId);
    const photos = photosData.photos || [];
    area.innerHTML = `
      <div style="margin-bottom:16px;display:flex;align-items:center;gap:10px">
        <button onclick="renderMediaProfile(${profileId})" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:.85rem;padding:0">← Tutti gli album</button>
        <span style="color:var(--border)">|</span>
        <span style="font-weight:700">${esc(album?.title || 'Album')}</span>
        ${album?.gara_id ? `<a href="#/gara/${encodeURIComponent(album.gara_id)}" style="font-size:.78rem;color:var(--text-muted)">→ ${esc(album.gara_id)}</a>` : ''}
      </div>
      ${photos.length
        ? `<div class="media-photos-grid">${photos.map(p => {
            const src = p.ext_url || (p.filename ? `${PHOTOS_BASE}/photos/${p.filename}` : '');
            if (!src) return '';
            const uid = 'ph_' + (p.id || p.filename || src).toString().replace(/[^a-z0-9]/gi,'').slice(-24);
            const inColl = isInCollection(uid);
            const ttl = (p.caption || album?.title || 'Foto gara').replace(/'/g,'');
            const gid = (album?.gara_id || '').replace(/'/g,'');
            return `<div class="media-photo-item">
              <img src="${esc(src)}" loading="lazy" alt="${esc(p.caption||'')}" onclick="window.openPhotoLightbox('${esc(src)}')" style="cursor:zoom-in"/>
              <button id="collect-btn-${uid}" class="collect-btn ${inColl?'collect-btn--active':''}" title="${inColl?'Nella tua raccolta':'Salva nella raccolta'}"
                style="position:absolute;top:6px;right:6px;z-index:2"
                onclick="event.stopPropagation();window.toggleMediaCollect('${uid}','foto','${esc(src)}','${esc(ttl)}','${esc(gid)}')">${inColl?'✓':'＋'}</button>
              ${p.caption ? `<div class="media-photo-caption">${esc(p.caption)}</div>` : ''}
            </div>`;
          }).join('')}</div>`
        : `<p style="color:var(--text-muted)">Nessuna foto in questo album.</p>`}`;
  } catch(e) {
    area.innerHTML = `<div style="color:var(--red-hot)">Errore: ${esc(e.message)}</div>`;
  }
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
            ${(() => { const uid='ph_'+String(p.id||p.filename).replace(/[^a-z0-9]/gi,'').slice(-24); const ic=isInCollection(uid); return `<button id="collect-btn-${uid}" class="collect-btn ${ic?'collect-btn--active':''}" title="${ic?'Nella tua raccolta':'Salva nella raccolta'}" style="position:absolute;top:4px;left:4px;z-index:10;width:26px;height:26px;font-size:.85rem" onclick="event.stopPropagation();window.toggleMediaCollect('${uid}','foto','${PHOTOS_BASE}/photos/${esc(p.filename)}','${esc((p.caption||'Foto gara').replace(/'/g,''))}','${esc((primaryGaraId||'').replace(/'/g,''))}')">${ic?'✓':'＋'}</button>`; })()}
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
        const _isXpix = (_extPhoto.album_slug || _extPhoto.source === 'xpix');
        const _srcLabel = _isXpix ? 'xpix.it' : 'italiaciclismo.net';
        // Pulsante rimozione visibile solo all'admin, per foto xpix.
        // Usa _extPhoto.gara_id (chiave reale in xpix_photos) non primaryGaraId (dalla URL)
        const _xpixKey = _extPhoto.gara_id || primaryGaraId;
        const _removeBtn = (authUser()?.role === 'admin' && _isXpix)
          ? `<button onclick="window.adminRemoveXpixFromRace('${esc(_xpixKey)}')"
               style="position:absolute;top:6px;right:6px;background:rgba(220,38,38,.85);color:#fff;border:none;padding:3px 8px;border-radius:4px;font-size:.7rem;cursor:pointer;z-index:2">
               🗑 Rimuovi foto
             </button>` : '';
        _heroPhotoEl = `<div class="gara-media-half gara-media-photo" onclick="window.openPhotoLightbox('${_src}')" style="cursor:zoom-in;position:relative">
           <img id="gara-hero-img" src="${_src}" alt="Foto gara" loading="lazy"/>
           <div class="gara-photo-hint">🔍 Clicca per la foto intera</div>
           <div style="position:absolute;bottom:6px;left:8px;font-size:0.65rem;color:rgba(255,255,255,.7);background:rgba(0,0,0,.45);padding:2px 6px;border-radius:3px">📷 ${_srcLabel}</div>
           ${_removeBtn}
         </div>`;
        // Gallery con tutte le foto dell'album (se disponibili)
        const _allPics = _extPhoto.photos && _extPhoto.photos.length > 1 ? _extPhoto.photos : [];
        if (_allPics.length > 1) {
          _gallery = `
            <div class="profile-media-grid" style="margin-top:12px">
              ${_allPics.map((u, idx) => `
                <div class="profile-media-card" onclick="window.openPhotoLightbox('${esc(u)}')" style="cursor:zoom-in">
                  <img src="${esc(u)}" alt="Foto ${idx+1}" loading="lazy" style="width:100%;height:100%;object-fit:cover"/>
                </div>`).join('')}
            </div>
            ${_extPhoto.album_page ? `<div style="margin-top:8px;font-size:.8rem">
              <a href="${esc(_extPhoto.album_page)}" target="_blank" rel="noopener" style="color:var(--accent)">
                📷 Apri album completo su xpix.it (${_extPhoto.photos.length} foto) ↗
              </a></div>` : ''}`;
        } else if (_extPhoto.album_page) {
          _gallery = `<div style="margin-top:8px;font-size:.8rem">
            <a href="${esc(_extPhoto.album_page)}" target="_blank" rel="noopener" style="color:var(--accent)">
              📷 Apri album completo su xpix.it ↗
            </a></div>`;
        } else {
          _gallery = '';
        }
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

  window._shareGaraData = {name:name,date:fmtDate(data),cat:catLabel(cat),mult:mult,tipo:tipo,region:normalizeRegion(calEntry?.regione||results1[0]?.regione||''),luogo:calEntry?.luogo||'',km:results1[0]?.km||'',media:results1[0]?.media||'',results:results1.slice(0,10).map(r=>({cognome:r.cognome,nome:r.nome,team:r.team,punti_effettivi:r.punti_effettivi}))};

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
    <div id="gara-media-gallery"></div>
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

  // Scroll orizzontale dello strip
  window._mgScroll = function(stripId, dir) {
    const el = document.getElementById(stripId);
    if (!el) return;
    const thumbW = el.querySelector('.media-gallery-thumb')?.offsetWidth || 200;
    el.scrollBy({ left: dir * thumbW * 3, behavior: 'smooth' });
  };

  // Gallery media: lazy — carica solo quando la sezione entra nel viewport
  // → evita N fetch parallele che rallentano la pagina al caricamento
  (() => {
    const galEl = document.getElementById('gara-media-gallery');
    if (!galEl) return;
    let loaded = false;

    const doLoad = async () => {
      if (loaded) return;
      loaded = true;
      try {
        const d = await fetch(`${API_BASE}/media/gara/${encodeURIComponent(primaryGaraId)}`).then(r => r.json());
        const albums = d.albums || [];
        if (!albums.length) return;

        // Carica TUTTE le foto di tutti gli album in parallelo (lazy: solo quando la sezione è visibile)
        const albumPhotos = await Promise.all(
          albums.map(a =>
            fetch(`${API_BASE}/media/album/${a.id}/photos`)
              .then(r => r.json())
              .then(pd => ({ album: a, photos: (pd.photos || []).map(p => ({ src: p.ext_url || (p.filename ? `${PHOTOS_BASE}/photos/${p.filename}` : ''), raw: p })).filter(p => p.src) }))
              .catch(() => ({ album: a, photos: [] }))
          )
        );

        // Costruisce il flat array globale per il carousel
        window._garaMediaPhotos = [];
        albumPhotos.forEach(({ album: a, photos }) => {
          photos.forEach(p => window._garaMediaPhotos.push({
            src: p.src,
            albumTitle: a.title,
            photographer_name: a.photographer_name,
            profile_id: a.profile_id,
            albumId: a.id
          }));
        });

        // Mappa: albumId → indice di partenza nel flat array
        const albumStartIdx = {};
        let running = 0;
        albumPhotos.forEach(({ album: a, photos }) => {
          albumStartIdx[a.id] = running;
          running += photos.length;
        });

        galEl.innerHTML = `
          <div class="comp-section media-gallery-section">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:6px">
              <div class="comp-section-title" style="margin:0;border:none;padding:0">📷 Gallery fotografi</div>
              <span style="font-size:.75rem;color:var(--text-muted)">${albums.length} album</span>
            </div>
            ${albumPhotos.map(({ album: a, photos }) => {
              const stripId = `mgstrip-${a.id}`;
              const startIdx = albumStartIdx[a.id];
              const thumbsHtml = photos.length
                ? photos.map((p, pi) => `
                    <div class="media-gallery-thumb" onclick="window.openMediaCarousel(${startIdx + pi})">
                      <img src="${esc(p.src)}" loading="lazy" alt="Foto ${pi+1}"/>
                    </div>`).join('')
                : `<div class="media-gallery-thumb" style="background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;color:var(--text-muted)">📷</div>`;
              return `
                <div class="media-gallery-album">
                  <div class="media-gallery-album-header">
                    <span class="media-gallery-album-name">${esc(a.title)}</span>
                    <a href="#/media/${a.profile_id}" class="media-gallery-photographer">📷 ${esc(a.photographer_name)}</a>
                  </div>
                  <div class="media-gallery-strip-wrap">
                    <button class="media-gallery-arrow media-gallery-prev" onclick="window._mgScroll('${stripId}',-1)">‹</button>
                    <div class="media-gallery-strip" id="${stripId}">${thumbsHtml}</div>
                    <button class="media-gallery-arrow media-gallery-next" onclick="window._mgScroll('${stripId}',1)">›</button>
                  </div>
                </div>`;
            }).join('')}
          </div>`;
      } catch(e) { /* non blocca la pagina */ }
    };

    // IntersectionObserver: carica al 10% di visibilità
    if ('IntersectionObserver' in window) {
      const obs = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) { obs.disconnect(); doLoad(); }
      }, { threshold: 0.1 });
      obs.observe(galEl);
    } else {
      doLoad(); // fallback per browser vecchi
    }
  })();


  // Carousel lightbox con prev/next, Acquista e Condividi
  window.openMediaCarousel = function(startIdx) {
    const photos = window._garaMediaPhotos || [];
    if (!photos.length) return;
    let cur = startIdx;
    const user = authUser();

    const render = () => {
      const p = photos[cur];
      const el = id => document.getElementById(id);
      if (el('mgc-counter')) el('mgc-counter').textContent = `${cur + 1} / ${photos.length}`;
      if (el('mgc-img'))     el('mgc-img').src = p.src;
      if (el('mgc-caption')) el('mgc-caption').innerHTML =
        `<a href="#/media/${p.profile_id}" style="color:var(--accent)" onclick="document.getElementById('media-carousel')?.remove()">📷 ${esc(p.photographer_name)}</a>` +
        `<span style="color:rgba(255,255,255,.4);margin:0 8px">·</span>${esc(p.albumTitle)}`;
      // Aggiorna data-photo-id per i bottoni azione
      if (el('mgc-buy'))   el('mgc-buy').dataset.photoSrc   = p.src;
      if (el('mgc-share')) el('mgc-share').dataset.photoSrc = p.src;
    };

    const existing = document.getElementById('media-carousel');
    if (existing) existing.remove();

    const btnBase = 'border:none;padding:7px 16px;border-radius:6px;font-size:.78rem;font-weight:600;cursor:pointer';
    const overlay = document.createElement('div');
    overlay.id = 'media-carousel';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML = `
      <div style="position:absolute;top:12px;right:16px;display:flex;align-items:center;gap:14px">
        <span id="mgc-counter" style="color:rgba(255,255,255,.45);font-size:.8rem"></span>
        <button onclick="document.getElementById('media-carousel')?.remove()" style="background:none;border:none;color:#ccc;font-size:1.8rem;cursor:pointer;line-height:1">✕</button>
      </div>
      <div style="width:100%;max-width:960px;display:flex;align-items:center;justify-content:center;gap:8px">
        <button id="mgc-prev" class="mgc-nav-btn">‹</button>
        <img id="mgc-img" src="" alt="" style="max-height:70vh;max-width:calc(100% - 120px);object-fit:contain;border-radius:4px;display:block"/>
        <button id="mgc-next" class="mgc-nav-btn">›</button>
      </div>
      <div id="mgc-caption" style="margin-top:8px;font-size:.8rem;color:rgba(255,255,255,.55);text-align:center"></div>
      <div class="mgc-actions" style="margin-top:10px">
        ${user ? `<button id="mgc-buy"   data-photo-src="" style="${btnBase};background:#f59e0b;color:#000" onclick="window._mgRequestPurchase(this)">🛒 Acquista</button>` : ''}
        ${(user?.role === 'atleta' || user?.role === 'admin') ? `<button id="mgc-share" data-photo-src="" style="${btnBase};background:var(--accent);color:#fff" onclick="window._mgShareToProfile(this)">📌 Condividi sul mio profilo</button>` : ''}
      </div>`;
    document.body.appendChild(overlay);
    render();

    document.getElementById('mgc-prev').onclick = () => { cur = (cur - 1 + photos.length) % photos.length; render(); };
    document.getElementById('mgc-next').onclick = () => { cur = (cur + 1) % photos.length; render(); };

    const onKey = (e) => {
      if (e.key === 'ArrowLeft')  { cur = (cur - 1 + photos.length) % photos.length; render(); }
      if (e.key === 'ArrowRight') { cur = (cur + 1) % photos.length; render(); }
      if (e.key === 'Escape')     { overlay.remove(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); document.removeEventListener('keydown', onKey); }
    });
  };

  // Richiesta acquisto
  window._mgRequestPurchase = async function(btn) {
    const photos = window._garaMediaPhotos || [];
    const counter = document.getElementById('mgc-counter')?.textContent || '';
    const idx = parseInt(counter.split('/')[0]) - 1;
    const p = photos[idx];
    if (!p) return;
    const msg = prompt('Messaggio per il fotografo (opzionale):', '') ?? null;
    if (msg === null) return; // annullato
    btn.disabled = true; btn.textContent = '⏳';
    try {
      // Trova l'id della foto tramite src (o invia direttamente il src come riferimento)
      await fetch(`${API_BASE}/media/photo/by-url/request-purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken()}` },
        body: JSON.stringify({ src: p.src, album_title: p.albumTitle, photographer_name: p.photographer_name, message: msg }),
      });
      btn.textContent = '✓ Richiesta inviata';
      showToast('✓ Richiesta inviata al fotografo!');
    } catch(e) {
      btn.disabled = false; btn.textContent = '🛒 Acquista';
      showToast('Errore: ' + e.message, 'error');
    }
  };

  // Condivisione foto su profilo atleta
  window._mgShareToProfile = async function(btn) {
    const photos = window._garaMediaPhotos || [];
    const counter = document.getElementById('mgc-counter')?.textContent || '';
    const idx = parseInt(counter.split('/')[0]) - 1;
    const p = photos[idx];
    if (!p) return;
    btn.disabled = true; btn.textContent = '⏳';
    try {
      await fetch(`${API_BASE}/media/photo/by-url/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken()}` },
        body: JSON.stringify({ src: p.src, album_title: p.albumTitle, photographer_name: p.photographer_name }),
      });
      btn.textContent = '✓ Condivisa';
      showToast('✓ Foto aggiunta al tuo profilo atleta!');
    } catch(e) {
      btn.disabled = false; btn.textContent = '📌 Condividi sul mio profilo';
      showToast('Errore: ' + e.message, 'error');
    }
  };

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
            ${(!isPast && typeof authUser==='function' && authUser()) ? `<button id="myrace-btn-${esc(g.id)}" class="cal-follow-btn ${isMyRace(g.id)?'active':''}" title="Aggiungi al mio calendario" onclick="event.stopPropagation();window.toggleMyRace('${esc(g.id)}','${esc((g.nome||'').replace(/'/g,''))}','${esc(g.data||'')}')">★</button>` : ''}
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
                <td><a href="#/team/${esc(t.id)}"><strong>${nationFlagPrefix(t.nome)}${esc(t.nome)}</strong></a></td>
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
async function renderStatistiche(selectedCatKey) {
  if (!globalData) return;
  const { resultsRaw: allResults, athletes, calendar } = globalData;

  // Categorie disponibili: lista unica (categoria|genere) → chiave URL
  const availableCats = [...new Set(allResults.map(r => `${r.categoria}|${r.genere}`))].sort();
  const catTabsHtml = `
    <div class="cat-tabs" style="margin-bottom:28px;flex-wrap:wrap">
      <button class="cat-tab${!selectedCatKey ? ' active' : ''}" onclick="location.hash='#/statistiche'">Generale</button>
      ${availableCats.map(key => {
        const [cat, gen] = key.split('|');
        const label = catGenLabel(cat, gen);
        const isActive = selectedCatKey === key;
        return `<button class="cat-tab${isActive ? ' active' : ''}" onclick="location.hash='#/statistiche/${encodeURIComponent(key)}'">${label}</button>`;
      }).join('')}
    </div>`;

  // Filtra i risultati per la categoria selezionata (o usa tutti per il generale)
  const resultsRaw = selectedCatKey
    ? allResults.filter(r => `${r.categoria}|${r.genere}` === selectedCatKey)
    : allResults;

  // Se categoria singola → mostra vista dedicata
  if (selectedCatKey) {
    return _renderStatisticheCat(selectedCatKey, resultsRaw, athletes, calendar, catTabsHtml);
  }

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

    ${catTabsHtml}

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

// ── STATISTICHE CATEGORIA SINGOLA ────────────────────────────
function _renderStatisticheCat(catKey, resultsRaw, athletes, calendar, catTabsHtml) {
  const [cat, gen] = catKey.split('|');
  const label = catGenLabel(cat, gen);

  if (!resultsRaw.length) {
    setPage(`<div class="pg-header"><h1 class="pg-title">STATISTICHE — ${esc(label)}</h1></div>${catTabsHtml}<p style="color:var(--text-muted)">Nessun dato per questa categoria.</p>`);
    return;
  }

  // KPI categoria
  const catRaces     = new Set(resultsRaw.map(r => r.gara_id)).size;
  const catAthletes  = new Set(resultsRaw.filter(r => r.punti_effettivi > 0).map(r => r.atleta_id)).size;
  const catKm        = Math.round(resultsRaw.reduce((s,r) => s+(parseFloat(r.km)||0), 0)).toLocaleString('it-IT');
  const catWins      = resultsRaw.filter(r => r.posizione === 1).length;

  // Top vincitore (più vittorie)
  const winsMap = {};
  const ptsMap  = {};
  const racesMap = {};
  const podioMap = {};
  resultsRaw.forEach(r => {
    const id = r.atleta_id;
    racesMap[id] = (racesMap[id]||0) + 1;
    ptsMap[id]   = (ptsMap[id]||0) + (r.punti_effettivi||0);
    if (r.posizione === 1) winsMap[id] = (winsMap[id]||0) + 1;
    if (r.posizione <= 3)  podioMap[id] = (podioMap[id]||0) + 1;
  });
  const getName = id => { const a = athletes[id]; return a ? `${a.cognome} ${a.nome}` : id.replace(/_/g,' '); };
  const topWinner  = Object.entries(winsMap).sort((a,b)=>b[1]-a[1])[0];
  const topScorer  = Object.entries(ptsMap).sort((a,b)=>b[1]-a[1])[0];
  const topConsist = Object.entries(racesMap).filter(([,g])=>g>=3)
    .map(([id,g]) => ({ id, pct: Math.round(((podioMap[id]||0)/g)*100), g }))
    .sort((a,b)=>b.pct-a.pct)[0];

  // Team con più vittorie
  const teamMap = {};
  resultsRaw.forEach(r => {
    if (r.posizione !== 1 || !r.team_id) return;
    if (!teamMap[r.team_id]) teamMap[r.team_id] = { team: r.team, wins: 0 };
    teamMap[r.team_id].wins++;
  });
  const topTeam = Object.values(teamMap).sort((a,b)=>b.wins-a.wins)[0];

  // Top 10 vincitori assoluti
  const top10Wins = Object.entries(winsMap)
    .sort((a,b)=>b[1]-a[1]).slice(0,10)
    .map(([id,w],i) => `<tr>
      <td style="padding:8px 12px;color:var(--text-muted);font-size:.8rem">${i+1}</td>
      <td style="padding:8px 12px"><a href="#/atleta/${esc(id)}" style="font-weight:600">${esc(getName(id))}</a></td>
      <td style="padding:8px 12px;font-family:var(--font-display);font-size:1.2rem;color:var(--gold)">${w}</td>
    </tr>`).join('');

  const top10Pts = Object.entries(ptsMap)
    .sort((a,b)=>b[1]-a[1]).slice(0,10)
    .map(([id,p],i) => `<tr>
      <td style="padding:8px 12px;color:var(--text-muted);font-size:.8rem">${i+1}</td>
      <td style="padding:8px 12px"><a href="#/atleta/${esc(id)}" style="font-weight:600">${esc(getName(id))}</a></td>
      <td style="padding:8px 12px;font-family:var(--font-display);font-size:1.2rem;color:var(--red-hot)">${p}</td>
    </tr>`).join('');

  // Distribuzione vittorie per team (top 8)
  const teamBars = Object.entries(teamMap).sort((a,b)=>b[1].wins-a[1].wins).slice(0,8);
  const maxTeamW = teamBars[0]?.[1]?.wins || 1;
  const teamBarsHtml = teamBars.map(([id,{team,wins}]) => `
    <div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:3px">
        <span style="font-weight:600">${esc(team||id)}</span>
        <span style="color:var(--text-muted)">${wins} vitt.</span>
      </div>
      <div style="height:8px;background:var(--bg-elevated);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${Math.round(wins/maxTeamW*100)}%;background:linear-gradient(90deg,var(--red-hot),var(--yellow-race));border-radius:4px"></div>
      </div>
    </div>`).join('');

  // Attività per mese
  const monthMap = {};
  resultsRaw.forEach(r => {
    if (!r.data) return;
    const m = r.data.slice(0,7);
    if (!monthMap[m]) monthMap[m] = 0;
    monthMap[m]++;
  });
  const months = Object.entries(monthMap).sort((a,b)=>a[0]<b[0]?-1:1);
  const maxM = Math.max(...months.map(([,v])=>v), 1);
  const SI_MESI = ['','GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'];
  const monthBarsHtml = months.map(([ym,n]) => {
    const [,mm] = ym.split('-');
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <div style="width:30px;font-size:.7rem;color:var(--text-muted);text-align:right">${SI_MESI[parseInt(mm)]||mm}</div>
      <div style="flex:1;height:12px;background:var(--bg-elevated);border-radius:6px;overflow:hidden">
        <div style="height:100%;width:${Math.round(n/maxM*100)}%;background:var(--accent);border-radius:6px"></div>
      </div>
      <div style="width:24px;font-size:.75rem;font-weight:600;color:var(--text-main)">${n}</div>
    </div>`;
  }).join('');

  const cardBase = 'background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;padding:20px;text-align:center';
  const tableBase = 'background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden;margin-bottom:24px';

  setPage(`
    <div class="pg-header">
      <div class="pg-eyebrow">📊 ANALISI & DATI</div>
      <h1 class="pg-title">STATISTICHE</h1>
    </div>

    ${catTabsHtml}

    <!-- KPI categoria -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:28px">
      ${[['🏁',catRaces,'Gare'],['👤',catAthletes,'Atleti attivi'],['🏆',catWins,'Vittorie totali'],['🛣️',catKm,'Km totali']].map(([icon,val,lbl])=>`
        <div style="${cardBase}">
          <div style="font-size:1.6rem;margin-bottom:4px">${icon}</div>
          <div style="font-family:var(--font-display);font-size:1.8rem;color:var(--red-hot);line-height:1">${val}</div>
          <div style="font-family:var(--font-heading);font-size:.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.1em;margin-top:4px">${lbl}</div>
        </div>`).join('')}
    </div>

    <!-- Protagonisti -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:28px">
      ${topWinner ? `<div style="${cardBase}"><div style="font-size:1.3rem">👑</div><div style="font-size:.65rem;font-family:var(--font-heading);color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin:4px 0">Top vincitore</div><div style="font-weight:700;font-size:.9rem"><a href="#/atleta/${esc(topWinner[0])}">${esc(getName(topWinner[0]))}</a></div><div style="font-size:.75rem;color:var(--text-muted);margin-top:2px">${topWinner[1]} vittorie</div></div>` : ''}
      ${topScorer ? `<div style="${cardBase}"><div style="font-size:1.3rem">🔥</div><div style="font-size:.65rem;font-family:var(--font-heading);color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin:4px 0">Top marcatore</div><div style="font-weight:700;font-size:.9rem"><a href="#/atleta/${esc(topScorer[0])}">${esc(getName(topScorer[0]))}</a></div><div style="font-size:.75rem;color:var(--text-muted);margin-top:2px">${topScorer[1]} punti</div></div>` : ''}
      ${topConsist ? `<div style="${cardBase}"><div style="font-size:1.3rem">🎯</div><div style="font-size:.65rem;font-family:var(--font-heading);color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin:4px 0">Più costante</div><div style="font-weight:700;font-size:.9rem"><a href="#/atleta/${esc(topConsist.id)}">${esc(getName(topConsist.id))}</a></div><div style="font-size:.75rem;color:var(--text-muted);margin-top:2px">${topConsist.pct}% podi su ${topConsist.g} gare</div></div>` : ''}
      ${topTeam ? `<div style="${cardBase}"><div style="font-size:1.3rem">🏅</div><div style="font-size:.65rem;font-family:var(--font-heading);color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin:4px 0">Team dominante</div><div style="font-weight:700;font-size:.85rem"><a href="#/team/${esc(topTeam.team)}">${esc(topTeam.team)}</a></div><div style="font-size:.75rem;color:var(--text-muted);margin-top:2px">${topTeam.wins} vittorie</div></div>` : ''}
    </div>

    <!-- Classifiche top 10 -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px;margin-bottom:28px">
      <div style="${tableBase}">
        <div style="padding:12px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border-subtle);font-family:var(--font-heading);font-weight:700;font-size:.85rem;text-transform:uppercase;letter-spacing:.06em">🥇 Più vittorie</div>
        <table style="width:100%;border-collapse:collapse"><tbody>${top10Wins}</tbody></table>
      </div>
      <div style="${tableBase}">
        <div style="padding:12px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border-subtle);font-family:var(--font-heading);font-weight:700;font-size:.85rem;text-transform:uppercase;letter-spacing:.06em">📊 Più punti</div>
        <table style="width:100%;border-collapse:collapse"><tbody>${top10Pts}</tbody></table>
      </div>
    </div>

    <!-- Distribuzione team + attività per mese -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;margin-bottom:28px">
      ${teamBarsHtml ? `<div style="${tableBase}">
        <div style="padding:12px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border-subtle);font-family:var(--font-heading);font-weight:700;font-size:.85rem;text-transform:uppercase;letter-spacing:.06em">🏆 Vittorie per Team</div>
        <div style="padding:16px">${teamBarsHtml}</div>
      </div>` : ''}
      <div style="${tableBase}">
        <div style="padding:12px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border-subtle);font-family:var(--font-heading);font-weight:700;font-size:.85rem;text-transform:uppercase;letter-spacing:.06em">📅 Gare per Mese</div>
        <div style="padding:16px">${monthBarsHtml || '<p style="color:var(--text-muted)">Dati insufficienti</p>'}</div>
      </div>
    </div>
  `);
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
  const { resultsRaw, athletes, calendar } = globalData;

  // ── Hub auto-fill ─────────────────────────────────────────────────────────
  if (activeHub && !compCat) {
    compGender = activeHub.gender;
    compCat    = activeHub.mainCat;
  }

  // ── Utilities ─────────────────────────────────────────────────────────────
  const catFilter  = r => r.genere === compGender && (!compCat || getRankingFileCode(r) === compCat);
  const allCatRes  = resultsRaw.filter(catFilter);
  // lastDate = ultima data reale nei dati, per finestre temporali coerenti
  const lastDate   = allCatRes.reduce((mx,r) => (r.data||'') > mx ? r.data : mx, '')
                     || new Date().toISOString().split('T')[0];
  const dateMinus  = days => {
    const d = new Date(lastDate + 'T00:00:00'); d.setDate(d.getDate()-days);
    return d.toISOString().split('T')[0];
  };
  const cut14  = dateMinus(14);
  const cut30  = dateMinus(30);
  const cut60  = dateMinus(60);
  const today  = new Date().toISOString().split('T')[0];
  // cName: estrae il cognome da una stringa "COGNOME Nome".
  // Il cognome può avere più parole (DE ROSA, DAL FARRA, ecc.).
  // Strategia: rimuovi l'ultima parola (il nome proprio, tipicamente 1 parola) e tieni il resto.
  const cName  = n => {
    if (!n) return '';
    const words = n.trim().split(/\s+/);
    return words.length > 1 ? words.slice(0, -1).join(' ') : words[0];
  };

  // ── Category dropdown ──────────────────────────────────────────────────────
  const availCats = [...new Set(
    resultsRaw.filter(r => r.genere === compGender).map(r => getRankingFileCode(r)).filter(Boolean)
  )].sort();
  const catOpts = availCats.map(c =>
    `<option value="${esc(c)}" ${c===compCat?'selected':''}>${esc(catLabel(c))}</option>`
  ).join('');

  // ─────────────────────────────────────────────────────────────────────────
  // STATS — usa finestre TEMPORALI, non conteggio posizioni.
  // I risultati non sono consecutivi: possono distare settimane.
  // ─────────────────────────────────────────────────────────────────────────

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

  // ── FORM PILLS (last N results as colored dots) ───────────────
  const formPills = results => {
    if (!results.length) return '<span style="color:var(--text-muted);font-size:0.8rem">—</span>';
    return results.map(r => {
      const p = r.posizione;
      let bg='var(--bg-elevated)', col='var(--text-muted)';
      if (p===1)      { bg='#D97706'; col='#fff'; }
      else if (p<=3)  { bg='#64748b'; col='#fff'; }
      else if (p<=5)  { bg='rgba(255,107,0,0.7)'; col='#fff'; }
      return `<span class="form-pill" style="background:${bg};color:${col}">${p}°</span>`;
    }).join('');
  };

  // ── BATTLE ROUND (single metric duel row) ─────────────────────
  // Restituisce HTML per un round in stile sport TV.
  // inv=true → vince il valore più BASSO (es. posizione media)
  const battleRound = (vA, vB, label, fmt='', inv=false) => {
    const nA = parseFloat(vA) || 0;
    const nB = parseFloat(vB) || 0;
    let wA, wB;
    if (inv) { wA = nA > 0 && (nA < nB || nB === 0); wB = nB > 0 && (nB < nA || nA === 0); }
    else     { wA = nA > nB; wB = nB > nA; }
    const tot = (inv ? (1/(nA||0.01) + 1/(nB||0.01)) : (nA+nB)) || 1;
    const pA  = inv
      ? Math.round((1/(nA||0.01)) / tot * 100)
      : Math.round(nA / tot * 100);
    const cls = wA ? 'battle-round-winner-a' : wB ? 'battle-round-winner-b' : '';
    return `<div class="battle-round ${cls}">
      <span class="battle-round-val battle-round-val-a">${vA}${fmt}</span>
      <div class="battle-round-center">
        <div class="battle-round-lbl">${label}</div>
        <div class="battle-bar-track">
          <div class="battle-bar-a" style="width:${pA}%"></div>
          <div class="battle-bar-b" style="width:${100-pA}%"></div>
        </div>
      </div>
      <span class="battle-round-val battle-round-val-b">${vB}${fmt}</span>
    </div>`;
  };

  // ── METRIC BAR (legacy — usato nel team block) ────────────────
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
          <span class="h2h-score-num" style="color:#D97706">${wA}</span>
          <span class="h2h-score-label">${esc(cName(nA))}</span>
        </div>
        <div class="h2h-score-center">
          <div class="h2h-bar-track"><div class="h2h-bar-fill" style="width:${pA}%"></div></div>
          <div class="h2h-score-sub">${shared.length} gare in comune</div>
        </div>
        <div class="h2h-score-side h2h-score-right">
          <span class="h2h-score-num" style="color:#16A34A">${wB}</span>
          <span class="h2h-score-label">${esc(cName(nB))}</span>
        </div>
      </div>
      <div class="results-table-wrap" style="margin-top:12px">
        <table class="results-table h2h-table">
          <thead><tr><th>DATA</th><th>GARA</th><th style="text-align:center">${esc(cName(nA))}</th><th></th><th style="text-align:center">${esc(cName(nB))}</th></tr></thead>
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

  // ── VERDICT (conta metriche vinte) ────────────────────────────
  const buildVerdict = (sA, sB, nA, nB) => {
    let scoreA=0, scoreB=0;
    const cmp = (a, b, inv=false) => {
      if (a===b) return;
      (inv ? a<b : a>b) ? scoreA++ : scoreB++;
    };
    cmp(sA.pts,          sB.pts);
    cmp(sA.wins,         sB.wins);
    cmp(sA.podi,         sB.podi);
    cmp(sA.top5,         sB.top5);
    cmp(sA.top10,        sB.top10);
    cmp(sA.convRate,     sB.convRate);
    cmp(sA.podioRate,    sB.podioRate);
    cmp(sA.consistRate,  sB.consistRate);
    cmp(sA.recent5pts,   sB.recent5pts);
    cmp(parseFloat(sA.avgPos)||99, parseFloat(sB.avgPos)||99, true);
    const total = scoreA + scoreB;
    const leadA = scoreA > scoreB, leadB = scoreB > scoreA;
    const winnerName = leadA ? nA : leadB ? nB : null;
    const winnerColor = leadA ? '#D97706' : leadB ? '#16A34A' : 'var(--text-muted)';
    const verdictText = winnerName
      ? `🏆 ${esc(cName(winnerName))}`
      : 'PARI';
    const subText = winnerName
      ? `conduce su ${total} metriche`
      : `equilibrio perfetto`;
    return { scoreA, scoreB, verdictText, winnerColor, subText, leadA, leadB };
  };

  // ── BADGES (chi primeggia in cosa) ────────────────────────────
  const buildBattleBadges = (sA, sB, nA, nB) => {
    const bA=[], bB=[];
    if(sA.pts       > sB.pts)       bA.push('⚡ Top scorer');      else if(sB.pts       > sA.pts)       bB.push('⚡ Top scorer');
    if(sA.wins      > sB.wins)      bA.push('🏆 Più vittorie');    else if(sB.wins      > sA.wins)      bB.push('🏆 Più vittorie');
    if(sA.recent5pts> sB.recent5pts)bA.push('🔥 Forma migliore'); else if(sB.recent5pts> sA.recent5pts)bB.push('🔥 Forma migliore');
    if(sA.consistRate>sB.consistRate)bA.push('🎯 Più regolare');  else if(sB.consistRate>sA.consistRate)bB.push('🎯 Più regolare');
    if(sA.convRate  > sB.convRate)  bA.push('⚔️ Miglior conv.');  else if(sB.convRate  > sA.convRate)  bB.push('⚔️ Miglior conv.');
    if(!bA.length && !bB.length) return '';
    const chips = (arr, col) => arr.map(b=>`<span class="comp-badge" style="border-color:${col};color:${col}">${b}</span>`).join('');
    return `<div class="battle-badge-row">
      <div class="battle-badges-side battle-badges-a">${chips(bA,'#D97706')}</div>
      <div></div>
      <div class="battle-badges-side battle-badges-b">${chips(bB,'#16A34A')}</div>
    </div>`;
  };

  // ── PROFILO PER DISTANZA (sezione compatta) ───────────────────
  const buildDistProfile = (aRes, bRes, nA, nB) => {
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
        <td style="text-align:right;padding:7px 12px 7px 0;font-size:0.82rem;font-weight:${winA?700:400};color:${winA?'#D97706':'var(--text-secondary)'}">
          ${ptsA} pt${wA?` · <strong style="font-size:.7rem">${wA}V</strong>`:''}
        </td>
        <td class="comp-dist-lbl">${label}</td>
        <td style="text-align:left;padding:7px 0 7px 12px;font-size:0.82rem;font-weight:${winB?700:400};color:${winB?'#16A34A':'var(--text-secondary)'}">
          ${ptsB} pt${wB?` · <strong style="font-size:.7rem">${wB}V</strong>`:''}
        </td>
      </tr>`;
    };
    const rows = [
      distRow('CORTA < 80 km',   dA.short, dB.short),
      distRow('MEDIA 80–130 km', dA.mid,   dB.mid),
      distRow('LUNGA > 130 km',  dA.long,  dB.long),
    ].join('');
    if (!rows) return '';
    return `<table class="comp-dist-table">
      <thead><tr>
        <th style="text-align:right;font-size:0.6rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);padding-bottom:6px">${esc(cName(nA))}</th>
        <th class="comp-dist-lbl">DISTANZA</th>
        <th style="text-align:left;font-size:0.6rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);padding-bottom:6px">${esc(cName(nB))}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  };

  // ── ULTIMI RISULTATI ──────────────────────────────────────────
  const buildRecentResults = (res, name, color) => {
    const sorted = [...res].sort((a,b)=>(b.data||'').localeCompare(a.data||'')).slice(0,8);
    if (!sorted.length) return `<div style="color:var(--text-muted);padding:12px 0;font-size:0.82rem">Nessun risultato</div>`;
    return `<div>
      <div class="comp-recent-name" style="color:${color}">${esc(name)}</div>
      <table class="results-table" style="font-size:0.78rem;width:100%">
        <thead><tr><th>DATA</th><th>GARA</th><th style="text-align:center">POS</th><th style="text-align:right">PT</th></tr></thead>
        <tbody>${sorted.map(r=>`<tr>
          <td class="td-date" style="white-space:nowrap">${fmtDateShort(r.data)}</td>
          <td class="td-race" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            <a href="#/gara/${esc(r.gara_id)}">${esc(r.nome_gara)}</a>
          </td>
          <td class="td-pos ${posClass(r.posizione)}" style="text-align:center;font-weight:700">${r.posizione}°</td>
          <td style="text-align:right;color:var(--text-muted);font-size:0.72rem">${r.punti_effettivi||0}</td>
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
        <div class="comp-empty-text">Seleziona due atleti per avviare la sfida</div>
      </div>`;

    const aD=athletes[compA], bD=athletes[compB];
    if (!aD||!bD) return '<div class="comp-empty">Dati non disponibili</div>';
    const aRes=resultsRaw.filter(r=>r.atleta_id===compA&&catFilter(r));
    const bRes=resultsRaw.filter(r=>r.atleta_id===compB&&catFilter(r));
    const sA=calcStats(aRes), sB=calcStats(bRes);
    const nA=`${aD.cognome} ${aD.nome}`, nB=`${bD.cognome} ${bD.nome}`;
    const iA=((aD.cognome||'?')[0]+(aD.nome||'?')[0]).toUpperCase();
    const iB=((bD.cognome||'?')[0]+(bD.nome||'?')[0]).toUpperCase();
    const verdict = buildVerdict(sA, sB, nA, nB);

    // Share URL
    const shareUrl = `${location.origin}${location.pathname}#/comparatore?a=${encodeURIComponent(compA)}&b=${encodeURIComponent(compB)}&g=${compGender}${compCat?'&cat='+encodeURIComponent(compCat):''}`;

    return `
      <!-- Selettori compatti -->
      <div class="comp-selectors-compact">
        ${buildCompAc('a', acItems, compA)}
        <span class="comp-vs-sm">VS</span>
        ${buildCompAc('b', acItems, compB)}
      </div>

      <!-- ① BATTLE ARENA -->
      <div class="battle-arena">
        <div class="battle-side battle-side-a">
          <div class="battle-avatar battle-avatar-a">${iA}</div>
          <div class="battle-name">${esc(nA)}</div>
          <div class="battle-team">${esc(aD.team_attuale||'—')}</div>
          <div class="battle-stats-row">
            <div class="battle-stat">
              <div class="battle-stat-val" style="color:#D97706">${sA.wins}</div>
              <div class="battle-stat-lbl">Vitt.</div>
            </div>
            <div class="battle-stat">
              <div class="battle-stat-val">${sA.podi}</div>
              <div class="battle-stat-lbl">Podi</div>
            </div>
            <div class="battle-stat">
              <div class="battle-stat-val">${sA.pts}</div>
              <div class="battle-stat-lbl">Pt</div>
            </div>
          </div>
          <div class="battle-form-strip">${formPills(sA.recent8)}</div>
          <div class="battle-trend" style="color:${sA.trend.color}">${sA.trend.label}</div>
        </div>

        <div class="battle-vs">
          <div class="battle-vs-text">VS</div>
        </div>

        <div class="battle-side battle-side-b">
          <div class="battle-avatar battle-avatar-b">${iB}</div>
          <div class="battle-name">${esc(nB)}</div>
          <div class="battle-team">${esc(bD.team_attuale||'—')}</div>
          <div class="battle-stats-row">
            <div class="battle-stat">
              <div class="battle-stat-val" style="color:#16A34A">${sB.wins}</div>
              <div class="battle-stat-lbl">Vitt.</div>
            </div>
            <div class="battle-stat">
              <div class="battle-stat-val">${sB.podi}</div>
              <div class="battle-stat-lbl">Podi</div>
            </div>
            <div class="battle-stat">
              <div class="battle-stat-val">${sB.pts}</div>
              <div class="battle-stat-lbl">Pt</div>
            </div>
          </div>
          <div class="battle-form-strip">${formPills(sB.recent8)}</div>
          <div class="battle-trend" style="color:${sB.trend.color}">${sB.trend.label}</div>
        </div>
      </div>

      <!-- ② VERDICT PANEL -->
      <div class="battle-verdict">
        <div class="battle-verdict-score battle-verdict-score-a">${verdict.scoreA}</div>
        <div class="battle-verdict-mid">
          <div class="battle-verdict-label">Metriche vinte</div>
          <div class="battle-verdict-winner" style="color:${verdict.winnerColor}">${verdict.verdictText}</div>
          <div class="battle-verdict-sub">${verdict.subText}</div>
          <button class="battle-share-btn" onclick="window.shareBattle(${JSON.stringify(shareUrl)}, ${JSON.stringify(nA + ' vs ' + nB)})">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            Condividi sfida
          </button>
        </div>
        <div class="battle-verdict-score battle-verdict-score-b">${verdict.scoreB}</div>
      </div>

      <!-- ③ BADGE ACHIEVEMENTS -->
      ${buildBattleBadges(sA, sB, nA, nB)}

      <!-- ④ ROUND BY ROUND -->
      <div class="battle-rounds">
        <div class="battle-rounds-header">
          <span class="battle-rounds-title">Round by Round</span>
          <span style="font-size:0.65rem;color:var(--text-muted)">su stagione completa</span>
        </div>
        ${battleRound(sA.pts,          sB.pts,          'PUNTI',              ' pt')}
        ${battleRound(sA.wins,         sB.wins,         'VITTORIE')}
        ${battleRound(sA.podi,         sB.podi,         'PODI (TOP 3)')}
        ${battleRound(sA.top5,         sB.top5,         'TOP 5')}
        ${battleRound(sA.top10,        sB.top10,        'TOP 10')}
        ${battleRound(sA.gare,         sB.gare,         'GARE CON RISULTATO')}
        ${battleRound(sA.convRate,     sB.convRate,     'VITTORIE SUI RISULTATI', '%')}
        ${battleRound(sA.podioRate,    sB.podioRate,    'PODI SUI RISULTATI',     '%')}
        ${battleRound(sA.consistRate,  sB.consistRate,  'REGOLARITÀ TOP-10',      '%')}
        ${sA.avgPos!=='—'&&sB.avgPos!=='—' ? battleRound(sA.avgPos+'°', sB.avgPos+'°', 'POSIZIONE MEDIA', '', true) : ''}
        ${battleRound(sA.recent5pts,   sB.recent5pts,   'FORMA RECENTE (5 ris.)', ' pt')}
      </div>

      <!-- ⑤ TREND -->
      <div class="comp-section">
        <div class="comp-section-title">Trend & Profilo</div>
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
        ${buildDistProfile(aRes, bRes, nA, nB)}
      </div>

      <!-- ⑥ TESTA A TESTA DIRETTO -->
      ${buildH2H(aRes, bRes, nA, nB)}

      <!-- ⑦ ULTIMI RISULTATI -->
      <div class="comp-section">
        <div class="comp-section-title">Ultimi Risultati</div>
        <div class="comp-recent-split">
          ${buildRecentResults(aRes, nA, '#D97706')}
          ${buildRecentResults(bRes, nB, '#16A34A')}
        </div>
      </div>`;
  };

  // ── TEAM BLOCK ────────────────────────────────────────────────
  const buildTeamResult = () => {
    const teamMap = {};
    resultsRaw.filter(r=>r.genere===compGender&&(!compCat||getRankingFileCode(r)===compCat))
      .forEach(r=>{ if(r.team_id) teamMap[r.team_id]={id:r.team_id,nome:r.team}; });
    const list = Object.values(teamMap).sort((a,b)=>(a.nome||'').localeCompare(b.nome||''));

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
        <div class="comp-empty-text">Seleziona due team per avviare la sfida</div>
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
    const verdict = buildVerdict(sA, sB, nA, nB);

    const shareUrl = `${location.origin}${location.pathname}#/comparatore?a=${encodeURIComponent(compA)}&b=${encodeURIComponent(compB)}&g=${compGender}&mode=team${compCat?'&cat='+encodeURIComponent(compCat):''}`;

    return `
      <div class="comp-selectors-compact">
        ${buildCompAc('a', acItemsT, compA)}
        <span class="comp-vs-sm">VS</span>
        ${buildCompAc('b', acItemsT, compB)}
      </div>

      <!-- BATTLE ARENA TEAM -->
      <div class="battle-arena">
        <div class="battle-side battle-side-a">
          <div class="battle-avatar battle-avatar-a" style="border-radius:12px;font-size:1.1rem">${iA}</div>
          <div class="battle-name">${esc(nA)}</div>
          <div class="battle-team">${sA.atleti} corridori schierati</div>
          <div class="battle-stats-row">
            <div class="battle-stat">
              <div class="battle-stat-val" style="color:#D97706">${sA.wins}</div>
              <div class="battle-stat-lbl">Vitt.</div>
            </div>
            <div class="battle-stat">
              <div class="battle-stat-val">${sA.podi}</div>
              <div class="battle-stat-lbl">Podi</div>
            </div>
            <div class="battle-stat">
              <div class="battle-stat-val">${sA.pts}</div>
              <div class="battle-stat-lbl">Pt</div>
            </div>
          </div>
          <div class="battle-trend" style="color:${sA.trend.color}">${sA.trend.label}</div>
        </div>
        <div class="battle-vs"><div class="battle-vs-text">VS</div></div>
        <div class="battle-side battle-side-b">
          <div class="battle-avatar battle-avatar-b" style="border-radius:12px">${iB}</div>
          <div class="battle-name">${esc(nB)}</div>
          <div class="battle-team">${sB.atleti} corridori schierati</div>
          <div class="battle-stats-row">
            <div class="battle-stat">
              <div class="battle-stat-val" style="color:#16A34A">${sB.wins}</div>
              <div class="battle-stat-lbl">Vitt.</div>
            </div>
            <div class="battle-stat">
              <div class="battle-stat-val">${sB.podi}</div>
              <div class="battle-stat-lbl">Podi</div>
            </div>
            <div class="battle-stat">
              <div class="battle-stat-val">${sB.pts}</div>
              <div class="battle-stat-lbl">Pt</div>
            </div>
          </div>
          <div class="battle-trend" style="color:${sB.trend.color}">${sB.trend.label}</div>
        </div>
      </div>

      <!-- VERDICT TEAM -->
      <div class="battle-verdict">
        <div class="battle-verdict-score battle-verdict-score-a">${verdict.scoreA}</div>
        <div class="battle-verdict-mid">
          <div class="battle-verdict-label">Metriche vinte</div>
          <div class="battle-verdict-winner" style="color:${verdict.winnerColor}">${verdict.verdictText}</div>
          <div class="battle-verdict-sub">${verdict.subText}</div>
          <button class="battle-share-btn" onclick="window.shareBattle(${JSON.stringify(shareUrl)}, ${JSON.stringify(nA + ' vs ' + nB)})">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            Condividi sfida
          </button>
        </div>
        <div class="battle-verdict-score battle-verdict-score-b">${verdict.scoreB}</div>
      </div>

      ${buildBattleBadges(sA, sB, nA, nB)}

      <div class="comp-section">
        <div class="comp-section-title">Statistiche Team</div>
        <div class="comp-stats-grid">
          ${mBar(sA.pts,    sB.pts,    'PUNTI',              ' pt', true)}
          ${mBar(sA.wins,   sB.wins,   'VITTORIE')}
          ${mBar(sA.podi,   sB.podi,   'PODI (TOP 3)')}
          ${mBar(sA.top5,   sB.top5,   'TOP 5')}
          ${mBar(sA.top10,  sB.top10,  'TOP 10')}
          ${mBar(sA.gare,   sB.gare,   'GARE CON RISULTATO')}
          ${mBar(sA.convRate,    sB.convRate,    'VITTORIE SUI RISULTATI', '%')}
          ${mBar(sA.podioRate,   sB.podioRate,   'PODI SUI RISULTATI',     '%')}
          ${mBar(sA.consistRate, sB.consistRate, 'REGOLARITÀ TOP-10',      '%')}
          ${mBar(sA.recent5pts,  sB.recent5pts,  'FORMA RECENTE (5 ris.)', ' pt')}
          ${mBar(sA.atleti, sB.atleti, 'CORRIDORI SCHIERATI')}
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
        <div class="comp-section-title">Ultimi Risultati</div>
        <div class="comp-recent-split">
          ${buildRecentResults(aRes, nA, '#D97706')}
          ${buildRecentResults(bRes, nB, '#16A34A')}
        </div>
      </div>`;
  };

  // ── URL param deep-link (condivisione sfida) ──────────────────
  const hashParams = new URLSearchParams(location.hash.replace(/^[^?]*\??/, ''));
  if (hashParams.get('a') && !compA) {
    compA = hashParams.get('a');
    compB = hashParams.get('b') || '';
    if (hashParams.get('g')) compGender = hashParams.get('g');
    if (hashParams.get('cat')) compCat = hashParams.get('cat');
    if (hashParams.get('mode')) compMode = hashParams.get('mode');
  }

  // ── PAGE RENDER ───────────────────────────────────────────────
  setPage(`
    <div class="pg-header">
      <div class="pg-eyebrow">⚔️ SFIDA</div>
      <h1 class="pg-title">COMPARATORE</h1>
    </div>
    <div class="comp-filter-bar">
      <div class="comp-mode-tabs">
        <button class="comp-tab ${compMode==='atleta'?'comp-tab-active-a':''}" onclick="window.setCompMode('atleta')">Atleti</button>
        <button class="comp-tab ${compMode==='team'?'comp-tab-active-b':''}"   onclick="window.setCompMode('team')">Team</button>
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

// ── SHARE BATTLE ──────────────────────────────────────────────
window.shareBattle = (url, title) => {
  if (navigator.share) {
    navigator.share({ title: `ItaliacritResultati — ${title}`, url })
      .catch(() => {});
  } else {
    navigator.clipboard?.writeText(url).then(() => {
      showToast('Link sfida copiato!', 'success');
    }).catch(() => {
      showToast('Copia: ' + url, 'info');
    });
  }
};

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

// Cache profili media per la ricerca
let _mediaProfilesCache = null;
async function _loadMediaProfiles() {
  if (_mediaProfilesCache) return _mediaProfilesCache;
  try {
    const d = await fetch(`${API_BASE}/media/profiles`).then(r => r.json());
    _mediaProfilesCache = d.profiles || [];
  } catch { _mediaProfilesCache = []; }
  return _mediaProfilesCache;
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

  // Mostra subito quello che abbiamo, poi aggiunge media in async
  const renderDropdown = (list) => {
    if (!list.length) {
      dropdown.innerHTML = '<div class="search-result-item"><span class="search-result-sub">Nessun risultato</span></div>';
    } else {
      dropdown.innerHTML = list.map(r => `
        <div class="search-result-item" onclick="goTo('#/${r.type === 'media' ? 'media' : r.type}/${r.id}'); window.closeAllSearchDropdowns()">
          <div>
            <div class="search-result-label">${r.type === 'atleta' ? 'ATLETA' : r.type === 'media' ? '📷 FOTOGRAFO' : 'TEAM'}</div>
            <div class="search-result-name">${esc(r.display)}</div>
            <div class="search-result-sub">${esc(r.sub)}</div>
          </div>
        </div>`).join('');
    }
    dropdown.style.display = 'block';
  };

  renderDropdown(results);

  // Arricchisci con fotografer (async, non blocca)
  _loadMediaProfiles().then(profiles => {
    const mediaResults = profiles
      .filter(p => (p.display_name||'').toLowerCase().includes(ql))
      .slice(0, 3)
      .map(p => ({ type: 'media', id: p.id, display: p.display_name, sub: p.bio || 'Fotografo' }));
    if (mediaResults.length) renderDropdown([...results, ...mediaResults]);
  });
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

// ── NAV DROPDOWNS (click-based) ───────────────────────────────
function initNavDropdowns() {
  // Chiudi tutti i gruppi aperti
  function closeAll() {
    document.querySelectorAll('.nav-group.open').forEach(g => {
      g.classList.remove('open');
      g.querySelector('.nav-group-btn')?.setAttribute('aria-expanded', 'false');
    });
  }

  // Click sul bottone del gruppo → toggle open
  document.querySelectorAll('.nav-group-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const group = this.closest('.nav-group');
      const wasOpen = group.classList.contains('open');
      closeAll();
      if (!wasOpen) {
        group.classList.add('open');
        this.setAttribute('aria-expanded', 'true');
      }
    });
  });

  // Click su una voce del menu → chiudi il dropdown
  document.querySelectorAll('.nav-group-item').forEach(item => {
    item.addEventListener('click', () => closeAll());
  });

  // Click fuori dal nav-group → chiudi
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.nav-group')) closeAll();
  });

  // Escape → chiudi
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeAll();
  });
}

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
      const _photoCreditRis = (() => {
        if (!featuredPhoto) return '';
        if (featuredPhoto.photographer) return '📷 ' + featuredPhoto.photographer;
        if (featuredPhoto.display_name)  return '📷 ' + featuredPhoto.display_name;
        if (featuredPhoto.album_slug || featuredPhoto.source === 'xpix') return '📷 xpix.it';
        if (featuredPhoto.source === 'italiaciclismo') return '📷 italiaciclismo.net';
        return '';
      })();
      const photoEl = _photoSrcRis
        ? `<a href="#/gara/${esc(race.id)}" class="ris-card-photo${featuredVideoId ? ' ris-media-half' : ''}">
             <img src="${esc(_photoSrcRis)}" alt="Foto gara" loading="lazy"/>
             ${_photoCreditRis ? `<div class="ris-photo-credit">${esc(_photoCreditRis)}</div>` : ''}
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
  // ── Stile Velon: dark pulito, flat, data-forward ──
  // Base quasi-nera con leggerissimo gradiente verticale
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0c0e12'); g.addColorStop(0.6, '#0a0c10'); g.addColorStop(1, '#070809');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Soft glow accent in alto a destra (molto tenue)
  const rg = ctx.createRadialGradient(W * 0.92, -H * 0.05, 0, W * 0.92, -H * 0.05, W * 0.95);
  rg.addColorStop(0, 'rgba(232,0,29,0.10)'); rg.addColorStop(1, 'transparent');
  ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
  // Sottile filo accento sul bordo sinistro (brand, discreto)
  ctx.fillStyle = '#e8001d'; ctx.fillRect(0, 0, Math.max(3, Math.round(W * 0.005)), H);
}
function _header(ctx, logo, W, H, classData) {
  // ── Stile Velon: header flat, niente barra scura, logo che siede sul fondo dark ──
  const bH = Math.round(H * 0.092);
  // Logo ITC grande
  let logoRight = 18;
  if (logo) {
    const lH = Math.round(bH * 0.92), lW = Math.round(lH * logo.naturalWidth / logo.naturalHeight);
    ctx.drawImage(logo, 18, Math.round((bH - lH) / 2), lW, lH);
    logoRight = 18 + lW;
  }
  const isRegio = classData && classData.scope === 'regionale' && classData.region;
  // ── Wordmark accanto al logo, TUTTO MAIUSCOLO (es. TOSCANACRIT) ──
  const brand = isRegio
    ? (classData.region.replace(/\s+/g, '') + 'CRIT').toUpperCase()
    : 'ITALIACRIT';
  {
    // separatore verticale sottile
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(logoRight + 16, Math.round(bH * 0.28), 2, Math.round(bH * 0.44));
    const wfs = Math.round(bH * 0.30);
    ctx.font = `700 ${wfs}px 'Inter Tight',sans-serif`;
    ctx.letterSpacing = '1px';
    ctx.fillStyle = isRegio ? '#f5c400' : 'rgba(255,255,255,0.90)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(brand, logoRight + 30, Math.round(bH * 0.52));
    ctx.textBaseline = 'alphabetic'; ctx.letterSpacing = '0px';
  }

  if (classData) {
    // ── A destra: "CLASSIFICA <categoria>" (+ mese se filtrato) ──
    const lblFs = Math.round(bH * 0.24);
    ctx.textAlign = 'right';
    const catTxt = (classData.catLabel || '').toUpperCase();
    // categoria (bianca) + label "CLASSIFICA" (muted), su stessa baseline
    const baseY = classData.month ? Math.round(bH * 0.46) : Math.round(bH * 0.58);
    ctx.font = `700 ${lblFs}px 'Inter Tight',sans-serif`; ctx.fillStyle = '#f2f2f2';
    ctx.fillText(catTxt, W - 18, baseY);
    const catW = ctx.measureText(catTxt).width;
    ctx.font = `500 ${lblFs}px 'Inter Tight',sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.letterSpacing = '1px';
    ctx.fillText('CLASSIFICA ', W - 18 - catW - 10, baseY);
    ctx.letterSpacing = '0px';
    if (classData.month) {
      ctx.font = `600 ${Math.round(lblFs * 0.78)}px 'Inter Tight',sans-serif`;
      ctx.fillStyle = '#f5c400';
      ctx.fillText(classData.month.toUpperCase(), W - 18, Math.round(bH * 0.80));
    }
    ctx.textAlign = 'left';
  } else {
    // atleta / team: brand + URL a destra
    const fs = Math.round(bH * 0.26);
    ctx.font = `600 ${fs}px 'Inter Tight',sans-serif`;
    ctx.letterSpacing = '2px';
    ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.textAlign = 'right';
    ctx.fillText('ITALIACRIT', W - 18, Math.round(bH * 0.50));
    ctx.letterSpacing = '0px';
    ctx.font = `400 ${Math.round(fs * 0.50)}px 'Inter Tight',sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.fillText(SHARE_URL, W - 18, Math.round(bH * 0.80));
    ctx.textAlign = 'left';
  }
  // Filo divisorio discreto
  ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(0, bH, W, 1);
}
// ── Disegna le 3 icone social nel footer (Instagram, Facebook, Sito) ──
// Usa i glifi SVG ufficiali (da _SVGS) via Path2D, scalati nel box sz×sz.
function _drawSocialIcons(ctx, cx, cy, sz, color) {
  const dOf = key => { const m = /\bd="([^"]+)"/.exec(_SVGS[key] || ''); return m ? m[1] : null; };
  const drawSvg = (key, x, y) => {
    const d = dOf(key);
    if (!d || typeof Path2D === 'undefined') return false;
    ctx.save();
    ctx.translate(x, y); ctx.scale(sz / 24, sz / 24);
    ctx.fillStyle = color;
    try { ctx.fill(new Path2D(d), 'evenodd'); } catch (e) { ctx.restore(); return false; }
    ctx.restore();
    return true;
  };
  const drawGlobe = (x, y) => {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, sz * 0.07);
    const r = sz / 2, mx = x + r, my = y + r;
    ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, my); ctx.lineTo(x + sz, my); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mx, y); ctx.lineTo(mx, y + sz); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(mx, my, r * 0.52, r, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  };
  const items = [
    (x, y) => drawSvg('instagram', x, y),
    (x, y) => drawSvg('facebook', x, y),
    (x, y) => drawGlobe(x, y),
  ];
  const gap = sz * 1.7;
  const totalW = gap * (items.length - 1);
  let x = cx - totalW / 2 - sz / 2;
  const y = cy - sz / 2;
  items.forEach((draw) => { draw(x, y); x += gap; });
  ctx.textAlign = 'left';
}
function _footer(ctx, W, H) {
  // ── Stile Velon: footer minimale, niente barra scura ──
  const fH = Math.round(H * 0.06); const y = H - fH;
  // linea divisoria sottile
  ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(0, y, W, 1);
  // micro accento tricolore (sobrio, in basso a sinistra)
  const s = 2, accW = Math.round(W * 0.018), ax = Math.round(W * 0.012), ay = y + Math.round(fH * 0.42);
  ctx.fillStyle = '#009246'; ctx.fillRect(ax, ay, accW, s);
  ctx.fillStyle = '#f0f0ee'; ctx.fillRect(ax + accW, ay, accW, s);
  ctx.fillStyle = '#ce2b37'; ctx.fillRect(ax + accW * 2, ay, accW, s);
  // ── Icone social al centro: Instagram · Facebook · Sito ──
  _drawSocialIcons(ctx, W / 2, y + Math.round(fH * 0.50), Math.round(fH * 0.40), 'rgba(255,255,255,0.55)');
  // handle a destra
  ctx.font = `500 ${Math.round(fH * 0.30)}px 'Inter Tight',sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.32)'; ctx.textAlign = 'right';
  ctx.fillText('@italiacrit', W - Math.round(W * 0.012), y + Math.round(fH * 0.66));
  ctx.textAlign = 'left';
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

// ── Colonna risultati gara (riusabile: 1 o 2 colonne) ───────
// Righe a altezza uniforme + font ancorati alla larghezza (no ballooning su Storie/landscape)
function _drawGaraColumn(ctx, x, colW, topY, bottomY, slice, startIdx) {
  const medalBg = ['#f5c400','#c8c8c8','#cd7f32'];
  const medalFg = ['#1a1200','#1a1a1a','#2a1500'];
  const right = x + colW;
  const n = slice.length;
  if (!n) return;
  const rH = Math.round((bottomY - topY) / n);

  // Font unico per nome atleta (cognome + nome stessa dimensione)
  // e font leggermente più piccolo per il team sotto.
  // Cap sia per altezza riga che per larghezza colonna.
  const fsName = Math.min(Math.round(rH * 0.28), Math.round(colW * 0.052));
  const fsTm   = Math.round(fsName * 0.82);

  // Altezza del blocco testo (2 righe): usata per centrare verticalmente
  const lineGap  = Math.round(fsName * 0.35);  // spazio tra riga nome e riga team
  const blockH   = fsName + lineGap + fsTm;

  slice.forEach((r, i) => {
    const gIdx   = startIdx + i;
    const isTop3 = gIdx < 3;
    const isFirst = gIdx === 0;
    const ry = topY + i * rH;
    const cy = Math.round(ry + rH / 2);

    // ── Sfondo riga ──
    if (isFirst) {
      const goldG = ctx.createLinearGradient(x, ry, right, ry + rH);
      goldG.addColorStop(0, 'rgba(245,196,0,0.13)'); goldG.addColorStop(1, 'rgba(245,196,0,0.04)');
      ctx.fillStyle = goldG; ctx.fillRect(x, ry, colW, rH);
      ctx.strokeStyle = 'rgba(245,196,0,0.42)'; ctx.lineWidth = 1.5;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, ry+1, colW, rH-2, 7); ctx.stroke(); }
      else ctx.strokeRect(x, ry+1, colW, rH-2);
    } else if (gIdx === 1) {
      ctx.fillStyle = 'rgba(200,200,200,0.045)'; ctx.fillRect(x, ry, colW, rH);
    } else if (gIdx === 2) {
      ctx.fillStyle = 'rgba(205,127,50,0.035)'; ctx.fillRect(x, ry, colW, rH);
    } else if (i > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.045)'; ctx.fillRect(x, ry, colW, 1);
    }

    // ── Pill posizione ──
    const pillH = Math.min(Math.round(rH * 0.52), Math.round(colW * 0.075));
    const pillW = Math.round(pillH * 1.55);
    const pillX = x + Math.round(colW * 0.008);
    const pillY = cy - Math.round(pillH / 2);
    ctx.fillStyle = isTop3 ? medalBg[gIdx] : 'rgba(255,255,255,0.07)';
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(pillX, pillY, pillW, pillH, Math.round(pillH*0.2)); ctx.fill(); }
    else ctx.fillRect(pillX, pillY, pillW, pillH);
    const fsPos = Math.round(pillH * 0.56);
    ctx.font = `700 ${fsPos}px 'Inter Tight',sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = isTop3 ? medalFg[gIdx] : 'rgba(255,255,255,0.38)';
    ctx.fillText(String(gIdx+1).padStart(2,'0'), pillX + pillW/2, cy+1);

    // ── Blocco testo: nome (riga 1) + team (riga 2) ──
    const nameX   = pillX + pillW + Math.round(colW * 0.04);
    const maxW    = right - nameX - Math.round(colW * 0.02);
    const nameY   = cy - Math.round(blockH / 2) + fsName;       // baseline riga nome
    const teamY   = nameY + lineGap + fsTm;                      // baseline riga team

    // Riga 1 — COGNOME Nome, stessa grandezza, cognome in grassetto
    const fullName = ((r.cognome||'').toUpperCase() + ' ' + (r.nome||'')).trim();
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';

    // Clip se troppo lungo
    ctx.save();
    ctx.beginPath(); ctx.rect(nameX, ry+2, maxW, rH-4); ctx.clip();

    ctx.font = `600 ${fsName}px 'Inter Tight',sans-serif`;
    ctx.fillStyle = isTop3 ? '#f4f4f4' : 'rgba(255,255,255,0.88)';
    ctx.fillText(fullName, nameX, nameY);

    // Riga 2 — team, tono più chiaro
    if (r.team) {
      ctx.font = `400 ${fsTm}px 'Inter Tight',sans-serif`;
      ctx.fillStyle = isFirst ? 'rgba(255,255,255,0.52)' : 'rgba(255,255,255,0.36)';
      ctx.fillText(r.team, nameX, teamY);
    }

    ctx.restore();
  });
}

// ── GARA CARD v6 — UCI-inspired, no points, big names ────────
function _drawGara(ctx, W, H, d, logo) {
  const { name, date, cat, mult, tipo, km, media, results, region, luogo } = d;
  const pad = Math.round(W * 0.048);

  // ── Header compatto Velon: flat, logo a sinistra (grande) + regione accanto, URL a destra ──
  const hH = Math.round(H * 0.095);
  let logoRight = pad;
  if (logo) {
    const lH = Math.round(hH * 0.86);
    const lW = Math.round(lH * logo.naturalWidth / logo.naturalHeight);
    ctx.drawImage(logo, pad, Math.round((hH - lH) / 2), lW, lH);
    logoRight = pad + lW;
  } else {
    const fsLg = Math.round(hH * 0.42);
    ctx.font = `900 ${fsLg}px 'Inter Tight','Inter Tight',sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('ITALIACRIT', pad, Math.round(hH * 0.64));
    logoRight = pad + ctx.measureText('ITALIACRIT').width;
  }
  // Regione (o luogo) accanto al logo
  const regTxt = (region || luogo || '').toUpperCase();
  if (regTxt) {
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(logoRight + 16, Math.round(hH * 0.28), 2, Math.round(hH * 0.44));
    const rfs = Math.round(hH * 0.34);
    ctx.font = `800 ${rfs}px 'Inter Tight',sans-serif`;
    ctx.fillStyle = '#f5c400';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(regTxt, logoRight + 30, Math.round(hH * 0.52));
    ctx.textBaseline = 'alphabetic';
  }
  // Categoria in alto a destra (sostituisce l'URL italiacrit)
  const fsCatH = Math.round(hH * 0.36);
  ctx.font = `800 ${fsCatH}px 'Inter Tight',sans-serif`;
  ctx.letterSpacing = '1px';
  ctx.fillStyle = '#e8001d'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText(cat.toUpperCase(), W - pad, Math.round(hH * 0.52));
  ctx.letterSpacing = '0px'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  // Linea accento sottile flat sotto l'header
  ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(0, hH, W, 1);
  ctx.fillStyle = '#e8001d'; ctx.fillRect(pad, hH, Math.round(W * 0.10), 2);

  let y = hH + Math.round(H * 0.022);

  // ── Race name — singola riga auto-shrink ──
  // Parte da un font grande, riduce finché il nome entra in una riga sola.
  const fsTMax = Math.round(W * 0.052);
  const fsTMin = Math.round(W * 0.026);
  let fsT = fsTMax;
  const nameStr = name.toUpperCase();
  const nameMaxW = W - pad * 2;
  ctx.font = `700 ${fsT}px 'Inter Tight',sans-serif`;
  while (ctx.measureText(nameStr).width > nameMaxW && fsT > fsTMin) {
    fsT -= 1;
    ctx.font = `700 ${fsT}px 'Inter Tight',sans-serif`;
  }
  ctx.fillStyle = '#f4f4f4';
  y += fsT;
  ctx.fillText(nameStr, pad, y);
  y += Math.round(H * 0.006);

  // ── Meta riga: data · ×mult · km · media (categoria è già in header) ──
  const fsMeta = Math.round(W * 0.024);
  ctx.font = `400 ${fsMeta}px 'Inter Tight',sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.40)';
  const metaArr = [date, `×${mult}`];
  if (km)    metaArr.push(`${km} km`);
  if (media) metaArr.push(`media ${media} km/h`);
  y += fsMeta;
  ctx.fillText(metaArr.join('   ·   '), pad, y);
  y += Math.round(fsMeta * 0.8);

  // Accent divider flat (Velon): linea sottile + tratto brand
  ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(pad, y, W - pad * 2, 1);
  ctx.fillStyle = '#e8001d'; ctx.fillRect(pad, y, Math.round(W * 0.10), 2);
  y += Math.round(H * 0.012);

  // ── Footer Velon: minimale ──
  const fB = Math.round(H * 0.05);
  const footerY = H - fB;
  ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(0, footerY, W, 1);
  const s = 2, accW = Math.round(W * 0.018), ax = pad, ay = footerY + Math.round(fB * 0.40);
  ctx.fillStyle = '#009246'; ctx.fillRect(ax, ay, accW, s);
  ctx.fillStyle = '#f0f0ee'; ctx.fillRect(ax + accW, ay, accW, s);
  ctx.fillStyle = '#ce2b37'; ctx.fillRect(ax + accW * 2, ay, accW, s);
  // Icone social al centro + handle a destra
  _drawSocialIcons(ctx, W / 2, footerY + Math.round(fB * 0.50), Math.round(fB * 0.40), 'rgba(255,255,255,0.55)');
  ctx.font = `500 ${Math.round(fB * 0.3)}px 'Inter Tight',sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.textAlign = 'right';
  ctx.fillText('@italiacrit', W - pad, footerY + Math.round(fB * 0.66)); ctx.textAlign = 'left';

  // ── Results list (1 colonna; 2 colonne su formati landscape con >5 atleti) ──
  const listTop = y;
  const listBot = footerY - Math.round(H * 0.003);
  const maxR = Math.min(results.length, 10);
  const slice = results.slice(0, maxR);
  const landscape = W > H * 1.25;

  if (landscape && maxR > 5) {
    const gap = Math.round(W * 0.045);
    const colW = Math.round((W - pad * 2 - gap) / 2);
    _drawGaraColumn(ctx, pad, colW, listTop, listBot, slice.slice(0, 5), 0);
    _drawGaraColumn(ctx, pad + colW + gap, colW, listTop, listBot, slice.slice(5), 5);
  } else {
    _drawGaraColumn(ctx, pad, W - pad * 2, listTop, listBot, slice, 0);
  }
}

// ── ATLETA CARD ────────────────────────────────────────────
function _drawAtleta(ctx, W, H, d) {
  const {cognome,nome,cat,team,punti,pos,p1,p2,p3,gare} = d;
  const hB=Math.round(H*0.09),fB=Math.round(H*0.06),pad=Math.round(W*0.048);
  let y = hB + Math.round(H*0.05);
  // Cognome
  const fsC=Math.round(W*(cognome.length>12?0.065:0.085));
  ctx.font=`900 ${fsC}px 'Inter Tight','Inter Tight',sans-serif`; ctx.fillStyle='#f0f0f0';
  y=_wrap(ctx,cognome.toUpperCase(),pad,y+fsC,W-pad*2,fsC*1.05);
  // Nome
  const fsN=Math.round(fsC*0.44);
  ctx.font=`600 ${fsN}px 'Inter Tight',sans-serif`; ctx.fillStyle='#e8001d';
  ctx.fillText(nome.toUpperCase(),pad,y); y+=fsN*1.4;
  // Cat + Team
  const fsI=Math.round(W*0.024);
  ctx.font=`600 ${fsI}px 'Inter Tight',sans-serif`; ctx.fillStyle='#777';
  ctx.fillText(cat,pad,y); y+=fsI*1.3;
  ctx.font=`400 ${fsI}px 'Inter Tight',sans-serif`; ctx.fillStyle='#555';
  ctx.fillText(team.substring(0,40),pad,y); y+=fsI*1.8;
  // Separatore
  ctx.fillStyle='rgba(232,0,29,0.25)'; ctx.fillRect(pad,y,W-pad*2,1); y+=Math.round(H*0.035);
  // Punti + Pos
  const fsP=Math.round(W*0.11);
  const g=ctx.createLinearGradient(pad,y,pad+fsP*3,y);
  g.addColorStop(0,'#e8001d'); g.addColorStop(1,'#f5c400');
  ctx.font=`900 ${fsP}px 'Inter Tight','Inter Tight',sans-serif`; ctx.fillStyle=g;
  ctx.fillText(punti,pad,y+fsP);
  const fsL=Math.round(W*0.019);
  ctx.font=`600 ${fsL}px 'Inter Tight',sans-serif`; ctx.fillStyle='rgba(255,255,255,0.38)';
  ctx.fillText('PUNTI STAGIONE',pad,y+fsP+fsL*1.4);
  if (pos&&pos!=='-') {
    ctx.font=`900 ${fsP}px 'Inter Tight','Inter Tight',sans-serif`; ctx.fillStyle='#f5c400'; ctx.textAlign='right';
    ctx.fillText(`${pos}°`,W-pad,y+fsP);
    ctx.font=`600 ${fsL}px 'Inter Tight',sans-serif`; ctx.fillStyle='rgba(255,255,255,0.38)';
    ctx.fillText('IN CLASSIFICA',W-pad,y+fsP+fsL*1.4); ctx.textAlign='left';
  }
  // Stat bar
  const stH=Math.round(H*0.12),stY=H-fB-stH-Math.round(H*0.01);
  ctx.fillStyle='rgba(255,255,255,0.04)'; ctx.fillRect(pad,stY,W-pad*2,stH);
  [['1°','#f5c400',p1],['2°','#b0b0b0',p2],['3°','#cd7f32',p3],['GARE','#f0f0f0',gare]].forEach(([l,c,v],i)=>{
    const sw=(W-pad*2)/4, sx=pad+i*sw+sw/2;
    ctx.font=`900 ${Math.round(stH*0.48)}px 'Inter Tight','Inter Tight',sans-serif`; ctx.fillStyle=c; ctx.textAlign='center';
    ctx.fillText(v,sx,stY+Math.round(stH*0.58));
    ctx.font=`600 ${Math.round(stH*0.2)}px 'Inter Tight',sans-serif`; ctx.fillStyle='rgba(255,255,255,0.35)';
    ctx.fillText(l,sx,stY+Math.round(stH*0.83));
  }); ctx.textAlign='left';
}

// ── TEAM CARD ──────────────────────────────────────────────
function _drawTeam(ctx, W, H, d) {
  const {nome,cat,punti,pos,atleti} = d;
  const hB=Math.round(H*0.09),fB=Math.round(H*0.06),pad=Math.round(W*0.048);
  let y=hB+Math.round(H*0.04);
  const fsN=Math.round(W*(nome.length>20?0.05:0.065));
  ctx.font=`900 ${fsN}px 'Inter Tight','Inter Tight',sans-serif`; ctx.fillStyle='#f0f0f0';
  y=_wrap(ctx,nome.toUpperCase(),pad,y+fsN,W-pad*2,fsN*1.08);
  ctx.font=`600 ${Math.round(W*0.026)}px 'Inter Tight',sans-serif`; ctx.fillStyle='#e8001d';
  ctx.fillText(cat,pad,y); y+=Math.round(W*0.026)*1.5;
  ctx.fillStyle='rgba(232,0,29,0.25)'; ctx.fillRect(pad,y,W-pad*2,1); y+=Math.round(H*0.03);
  const fsP=Math.round(W*0.1);
  const g=ctx.createLinearGradient(pad,y,pad+fsP*4,y);
  g.addColorStop(0,'#e8001d'); g.addColorStop(1,'#f5c400');
  ctx.font=`900 ${fsP}px 'Inter Tight','Inter Tight',sans-serif`; ctx.fillStyle=g;
  ctx.fillText(punti,pad,y+fsP);
  const fsL=Math.round(W*0.018);
  ctx.font=`600 ${fsL}px 'Inter Tight',sans-serif`; ctx.fillStyle='rgba(255,255,255,0.38)';
  ctx.fillText('PUNTI',pad,y+fsP+fsL*1.4);
  if(pos){ctx.font=`900 ${fsP}px 'Inter Tight','Inter Tight',sans-serif`;ctx.fillStyle='#f5c400';ctx.textAlign='right';ctx.fillText(`${pos}°`,W-pad,y+fsP);ctx.textAlign='left';}
  y+=fsP+Math.round(H*0.07);
  const lMax=Math.min(atleti.length,5),lH=H-fB-y-8,rH=Math.round(lH/lMax);
  ctx.fillStyle='rgba(255,255,255,0.03)'; ctx.fillRect(pad,y,W-pad*2,lH);
  atleti.slice(0,lMax).forEach((a,i)=>{
    const ry=y+i*rH,fsA=Math.round(rH*0.34),fsT=Math.round(rH*0.22);
    ctx.font=`700 ${fsA}px 'Inter Tight',sans-serif`; ctx.fillStyle=i===0?'#f5c400':'#f0f0f0';
    ctx.fillText(`${i+1}.  ${(a.cognome||'').toUpperCase()} ${(a.nome||'').toUpperCase()}`.substring(0,32),pad+8,ry+rH*0.44);
    ctx.font=`400 ${fsT}px 'Inter Tight',sans-serif`; ctx.fillStyle='#555';
    ctx.fillText((a.team||a.team_attuale||'').substring(0,36),pad+8,ry+rH*0.74);
    ctx.font=`900 ${Math.round(rH*0.42)}px 'Inter Tight','Inter Tight',sans-serif`; ctx.fillStyle='#f5c400'; ctx.textAlign='right';
    ctx.fillText(a.puntiCat||0,W-pad,ry+rH*0.55); ctx.textAlign='left';
  });
}

// ── Disegna una colonna di classifica (header colonne + accento + righe) ──
// medalCol: oro/argento/bronzo per le posizioni 1-3 (in base a r.pos)
function _drawRankColumn(ctx, x, colW, topY, bottomY, slice, hdFs) {
  const tickX = x + Math.round(colW * 0.012);
  const posX  = x + Math.round(colW * 0.040);
  const nameX = posX + Math.round(colW * 0.150);
  const right = x + colW;
  const posCol = ['#f5c400', '#dadada', '#cd7f32'];
  let y = topY;
  // intestazione colonne
  ctx.font = `600 ${hdFs}px 'Inter Tight',sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.34)';
  ctx.letterSpacing = '1.5px'; ctx.textAlign = 'left';
  ctx.fillText('POS', posX, y + hdFs);
  ctx.fillText('ATLETA', nameX, y + hdFs);
  ctx.textAlign = 'right'; ctx.fillText('PUNTI', right, y + hdFs);
  ctx.letterSpacing = '0px'; ctx.textAlign = 'left';
  y += hdFs + Math.round(hdFs * 0.35);
  const accW = Math.round(colW * 0.22);
  ctx.fillStyle = 'rgba(232,0,29,0.85)'; ctx.fillRect(x, y, accW, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x + accW, y, colW - accW, 1);
  y += 12;
  const rH = Math.round((bottomY - y - 4) / slice.length);
  const ptsResW = Math.round(colW * 0.16); // larghezza riservata ai punti
  const nameMaxW = right - nameX - ptsResW;
  // ── Font con TETTO: indipendenti dall'altezza riga, così i nomi non
  //    diventano enormi/tagliati su formati alti (Story) o larghi (Facebook). ──
  const fsPos = Math.min(Math.round(rH * 0.44), Math.round(colW * 0.052));
  const fsN   = Math.min(Math.round(rH * 0.34), Math.round(colW * 0.038));
  const fsT   = Math.round(fsN * 0.66);
  const fsPts = Math.min(Math.round(rH * 0.40), Math.round(colW * 0.048));
  slice.forEach((r, i) => {
    const ry = y + i * rH, mid = ry + rH / 2;
    const medal = (r.pos >= 1 && r.pos <= 3) ? posCol[r.pos - 1] : null;
    if (i % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.022)'; ctx.fillRect(x, ry, colW, rH); }
    if (medal) { ctx.fillStyle = medal; ctx.fillRect(tickX, mid - Math.round(rH * 0.30), 3, Math.round(rH * 0.60)); }
    // posizione (centrata verticalmente)
    ctx.font = `700 ${fsPos}px 'Inter Tight',sans-serif`; ctx.fillStyle = medal || 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(r.pos, posX, mid);
    // nome + team come blocco centrato (clip per larghezza colonna)
    const hasTeam = !!(r.team && String(r.team).trim());
    ctx.textBaseline = 'alphabetic';
    const nameBy = hasTeam ? mid - Math.round(fsT * 0.15) : mid + Math.round(fsN * 0.35);
    ctx.font = `600 ${fsN}px 'Inter Tight',sans-serif`; ctx.fillStyle = '#f0f0f0';
    let nm = (`${r.cognome || ''} ${r.nome || ''}`).toUpperCase().trim();
    while (nm.length > 3 && ctx.measureText(nm).width > nameMaxW) nm = nm.slice(0, -1);
    ctx.fillText(nm, nameX, nameBy);
    if (hasTeam) {
      ctx.font = `400 ${fsT}px 'Inter Tight',sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.42)';
      let tm = String(r.team);
      while (tm.length > 2 && ctx.measureText(tm).width > nameMaxW) tm = tm.slice(0, -1);
      ctx.fillText(tm, nameX, nameBy + Math.round(fsT * 1.5));
    }
    // punti (centrati verticalmente)
    ctx.font = `700 ${fsPts}px 'Inter Tight',sans-serif`; ctx.fillStyle = '#f5c400';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(r.punti, right, mid);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  });
}
// ── CLASSIFICA CARD ────────────────────────────────────────
function _drawClass(ctx, W, H, d) {
  const {rows} = d;
  const hB=Math.round(H*0.092),fB=Math.round(H*0.06),pad=Math.round(W*0.048);
  // Titolo "CLASSIFICA <categoria>" + eventuale mese sono nell'header.
  const topY=hB+Math.round(H*0.022);
  const bottomY=H-fB-4;
  const maxR=Math.min(rows.length,10);
  const landscape = W > H*1.25; // Facebook (1.91:1), Twitter (16:9)
  if(landscape && maxR>5){
    // ── Due colonne: 1-5 a sinistra, 6-10 a destra ──
    const gap=Math.round(W*0.045);
    const colW=Math.round((W-pad*2-gap)/2);
    const half=Math.ceil(maxR/2);
    const hdFs=Math.round(H*0.030);
    _drawRankColumn(ctx, pad, colW, topY, bottomY, rows.slice(0,half), hdFs);
    _drawRankColumn(ctx, pad+colW+gap, colW, topY, bottomY, rows.slice(half,maxR), hdFs);
  } else {
    // ── Colonna singola (verticale / quadrato) ──
    _drawRankColumn(ctx, pad, W-pad*2, topY, bottomY, rows.slice(0,maxR), Math.round(H*0.020));
  }
}

// ── Generatore canvas ──────────────────────────────────────
async function generateShareCanvas(type, payload, platKey) {
  const p=SHARE_PLATFORMS[platKey]||SHARE_PLATFORMS.instagram;
  const canvas=document.createElement('canvas'); canvas.width=p.w; canvas.height=p.h;
  const ctx=canvas.getContext('2d');
  const logo=await _getLogo();
  // Assicura che i webfont (Inter Tight) siano pronti prima di disegnare sul canvas
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch(e){}
  _bg(ctx,p.w,p.h);
  if(type==='gara') {
    // gara manages its own header/footer for bigger logo treatment
    _drawGara(ctx,p.w,p.h,payload,logo);
  } else {
    _header(ctx,logo,p.w,p.h, type==='class'?payload:null); _footer(ctx,p.w,p.h);
    if(type==='atleta') _drawAtleta(ctx,p.w,p.h,payload);
    else if(type==='team')  _drawTeam(ctx,p.w,p.h,payload);
    else if(type==='class') _drawClass(ctx,p.w,p.h,payload);
  }
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
  const isFiltered = rankRegion || rankMonth;
  let ranking;
  if(!isFiltered){
    ranking = await loadRanking(rankCat);
  } else {
    // Ricalcola dinamicamente in base ai filtri attivi (regione / mese / combinati),
    // stessa logica di updateRankTable
    const { resultsRaw } = globalData;
    const calMap = {};
    globalData.calendar.forEach(g => calMap[g.id] = g);
    const agg = {};
    resultsRaw.forEach(r => {
      if (r.genere !== rankGender) return;
      if (getRankingFileCode(r) !== rankCat) return;
      const calEntry = calMap[r.gara_id];
      const resolvedRegion = normalizeRegion(r.regione || (calEntry ? calEntry.regione : ''));
      if (rankRegion && resolvedRegion !== rankRegion) return;
      if (rankMonth && r.data && r.data.split('-')[1] !== rankMonth) return;
      if (!agg[r.atleta_id]) {
        agg[r.atleta_id] = { atleta_id:r.atleta_id, cognome:r.cognome, nome:r.nome,
          team_id:r.team_id, team_nome:r.team, punti:0 };
      }
      agg[r.atleta_id].punti += (r.punti_effettivi || 0);
    });
    ranking = Object.values(agg).sort((a,b) => b.punti - a.punti);
    ranking.forEach((r,i) => r.pos = i+1);
  }
  if(!ranking||!ranking.length){alert('Nessun dato per i filtri selezionati.');return;}
  const monthNames=['','Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  const monthLabel = rankMonth ? (monthNames[parseInt(rankMonth,10)]||'') : '';
  window.showShareModal('class',{
    catLabel:catLabel(rankCat),
    scope:rankRegion?'regionale':'nazionale',
    region:rankRegion||'',
    month:monthLabel,
    rows:ranking.slice(0,10).map(r=>({pos:r.pos,cognome:r.cognome||r.atleta_id,nome:r.nome||'',team:r.team||r.team_nome||'',punti:r.punti}))
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
// Campi extra per ruolo, mostrati dinamicamente nel form
const SPECIALITA_OPTS = ['', 'Scalatore', 'Velocista', 'Passista', 'Cronoman', 'Finisseur', 'Passista-scalatore', 'Gregario', 'Altro'];

const REG_ROLE_FIELDS = {
  atleta: [
    { id:'reg-location',  label:'Città / Regione',       type:'text',   placeholder:'es. Firenze (Toscana)',      required:true  },
    { id:'reg-specialty', label:'Specialità',             type:'select', options: SPECIALITA_OPTS,                 required:true  },
    { id:'reg-birth',     label:'Anno di nascita',        type:'text',   placeholder:'es. 2007',                   required:true  },
    { id:'reg-team',      label:'Team di appartenenza',   type:'text',   placeholder:'es. ASD Ciclistica Fiorentina', required:true },
  ],
  team: [
    { id:'reg-location',    label:'Città / Regione',    type:'text', placeholder:'es. Milano (Lombardia)', required:true  },
    { id:'reg-staff-role',  label:'Ruolo nello staff',  type:'text', placeholder:'es. Direttore sportivo', required:false },
    { id:'reg-contact',     label:'Contatto pubblico',  type:'text', placeholder:'email o telefono',       required:false },
  ],
  media: [
    { id:'reg-location',  label:'Città / Regione',  type:'text', placeholder:'es. Bologna (Emilia-Romagna)', required:false },
    { id:'reg-ig',        label:'Instagram',         type:'text', placeholder:'@handle',                     required:false },
    { id:'reg-web',       label:'Sito web',          type:'url',  placeholder:'https://',                    required:false },
  ],
  genitore: [
    { id:'reg-location', label:'Città / Regione', type:'text', placeholder:'es. Roma (Lazio)', required:false },
  ],
  parente: [
    { id:'reg-location', label:'Città / Regione', type:'text', placeholder:'es. Torino (Piemonte)', required:false },
  ],
  appassionato: [
    { id:'reg-location',   label:'Città / Regione',   type:'text', placeholder:'es. Venezia (Veneto)', required:false },
    { id:'reg-fav-team',   label:'Team preferito',    type:'text', placeholder:'es. Bardiani-CSF',      required:false },
    { id:'reg-fav-rider',  label:'Corridore preferito', type:'text', placeholder:'es. Tadej Pogačar',  required:false },
  ],
};

function _regRoleFieldsHtml(role) {
  if (role === 'atleta') {
    // Per gli atleti: prima cerca e collega il profilo, poi i campi aggiuntivi
    const specialOpts = SPECIALITA_OPTS.map(o => `<option value="${o}">${o||'— seleziona —'}</option>`).join('');
    return `<div id="reg-role-extra" style="display:flex;flex-direction:column;gap:0">

      <!-- CERCA PROFILO -->
      <div class="auth-field">
        <label class="auth-label">Il tuo profilo atleta <span style="color:var(--red-hot)">*</span></label>
        <div class="auth-input-wrap">
          <svg class="auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" id="reg-atleta-search" class="auth-input" placeholder="Cerca per cognome…" autocomplete="off"
            oninput="window._regAtletaSearch(this.value)" />
        </div>
        <div id="reg-atleta-results" style="border:1px solid var(--border-subtle);border-top:none;border-radius:0 0 6px 6px;background:var(--bg-card);display:none;max-height:180px;overflow-y:auto;font-size:.85rem"></div>
        <input type="hidden" id="reg-atleta-id" />
      </div>

      <!-- NOME MANUALE (se non trovato) -->
      <div id="reg-manual-name-wrap" style="display:none">
        <div style="font-size:.78rem;color:var(--text-muted);padding:4px 0 8px">
          Non trovato nei dati FCI — inserisci nome e cognome e il profilo verrà verificato dall'admin.
        </div>
        <div class="auth-field">
          <label class="auth-label">Nome <span style="color:var(--red-hot)">*</span></label>
          <div class="auth-input-wrap"><input type="text" id="reg-fname" class="auth-input" placeholder="es. Marco" /></div>
        </div>
        <div class="auth-field">
          <label class="auth-label">Cognome <span style="color:var(--red-hot)">*</span></label>
          <div class="auth-input-wrap"><input type="text" id="reg-lname" class="auth-input" placeholder="es. Rossi" /></div>
        </div>
      </div>

      <!-- CAMPI AGGIUNTIVI -->
      <div class="auth-field">
        <label class="auth-label">Città / Regione <span style="color:var(--red-hot)">*</span></label>
        <div class="auth-input-wrap"><input type="text" id="reg-location" class="auth-input" placeholder="es. Firenze (Toscana)" required /></div>
      </div>
      <div class="auth-field">
        <label class="auth-label">Specialità <span style="color:var(--red-hot)">*</span></label>
        <div class="auth-input-wrap"><select id="reg-specialty" class="auth-input" style="appearance:auto;cursor:pointer" required>${specialOpts}</select></div>
      </div>
      <div class="auth-field">
        <label class="auth-label">Anno di nascita <span style="color:var(--red-hot)">*</span></label>
        <div class="auth-input-wrap"><input type="text" id="reg-birth" class="auth-input" placeholder="es. 2007" required /></div>
      </div>
      <div class="auth-field">
        <label class="auth-label">Team di appartenenza <span style="color:var(--red-hot)">*</span></label>
        <div class="auth-input-wrap"><input type="text" id="reg-team" class="auth-input" placeholder="es. ASD Ciclistica Fiorentina" required /></div>
      </div>
    </div>`;
  }

  const fields = REG_ROLE_FIELDS[role] || [];
  if (!fields.length) return '';
  return `<div id="reg-role-extra" style="display:flex;flex-direction:column;gap:0">
    ${fields.map(f => {
      const req = f.required ? 'required' : '';
      const star = f.required ? ' <span style="color:var(--red-hot)">*</span>' : '';
      let input;
      if (f.type === 'select') {
        input = `<select id="${f.id}" class="auth-input" style="appearance:auto;cursor:pointer" ${req}>
          ${(f.options||[]).map(o => `<option value="${o}">${o||'— seleziona —'}</option>`).join('')}
        </select>`;
      } else {
        input = `<input type="${f.type}" id="${f.id}" class="auth-input" placeholder="${f.placeholder||''}" ${req} />`;
      }
      return `<div class="auth-field"><label class="auth-label">${f.label}${star}</label><div class="auth-input-wrap">${input}</div></div>`;
    }).join('')}
  </div>`;
}

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
            <div class="auth-field" id="reg-name-field">
              <label class="auth-label" for="reg-name">Nome visualizzato <span style="color:var(--red-hot)">*</span></label>
              <div class="auth-input-wrap">
                <svg class="auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                <input type="text" id="reg-name" class="auth-input" placeholder="Es. Mario Rossi" required />
              </div>
            </div>
            <div class="auth-field">
              <label class="auth-label" for="reg-email">Email <span style="color:var(--red-hot)">*</span></label>
              <div class="auth-input-wrap">
                <svg class="auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>
                <input type="email" id="reg-email" class="auth-input" placeholder="tua@email.it" required autocomplete="email" />
              </div>
            </div>
            <div class="auth-field">
              <label class="auth-label" for="reg-pwd">Password <span style="color:var(--red-hot)">*</span></label>
              <div class="auth-input-wrap">
                <svg class="auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <input type="password" id="reg-pwd" class="auth-input" placeholder="Minimo 6 caratteri" required autocomplete="new-password" minlength="6" />
              </div>
            </div>
            <div class="auth-field">
              <label class="auth-label" for="reg-role">Ruolo <span style="color:var(--red-hot)">*</span></label>
              <div class="auth-input-wrap">
                <svg class="auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                <select id="reg-role" class="auth-input" style="appearance:auto;cursor:pointer" onchange="window._onRegRoleChange(this.value)">
                  <option value="">— scegli il tuo ruolo —</option>
                  <option value="appassionato">Appassionato — seguo le gare</option>
                  <option value="atleta">🚴 Atleta — sono un corridore</option>
                  <option value="team">👥 Team — gestisco una squadra</option>
                  <option value="genitore">👨‍👧 Genitore — seguo mio/a figlio/a</option>
                  <option value="parente">❤️ Parente / Tifoso — seguo un atleta</option>
                  <option value="media">📷 Media / Fotografo</option>
                </select>
              </div>
            </div>
            <div id="reg-role-extra-wrap"></div>
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

window._onRegRoleChange = function(role) {
  const wrap = document.getElementById('reg-role-extra-wrap');
  if (wrap) wrap.innerHTML = _regRoleFieldsHtml(role);
  // Per l'atleta il nome viene dal profilo → nascondi il campo generico
  const nameField = document.getElementById('reg-name-field');
  if (nameField) nameField.style.display = role === 'atleta' ? 'none' : '';
};

// Ricerca atleta nel form di registrazione
window._regAtletaSearch = function(q) {
  const results = document.getElementById('reg-atleta-results');
  const manualWrap = document.getElementById('reg-manual-name-wrap');
  if (!results) return;
  if (!q || q.length < 2) { results.style.display = 'none'; return; }
  const athletes = globalData?.athletes || {};
  const matches = Object.entries(athletes)
    .filter(([, a]) => ((a.cognome||'') + ' ' + (a.nome||'')).toLowerCase().includes(q.toLowerCase()))
    .slice(0, 8);
  if (matches.length) {
    results.style.display = 'block';
    results.innerHTML = matches.map(([id, a]) =>
      `<div style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border-subtle)"
            onmousedown="window._regSelectAtleta('${esc(id)}','${esc(a.cognome)} ${esc(a.nome)}','${esc(a.team_attuale||'')}')">
        <strong>${esc(a.cognome)} ${esc(a.nome)}</strong>
        <span style="color:var(--text-muted);font-size:.78rem;margin-left:8px">${esc(a.team_attuale||a.categoria||'')}</span>
      </div>`
    ).join('') +
    `<div style="padding:8px 12px;color:var(--text-muted);font-size:.78rem;cursor:pointer"
          onmousedown="window._regSelectAtleta('','','')" >
      ✏ Non mi trovo — inserisco manualmente
    </div>`;
  } else {
    results.style.display = 'block';
    results.innerHTML = `<div style="padding:8px 12px;color:var(--text-muted);font-size:.78rem">
      Nessun risultato.
      <span style="cursor:pointer;color:var(--accent);text-decoration:underline"
            onmousedown="window._regSelectAtleta('','','')">Inserisci manualmente →</span>
    </div>`;
  }
};

window._regSelectAtleta = function(id, label, team) {
  const search = document.getElementById('reg-atleta-search');
  const hidden = document.getElementById('reg-atleta-id');
  const results = document.getElementById('reg-atleta-results');
  const manualWrap = document.getElementById('reg-manual-name-wrap');
  const nameInput = document.getElementById('reg-name');
  const teamInput = document.getElementById('reg-team');
  if (results) results.style.display = 'none';
  if (id) {
    // Trovato: compila automaticamente
    if (search) search.value = label;
    if (hidden) hidden.value = id;
    if (nameInput) nameInput.value = label; // display_name
    if (teamInput && team) teamInput.value = team;
    if (manualWrap) manualWrap.style.display = 'none';
  } else {
    // Non trovato: mostra campi manuali
    if (search) search.value = '';
    if (hidden) hidden.value = '';
    if (manualWrap) manualWrap.style.display = '';
  }
};

window.submitRegister = async function(e) {
  e.preventDefault();
  const display_name = document.getElementById('reg-name').value.trim();
  const email        = document.getElementById('reg-email').value.trim();
  const password     = document.getElementById('reg-pwd').value;
  const role         = document.getElementById('reg-role').value;
  if (!role) { const err = document.getElementById('auth-error'); if (err) { err.textContent='Seleziona il tuo ruolo'; err.style.display='block'; } return; }

  // Validazione specifica atleta
  const v = (id) => document.getElementById(id)?.value?.trim() || '';
  if (role === 'atleta') {
    const atletaId = v('reg-atleta-id');
    const fname = v('reg-fname'), lname = v('reg-lname');
    if (!atletaId && !fname && !lname) {
      const err = document.getElementById('auth-error');
      if (err) { err.textContent = 'Cerca il tuo profilo atleta o inserisci nome e cognome manualmente'; err.style.display = 'block'; }
      return;
    }
  }

  const errEl = document.getElementById('auth-error');
  const btn   = document.getElementById('reg-submit');
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Registrazione…';

  // Per l'atleta il display_name viene dal profilo selezionato (o dal nome manuale)
  const finalDisplayName = role === 'atleta'
    ? (v('reg-atleta-search') || ((v('reg-lname') + ' ' + v('reg-fname')).trim()) || display_name || email.split('@')[0])
    : display_name;

  try {
    const { token, user } = await apiCall('/auth/register', { method: 'POST', body: { email, password, role, display_name: finalDisplayName } });
    authSave(token, user);
    updateNavLoginState();

    // Per l'atleta: collega subito il profilo
    if (role === 'atleta') {
      const atletaId = v('reg-atleta-id') || null;
      const team = v('reg-team');
      await apiCall('/profile/link-athlete', { method: 'POST', body: {
        atleta_id:  atletaId,
        first_name: v('reg-fname') || (atletaId ? '' : finalDisplayName.split(' ').slice(1).join(' ')),
        last_name:  v('reg-lname') || (atletaId ? '' : finalDisplayName.split(' ')[0]),
        team,
        birth_year: v('reg-birth'),
      }}).catch(() => {});
    }

    // Salva i campi extra come user_details
    const details = {
      bio:'', location: v('reg-location'), instagram: v('reg-ig'), facebook:'', strava:'', website: v('reg-web'),
      specialty: v('reg-specialty'), birth_year: v('reg-birth'),
      favorite_team: v('reg-fav-team') || v('reg-team'),
      staff_role: v('reg-staff-role'), public_contact: v('reg-contact'),
      favorite_rider: v('reg-fav-rider'),
    };
    if (Object.values(details).some(x => x)) {
      await apiCall('/profile/details', { method: 'PATCH', body: details }).catch(() => {});
    }
    window.location.hash = '/profilo';
  } catch (err) {
    errEl.textContent = err.message; errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = 'CREA ACCOUNT';
  }
};

// ── MY PROFILE / DASHBOARD ────────────────────────────────────
async function renderMyProfile() {
  if (!authUser()) { window.location.hash = '/login'; return; }
  // Aggiorna l'utente dal server (ruolo aggiornato dall'admin, ecc.)
  await refreshUser();
  const user = authUser();
  if (!user) { window.location.hash = '/login'; return; }

  const roleLabels = {
    atleta:'Atleta', team:'Team Manager', genitore:'Genitore', parente:'Parente / Tifoso',
    appassionato:'Appassionato', admin:'Amministratore', media:'Media / Fotografo'
  };
  const roleIcons = {
    atleta:'🚴', team:'👥', genitore:'👨‍👧', parente:'❤️',
    appassionato:'🏆', admin:'⚙️', media:'📷'
  };
  const label = roleLabels[user.role] || user.role;
  const icon  = roleIcons[user.role] || '👤';
  const initials = (user.display_name || user.email || '?').slice(0,1).toUpperCase();

  // Render shell immediately
  setPage(`
    <div class="dash-wrap">
      <div class="dash-hero">
        <div class="dash-hero-avatar">${initials}</div>
        <div class="dash-hero-info">
          <div class="dash-hero-name">${esc(user.display_name || user.email)}</div>
          <div class="dash-hero-email">${esc(user.email)}</div>
          <div class="dash-role-badge">${icon} ${label.toUpperCase()}</div>
        </div>
        <div class="dash-hero-actions">
          ${user.role === 'admin' ? `<a href="#/admin" class="dash-btn dash-btn--primary">⚙️ Admin</a>` : ''}
          <button class="dash-btn dash-btn--outline" onclick="doLogout()">Esci</button>
        </div>
      </div>
      <div id="dash-body"><div class="admin-loading">Caricamento…</div></div>
    </div>
  `);

  // Async fill — con timeout per non restare appesi se Render è in cold-start
  try {
    const _withTimeout = (p, ms) => Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error('Il server non risponde (potrebbe essere in fase di riavvio). Riprova tra qualche secondo.')), ms)),
    ]);
    const { profile } = await _withTimeout(apiCall('/profile'), 25000);
    const el = document.getElementById('dash-body');
    if (!el) return;
    if      (user.role === 'atleta')      await _dashAtleta(el, user, profile);
    else if (user.role === 'team')        await _dashTeam(el, user, profile);
    else if (user.role === 'genitore')    await _dashGenitore(el, user, profile);
    else if (user.role === 'parente')     await _dashParente(el, user, profile);
    else if (user.role === 'appassionato') await _dashAppassionato(el, user);
    else if (user.role === 'media')       await _dashMedia(el, user, profile);
    else if (user.role === 'admin')       await _dashAdmin(el, user);
    else el.innerHTML = `<p style="color:var(--text-muted)">Pannello non disponibile per il ruolo "${esc(user.role)}".</p>`;
    // Card "Il mio profilo" (campi personali) per tutti i ruoli tranne admin
    if (user.role !== 'admin') _injectProfileFieldsCard(el, user);
  } catch(err) {
    const el = document.getElementById('dash-body');
    if (el) el.innerHTML = `
      <div style="text-align:center;padding:32px 16px;color:var(--text-muted)">
        <p style="margin:0 0 14px">${esc(err.message)}</p>
        <button class="dash-btn dash-btn--outline" onclick="renderMyProfile()">↻ Riprova</button>
      </div>`;
  }
}

window.doLogout = function() {
  authClear();
  updateNavLoginState();
  window.location.hash = '/';
};

// Admin: crea account di prova per ogni ruolo
window.seedTestAccounts = async function() {
  const btn = document.getElementById('seed-test-btn');
  const out = document.getElementById('seed-test-result');
  const pwd = prompt('Password per gli account di prova (min 6 caratteri):', 'Prova2026!');
  if (!pwd) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Creazione…'; }
  try {
    const r = await apiCall('/admin/seed-test-accounts', { method: 'POST', body: { password: pwd } });
    const rows = (r.accounts || []).map(a =>
      `<div style="padding:4px 0;border-bottom:1px solid var(--border-subtle)">
        <code>${esc(a.email)}</code> — <strong>${esc(a.role)}</strong>
        ${a.created ? '<span style="color:var(--green-pos,#16a34a)">creato ✓</span>' : '<span style="color:var(--text-muted)">già esistente</span>'}
      </div>`).join('');
    if (out) out.innerHTML = `
      <div style="margin-bottom:8px">Password per tutti: <code>${esc(r.password)}</code></div>
      ${rows}`;
  } catch (e) {
    if (out) out.innerHTML = `<span style="color:var(--red-hot)">Errore: ${esc(e.message)}</span>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Crea account di prova'; }
  }
};

// ── CARD "IL MIO PROFILO" (campi personali, tutti i ruoli) ────────────────────

async function _injectProfileFieldsCard(el, user) {
  const grid = el.querySelector('.dash-grid');
  const card = document.createElement('div');
  card.className = 'dash-card';
  card.id = 'dash-myfields-card';
  card.innerHTML = `<div class="admin-loading">Caricamento profilo…</div>`;
  if (grid) grid.prepend(card); else el.prepend(card);
  let details = {};
  try { const d = await apiCall('/profile/details'); details = d.details || {}; } catch {}
  _renderProfileFieldsCard(card, user, details);
}

function _renderProfileFieldsCard(card, user, d) {
  const role = user.role;
  const f = (k) => esc(d[k] || '');
  // Campi comuni a tutti i ruoli
  let roleFields = '';
  if (role === 'atleta') {
    const reqStar = '<span style="color:var(--red-hot)">*</span>';
    roleFields = `
      <label class="pf-label">Specialità ${reqStar}
        <select id="pf-specialty" class="pf-input" required>
          ${SPECIALITA_OPTS.map(o => `<option value="${o}" ${d.specialty===o?'selected':''}>${o||'— seleziona —'}</option>`).join('')}
        </select>
      </label>
      <label class="pf-label">Anno di nascita ${reqStar}<input type="text" id="pf-birth_year" class="pf-input" value="${f('birth_year')}" placeholder="es. 2007" required /></label>
      <label class="pf-label">Team di appartenenza ${reqStar}<input type="text" id="pf-favorite_team" class="pf-input" value="${f('favorite_team')}" placeholder="es. ASD Ciclistica Fiorentina" required /></label>
      <label class="pf-label">Corridore preferito<input type="text" id="pf-favorite_rider" class="pf-input" value="${f('favorite_rider')}" placeholder="es. Tadej Pogačar" /></label>`;
  } else if (role === 'team') {
    roleFields = `
      <label class="pf-label">Ruolo nello staff<input type="text" id="pf-staff_role" class="pf-input" value="${f('staff_role')}" placeholder="es. Direttore sportivo" /></label>
      <label class="pf-label">Contatto pubblico<input type="text" id="pf-public_contact" class="pf-input" value="${f('public_contact')}" placeholder="email o telefono pubblico" /></label>`;
  } else if (role === 'appassionato' || role === 'genitore' || role === 'parente') {
    roleFields = `
      <label class="pf-label">Team preferito<input type="text" id="pf-favorite_team" class="pf-input" value="${f('favorite_team')}" placeholder="Squadra preferita" /></label>
      <label class="pf-label">Corridore preferito<input type="text" id="pf-favorite_rider" class="pf-input" value="${f('favorite_rider')}" placeholder="es. Tadej Pogačar" /></label>`;
  }

  card.innerHTML = `
    <div class="dash-card-title"><span>📝</span>Il mio profilo</div>
    ${role === 'atleta' ? `<p style="font-size:.74rem;color:var(--text-muted);margin:0 0 8px"><span style="color:var(--red-hot)">*</span> Campi obbligatori</p>` : ''}
    <div class="pf-grid">
      <label class="pf-label pf-full">Bio<textarea id="pf-bio" class="pf-input" rows="2" placeholder="Una breve presentazione">${f('bio')}</textarea></label>
      <label class="pf-label${role==='atleta'?' pf-required':''}">Località${role==='atleta'?' <span style="color:var(--red-hot)">*</span>':''}<input type="text" id="pf-location" class="pf-input" value="${f('location')}" placeholder="Città / Regione"${role==='atleta'?' required':''} /></label>
      ${roleFields}
      <label class="pf-label">Instagram<input type="text" id="pf-instagram" class="pf-input" value="${f('instagram')}" placeholder="@handle o URL" /></label>
      <label class="pf-label">Facebook<input type="text" id="pf-facebook" class="pf-input" value="${f('facebook')}" placeholder="pagina o URL" /></label>
      <label class="pf-label">Strava<input type="text" id="pf-strava" class="pf-input" value="${f('strava')}" placeholder="ID o URL profilo" /></label>
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:12px">
      <button class="dash-btn dash-btn--primary" id="pf-save" onclick="window.saveProfileDetails(this)">Salva profilo</button>
      <span id="pf-msg" style="font-size:.8rem;color:var(--text-muted)"></span>
    </div>`;
}

// Partecipazione gara — toggle 3 stati
window.setParticipation = async function(garaId, status, btn) {
  try {
    await apiCall(`/participations/${encodeURIComponent(garaId)}`, { method: 'POST', body: { status } });
    // Aggiorna tutti i bottoni della riga
    const row = btn?.closest('div[style*="border-bottom"]');
    if (row) {
      const btns = row.querySelectorAll('button');
      const colors = { yes: 'var(--green-pos,#16a34a)', maybe: '#f59e0b', no: 'var(--red-hot)' };
      const labels = { yes: 'yes', maybe: 'maybe', no: 'no' };
      btns.forEach(b => {
        const bSt = b.onclick?.toString().match(/'(yes|maybe|no)'/)?.[1];
        if (!bSt) return;
        b.style.background = bSt === status ? colors[bSt] : 'transparent';
        b.style.color = bSt === status ? '#fff' : 'var(--text-secondary)';
      });
    }
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

window.saveProfileDetails = async function(btn) {
  const val = (id) => document.getElementById(id)?.value?.trim() || '';
  const msg = document.getElementById('pf-msg');
  // Validazione campi obbligatori per atleta
  const user = authUser();
  if (user?.role === 'atleta') {
    if (!val('pf-specialty')) { if (msg) { msg.textContent = 'Specialità obbligatoria'; msg.style.color = 'var(--red-hot)'; } return; }
    if (!val('pf-birth_year')) { if (msg) { msg.textContent = 'Anno di nascita obbligatorio'; msg.style.color = 'var(--red-hot)'; } return; }
    if (!val('pf-favorite_team')) { if (msg) { msg.textContent = 'Team di appartenenza obbligatorio'; msg.style.color = 'var(--red-hot)'; } return; }
    if (!val('pf-location')) { if (msg) { msg.textContent = 'Località obbligatoria'; msg.style.color = 'var(--red-hot)'; } return; }
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio…'; }
  try {
    await apiCall('/profile/details', { method: 'PATCH', body: {
      bio: val('pf-bio'), location: val('pf-location'),
      instagram: val('pf-instagram'), facebook: val('pf-facebook'),
      strava: val('pf-strava'), website: val('pf-website'),
      specialty: val('pf-specialty'), birth_year: val('pf-birth_year'),
      favorite_team: val('pf-favorite_team'), staff_role: val('pf-staff_role'),
      public_contact: val('pf-public_contact'), favorite_rider: val('pf-favorite_rider'),
    }});
    if (msg) { msg.textContent = '✓ Salvato'; msg.style.color = 'var(--green-pos, #16a34a)'; }
  } catch (e) {
    if (msg) { msg.textContent = 'Errore: ' + e.message; msg.style.color = 'var(--red-hot)'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salva profilo'; }
  }
};

// ── DASHBOARD HELPERS ────────────────────────────────────────────────────────

// Calcola classifica per una categoria specifica dai risultati grezzi
function computeRanking(resultsRaw, catCode) {
  const pts = {};
  for (const r of resultsRaw) {
    if (getRankingFileCode(r) !== catCode) continue;
    if (!r.atleta_id) continue;
    if (!pts[r.atleta_id]) pts[r.atleta_id] = { atleta_id: r.atleta_id, cognome: r.cognome||'', nome: r.nome||'', punti: 0 };
    pts[r.atleta_id].punti += (r.punti_effettivi || 0);
  }
  const sorted = Object.values(pts).sort((a, b) => b.punti - a.punti);
  sorted.forEach((r, i) => { r.pos = i + 1; });
  return sorted;
}

/* Returns ranking position data for an atleta from live globalData */
function _dashRankingInfo(atleta_id) {
  if (!globalData?.resultsRaw || !atleta_id) return null;
  const res = globalData.resultsRaw;
  const cats = [...new Set(res.map(r => getRankingFileCode(r)).filter(Boolean))];
  const out = [];
  for (const cat of cats) {
    const ranking = computeRanking(res, cat);
    if (!ranking?.length) continue;
    const idx = ranking.findIndex(r => r.atleta_id === atleta_id);
    if (idx < 0) continue;
    const r = ranking[idx];
    out.push({ cat, catLabel: catLabel(cat), pos: r.pos || idx+1, punti: r.punti, gap: idx > 0 ? (ranking[0].punti - r.punti) : 0 });
  }
  return out;
}

// ── SKILL CARD BUILDERS (riutilizzabili tra ruoli) ──────────────

/* 📸 Raccoglitore Foto & Video — collezione personale salvata */
function _skillCollection() {
  const items = getMediaCollection();
  const foto  = items.filter(m => m.type === 'foto').length;
  const video = items.filter(m => m.type === 'video').length;
  return `
    <div class="dash-card dash-card--skill" id="dash-skill-collection">
      <div class="dash-card-title"><span>📸</span>Raccoglitore Foto & Video</div>
      <div class="dash-skill-desc">La tua raccolta personale: salva foto e video delle gare con il pulsante ＋ per ritrovarli qui.</div>
      <div class="dash-stats-row">
        <div class="dash-stat"><div class="dash-stat-val">${foto}</div><div class="dash-stat-lbl">Foto</div></div>
        <div class="dash-stat"><div class="dash-stat-val">${video}</div><div class="dash-stat-lbl">Video</div></div>
      </div>
      <div id="dash-collection-inner">${_collectionInner(items)}</div>
    </div>`;
}
function _collectionInner(items) {
  if (!items.length) return `<p class="dash-skill-empty">Raccolta vuota. Sfoglia le gallerie foto e clicca ＋ per salvare.</p>
    <a href="#/risultati" class="dash-btn dash-btn--outline dash-btn--sm">Sfoglia gare →</a>`;
  return `<div class="dash-collect-grid">
    ${items.slice(0, 8).map(m => `
      <div class="dash-collect-item">
        ${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener"><img src="${esc(m.url)}" loading="lazy" alt="${esc(m.title)}"/></a>`
                : `<div class="dash-collect-ph">${m.type==='video'?'▶':'📷'}</div>`}
        ${m.type==='video'?`<span class="dash-collect-badge">▶</span>`:''}
        <button class="dash-collect-rm" title="Rimuovi" onclick="window.removeFromCollection('${esc(m.uid)}')">✕</button>
      </div>`).join('')}
  </div>
  ${items.length > 8 ? `<div class="dash-skill-more">+${items.length-8} altri elementi salvati</div>` : ''}`;
}

/* 📅 Calendario personale — gare seguite */
function _skillCalendario() {
  const races = getMyRaces().sort((a,b)=>(a.data||'').localeCompare(b.data||''));
  const today = new Date().toISOString().slice(0,10);
  const upcoming = races.filter(r => (r.data||'') >= today);
  return `
    <div class="dash-card dash-card--skill">
      <div class="dash-card-title"><span>📅</span>Il mio calendario</div>
      <div class="dash-skill-desc">Le gare che vuoi seguire. Aggiungile dal calendario col pulsante ＋.</div>
      ${races.length ? `
        ${(upcoming.length ? upcoming : races).slice(0,5).map(r=>`
          <div class="dash-cal-row">
            <div class="dash-cal-date">${(r.data||'').slice(5)||'—'}</div>
            <div style="flex:1"><div class="dash-cal-name">${esc((r.nome||r.id).slice(0,32))}</div></div>
            <button class="dash-collect-rm" style="position:static" title="Rimuovi" onclick="window.toggleMyRace('${esc(r.id)}');renderMyProfile()">✕</button>
          </div>`).join('')}
        <a href="#/calendario" class="dash-btn dash-btn--outline dash-btn--sm">Aggiungi gare →</a>` :
      `<p class="dash-skill-empty">Nessuna gara seguita. Vai al calendario e clicca ＋ sulle gare di interesse.</p>
       <a href="#/calendario" class="dash-btn dash-btn--primary dash-btn--sm">Apri calendario →</a>`}
    </div>`;
}

/* 🔔 Notifiche — preferenze */
function _skillNotifiche(role) {
  const p = getNotifPrefs();
  const opts = [
    { key:'risultati',   label:'Nuovi risultati', desc:'Quando esce un risultato che ti riguarda' },
    { key:'classifica',  label:'Cambi in classifica', desc:'Movimenti di posizione rilevanti' },
    { key:'gare',        label:'Promemoria gare', desc:'Gare del tuo calendario in arrivo' },
    { key:'foto',        label:'Nuove foto/video', desc:'Media pubblicati dalle gare seguite' },
  ];
  return `
    <div class="dash-card dash-card--skill">
      <div class="dash-card-title"><span>🔔</span>Notifiche</div>
      <div class="dash-skill-desc">Scegli di cosa essere avvisato.</div>
      ${opts.map(o => `
        <label class="dash-toggle-row">
          <div>
            <div class="dash-toggle-label">${o.label}</div>
            <div class="dash-toggle-desc">${o.desc}</div>
          </div>
          <input type="checkbox" class="dash-toggle" ${p[o.key]?'checked':''} onchange="window.setNotifPref('${o.key}', this.checked)" />
        </label>`).join('')}
    </div>`;
}

/* 🖼️ Condivisione — genera grafiche */
function _skillCondivisione(kind, id) {
  return `
    <div class="dash-card dash-card--skill">
      <div class="dash-card-title"><span>🖼️</span>Condivisione social</div>
      <div class="dash-skill-desc">Genera grafiche pronte per Instagram, Storie, Facebook e WhatsApp con i tuoi risultati.</div>
      <div class="dash-actions-grid">
        <a href="#/risultati" class="dash-quick-btn"><span class="dqb-icon">📋</span>Risultati gara</a>
        <a href="#/classifica" class="dash-quick-btn"><span class="dqb-icon">🏆</span>Classifica</a>
        ${kind==='atleta'&&id?`<a href="#/atleta/${esc(String(id))}" class="dash-quick-btn"><span class="dqb-icon">🚴</span>Mio profilo</a>`:''}
        ${kind==='team'&&id?`<a href="#/team/${esc(String(id))}" class="dash-quick-btn"><span class="dqb-icon">👥</span>Mio team</a>`:''}
      </div>
    </div>`;
}

async function _dashAtleta(el, user, profile) {
  const statusMap = { active:'✅ Verificato', pending:'⏳ In attesa', rejected:'❌ Rifiutato' };

  // No profile linked yet
  if (!profile) {
    el.innerHTML = `
      <div class="dash-grid">
        <div class="dash-card dash-card--accent">
          <div class="dash-card-title"><span>🔗</span>Collega il tuo profilo atleta</div>
          <p style="font-size:.85rem;color:var(--text-muted);line-height:1.5">
            Cerca il tuo nome nelle classifiche FCI e collegati per accedere ai tuoi risultati, statistiche e posizioni in classifica in tempo reale.
          </p>
          <div class="dash-link-form">
            <input type="text" id="link-search" placeholder="Cerca per cognome…" oninput="searchAtletaForLink(this.value)" autocomplete="off" />
            <div id="link-results"></div>
            <input type="hidden" id="link-atleta-id" />
            <input type="text" id="link-fci" placeholder="Codice tessera FCI (opzionale)" />
            <input type="text" id="link-fname" placeholder="Nome" />
            <input type="text" id="link-lname" placeholder="Cognome" />
            <button class="dash-btn dash-btn--primary" onclick="submitLinkAthlete(event)">COLLEGA PROFILO</button>
          </div>
          <p style="font-size:.75rem;color:var(--text-muted)">Non trovi il tuo nome? Compila comunque — verrà revisionato dall'admin.</p>
        </div>
        <div class="dash-card">
          <div class="dash-card-title"><span>💡</span>Cosa puoi fare</div>
          <div class="dash-actions-grid">
            <a href="#/classifica" class="dash-quick-btn"><span class="dqb-icon">🏆</span>Classifiche</a>
            <a href="#/risultati"  class="dash-quick-btn"><span class="dqb-icon">📋</span>Risultati</a>
            <a href="#/calendario" class="dash-quick-btn"><span class="dqb-icon">📅</span>Calendario</a>
            <a href="#/statistiche" class="dash-quick-btn"><span class="dqb-icon">📊</span>Statistiche</a>
          </div>
        </div>
      </div>`;
    return;
  }

  // Profile linked — show full dashboard
  const atleta_id = profile.atleta_id;
  const rankInfo  = atleta_id ? _dashRankingInfo(atleta_id) : [];
  const res       = globalData?.resultsRaw || [];
  const myResults = atleta_id
    ? res.filter(r => r.atleta_id === atleta_id).sort((a,b) => (b.data||'').localeCompare(a.data||'')).slice(0, 6)
    : [];

  const today = new Date().toISOString().slice(0,10);
  const calendar = (globalData?.calendar || []).filter(g => (g.data||g.date||'') >= today).slice(0,10);

  const totalVittorie = res.filter(r => r.atleta_id === atleta_id && (r.pos === 1 || r.pos === '1')).length;
  const totalPodi     = res.filter(r => r.atleta_id === atleta_id && [1,2,3,'1','2','3'].includes(r.pos)).length;
  const totalGare     = res.filter(r => r.atleta_id === atleta_id).length;

  // Atleta dati dal globalData (per team ecc.)
  const athData = atleta_id ? (globalData?.athletes?.[atleta_id]) : null;
  const teamId  = athData?.team_id || null;
  const teamData = teamId ? (globalData?.teams?.[teamId]) : null;

  // Partecipazioni: carichiamo in parallelo
  let participations = {};
  try {
    const pResp = await apiCall('/participations');
    for (const p of (pResp.participations || [])) participations[p.gara_id] = p.status;
  } catch {}

  const ath = atleta_id ? (globalData?.athletes?.[atleta_id]) : null;
  const riderName = ath ? `${ath.cognome||''} ${ath.nome||''}`.trim()
                        : `${profile.last_name||''} ${profile.first_name||''}`.trim();

  el.innerHTML = `
    <div class="dash-grid">

      <!-- IL TUO PROFILO ATLETA -->
      <div class="dash-card dash-card--accent">
        <div class="dash-card-title"><span>🚴</span>Il tuo profilo atleta</div>
        ${riderName ? `<div style="font-family:var(--font-display);font-size:1.25rem;font-weight:900;color:var(--text-primary);margin-bottom:8px">${esc(riderName)}</div>` : ''}
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
          <span class="dash-status ${profile.status==='active'?'dash-status--ok':profile.status==='pending'?'dash-status--warn':'dash-status--err'}">
            ${profile.status==='active' ? atleta_id ? '✅ Verificato' : '✅ Attivo (senza ID FCI)' : statusMap[profile.status]||profile.status}
          </span>
          ${atleta_id ? `<a href="#/atleta/${esc(atleta_id)}" class="dash-btn dash-btn--outline dash-btn--sm">👁 Vedi il mio profilo →</a>` : ''}
        </div>
        ${profile.fci_code ? `<div style="font-size:.8rem;color:var(--text-muted)">Tessera FCI: <strong>${esc(profile.fci_code)}</strong></div>` : ''}
        ${profile.team ? `<div style="font-size:.84rem;color:var(--text-muted);margin-top:4px">Team dichiarato: <strong style="color:var(--text-primary)">${esc(profile.team)}</strong></div>` : ''}
        ${!atleta_id ? `<div style="font-size:.78rem;color:var(--text-muted);margin-top:6px;padding:8px;background:var(--bg-base);border-radius:6px">⚠️ Il profilo non è ancora associato a un atleta nei dati FCI — in attesa di verifica admin.</div>` : ''}
        <div class="dash-stats-row" style="margin-top:10px">
          <div class="dash-stat"><div class="dash-stat-val">${totalGare}</div><div class="dash-stat-lbl">Gare</div></div>
          <div class="dash-stat"><div class="dash-stat-val">${totalVittorie}</div><div class="dash-stat-lbl">Vittorie</div></div>
          <div class="dash-stat"><div class="dash-stat-val">${totalPodi}</div><div class="dash-stat-lbl">Podi</div></div>
        </div>
      </div>

      <!-- PROFILO DEL TEAM -->
      ${teamData ? `
      <div class="dash-card">
        <div class="dash-card-title"><span>👥</span>Il tuo team</div>
        <div style="font-family:var(--font-display);font-size:1.05rem;font-weight:800;color:var(--text-primary);margin-bottom:6px">${esc(teamData.nome||teamId)}</div>
        <div style="font-size:.82rem;color:var(--text-muted);margin-bottom:10px">${teamData.atleti ? teamData.atleti.length + ' atleti in rosa' : ''}</div>
        <a href="#/team/${esc(teamId)}" class="dash-btn dash-btn--outline dash-btn--sm">👥 Vai alla scheda team →</a>
      </div>` : profile.team ? `
      <div class="dash-card">
        <div class="dash-card-title"><span>👥</span>Il tuo team</div>
        <div style="font-family:var(--font-display);font-size:1.05rem;font-weight:800;color:var(--text-primary);margin-bottom:6px">${esc(profile.team)}</div>
        <div style="font-size:.78rem;color:var(--text-muted)">Team non ancora presente nel database FCI — verrà aggiunto alla prima gara registrata.</div>
      </div>` : ''}

      <!-- RANKING POSITIONS -->
      ${rankInfo && rankInfo.length ? `
      <div class="dash-card">
        <div class="dash-card-title"><span>🏆</span>Le tue classifiche</div>
        ${rankInfo.map(r => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-subtle)">
            <div>
              <div style="font-size:.82rem;font-weight:700;color:var(--text-primary)">${esc(r.catLabel)}</div>
              <div style="font-size:.72rem;color:var(--text-muted)">${r.punti} punti${r.gap > 0 ? ` · −${r.gap} dal leader` : ' · Sei il leader! 🏆'}</div>
            </div>
            <div style="font-family:var(--font-display);font-size:1.6rem;font-weight:900;color:${r.pos<=3?'var(--accent)':'var(--text-secondary)'}">
              #${r.pos}
            </div>
          </div>`).join('')}
        <a href="#/classifica" class="dash-btn dash-btn--outline dash-btn--sm" style="margin-top:4px">Tutte le classifiche →</a>
      </div>` : ''}

      <!-- ULTIMI RISULTATI -->
      ${myResults.length ? `
      <div class="dash-card">
        <div class="dash-card-title"><span>📋</span>I tuoi ultimi risultati</div>
        <div class="dash-results-list">
          ${myResults.map(r => `
            <div class="dash-result-row">
              <div class="dash-result-pos ${r.pos==1?'pos-gold':r.pos==2?'pos-silver':r.pos==3?'pos-bronze':''}">${r.pos||'–'}</div>
              <div class="dash-result-name" title="${esc(r.gara||'')}"><a href="#/gara/${esc(r.gara_id||'')}" style="color:inherit;text-decoration:none">${esc((r.gara||'').slice(0,28))}</a></div>
              <div class="dash-result-date">${(r.data||'').slice(5)}</div>
              <div class="dash-result-pts">${r.punti_effettivi||''}</div>
            </div>`).join('')}
        </div>
        ${atleta_id ? `<a href="#/atleta/${esc(atleta_id)}" class="dash-btn dash-btn--outline dash-btn--sm">Tutti i risultati →</a>` : ''}
      </div>` : ''}

      <!-- PROSSIME GARE + PARTECIPAZIONE -->
      ${calendar.length ? `
      <div class="dash-card">
        <div class="dash-card-title"><span>📅</span>Prossime gare — ci sei?</div>
        <p style="font-size:.76rem;color:var(--text-muted);margin:0 0 10px">Dicci se partecipi: il tuo team e gli organizzatori saranno avvisati.</p>
        <div id="dash-cal-list">
        ${calendar.map(g => {
          const gid = g.id || g.gara_id || '';
          const st  = participations[gid] || '';
          const btnBase = 'padding:4px 10px;border-radius:4px;font-size:.75rem;font-weight:700;cursor:pointer;border:1px solid';
          return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-subtle);flex-wrap:wrap">
            <div style="min-width:36px;font-size:.75rem;color:var(--text-muted);font-family:var(--font-mono)">${(g.data||g.date||'').slice(5)}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc((g.nome||g.name||'').slice(0,34))}</div>
              <div style="font-size:.72rem;color:var(--text-muted)">${esc(g.cat||g.categoria||'')}</div>
            </div>
            <div style="display:flex;gap:4px;flex-shrink:0">
              <button style="${btnBase} var(--border-subtle);${st==='yes'?'background:var(--green-pos,#16a34a);color:#fff':'background:transparent;color:var(--text-secondary)'}" onclick="window.setParticipation('${esc(gid)}','yes',this)">✓ Ci sono</button>
              <button style="${btnBase} var(--border-subtle);${st==='maybe'?'background:#f59e0b;color:#fff':'background:transparent;color:var(--text-secondary)'}" onclick="window.setParticipation('${esc(gid)}','maybe',this)">? Forse</button>
              <button style="${btnBase} var(--border-subtle);${st==='no'?'background:var(--red-hot);color:#fff':'background:transparent;color:var(--text-secondary)'}" onclick="window.setParticipation('${esc(gid)}','no',this)">✗ No</button>
            </div>
          </div>`;
        }).join('')}
        </div>
        <a href="#/calendario" class="dash-btn dash-btn--outline dash-btn--sm" style="margin-top:8px">Tutto il calendario →</a>
      </div>` : ''}

      <!-- AZIONI RAPIDE -->
      <div class="dash-card">
        <div class="dash-card-title"><span>⚡</span>Azioni rapide</div>
        <div class="dash-actions-grid">
          <a href="#/classifica"  class="dash-quick-btn"><span class="dqb-icon">🏆</span>Classifiche</a>
          <a href="#/risultati"   class="dash-quick-btn"><span class="dqb-icon">📋</span>Risultati</a>
          <a href="#/calendario"  class="dash-quick-btn"><span class="dqb-icon">📅</span>Calendario</a>
          <a href="#/statistiche" class="dash-quick-btn"><span class="dqb-icon">📊</span>Statistiche</a>
          ${atleta_id ? `<a href="#/comparatore" class="dash-quick-btn"><span class="dqb-icon">⚖️</span>Comparatore</a>` : ''}
          <a href="#/atleti"      class="dash-quick-btn"><span class="dqb-icon">👤</span>Atleti</a>
        </div>
      </div>

      <!-- SKILL: OBIETTIVI -->
      <div class="dash-card dash-card--skill" id="dash-skill-goals">
        <div class="dash-card-title"><span>🎯</span>Obiettivi stagionali</div>
        <div class="dash-skill-desc">Fissa i tuoi traguardi e spuntali quando li raggiungi.</div>
        <div id="dash-goals-inner">${_goalsInner()}</div>
        <div class="dash-link-form" style="margin-top:6px">
          <input type="text" id="goal-input" placeholder="Es. Top 10 in classifica regionale" onkeydown="if(event.key==='Enter'){window.addAthleteGoal(this.value);this.value=''}" />
          <button class="dash-btn dash-btn--accent dash-btn--sm" onclick="const i=document.getElementById('goal-input');window.addAthleteGoal(i.value);i.value=''">+ Aggiungi obiettivo</button>
        </div>
      </div>

      <!-- SKILL: RACCOGLITORE FOTO & VIDEO -->
      ${_skillCollection()}

      <!-- SKILL: CALENDARIO PERSONALE -->
      ${_skillCalendario()}

      <!-- SKILL: CONDIVISIONE -->
      ${_skillCondivisione('atleta', atleta_id)}

      <!-- SKILL: NOTIFICHE -->
      ${_skillNotifiche('atleta')}

    </div>`;

  // Wire refresh hooks for skill cards
  window._refreshGoalsCard = () => { const i=document.getElementById('dash-goals-inner'); if(i) i.innerHTML=_goalsInner(); };
  window._refreshCollectionCard = () => { const i=document.getElementById('dash-collection-inner'); if(i) i.innerHTML=_collectionInner(getMediaCollection()); };
}

/* Goals list inner HTML */
function _goalsInner() {
  const goals = getAthleteGoals();
  if (!goals.length) return `<p class="dash-skill-empty">Nessun obiettivo. Aggiungine uno qui sotto.</p>`;
  return `<div class="dash-goals-list">
    ${goals.map(g => `
      <div class="dash-goal-row ${g.done?'done':''}">
        <button class="dash-goal-check" onclick="window.toggleAthleteGoal(${g.id})">${g.done?'✓':''}</button>
        <span class="dash-goal-text">${esc(g.text)}</span>
        <button class="dash-collect-rm" style="position:static" title="Rimuovi" onclick="window.removeAthleteGoal(${g.id})">✕</button>
      </div>`).join('')}
  </div>`;
}

async function _dashTeam(el, user, profile) {
  const statusMap = { active:'✅ Verificato', pending:'⏳ In attesa', rejected:'❌ Rifiutato' };

  if (!profile) {
    el.innerHTML = `
      <div class="dash-grid">
        <div class="dash-card dash-card--accent">
          <div class="dash-card-title"><span>🔗</span>Collega il tuo team</div>
          <p style="font-size:.85rem;color:var(--text-muted);line-height:1.5">
            Associa il tuo account al tuo team per accedere alle statistiche di squadra, classifica team e gestione atleti.
          </p>
          <div class="dash-link-form">
            <input type="text" id="link-team-name" placeholder="Nome squadra" required />
            <button class="dash-btn dash-btn--primary" onclick="submitLinkTeam(event)">COLLEGA TEAM</button>
          </div>
        </div>
      </div>`;
    return;
  }

  const teamId   = profile.team_id;
  const teamName = profile.team_name || teamId || '';
  const res      = globalData?.resultsRaw || [];
  const teamRes  = teamId
    ? res.filter(r => (r.team||'').toLowerCase() === teamName.toLowerCase()).sort((a,b)=>(b.data||'').localeCompare(a.data||'')).slice(0,6)
    : [];

  // team ranking across categories
  const cats = [...new Set(res.map(r => getRankingFileCode(r)).filter(Boolean))];
  const teamRankRows = [];
  for (const cat of cats) {
    const tr = computeTeamRanking ? computeTeamRanking(res, cat) : null;
    if (!tr) continue;
    const idx = tr.findIndex(t => (t.team||'').toLowerCase() === teamName.toLowerCase());
    if (idx < 0) continue;
    const t = tr[idx];
    teamRankRows.push({ cat, catLabel: catLabel(cat), pos: t.pos||idx+1, punti: t.punti, n_atleti: t.n_atleti||0 });
  }

  const totalVittorie = teamRes.filter(r => r.pos===1||r.pos==='1').length;
  const atleti = [...new Set(teamRes.map(r=>r.atleta_id).filter(Boolean))].length;

  el.innerHTML = `
    <div class="dash-grid">

      <div class="dash-card">
        <div class="dash-card-title"><span>👥</span>Il tuo team</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span class="dash-status ${profile.status==='active'?'dash-status--ok':profile.status==='pending'?'dash-status--warn':'dash-status--err'}">${statusMap[profile.status]||profile.status}</span>
          ${teamId ? `<a href="#/team/${esc(teamId)}" class="dash-btn dash-btn--outline dash-btn--sm">👁 Profilo pubblico</a>` : ''}
        </div>
        <div style="font-size:1rem;font-weight:800;color:var(--text-primary);margin:4px 0">${esc(teamName)}</div>
        <div class="dash-stats-row">
          <div class="dash-stat"><div class="dash-stat-val">${atleti}</div><div class="dash-stat-lbl">Atleti</div></div>
          <div class="dash-stat"><div class="dash-stat-val">${teamRes.length}</div><div class="dash-stat-lbl">Risultati</div></div>
          <div class="dash-stat"><div class="dash-stat-val">${totalVittorie}</div><div class="dash-stat-lbl">Vittorie</div></div>
        </div>
      </div>

      ${teamRankRows.length ? `
      <div class="dash-card">
        <div class="dash-card-title"><span>🏆</span>Posizioni classifica team</div>
        ${teamRankRows.map(r => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-subtle)">
            <div>
              <div style="font-size:.82rem;font-weight:700">${esc(r.catLabel)}</div>
              <div style="font-size:.72rem;color:var(--text-muted)">${r.punti} punti · ${r.n_atleti} atleti</div>
            </div>
            <div style="font-family:var(--font-display);font-size:1.6rem;font-weight:900;color:${r.pos<=3?'var(--accent)':'var(--text-secondary)'}">#${r.pos}</div>
          </div>`).join('')}
        <a href="#/team" class="dash-btn dash-btn--outline dash-btn--sm" style="margin-top:4px">Classifica team →</a>
      </div>` : ''}

      ${teamRes.length ? `
      <div class="dash-card">
        <div class="dash-card-title"><span>📋</span>Ultimi risultati squadra</div>
        <div class="dash-results-list">
          ${teamRes.map(r => `
            <div class="dash-result-row">
              <div class="dash-result-pos">${r.pos||'–'}</div>
              <div class="dash-result-name">${esc((r.cognome||'')+' '+(r.nome||'').slice(0,1)+'.')}</div>
              <div class="dash-result-date">${(r.data||'').slice(5)}</div>
              <div class="dash-result-pts">${r.punti_effettivi||''}</div>
            </div>`).join('')}
        </div>
        ${teamId ? `<a href="#/team/${esc(teamId)}" class="dash-btn dash-btn--outline dash-btn--sm">Tutti i risultati →</a>` : ''}
      </div>` : ''}

      <!-- ROSTER ATLETI -->
      ${teamRes.length ? `
      <div class="dash-card dash-card--skill">
        <div class="dash-card-title"><span>👤</span>Roster squadra</div>
        <div class="dash-skill-desc">Gli atleti che hanno corso per ${esc(teamName)}.</div>
        ${[...new Map(teamRes.concat(res.filter(r=>(r.team||'').toLowerCase()===teamName.toLowerCase())).map(r=>[r.atleta_id,r])).values()].slice(0,8).map(r=>`
          <div class="dash-athlete-item">
            <div class="dash-athlete-info">
              <div class="dash-athlete-name"><a href="#/atleta/${esc(String(r.atleta_id||''))}" style="color:inherit;text-decoration:none">${esc((r.cognome||'')+' '+(r.nome||''))}</a></div>
              <div class="dash-athlete-sub">${res.filter(x=>x.atleta_id===r.atleta_id).length} gare</div>
            </div>
          </div>`).join('')}
        ${teamId?`<a href="#/team/${esc(teamId)}" class="dash-btn dash-btn--outline dash-btn--sm">Tutti gli atleti →</a>`:''}
      </div>` : ''}

      <div class="dash-card">
        <div class="dash-card-title"><span>⚡</span>Azioni rapide</div>
        <div class="dash-actions-grid">
          <a href="#/team"        class="dash-quick-btn"><span class="dqb-icon">🏆</span>Class. team</a>
          <a href="#/classifica"  class="dash-quick-btn"><span class="dqb-icon">📊</span>Classifica</a>
          <a href="#/risultati"   class="dash-quick-btn"><span class="dqb-icon">📋</span>Risultati</a>
          <a href="#/statistiche" class="dash-quick-btn"><span class="dqb-icon">📈</span>Statistiche</a>
          <a href="#/calendario"  class="dash-quick-btn"><span class="dqb-icon">📅</span>Calendario</a>
          <a href="#/atleti"      class="dash-quick-btn"><span class="dqb-icon">👤</span>Atleti</a>
        </div>
      </div>

      <!-- SKILL: RACCOGLITORE FOTO & VIDEO -->
      ${_skillCollection()}

      <!-- SKILL: CALENDARIO -->
      ${_skillCalendario()}

      <!-- SKILL: CONDIVISIONE -->
      ${_skillCondivisione('team', teamId)}

      <!-- SKILL: NOTIFICHE -->
      ${_skillNotifiche('team')}

    </div>`;

  window._refreshCollectionCard = () => { const i=document.getElementById('dash-collection-inner'); if(i) i.innerHTML=_collectionInner(getMediaCollection()); };
}

async function _dashGenitore(el, user, profile) {
  _dashFamiglia(el, user, profile, 'genitore');
}
async function _dashParente(el, user, profile) {
  _dashFamiglia(el, user, profile, 'parente');
}

async function _dashFamiglia(el, user, profile, role) {
  const statusMap = { active:'✅', pending:'⏳', rejected:'❌' };
  const links = Array.isArray(profile) ? profile : [];
  const res   = globalData?.resultsRaw || [];

  // Build athlete cards for linked athletes
  const atletaCards = links.filter(l => l.status === 'active' && l.linked_atleta_id).map(l => {
    const aid = l.linked_atleta_id;
    const myRes = res.filter(r => r.atleta_id === aid).sort((a,b)=>(b.data||'').localeCompare(a.data||'')).slice(0,3);
    const vittorie = res.filter(r => r.atleta_id === aid && (r.pos===1||r.pos==='1')).length;
    const rankInfo = _dashRankingInfo(aid);
    const bestRank = rankInfo && rankInfo.length ? rankInfo.reduce((b,r)=>r.pos<b.pos?r:b, rankInfo[0]) : null;
    return { l, aid, myRes, vittorie, bestRank };
  });

  el.innerHTML = `
    <div class="dash-grid">

      ${atletaCards.length ? atletaCards.map(({l, aid, myRes, vittorie, bestRank}) => `
      <div class="dash-card dash-card--accent">
        <div class="dash-card-title"><span>🚴</span>${esc(aid)}</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <a href="#/atleta/${esc(aid)}" class="dash-btn dash-btn--outline dash-btn--sm">👁 Profilo</a>
          <span style="font-size:.75rem;color:var(--text-muted)">${l.relation||''}</span>
        </div>
        ${bestRank ? `
        <div style="display:flex;align-items:center;gap:10px">
          <div style="font-family:var(--font-display);font-size:2rem;font-weight:900;color:${bestRank.pos<=3?'var(--accent)':'var(--text-secondary)'}">#${bestRank.pos}</div>
          <div style="font-size:.8rem;color:var(--text-muted)">${esc(bestRank.catLabel)}<br>${bestRank.punti} punti</div>
        </div>` : ''}
        <div class="dash-stats-row">
          <div class="dash-stat"><div class="dash-stat-val">${res.filter(r=>r.atleta_id===aid).length}</div><div class="dash-stat-lbl">Gare</div></div>
          <div class="dash-stat"><div class="dash-stat-val">${vittorie}</div><div class="dash-stat-lbl">Vittorie</div></div>
        </div>
        ${myRes.length ? `
        <div class="dash-results-list">
          ${myRes.map(r=>`
            <div class="dash-result-row">
              <div class="dash-result-pos">${r.pos||'–'}</div>
              <div class="dash-result-name">${esc((r.gara||'').slice(0,22))}</div>
              <div class="dash-result-date">${(r.data||'').slice(5)}</div>
            </div>`).join('')}
        </div>` : ''}
      </div>`).join('') : ''}

      <!-- Pending links -->
      ${links.filter(l=>l.status!=='active').length ? `
      <div class="dash-card">
        <div class="dash-card-title"><span>⏳</span>Richieste in attesa</div>
        ${links.filter(l=>l.status!=='active').map(l=>`
          <div class="dash-athlete-item">
            <div class="dash-athlete-info">
              <div class="dash-athlete-name">${esc(l.linked_atleta_id)}</div>
              <div class="dash-athlete-sub">${l.relation||''}</div>
            </div>
            <span class="dash-status ${l.status==='pending'?'dash-status--warn':'dash-status--err'}">${statusMap[l.status]||l.status}</span>
          </div>`).join('')}
      </div>` : ''}

      <!-- Aggiungi atleta -->
      <div class="dash-card">
        <div class="dash-card-title"><span>➕</span>Aggiungi atleta</div>
        <div class="dash-link-form">
          <input type="text" id="link-search" placeholder="Cerca per cognome…" oninput="searchAtletaForLink(this.value)" autocomplete="off" />
          <div id="link-results"></div>
          <input type="hidden" id="link-atleta-id" />
          <button class="dash-btn dash-btn--primary" onclick="submitLinkFamily(event)">AGGIUNGI</button>
        </div>
      </div>

      <!-- Quick links -->
      <div class="dash-card">
        <div class="dash-card-title"><span>⚡</span>Esplora</div>
        <div class="dash-actions-grid">
          <a href="#/classifica"  class="dash-quick-btn"><span class="dqb-icon">🏆</span>Classifiche</a>
          <a href="#/risultati"   class="dash-quick-btn"><span class="dqb-icon">📋</span>Risultati</a>
          <a href="#/calendario"  class="dash-quick-btn"><span class="dqb-icon">📅</span>Calendario</a>
          <a href="#/statistiche" class="dash-quick-btn"><span class="dqb-icon">📊</span>Statistiche</a>
        </div>
      </div>

      <!-- SKILL: RACCOGLITORE FOTO & VIDEO -->
      ${_skillCollection()}

      <!-- SKILL: CALENDARIO -->
      ${_skillCalendario()}

      <!-- SKILL: NOTIFICHE -->
      ${_skillNotifiche(role)}

    </div>`;

  window._refreshCollectionCard = () => { const i=document.getElementById('dash-collection-inner'); if(i) i.innerHTML=_collectionInner(getMediaCollection()); };
}

async function _dashAppassionato(el, user) {
  const wl  = typeof getWatchlist === 'function' ? getWatchlist() : [];
  const res = globalData?.resultsRaw || [];

  // Build watchlist cards
  const wlData = wl.slice(0, 8).map(aid => {
    const myRes = res.filter(r => r.atleta_id === aid).sort((a,b)=>(b.data||'').localeCompare(a.data||'')).slice(0,2);
    const lastRes = myRes[0];
    const rankInfo = _dashRankingInfo(aid);
    const bestRank = rankInfo && rankInfo.length ? rankInfo.reduce((b,r)=>r.pos<b.pos?r:b, rankInfo[0]) : null;
    const name = lastRes ? `${lastRes.cognome||''} ${lastRes.nome||''}`.trim() : aid;
    return { aid, name, lastRes, bestRank };
  });

  // Top moments: best results in last 30 days
  const cutoff = new Date(Date.now() - 30*86400000).toISOString().slice(0,10);
  const topRecent = res.filter(r => (r.data||'')>=cutoff && [1,2,3,'1','2','3'].includes(r.pos))
    .sort((a,b)=>(b.data||'').localeCompare(a.data||'')).slice(0,5);

  el.innerHTML = `
    <div class="dash-grid">

      <!-- WATCHLIST -->
      <div class="dash-card ${wlData.length?'':'dash-card--accent'}">
        <div class="dash-card-title"><span>⭐</span>La mia watchlist</div>
        ${wlData.length ? `
        ${wlData.map(({aid, name, lastRes, bestRank}) => `
          <div class="dash-wl-row">
            <div>
              <div class="dash-wl-name"><a href="#/atleta/${esc(aid)}" style="color:inherit;text-decoration:none">${esc(name)}</a></div>
              ${lastRes ? `<div class="dash-wl-team">${esc(lastRes.team||'')} · ${(lastRes.data||'').slice(5)}</div>` : ''}
            </div>
            ${bestRank ? `<div class="dash-wl-pos">#${bestRank.pos}</div>` : ''}
          </div>`).join('')}
        <a href="#/atleti" class="dash-btn dash-btn--outline dash-btn--sm" style="margin-top:4px">Scopri altri atleti →</a>` :
        `<p style="font-size:.85rem;color:var(--text-muted)">La tua watchlist è vuota. Vai su una scheda atleta e clicca ★ per aggiungerlo.</p>
        <a href="#/atleti" class="dash-btn dash-btn--primary">Esplora atleti →</a>`}
      </div>

      <!-- TOP RISULTATI RECENTI -->
      ${topRecent.length ? `
      <div class="dash-card">
        <div class="dash-card-title"><span>🔥</span>Top risultati (ultimi 30 gg)</div>
        <div class="dash-results-list">
          ${topRecent.map(r => `
            <div class="dash-result-row">
              <div class="dash-result-pos">${r.pos}</div>
              <div class="dash-result-name"><a href="#/atleta/${esc(r.atleta_id||'')}" style="color:inherit;text-decoration:none">${esc((r.cognome||'')+' '+(r.nome||'').slice(0,1)+'.')}</a></div>
              <div class="dash-result-date">${(r.data||'').slice(5)}</div>
              <div class="dash-result-pts">${esc(r.team||'')}</div>
            </div>`).join('')}
        </div>
      </div>` : ''}

      <!-- EXPLORE -->
      <div class="dash-card">
        <div class="dash-card-title"><span>🔭</span>Esplora il ciclismo italiano</div>
        <div class="dash-actions-grid">
          <a href="#/classifica"   class="dash-quick-btn"><span class="dqb-icon">🏆</span>Classifiche</a>
          <a href="#/risultati"    class="dash-quick-btn"><span class="dqb-icon">📋</span>Risultati</a>
          <a href="#/atleti"       class="dash-quick-btn"><span class="dqb-icon">👤</span>Atleti</a>
          <a href="#/team"         class="dash-quick-btn"><span class="dqb-icon">👥</span>Team</a>
          <a href="#/statistiche"  class="dash-quick-btn"><span class="dqb-icon">📊</span>Statistiche</a>
          <a href="#/comparatore"  class="dash-quick-btn"><span class="dqb-icon">⚖️</span>Comparatore</a>
          <a href="#/calendario"   class="dash-quick-btn"><span class="dqb-icon">📅</span>Calendario</a>
        </div>
      </div>

      <!-- SKILL: RACCOGLITORE FOTO & VIDEO -->
      ${_skillCollection()}

      <!-- SKILL: CALENDARIO -->
      ${_skillCalendario()}

      <!-- SKILL: NOTIFICHE -->
      ${_skillNotifiche('appassionato')}

    </div>`;

  window._refreshCollectionCard = () => { const i=document.getElementById('dash-collection-inner'); if(i) i.innerHTML=_collectionInner(getMediaCollection()); };
}

async function _dashMedia(el, user, profile) {
  const statusMap = { active:'✅ Approvato', pending:'⏳ In attesa', rejected:'❌ Rifiutato' };

  if (!profile) {
    el.innerHTML = `
      <div class="dash-grid">
        <div class="dash-card dash-card--accent">
          <div class="dash-card-title"><span>📷</span>Crea il tuo profilo fotografo</div>
          <p style="font-size:.85rem;color:var(--text-muted);line-height:1.5">
            Crea il tuo profilo per pubblicare album fotografici delle gare e farti trovare dagli appassionati.
          </p>
          <form onsubmit="window.submitMediaProfile(event)" class="dash-link-form">
            <input type="text" id="mp-name" placeholder="Nome pubblico *" required />
            <input type="text" id="mp-bio"  placeholder="Bio (breve presentazione)" />
            <input type="url"  id="mp-web"  placeholder="Sito web" />
            <input type="text" id="mp-ig"   placeholder="Instagram (senza @)" />
            <input type="text" id="mp-fb"   placeholder="Facebook" />
            <button type="submit" class="dash-btn dash-btn--primary">CREA PROFILO</button>
          </form>
        </div>

        <div class="dash-card">
          <div class="dash-card-title"><span>🔗</span>Aggancia un profilo già esistente</div>
          <p style="font-size:.85rem;color:var(--text-muted);line-height:1.5">
            Se le tue foto sono già presenti su Italiacrit (importate da xpix.it o italiaciclismo.net),
            puoi rivendicare quel profilo invece di crearne uno nuovo. La richiesta sarà verificata dall'admin.
          </p>
          <div id="dash-media-claim-list"><div class="admin-loading">Caricamento profili disponibili…</div></div>
        </div>
      </div>`;

    // Carica i profili media scrapati ancora liberi
    const claimEl = document.getElementById('dash-media-claim-list');
    if (claimEl) {
      try {
        const d = await apiCall('/media/profiles/unclaimed');
        const profs = d.profiles || [];
        claimEl.innerHTML = profs.length ? `
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px">
            ${profs.map(p => `
              <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg-base);border:1px solid var(--border-subtle);border-radius:6px">
                <div style="flex:1;min-width:0;font-size:.9rem;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.display_name)}</div>
                <button class="dash-btn dash-btn--outline dash-btn--sm" style="flex:0 0 auto;white-space:nowrap" onclick="window.submitClaimMediaProfile(${p.id}, this)">Aggancia</button>
              </div>`).join('')}
          </div>` : `<div style="font-size:.8rem;color:var(--text-muted);padding:8px 0">Nessun profilo libero da rivendicare al momento.</div>`;
      } catch (e) {
        claimEl.innerHTML = `<div style="font-size:.8rem;color:var(--text-muted);padding:8px 0">Impossibile caricare i profili (${esc(e.message)}).</div>`;
      }
    }
    return;
  }

  el.innerHTML = `
    <div class="dash-grid">

      <div class="dash-card">
        <div class="dash-card-title"><span>📷</span>Il tuo profilo media</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span class="dash-status ${profile.status==='active'?'dash-status--ok':profile.status==='pending'?'dash-status--warn':'dash-status--err'}">${statusMap[profile.status]||profile.status}</span>
          ${profile.status==='active' ? `<a href="#/media/${profile.id}" class="dash-btn dash-btn--outline dash-btn--sm">👁 Profilo pubblico</a>` : ''}
          <button onclick="window.openMediaProfileEdit(${JSON.stringify(profile).replace(/"/g,'&quot;')})" class="dash-btn dash-btn--outline dash-btn--sm">✏️ Modifica</button>
        </div>
        <div style="font-size:1rem;font-weight:800;color:var(--text-primary)">${esc(profile.display_name)}</div>
        ${profile.bio ? `<div style="font-size:.82rem;color:var(--text-muted)">${esc(profile.bio)}</div>` : ''}
        <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:.8rem">
          ${profile.website  ? `<a href="${esc(profile.website)}"  target="_blank" rel="noopener" style="color:var(--accent)">🌐 Sito</a>` : ''}
          ${profile.instagram? `<a href="https://instagram.com/${esc(profile.instagram.replace('@',''))}" target="_blank" rel="noopener" style="color:var(--accent)">📸 Instagram</a>` : ''}
          ${profile.facebook ? `<a href="${profile.facebook.startsWith('http')?esc(profile.facebook):'https://facebook.com/'+esc(profile.facebook)}" target="_blank" rel="noopener" style="color:var(--accent)">👍 Facebook</a>` : ''}
        </div>
      </div>

      ${profile.status === 'active' ? `
      <div class="dash-card dash-card--accent">
        <div class="dash-card-title"><span>📁</span>I miei album</div>
        <div id="dash-albums-inner"><div class="admin-loading">Caricamento…</div></div>
      </div>

      <div class="dash-card">
        <div class="dash-card-title"><span>⚡</span>Azioni rapide</div>
        <div class="dash-actions-grid">
          <button onclick="window.openMediaAlbumCreate(${profile.id})" class="dash-quick-btn"><span class="dqb-icon">➕</span>Nuovo album</button>
          <a href="#/media/${profile.id}" class="dash-quick-btn"><span class="dqb-icon">👁</span>Vedi profilo</a>
          <a href="#/risultati" class="dash-quick-btn"><span class="dqb-icon">📋</span>Risultati</a>
          <a href="#/calendario" class="dash-quick-btn"><span class="dqb-icon">📅</span>Calendario</a>
        </div>
      </div>

      <!-- SKILL: RACCOGLITORE FOTO & VIDEO -->
      ${_skillCollection()}

      <!-- SKILL: CALENDARIO (gare da coprire) -->
      ${_skillCalendario()}

      <!-- SKILL: NOTIFICHE -->
      ${_skillNotifiche('media')}` : ''}

    </div>`;

  window._refreshCollectionCard = () => { const i=document.getElementById('dash-collection-inner'); if(i) i.innerHTML=_collectionInner(getMediaCollection()); };

  // Load albums async
  if (profile.status === 'active') {
    const albumEl = document.getElementById('dash-albums-inner');
    if (albumEl) {
      try {
        const d = await fetch(`${API_BASE}/media/profile/${profile.id}`).then(r=>r.json());
        const albums = d.albums || [];
        albumEl.innerHTML = albums.length ? `
          <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:10px">${albums.length} album · ${d.stats?.total||0} foto totali</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${albums.slice(0,5).map(a=>`
              <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border-subtle)">
                <div style="width:48px;height:36px;border-radius:4px;overflow:hidden;background:var(--bg-base);flex-shrink:0">
                  ${(a.first_ext_url||a.first_filename) ? `<img src="${a.first_ext_url||(PHOTOS_BASE+'/photos/'+a.first_filename)}" style="width:100%;height:100%;object-fit:cover" loading="lazy"/>` : '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted)">📷</div>'}
                </div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:.82rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.title)}</div>
                  <div style="font-size:.7rem;color:var(--text-muted)">${a.photo_count} foto</div>
                </div>
                <button onclick="window.openMediaAlbumUpload(${a.id})" class="dash-btn dash-btn--outline dash-btn--sm">+ Foto</button>
              </div>`).join('')}
          </div>
          ${albums.length > 5 ? `<div style="font-size:.78rem;color:var(--text-muted);margin-top:8px">+${albums.length-5} altri album</div>` : ''}
          <button onclick="window.openMediaAlbumCreate(${profile.id})" class="dash-btn dash-btn--accent dash-btn--sm" style="margin-top:10px">+ Nuovo album</button>
        ` : `<p style="font-size:.85rem;color:var(--text-muted)">Nessun album ancora.</p>
             <button onclick="window.openMediaAlbumCreate(${profile.id})" class="dash-btn dash-btn--primary">+ Crea il primo album</button>`;
      } catch(e) {
        albumEl.innerHTML = `<span style="color:var(--red-hot);font-size:.8rem">Errore: ${esc(e.message)}</span>`;
      }
    }
  }
}

async function _dashAdmin(el, user) {
  // Quick stats from globalData
  const res   = globalData?.resultsRaw  || [];
  const cal   = globalData?.calendar    || [];
  const today = new Date().toISOString().slice(0,10);
  const thisY = today.slice(0,4);
  const gare  = [...new Set(res.map(r=>r.gara_id||r.gara).filter(Boolean))].length;
  const atleti= [...new Set(res.map(r=>r.atleta_id).filter(Boolean))].length;
  const gareY = res.filter(r=>(r.data||'').startsWith(thisY));
  const prossime = cal.filter(g=>(g.data||g.date||'')>=today).length;

  el.innerHTML = `
    <div class="dash-grid">

      <div class="dash-card">
        <div class="dash-card-title"><span>📊</span>Dati del database</div>
        <div class="dash-stats-row">
          <div class="dash-stat"><div class="dash-stat-val">${res.length}</div><div class="dash-stat-lbl">Risultati</div></div>
          <div class="dash-stat"><div class="dash-stat-val">${gare}</div><div class="dash-stat-lbl">Gare</div></div>
          <div class="dash-stat"><div class="dash-stat-val">${atleti}</div><div class="dash-stat-lbl">Atleti</div></div>
          <div class="dash-stat"><div class="dash-stat-val">${prossime}</div><div class="dash-stat-lbl">In calendario</div></div>
        </div>
      </div>

      <div class="dash-card">
        <div class="dash-card-title"><span>⚡</span>Accesso rapido</div>
        <div class="dash-actions-grid">
          <a href="#/admin"                   class="dash-quick-btn"><span class="dqb-icon">⚙️</span>Gestionale</a>
          <a href="#/admin" onclick="setTimeout(()=>adminNav('overview'),100)" class="dash-quick-btn"><span class="dqb-icon">📊</span>Dashboard</a>
          <a href="#/admin" onclick="setTimeout(()=>adminNav('utenti-lista'),100)" class="dash-quick-btn"><span class="dqb-icon">👥</span>Utenti</a>
          <a href="#/admin" onclick="setTimeout(()=>adminNav('foto-pending'),100)" class="dash-quick-btn"><span class="dqb-icon">📥</span>Foto</a>
          <a href="#/admin" onclick="setTimeout(()=>adminNav('sync'),100)" class="dash-quick-btn"><span class="dqb-icon">🔄</span>Sync dati</a>
          <a href="#/admin" onclick="setTimeout(()=>adminNav('page-gallery'),100)" class="dash-quick-btn"><span class="dqb-icon">🗂️</span>Pagine</a>
        </div>
      </div>

    </div>`;
}

// ── MEDIA PROFILE HANDLERS ────────────────────────────────────────────────────

window.submitMediaProfile = async function(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Invio…';
  try {
    await apiCall('/profile/media', { method: 'POST', body: {
      display_name: document.getElementById('mp-name')?.value.trim(),
      bio:          document.getElementById('mp-bio')?.value.trim(),
      website:      document.getElementById('mp-web')?.value.trim(),
      instagram:    document.getElementById('mp-ig')?.value.trim(),
      facebook:     document.getElementById('mp-fb')?.value.trim(),
    }});
    showToast('✓ Profilo inviato — in attesa di approvazione');
    renderMyProfile();
  } catch(err) {
    btn.disabled = false; btn.textContent = 'CREA PROFILO';
    showToast('Errore: ' + err.message, 'error');
  }
};

// Rivendica un profilo media già esistente (scrapato)
window.submitClaimMediaProfile = async function(profileId, btn) {
  if (!confirm('Vuoi rivendicare questo profilo come tuo? La richiesta verrà verificata dall\'amministratore.')) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Invio…'; }
  try {
    await apiCall(`/media/profile/${profileId}/claim`, { method: 'POST' });
    showToast('✓ Richiesta inviata — in attesa di approvazione');
    renderMyProfile();
  } catch(err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Aggancia'; }
    showToast('Errore: ' + err.message, 'error');
  }
};

window.openMediaProfileEdit = function(profile) {
  const inpStyle = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:var(--r-sm);font-size:0.875rem;background:var(--bg-primary);color:var(--text-primary);margin-bottom:10px';
  const overlay = document.createElement('div');
  overlay.id = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `
    <div style="background:var(--bg-card);border-radius:var(--r-lg);padding:24px;width:100%;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,.25);max-height:90vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <strong>Modifica profilo</strong>
        <button onclick="this.closest('[style*=fixed]').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text-muted)">✕</button>
      </div>
      <label style="font-size:.8rem;color:var(--text-muted);display:block;margin-bottom:4px">Nome pubblico *</label>
      <input id="mpe-name" type="text" value="${esc(profile.display_name||'')}" style="${inpStyle}" required/>
      <label style="font-size:.8rem;color:var(--text-muted);display:block;margin-bottom:4px">Bio</label>
      <input id="mpe-bio"  type="text" value="${esc(profile.bio||'')}" placeholder="Breve descrizione" style="${inpStyle}"/>
      <label style="font-size:.8rem;color:var(--text-muted);display:block;margin-bottom:4px">Sito web</label>
      <input id="mpe-web"  type="url"  value="${esc(profile.website||'')}" placeholder="https://…" style="${inpStyle}"/>
      <label style="font-size:.8rem;color:var(--text-muted);display:block;margin-bottom:4px">Instagram</label>
      <input id="mpe-ig"   type="text" value="${esc(profile.instagram||'')}" placeholder="nomeutente (senza @)" style="${inpStyle}"/>
      <label style="font-size:.8rem;color:var(--text-muted);display:block;margin-bottom:4px">Facebook</label>
      <input id="mpe-fb"   type="text" value="${esc(profile.facebook||'')}" placeholder="nomepagina o URL profilo" style="${inpStyle}"/>
      <div id="mpe-err" style="color:#EF4444;font-size:0.8rem;margin-bottom:8px;display:none"></div>
      <button id="mpe-submit" onclick="window._submitMediaProfileEdit()" style="width:100%;padding:9px;background:var(--accent);color:#fff;border:none;border-radius:var(--r-sm);font-weight:600;cursor:pointer">Salva modifiche</button>
    </div>`;
  document.body.appendChild(overlay);
};

window._submitMediaProfileEdit = async function() {
  const btn   = document.getElementById('mpe-submit');
  const errEl = document.getElementById('mpe-err');
  btn.disabled = true; btn.textContent = 'Salvataggio…';
  try {
    await apiCall('/profile/media', { method: 'PATCH', body: {
      display_name: document.getElementById('mpe-name')?.value.trim(),
      bio:          document.getElementById('mpe-bio')?.value.trim(),
      website:      document.getElementById('mpe-web')?.value.trim(),
      instagram:    document.getElementById('mpe-ig')?.value.trim(),
      facebook:     document.getElementById('mpe-fb')?.value.trim(),
    }});
    document.getElementById('modal-overlay')?.remove();
    showToast('✓ Profilo aggiornato');
    renderMyProfile();
  } catch(err) {
    errEl.textContent = err.message; errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Salva modifiche';
  }
};

window.openMediaAlbumCreate = function(profileId) {
  const inpStyle = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:var(--r-sm);font-size:0.875rem;background:var(--bg-primary);color:var(--text-primary);margin-bottom:10px';
  const overlay = document.createElement('div');
  overlay.id = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `
    <div style="background:var(--bg-card);border-radius:var(--r-lg);padding:24px;width:100%;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,.25)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <strong>Nuovo album</strong>
        <button onclick="this.closest('[style*=fixed]').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text-muted)">✕</button>
      </div>
      <input id="mac-title" type="text" placeholder="Titolo album *" style="${inpStyle}" required/>
      <input id="mac-gara"  type="text" placeholder="ID gara (es. 27_TROFEO_…_JUN_M) — opzionale" style="${inpStyle}"/>
      <textarea id="mac-desc" placeholder="Descrizione (opzionale)" rows="2" style="${inpStyle};resize:vertical"></textarea>
      <div id="mac-err" style="color:#EF4444;font-size:0.8rem;margin-bottom:8px;display:none"></div>
      <button id="mac-submit" onclick="window._submitMediaAlbumCreate(${profileId})" style="width:100%;padding:9px;background:var(--accent);color:#fff;border:none;border-radius:var(--r-sm);font-weight:600;cursor:pointer">Crea album</button>
    </div>`;
  document.body.appendChild(overlay);
};

window._submitMediaAlbumCreate = async function(profileId) {
  const title = document.getElementById('mac-title')?.value.trim();
  const gara  = document.getElementById('mac-gara')?.value.trim() || null;
  const desc  = document.getElementById('mac-desc')?.value.trim() || '';
  const errEl = document.getElementById('mac-err');
  const btn   = document.getElementById('mac-submit');
  if (!title) { errEl.textContent = 'Il titolo è obbligatorio'; errEl.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Creazione…';
  try {
    const d = await apiCall('/media/album', { method: 'POST', body: { title, gara_id: gara, description: desc } });
    document.getElementById('modal-overlay')?.remove();
    showToast('✓ Album creato!');
    // Apri subito il caricamento foto
    window.openMediaAlbumUpload(d.album.id);
    renderMyProfile();
  } catch(err) {
    errEl.textContent = err.message; errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Crea album';
  }
};

window.openMediaAlbumUpload = function(albumId) {
  const overlay = document.createElement('div');
  overlay.id = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `
    <div style="background:var(--bg-card);border-radius:var(--r-lg);padding:24px;width:100%;max-width:480px;box-shadow:0 8px 32px rgba(0,0,0,.25)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <strong>Carica foto nell'album</strong>
        <button onclick="this.closest('[style*=fixed]').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text-muted)">✕</button>
      </div>
      <p style="font-size:.8rem;color:var(--text-muted);margin:0 0 12px">Puoi selezionare più file contemporaneamente (max 20, 25 MB ciascuno). Formati: JPEG, PNG, WebP.</p>
      <input type="file" id="mau-files" multiple accept="image/jpeg,image/png,image/webp"
        style="width:100%;box-sizing:border-box;padding:8px;border:2px dashed var(--border);border-radius:8px;cursor:pointer;margin-bottom:12px"/>
      <div id="mau-progress" style="display:none;margin-bottom:8px">
        <div style="background:var(--bg-elevated);border-radius:4px;height:6px;overflow:hidden">
          <div id="mau-bar" style="height:100%;background:var(--accent);width:0%;transition:width .3s"></div>
        </div>
        <div id="mau-status" style="font-size:.75rem;color:var(--text-muted);margin-top:4px"></div>
      </div>
      <div id="mau-err" style="color:#EF4444;font-size:0.8rem;margin-bottom:8px;display:none"></div>
      <button id="mau-submit" onclick="window._submitMediaPhotos(${albumId})" style="width:100%;padding:9px;background:var(--accent);color:#fff;border:none;border-radius:var(--r-sm);font-weight:600;cursor:pointer">Carica foto</button>
    </div>`;
  document.body.appendChild(overlay);
};

window._submitMediaPhotos = async function(albumId) {
  const files = document.getElementById('mau-files')?.files;
  const errEl = document.getElementById('mau-err');
  const btn   = document.getElementById('mau-submit');
  const prog  = document.getElementById('mau-progress');
  if (!files?.length) { errEl.textContent = 'Seleziona almeno un file'; errEl.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Caricamento…';
  prog.style.display = 'block';
  const fd = new FormData();
  Array.from(files).forEach(f => fd.append('photos', f));
  try {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = ev => {
      if (ev.lengthComputable) {
        const pct = Math.round(ev.loaded / ev.total * 100);
        document.getElementById('mau-bar').style.width = pct + '%';
        document.getElementById('mau-status').textContent = `${pct}% — ${files.length} foto in caricamento…`;
      }
    };
    await new Promise((resolve, reject) => {
      xhr.onload = () => {
        const d = JSON.parse(xhr.responseText);
        if (xhr.status >= 400) reject(new Error(d.error || `HTTP ${xhr.status}`));
        else resolve(d);
      };
      xhr.onerror = () => reject(new Error('Errore di rete'));
      xhr.open('POST', `${API_BASE}/media/album/${albumId}/photos`);
      xhr.setRequestHeader('Authorization', `Bearer ${authToken()}`);
      xhr.send(fd);
    });
    document.getElementById('modal-overlay')?.remove();
    showToast(`✓ ${files.length} foto caricate!`);
    renderMyProfile();
  } catch(err) {
    errEl.textContent = err.message; errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Carica foto';
  }
};

window.deleteMediaAlbum = async function(albumId) {
  if (!confirm('Eliminare questo album e tutte le sue foto?')) return;
  try {
    await apiCall(`/media/album/${albumId}`, { method: 'DELETE' });
    showToast('Album eliminato');
    renderMyProfile();
  } catch(err) { showToast('Errore: ' + err.message, 'error'); }
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

