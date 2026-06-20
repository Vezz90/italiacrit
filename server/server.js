const path = require('path');
const fs   = require('fs');

// Carica variabili da .env.local (solo in locale, mai in produzione)
// Le variabili già presenti nell'ambiente hanno precedenza.
(function loadEnvLocal() {
  const envPath = path.join(__dirname, '.env.local');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (!m) return;
    const [, key, raw] = m;
    if (!process.env[key]) process.env[key] = raw.trim().replace(/^(['"])(.*)\1$/, '$2');
  });
  console.log('[env] Caricate variabili da .env.local');
})();

const express        = require('express');
const compression    = require('compression');
const cors           = require('cors');
const bcrypt         = require('bcryptjs');
const jwt            = require('jsonwebtoken');
const multer         = require('multer');
const { queries, init, rawQuery } = require('./db');

const app  = express();

// ── Email (nodemailer) ────────────────────────────────────────────────────────
let _transporter = null;
(function initMailer() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log('[email] SMTP non configurato (SMTP_HOST/SMTP_USER/SMTP_PASS mancanti) — email disabilitate');
    return;
  }
  try {
    const nodemailer = require('nodemailer');
    _transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465',
      auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    console.log('[email] Nodemailer pronto:', process.env.SMTP_HOST);
  } catch (e) {
    console.warn('[email] Errore init nodemailer:', e.message);
  }
})();

// ── Anthropic (Claude) — usato per caption social media ──────────────────────
let _anthropic = null;
function getAnthropic() {
  if (!_anthropic && process.env.ANTHROPIC_API_KEY) {
    try {
      const { Anthropic } = require('@anthropic-ai/sdk');
      _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    } catch (e) { console.warn('[anthropic] SDK non installato:', e.message); }
  }
  return _anthropic;
}

async function sendEmail({ to, subject, html, text }) {
  if (!_transporter) return;
  const from = process.env.SMTP_FROM || `"ItaliacritResultati" <${process.env.SMTP_USER}>`;
  try {
    await _transporter.sendMail({ from, to, subject, html, text });
    console.log('[email] ✓', subject, '→', to);
  } catch (e) {
    console.error('[email] ✗', e.message);
  }
}

// ── Notification helper ───────────────────────────────────────────────────────
// Salva nel DB e, se email_to presente, spedisce anche l'email
async function sendNotification({ user_id, type = 'info', title, body = '', data = {}, email_to, email_subject, email_html }) {
  if (user_id) {
    try { await queries.createNotification({ user_id, type, title, body, data }); }
    catch (e) { console.error('[notify] DB error:', e.message); }
  }
  if (email_to && email_subject) {
    const baseHtml = email_html || `<p>${body.replace(/\n/g,'<br/>')}</p>`;
    const footer = `
      <hr style="margin:30px 0;border:none;border-top:1px solid #eee"/>
      <p style="font-size:11px;color:#999;text-align:center">
        <a href="https://italiacrit.it/#/profilo" style="color:#e65c00">Vai al tuo profilo ItaliacritResultati</a>
        &nbsp;·&nbsp; Non affiliato a FCI
      </p>`;
    await sendEmail({
      to: email_to,
      subject: email_subject,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">${baseHtml}${footer}</div>`,
      text: body,
    });
  }
}
const PORT = 8002;
const JWT_SECRET  = process.env.JWT_SECRET || 'italiacrit-dev-secret-2026';
const JWT_EXPIRES = '30d';

// ── Web Push (notifiche PWA) ────────────────────────────────────────────────
let webpush = null;
// Chiavi VAPID — DEVONO essere impostate come env su Render:
//   VAPID_PUBLIC, VAPID_PRIVATE  (genera con: npx web-push generate-vapid-keys)
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC  || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || '';
try {
  webpush = require('web-push');
  if (VAPID_PUBLIC && VAPID_PRIVATE) {
    webpush.setVapidDetails('mailto:info@italiacrit.it', VAPID_PUBLIC, VAPID_PRIVATE);
    console.log('[push] Web Push attivo');
  } else {
    console.log('[push] VAPID keys mancanti — imposta VAPID_PUBLIC/VAPID_PRIVATE su Render');
  }
} catch (e) { console.log('[push] modulo web-push non disponibile:', e.message); }

// Invia una notifica push a tutte le subscription registrate
async function sendPushToAll({ title, body, url }) {
  if (!webpush || !VAPID_PUBLIC || !VAPID_PRIVATE) return { sent: 0 };
  let sent = 0;
  try {
    const subs = await rawQuery(`SELECT * FROM push_subscriptions`).then(r => r.rows);
    const payload = JSON.stringify({ title, body, url: url || '/' });
    await Promise.all(subs.map(async s => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        );
        sent++;
      } catch (err) {
        // 410/404 = subscription scaduta → rimuovi
        if (err.statusCode === 410 || err.statusCode === 404) {
          await rawQuery(`DELETE FROM push_subscriptions WHERE endpoint=$1`, [s.endpoint]).catch(()=>{});
        }
      }
    }));
  } catch (e) { console.warn('[push] sendToAll:', e.message); }
  return { sent };
}

// Invia una push alle sole subscription di un utente specifico
async function sendPushToUser(userId, { title, body, url }) {
  if (!webpush || !VAPID_PUBLIC || !VAPID_PRIVATE || !userId) return { sent: 0 };
  let sent = 0;
  try {
    const subs = await rawQuery(`SELECT * FROM push_subscriptions WHERE user_id=$1`, [userId]).then(r => r.rows);
    const payload = JSON.stringify({ title, body, url: url || '/' });
    await Promise.all(subs.map(async s => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sent++;
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404)
          await rawQuery(`DELETE FROM push_subscriptions WHERE endpoint=$1`, [s.endpoint]).catch(() => {});
      }
    }));
  } catch (e) { console.warn('[push] sendToUser:', e.message); }
  return { sent };
}

// Notifica gli atleti appena taggati in una foto (esclude chi si auto-tagga).
async function notifyPhotoTag(photo, addedIds, taggerUserId) {
  for (const aid of (addedIds || [])) {
    try {
      const profs = await queries.getProfilesByAtletaId(aid);
      for (const p of profs) {
        if (!p.user_id) continue;
        if (['active', 'approved'].indexOf(p.status) === -1) continue;
        if (taggerUserId && Number(p.user_id) === Number(taggerUserId)) continue; // auto-tag → niente notifica
        const url = photo.gara_id ? `/#/gara/${encodeURIComponent(photo.gara_id)}` : '/';
        await sendNotification({
          user_id: p.user_id,
          type: 'photo_tag',
          title: '🏷 Sei stato taggato in una foto',
          body: 'Qualcuno ti ha taggato in una foto di gara. Aprila per vederla o per rimuovere il tag.',
          data: { gara_id: photo.gara_id, photo_id: photo.id },
        });
        await sendPushToUser(p.user_id, { title: '🏷 Sei in una foto!', body: 'Sei stato taggato in una foto di gara.', url });
      }
    } catch (e) { console.warn('[notify photo_tag]', e.message); }
  }
}

// ── Supabase Storage ──────────────────────────────────────────────────────────
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
let supabase = null;
if (SUPABASE_URL && SUPABASE_SECRET) {
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  supabase = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });
  console.log('[storage] Supabase Storage attivo');
}

// ── Uploads locali (fallback sviluppo) ───────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

function makeFilename(req, ext) {
  const base = req.body.entity_type && req.body.entity_id
    ? (req.body.entity_type + '_' + req.body.entity_id)
    : ('photo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
  return base.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) + ext;
}

const upload = multer({
  storage: supabase ? multer.memoryStorage() : multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => cb(null, makeFilename(req, path.extname(file.originalname).toLowerCase() || '.jpg')),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Solo immagini JPEG, PNG, WebP o GIF'));
  },
});

async function savePhoto(req, file) {
  const ext      = path.extname(file.originalname).toLowerCase() || '.jpg';
  const filename = makeFilename(req, ext);
  if (supabase) {
    const { error } = await supabase.storage.from('photos').upload(filename, file.buffer, { contentType: file.mimetype, upsert: true });
    if (error) throw new Error(error.message);
  } else {
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), file.buffer || fs.readFileSync(file.path));
  }
  return filename;
}

async function deletePhoto(filename) {
  if (supabase) {
    await supabase.storage.from('photos').remove([filename]);
  } else {
    const p = path.join(UPLOADS_DIR, filename);
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  }
}

app.use(compression());
app.use(cors({ origin: '*' }));
app.options('*', cors());
app.use(express.json());
app.use('/photos', express.static(UPLOADS_DIR));

const FRONTEND_DIR = path.join(__dirname, '..');
app.use(express.static(FRONTEND_DIR, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.json')) res.setHeader('Cache-Control', 'public, max-age=300');
    else if (/\.(png|jpg|jpeg|webp|svg|ico|woff2?)$/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=86400');
    else if (/\.(js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));

// ── Auth middleware ───────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Non autenticato' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token non valido o scaduto' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accesso negato' });
    next();
  });
}

// In locale senza DB l'autenticazione non è disponibile: accetta le richieste
// che arrivano da localhost senza token (solo per endpoint import)
function requireAdminOrLocal(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  const { queries } = require('./db');
  if (isLocal && !process.env.DATABASE_URL) return next();
  requireAdmin(req, res, next);
}

function makeToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, display_name: user.display_name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

// ── Open Graph endpoint (per condivisione Facebook/social) ──────────────────
// Restituisce una pagina HTML con meta OG + redirect al SPA.
// Usato come URL da condividere: FB scrapa qui, il click porta al sito.
const DATA_DIR       = path.join(__dirname, '..', 'data');
const SITE_URL       = 'https://vezz90.github.io/italiacrit';
const SUPABASE_PUB   = 'https://aqqsstsbgpapzoxllosh.supabase.co/storage/v1/object/public';
const DEFAULT_OG_IMG = `${SITE_URL}/assets/og-default.png`;

function readDataJson(file) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); }
  catch { return null; }
}

// Cache per i file letti da GitHub Pages (fonte di verità uguale al frontend).
// Aggiornamento automatico ogni 30 minuti; fallback al file locale in caso di errore.
const _ghCache = {};
const GH_CACHE_TTL = 30 * 60 * 1000;
async function readDataJsonFromGH(file) {
  const cached = _ghCache[file];
  if (cached && (Date.now() - cached.ts) < GH_CACHE_TTL) return cached.data;
  try {
    const url = `${SITE_URL}/data/${encodeURIComponent(file)}`;
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    _ghCache[file] = { data, ts: Date.now() };
    return data;
  } catch (e) {
    console.warn(`[GH fetch] ${file} failed (${e.message}), using local fallback`);
    const local = readDataJson(file);
    if (local) _ghCache[file] = { data: local, ts: Date.now() - GH_CACHE_TTL + 5 * 60 * 1000 }; // riprova fra 5min
    return local;
  }
}

async function getEntityPhoto(type, id) {
  try {
    const ov = await queries.getEntityOverrides(type, id);
    const photoField = ov.find(r => r.field === 'photo_url');
    if (photoField?.new_value) return SUPABASE_PUB + photoField.new_value;
  } catch {}
  return null;
}

function ogHtml({ title, desc, img, redirect }) {
  const safe = s => String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="ItaliacritResultati"/>
<meta property="og:title" content="${safe(title)}"/>
<meta property="og:description" content="${safe(desc)}"/>
<meta property="og:url" content="${safe(redirect)}"/>
<meta property="og:image" content="${safe(img||DEFAULT_OG_IMG)}"/>
<meta property="og:image:width" content="1080"/>
<meta property="og:image:height" content="1080"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${safe(title)}"/>
<meta name="twitter:description" content="${safe(desc)}"/>
<meta name="twitter:image" content="${safe(img||DEFAULT_OG_IMG)}"/>
<title>${safe(title)}</title>
<script>window.location.replace(${JSON.stringify(redirect)});</script>
</head><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0f172a;color:#f1f5f9">
<p>Reindirizzamento in corso…</p>
<a href="${safe(redirect)}" style="color:#6366f1">Clicca qui se non vieni reindirizzato</a>
</body></html>`;
}

const API_BASE_URL = 'https://italiacrit.onrender.com';

app.get('/og/gara/:id', async (req, res) => {
  const id  = req.params.id;
  const [calRaw, resultsRaw] = await Promise.all([
    readDataJsonFromGH('calendar.json'),
    readDataJsonFromGH('results_raw.json'),
  ]);
  const cal     = (calRaw || []).find(g => g.id === id);
  const results = (resultsRaw || []).filter(r => r.gara_id === id).sort((a,b) => a.posizione - b.posizione);
  const title   = cal?.nome || id.replace(/_/g,' ');
  const date    = cal?.data ? new Date(cal.data).toLocaleDateString('it-IT',{day:'numeric',month:'long',year:'numeric'}) : '';
  const top3    = results.slice(0,3).map((r,i)=>`${i+1}° ${r.cognome} ${r.nome}`).join(' · ');
  const luogo   = cal?.luogo || cal?.regione || '';
  const desc    = [date, luogo, top3].filter(Boolean).join(' — ');
  const img     = `${API_BASE_URL}/api/og-image/gara/${encodeURIComponent(id)}`;
  const redirect = `${SITE_URL}/#/gara/${encodeURIComponent(id)}`;
  res.setHeader('Content-Type','text/html');
  res.send(ogHtml({ title, desc, img, redirect }));
});

app.get('/og/atleta/:id', async (req, res) => {
  const id       = req.params.id;
  const athletes = await readDataJsonFromGH('athletes.json') || {};
  const ath      = athletes[id] || {};
  const title    = `${ath.cognome||''} ${ath.nome||''}`.trim() || id;
  const catMap   = {ELI_M:'Elite',ELI_F:'Elite Donne',JUN_M:'Juniores',JUN_F:'Juniores Donne',AL_M:'Allievi',AL_F:'Allieve',ES1_M:'Esordienti 1°',ES2_M:'Esordienti 2°',ES1_F:'Esordienti 1° Donne',ES2_F:'Esordienti 2° Donne'};
  const cat      = catMap[ath.categoria] || ath.categoria || '';
  const parts    = [cat, ath.team_attuale].filter(Boolean);
  if (ath.punti_totali) parts.push(`${ath.punti_totali} pt`);
  if (ath.vittorie)     parts.push(`${ath.vittorie} vitt.`);
  const desc     = parts.join(' · ') || 'Ciclista — Italia Cycling Stats';
  const img      = `${API_BASE_URL}/api/og-image/atleta/${encodeURIComponent(id)}`;
  const redirect = `${SITE_URL}/#/atleta/${encodeURIComponent(id)}`;
  res.setHeader('Content-Type','text/html');
  res.send(ogHtml({ title, desc, img, redirect }));
});

app.get('/og/team/:id', async (req, res) => {
  const id    = req.params.id;
  const [teams, athletes] = await Promise.all([
    readDataJsonFromGH('teams.json'),
    readDataJsonFromGH('athletes.json'),
  ]);
  const team  = (teams || {})[id] || {};
  const title = team.nome || id.replace(/_/g,' ');
  const riders = Object.values(athletes || {}).filter(a => a.team_id === id).length;
  const desc  = riders ? `${riders} corridori — Italia Cycling Stats` : 'Team — Italia Cycling Stats';
  const img   = `${API_BASE_URL}/api/og-image/team/${encodeURIComponent(id)}`;
  const redirect = `${SITE_URL}/#/team/${encodeURIComponent(id)}`;
  res.setHeader('Content-Type','text/html');
  res.send(ogHtml({ title, desc, img, redirect }));
});

// ── Sitemap.xml ───────────────────────────────────────────────────────────────
app.get('/sitemap.xml', async (req, res) => {
  try {
    const CANONICAL = 'https://italiacyclingstats.com';
    const [athletes, resultsRaw] = await Promise.all([
      readDataJsonFromGH('athletes.json'),
      readDataJsonFromGH('results_raw.json'),
    ]);
    const urls = [
      { loc: `${CANONICAL}/`,              priority: '1.0', changefreq: 'daily' },
      { loc: `${CANONICAL}/#/risultati`,   priority: '0.9', changefreq: 'daily' },
      { loc: `${CANONICAL}/#/classifica`,  priority: '0.8', changefreq: 'weekly' },
      { loc: `${CANONICAL}/#/calendario`,  priority: '0.7', changefreq: 'weekly' },
      { loc: `${CANONICAL}/#/atleti`,      priority: '0.7', changefreq: 'weekly' },
      { loc: `${CANONICAL}/#/albo`,        priority: '0.6', changefreq: 'monthly' },
    ];
    for (const id of Object.keys(athletes || {})) {
      if (id) urls.push({ loc: `${CANONICAL}/og/atleta/${encodeURIComponent(id)}`, priority: '0.7', changefreq: 'weekly' });
    }
    const garaIds = [...new Set((resultsRaw || []).map(r => r.gara_id).filter(Boolean))];
    for (const gid of garaIds) {
      urls.push({ loc: `${CANONICAL}/og/gara/${encodeURIComponent(gid)}`, priority: '0.6', changefreq: 'monthly' });
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
      urls.map(u => `  <url><loc>${u.loc}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')
    }\n</urlset>`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  } catch (e) {
    res.status(500).send('<!-- sitemap error -->');
  }
});

// ── Auth routes ───────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, role, display_name } = req.body;
    const ALLOWED_ROLES = ['atleta', 'team', 'genitore', 'parente', 'appassionato', 'media'];
    if (!email || !password) return res.status(400).json({ error: 'Email e password obbligatorie' });
    if (password.length < 6)  return res.status(400).json({ error: 'Password minimo 6 caratteri' });
    if (!ALLOWED_ROLES.includes(role)) return res.status(400).json({ error: 'Tipo utente non valido' });

    const existing = await queries.getUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'Email già registrata' });

    const hash = bcrypt.hashSync(password, 10);
    const user = await queries.createUser({
      email:        email.trim().toLowerCase(),
      password:     hash,
      role,
      display_name: display_name?.trim() || email.split('@')[0],
    });
    res.status(201).json({ token: makeToken(user), user });
  } catch (e) {
    res.status(500).json({ error: 'Errore durante la registrazione' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e password obbligatorie' });

    const user = await queries.getUserByEmail(email.trim());
    if (!user) return res.status(401).json({ error: 'Credenziali non valide' });

    const ok = bcrypt.compareSync(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Credenziali non valide' });

    await queries.updateLastLogin(user.id);
    const safe = await queries.getUserById(user.id);
    try { const _p = await queries.getAthleteProfile(user.id); if (_p?.atleta_id) safe.atleta_id = _p.atleta_id; } catch {}
    res.json({ token: makeToken(safe), user: safe });
  } catch (e) {
    res.status(500).json({ error: 'Errore durante il login' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await queries.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Utente non trovato' });
    try { const _p = await queries.getAthleteProfile(req.user.id); if (_p?.atleta_id) user.atleta_id = _p.atleta_id; } catch {}
    // Restituisce anche un token fresco: così eventuali cambi di ruolo
    // (es. fatti dall'admin) si propagano alla sessione dopo un refresh.
    res.json({ user, token: makeToken(user) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Profile routes ────────────────────────────────────────────────────────────

app.get('/api/profile', requireAuth, async (req, res) => {
  try {
    const { id, role } = req.user;
    let profile = null;
    if (role === 'atleta')                        profile = await queries.getAthleteProfile(id);
    else if (role === 'team')                     profile = await queries.getTeamProfile(id);
    else if (role === 'genitore' || role === 'parente') profile = await queries.getFamilyLinks(id);
    res.json({ profile });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Profilo personale dell'utente (campi liberi, tutti i ruoli)
app.get('/api/profile/details', requireAuth, async (req, res) => {
  try { res.json({ details: await queries.getUserDetails(req.user.id) || {} }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/profile/details', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const clip = (v, n) => String(v ?? '').trim().slice(0, n);
    const details = await queries.upsertUserDetails({
      user_id:        req.user.id,
      bio:            clip(b.bio, 500),
      location:       clip(b.location, 120),
      instagram:      clip(b.instagram, 120),
      facebook:       clip(b.facebook, 200),
      strava:         clip(b.strava, 200),
      website:        clip(b.website, 200),
      specialty:      clip(b.specialty, 60),
      birth_year:     clip(b.birth_year, 10),
      favorite_team:  clip(b.favorite_team, 120),
      staff_role:     clip(b.staff_role, 80),
      public_contact: clip(b.public_contact, 160),
      favorite_rider: clip(b.favorite_rider, 120),
    });
    res.json({ ok: true, details });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Partecipazione gare (atleta dichiara se parteciperà)
app.get('/api/participations', requireAuth, async (req, res) => {
  try { res.json({ participations: await queries.getRaceParticipations(req.user.id) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/participations/:gara_id', requireAuth, async (req, res) => {
  try {
    const { status, note } = req.body || {};
    if (!['yes','no','maybe'].includes(status)) return res.status(400).json({ error: 'Status non valido (yes/no/maybe)' });
    await queries.upsertRaceParticipation(req.user.id, req.params.gara_id, status, note || '');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/participations/:gara_id', requireAuth, async (req, res) => {
  try { await queries.deleteRaceParticipation(req.user.id, req.params.gara_id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/profile/link-athlete', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'atleta') return res.status(403).json({ error: 'Solo per atleti' });
    const { atleta_id, fci_code, first_name, last_name, team, birth_year } = req.body;

    const existing = await queries.getAthleteProfile(req.user.id);
    if (existing) return res.status(409).json({ error: 'Profilo già presente' });

    await queries.createAthleteProfile({
      user_id: req.user.id,
      atleta_id: atleta_id || null,
      fci_code: fci_code || null,
      first_name: first_name || null,
      last_name: last_name || null,
      team: team || null,
      birth_year: birth_year || null,
      status: atleta_id ? 'active' : 'pending',
    });
    res.status(201).json({ ok: true, status: atleta_id ? 'active' : 'pending' });
  } catch (e) {
    res.status(500).json({ error: 'Errore durante il collegamento' });
  }
});

app.post('/api/profile/link-team', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'team') return res.status(403).json({ error: 'Solo per team' });
    const { team_id, team_name } = req.body;

    const existing = await queries.getTeamProfile(req.user.id);
    if (existing) return res.status(409).json({ error: 'Profilo già presente' });

    await queries.createTeamProfile({
      user_id: req.user.id,
      team_id: team_id || null,
      team_name: team_name || null,
      status: team_id ? 'active' : 'pending',
    });
    res.status(201).json({ ok: true, status: team_id ? 'active' : 'pending' });
  } catch (e) {
    res.status(500).json({ error: 'Errore durante il collegamento' });
  }
});

app.post('/api/profile/link-family', requireAuth, async (req, res) => {
  try {
    if (!['genitore', 'parente'].includes(req.user.role))
      return res.status(403).json({ error: 'Solo per genitore/parente' });
    const { linked_atleta_id } = req.body;
    if (!linked_atleta_id) return res.status(400).json({ error: 'atleta_id obbligatorio' });

    await queries.createFamilyLink({
      user_id: req.user.id,
      linked_atleta_id,
      relation: req.user.role,
      status: 'pending',
    });
    res.status(201).json({ ok: true, status: 'pending' });
  } catch (e) {
    res.status(500).json({ error: 'Errore durante il collegamento' });
  }
});

// ── Admin routes ──────────────────────────────────────────────────────────────

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try { res.json({ users: await queries.getAllUsers() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

const VALID_ROLES = ['atleta', 'team', 'genitore', 'parente', 'appassionato', 'media', 'admin'];

// Cambio ruolo utente (admin)
async function _adminSetUserRole(req, res) {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!userId) return res.status(400).json({ error: 'ID utente non valido' });
    const { role } = req.body || {};
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Ruolo non valido' });
    if (userId === req.user.id) return res.status(400).json({ error: 'Non puoi modificare il tuo stesso ruolo' });
    const updated = await queries.updateUserRole(userId, role);
    if (!updated) return res.status(404).json({ error: 'Utente non trovato' });
    res.json({ ok: true, user: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
app.patch('/api/admin/users/:id', requireAdmin, _adminSetUserRole);
app.post('/api/admin/users/:id/role', requireAdmin, _adminSetUserRole);

// Crea account di prova puliti, uno per ruolo (admin).
// I profili fasulli da collegare sono in data/extra_roster.json (atleti/team)
// e in media_profiles (xpix, canali video) — creati da ensureScraperMediaProfiles().
app.post('/api/admin/seed-test-accounts', requireAdmin, async (req, res) => {
  try {
    const password = (req.body?.password || 'Prova2026!').toString();
    if (password.length < 6) return res.status(400).json({ error: 'Password troppo corta (min 6)' });
    const hash = bcrypt.hashSync(password, 10);
    const accounts = [
      { email: 'prova-atleta@italiacrit.test',      role: 'atleta',      display_name: 'Prova Atleta'      },
      { email: 'prova-team@italiacrit.test',         role: 'team',        display_name: 'Prova Team'        },
      { email: 'prova-media-foto@italiacrit.test',   role: 'media',       display_name: 'Prova Media Foto'  },
      { email: 'prova-media-video@italiacrit.test',  role: 'media',       display_name: 'Prova Media Video' },
      { email: 'prova-genitore@italiacrit.test',     role: 'genitore',    display_name: 'Prova Genitore'    },
      { email: 'prova-parente@italiacrit.test',      role: 'parente',     display_name: 'Prova Parente'     },
      { email: 'prova-appassionato@italiacrit.test', role: 'appassionato',display_name: 'Prova Appassionato'},
    ];
    const results = [];
    for (const a of accounts) {
      const existing = await queries.getUserByEmail(a.email);
      if (!existing) await queries.createUser({ email: a.email, password: hash, role: a.role, display_name: a.display_name });
      results.push({ email: a.email, role: a.role, created: !existing });
    }
    res.json({
      ok: true, password, accounts: results,
      note: 'Profili fasulli da collegare: atleti "Prova" nel Team di Prova ASD (cerca "prova" o "rossi"); profili media: xpix.it, canali YouTube.',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Eliminazione utente (admin)
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!userId) return res.status(400).json({ error: 'ID utente non valido' });
    if (userId === req.user.id) return res.status(400).json({ error: 'Non puoi eliminare il tuo stesso account' });
    await queries.deleteUser(userId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/pending', requireAdmin, async (req, res) => {
  try { res.json({ pending: await queries.getPendingProfiles() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/approve', requireAdmin, async (req, res) => {
  try {
    const { type, id } = req.body;
    if      (type === 'athlete') await queries.approveAthleteProfile(id);
    else if (type === 'team')    await queries.approveTeamProfile(id);
    else if (type === 'family')  await queries.approveFamilyLink(id);
    else if (type === 'media')   await queries.approveMediaProfile(id);
    else return res.status(400).json({ error: 'Tipo non valido' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/reject', requireAdmin, async (req, res) => {
  try {
    const { type, id } = req.body;
    if      (type === 'athlete') await queries.rejectAthleteProfile(id);
    else if (type === 'team')    await queries.rejectTeamProfile(id);
    else if (type === 'family')  await queries.rejectFamilyLink(id);
    else if (type === 'media')   await queries.rejectMediaProfile(id);
    else return res.status(400).json({ error: 'Tipo non valido' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/overrides', requireAdmin, async (req, res) => {
  try {
    res.json({
      gare:      await queries.getAllGaraOverrides(),
      risultati: await queries.getAllRisultatoOverrides(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/override/gara', requireAdmin, async (req, res) => {
  try {
    const { gara_id, field, old_value, new_value } = req.body;
    if (!gara_id || !field) return res.status(400).json({ error: 'Campi mancanti' });
    await queries.setGaraOverride({ gara_id, field, old_value: old_value ?? null, new_value, edited_by: req.user.id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/override/risultato', requireAdmin, async (req, res) => {
  try {
    const { risultato_key, field, old_value, new_value } = req.body;
    if (!risultato_key || !field) return res.status(400).json({ error: 'Campi mancanti' });
    await queries.setRisultatoOverride({ risultato_key, field, old_value: old_value ?? null, new_value, edited_by: req.user.id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/gara-overrides/:gara_id', requireAdmin, async (req, res) => {
  try { res.json({ overrides: await queries.getGaraOverrides(req.params.gara_id) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/override/entity', requireAdmin, async (req, res) => {
  try {
    const { entity_type, entity_id, field, new_value } = req.body;
    if (!entity_type || !entity_id || !field) return res.status(400).json({ error: 'Campi mancanti' });
    await queries.setEntityOverride({ entity_type, entity_id, field, new_value, edited_by: req.user.id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/override/entity/:type/:id', async (req, res) => {
  try {
    const overrides = await queries.getEntityOverrides(req.params.type, req.params.id);
    const map = {};
    overrides.forEach(o => { map[o.field] = o.new_value; });
    res.json({ overrides: map });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/all-entity-overrides', requireAdmin, async (req, res) => {
  try { res.json({ overrides: await queries.getAllEntityOverrides() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: modifica atleta (nome/cognome/team) → salva come entity overrides ──
app.patch('/api/admin/atleti/:id', requireAdmin, async (req, res) => {
  try {
    const aid = req.params.id;
    const { cognome, nome, team, team_id } = req.body;
    const fields = [];
    if (cognome !== undefined) fields.push({ field: 'cognome', new_value: cognome });
    if (nome    !== undefined) fields.push({ field: 'nome',    new_value: nome    });
    if (team    !== undefined) fields.push({ field: 'team',    new_value: team    });
    if (team_id !== undefined) fields.push({ field: 'team_id', new_value: team_id });
    await Promise.all(fields.map(f =>
      queries.setEntityOverride({ entity_type: 'atleta', entity_id: aid, ...f, edited_by: req.user.id })
    ));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Photo upload ──────────────────────────────────────────────────────────────

app.post('/api/upload/photo', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    const { entity_type, entity_id } = req.body;
    if (!entity_type || !entity_id) return res.status(400).json({ error: 'Dati mancanti' });
    if (!req.file) return res.status(400).json({ error: 'Nessun file ricevuto' });

    const user = req.user;
    if (user.role !== 'admin') {
      if (entity_type === 'atleta' && user.role === 'atleta') {
        const profile = await queries.getAthleteProfile(user.id);
        if (!profile || profile.atleta_id !== entity_id || profile.status !== 'active')
          return res.status(403).json({ error: 'Profilo atleta non collegato o non verificato' });
      } else if (entity_type === 'team' && user.role === 'team') {
        const profile = await queries.getTeamProfile(user.id);
        if (!profile || profile.team_id !== entity_id || profile.status !== 'active')
          return res.status(403).json({ error: 'Profilo team non collegato o non verificato' });
      } else {
        return res.status(403).json({ error: 'Non autorizzato' });
      }
    }

    const filename  = await savePhoto(req, req.file);
    const photo_url = `/photos/${filename}`;
    await queries.setEntityOverride({
      entity_type, entity_id, field: 'photo_url', new_value: photo_url, edited_by: user.id,
    });
    res.json({ ok: true, photo_url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Race Photos ───────────────────────────────────────────────────────────────

app.post('/api/race-photos/upload', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    const { gara_id, caption, photographer, atleta_ids } = req.body;
    if (!gara_id) return res.status(400).json({ error: 'gara_id mancante' });
    if (!req.file) return res.status(400).json({ error: 'Nessun file ricevuto' });
    const filename     = await savePhoto(req, req.file);
    const display_name = req.user.display_name || req.user.email;
    const status       = req.user.role === 'admin' ? 'approved' : 'pending';
    // Normalizza i tag corridori in CSV pulito di atleta_id
    const tags = String(atleta_ids || '').split(',').map(s => s.trim()).filter(Boolean);
    await queries.insertRacePhoto({
      gara_id, user_id: req.user.id, display_name,
      filename, caption: caption || '', photographer: photographer || '', status,
      atleta_ids: [...new Set(tags)].join(','),
    });
    res.json({ ok: true, status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/race-photos', async (req, res) => {
  try { res.json({ photos: await queries.getAllApprovedRacePhotos() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/race-photos/:gara_id', async (req, res) => {
  try { res.json({ photos: await queries.getApprovedRacePhotos(req.params.gara_id) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/race-photos/pending', requireAdmin, async (req, res) => {
  try { res.json({ photos: await queries.getPendingRacePhotos() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/race-photos/:id/approve', requireAdmin, async (req, res) => {
  try { await queries.approveRacePhoto(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/race-photos/:id/reject', requireAdmin, async (req, res) => {
  try { await queries.rejectRacePhoto(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/race-photos/:id', requireAdmin, async (req, res) => {
  try {
    const { caption, photographer, gara_id, atleta_ids } = req.body;
    await queries.updateRacePhoto({ id: req.params.id, caption: caption || '', photographer: photographer || '' });
    // Cambio annata/gara: aggiorna il gara_id della foto
    if (gara_id) await queries.updateRacePhotoGara(req.params.id, gara_id);
    // Tag corridori (l'admin può impostare la lista completa)
    if (atleta_ids !== undefined) {
      const photo = await queries.getRacePhotoById(req.params.id);
      const prevSet = new Set(String(photo?.atleta_ids || '').split(',').map(s => s.trim()).filter(Boolean));
      const tags = [...new Set(String(atleta_ids || '').split(',').map(s => s.trim()).filter(Boolean))];
      await queries.setRacePhotoTags(req.params.id, tags.join(','));
      if (photo) notifyPhotoTag(photo, tags.filter(id => !prevSet.has(id)), req.user.id);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Tag/untag di sé stessi su una foto gara.
// Un account atleta approvato può aggiungere/togliere SOLO il proprio atleta_id;
// l'admin può taggare/togliere un atleta_id qualsiasi (passato nel body).
app.post('/api/race-photos/:id/self-tag', requireAuth, async (req, res) => {
  try {
    const photo = await queries.getRacePhotoById(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Foto non trovata' });
    let targetId = null;
    if (req.user.role === 'admin' && req.body.atleta_id) {
      targetId = String(req.body.atleta_id).trim();
    } else {
      const prof = await queries.getAthleteProfile(req.user.id);
      if (!prof || !['active','approved'].includes(prof.status) || !prof.atleta_id)
        return res.status(403).json({ error: 'Solo gli atleti verificati possono taggarsi' });
      targetId = String(prof.atleta_id).trim();
    }
    if (!targetId) return res.status(400).json({ error: 'atleta_id mancante' });
    const tagged = req.body.tagged !== false; // default: aggiungi
    const cur = new Set(String(photo.atleta_ids || '').split(',').map(s => s.trim()).filter(Boolean));
    if (tagged) cur.add(targetId); else cur.delete(targetId);
    await queries.setRacePhotoTags(req.params.id, [...cur].join(','));
    res.json({ ok: true, atleta_ids: [...cur].join(',') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Tag corridori da parte di un utente iscritto (qualsiasi ruolo loggato).
// AGGIUNGE i corridori indicati ai tag esistenti (merge): un utente non può
// rimuovere i tag messi da altri. La rimozione resta all'admin.
app.post('/api/race-photos/:id/tag', requireAuth, async (req, res) => {
  try {
    const photo = await queries.getRacePhotoById(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Foto non trovata' });
    const add = String(req.body.atleta_ids || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!add.length) return res.status(400).json({ error: 'Nessun corridore selezionato' });
    const cur = new Set(String(photo.atleta_ids || '').split(',').map(s => s.trim()).filter(Boolean));
    const newlyAdded = add.filter(id => !cur.has(id));
    add.forEach(id => cur.add(id));
    const csv = [...cur].join(',');
    await queries.setRacePhotoTags(req.params.id, csv);
    notifyPhotoTag(photo, newlyAdded, req.user.id); // notifica i taggati (no auto-tag)
    res.json({ ok: true, atleta_ids: csv });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Tag corridori su una foto di album ESTERNO (xpix / ciclismo.info).
// Le foto esterne non sono in race_photos: i tag vivono nella mappa
// entry.tags{ photoUrl: csv }. Add-only (merge) + notifica ai taggati.
app.post('/api/ext-photos/tag', requireAuth, async (req, res) => {
  try {
    const { source, gara_id, photo_url, atleta_ids } = req.body || {};
    if (!gara_id || !photo_url) return res.status(400).json({ error: 'Dati mancanti' });
    const store = source === 'ic'
      ? { read: readICPhotos, write: writeICPhotos }
      : { read: readXpixPhotos, write: writeXpixPhotos };
    const photos = await store.read();
    const entry = photos[gara_id];
    if (!entry) return res.status(404).json({ error: 'Foto non trovata' });
    const add = String(atleta_ids || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!add.length) return res.status(400).json({ error: 'Nessun corridore selezionato' });
    if (!entry.tags) entry.tags = {};
    const cur = new Set(String(entry.tags[photo_url] || '').split(',').map(s => s.trim()).filter(Boolean));
    const newly = add.filter(id => !cur.has(id));
    add.forEach(id => cur.add(id));
    entry.tags[photo_url] = [...cur].join(',');
    await store.write(photos);
    notifyPhotoTag({ gara_id, id: null }, newly, req.user.id);
    res.json({ ok: true, atleta_ids: entry.tags[photo_url] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rimuove il proprio tag da una foto di album esterno. Solo il proprietario
// dell'atleta_id (o un admin) può rimuovere.
app.post('/api/ext-photos/untag', requireAuth, async (req, res) => {
  try {
    const { source, gara_id, photo_url, atleta_id } = req.body || {};
    if (!gara_id || !photo_url || !atleta_id) return res.status(400).json({ error: 'Dati mancanti' });
    const profiles = await queries.getProfilesByAtletaId(atleta_id);
    const owns = profiles.some(p => p.user_id === req.user.id) || req.user.role === 'admin';
    if (!owns) return res.status(403).json({ error: 'Non autorizzato' });
    const store = source === 'ic'
      ? { read: readICPhotos, write: writeICPhotos }
      : { read: readXpixPhotos, write: writeXpixPhotos };
    const photos = await store.read();
    const entry = photos[gara_id];
    if (!entry) return res.status(404).json({ error: 'Foto non trovata' });
    if (!entry.tags?.[photo_url]) return res.json({ ok: true, atleta_ids: '' });
    const remaining = String(entry.tags[photo_url]).split(',').map(s => s.trim()).filter(id => id && id !== String(atleta_id));
    entry.tags[photo_url] = remaining.join(',');
    await store.write(photos);
    res.json({ ok: true, atleta_ids: entry.tags[photo_url] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/race-photos/:id', requireAdmin, async (req, res) => {
  try {
    const photo = await queries.getRacePhotoById(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Foto non trovata' });
    await queries.deleteRacePhoto(req.params.id);
    await deletePhoto(photo.filename);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ricalcola le didascalie delle race_photos col vincitore della LORO annata/gara.
// Aggiorna solo le caption nel formato auto "COGNOME Nome - Team | Gara".
app.post('/api/admin/race-photos/fix-captions', requireAdmin, async (req, res) => {
  try {
    const results = readDataJson('results_raw.json') || [];
    // mappa gara_id → vincitore (posizione minima)
    const winnerByGara = {};
    for (const r of results) {
      if (!r.gara_id || !r.posizione) continue;
      const cur = winnerByGara[r.gara_id];
      if (!cur || r.posizione < cur.posizione) winnerByGara[r.gara_id] = r;
    }
    const photos = await queries.getAllApprovedRacePhotos();
    let fixed = 0;
    for (const p of photos) {
      const w = winnerByGara[p.gara_id];
      if (!w) continue;
      const expected = `${w.cognome} ${w.nome} - ${w.team} | ${w.nome_gara || ''}`.trim();
      // Aggiorna solo se la caption sembra auto-generata (contiene " | ") o è diversa dall'attesa
      const looksAuto = !p.caption || / \| /.test(p.caption || '');
      if (looksAuto && p.caption !== expected) {
        await queries.updateRacePhoto({ id: p.id, caption: expected, photographer: p.photographer || '' });
        fixed++;
      }
    }
    res.json({ ok: true, fixed, total: photos.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── Cron esterno (keepalive GitHub Actions) ────────────────────────────────────
// Risponde subito (tiene Render sveglio) e lancia le sync in background.
// Così le sync girano anche se l'setInterval interno si è fermato per uno sleep.
let _lastCronSync = 0;
let _lastScrapeTrigger = 0;
// Triggera il workflow scrape su GitHub Actions (indipendente dal cron GitHub
// che è inaffidabile). Richiede GH_DISPATCH_TOKEN (PAT con scope actions:write).
function triggerScrapeWorkflow() {
  const token = process.env.GH_DISPATCH_TOKEN;
  const repo  = process.env.GH_REPO || 'Vezz90/italiacrit';
  if (!token) { console.warn('[cron] GH_DISPATCH_TOKEN mancante — scrape non triggerato'); return; }
  const https = require('https');
  const body  = JSON.stringify({ ref: 'main' });
  const req = https.request({
    hostname: 'api.github.com',
    path: `/repos/${repo}/actions/workflows/scrape.yml/dispatches`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'italiacrit-cron',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, r => {
    let resp = '';
    r.on('data', c => resp += c);
    r.on('end', () => {
      if (r.statusCode === 204) console.log('[cron] scrape workflow dispatch OK (204)');
      else console.warn(`[cron] scrape dispatch HTTP ${r.statusCode}: ${resp.slice(0,200)}`);
    });
  });
  req.on('error', e => console.warn('[cron] dispatch scrape error:', e.message));
  req.write(body);
  req.end();
}

// Test manuale: triggera lo scrape SUBITO e riporta lo status GitHub (diagnostica token)
app.get('/api/cron/test-scrape', async (req, res) => {
  const token = process.env.GH_DISPATCH_TOKEN;
  const repo  = process.env.GH_REPO || 'Vezz90/italiacrit';
  if (!token) return res.json({ ok: false, error: 'GH_DISPATCH_TOKEN non impostato su Render' });
  const https = require('https');
  const body  = JSON.stringify({ ref: 'main' });
  const ghReq = https.request({
    hostname: 'api.github.com',
    path: `/repos/${repo}/actions/workflows/scrape.yml/dispatches`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'italiacrit-cron',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, r => {
    let resp = ''; r.on('data', c => resp += c);
    r.on('end', () => res.json({ ok: r.statusCode === 204, status: r.statusCode, repo, response: resp.slice(0, 300) }));
  });
  ghReq.on('error', e => res.json({ ok: false, error: e.message }));
  ghReq.write(body); ghReq.end();
});

// ── Admin: Scraper status + manual trigger ────────────────────────────────────
app.get('/api/admin/scraper/status', requireAdmin, async (req, res) => {
  const token = process.env.GH_DISPATCH_TOKEN;
  const repo  = process.env.GH_REPO || 'Vezz90/italiacrit';
  let lastRun = null;
  if (token) {
    try {
      const ghRes = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/scrape.yml/runs?per_page=1`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'ItaliacritServer/1.0' }
      });
      const data = await ghRes.json();
      const run = data.workflow_runs?.[0];
      if (run) lastRun = { id: run.id, status: run.status, conclusion: run.conclusion, created_at: run.created_at, updated_at: run.updated_at, html_url: run.html_url };
    } catch (e) { /* non bloccare */ }
  }
  res.json({
    token_set:      !!token,
    anthropic_set:  !!process.env.ANTHROPIC_API_KEY,
    fb_set:         !!(process.env.FB_PAGE_ID && process.env.FB_PAGE_TOKEN),
    last_trigger_ts: _lastScrapeTrigger || null,
    last_sync_ts:    _lastCronSync      || null,
    last_gh_run:     lastRun,
  });
});

app.post('/api/admin/scraper/trigger', requireAdmin, async (req, res) => {
  if (!process.env.GH_DISPATCH_TOKEN) return res.status(400).json({ error: 'GH_DISPATCH_TOKEN non configurato su Render' });
  triggerScrapeWorkflow();
  res.json({ ok: true, message: 'Dispatch inviato a GitHub Actions — controlla lo stato tra 1-2 minuti' });
});

app.get('/api/cron/tick', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
  const now = Date.now();
  // Sync foto/video: max una volta ogni 25 min
  if (now - _lastCronSync >= 25 * 60 * 1000) {
    _lastCronSync = now;
    (async () => {
      try { await autoXpixSync(); }    catch (e) { console.warn('[cron] xpix:', e.message); }
      try { await autoYoutubeSync(); } catch (e) { console.warn('[cron] yt:', e.message); }
      try { await autoICSync(); }      catch (e) { console.warn('[cron] ic:', e.message); }
    })();
  }
  // Scrape risultati: max una volta ogni 30 min (solo mar–ott, stagione gare)
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 10 && now - _lastScrapeTrigger >= 30 * 60 * 1000) {
    _lastScrapeTrigger = now;
    triggerScrapeWorkflow();
  }
});

// ── Push notifications ──────────────────────────────────────────────────────
// Chiave pubblica VAPID (serve al client per subscribe)
app.get('/api/push/public-key', (req, res) => {
  res.json({ key: VAPID_PUBLIC || null });
});

// Registra una subscription (utente anche anonimo)
app.post('/api/push/subscribe', async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription?.endpoint || !subscription.keys) return res.status(400).json({ error: 'subscription non valida' });
    let userId = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      try { userId = jwt.verify(auth.slice(7), JWT_SECRET).id; } catch {}
    }
    await rawQuery(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh=$2, auth=$3, user_id=COALESCE($4, push_subscriptions.user_id)`,
      [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, userId]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rimuove una subscription (disiscrizione)
app.post('/api/push/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (endpoint) await rawQuery(`DELETE FROM push_subscriptions WHERE endpoint=$1`, [endpoint]).catch(()=>{});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin: invia una notifica push manuale a tutti
app.post('/api/admin/push/broadcast', requireAdmin, async (req, res) => {
  try {
    const { title, body, url } = req.body;
    if (!title) return res.status(400).json({ error: 'title obbligatorio' });
    const r = await sendPushToAll({ title, body: body || '', url });
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Notifica nuovi risultati — chiamato dal workflow GitHub dopo lo scrape.
// Protetto da token (SCRAPE_NOTIFY_TOKEN) per evitare abusi.
const SCRAPE_NOTIFY_TOKEN = process.env.SCRAPE_NOTIFY_TOKEN || '';
app.post('/api/internal/notify-results', async (req, res) => {
  try {
    if (!SCRAPE_NOTIFY_TOKEN || req.headers['x-notify-token'] !== SCRAPE_NOTIFY_TOKEN) return res.status(403).json({ error: 'token non valido' });
    const { count, title, body } = req.body || {};
    const r = await sendPushToAll({
      title: title || '🏁 Nuovi risultati disponibili',
      body:  body  || (count ? `${count} nuove gare aggiornate` : 'Le classifiche sono state aggiornate'),
      url: '/#/risultati',
    });
    // Background: accoda post social + notifica follower
    queueSocialPostsForToday().catch(e => console.warn('[social] queue error:', e.message));
    notifyFollowers().catch(e => console.warn('[follow] notify error:', e.message));
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── VIDEO MANAGEMENT ──────────────────────────────────────────────────────
// Persistenza: Supabase (kv_store) in produzione, file JSON in locale
const VIDEOS_PATH         = path.join(__dirname, '../data/videos.json');
const PENDING_VIDEOS_PATH = path.join(__dirname, '../data/pending_videos.json');

async function readVideos() {
  if (supabase) {
    const { data, error } = await supabase.from('kv_store').select('value').eq('key', 'videos').single();
    if (error && error.code !== 'PGRST116') console.error('[videos] read error:', error.message);
    return data?.value || {};
  }
  try { return JSON.parse(fs.readFileSync(VIDEOS_PATH, 'utf8')); } catch { return {}; }
}
async function writeVideos(obj) {
  if (supabase) {
    const { error } = await supabase.from('kv_store')
      .upsert({ key: 'videos', value: obj, updated_at: new Date().toISOString() });
    if (error) throw new Error('Supabase write error: ' + error.message);
    return;
  }
  fs.writeFileSync(VIDEOS_PATH, JSON.stringify(obj, null, 2));
}
async function readPendingVideos() {
  if (supabase) {
    const { data, error } = await supabase.from('kv_store').select('value').eq('key', 'pending_videos').single();
    if (error && error.code !== 'PGRST116') console.error('[pending] read error:', error.message);
    return data?.value || [];
  }
  try { return JSON.parse(fs.readFileSync(PENDING_VIDEOS_PATH, 'utf8')); } catch { return []; }
}
async function writePendingVideos(arr) {
  if (supabase) {
    const { error } = await supabase.from('kv_store')
      .upsert({ key: 'pending_videos', value: arr, updated_at: new Date().toISOString() });
    if (error) throw new Error('Supabase write error: ' + error.message);
    return;
  }
  fs.writeFileSync(PENDING_VIDEOS_PATH, JSON.stringify(arr, null, 2));
}

// Endpoint PUBBLICO — usato dal frontend in produzione invece del file statico
// Serve sempre la versione live di videos.json (aggiornata dall'admin)
app.get('/api/videos', async (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json(await readVideos());
});

// Lista tutti i video approvati (senza cache — legge sempre dal disco)
app.get('/api/admin/videos', requireAdmin, async (req, res) => {
  res.json(await readVideos());
});

// Submit URL YouTube (utenti autenticati)
app.post('/api/videos/submit', requireAuth, async (req, res) => {
  try {
    const { gara_id, cal_id, url, title, description, channel, atleta_ids } = req.body;
    if (!gara_id || !url) return res.status(400).json({ error: 'gara_id e url obbligatori' });
    // Usa sempre gara_id (include la categoria es. _JUN_M, _ELI_M) come chiave
    // così ogni categoria della stessa gara ha i propri video separati
    const key = gara_id;
    const tags = [...new Set(String(atleta_ids || '').split(',').map(s => s.trim()).filter(Boolean))].join(',');
    if (req.user.role === 'admin') {
      const videos = await readVideos();
      if (!videos[key]) videos[key] = [];
      if (videos[key].some(v => v.url === url)) return res.status(409).json({ error: 'Video già presente' });
      videos[key].push({ url, title: title || url, description: description || '', channel: channel || req.user.display_name || 'Admin', published_at: new Date().toISOString().slice(0,10), atleta_ids: tags });
      await writeVideos(videos);
      return res.json({ ok: true, status: 'approved' });
    }
    const pending = await readPendingVideos();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2,7);
    pending.push({ id, gara_id, cal_id: key, type: 'youtube', url, title: title || url, description: description || '', channel: channel || '', atleta_ids: tags, submitted_by: req.user.display_name || req.user.email, submitted_at: new Date().toISOString() });
    await writePendingVideos(pending);
    res.json({ ok: true, status: 'pending' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Upload file video (utenti autenticati) — multer inline per evitare dipendenza da videoUpload rimosso
const videoUpload = multer({
  storage: supabase ? multer.memoryStorage() : multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => cb(null, 'vid_' + Date.now() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^video\/(mp4|quicktime|x-msvideo|webm|x-matroska)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Solo file video MP4, MOV, AVI, WebM, MKV'));
  },
});

app.post('/api/videos/upload-file', requireAuth, videoUpload.single('video'), async (req, res) => {
  try {
    const { gara_id, cal_id, title, channel, atleta_ids } = req.body; // cal_id ignorato, usiamo sempre gara_id
    if (!gara_id) return res.status(400).json({ error: 'gara_id mancante' });
    if (!req.file) return res.status(400).json({ error: 'Nessun file ricevuto' });
    const vtags = [...new Set(String(atleta_ids || '').split(',').map(s => s.trim()).filter(Boolean))].join(',');
    const ext = path.extname(req.file.originalname).toLowerCase() || '.mp4';
    const filename = `vid_${Date.now()}${ext}`;
    let videoUrl;
    if (supabase) {
      const { error } = await supabase.storage.from('videos').upload(filename, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
      if (error) throw new Error(error.message);
      videoUrl = supabase.storage.from('videos').getPublicUrl(filename).data.publicUrl;
    } else {
      fs.writeFileSync(path.join(UPLOADS_DIR, filename), req.file.buffer || fs.readFileSync(req.file.path));
      videoUrl = `/uploads/${filename}`;
    }
    const key = gara_id; // usa sempre gara_id (con categoria) come chiave
    if (req.user.role === 'admin') {
      const videos = await readVideos();
      if (!videos[key]) videos[key] = [];
      videos[key].push({ url: videoUrl, title: title || filename, description: '', channel: channel || req.user.display_name || 'Admin', published_at: new Date().toISOString().slice(0,10), atleta_ids: vtags });
      await writeVideos(videos);
      return res.json({ ok: true, status: 'approved', url: videoUrl });
    }
    const pending = await readPendingVideos();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2,7);
    pending.push({ id, gara_id, cal_id: key, type: 'upload', url: videoUrl, title: title || filename, description: '', channel: channel || '', atleta_ids: vtags, submitted_by: req.user.display_name || req.user.email, submitted_at: new Date().toISOString() });
    await writePendingVideos(pending);
    res.json({ ok: true, status: 'pending', url: videoUrl });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: lista video in attesa di approvazione
app.get('/api/admin/videos/pending', requireAdmin, async (req, res) => {
  res.json({ videos: await readPendingVideos() });
});

// Admin: approva video in attesa
app.post('/api/admin/videos/pending/:id/approve', requireAdmin, async (req, res) => {
  try {
    const pending = await readPendingVideos();
    const i = pending.findIndex(v => v.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Non trovato' });
    const v = pending[i];
    const videos = await readVideos();
    const key = v.cal_id || v.gara_id;
    if (!videos[key]) videos[key] = [];
    videos[key].push({ url: v.url, title: v.title, description: v.description || '', channel: v.channel || v.submitted_by || '', published_at: (v.submitted_at || '').slice(0, 10), atleta_ids: v.atleta_ids || '' });
    await writeVideos(videos);
    pending.splice(i, 1);
    await writePendingVideos(pending);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: rifiuta video in attesa
app.post('/api/admin/videos/pending/:id/reject', requireAdmin, async (req, res) => {
  try {
    const pending = await readPendingVideos();
    const i = pending.findIndex(v => v.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Non trovato' });
    pending.splice(i, 1);
    await writePendingVideos(pending);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Aggiungi video manualmente a una gara (admin diretto, senza pending)
app.post('/api/admin/videos/:calId', requireAdmin, async (req, res) => {
  try {
    const { calId } = req.params;
    const { url, title, channel, description } = req.body;
    if (!url) return res.status(400).json({ error: 'url obbligatorio' });
    const videos = await readVideos();
    if (!videos[calId]) videos[calId] = [];
    // Evita duplicati per URL
    if (videos[calId].some(v => v.url === url)) return res.status(409).json({ error: 'Video già presente per questa gara' });
    videos[calId].push({
      url, title: title || url,
      description: description || '',
      channel: channel || 'Admin',
      published_at: new Date().toISOString().slice(0,10),
      score: 1,
    });
    await writeVideos(videos);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Sposta un video da una gara a un'altra
app.post('/api/admin/videos/:calId/:idx/move', requireAdmin, async (req, res) => {
  try {
    const { calId, idx } = req.params;
    const { newCalId } = req.body;
    if (!newCalId) return res.status(400).json({ error: 'newCalId obbligatorio' });
    const videos = await readVideos();
    if (!videos[calId]?.[parseInt(idx)]) return res.status(404).json({ error: 'Video non trovato' });
    const v = videos[calId].splice(parseInt(idx), 1)[0];
    if (!videos[calId].length) delete videos[calId];
    if (!videos[newCalId]) videos[newCalId] = [];
    videos[newCalId].unshift(v);
    await writeVideos(videos);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/videos/:calId/:idx', requireAdmin, async (req, res) => {
  try {
    const { calId, idx } = req.params;
    const videos = await readVideos();
    if (!videos[calId]) return res.status(404).json({ error: 'Gara non trovata' });
    videos[calId].splice(parseInt(idx), 1);
    if (!videos[calId].length) delete videos[calId];
    await writeVideos(videos);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Promuove un video a principale. Lo sposta nella chiave "primary_key" (quella
// letta per prima dalla pagina) e lo mette in cima, così diventa l'hero.
app.post('/api/admin/videos/:calId/:idx/promote', requireAdmin, async (req, res) => {
  try {
    const { calId, idx } = req.params;
    const { primary_key } = req.body || {};
    const videos = await readVideos();
    const list = videos[calId];
    const i = parseInt(idx);
    if (!list || !list[i]) return res.status(404).json({ error: 'Video non trovato' });
    const [v] = list.splice(i, 1);
    if (!list.length) delete videos[calId];

    const dest = primary_key || calId;
    if (!videos[dest]) videos[dest] = [];
    // rimuovi eventuale duplicato già presente nella dest
    videos[dest] = videos[dest].filter(x => x.url !== v.url);
    videos[dest].unshift(v);
    await writeVideos(videos);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Tag corridori su un video (admin imposta la lista completa)
app.post('/api/admin/videos/:calId/:idx/tags', requireAdmin, async (req, res) => {
  try {
    const { calId, idx } = req.params;
    const { atleta_ids } = req.body;
    const videos = await readVideos();
    const v = videos[calId] && videos[calId][parseInt(idx)];
    if (!v) return res.status(404).json({ error: 'Video non trovato' });
    v.atleta_ids = [...new Set(String(atleta_ids || '').split(',').map(s => s.trim()).filter(Boolean))].join(',');
    await writeVideos(videos);
    res.json({ ok: true, atleta_ids: v.atleta_ids });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Self-tag su un video: atleta verificato aggiunge/toglie sé stesso;
// admin può taggare un atleta_id qualsiasi (body.atleta_id).
app.post('/api/videos/:calId/:idx/self-tag', requireAuth, async (req, res) => {
  try {
    const { calId, idx } = req.params;
    const videos = await readVideos();
    const v = videos[calId] && videos[calId][parseInt(idx)];
    if (!v) return res.status(404).json({ error: 'Video non trovato' });
    let targetId = null;
    if (req.user.role === 'admin' && req.body.atleta_id) {
      targetId = String(req.body.atleta_id).trim();
    } else {
      const prof = await queries.getAthleteProfile(req.user.id);
      if (!prof || !['active','approved'].includes(prof.status) || !prof.atleta_id)
        return res.status(403).json({ error: 'Solo gli atleti verificati possono taggarsi' });
      targetId = String(prof.atleta_id).trim();
    }
    if (!targetId) return res.status(400).json({ error: 'atleta_id mancante' });
    const tagged = req.body.tagged !== false;
    const cur = new Set(String(v.atleta_ids || '').split(',').map(s => s.trim()).filter(Boolean));
    if (tagged) cur.add(targetId); else cur.delete(targetId);
    v.atleta_ids = [...cur].join(',');
    await writeVideos(videos);
    res.json({ ok: true, atleta_ids: v.atleta_ids });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Cambia annata di un video esordienti: target = 'ES1' | 'ES2' | 'both'
app.post('/api/admin/videos/:calId/:idx/set-year', requireAdmin, async (req, res) => {
  try {
    const { calId, idx } = req.params;
    const { target } = req.body;
    const videos = await readVideos();
    const list = videos[calId];
    const i = parseInt(idx);
    if (!list || !list[i]) return res.status(404).json({ error: 'Video non trovato' });
    const m = calId.match(/^(.+)_ES([12])_([MF])$/);
    if (!m) return res.status(400).json({ error: 'Non è una gara esordienti' });
    const es1 = `${m[1]}_ES1_${m[3]}`, es2 = `${m[1]}_ES2_${m[3]}`;
    const v = list[i];

    // Rimuovi il video dalla chiave corrente
    list.splice(i, 1);
    if (!list.length) delete videos[calId];

    const addTo = (key) => {
      if (!videos[key]) videos[key] = [];
      if (!videos[key].some(x => x.url === v.url)) videos[key].push(v);
    };
    if (target === 'both') { addTo(es1); addTo(es2); }
    else if (target === 'ES2') addTo(es2);
    else addTo(es1);

    await writeVideos(videos);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/videos/:calId/:idx', requireAdmin, async (req, res) => {
  try {
    const { calId, idx } = req.params;
    const { url, title, channel } = req.body;
    const videos = await readVideos();
    if (!videos[calId]?.[parseInt(idx)]) return res.status(404).json({ error: 'Video non trovato' });
    const v = videos[calId][parseInt(idx)];
    if (url) v.url = url;
    if (title !== undefined) v.title = title;
    if (channel !== undefined) v.channel = channel;
    await writeVideos(videos);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// PCS Photo Import (admin)
// ══════════════════════════════════════════════════════════════════════════════

const { importPcsPhotos } = require('./pcs-scraper');

// Stato import in memoria — un solo job alla volta
let _pcsImportJob = null; // { running, log[], stats }

app.post('/api/admin/pcs-import', requireAdmin, async (req, res) => {
  if (_pcsImportJob?.running) return res.status(409).json({ error: 'Import già in corso' });

  const cats = req.body.cats || ['ELI_M', 'ELI_F', 'JUN_M', 'JUN_F'];
  const skipExisting = req.body.skipExisting !== false;

  _pcsImportJob = { running: true, log: [], stats: null, startedAt: new Date().toISOString() };
  res.json({ ok: true, message: 'Import avviato in background' });

  importPcsPhotos(supabase, queries, {
    cats,
    skipExisting,
    onProgress: msg => {
      console.log(msg);
      if (_pcsImportJob) _pcsImportJob.log.push(msg);
    },
  })
    .then(stats => { if (_pcsImportJob) { _pcsImportJob.running = false; _pcsImportJob.stats = stats; } })
    .catch(e  => { if (_pcsImportJob) { _pcsImportJob.running = false; _pcsImportJob.log.push('ERRORE: ' + e.message); } });
});

app.get('/api/admin/pcs-import/status', requireAdmin, (req, res) => {
  if (!_pcsImportJob) return res.json({ running: false, log: [], stats: null });
  res.json(_pcsImportJob);
});

// ══════════════════════════════════════════════════════════════════════════════
// Import completo (Playwright) — foto + social per atleti e team
// ══════════════════════════════════════════════════════════════════════════════

let _fullImportJob = null; // { running, log[], startedAt, exitCode }

app.post('/api/admin/full-import', requireAdminOrLocal, (req, res) => {
  // Questo script apre un browser sul PC locale — non può girare su Render
  if (process.env.RENDER) return res.status(400).json({ error: 'Import disponibile solo in locale (non su Render). Usa Avvia.bat e accedi a localhost:8002.' });
  if (_fullImportJob?.running) return res.status(409).json({ error: 'Import già in corso' });

  const { spawn } = require('child_process');
  const mode = req.body.mode || 'all'; // 'all' | 'athletes' | 'teams'
  const force = !!req.body.force;

  // mode: 'all' | 'athletes' | 'teams' | 'fc' | 'fc-athletes' | 'fc-teams'
  const scriptArgs = [];
  if (mode === 'athletes' || mode === 'fc-athletes') scriptArgs.push('--athletes');
  if (mode === 'teams'    || mode === 'fc-teams')    scriptArgs.push('--teams');
  if (mode.startsWith('fc'))                         scriptArgs.push('--fc');
  if (force)                                         scriptArgs.push('--force');

  const scriptPath = path.join(__dirname, 'run-import.js');
  const secret = process.env.SUPABASE_SECRET;
  if (!secret) return res.status(500).json({ error: 'SUPABASE_SECRET non impostato sul server' });

  _fullImportJob = { running: true, log: [], startedAt: new Date().toISOString(), exitCode: null };
  res.json({ ok: true, message: 'Import avviato — apri Chrome e attendi' });

  const proc = spawn(process.execPath, [scriptPath, ...scriptArgs], {
    env: { ...process.env, SUPABASE_SECRET: secret },
    cwd: __dirname,
  });

  const onLine = line => {
    if (!_fullImportJob) return;
    console.log('[import]', line);
    _fullImportJob.log.push(line);
    if (_fullImportJob.log.length > 2000) _fullImportJob.log.shift();
  };

  let buf = '';
  proc.stdout.on('data', d => {
    buf += d.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    lines.forEach(onLine);
  });
  proc.stderr.on('data', d => {
    d.toString().split('\n').filter(Boolean).forEach(l => onLine('[ERR] ' + l));
  });
  proc.on('close', code => {
    if (buf) onLine(buf);
    if (_fullImportJob) { _fullImportJob.running = false; _fullImportJob.exitCode = code; }
    console.log('[import] terminato con codice', code);
  });
});

app.get('/api/admin/full-import/status', requireAdminOrLocal, (req, res) => {
  if (!_fullImportJob) return res.json({ running: false, log: [], startedAt: null });
  res.json(_fullImportJob);
});

app.delete('/api/admin/full-import', requireAdminOrLocal, (req, res) => {
  if (_fullImportJob) _fullImportJob = { ..._fullImportJob, running: false, log: [...(_fullImportJob.log||[]), '--- Reset manuale ---'] };
  res.json({ ok: true });
});

// Import media per un singolo atleta (usato dopo cambio team)
app.post('/api/admin/import-atleta', requireAdminOrLocal, (req, res) => {
  if (process.env.RENDER) return res.status(400).json({ error: 'Import disponibile solo in locale' });
  if (_fullImportJob?.running) return res.status(409).json({ error: 'Import già in corso' });

  const { atleta_id, nome, cognome } = req.body || {};
  if (!atleta_id || !nome || !cognome) return res.status(400).json({ error: 'atleta_id, nome, cognome obbligatori' });

  const { spawn } = require('child_process');
  const scriptPath = path.join(__dirname, 'run-import.js');
  const secret = process.env.SUPABASE_SECRET;
  if (!secret) return res.status(500).json({ error: 'SUPABASE_SECRET non impostato' });

  _fullImportJob = { running: true, log: [], startedAt: new Date().toISOString(), exitCode: null };
  res.json({ ok: true, message: `Import avviato per ${cognome} ${nome}` });

  const proc = spawn(process.execPath, [
    scriptPath,
    '--athletes', '--force',
    `--atleta-id=${atleta_id}`,
    `--nome=${nome}`,
    `--cognome=${cognome}`,
  ], { env: { ...process.env, SUPABASE_SECRET: secret }, cwd: __dirname });

  const onLine = line => {
    if (!_fullImportJob) return;
    console.log('[import-atleta]', line);
    _fullImportJob.log.push(line);
  };
  let buf = '';
  proc.stdout.on('data', d => {
    buf += d.toString();
    const lines = buf.split('\n'); buf = lines.pop(); lines.forEach(onLine);
  });
  proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => onLine('[ERR] ' + l)));
  proc.on('close', code => {
    if (buf) onLine(buf);
    if (_fullImportJob) { _fullImportJob.running = false; _fullImportJob.exitCode = code; }
    console.log('[import-atleta] terminato con codice', code);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PCS Risultati — lettura dati dalla tabella pcs_results
// ══════════════════════════════════════════════════════════════════════════════

// Risultati PCS per una gara del circuito (pos 11+, distacchi, ecc.)
app.get('/api/pcs-results/gara/:garaId', async (req, res) => {
  try {
    // Prima leggi dalla tabella race-page (completa), poi fallback su per-atleta
    const { data: raceData, error: raceErr } = await supabase
      .from('pcs_gara_results')
      .select('atleta_id, rider_name, team_name, posizione, distacco, pcs_race_slug')
      .eq('gara_id', req.params.garaId)
      .order('posizione', { ascending: true })
      .limit(300);
    if (!raceErr && raceData && raceData.length) {
      return res.json(raceData);
    }
    // Fallback: per-atleta (risultati parziali dallo scraper profilo)
    const { data, error } = await supabase
      .from('pcs_results')
      .select('atleta_id, gara_name, posizione, distacco, pcs_race_slug')
      .eq('gara_id', req.params.garaId)
      .order('posizione', { ascending: true })
      .limit(200);
    if (error) throw error;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Tutti i risultati PCS per un atleta (circuito + extra)
app.get('/api/pcs-results/atleta/:atletaId', async (req, res) => {
  const season = parseInt(req.query.season) || new Date().getFullYear();
  try {
    const { data, error } = await supabase
      .from('pcs_results')
      .select('gara_name, data, posizione, distacco, pcs_race_slug, gara_id')
      .eq('atleta_id', req.params.atletaId)
      .eq('season', season)
      .order('data', { ascending: false })
      .limit(500);
    if (error) throw error;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Risultati da pcs_gara_results per un atleta (pos 11+ nelle gare circuito)
app.get('/api/pcs-results/gare-atleta/:atletaId', async (req, res) => {
  const season = parseInt(req.query.season) || new Date().getFullYear();
  try {
    const { data, error } = await supabase
      .from('pcs_gara_results')
      .select('gara_id, posizione, distacco, pcs_race_slug, rider_name, team_name')
      .eq('atleta_id', req.params.atletaId)
      .like('gara_id', `%-${season}-%`)
      .order('gara_id', { ascending: false })
      .limit(200);
    if (error) throw error;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Risultati da pcs_gara_results per un team (pos 11+ nelle gare circuito)
app.get('/api/pcs-results/gare-team/:teamId', async (req, res) => {
  const season = parseInt(req.query.season) || new Date().getFullYear();
  try {
    // Cerca gli atleta_id del team dalla query string (passati dal frontend)
    const atletiIds = (req.query.atleti || '').split(',').filter(Boolean);
    if (!atletiIds.length) return res.json([]);
    const { data, error } = await supabase
      .from('pcs_gara_results')
      .select('gara_id, atleta_id, posizione, distacco, pcs_race_slug, rider_name, team_name')
      .in('atleta_id', atletiIds)
      .like('gara_id', `%-${season}-%`)
      .order('gara_id', { ascending: false })
      .limit(500);
    if (error) throw error;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Avvia lo scraper pcs-results.js in background
app.post('/api/admin/pcs-import', requireAdminOrLocal, (req, res) => {
  if (process.env.RENDER) return res.status(400).json({ error: 'Disponibile solo in locale' });
  if (_fullImportJob?.running) return res.status(409).json({ error: 'Import già in corso' });

  const { spawn } = require('child_process');
  const scriptPath = path.join(__dirname, 'pcs-results.js');
  const secret = process.env.SUPABASE_SECRET;
  if (!secret) return res.status(500).json({ error: 'SUPABASE_SECRET non impostato' });

  const extraArgs = [];
  if (req.body.force)      extraArgs.push('--force');
  if (req.body.atleta_id)  extraArgs.push(`--atleta-id=${req.body.atleta_id}`);
  if (req.body.season)     extraArgs.push(`--season=${req.body.season}`);

  _fullImportJob = { running: true, log: [], startedAt: new Date().toISOString(), exitCode: null };
  res.json({ ok: true, message: 'Scraping PCS risultati avviato' });

  const proc = spawn(process.execPath, [scriptPath, ...extraArgs], {
    env: { ...process.env, SUPABASE_SECRET: secret }, cwd: __dirname,
  });
  const onLine = line => { if (_fullImportJob) { console.log('[pcs-results]', line); _fullImportJob.log.push(line); } };
  let buf = '';
  proc.stdout.on('data', d => { buf += d; const lines = buf.split('\n'); buf = lines.pop(); lines.forEach(onLine); });
  proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => onLine('[ERR] ' + l)));
  proc.on('close', code => { if (buf) onLine(buf); if (_fullImportJob) { _fullImportJob.running = false; _fullImportJob.exitCode = code; } });
});

// Avvia pcs-race-scraper.js in background (risultati completi pagina gara)
app.post('/api/admin/pcs-race-import', requireAdminOrLocal, (req, res) => {
  if (process.env.RENDER) return res.status(400).json({ error: 'Disponibile solo in locale' });
  if (_fullImportJob?.running) return res.status(409).json({ error: 'Import già in corso' });

  const { spawn } = require('child_process');
  const scriptPath = path.join(__dirname, 'pcs-race-scraper.js');
  const secret = process.env.SUPABASE_SECRET;
  if (!secret) return res.status(500).json({ error: 'SUPABASE_SECRET non impostato' });

  const extraArgs = [];
  if (req.body.force)    extraArgs.push('--force');
  if (req.body.gara_id)  extraArgs.push(`--gara-id=${req.body.gara_id}`);
  if (req.body.season)   extraArgs.push(`--season=${req.body.season}`);

  _fullImportJob = { running: true, log: [], startedAt: new Date().toISOString(), exitCode: null };
  res.json({ ok: true, message: 'Scraping PCS gare avviato' });

  const proc = spawn(process.execPath, [scriptPath, ...extraArgs], {
    env: { ...process.env, SUPABASE_SECRET: secret }, cwd: __dirname,
  });
  const onLine = line => { if (_fullImportJob) { console.log('[pcs-race]', line); _fullImportJob.log.push(line); } };
  let buf = '';
  proc.stdout.on('data', d => { buf += d; const lines = buf.split('\n'); buf = lines.pop(); lines.forEach(onLine); });
  proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => onLine('[ERR] ' + l)));
  proc.on('close', code => { if (buf) onLine(buf); if (_fullImportJob) { _fullImportJob.running = false; _fullImportJob.exitCode = code; } });
});

// ══════════════════════════════════════════════════════════════════════════════
// YouTube Auto-Scraper
// ══════════════════════════════════════════════════════════════════════════════
const { DEFAULT_CHANNELS, fetchAllChannels } = require('./youtube-scraper');

const YT_CHANNELS_PATH = path.join(__dirname, '../data/youtube_channels.json');
const YT_QUEUE_PATH    = path.join(__dirname, '../data/youtube_queue.json');

async function readYTChannels() {
  if (supabase) {
    const { data, error } = await supabase.from('kv_store').select('value').eq('key', 'yt_channels').single();
    if (error && error.code !== 'PGRST116') console.error('[yt_channels] read error:', error.message);
    return data?.value || DEFAULT_CHANNELS;
  }
  try { return JSON.parse(fs.readFileSync(YT_CHANNELS_PATH, 'utf8')); } catch { return DEFAULT_CHANNELS; }
}

async function writeYTChannels(arr) {
  if (supabase) {
    const { error } = await supabase.from('kv_store')
      .upsert({ key: 'yt_channels', value: arr, updated_at: new Date().toISOString() });
    if (error) throw new Error('Supabase write: ' + error.message);
    return;
  }
  fs.writeFileSync(YT_CHANNELS_PATH, JSON.stringify(arr, null, 2));
}

async function readYTQueue() {
  if (supabase) {
    const { data, error } = await supabase.from('kv_store').select('value').eq('key', 'yt_queue').single();
    if (error && error.code !== 'PGRST116') console.error('[yt_queue] read error:', error.message);
    return data?.value || [];
  }
  try { return JSON.parse(fs.readFileSync(YT_QUEUE_PATH, 'utf8')); } catch { return []; }
}

async function writeYTQueue(arr) {
  if (supabase) {
    const { error } = await supabase.from('kv_store')
      .upsert({ key: 'yt_queue', value: arr, updated_at: new Date().toISOString() });
    if (error) throw new Error('Supabase write: ' + error.message);
    return;
  }
  fs.writeFileSync(YT_QUEUE_PATH, JSON.stringify(arr, null, 2));
}

// GET canali configurati
app.get('/api/admin/youtube/channels', requireAdmin, async (req, res) => {
  try { res.json({ channels: await readYTChannels() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT canali (salva configurazione completa)
app.put('/api/admin/youtube/channels', requireAdmin, async (req, res) => {
  try {
    const { channels } = req.body;
    if (!Array.isArray(channels)) return res.status(400).json({ error: 'channels deve essere un array' });
    await writeYTChannels(channels);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST sync: fetch RSS di tutti i canali abilitati, aggiunge nuovi video alla queue
async function doYoutubeSync() {
  const channels   = await readYTChannels();
  const allVideos  = await readVideos();
  const queue      = await readYTQueue();

  // URL già noti (approvati in videos o già in coda)
  const knownUrls = new Set([
    ...queue.map(q => q.url),
    ...Object.values(allVideos).flat().map(v => v.url),
  ]);

  const fetched = await fetchAllChannels(channels);
  let added = 0;

  // Tieni solo video dal 2026 in poi: anno nel titolo, oppure data di pubblicazione 2026+
  const _isVideoRecent = (v) => {
    const yearsInTitle = (v.title || '').match(/\b(20\d{2})\b/g);
    if (yearsInTitle) return Math.max(...yearsInTitle.map(Number)) >= 2026;
    const pubYear = parseInt((v.published_at || '').slice(0, 4), 10);
    return !pubYear || pubYear >= 2026; // se non c'è anno, includi
  };

  for (const [chId, videos] of Object.entries(fetched)) {
    const ch = channels.find(c => c.id === chId);
    for (const v of videos) {
      if (knownUrls.has(v.url)) continue;
      if (!_isVideoRecent(v)) continue;
      knownUrls.add(v.url);
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      queue.push({
        id,
        channel_id:   chId,
        channel_name: ch?.name || chId,
        url:          v.url,
        title:        v.title,
        published_at: v.published_at,
        thumbnail:    v.thumbnail,
        status:       'pending',
        suggested_gara_id: null,
        added_at:     new Date().toISOString(),
      });
      added++;
    }
  }

  const nonPending = queue.filter(q => q.status !== 'pending');
  const pending    = queue
    .filter(q => q.status === 'pending')
    .sort((a, b) => (b.added_at || '').localeCompare(a.added_at || ''))
    .slice(0, 200);
  const trimmed = [...nonPending, ...pending];
  await writeYTQueue(trimmed);
  return { added, total: trimmed.length };
}

app.post('/api/admin/youtube/sync', requireAdmin, async (req, res) => {
  try {
    const r = await doYoutubeSync();
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error('[yt-sync] errore:', e.message);
    res.status(500).json({ error: e.message });
  }
});

async function autoYoutubeSync() {
  try {
    const r = await doYoutubeSync();
    if (r.added) {
      console.log(`[yt-auto] ${r.added} nuovi video aggiunti alla coda`);
      await sendPushToAll({
        title: '🎥 Nuovi video disponibili',
        body: `${r.added} nuovi video di gare sono stati trovati`,
        url: '/#/risultati',
      });
    }
  } catch (e) { console.warn('[yt-auto] Errore:', e.message); }
}

// GET queue
app.get('/api/admin/youtube/queue', requireAdmin, async (req, res) => {
  try { res.json({ queue: await readYTQueue() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST approva: assegna video a una gara e lo pubblica
app.post('/api/admin/youtube/queue/:id/approve', requireAdmin, async (req, res) => {
  try {
    const { gara_id, gara_ids, title, channel } = req.body;
    // Supporta sia gara_id singolo che gara_ids array (per pubblicare su ES1+ES2 insieme)
    const targets = Array.isArray(gara_ids) && gara_ids.length ? gara_ids : (gara_id ? [gara_id] : []);
    if (!targets.length) return res.status(400).json({ error: 'gara_id obbligatorio' });

    const queue = await readYTQueue();
    const i = queue.findIndex(q => q.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Non trovato' });

    const item   = queue[i];
    const videos = await readVideos();
    for (const gid of targets) {
      if (!videos[gid]) videos[gid] = [];
      if (!videos[gid].some(v => v.url === item.url)) {
        videos[gid].push({
          url:          item.url,
          title:        title   || item.title,
          description:  '',
          channel:      channel || item.channel_name || '',
          published_at: item.published_at || new Date().toISOString().slice(0, 10),
        });
      }
    }
    await writeVideos(videos);

    queue[i].status            = 'approved';
    queue[i].approved_gara_id  = targets[0];
    queue[i].approved_gara_ids = targets;
    await writeYTQueue(queue);

    res.json({ ok: true, targets });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE scarta (dismiss)
app.delete('/api/admin/youtube/queue/:id', requireAdmin, async (req, res) => {
  try {
    const queue = await readYTQueue();
    const i = queue.findIndex(q => q.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Non trovato' });
    queue[i].status = 'dismissed';
    await writeYTQueue(queue);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// XPIX AUTO-FOTO
// ══════════════════════════════════════════════════════════════════════════════
const { fetchXpixCandidates, fetchPhotosForAlbum, fetchAllAlbums, fetchAlbumBySlug, isCyclingRelevant, isRecent } = require('./xpix-scraper');

const XPIX_QUEUE_PATH  = path.join(__dirname, '../data/xpix_queue.json');
const XPIX_PHOTOS_PATH = path.join(__dirname, '../data/xpix_photos.json');

async function readXpixQueue() {
  if (supabase) {
    const { data, error } = await supabase.from('kv_store').select('value').eq('key', 'xpix_queue').single();
    if (error && error.code !== 'PGRST116') console.error('[xpix_queue] read:', error.message);
    return data?.value || [];
  }
  try { return JSON.parse(fs.readFileSync(XPIX_QUEUE_PATH, 'utf8')); } catch { return []; }
}
async function writeXpixQueue(arr) {
  if (supabase) {
    const { error } = await supabase.from('kv_store')
      .upsert({ key: 'xpix_queue', value: arr, updated_at: new Date().toISOString() });
    if (error) throw new Error('Supabase write xpix_queue: ' + error.message);
    return;
  }
  fs.writeFileSync(XPIX_QUEUE_PATH, JSON.stringify(arr, null, 2));
}

async function readXpixPhotos() {
  if (supabase) {
    const { data, error } = await supabase.from('kv_store').select('value').eq('key', 'xpix_photos').single();
    if (error && error.code !== 'PGRST116') console.error('[xpix_photos] read:', error.message);
    return data?.value || {};
  }
  try { return JSON.parse(fs.readFileSync(XPIX_PHOTOS_PATH, 'utf8')); } catch { return {}; }
}
async function writeXpixPhotos(obj) {
  if (supabase) {
    const { error } = await supabase.from('kv_store')
      .upsert({ key: 'xpix_photos', value: obj, updated_at: new Date().toISOString() });
    if (error) throw new Error('Supabase write xpix_photos: ' + error.message);
    return;
  }
  fs.writeFileSync(XPIX_PHOTOS_PATH, JSON.stringify(obj, null, 2));
}

// GET coda xpix (admin)
app.get('/api/admin/xpix/queue', requireAdmin, async (req, res) => {
  try { res.json({ queue: await readXpixQueue() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST sync: scarica nuovi album da xpix, aggiunge alla coda
app.post('/api/admin/xpix/sync', requireAdmin, async (req, res) => {
  try {
    const queue      = await readXpixQueue();
    // Escludi tutto ciò che l'admin ha già visto (pending, approved, dismissed)
    const knownSlugs = new Set(queue.map(q => q.album_slug));

    const candidates = await fetchXpixCandidates(knownSlugs, 20);
    let added = 0;

    for (const c of candidates) {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      queue.push({
        id,
        album_id:    c.album_id,
        album_name:  c.album_name,
        album_slug:  c.album_slug,
        photo_count: c.photo_count,
        photos:      c.photos || [],       // array URL watermarked
        photo_url:   c.photo_url,          // selezionata (default: prima)
        album_page:  c.album_page,
        status:            'pending',
        suggested_gara_id: null,
        added_at:          new Date().toISOString(),
      });
      added++;
    }

    // Mantieni tutti gli approvati/scartati + max 200 pending più recenti
    const nonPending = queue.filter(q => q.status !== 'pending');
    const pending    = queue.filter(q => q.status === 'pending')
      .sort((a, b) => (b.added_at || '').localeCompare(a.added_at || ''))
      .slice(0, 200);
    const trimmed = [...nonPending, ...pending];
    await writeXpixQueue(trimmed);

    res.json({ ok: true, added, total: trimmed.length });
  } catch (e) {
    console.error('[xpix-sync]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST add-by-url: aggiunge manualmente un album dalla URL/slug xpix, bypassa tutti i filtri
app.post('/api/admin/xpix/add-by-url', requireAdmin, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url obbligatorio' });

    const album = await fetchAlbumBySlug(url);
    if (!album) return res.status(404).json({ error: 'Album non trovato su xpix.it (slug non trovato nel taxonomy)' });

    const photos = await fetchPhotosForAlbum(album);
    if (!photos.length) return res.status(404).json({ error: `Album trovato (${album.name}) ma nessuna foto disponibile` });

    const queue = await readXpixQueue();
    // Se già presente rimuovi il vecchio (lo sostituiamo con versione fresca)
    const existing = queue.findIndex(q => q.album_slug === album.slug);
    if (existing !== -1) queue.splice(existing, 1);

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    queue.push({
      id,
      album_id:    album.id,
      album_name:  album.name,
      album_slug:  album.slug,
      photo_count: album.count,
      photos,
      photo_url:   photos[0],
      album_page:  `https://www.xpix.it/negozio/?yith_wcan=1&filter=open&pixy_album=${encodeURIComponent(album.slug)}`,
      status:      'pending',
      suggested_gara_id: null,
      added_at:    new Date().toISOString(),
      added_manually: true,
    });

    const nonPending = queue.filter(q => q.status !== 'pending');
    const pending    = queue.filter(q => q.status === 'pending')
      .sort((a, b) => (b.added_at || '').localeCompare(a.added_at || ''))
      .slice(0, 200);
    await writeXpixQueue([...nonPending, ...pending]);

    res.json({ ok: true, album_name: album.name, slug: album.slug, photos_count: photos.length });
  } catch (e) {
    console.error('[xpix-add-by-url]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST cleanup-queue: rimuove dalla coda tutti gli album non 2026+
app.post('/api/admin/xpix/cleanup-queue', requireAdmin, async (req, res) => {
  try {
    const queue = await readXpixQueue();
    const before = queue.length;
    const kept = queue.filter(q => {
      const name = q.album_name || q.album_slug || '';
      const years = name.match(/\b(20\d{2})\b/g);
      if (!years) return true; // nessun anno → tieni
      return Math.max(...years.map(Number)) >= 2026;
    });
    await writeXpixQueue(kept);
    res.json({ ok: true, removed: before - kept.length, kept: kept.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET diagnosi: mostra tutti gli album xpix con motivo eventuale filtro
app.get('/api/admin/xpix/diagnose', requireAdmin, async (req, res) => {
  try {
    const queue = await readXpixQueue();
    const knownPending  = new Set(queue.filter(q => q.status === 'pending').map(q => q.album_slug));
    const knownApproved = new Set(queue.filter(q => q.status === 'approved').map(q => q.album_slug));
    const knownDismissed= new Set(queue.filter(q => q.status === 'dismissed').map(q => q.album_slug));

    const allAlbums = await fetchAllAlbums();
    const report = allAlbums.slice(0, 200).map(a => {
      let skip = null;
      if (knownPending.has(a.slug))   skip = 'in_coda_pending';
      else if (knownApproved.has(a.slug))  skip = 'approved';
      else if (knownDismissed.has(a.slug)) skip = 'dismissed_riproposto';
      else if (!isRecent(a.name))     skip = 'filtro_vecchio';
      else if (!isCyclingRelevant(a.name)) skip = 'filtro_irrilevante';
      return { id: a.id, name: a.name, slug: a.slug, count: a.count, skip };
    });

    const byReason = {};
    report.forEach(r => {
      const k = r.skip || 'nuovo_da_processare';
      if (!byReason[k]) byReason[k] = 0;
      byReason[k]++;
    });

    res.json({ total: allAlbums.length, shown: report.length, summary: byReason, albums: report });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST approva: salva la foto xpix come foto della gara
app.post('/api/admin/xpix/queue/:id/approve', requireAdmin, async (req, res) => {
  try {
    const { gara_id, selected_photo_url, atleta_ids } = req.body;
    if (!gara_id) return res.status(400).json({ error: 'gara_id obbligatorio' });
    // Tag corridori (CSV) da applicare ALLA foto selezionata, così appare sul
    // profilo dell'atleta indicato (oltre che nella gallery della gara).
    const tagCsv = String(atleta_ids || '').split(',').map(s => s.trim()).filter(Boolean).join(',');

    const queue = await readXpixQueue();
    const i = queue.findIndex(q => q.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Non trovato' });

    const item   = queue[i];
    const photos = await readXpixPhotos();

    // Ricarica SEMPRE tutte le foto fresche dal sito (l'item in coda potrebbe
    // averne solo alcune o nessuna se aggiunto col sync veloce).
    let albumPhotos = item.photos || [];
    try {
      const fresh = await fetchPhotosForAlbum({ id: item.album_id, slug: item.album_slug });
      if (fresh.length) albumPhotos = fresh;
    } catch (e) { console.warn('[xpix-approve] refresh photos:', e.message); }

    // Salva foto selezionata (hero) + intero array per la gallery
    const chosenUrl = selected_photo_url || item.photo_url || albumPhotos[0];
    // Preserva i tag già assegnati (più approvazioni della stessa gara con foto
    // diverse → ogni foto può avere il suo corridore) e aggiungi quello nuovo.
    const prevTags = (photos[gara_id] && photos[gara_id].tags) || {};
    if (tagCsv) prevTags[chosenUrl] = tagCsv;
    photos[gara_id] = {
      url:        chosenUrl,
      photos:     albumPhotos.length ? albumPhotos : [chosenUrl],
      album_name: item.album_name,
      album_slug: item.album_slug,
      album_page: item.album_page,
      source:     'xpix',
      gara_id,
      tags:       prevTags,
      approved_at: new Date().toISOString(),
    };
    await writeXpixPhotos(photos);
    // Aggiorna anche l'item in coda con le foto fresche
    queue[i].photos = albumPhotos;

    // Accumula le gare approvate (stesso album può coprire M e F)
    if (!queue[i].approved_gara_ids) queue[i].approved_gara_ids = [];
    if (!queue[i].approved_gara_ids.includes(gara_id)) queue[i].approved_gara_ids.push(gara_id);
    queue[i].approved_gara_id = gara_id;
    queue[i].status            = 'approved';
    await writeXpixQueue(queue);

    // ── Crea automaticamente il media_album (Gallery fotografi) ──────────────
    // Così non serve eseguire il Seed xpix manualmente dopo ogni approvazione.
    try {
      // 1. Trova o crea profilo xpix.it di sistema
      let xpixProfile = await rawQuery(
        `SELECT * FROM media_profiles WHERE user_id IS NULL AND display_name = 'xpix.it' LIMIT 1`
      ).then(r => r.rows[0]);
      if (!xpixProfile) {
        const r = await rawQuery(
          `INSERT INTO media_profiles (user_id, display_name, bio, website, instagram, status)
           VALUES (NULL, 'xpix.it', 'Fotografia ciclismo agonistico italiano', 'https://www.xpix.it', 'xpix.it', 'active')
           RETURNING *`
        );
        xpixProfile = r.rows[0];
      }
      const photoUrls = albumPhotos.length ? albumPhotos : [chosenUrl];
      // 2. Trova album esistente o creane uno nuovo
      let albumId = await rawQuery(
        `SELECT id FROM media_albums WHERE media_profile_id=$1 AND gara_id=$2 LIMIT 1`,
        [xpixProfile.id, gara_id]
      ).then(r => r.rows[0]?.id);
      if (!albumId) {
        const album = await queries.createMediaAlbum({
          media_profile_id: xpixProfile.id,
          gara_id,
          title: item.album_name || item.album_slug,
          description: '',
        });
        albumId = album.id;
      }
      // 3. Conta le foto già presenti; se mancano, sincronizza (svuota e ricarica tutte)
      const existingCount = await rawQuery(
        `SELECT COUNT(*)::int AS n FROM media_photos WHERE album_id=$1`, [albumId]
      ).then(r => r.rows[0]?.n || 0);
      if (existingCount < photoUrls.length) {
        await rawQuery(`DELETE FROM media_photos WHERE album_id=$1`, [albumId]);
        let ord = 0;
        for (const url of photoUrls) {
          await queries.addMediaPhoto({ album_id: albumId, filename: null, ext_url: url, caption: '', ord: ord++ });
        }
      }
    } catch (e2) {
      // Non blocca la risposta se la gallery fallisce
      console.warn('[xpix-approve] media_album creation failed:', e2.message);
    }

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST refresh-photos: ricarica le foto di un album già in coda
app.post('/api/admin/xpix/queue/:id/refresh-photos', requireAdmin, async (req, res) => {
  try {
    const queue = await readXpixQueue();
    const i = queue.findIndex(q => q.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Non trovato' });

    const item   = queue[i];
    const photos = await fetchPhotosForAlbum(
      { id: item.album_id, slug: item.album_slug }
      // usa default maxPhotos=50 per prendere tutto l'album
    );

    queue[i].photos    = photos;
    queue[i].photo_url = photos[0] || item.photo_url;
    await writeXpixQueue(queue);

    res.json({ ok: true, photos_count: photos.length, photos });
  } catch (e) {
    console.error('[xpix-refresh]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE scarta
app.delete('/api/admin/xpix/queue/:id', requireAdmin, async (req, res) => {
  try {
    const queue = await readXpixQueue();
    const i = queue.findIndex(q => q.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Non trovato' });
    queue[i].status = 'dismissed';
    await writeXpixQueue(queue);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH ripristina album scartato → pending (per ri-approvarlo)
app.patch('/api/admin/xpix/queue/:id/restore', requireAdmin, async (req, res) => {
  try {
    const queue = await readXpixQueue();
    const i = queue.findIndex(q => q.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Non trovato' });
    queue[i].status = 'pending';
    delete queue[i].approved_gara_id;
    delete queue[i].approved_gara_ids;
    await writeXpixQueue(queue);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE rimuovi foto xpix approvata da una gara
app.delete('/api/admin/xpix/photos/:gara_id', requireAdmin, async (req, res) => {
  try {
    const photos = await readXpixPhotos();
    delete photos[req.params.gara_id];
    await writeXpixPhotos(photos);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ITALIACICLISMO.NET AUTO-FOTO
// ══════════════════════════════════════════════════════════════════════════════
const { fetchItaliaciclismoCandidates, fetchPhotosForGara: fetchICPhotosForGara } = require('./italiaciclismo-scraper');

const IC_QUEUE_PATH  = path.join(__dirname, '../data/ic_queue.json');
const IC_PHOTOS_PATH = path.join(__dirname, '../data/ic_photos.json');

async function readICQueue() {
  if (supabase) {
    const { data, error } = await supabase.from('kv_store').select('value').eq('key', 'ic_queue').single();
    if (error && error.code !== 'PGRST116') console.error('[ic_queue] read:', error.message);
    return data?.value || [];
  }
  try { return JSON.parse(fs.readFileSync(IC_QUEUE_PATH, 'utf8')); } catch { return []; }
}
async function writeICQueue(arr) {
  if (supabase) {
    const { error } = await supabase.from('kv_store')
      .upsert({ key: 'ic_queue', value: arr, updated_at: new Date().toISOString() });
    if (error) throw new Error('Supabase write ic_queue: ' + error.message);
    return;
  }
  fs.writeFileSync(IC_QUEUE_PATH, JSON.stringify(arr, null, 2));
}
async function readICPhotos() {
  if (supabase) {
    const { data, error } = await supabase.from('kv_store').select('value').eq('key', 'ic_photos').single();
    if (error && error.code !== 'PGRST116') console.error('[ic_photos] read:', error.message);
    return data?.value || {};
  }
  try { return JSON.parse(fs.readFileSync(IC_PHOTOS_PATH, 'utf8')); } catch { return {}; }
}
async function writeICPhotos(obj) {
  if (supabase) {
    const { error } = await supabase.from('kv_store')
      .upsert({ key: 'ic_photos', value: obj, updated_at: new Date().toISOString() });
    if (error) throw new Error('Supabase write ic_photos: ' + error.message);
    return;
  }
  fs.writeFileSync(IC_PHOTOS_PATH, JSON.stringify(obj, null, 2));
}

// ── Social Post Queue ─────────────────────────────────────────────────────────
const SOCIAL_QUEUE_KEY  = 'social_queue';
const SOCIAL_QUEUE_PATH = path.join(__dirname, '../data/social-queue.json');

async function readSocialQueue() {
  if (supabase) {
    const { data } = await supabase.from('kv_store').select('value').eq('key', SOCIAL_QUEUE_KEY).single();
    return data?.value || [];
  }
  try { return JSON.parse(fs.readFileSync(SOCIAL_QUEUE_PATH, 'utf8')); } catch { return []; }
}
async function writeSocialQueue(arr) {
  if (supabase) {
    await supabase.from('kv_store').upsert({ key: SOCIAL_QUEUE_KEY, value: arr, updated_at: new Date().toISOString() });
    return;
  }
  fs.writeFileSync(SOCIAL_QUEUE_PATH, JSON.stringify(arr, null, 2));
}

async function generateSocialCaption({ nome_gara, winner_label, category, winner_team, date, link }) {
  const ai = getAnthropic();
  if (!ai) return `🏁 ${nome_gara}\n🥇 ${winner_label}${category ? ' — ' + category : ''}\n🔗 ${link}`;
  try {
    const msg = await ai.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Scrivi una caption per Facebook in italiano per questo risultato di ciclismo su strada. Massimo 220 caratteri totali incluso link. Includi emoji sportive, tono entusiasta. Termina con il link. Non inventare dettagli non forniti.

Gara: ${nome_gara}
Vincitore/Vincitrice: ${winner_label}
Categoria: ${category || '—'}
Team: ${winner_team || '—'}
Data: ${date || '—'}
Link: ${link}`
      }]
    });
    return msg.content[0].text.trim();
  } catch (e) {
    console.warn('[social] Claude caption error:', e.message);
    return `🏁 ${nome_gara}\n🥇 ${winner_label}${category ? ' (' + category + ')' : ''}\n🔗 ${link}`;
  }
}

async function postToFacebook(caption, photoUrl) {
  const pageId = process.env.FB_PAGE_ID;
  const token  = process.env.FB_PAGE_TOKEN;
  if (!pageId || !token) throw new Error('FB_PAGE_ID o FB_PAGE_TOKEN non configurati su Render');
  const endpoint = photoUrl
    ? `https://graph.facebook.com/v19.0/${pageId}/photos`
    : `https://graph.facebook.com/v19.0/${pageId}/feed`;
  const body = photoUrl
    ? { url: photoUrl, caption, access_token: token }
    : { message: caption, access_token: token };
  const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json();
  if (data.error) throw new Error(`Facebook API: ${data.error.message} (code ${data.error.code})`);
  return data;
}

// Genera e accoda un post per ogni gara con risultato di oggi/ieri ancora non in coda.
async function queueSocialPostsForToday() {
  try {
    const results = readDataJson('results_raw.json') || [];
    const today     = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const winners = {};
    for (const r of results) {
      const d = (r.data_gara || r.date || '').slice(0, 10);
      if (d !== today && d !== yesterday) continue;
      if (Number(r.posizione) !== 1 || !r.gara_id) continue;
      if (!winners[r.gara_id]) winners[r.gara_id] = r;
    }
    const garaIds = Object.keys(winners);
    if (!garaIds.length) return;
    const queue = await readSocialQueue();
    const existing = new Set(queue.map(p => p.gara_id));
    const xpix = await readXpixPhotos();
    const ic   = await readICPhotos();
    for (const garaId of garaIds) {
      if (existing.has(garaId)) continue;
      const r = winners[garaId];
      const nome_gara    = r.nome_gara || garaId;
      const winner_label = `${r.cognome || ''} ${r.nome || ''}`.trim();
      const category     = r.categoria || r.category || '';
      const winner_team  = r.team || '';
      const date         = (r.data_gara || r.date || '').slice(0, 10);
      const link         = `https://italiacyclingstats.com/#/gara/${encodeURIComponent(garaId)}`;
      const photoUrl     = xpix[garaId]?.url || ic[garaId]?.url || null;
      const caption = await generateSocialCaption({ nome_gara, winner_label, category, winner_team, date, link });
      queue.push({ id: `${garaId}_${Date.now()}`, created_at: new Date().toISOString(), gara_id: garaId, gara_name: nome_gara, winner: winner_label, category, winner_team, date, caption, photo_url: photoUrl, link, status: 'pending', fb_post_id: null });
    }
    await writeSocialQueue(queue);
    console.log(`[social] ${garaIds.length} gare controllate, ${garaIds.filter(g => !existing.has(g)).length} nuovi post in coda`);
  } catch (e) { console.warn('[social] queueSocialPostsForToday error:', e.message); }
}

app.get('/api/admin/ic/queue', requireAdmin, async (req, res) => {
  try { res.json({ queue: await readICQueue() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Gestione foto esterne GIÀ pubblicate (xpix + ciclismo.info) ────────────────
// Sposta/estende/rimuove una foto da una gara all'altra, anche cross ES1/ES2.
const _photoStore = {
  xpix: { read: () => readXpixPhotos(), write: (o) => writeXpixPhotos(o) },
  ic:   { read: () => readICPhotos(),   write: (o) => writeICPhotos(o) },
};
function _resolveStore(source) { return _photoStore[source] || _photoStore.xpix; }

// COPIA/ESTENDE: copia l'entry foto da from_gara_id verso uno o più to_gara_ids
// PROMUOVE una foto a principale: porta l'URL in cima all'array photos[] e su .url
app.post('/api/admin/photos/promote', requireAdmin, async (req, res) => {
  try {
    const { source, gara_id, photo_url } = req.body;
    if (!gara_id || !photo_url) return res.status(400).json({ error: 'gara_id e photo_url obbligatori' });
    const store = _resolveStore(source);
    const photos = await store.read();
    const entry = photos[gara_id];
    if (!entry) return res.status(404).json({ error: `Nessuna foto per ${gara_id}` });
    const arr = Array.isArray(entry.photos) ? [...entry.photos] : (entry.url ? [entry.url] : []);
    const i = arr.indexOf(photo_url);
    if (i > 0) { arr.splice(i, 1); arr.unshift(photo_url); }
    else if (i === -1) { arr.unshift(photo_url); }
    entry.photos = arr;
    entry.url = photo_url; // la principale è quella mostrata come hero
    await store.write(photos);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/photos/extend', requireAdmin, async (req, res) => {
  try {
    const { source, from_gara_id, to_gara_ids } = req.body;
    const store = _resolveStore(source);
    const photos = await store.read();
    const src = photos[from_gara_id];
    if (!src) return res.status(404).json({ error: `Nessuna foto per ${from_gara_id}` });
    const targets = Array.isArray(to_gara_ids) ? to_gara_ids : [to_gara_ids];
    let n = 0;
    for (const gid of targets) {
      if (!gid || gid === from_gara_id) continue;
      photos[gid] = { ...src, gara_id: gid };
      n++;
    }
    await store.write(photos);
    res.json({ ok: true, copied: n });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// SPOSTA: copia su to_gara_id e rimuove from_gara_id.
// Cerca la sorgente con fallback ES1↔ES2 e, se non specificata, in entrambe le sorgenti.
app.post('/api/admin/photos/move', requireAdmin, async (req, res) => {
  try {
    let { source, from_gara_id, to_gara_id } = req.body;
    if (!to_gara_id) return res.status(400).json({ error: 'to_gara_id obbligatorio' });

    // Candidati chiave origine (compresa la versione ES alternata)
    const altEs = from_gara_id.replace(/_ES([12])_([MF])$/, (_,n,g)=>`_ES${n==='1'?'2':'1'}_${g}`);
    const keyCands = [from_gara_id, altEs];
    // Sorgenti da provare: quella indicata, poi l'altra come fallback
    const srcOrder = source === 'ic' ? ['ic','xpix'] : ['xpix','ic'];

    let foundStore = null, foundKey = null, foundPhotos = null;
    for (const s of srcOrder) {
      const store = _resolveStore(s);
      const photos = await store.read();
      const k = keyCands.find(kk => photos[kk]);
      if (k) { foundStore = store; foundKey = k; foundPhotos = photos; source = s; break; }
    }
    if (!foundStore) return res.status(404).json({ error: `Foto non trovata (cercata in xpix e ic per ${from_gara_id})` });

    foundPhotos[to_gara_id] = { ...foundPhotos[foundKey], gara_id: to_gara_id };
    if (to_gara_id !== foundKey) delete foundPhotos[foundKey];
    await foundStore.write(foundPhotos);
    res.json({ ok: true, source, moved_from: foundKey, to: to_gara_id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DIAGNOSI: cerca una foto per frammento di gara_id in tutte le sorgenti
app.get('/api/admin/photos/find', requireAdmin, async (req, res) => {
  try {
    const q = (req.query.q || '').toUpperCase();
    const out = {};
    for (const s of ['xpix','ic']) {
      const photos = await _resolveStore(s).read();
      out[s] = Object.keys(photos).filter(k => k.toUpperCase().includes(q));
    }
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// RIMUOVE una foto esterna da una gara
app.delete('/api/admin/photos/:source/:gara_id', requireAdmin, async (req, res) => {
  try {
    const store = _resolveStore(req.params.source);
    const photos = await store.read();
    delete photos[req.params.gara_id];
    await store.write(photos);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function doICSync(maxNew = 60) {
  const queue     = await readICQueue();
  // knownUrls = già in coda (pending/approved/dismissed) OPPURE già controllate senza foto
  const knownUrls = new Set(queue.map(q => q.gara_url));
  const { results, checkedNoPhoto } = await fetchItaliaciclismoCandidates(knownUrls, maxNew);
  let added = 0;
  for (const c of results) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    queue.push({
      id,
      gara_url:  c.gara_url,
      categoria: c.categoria,
      date:      c.date,
      name:      c.name,
      photos:    c.photos,
      photo_url: c.photo_url,
      status:            'pending',
      suggested_gara_id: null,
      added_at:          new Date().toISOString(),
    });
    added++;
  }
  // Marca le gare senza foto così non vengono riprovate ogni volta (slot liberi per le altre)
  for (const url of (checkedNoPhoto || [])) {
    queue.push({ id: 'np_' + Math.random().toString(36).slice(2, 9), gara_url: url, status: 'no_photo' });
  }
  // Conserva non-pending (approved/dismissed/no_photo) + max 200 pending recenti
  const nonPending = queue.filter(q => q.status !== 'pending');
  const pending    = queue.filter(q => q.status === 'pending')
    .sort((a, b) => (b.added_at || '').localeCompare(a.added_at || ''))
    .slice(0, 200);
  const trimmed = [...nonPending, ...pending];
  await writeICQueue(trimmed);
  return { added, total: pending.length };
}

app.post('/api/admin/ic/sync', requireAdmin, async (req, res) => {
  try {
    const r = await doICSync(60);
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error('[ic-sync]', e.message);
    res.status(500).json({ error: e.message });
  }
});

async function autoICSync() {
  try {
    const r = await doICSync(60);
    if (r.added) {
      console.log(`[ic-auto] ${r.added} nuove foto gara aggiunte alla coda`);
      await sendPushToAll({
        title: '📷 Nuove foto disponibili',
        body: `${r.added} nuove foto di gare da ciclismo.info`,
        url: '/#/risultati',
      });
    }
  } catch (e) { console.warn('[ic-auto] Errore:', e.message); }
}

app.post('/api/admin/ic/queue/:id/approve', requireAdmin, async (req, res) => {
  try {
    const { gara_id, selected_photo_url, atleta_ids } = req.body;
    if (!gara_id) return res.status(400).json({ error: 'gara_id obbligatorio' });
    const tagCsv = String(atleta_ids || '').split(',').map(s => s.trim()).filter(Boolean).join(',');
    const queue = await readICQueue();
    const i = queue.findIndex(q => q.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Non trovato' });
    const item   = queue[i];
    const photos = await readICPhotos();
    const chosenUrl = selected_photo_url || item.photo_url;
    const prevTags = (photos[gara_id] && photos[gara_id].tags) || {};
    if (tagCsv) prevTags[chosenUrl] = tagCsv;
    photos[gara_id] = {
      url:        chosenUrl,
      gara_url:   item.gara_url,
      name:       item.name,
      gara_id,
      source:     'italiaciclismo',
      tags:       prevTags,
      approved_at: new Date().toISOString(),
    };
    await writeICPhotos(photos);
    queue[i].status = 'approved';
    queue[i].approved_gara_id = gara_id;
    await writeICQueue(queue);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ricarica tutte le foto di una gara già in coda (recupera scatti aggiuntivi)
app.post('/api/admin/ic/queue/:id/refresh-photos', requireAdmin, async (req, res) => {
  try {
    const queue = await readICQueue();
    const i = queue.findIndex(q => q.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Non trovato' });
    const photos = await fetchICPhotosForGara(queue[i].gara_url);
    queue[i].photos    = photos;
    queue[i].photo_url = photos[0] || queue[i].photo_url;
    await writeICQueue(queue);
    res.json({ ok: true, photos_count: photos.length, photos });
  } catch (e) {
    console.error('[ic-refresh]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/ic/queue/:id', requireAdmin, async (req, res) => {
  try {
    const queue = await readICQueue();
    const i = queue.findIndex(q => q.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Non trovato' });
    queue[i].status = 'dismissed';
    await writeICQueue(queue);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ic-photos', async (req, res) => {
  try {
    const photos = await readICPhotos();
    res.json({ photos: Object.values(photos) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Proxy immagini ciclismo.info: il sito è solo HTTP, il browser HTTPS le blocca
// come mixed content. Scarica lato server e ri-serve via HTTPS.
const _icImgCache = new Map(); // url → { buf, ct, ts }
app.get('/api/ic-image', async (req, res) => {
  try {
    const target = req.query.url;
    if (!target || !/^https?:\/\/[a-z]+\.ciclismo\.info\//i.test(target)) {
      return res.status(400).send('url non valido');
    }
    // Cache in memoria 1h
    const cached = _icImgCache.get(target);
    if (cached && (Date.now() - cached.ts) < 3600000) {
      res.set('Content-Type', cached.ct);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(cached.buf);
    }
    const lib = target.startsWith('https') ? require('https') : require('http');
    const u = new URL(target);
    const proxyReq = lib.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
        rejectUnauthorized: false, headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 },
      proxyRes => {
        if (proxyRes.statusCode !== 200) { res.status(502).send('fetch fallito'); proxyRes.resume(); return; }
        const chunks = [];
        proxyRes.on('data', c => chunks.push(c));
        proxyRes.on('end', () => {
          const buf = Buffer.concat(chunks);
          const ct = proxyRes.headers['content-type'] || 'image/jpeg';
          _icImgCache.set(target, { buf, ct, ts: Date.now() });
          if (_icImgCache.size > 500) _icImgCache.delete(_icImgCache.keys().next().value);
          res.set('Content-Type', ct);
          res.set('Cache-Control', 'public, max-age=86400');
          res.send(buf);
        });
      }
    );
    proxyReq.on('error', () => res.status(502).send('errore proxy'));
    proxyReq.on('timeout', () => { proxyReq.destroy(); res.status(504).send('timeout'); });
    proxyReq.end();
  } catch (e) { res.status(500).send(e.message); }
});

// GET foto xpix approvate (endpoint pubblico usato dal frontend)
app.get('/api/xpix-photos', async (req, res) => {
  try {
    const photos = await readXpixPhotos();
    res.json({ photos: Object.values(photos) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH xpix-photos: aggiorna gara_id di una voce (per correggere mismatch)
app.patch('/api/admin/xpix/photos/relink', requireAdmin, async (req, res) => {
  try {
    let { old_gara_id, new_gara_id, album_slug } = req.body;
    if (!new_gara_id) return res.status(400).json({ error: 'new_gara_id obbligatorio' });
    // Estrai gara_id se è stato incollato un URL completo (#/gara/XXX)
    const m = String(new_gara_id).match(/#\/gara\/([^?&\s]+)/);
    if (m) new_gara_id = decodeURIComponent(m[1]);
    new_gara_id = new_gara_id.trim();

    const photos = await readXpixPhotos();
    // Trova l'entry: prima per old_gara_id, poi (fallback) per album_slug
    let srcKey = (old_gara_id && photos[old_gara_id]) ? old_gara_id : null;
    if (!srcKey && album_slug) {
      srcKey = Object.keys(photos).find(k => photos[k].album_slug === album_slug);
    }
    if (!srcKey) return res.status(404).json({ error: `Foto xpix non trovate (gara_id: ${old_gara_id||'?'}, slug: ${album_slug||'?'})` });
    old_gara_id = srcKey;

    const entry = { ...photos[old_gara_id], gara_id: new_gara_id };

    // Ricarica tutte le foto fresche dal sito (l'entry vecchia poteva averne 1 sola)
    let albumPhotos = entry.photos || [];
    if (entry.album_slug) {
      try {
        const albInfo = await fetchAlbumBySlug(entry.album_slug);
        if (albInfo) {
          const fresh = await fetchPhotosForAlbum(albInfo);
          if (fresh.length) albumPhotos = fresh;
        }
      } catch (e) { console.warn('[relink] refresh:', e.message); }
    }
    entry.photos = albumPhotos;
    entry.url    = entry.url || albumPhotos[0];

    if (new_gara_id !== old_gara_id) delete photos[old_gara_id];
    photos[new_gara_id] = entry;
    await writeXpixPhotos(photos);

    // Sincronizza il media_album per la nuova gara
    try {
      let xpixProfile = await rawQuery(
        `SELECT * FROM media_profiles WHERE user_id IS NULL AND display_name = 'xpix.it' LIMIT 1`
      ).then(r => r.rows[0]);
      if (!xpixProfile) {
        const r = await rawQuery(
          `INSERT INTO media_profiles (user_id, display_name, bio, website, instagram, status)
           VALUES (NULL, 'xpix.it', 'Fotografia ciclismo agonistico italiano', 'https://www.xpix.it', 'xpix.it', 'active') RETURNING *`
        );
        xpixProfile = r.rows[0];
      }
      // Rimuovi eventuale media_album della vecchia gara
      if (new_gara_id !== old_gara_id) {
        await rawQuery(`DELETE FROM media_albums WHERE media_profile_id=$1 AND gara_id=$2`, [xpixProfile.id, old_gara_id]).catch(()=>{});
      }
      let albumId = await rawQuery(
        `SELECT id FROM media_albums WHERE media_profile_id=$1 AND gara_id=$2 LIMIT 1`,
        [xpixProfile.id, new_gara_id]
      ).then(r => r.rows[0]?.id);
      if (!albumId) {
        const album = await queries.createMediaAlbum({
          media_profile_id: xpixProfile.id, gara_id: new_gara_id,
          title: entry.album_name || entry.album_slug, description: '',
        });
        albumId = album.id;
      }
      // Svuota e ricarica tutte le foto
      await rawQuery(`DELETE FROM media_photos WHERE album_id=$1`, [albumId]);
      let ord = 0;
      for (const url of albumPhotos) {
        await queries.addMediaPhoto({ album_id: albumId, filename: null, ext_url: url, caption: '', ord: ord++ });
      }
    } catch (e2) { console.warn('[relink] media_album:', e2.message); }

    res.json({ ok: true, new_gara_id, photos_count: albumPhotos.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Media profiles ────────────────────────────────────────────────────────────

// Crea profilo media (richiesta, va approvata dall'admin)
app.post('/api/profile/media', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'media') return res.status(403).json({ error: 'Solo per account Media/Fotografo' });
    const existing = await queries.getMediaProfileByUser(req.user.id);
    if (existing) return res.status(409).json({ error: 'Profilo già presente' });
    const { display_name, bio, website, instagram, facebook } = req.body;
    if (!display_name?.trim()) return res.status(400).json({ error: 'Il nome è obbligatorio' });
    const profile = await queries.createMediaProfile({
      user_id: req.user.id,
      display_name: display_name.trim(),
      bio: bio?.trim() || '',
      website: website?.trim() || '',
      instagram: instagram?.trim() || '',
      facebook: facebook?.trim() || '',
    });
    res.status(201).json({ ok: true, profile });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Aggiorna profilo media (utente media o admin)
app.patch('/api/profile/media', requireAuth, async (req, res) => {
  try {
    const profile = await queries.getMediaProfileByUser(req.user.id);
    if (!profile && req.user.role !== 'admin') return res.status(404).json({ error: 'Profilo non trovato' });
    const { display_name, bio, website, instagram, facebook } = req.body;
    await queries.updateMediaProfile({
      id: profile.id,
      display_name: display_name?.trim() || profile.display_name,
      bio: bio?.trim() ?? profile.bio,
      website: website?.trim() ?? profile.website,
      instagram: instagram?.trim() ?? profile.instagram,
      facebook: facebook?.trim() ?? (profile.facebook || ''),
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lista pubblica profili media approvati
app.get('/api/media/profiles', async (req, res) => {
  try { res.json({ profiles: await queries.getApprovedMediaProfiles() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Lista profili media scrapati e liberi (per utenti media che vogliono rivendicarli)
app.get('/api/media/profiles/unclaimed', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'media') return res.status(403).json({ error: 'Solo per account Media/Fotografo' });
    res.json({ profiles: await queries.getUnclaimedMediaProfiles() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rivendica un profilo media già esistente (scrapato). Va approvato dall'admin.
app.post('/api/media/profile/:id/claim', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'media') return res.status(403).json({ error: 'Solo per account Media/Fotografo' });
    const existing = await queries.getMediaProfileByUser(req.user.id);
    if (existing) return res.status(409).json({ error: 'Hai già un profilo media collegato' });
    const claimed = await queries.claimMediaProfile(parseInt(req.params.id, 10), req.user.id);
    if (!claimed) return res.status(409).json({ error: 'Profilo non disponibile o già rivendicato' });
    res.json({ ok: true, profile: claimed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Profilo media singolo (pubblico) con album
app.get('/api/media/profile/:id', async (req, res) => {
  try {
    const profile = await queries.getMediaProfileById(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profilo non trovato' });
    const albums  = await queries.getMediaAlbumsByProfile(profile.id);
    const stats   = await queries.countMediaPhotosByProfile(profile.id);
    res.json({ profile, albums, stats });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Album di una gara (pubblico)
app.get('/api/media/gara/:gara_id', async (req, res) => {
  try { res.json({ albums: await queries.getMediaAlbumsByGara(req.params.gara_id) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Middleware media/admin ─────────────────────────────────────────────────────
function requireMediaOrAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'media' && req.user.role !== 'admin')
      return res.status(403).json({ error: 'Solo per account Media/Fotografo' });
    next();
  });
}

// Crea album
app.post('/api/media/album', requireMediaOrAdmin, async (req, res) => {
  try {
    const profile = req.user.role === 'admin'
      ? await queries.getMediaProfileById(req.body.media_profile_id)
      : await queries.getMediaProfileByUser(req.user.id);
    if (!profile) return res.status(404).json({ error: 'Profilo media non trovato' });
    const { gara_id, title, description } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Titolo obbligatorio' });
    const album = await queries.createMediaAlbum({
      media_profile_id: profile.id,
      gara_id: gara_id || null,
      title: title.trim(),
      description: description?.trim() || '',
    });
    res.status(201).json({ ok: true, album });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Modifica album
app.patch('/api/media/album/:id', requireMediaOrAdmin, async (req, res) => {
  try {
    const album = await queries.getMediaAlbum(req.params.id);
    if (!album) return res.status(404).json({ error: 'Album non trovato' });
    // verifica ownership se non admin
    if (req.user.role !== 'admin') {
      const profile = await queries.getMediaProfileByUser(req.user.id);
      if (!profile || album.media_profile_id !== profile.id)
        return res.status(403).json({ error: 'Non autorizzato' });
    }
    const { title, gara_id, description } = req.body;
    await queries.updateMediaAlbum({
      id: album.id,
      title: title?.trim() || album.title,
      gara_id: gara_id !== undefined ? (gara_id || null) : album.gara_id,
      description: description?.trim() ?? album.description,
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Elimina album
app.delete('/api/media/album/:id', requireMediaOrAdmin, async (req, res) => {
  try {
    const album = await queries.getMediaAlbum(req.params.id);
    if (!album) return res.status(404).json({ error: 'Album non trovato' });
    if (req.user.role !== 'admin') {
      const profile = await queries.getMediaProfileByUser(req.user.id);
      if (!profile || album.media_profile_id !== profile.id)
        return res.status(403).json({ error: 'Non autorizzato' });
    }
    // Cancella foto locali dell'album
    const photos = await queries.getMediaPhotosByAlbum(album.id);
    for (const p of photos) { if (p.filename) await deletePhoto(p.filename).catch(() => {}); }
    await queries.deleteMediaAlbum(album.id);

    // Se l'album era xpix, segna gallery_deleted per evitare che seed-xpix lo rircei
    if (album.gara_id) {
      const xpixPhotos = await readXpixPhotos().catch(() => ({}));
      if (xpixPhotos[album.gara_id]) {
        xpixPhotos[album.gara_id].gallery_deleted = true;
        await writeXpixPhotos(xpixPhotos).catch(() => {});
      }
    }

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Upload foto in album (multiple, max 20 per richiesta)
const uploadMedia = multer({
  storage: supabase ? multer.memoryStorage() : multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `media_${Date.now()}_${Math.random().toString(36).slice(2,7)}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Solo immagini JPEG, PNG, WebP'));
  },
});

app.post('/api/media/album/:id/photos', requireMediaOrAdmin, uploadMedia.array('photos', 20), async (req, res) => {
  try {
    const album = await queries.getMediaAlbum(req.params.id);
    if (!album) return res.status(404).json({ error: 'Album non trovato' });
    if (req.user.role !== 'admin') {
      const profile = await queries.getMediaProfileByUser(req.user.id);
      if (!profile || album.media_profile_id !== profile.id)
        return res.status(403).json({ error: 'Non autorizzato' });
    }
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Nessun file ricevuto' });

    // Ottieni l'ordine corrente massimo
    const existingPhotos = await queries.getMediaPhotosByAlbum(album.id);
    let startOrd = existingPhotos.length;

    const saved = [];
    for (const file of files) {
      const ext      = path.extname(file.originalname).toLowerCase() || '.jpg';
      const filename = `media_${Date.now()}_${Math.random().toString(36).slice(2,7)}${ext}`;
      if (supabase) {
        const { error } = await supabase.storage.from('photos').upload(filename, file.buffer, { contentType: file.mimetype, upsert: true });
        if (error) throw new Error(error.message);
      } else {
        fs.writeFileSync(path.join(UPLOADS_DIR, filename), file.buffer || fs.readFileSync(file.path));
      }
      const photo = await queries.addMediaPhoto({ album_id: album.id, filename, caption: '', ord: startOrd++ });
      saved.push(photo);
    }
    res.status(201).json({ ok: true, photos: saved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Foto singola di un album (pubblico)
app.get('/api/media/album/:id/photos', async (req, res) => {
  try {
    const photos = await queries.getMediaPhotosByAlbum(req.params.id);
    res.json({ photos });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Elimina singola foto
app.delete('/api/media/photo/:id', requireMediaOrAdmin, async (req, res) => {
  try {
    const photo = await queries.getMediaPhotoById(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Foto non trovata' });
    if (req.user.role !== 'admin') {
      const album   = await queries.getMediaAlbum(photo.album_id);
      const profile = await queries.getMediaProfileByUser(req.user.id);
      if (!profile || album.media_profile_id !== profile.id)
        return res.status(403).json({ error: 'Non autorizzato' });
    }
    const deleted = await queries.deleteMediaPhoto(photo.id);
    if (deleted?.filename) await deletePhoto(deleted.filename).catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Aggiorna caption di una foto
app.patch('/api/media/photo/:id', requireMediaOrAdmin, async (req, res) => {
  try {
    const photo = await queries.getMediaPhotoById(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Foto non trovata' });
    if (req.user.role !== 'admin') {
      const album   = await queries.getMediaAlbum(photo.album_id);
      const profile = await queries.getMediaProfileByUser(req.user.id);
      if (!profile || album.media_profile_id !== profile.id)
        return res.status(403).json({ error: 'Non autorizzato' });
    }
    await pool.query(`UPDATE media_photos SET caption=$2 WHERE id=$1`, [photo.id, req.body.caption || '']);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Purchase requests ─────────────────────────────────────────────────────────

// Richiedi acquisto foto (utente loggato → notifica al fotografo)
app.post('/api/media/photo/:id/request-purchase', requireAuth, async (req, res) => {
  try {
    const photo = await queries.getMediaPhotoById(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Foto non trovata' });
    const album = await queries.getMediaAlbum(photo.album_id);
    if (!album) return res.status(404).json({ error: 'Album non trovato' });

    const requester = await queries.getUserById(req.user.id);
    const request   = await queries.createPurchaseRequest({
      media_photo_id: photo.id,
      requester_id:   req.user.id,
      message:        req.body.message || '',
    });

    // Recupera email del fotografo (se ha account)
    if (album.media_profile_id) {
      const prof = await queries.getMediaProfileById(album.media_profile_id);
      if (prof?.user_id) {
        const photographer = await queries.getUserById(prof.user_id);
        if (photographer?.email) {
          // Log acquisto — in produzione qui si invierebbe una email
          console.log(`[purchase] Richiesta da ${requester.email} al fotografo ${photographer.email} per foto ${photo.id} — album "${album.title}"`);
          // TODO: integrare invio email (es. SendGrid/Nodemailer)
        }
      }
    }

    res.json({ ok: true, request });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Richiesta acquisto tramite URL foto (da carousel — non richiede ID DB)
app.post('/api/media/photo/by-url/request-purchase', requireAuth, async (req, res) => {
  try {
    const { src, album_title, photographer_name, message } = req.body;
    if (!src) return res.status(400).json({ error: 'URL foto mancante' });
    const requester = await queries.getUserById(req.user.id);

    // Cerca il profilo media del fotografo tramite display_name
    const profiles = await queries.getApprovedMediaProfiles();
    const profile  = profiles.find(p => p.display_name === photographer_name);
    let photographerEmail = null;
    let photographerUserId = null;
    if (profile?.user_id) {
      const photographer = await queries.getUserById(profile.user_id);
      photographerEmail  = photographer?.email || null;
      photographerUserId = profile.user_id;
    }

    const requesterLabel = requester.display_name || requester.email;
    const notifBody = `${requesterLabel} vuole acquistare una tua foto dall'album "${album_title}".\nMessaggio: ${message || '—'}\nContatto: ${requester.email}`;

    await sendNotification({
      user_id:       photographerUserId,
      type:          'purchase_request',
      title:         `🛒 Richiesta acquisto foto`,
      body:          notifBody,
      data:          { src, album_title, photographer_name, requester_email: requester.email, requester_name: requesterLabel, message },
      email_to:      photographerEmail,
      email_subject: `[ItaliacritResultati] Richiesta acquisto foto — "${album_title}"`,
      email_html: `
        <h2 style="color:#e65c00;margin-top:0">🛒 Nuova richiesta di acquisto foto</h2>
        <p><strong>${requesterLabel}</strong> è interessato/a ad acquistare una tua foto.</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr style="background:#f9f9f9"><td style="padding:8px 12px;color:#666;width:120px">Album</td>
              <td style="padding:8px 12px"><strong>${album_title}</strong></td></tr>
          <tr><td style="padding:8px 12px;color:#666">Messaggio</td>
              <td style="padding:8px 12px">${message || '<em>—</em>'}</td></tr>
          <tr style="background:#f9f9f9"><td style="padding:8px 12px;color:#666">Email contatto</td>
              <td style="padding:8px 12px"><a href="mailto:${requester.email}">${requester.email}</a></td></tr>
        </table>`,
    });

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: Social Post Queue ──────────────────────────────────────────────────

app.get('/api/admin/social/queue', requireAdmin, async (req, res) => {
  try { res.json({ queue: await readSocialQueue() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Pubblica su Facebook (con eventuale caption modificata dall'admin)
app.post('/api/admin/social/:id/approve', requireAdmin, async (req, res) => {
  try {
    const queue = await readSocialQueue();
    const idx = queue.findIndex(p => p.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Post non trovato' });
    const post = queue[idx];
    const finalCaption = ((req.body.caption || post.caption) + '').trim();
    const fbResult = await postToFacebook(finalCaption, post.photo_url);
    queue[idx] = { ...post, caption: finalCaption, status: 'posted', fb_post_id: fbResult.id || fbResult.post_id || null, posted_at: new Date().toISOString() };
    await writeSocialQueue(queue);
    res.json({ ok: true, fb: fbResult });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/social/:id/reject', requireAdmin, async (req, res) => {
  try {
    const queue = await readSocialQueue();
    const idx = queue.findIndex(p => p.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Post non trovato' });
    queue[idx].status = 'rejected';
    await writeSocialQueue(queue);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rigenera la caption con Claude
app.post('/api/admin/social/:id/regenerate', requireAdmin, async (req, res) => {
  try {
    const queue = await readSocialQueue();
    const idx = queue.findIndex(p => p.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Post non trovato' });
    const post = queue[idx];
    const caption = await generateSocialCaption({ nome_gara: post.gara_name, winner_label: post.winner, category: post.category, winner_team: post.winner_team, date: post.date, link: post.link });
    queue[idx] = { ...post, caption, status: 'pending' };
    await writeSocialQueue(queue);
    res.json({ ok: true, caption });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Trigger manuale accodamento post social (utile per test)
app.post('/api/admin/social/queue-now', requireAdmin, async (req, res) => {
  try {
    await queueSocialPostsForToday();
    const queue = await readSocialQueue();
    res.json({ ok: true, total: queue.length, pending: queue.filter(p => p.status === 'pending').length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Condivisione foto su profilo atleta tramite URL
app.post('/api/media/photo/by-url/share', requireAuth, async (req, res) => {
  try {
    const { src, album_title, photographer_name } = req.body;
    if (!src) return res.status(400).json({ error: 'URL foto mancante' });

    // Cerca la foto nel DB per url o ext_url
    const row = await rawQuery(
      `SELECT mp.id, mp.album_id FROM media_photos mp WHERE mp.ext_url = $1 OR (mp.filename IS NOT NULL AND $1 LIKE '%' || mp.filename || '%') LIMIT 1`,
      [src]
    ).then(r => r.rows[0]);
    const athleteProfile = await queries.getAthleteProfile(req.user.id);
    if (row) {
      await queries.createAthleteShare({
        media_photo_id:     row.id,
        athlete_profile_id: athleteProfile?.id || null,
        user_id:            req.user.id,
      });
    }

    // Notifica al fotografo (se ha account)
    if (photographer_name) {
      const sharer      = await queries.getUserById(req.user.id);
      const profiles    = await queries.getApprovedMediaProfiles();
      const profile     = profiles.find(p => p.display_name === photographer_name);
      if (profile?.user_id) {
        const photographer    = await queries.getUserById(profile.user_id);
        const sharerLabel     = sharer.display_name || sharer.email;
        const albumLabel      = album_title ? `dall'album "${album_title}"` : '';
        const notifBody       = `${sharerLabel} ha condiviso una tua foto ${albumLabel} sul proprio profilo atleta.`;
        await sendNotification({
          user_id:       profile.user_id,
          type:          'photo_shared',
          title:         `📌 Foto condivisa sul profilo atleta`,
          body:          notifBody,
          data:          { src, album_title, sharer_email: sharer.email, sharer_name: sharerLabel },
          email_to:      photographer?.email,
          email_subject: `[ItaliacritResultati] Un atleta ha condiviso una tua foto`,
          email_html: `
            <h2 style="color:#2563eb;margin-top:0">📌 Foto condivisa sul profilo atleta</h2>
            <p><strong>${sharerLabel}</strong> ha condiviso una tua foto ${albumLabel} sul proprio profilo atleta di ItaliacritResultati.</p>`,
        });
      }
    }

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lista richieste acquisto per il fotografo loggato
app.get('/api/media/purchase-requests', requireMediaOrAdmin, async (req, res) => {
  try {
    const profile = req.user.role === 'admin'
      ? { id: req.query.profile_id }
      : await queries.getMediaProfileByUser(req.user.id);
    if (!profile) return res.status(404).json({ error: 'Profilo non trovato' });
    const requests = await queries.getPurchaseRequestsForPhotographer(profile.id);
    res.json({ requests });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Athlete shares ─────────────────────────────────────────────────────────────

// Atleta condivide una foto sul proprio profilo
app.post('/api/media/photo/:id/share', requireAuth, async (req, res) => {
  try {
    const photo = await queries.getMediaPhotoById(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Foto non trovata' });
    const athleteProfile = await queries.getAthleteProfile(req.user.id);
    await queries.createAthleteShare({
      media_photo_id:     photo.id,
      athlete_profile_id: athleteProfile?.id || null,
      user_id:            req.user.id,
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Notifications API ─────────────────────────────────────────────────────────

// Lista notifiche (max 50, più recenti prima)
app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const notifications = await queries.getNotificationsForUser(req.user.id, 50);
    res.json({ notifications });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Conteggio non lette (usato dal polling frontend)
app.get('/api/notifications/count', requireAuth, async (req, res) => {
  try {
    const row = await queries.countUnreadNotifications(req.user.id);
    res.json({ count: row?.count || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Segna tutte come lette (chiamato all'apertura del pannello)
app.patch('/api/notifications/read-all', requireAuth, async (req, res) => {
  try {
    await queries.markAllNotificationsRead(req.user.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Segna una come letta
app.patch('/api/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    await queries.markNotificationRead(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Elimina una notifica
app.delete('/api/notifications/:id', requireAuth, async (req, res) => {
  try {
    await queries.deleteNotification(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin: seed xpix → media albums ──────────────────────────────────────────
app.post('/api/admin/media/seed-xpix', requireAdmin, async (req, res) => {
  try {
    // 1. Crea (o trova) profilo "xpix.it" — utente_id NULL = profilo di sistema
    let xpixProfile = await rawQuery(`SELECT * FROM media_profiles WHERE user_id IS NULL AND display_name = 'xpix.it' LIMIT 1`).then(r => r.rows[0]);
    if (!xpixProfile) {
      const r = await rawQuery(
        `INSERT INTO media_profiles (user_id, display_name, bio, website, instagram, status)
         VALUES (NULL, 'xpix.it', 'Fotografia ciclismo agonistico italiano', 'https://www.xpix.it', 'xpix.it', 'active')
         RETURNING *`
      );
      xpixProfile = r.rows[0];
    }

    // 2. Leggi xpix_queue da Supabase per avere le foto complete degli album
    const xpixQueue = await readXpixQueue();
    const xpixPhotos = await readXpixPhotos();

    // Mappa slug → item di coda (con photos[])
    const queueBySlug = {};
    for (const item of xpixQueue) {
      if (item.album_slug && item.photos?.length) queueBySlug[item.album_slug] = item;
    }

    const force = !!req.body?.force; // force=true → ignora gallery_deleted
    let created = 0, skipped = 0;
    for (const [gara_id, xpixEntry] of Object.entries(xpixPhotos)) {
      const slug = xpixEntry.album_slug;
      if (!slug) { skipped++; continue; }
      if (xpixEntry.gallery_deleted && !force) { skipped++; continue; }

      // Salta se album già presente
      const existing = await rawQuery(
        `SELECT id FROM media_albums WHERE media_profile_id=$1 AND gara_id=$2 LIMIT 1`,
        [xpixProfile.id, gara_id]
      ).then(r => r.rows[0]);
      if (existing) { skipped++; continue; }

      // Crea album
      const album = await queries.createMediaAlbum({
        media_profile_id: xpixProfile.id,
        gara_id,
        title: xpixEntry.album_name || slug,
        description: '',
      });

      // Aggiungi le foto: usa photos[] dalla queue se disponibili, altrimenti solo la foto hero
      const photoUrls = queueBySlug[slug]?.photos?.length
        ? queueBySlug[slug].photos
        : [xpixEntry.url];

      let ord = 0;
      for (const url of photoUrls) {
        await queries.addMediaPhoto({ album_id: album.id, filename: null, ext_url: url, caption: '', ord: ord++ });
      }
      created++;
    }

    res.json({ ok: true, created, skipped, profile_id: xpixProfile.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Messaging API ─────────────────────────────────────────────────────────────

// Ricerca utenti registrati per display_name (per avviare conversazione da inbox)
app.get('/api/users/search', requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ users: [] });
    const rows = await rawQuery(
      `SELECT id, display_name, role FROM users
       WHERE id != $1 AND display_name ILIKE $2
       ORDER BY display_name LIMIT 15`,
      [req.user.id, `%${q}%`]
    ).then(r => r.rows);
    res.json({ users: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lookup utente da atleta_id (per bottone "Scrivi" su profilo atleta)
app.get('/api/users/lookup', requireAuth, async (req, res) => {
  try {
    let user = null;
    if (req.query.atleta_id) {
      user = await queries.getUserByAtletaId(req.query.atleta_id);
    } else if (req.query.team_profile_id) {
      user = await queries.getUserByTeamProfileId(req.query.team_profile_id);
    } else if (req.query.team_name) {
      // Cerca tramite nome team
      const row = await rawQuery(
        `SELECT u.id, u.display_name, u.role FROM users u JOIN team_profiles tp ON tp.user_id=u.id WHERE LOWER(tp.nome)=LOWER($1) AND tp.status='active' LIMIT 1`,
        [req.query.team_name]
      ).then(r => r.rows[0] || null);
      user = row;
    } else if (req.query.media_profile_id) {
      const prof = await queries.getMediaProfileById(req.query.media_profile_id);
      if (prof?.user_id) user = await queries.getUserById(prof.user_id);
    }
    if (!user) return res.json({ user: null });
    // Non esporre dati sensibili
    res.json({ user: { id: user.id, display_name: user.display_name, role: user.role } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Conteggio messaggi non letti
app.get('/api/messages/unread-count', requireAuth, async (req, res) => {
  try {
    const row = await queries.countUnreadMessages(req.user.id);
    res.json({ count: row?.count || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lista conversazioni dell'utente loggato
app.get('/api/messages/conversations', requireAuth, async (req, res) => {
  try {
    const conversations = await queries.getConversationsForUser(req.user.id);
    res.json({ conversations });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Avvia (o trova) conversazione + invia primo messaggio
app.post('/api/messages/conversations', requireAuth, async (req, res) => {
  try {
    const { other_user_id, body } = req.body;
    if (!other_user_id) return res.status(400).json({ error: 'other_user_id mancante' });
    if (other_user_id === req.user.id) return res.status(400).json({ error: 'Non puoi scrivere a te stesso' });

    const conv = await queries.getOrCreateConversation(req.user.id, other_user_id);
    let msg = null;
    if (body?.trim()) {
      msg = await queries.sendMessage(conv.id, req.user.id, body.trim());
      // Notifica al destinatario
      const sender = await queries.getUserById(req.user.id);
      const senderLabel = sender.display_name || sender.email;
      const recipient = await queries.getUserById(other_user_id);
      await sendNotification({
        user_id:       other_user_id,
        type:          'new_message',
        title:         `✉ Messaggio da ${senderLabel}`,
        body:          body.trim().slice(0, 200),
        data:          { conversation_id: conv.id, sender_id: req.user.id, sender_name: senderLabel },
        email_to:      recipient?.email,
        email_subject: `[ItaliacritResultati] Nuovo messaggio da ${senderLabel}`,
        email_html: `
          <h2 style="color:#2563eb;margin-top:0">✉ Nuovo messaggio</h2>
          <p>Hai ricevuto un messaggio da <strong>${senderLabel}</strong>:</p>
          <blockquote style="border-left:3px solid #2563eb;margin:16px 0;padding:8px 16px;background:#f0f4ff;border-radius:0 6px 6px 0">
            ${body.trim().replace(/\n/g,'<br/>')}
          </blockquote>`,
      });
    }
    res.json({ ok: true, conversation_id: conv.id, message: msg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Messaggi di una conversazione
app.get('/api/messages/conversations/:id', requireAuth, async (req, res) => {
  try {
    const conv = await queries.getConversationById(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversazione non trovata' });
    // Verifica che l'utente faccia parte della conversazione
    if (conv.user_a !== req.user.id && conv.user_b !== req.user.id) {
      return res.status(403).json({ error: 'Accesso negato' });
    }
    const messages = await queries.getMessages(conv.id, 100);
    // Segna come letti
    await queries.markConversationRead(conv.id, req.user.id);
    res.json({ conversation: conv, messages });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Invia messaggio in conversazione esistente
app.post('/api/messages/conversations/:id/send', requireAuth, async (req, res) => {
  try {
    const conv = await queries.getConversationById(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversazione non trovata' });
    if (conv.user_a !== req.user.id && conv.user_b !== req.user.id) {
      return res.status(403).json({ error: 'Accesso negato' });
    }
    const body = (req.body.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Messaggio vuoto' });

    const msg = await queries.sendMessage(conv.id, req.user.id, body);

    // Notifica all'altro utente
    const other_user_id = conv.user_a === req.user.id ? conv.user_b : conv.user_a;
    const sender    = await queries.getUserById(req.user.id);
    const recipient = await queries.getUserById(other_user_id);
    const senderLabel = sender.display_name || sender.email;
    await sendNotification({
      user_id:       other_user_id,
      type:          'new_message',
      title:         `✉ Messaggio da ${senderLabel}`,
      body:          body.slice(0, 200),
      data:          { conversation_id: conv.id, sender_id: req.user.id, sender_name: senderLabel },
      email_to:      recipient?.email,
      email_subject: `[ItaliacritResultati] Nuovo messaggio da ${senderLabel}`,
      email_html: `
        <h2 style="color:#2563eb;margin-top:0">✉ Nuovo messaggio</h2>
        <p>Hai ricevuto un messaggio da <strong>${senderLabel}</strong>:</p>
        <blockquote style="border-left:3px solid #2563eb;margin:16px 0;padding:8px 16px;background:#f0f4ff;border-radius:0 6px 6px 0">
          ${body.replace(/\n/g,'<br/>')}
        </blockquote>`,
    });

    res.json({ ok: true, message: msg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Segna conversazione come letta (chiamato all'apertura)
app.patch('/api/messages/conversations/:id/read', requireAuth, async (req, res) => {
  try {
    const conv = await queries.getConversationById(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversazione non trovata' });
    if (conv.user_a !== req.user.id && conv.user_b !== req.user.id) {
      return res.status(403).json({ error: 'Accesso negato' });
    }
    await queries.markConversationRead(conv.id, req.user.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Errore interno del server' });
});

// ── Startup ───────────────────────────────────────────────────────────────────

// Garantisce l'esistenza dei profili media delle sorgenti scrapate (user_id NULL),
// così sono sempre presenti e rivendicabili da un utente media.
async function ensureScraperMediaProfiles() {
  const sources = [
    { name: 'xpix.it', bio: 'Fotografia ciclismo agonistico italiano', website: 'https://www.xpix.it', instagram: 'xpix.it' },
  ];

  // Pulizia: rimuove il profilo italiaciclismo.net se non rivendicato (non più usato)
  try {
    await rawQuery(`DELETE FROM media_profiles WHERE user_id IS NULL AND display_name = 'italiaciclismo.net'`);
  } catch (e) { console.warn('[startup] pulizia italiaciclismo.net:', e.message); }
  // Aggiunge anche un profilo per ogni canale video (YouTube) abilitato
  try {
    const channels = await readYTChannels();
    for (const ch of (channels || [])) {
      if (!ch || ch.enabled === false || !ch.name) continue;
      const url = ch.type === 'channel_id' ? `https://www.youtube.com/channel/${ch.value}`
                : ch.type === 'handle'      ? `https://www.youtube.com/@${ch.value}`
                : ch.type === 'username'    ? `https://www.youtube.com/@${ch.value}`
                : '';
      sources.push({ name: ch.name, bio: 'Canale video di ciclismo italiano', website: url, instagram: '' });
    }
  } catch (e) { console.warn('[startup] lettura canali video:', e.message); }

  for (const s of sources) {
    try {
      const existing = await rawQuery(
        `SELECT id FROM media_profiles WHERE user_id IS NULL AND display_name = $1 LIMIT 1`, [s.name]
      ).then(r => r.rows[0]);
      if (!existing) {
        await rawQuery(
          `INSERT INTO media_profiles (user_id, display_name, bio, website, instagram, status)
           VALUES (NULL, $1, $2, $3, $4, 'active')`,
          [s.name, s.bio, s.website, s.instagram]
        );
        console.log(`[startup] Creato profilo media sorgente "${s.name}"`);
      }
    } catch (e) { console.warn(`[startup] ensureScraperMediaProfiles "${s.name}":`, e.message); }
  }
}

// Sync xpix automatica ogni 6 ore (senza richiedere azione admin)
async function autoXpixSync() {
  try {
    console.log('[xpix-auto] Avvio sync automatica...');
    const queue      = await readXpixQueue();
    const knownSlugs = new Set(queue.map(q => q.album_slug));
    const candidates = await fetchXpixCandidates(knownSlugs, 30);
    if (!candidates.length) { console.log('[xpix-auto] Nessun nuovo album'); return; }
    let added = 0;
    for (const c of candidates) {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      queue.push({ id, album_id: c.album_id, album_name: c.album_name,
        album_slug: c.album_slug, album_page: c.album_page,
        photo_url: c.photo_url, photos: c.photos, photo_count: c.photo_count,
        status: 'pending', added_at: new Date().toISOString() });
      added++;
    }
    if (added) {
      // Mantieni max 200 pending
      const nonPending = queue.filter(q => q.status !== 'pending');
      const pending    = queue.filter(q => q.status === 'pending').slice(0, 200);
      await writeXpixQueue([...nonPending, ...pending]);
      console.log(`[xpix-auto] ${added} nuovi album aggiunti alla coda`);
    }
  } catch (e) {
    console.warn('[xpix-auto] Errore:', e.message);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── FOLLOW ATLETI / TEAM ──────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// Restituisce la lista completa dei follow dell'utente
app.get('/api/follow/list', requireAuth, async (req, res) => {
  try {
    const [atleti, teams] = await Promise.all([
      queries.getAtletaFollows(req.user.id),
      queries.getTeamFollows(req.user.id),
    ]);
    res.json({ atleti: atleti.map(r => r.atleta_id), teams: teams.map(r => r.team_id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Toggle follow atleta
app.post('/api/follow/atleta/:id', requireAuth, async (req, res) => {
  try {
    const atletaId = req.params.id;
    const existing = await queries.getFollowersByAtleta(atletaId).then(rows => rows.some(r => r.user_id === req.user.id));
    if (existing) {
      await queries.unfollowAtleta(req.user.id, atletaId);
      res.json({ following: false });
    } else {
      await queries.followAtleta(req.user.id, atletaId);
      res.json({ following: true });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Toggle follow team
app.post('/api/follow/team/:id', requireAuth, async (req, res) => {
  try {
    const teamId = req.params.id;
    const existing = await queries.getFollowersByTeam(teamId).then(rows => rows.some(r => r.user_id === req.user.id));
    if (existing) {
      await queries.unfollowTeam(req.user.id, teamId);
      res.json({ following: false });
    } else {
      await queries.followTeam(req.user.id, teamId);
      res.json({ following: true });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Notifica follower dopo scrape ─────────────────────────────────────────────
// Chiamata da notify-results: trova atleti con nuovi risultati oggi e notifica
// i loro follower (esclude l'atleta stesso se ha un profilo utente).
async function notifyFollowers() {
  try {
    const results = readDataJson('results_raw.json') || [];
    const today     = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    // Atleti con risultati recenti
    const recentAtleti = new Set();
    const atletaResults = {}; // atleta_id → best result today
    for (const r of results) {
      const d = (r.data_gara || r.date || '').slice(0, 10);
      if (d !== today && d !== yesterday) continue;
      if (!r.atleta_id) continue;
      recentAtleti.add(r.atleta_id);
      if (!atletaResults[r.atleta_id] || Number(r.posizione) < Number(atletaResults[r.atleta_id].posizione))
        atletaResults[r.atleta_id] = r;
    }
    if (!recentAtleti.size) return;
    // Carica tutti i follow in un unico query per efficienza
    const allFollows = await queries.getAllAtletaFollows();
    const byAtleta = {}; // atleta_id → Set<user_id>
    for (const { user_id, atleta_id } of allFollows) {
      if (!byAtleta[atleta_id]) byAtleta[atleta_id] = new Set();
      byAtleta[atleta_id].add(user_id);
    }
    for (const atletaId of recentAtleti) {
      const followers = byAtleta[atletaId];
      if (!followers?.size) continue;
      const r = atletaResults[atletaId];
      const nome = `${r.cognome || ''} ${r.nome || ''}`.trim();
      const pos  = r.posizione ? `${r.posizione}° posto` : 'nuovo risultato';
      const gara = r.nome_gara || r.gara_id || '';
      for (const userId of followers) {
        sendPushToUser(userId, {
          title: `🚴 ${nome} — ${pos}`,
          body:  `${gara}${r.categoria ? ' · ' + r.categoria : ''}`,
          url:   `/#/gara/${encodeURIComponent(r.gara_id || '')}`,
        }).catch(() => {});
      }
    }
    console.log(`[follow] Notifiche follower inviate per ${recentAtleti.size} atleti`);
  } catch (e) { console.warn('[follow] notifyFollowers error:', e.message); }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── COMMENTI GARE ─────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/comments/:garaId', async (req, res) => {
  try {
    const comments = await queries.getGaraComments(req.params.garaId);
    res.json({ comments });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/comments/:garaId', requireAuth, async (req, res) => {
  try {
    const body = (req.body.body || '').trim();
    if (!body || body.length > 500) return res.status(400).json({ error: 'Commento non valido (max 500 caratteri)' });
    const user = await queries.getUserById(req.user.id);
    const display_name = user.display_name || user.email.split('@')[0];
    const comment = await queries.addGaraComment(req.params.garaId, req.user.id, display_name, body);
    res.json({ ok: true, comment });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/comments/:id', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    await queries.deleteGaraComment(req.params.id, req.user.id, isAdmin);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── PCS PHOTO PROXY ───────────────────────────────────────────────────────────
// Fetches rider profile photos from ProCyclingStats (hotlink-protected) and
// caches them in Supabase Storage so subsequent requests are served from CDN.
// ══════════════════════════════════════════════════════════════════════════════

function pcsSlug(name) {
  return (name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// In-memory cache: slug → { url, ts } (url can be null = not found)
const _pcsCache = new Map();
const PCS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

app.get('/api/pcs-photo', async (req, res) => {
  const name = (req.query.name || '').trim();
  if (!name) return res.json({ url: null });

  const slug = pcsSlug(name);
  if (!slug) return res.json({ url: null });

  // In-memory cache hit
  const cached = _pcsCache.get(slug);
  if (cached && (Date.now() - cached.ts) < PCS_CACHE_TTL) {
    return res.json({ url: cached.url });
  }

  const storagePath = `pcs/${slug}.jpeg`;
  const publicUrl   = `${SUPABASE_PUB}/photos/${storagePath}`;

  // Check Supabase: try to list the file in the pcs/ folder
  if (supabase) {
    try {
      const { data: listed } = await supabase.storage.from('photos').list('pcs', { search: `${slug}.jpeg`, limit: 1 });
      if (listed?.some(f => f.name === `${slug}.jpeg`)) {
        _pcsCache.set(slug, { url: publicUrl, ts: Date.now() });
        return res.json({ url: publicUrl });
      }
    } catch {}
  }

  // Fetch from PCS
  const pcsUrl = `https://www.procyclingstats.com/images/riders/lg/${slug}.jpeg`;
  try {
    const pcsRes = await fetch(pcsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Referer':    'https://www.procyclingstats.com/',
        'Accept':     'image/jpeg,image/*,*/*',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!pcsRes.ok) {
      _pcsCache.set(slug, { url: null, ts: Date.now() });
      return res.json({ url: null });
    }

    const buffer = Buffer.from(await pcsRes.arrayBuffer());

    // Save to Supabase for permanent caching
    if (supabase) {
      try {
        const { error } = await supabase.storage.from('photos').upload(storagePath, buffer, {
          contentType: 'image/jpeg',
          upsert: true,
        });
        if (!error) {
          _pcsCache.set(slug, { url: publicUrl, ts: Date.now() });
          return res.json({ url: publicUrl });
        }
      } catch {}
    }

    // Supabase unavailable — proxy the image directly
    _pcsCache.set(slug, { url: null, ts: Date.now() }); // don't cache proxied responses
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch {
    _pcsCache.set(slug, { url: null, ts: Date.now() });
    res.json({ url: null });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── AI ASSISTANT ──────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

const _aiRateLimit = new Map(); // ip → { count, resetAt }
function checkAiRateLimit(ip) {
  const now = Date.now();
  const entry = _aiRateLimit.get(ip);
  if (!entry || entry.resetAt < now) {
    _aiRateLimit.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 30) return false;
  entry.count++;
  return true;
}

app.post('/api/ai/ask', async (req, res) => {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    if (!checkAiRateLimit(ip)) return res.status(429).json({ error: 'Troppo richieste — riprova tra un\'ora' });
    const question = (req.body.question || '').trim().slice(0, 400);
    if (!question) return res.status(400).json({ error: 'Domanda vuota' });
    const ai = getAnthropic();
    if (!ai) return res.status(503).json({ error: 'AI non disponibile al momento' });

    // Legge da GitHub Pages (stessa fonte del frontend → dati intera stagione).
    const [results, calendar, teamsRaw] = await Promise.all([
      readDataJsonFromGH('results_raw.json').then(d => d || []),
      readDataJsonFromGH('calendar.json').then(d => d || []),
      readDataJsonFromGH('teams.json').then(d => d || {}),
    ]);
    const q = question.toLowerCase();

    // ── Intervallo date dati disponibili ──────────────────────────────────────
    const allDates = results.map(r => r.data).filter(Boolean).sort();
    const dataFrom = allDates[0] || '?';
    const dataTo   = allDates[allDates.length - 1] || '?';

    // ── Helper: catCode da un risultato ──────────────────────────────────────
    function getCatCode(r) {
      const m = (r.gara_id || '').match(/_([A-Z0-9]+)_([MF])$/);
      if (m) { let b = m[1]; if (b.startsWith('AL')) b = 'AL'; const g = r.genere === 'F' ? 'F' : r.genere === 'M' ? 'M' : m[2]; return `${b}_${g}`; }
      if (r.categoria && /^[A-Z0-9]+_[MF]$/.test(r.categoria)) return r.categoria;
      return null;
    }

    // ── Rilevamento categoria ─────────────────────────────────────────────────
    const CAT_MAP = [
      { code:'AL_M',  kws:['allievi','allievo'] },
      { code:'AL_F',  kws:['allieve','allieva','donne alliev'] },
      { code:'JUN_M', kws:['juniores','junior','juniori'] },
      { code:'JUN_F', kws:['juniores donne','junior donne','junior femmin'] },
      { code:'ELI_M', kws:['elite','under 23','under23','u23'] },
      { code:'ELI_F', kws:['elite donne','donne elite','elite femmin'] },
      { code:'ES_M',  kws:['esordienti','esordiente'] },
      { code:'ES_F',  kws:['esordienti donne','donne esordienti'] },
    ];
    const matchedCats = CAT_MAP.filter(c => c.kws.some(kw => q.includes(kw))).map(c => c.code);

    // ── Rilevamento atleta (fuzzy match su cognome) ───────────────────────────
    const athleteMap = {};
    for (const r of results) {
      if (!r.atleta_id || !r.cognome) continue;
      const key = r.atleta_id;
      if (!athleteMap[key]) athleteMap[key] = { id: key, cognome: r.cognome.toLowerCase(), nome: r.nome || '', fullName: `${r.cognome} ${r.nome || ''}`.trim(), team: r.team || '', cat: getCatCode(r) };
    }
    const matchedAthletes = Object.values(athleteMap).filter(a =>
      a.cognome.length >= 4 && q.includes(a.cognome)
    );

    // ── Rilevamento gara nella domanda (word-based, robusto a trattini/spazi/numeri) ──
    const gareInDomanda = [];
    {
      // stopWords per il match esatto: NON include "giro", "trofeo", "coppa", "gran", "premio"
      // perché fanno parte di nomi propri di gare ("Giro della Pace", "Trofeo Laigueglia" ecc.)
      const stopWords = new Set(['di','del','della','dei','delle','degli','il','lo','la','le','un','una','al','alla','in','a','e','per','su','con']);
      // Parole significative nella domanda (min 3 chars, no stop words)
      const qWords = q.replace(/[''°\-]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !stopWords.has(w));
      const byGaraId = {};
      for (const r of results) {
        if (!r.gara_id) continue;
        if (!byGaraId[r.gara_id]) byGaraId[r.gara_id] = { nome: r.nome_gara || r.gara_id, data: r.data || '', rows: [] };
        byGaraId[r.gara_id].rows.push(r);
      }
      for (const [gid, g] of Object.entries(byGaraId)) {
        const nomeLow = g.nome.toLowerCase().replace(/[''°\-]/g, ' ');
        const nomeWords = nomeLow.split(/\s+/).filter(w => w.length >= 3 && !stopWords.has(w));
        const hits = nomeWords.filter(w => qWords.some(qw => qw.includes(w) || w.includes(qw)));
        const threshold = nomeWords.length >= 3 ? 2 : 1;
        if (hits.length >= threshold) {
          const sorted = g.rows.sort((a,b) => Number(a.posizione)-Number(b.posizione));
          gareInDomanda.push({ gid, nome: g.nome, data: g.data, hits: hits.length, top5: sorted.filter(r => Number(r.posizione) <= 5) });
        }
      }
      // Ordina: prima per hit count (match più preciso), poi per data più recente. Max 5.
      gareInDomanda.sort((a,b) => (b.hits - a.hits) || (b.data||'').localeCompare(a.data||'')).splice(5);

      // ── Suggerimenti quando non si trova la gara esatta ─────────────────────
      // Se non ci sono match precisi, cerca con soglia 1 parola su parole più corte (>=3 chars)
      // e propone le 5 gare più simili come opzioni.
      if (gareInDomanda.length === 0 && qWords.length > 0) {
        const suggestions = [];
        for (const [gid, g] of Object.entries(byGaraId)) {
          const nomeLow = g.nome.toLowerCase().replace(/[''°\-]/g, ' ');
          const nomeWords = nomeLow.split(/\s+/).filter(w => w.length >= 3 && !stopWords.has(w));
          const hits = nomeWords.filter(w => qWords.some(qw => qw.includes(w) || w.includes(qw)));
          if (hits.length >= 1) suggestions.push({ gid, nome: g.nome, data: g.data, hits: hits.length });
        }
        suggestions.sort((a,b) => (b.hits - a.hits) || (b.data||'').localeCompare(a.data||'')).splice(12);
        if (suggestions.length > 0) {
          const suggLines = suggestions.map(s => `  - ${s.nome} (${s.data})`).join('\n');
          contextParts.push(`GARE SIMILI TROVATE (nessuna corrispondenza esatta — mostra queste come opzioni all'utente):\n${suggLines}`);
        }
      }
    }
    // Salvo i suggerimenti strutturati per passarli al frontend come bottoni
    const _aiSuggestions = (gareInDomanda.length === 0)
      ? ((() => {
          const byGaraId2 = {};
          for (const r of results) {
            if (!r.gara_id) continue;
            if (!byGaraId2[r.gara_id]) byGaraId2[r.gara_id] = { nome: r.nome_gara||r.gara_id, data: r.data||'', gid: r.gara_id };
          }
          const stopW2 = new Set(['di','del','della','dei','delle','degli','il','lo','la','le','un','una','al','alla','in','a','e','per','su','con']);
          const qW2 = q.replace(/[''°\-]/g,' ').split(/\s+/).filter(w=>w.length>=3&&!stopW2.has(w));
          return Object.values(byGaraId2)
            .map(g => {
              const nw = g.nome.toLowerCase().replace(/[''°\-]/g,' ').split(/\s+/).filter(w=>w.length>=3&&!stopW2.has(w));
              const h = nw.filter(w=>qW2.some(qw=>qw.includes(w)||w.includes(qw))).length;
              return { ...g, hits: h };
            })
            .filter(g=>g.hits>=1)
            .sort((a,b)=>(b.hits-a.hits)||(b.data||'').localeCompare(a.data||''))
            .slice(0,10)
            .map(g=>({ nome: g.nome, data: g.data, gara_id: g.gid }));
        })())
      : [];

    // ── Profilo atleta completo ───────────────────────────────────────────────
    const atletaBlocks = [];
    for (const ath of matchedAthletes.slice(0, 2)) {
      const athRes = results.filter(r => r.atleta_id === ath.id);
      const wins = athRes.filter(r => Number(r.posizione) === 1);
      const podiums = athRes.filter(r => Number(r.posizione) <= 3);
      const lastDate = athRes.reduce((mx, r) => (r.data||'') > mx ? r.data : mx, '');
      const cut30 = new Date(lastDate || new Date()); cut30.setDate(cut30.getDate()-30);
      const recent = athRes.filter(r => r.data && r.data >= cut30.toISOString().split('T')[0]).sort((a,b)=>(b.data||'').localeCompare(a.data||''));
      const cats = [...new Set(athRes.map(r=>getCatCode(r)).filter(Boolean))];
      const teamNow = athRes.sort((a,b)=>(b.data||'').localeCompare(a.data||''))[0]?.team || ath.team;
      const recentLines = recent.slice(0, 8).map(r => `  ${r.data} — ${r.nome_gara||r.gara_id} → ${r.posizione}° (${r.punti_effettivi||0}pt)`);
      atletaBlocks.push(`ATLETA: ${ath.fullName.toUpperCase()}
Team attuale: ${teamNow}
Categoria: ${cats.join(', ')}
Stagione: ${wins.length} vittorie, ${podiums.length} podi, ${athRes.length} gare disputate
Risultati recenti (ultimi 30gg):
${recentLines.join('\n') || '  nessuna gara recente'}`);
    }

    // ── Statistiche categoria (vittorie, punti) ───────────────────────────────
    const catBlocks = [];
    const catsToShow = matchedCats.length > 0 ? matchedCats : [];
    for (const catCode of catsToShow) {
      const catRes = results.filter(r => getCatCode(r) === catCode);
      if (!catRes.length) continue;
      // Vittorie
      const winsMap = {};
      for (const r of catRes) {
        if (Number(r.posizione) !== 1 || !r.atleta_id) continue;
        if (!winsMap[r.atleta_id]) winsMap[r.atleta_id] = { nome: `${r.cognome} ${r.nome}`, team: r.team||'', wins: 0, podiums: 0 };
        winsMap[r.atleta_id].wins++;
      }
      for (const r of catRes) {
        if (Number(r.posizione) > 3 || !r.atleta_id || !winsMap[r.atleta_id]) continue;
        winsMap[r.atleta_id].podiums++;
      }
      const topWinners = Object.values(winsMap).sort((a,b)=>b.wins-a.wins).slice(0,10);
      // Punti (classifica)
      const ptsMap = {};
      for (const r of catRes) {
        if (!r.atleta_id) continue;
        if (!ptsMap[r.atleta_id]) ptsMap[r.atleta_id] = { nome:`${r.cognome} ${r.nome}`, team:r.team||'', pts:0 };
        ptsMap[r.atleta_id].pts += r.punti_effettivi || 0;
      }
      const topPts = Object.values(ptsMap).sort((a,b)=>b.pts-a.pts).slice(0,5);
      catBlocks.push(`CATEGORIA ${catCode}:
Classifica punti: ${topPts.map((a,i)=>`${i+1}. ${a.nome} (${a.team}) ${a.pts}pt`).join(' | ')}
Classifica vittorie: ${topWinners.map((a,i)=>`${i+1}. ${a.nome} (${a.team}) ${a.wins}V`).join(' | ')}`);
    }

    // ── Movers per categoria ──────────────────────────────────────────────────
    function srvRankSnapshot(resSet, catCode, beforeDate) {
      const pts = {};
      for (const r of resSet) {
        if (getCatCode(r) !== catCode || !r.atleta_id || !r.data) continue;
        if (beforeDate && r.data >= beforeDate) continue;
        pts[r.atleta_id] = (pts[r.atleta_id] || 0) + (r.punti_effettivi || 0);
      }
      const rankMap = {};
      Object.entries(pts).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a)
        .forEach(([id],i)=>{ rankMap[id]=i+1; });
      return rankMap;
    }
    function srvComputeMovers(snapNow, snapBefore, resSet, posLimit=30) {
      const names = {};
      for (const r of resSet) {
        if (r.atleta_id && !names[r.atleta_id])
          names[r.atleta_id] = `${r.cognome||''} ${r.nome||''}`.trim() + (r.team ? ` (${r.team})` : '');
      }
      const list = [];
      for (const [aid, posNow] of Object.entries(snapNow)) {
        const posOld = snapBefore[aid];
        if (!posOld || posOld === posNow) continue;
        const gain = posOld - posNow;
        list.push({ aid, name: names[aid]||aid, pos: posNow, gain });
      }
      return {
        up: list.filter(m=>m.gain>=1&&m.pos<=posLimit).sort((a,b)=>b.gain-a.gain).slice(0,5),
        dn: list.filter(m=>m.gain<=-1&&(m.pos-m.gain)<=posLimit).sort((a,b)=>a.gain-b.gain).slice(0,5),
      };
    }
    // Calcola movers per le categorie rilevanti (o ELI_M di default)
    const moversCats = matchedCats.length > 0 ? matchedCats.slice(0, 3) : ['ELI_M','JUN_M'];
    const moversBlocks = [];
    for (const catCode of moversCats) {
      const catRes = results.filter(r => getCatCode(r) === catCode);
      if (catRes.length < 5) continue;
      const lastD = catRes.reduce((mx,r)=>(r.data||'')>mx?r.data:mx,'');
      const snapNow = srvRankSnapshot(catRes, catCode, null);
      const windows = [lastD, 7, 14, 21, 30, 45, 60];
      let best = null;
      for (const w of windows) {
        const cutDate = typeof w === 'string' ? w : (()=>{const d=new Date(lastD||new Date());d.setDate(d.getDate()-w);return d.toISOString().split('T')[0];})();
        const snapBefore = srvRankSnapshot(catRes, catCode, cutDate);
        if (Object.keys(snapBefore).length < 3) continue;
        const mv = srvComputeMovers(snapNow, snapBefore, catRes);
        if (mv.up.length + mv.dn.length >= 1) { best = { mv, cutDate }; break; }
      }
      if (best) {
        const { mv, cutDate } = best;
        const lines = [
          ...mv.up.map(m=>`  ↑ +${m.gain} pos → #${m.pos}: ${m.name}`),
          ...mv.dn.map(m=>`  ↓ ${m.gain} pos → #${m.pos}: ${m.name}`),
        ];
        moversBlocks.push(`MOVERS ${catCode} (vs ${cutDate}):\n${lines.join('\n')}`);
      }
    }

    // ── Raccolta contesto finale (dichiarata qui per usarla anche nel blocco team) ──
    const contextParts = [];

    // ── Dati team ─────────────────────────────────────────────────────────────
    const teamsList = Object.values(teamsRaw);
    let teamBlock = '';
    if (teamsList.length > 0) {
      // Controlla se la domanda menziona un team specifico
      const matchedTeams = teamsList.filter(t => {
        const tNorm = (t.nome || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
        return tNorm.split(/\s+/).some(w => w.length >= 4 && q.includes(w));
      });
      if (matchedTeams.length > 0) {
        teamBlock = matchedTeams.slice(0, 2).map(t => {
          const recentRes = (t.risultati || []).sort((a,b)=>(b.data||'').localeCompare(a.data||'')).slice(0,5);
          const roster = (t.atleti || []).map(id => id.replace(/_/g,' ')).join(', ');
          return `TEAM: ${t.nome}\nPunti totali: ${t.punti_totali||0}\nRoster: ${roster||'—'}\nUltimi risultati:\n${recentRes.map(r=>`  ${r.data} — ${r.nome_gara} → ${r.posizione||'?'}° (${r.atleta_cognome} ${r.atleta_nome})`).join('\n')}`;
        }).join('\n\n');
      } else {
        // Classifica top 10 team sempre disponibile
        const topTeams = teamsList.sort((a,b)=>(b.punti_totali||0)-(a.punti_totali||0)).slice(0,10);
        teamBlock = `TOP TEAM (punti stagione):\n${topTeams.map((t,i)=>`  ${i+1}. ${t.nome} — ${t.punti_totali||0}pt`).join('\n')}`;
      }
      contextParts.push(teamBlock);
    }

    // ── Ultime gare ───────────────────────────────────────────────────────────
    const byGaraLatest = {};
    for (const r of results) {
      if (!r.gara_id) continue;
      if (!byGaraLatest[r.gara_id]) byGaraLatest[r.gara_id] = { data: r.data||'', rows: [] };
      byGaraLatest[r.gara_id].rows.push(r);
    }
    const latestGare = Object.entries(byGaraLatest)
      .sort(([,a],[,b]) => b.data.localeCompare(a.data))
      .slice(0, 5)
      .map(([id, { rows }]) => {
        const sorted = rows.sort((a,b)=>Number(a.posizione)-Number(b.posizione));
        const top3 = sorted.filter(r=>Number(r.posizione)<=3);
        return `${id} (${rows[0]?.data||''}): ${top3.map(r=>`${r.posizione}° ${r.cognome} ${r.nome} (${r.team||''})`).join(', ')}`;
      });

    // ── Gare specifiche nominate nella domanda ────────────────────────────────
    // Mostra tutte le gare trovate (già ordinate per rilevanza); max 5
    const gareBlock = gareInDomanda.map(g =>
      `GARA: ${g.nome} (${g.data}, ${g.hits} parole corrispondenti)\n` +
      g.top5.map(r=>`  ${r.posizione}° ${r.cognome} ${r.nome} (${r.team||''})`).join('\n')
    );

    // ── Calendario rilevante ──────────────────────────────────────────────────
    const today = new Date().toISOString().split('T')[0];
    const prossimeGare = calendar.filter(g => g.data >= today).sort((a,b)=>(a.data||'').localeCompare(b.data||'')).slice(0, 5)
      .map(g => `${g.data} — ${g.nome||''} (${g.localita||''})`);

    // ── System prompt finale ──────────────────────────────────────────────────
    if (atletaBlocks.length) contextParts.push(atletaBlocks.join('\n\n'));
    if (catBlocks.length) contextParts.push(catBlocks.join('\n\n'));
    if (gareBlock.length) contextParts.push(gareBlock.join('\n\n'));
    if (moversBlocks.length) contextParts.push(moversBlocks.join('\n\n'));
    contextParts.push(`ULTIME GARE:\n${latestGare.join('\n')}`);
    if (prossimeGare.length) contextParts.push(`PROSSIME GARE:\n${prossimeGare.join('\n')}`);

    // Indica esplicitamente se sono stati trovati dati specifici per la domanda
    const hasAthleteData = atletaBlocks.length > 0;
    const hasRaceData    = gareBlock.length > 0;
    const hasCatData     = catBlocks.length > 0;

    const systemPrompt = `Sei VEZZ, l'assistente AI di ICS (Italia Cycling Stats), esperto di ciclismo agonistico italiano.
Archivio dati: ${dataFrom} → ${dataTo}.

REGOLE — rispettale sempre:
1. Rispondi SOLO in italiano.
2. I dati qui sotto sono la tua fonte di verità. Se trovi dati pertinenti, usali senza esitare.
3. NON dire mai "non ho dati" se nei DATI qui sotto c'è qualcosa di rilevante.
4. Se la domanda è ambigua, mostra i dati più vicini e spiega brevemente il nome corretto.
5. Se vedi la sezione "GARE SIMILI TROVATE", NON dire "non ho dati" — presentala all'utente come lista di opzioni con la frase: "Non ho trovato '[nome cercato]' nell'archivio. Forse intendevi una di queste?" seguita dalla lista numerata delle gare simili.
6. Dì "non ho questi dati" SOLO per cose davvero assenti: notizie esterne, contratti, doping, anni non in archivio.
7. Nella sezione MOVERS trovi chi ha guadagnato/perso posizioni di recente.

STILE DI RISPOSTA — applica sempre questo formato:
- Niente emoji, niente frasi introduttive tipo "Ho trovato la gara che cerchi!" — vai diretto ai dati.
- Per una GARA usa questo schema:
    [Nome gara] — [data] — [categoria]
    1. Cognome Nome (Team)
    2. Cognome Nome (Team)
    3. Cognome Nome (Team)
    4. ...
- Per un ATLETA usa questo schema:
    [Nome Cognome] — [Team] — [Categoria]
    Stagione: X vittorie, Y podi, Z gare
    Ultimi risultati:
    - data: gara → posizione
- Per una CLASSIFICA usa lista numerata senza fronzoli.
- Risposte brevi e precise. Niente ripetizioni. Niente "spero di aver risposto alla tua domanda".

${hasRaceData ? 'ATTENZIONE: dati specifici sulla gara richiesta presenti — presentali come risposta principale.\n' : ''}${hasAthleteData ? 'ATTENZIONE: dati specifici sull\'atleta richiesto presenti — presentali come risposta principale.\n' : ''}${hasCatData ? 'ATTENZIONE: classifiche specifiche per la categoria richiesta presenti — presentale come risposta principale.\n' : ''}
DATI DISPONIBILI:
${contextParts.join('\n\n')}
`;

    // Multi-turn: aggiungi history precedente (max 6 scambi passati)
    const rawHistory = Array.isArray(req.body.history) ? req.body.history : [];
    const safeHistory = rawHistory
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content.trim().slice(0, 600) }));
    const messages = [...safeHistory, { role: 'user', content: question }];

    const msg = await ai.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: systemPrompt,
      messages
    });
    res.json({ answer: msg.content[0].text.trim(), suggestions: _aiSuggestions });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── OG IMAGE DINAMICHE ────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

const _ogCache = new Map(); // key → { buf, ts }
const OG_TTL   = 30 * 60 * 1000; // 30 minuti

function buildOgSvg({ title, subtitle, badge, stats = [], accent = '#e8001d' }) {
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const statsHtml = stats.slice(0, 4).map((s, i) => {
    const x = 60 + i * 270;
    return `<rect x="${x}" y="390" width="240" height="100" rx="12" fill="rgba(255,255,255,0.07)"/>
    <text x="${x+120}" y="440" font-family="Arial,Helvetica,sans-serif" font-size="34" font-weight="bold" fill="white" text-anchor="middle">${esc(s.value)}</text>
    <text x="${x+120}" y="468" font-family="Arial,Helvetica,sans-serif" font-size="16" fill="#94a3b8" text-anchor="middle">${esc(s.label)}</text>`;
  }).join('');
  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="10" height="630" fill="${esc(accent)}"/>
  <rect x="0" y="560" width="1200" height="70" fill="rgba(0,0,0,0.3)"/>
  <text x="60" y="80" font-family="Arial,Helvetica,sans-serif" font-size="22" fill="#64748b" font-weight="600" letter-spacing="2">ICS — ITALIA CYCLING STATS</text>
  ${badge ? `<rect x="60" y="100" width="${Math.min(badge.length*11+24,320)}" height="36" rx="8" fill="${esc(accent)}"/>
  <text x="72" y="123" font-family="Arial,Helvetica,sans-serif" font-size="18" fill="white" font-weight="700">${esc(badge)}</text>` : ''}
  <text x="60" y="${badge ? 230 : 190}" font-family="Arial,Helvetica,sans-serif" font-size="64" font-weight="900" fill="white" dominant-baseline="auto">${esc(title.slice(0, 28))}${title.length > 28 ? '…' : ''}</text>
  <text x="60" y="${badge ? 295 : 255}" font-family="Arial,Helvetica,sans-serif" font-size="34" fill="#94a3b8">${esc(subtitle.slice(0, 55))}${subtitle.length > 55 ? '…' : ''}</text>
  ${statsHtml}
  <text x="60" y="597" font-family="Arial,Helvetica,sans-serif" font-size="20" fill="#e8001d" font-weight="600">italiacyclingstats.com</text>
  <text x="1140" y="597" font-family="Arial,Helvetica,sans-serif" font-size="20" fill="#475569" text-anchor="end">🇮🇹 Ciclismo Italiano</text>
</svg>`;
}

async function renderOgPng(svgStr) {
  try {
    const sharp = require('sharp');
    return await sharp(Buffer.from(svgStr)).png().toBuffer();
  } catch (e) {
    // Se sharp non supporta SVG, restituisci null (fallback al logo statico)
    console.warn('[og-image] sharp SVG error:', e.message);
    return null;
  }
}

app.get('/api/og-image/atleta/:id', async (req, res) => {
  try {
    const atletaId = req.params.id;
    const cacheKey = `atleta_${atletaId}`;
    const cached = _ogCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < OG_TTL) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=1800');
      return res.send(cached.buf);
    }
    const results = readDataJson('results_raw.json') || [];
    const atletaRows = results.filter(r => r.atleta_id === atletaId);
    if (!atletaRows.length) return res.redirect('/assets/og-default.png');
    const a = atletaRows[0];
    const nome = `${a.cognome || ''} ${a.nome || ''}`.trim();
    const team = a.team || '';
    const wins  = atletaRows.filter(r => Number(r.posizione) === 1).length;
    const top3  = atletaRows.filter(r => Number(r.posizione) <= 3).length;
    const races  = new Set(atletaRows.map(r => r.gara_id)).size;
    const svg = buildOgSvg({
      title: nome, subtitle: team,
      badge: a.categoria || '',
      stats: [
        { value: wins,  label: 'Vittorie' },
        { value: top3,  label: 'Podi' },
        { value: races, label: 'Gare' },
      ]
    });
    const buf = await renderOgPng(svg);
    if (!buf) return res.redirect('/assets/og-default.png');
    _ogCache.set(cacheKey, { buf, ts: Date.now() });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.send(buf);
  } catch (e) { res.redirect('/assets/og-default.png'); }
});

app.get('/api/og-image/gara/:id', async (req, res) => {
  try {
    const garaId = decodeURIComponent(req.params.id);
    const cacheKey = `gara_${garaId}`;
    const cached = _ogCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < OG_TTL) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=1800');
      return res.send(cached.buf);
    }
    const results  = readDataJson('results_raw.json') || [];
    const calendar = readDataJson('calendar.json') || [];
    const garaRows = results.filter(r => r.gara_id === garaId).sort((a,b) => Number(a.posizione)-Number(b.posizione));
    const cal      = calendar.find(g => g.id === garaId);
    if (!garaRows.length) return res.redirect('/assets/og-default.png');
    const winner = garaRows.find(r => Number(r.posizione) === 1);
    const title  = cal?.nome || garaId.split('_').slice(0, -2).join(' ');
    const date   = (cal?.data || winner?.data_gara || '').slice(0, 10);
    const svg = buildOgSvg({
      title,
      subtitle: winner ? `🥇 ${winner.cognome} ${winner.nome} — ${winner.team || ''}` : '',
      badge: (cal?.categoria || winner?.categoria || '').replace(/_/g, ' '),
      stats: garaRows.slice(0, 3).map(r => ({ value: `${r.posizione}°`, label: `${r.cognome} ${r.nome}`.trim().slice(0,16) })),
    });
    const buf = await renderOgPng(svg);
    if (!buf) return res.redirect('/assets/og-default.png');
    _ogCache.set(cacheKey, { buf, ts: Date.now() });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.send(buf);
  } catch (e) { res.redirect('/assets/og-default.png'); }
});

app.get('/api/og-image/team/:id', async (req, res) => {
  try {
    const teamId = decodeURIComponent(req.params.id);
    const cacheKey = `team_${teamId}`;
    const cached = _ogCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < OG_TTL) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=1800');
      return res.send(cached.buf);
    }
    const results  = readDataJson('results_raw.json') || [];
    const teamRows = results.filter(r => (r.team || '') === teamId);
    if (!teamRows.length) return res.redirect('/assets/og-default.png');
    const wins  = teamRows.filter(r => Number(r.posizione) === 1).length;
    const top3  = teamRows.filter(r => Number(r.posizione) <= 3).length;
    const races = new Set(teamRows.map(r => r.gara_id)).size;
    const riders = new Set(teamRows.map(r => r.atleta_id)).size;
    const svg = buildOgSvg({
      title: teamId.length > 28 ? teamId.slice(0,27)+'…' : teamId,
      subtitle: 'Team · Ciclismo Italiano',
      badge: 'TEAM',
      stats: [
        { value: wins,  label: 'Vittorie' },
        { value: top3,  label: 'Podi' },
        { value: races, label: 'Gare' },
        { value: riders, label: 'Corridori' },
      ]
    });
    const buf = await renderOgPng(svg);
    if (!buf) return res.redirect('/assets/og-default.png');
    _ogCache.set(cacheKey, { buf, ts: Date.now() });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.send(buf);
  } catch (e) { res.redirect('/assets/og-default.png'); }
});

init()
  .then(async () => {
    await ensureScraperMediaProfiles();
    // Prima sync dopo 2 minuti dal boot (Render si sveglia), poi ogni 30 minuti
    const SYNC_INTERVAL = 30 * 60 * 1000;
    setTimeout(() => {
      autoXpixSync();
      autoYoutubeSync();
      autoICSync();
      setInterval(autoXpixSync, SYNC_INTERVAL);
      setInterval(autoYoutubeSync, SYNC_INTERVAL);
      setInterval(autoICSync, SYNC_INTERVAL);
    }, 2 * 60 * 1000);
    app.listen(PORT, () => {
      console.log(`[server] ItaliacritAuth in ascolto su http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('[fatal] Impossibile connettersi al database:', err.message);
    process.exit(1);
  });
