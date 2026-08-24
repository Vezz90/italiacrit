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
const { OAuth2Client } = require('google-auth-library');
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
      // Senza questi, una connessione SMTP bloccata (porta filtrata dal
      // provider di hosting, host irraggiungibile) può restare appesa per
      // minuti prima di fallire — con l'invio email ora in background (vedi
      // forgot-password) non blocca più le risposte HTTP, ma vogliamo comunque
      // un fallimento rapido e chiaro nei log invece che silenzioso e lento.
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
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

// Render (come molti host cloud) blocca in uscita le connessioni SMTP dirette
// (porte 25/465/587) per anti-abuso — nodemailer va sempre in ETIMEDOUT anche
// con credenziali corrette. Brevo (via API HTTPS, porta 443, mai bloccata) è
// il percorso primario; nodemailer/SMTP resta come fallback se configurato.
async function _sendViaBrevo({ to, subject, html, text }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { ok: false, skipped: true };
  const senderEmail = process.env.BREVO_SENDER_EMAIL || process.env.SMTP_USER || 'italiacyclingstats@gmail.com';
  const senderName  = process.env.BREVO_SENDER_NAME || 'ItaliacritResultati';
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(body.message || `Brevo HTTP ${r.status}`);
    err.code = body.code || r.status;
    throw err;
  }
  return { ok: true, messageId: body.messageId };
}

async function sendEmail({ to, subject, html, text }) {
  if (process.env.BREVO_API_KEY) {
    try {
      await _sendViaBrevo({ to, subject, html, text });
      console.log('[email] ✓ (Brevo)', subject, '→', to);
      return;
    } catch (e) {
      console.error('[email] ✗ (Brevo)', e.message);
      return;
    }
  }
  if (!_transporter) return;
  const from = process.env.SMTP_FROM || `"ItaliacritResultati" <${process.env.SMTP_USER}>`;
  try {
    await _transporter.sendMail({ from, to, subject, html, text });
    console.log('[email] ✓ (SMTP)', subject, '→', to);
  } catch (e) {
    console.error('[email] ✗ (SMTP)', e.message);
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

// ── Google Sign-In ───────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
async function verifyGoogleCredential(credential) {
  if (!googleClient) throw new Error('Login con Google non configurato sul server');
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  return { googleId: payload.sub, email: payload.email, name: payload.name || '' };
}

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

// Marchia il credit direttamente nel file (angolo in basso a destra,
// dimensione proporzionale alla larghezza della foto) — così anche scaricando
// la foto (tasto destro, screenshot, salvataggio diretto dell'URL) il credit
// resta impresso, non solo mostrato a schermo sopra l'immagine.
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

async function savePhoto(req, file, watermarkText) {
  const ext      = path.extname(file.originalname).toLowerCase() || '.jpg';
  const filename = makeFilename(req, ext);
  const buf = watermarkText ? await _watermarkPhoto(file.buffer, watermarkText) : file.buffer;
  if (supabase) {
    const { error } = await supabase.storage.from('photos').upload(filename, buf, { contentType: file.mimetype, upsert: true });
    if (error) throw new Error(error.message);
  } else {
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), buf || fs.readFileSync(file.path));
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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/photos', express.static(UPLOADS_DIR));

// ── Sitemap.xml ───────────────────────────────────────────────────────────────
// DEVE stare prima di express.static (sotto): la cartella statica servita
// contiene anche un vecchio sitemap.xml a 1 sola voce (root del repo) — se
// questa route fosse dopo, express.static lo troverebbe e lo servirebbe
// direttamente, senza mai raggiungere l'handler dinamico qui sotto.
app.get('/sitemap.xml', async (req, res) => {
  try {
    const CANONICAL = 'https://italiacyclingstats.com';
    const [athletes, resultsRaw, teams] = await Promise.all([
      readDataJsonFromGH('athletes.json'),
      readDataJsonFromGH('results_raw.json'),
      readDataJsonFromGH('teams.json'),
    ]);
    // URL puliti (niente #, invisibile a Google/mai indicizzabile come pagina
    // distinta) e pagine vere del sito (non le /og/... bot-only, che hanno il
    // proprio canonical puntato qui e non vanno duplicate nel sitemap).
    const urls = [
      { loc: `${CANONICAL}/`,              priority: '1.0', changefreq: 'daily' },
      { loc: `${CANONICAL}/risultati`,     priority: '0.9', changefreq: 'daily' },
      { loc: `${CANONICAL}/classifica`,    priority: '0.8', changefreq: 'weekly' },
      { loc: `${CANONICAL}/calendario`,    priority: '0.7', changefreq: 'weekly' },
      { loc: `${CANONICAL}/atleti`,        priority: '0.7', changefreq: 'weekly' },
      { loc: `${CANONICAL}/albo`,          priority: '0.6', changefreq: 'monthly' },
    ];
    for (const id of Object.keys(athletes || {})) {
      if (id) urls.push({ loc: `${CANONICAL}/atleta/${encodeURIComponent(id)}`, priority: '0.7', changefreq: 'weekly' });
    }
    const garaIds = [...new Set((resultsRaw || []).map(r => r.gara_id).filter(Boolean))];
    for (const gid of garaIds) {
      urls.push({ loc: `${CANONICAL}/gara/${encodeURIComponent(gid)}`, priority: '0.6', changefreq: 'monthly' });
    }
    for (const id of Object.keys(teams || {})) {
      if (id) urls.push({ loc: `${CANONICAL}/team/${encodeURIComponent(id)}`, priority: '0.6', changefreq: 'weekly' });
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
const SITE_URL       = 'https://italiacyclingstats.com';
const SUPABASE_PUB   = 'https://aqqsstsbgpapzoxllosh.supabase.co/storage/v1/object/public';
const DEFAULT_OG_IMG = `${SITE_URL}/assets/og-default.png`;
// Bump ad ogni modifica alla generazione della grafica OG (buildGaraResultOverlaySvg,
// _ogCropPosition, ecc.): Facebook cache i byte dell'immagine per URL separatamente
// dai meta tag, e "Scrape Again" sul debugger a volte aggiorna solo i secondi —
// un parametro di versione nell'URL costringe Facebook a trattarla come nuova.
const OG_IMG_VERSION = 8;

function readDataJson(file) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); }
  catch { return null; }
}

// Cache per i file letti da GitHub Pages (fonte di verità uguale al frontend).
// Aggiornamento automatico ogni 30 minuti; fallback al file locale in caso di errore.
// (redeploy forzato per svuotare subito la cache dopo il fix genere gare miste)
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

// Foto profilo per una lista di atleti (usato dalla card di condivisione
// gara lato client: mette il volto accanto al nome nei risultati SOLO per
// chi ce l'ha, nessun ritaglio "a buchi" per chi non ce l'ha — max 10 id
// alla volta, quanti ne mostra al massimo una card). Risponde solo con gli
// id che hanno davvero una foto, non con null espliciti.
app.get('/api/athlete-photos', async (req, res) => {
  try {
    const ids = String(req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 10);
    if (!ids.length) return res.json({});
    const entries = await Promise.all(ids.map(async id => [id, await getEntityPhoto('atleta', id)]));
    const out = {};
    for (const [id, url] of entries) if (url) out[id] = url;
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Escape HTML condiviso — usato sia da ogHtml sia dai chiamanti che
// costruiscono bodyHtml (tabelle risultati/roster) prima di passarlo qui.
function _ogHtmlEsc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}

// Etichette leggibili per i codici categoria — condivise tra /og/atleta e /og/team.
const _OG_CAT_MAP = {ELI_M:'Elite',ELI_F:'Elite Donne',JUN_M:'Juniores',JUN_F:'Juniores Donne',AL_M:'Allievi',AL_F:'Allieve',ES1_M:'Esordienti 1°',ES2_M:'Esordienti 2°',ES1_F:'Esordienti 1° Donne',ES2_F:'Esordienti 2° Donne'};

// Bot che devono vedere il contenuto grezzo di /og/... con i meta tag (non
// eseguono JavaScript, quindi la SPA vera per loro sarebbe vuota): bot di
// anteprima social + motori di ricerca. Un utente vero con un browser reale
// NON deve mai vedere questa pagina "di servizio" — viene rediretto subito
// alla SPA completa (vedi il controllo in cima a ciascuna route /og/...).
// Googlebot va incluso qui (non solo i bot social): ESEGUE JavaScript, quindi
// se non fosse in questa lista verrebbe rediretto come un utente vero e
// finirebbe per indicizzare la shell SPA vuota invece di questo contenuto
// reale — esattamente il problema che il redirect automatico rimosso in
// passato causava (vedi commento in ogHtml).
const OG_BOT_RE = /facebookexternalhit|Facebot|WhatsApp|TelegramBot|Twitterbot|Slackbot|LinkedInBot|Discordbot|SkypeUriPreview|Pinterest|vkShare|redditbot|W3C_Validator|Googlebot|bingbot|DuckDuckBot|YandexBot|Baiduspider|Applebot|ia_archiver|SemrushBot|AhrefsBot|MJ12bot|Sogou|Exabot/i;

function ogHtml({ title, desc, img, redirect, canonical, bodyHtml }) {
  const safe = _ogHtmlEsc;
  // og:url NON deve puntare all'URL con hash (#/gara/...) della SPA: il
  // crawler di Facebook lo "segue" per canonicalizzare, ma essendo un hash il
  // server riceve solo il dominio nudo (GitHub Pages è statico, l'hash non
  // arriva mai al server) e finisce per sovrascrivere titolo/immagine/
  // descrizione già recuperati con quelli generici della home — confermato
  // con il Debugger di condivisione di Facebook (mostra un secondo hop del
  // redirect verso "/" nel "percorso di reindirizzamento"). og:url punta
  // quindi a questa stessa pagina /og/... (che il crawler ha già scaricato
  // con i dati giusti).
  //
  // NIENTE PIÙ redirect JS automatico: prima questa pagina faceva subito
  // window.location.replace(redirect) verso l'hash della SPA — ma Googlebot
  // ESEGUE JavaScript, quindi lo seguiva anche lui e finiva per indicizzare
  // la pagina hash (vuota finché l'app non carica i dati) invece di questo
  // contenuto reale. Ora la pagina resta così com'è (contenuto vero,
  // indicizzabile) e offre un pulsante esplicito per aprire l'app completa —
  // i bot social (Facebook/Twitter/WhatsApp) non eseguivano comunque JS,
  // quindi per loro il comportamento non cambia: leggono solo i meta tag.
  return `<!DOCTYPE html><html lang="it"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="ItaliacritResultati"/>
<meta property="og:title" content="${safe(title)}"/>
<meta property="og:description" content="${safe(desc)}"/>
<meta property="og:url" content="${safe(canonical||redirect)}"/>
<meta property="og:image" content="${safe(img||DEFAULT_OG_IMG)}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${safe(title)}"/>
<meta name="twitter:description" content="${safe(desc)}"/>
<meta name="twitter:image" content="${safe(img||DEFAULT_OG_IMG)}"/>
<link rel="canonical" href="${safe(canonical||redirect)}"/>
<title>${safe(title)}</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;margin:0 auto;padding:28px 16px 60px;background:#0f172a;color:#f1f5f9}
  h1{font-size:1.4rem;margin:0 0 4px}
  .og-sub{color:#94a3b8;font-size:.9rem;margin-bottom:22px}
  table{width:100%;border-collapse:collapse;font-size:.9rem}
  th,td{padding:8px 6px;text-align:left;border-bottom:1px solid #1e293b}
  th{color:#94a3b8;font-weight:600;font-size:.75rem;text-transform:uppercase;letter-spacing:.03em}
  .og-cta{display:inline-block;margin-top:28px;padding:12px 22px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-weight:600}
</style>
</head><body>
<h1>${safe(title)}</h1>
${desc ? `<div class="og-sub">${safe(desc)}</div>` : ''}
${bodyHtml || ''}
<a class="og-cta" href="${safe(redirect)}">Apri nell'app completa →</a>
</body></html>`;
}

// Dominio pubblico per le immagini OG: serve /og e /api/og-image via Cloudflare → Render,
// così il link condiviso e l'immagine sono sul dominio reale (non onrender).
const API_BASE_URL = 'https://italiacyclingstats.com';

// Hash deterministico stringa→intero: stesso seed = stessa scelta, seed
// diverso = frase diversa. Usato per variare la narrazione del podio senza
// renderla sempre identica (che la farebbe sembrare generata da un
// template fisso), ma restando STABILE per lo stesso post — un crawler che
// ripassa sulla stessa gara vede sempre la stessa frase, solo gare/atleti
// diversi ne vedono varianti diverse.
function _ogSeedPick(arr, seed) {
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

// Vittorie e podi di un atleta nella propria categoria/genere fino a (e
// inclusa) una certa data — usato per raccontare il traguardo raggiunto
// (es. "5ª vittoria stagionale") invece del solo piazzamento della gara.
function _ogSeasonTally(resultsRaw, atleta_id, genere, uptoDate) {
  let wins = 0, podiums = 0;
  for (const r of resultsRaw) {
    if (r.atleta_id !== atleta_id || r.genere !== genere) continue;
    if ((r.data || '') > uptoDate) continue;
    const pos = Number(r.posizione);
    if (pos === 1) wins++;
    if (pos >= 1 && pos <= 3) podiums++;
  }
  return { wins, podiums };
}

// Stessa cosa ma per risultati "a squadre" (es. Campionati Italiani a
// Squadre Cronometro): lo scraper salva queste righe SENZA atleta_id/
// cognome/nome (il risultato è del team, non del singolo corridore), quindi
// _ogSeasonTally sopra (che filtra per atleta_id) non le troverebbe mai —
// le vittorie a squadre restavano invisibili nel testo di condivisione.
// Filtra solo righe altrettanto "a squadre" (atleta_id vuoto) per non
// mischiare le vittorie del club stesso ottenute dai singoli corridori.
function _ogSeasonTallyTeam(resultsRaw, team_id, genere, uptoDate) {
  let wins = 0, podiums = 0;
  for (const r of resultsRaw) {
    if (r.atleta_id || r.team_id !== team_id || r.genere !== genere) continue;
    if ((r.data || '') > uptoDate) continue;
    const pos = Number(r.posizione);
    if (pos === 1) wins++;
    if (pos >= 1 && pos <= 3) podiums++;
  }
  return { wins, podiums };
}

const _OG_WIN_PHRASES_1 = [
  '{n} centra la prima vittoria stagionale',
  "Prima vittoria dell'anno per {n}",
  '{n} apre il proprio bottino stagionale',
];
const _OG_WIN_PHRASES_N = [
  '{k}ª vittoria stagionale per {n}',
  "{n} centra il {k}° successo dell'anno",
  '{n} allunga: {k}ª vittoria in stagione',
  'Per {n} è già la {k}ª vittoria stagionale',
];
const _OG_POD_PHRASES_1 = [
  'primo podio stagionale per {n}',
  "{n} conquista il primo podio dell'anno",
];
const _OG_POD_PHRASES_N = [
  '{k}° podio stagionale per {n}',
  '{n} sale sul podio per la {k}ª volta in stagione',
];
function _ogWinnerLine(nome, wins, seed) {
  const tpl = _ogSeedPick(wins <= 1 ? _OG_WIN_PHRASES_1 : _OG_WIN_PHRASES_N, seed);
  return tpl.replace('{n}', nome).replace('{k}', String(wins));
}
function _ogPodiumLine(nome, podiums, seed) {
  const tpl = _ogSeedPick(podiums <= 1 ? _OG_POD_PHRASES_1 : _OG_POD_PHRASES_N, seed);
  return tpl.replace('{n}', nome).replace('{k}', String(podiums));
}

// Narrazione dinamica su vincitore + 2°/3° classificato, basata sui dati
// stagionali reali (vittorie/podi ottenuti finora, questa gara inclusa) —
// non un commento statico ("Vince X") ma una frase diversa a seconda del
// traguardo raggiunto (prima vittoria, 5ª vittoria, primo podio, ecc.), con
// più varianti di formulazione scelte in modo deterministico per gara
// (_ogSeedPick): stessa gara → stessa frase se ricondivisa, gare diverse →
// frasi diverse, così non sembra un testo generato da un template fisso.
// Condivisa tra /og/gara/:id (meta tag per i crawler) e
// /api/admin/gara-share-text/:id (testo copiabile per il post FB manuale).
function _buildGaraNarrative(id, cal, resultsRaw) {
  const results  = (resultsRaw || []).filter(r => r.gara_id === id).sort((a,b) => a.posizione - b.posizione);
  const raceName = cal?.nome || id.replace(/_\d{4}-\d{2}-\d{2}.*$/, '').replace(/_/g,' ');
  const raceDate = results[0]?.data || cal?.data || '';
  const date     = cal?.data ? new Date(cal.data).toLocaleDateString('it-IT',{day:'numeric',month:'long',year:'numeric'}) : '';
  // Risultato "a squadre" (es. Campionati Italiani a Squadre Cronometro):
  // niente cognome/nome, solo team — evita "1°  (NOME TEAM)" con lo spazio
  // vuoto del nome atleta mancante.
  const _resultLabel = (r) => (r.cognome || r.nome) ? `${r.cognome} ${r.nome}`.trim() : (r.team || '');
  const top3     = results.slice(0,3).map((r,i)=>`${i+1}° ${_resultLabel(r)}${r.team && (r.cognome||r.nome) ? ` (${r.team})` : ''}`).join(' · ');
  const luogo    = cal?.luogo || cal?.regione || '';

  const winner = results[0], second = results[1], third = results[2];
  const podiumLines = [];
  let winnerTitleTail = '';
  if (winner?.atleta_id || (winner && (winner.team_id || winner.team))) {
    const isTeamResult = !winner.atleta_id;
    const { wins } = isTeamResult
      ? _ogSeasonTallyTeam(resultsRaw || [], winner.team_id, winner.genere, raceDate)
      : _ogSeasonTally(resultsRaw || [], winner.atleta_id, winner.genere, raceDate);
    const winnerName = isTeamResult ? (winner.team || winner.team_id) : `${winner.cognome} ${winner.nome}`;
    podiumLines.push(_ogWinnerLine(winnerName, wins, id + '_1') + '.');
    winnerTitleTail = _ogSeedPick(wins <= 1 ? [
      `Vince ${winnerName}`,
      `${winnerName} si impone`,
      `Successo di ${winnerName}`,
      `${winnerName} conquista la vittoria`,
    ] : [
      `Vince ${winnerName} (${wins}ª stagionale)`,
      `${winnerName} centra il ${wins}° successo dell'anno`,
      `${wins}ª vittoria stagionale per ${winnerName}`,
      `${winnerName} allunga: ${wins}ª vittoria in stagione`,
    ], id + '_t');
  }
  if (second?.atleta_id || (second && (second.team_id || second.team))) {
    const isTeamResult = !second.atleta_id;
    const { podiums } = isTeamResult
      ? _ogSeasonTallyTeam(resultsRaw || [], second.team_id, second.genere, raceDate)
      : _ogSeasonTally(resultsRaw || [], second.atleta_id, second.genere, raceDate);
    podiumLines.push(_ogPodiumLine(isTeamResult ? (second.team || second.team_id) : `${second.cognome} ${second.nome}`, podiums, id + '_2') + '.');
  }
  if (third?.atleta_id || (third && (third.team_id || third.team))) {
    const isTeamResult = !third.atleta_id;
    const { podiums } = isTeamResult
      ? _ogSeasonTallyTeam(resultsRaw || [], third.team_id, third.genere, raceDate)
      : _ogSeasonTally(resultsRaw || [], third.atleta_id, third.genere, raceDate);
    podiumLines.push(_ogPodiumLine(isTeamResult ? (third.team || third.team_id) : `${third.cognome} ${third.nome}`, podiums, id + '_3') + '.');
  }

  // Facebook (verificato con post reali pubblicati) non mostra MAI la
  // descrizione per questo tipo di condivisione — né in anteprima né nel post
  // finale — solo dominio + titolo. Per questo il vincitore va anche nel
  // TITOLO stesso, l'unico campo che Facebook mostra sempre in modo
  // affidabile, non solo nella descrizione (comunque generata per gli altri
  // canali/anteprime che invece la mostrano, es. WhatsApp, Twitter).
  //
  // Il nome gara va SEMPRE per primo (è il termine che le persone cercano
  // davvero, non la frase sul vincitore) e il titolo intero deve restare
  // sotto ~60 caratteri: oltre quella soglia Google riscrive spesso il
  // <title> per conto suo nei risultati di ricerca, e l'abbiamo visto scegliere
  // di tenere SOLO la seconda metà (la narrazione), buttando via il nome
  // gara — il contrario di quello che vogliamo per l'indicizzazione. Prova
  // in cascata: narrazione intera → "Vince X" breve → solo nome gara,
  // fermandosi alla prima che rientra nel limite.
  const TITLE_MAX = 60;
  let title = raceName;
  if (winner) {
    const longTitle  = `${raceName} - ${winnerTitleTail}`;
    const shortTitle = `${raceName} - Vince ${winner.cognome} ${winner.nome}`;
    if (longTitle.length <= TITLE_MAX) title = longTitle;
    else if (shortTitle.length <= TITLE_MAX) title = shortTitle;
    else title = raceName;
  }
  const desc = [date, luogo, top3, podiumLines.join(' ')].filter(Boolean).join(' — ');
  return { results, raceName, raceDate, date, luogo, top3, podiumLines, title, desc };
}

app.get('/og/gara/:id', async (req, res) => {
  const id  = req.params.id;
  // Un utente vero (non un bot) che apre questo URL — tipicamente cliccando
  // l'anteprima di un link condiviso — deve arrivare subito alla pagina vera
  // del sito, non a questa versione "di servizio" pensata solo per i bot.
  if (!OG_BOT_RE.test(req.headers['user-agent'] || '')) {
    return res.redirect(302, `${SITE_URL}/gara/${encodeURIComponent(id)}`);
  }
  const [calRaw, resultsRaw] = await Promise.all([
    readDataJsonFromGH('calendar.json'),
    readDataJsonFromGH('results_raw.json'),
  ]);
  // Il calendario usa l'id SENZA suffisso categoria/genere (es. "..._2026-07-05"),
  // mentre il gara_id reale scrapato di solito ce l'ha ("..._2026-07-05_ELI_M");
  // condividendo dalla pagina di una gara già scrapata l'id nell'URL è quello
  // suffissato, che non troverebbe mai corrispondenza esatta nel calendario —
  // titolo/data/luogo restavano vuoti e si vedeva l'id grezzo come titolo.
  const cal = (calRaw || []).find(g => g.id === id)
    || (calRaw || []).find(g => g.id === id.replace(/_[A-Z0-9]+_[MF]$/, ''));
  const { results, title, desc } = _buildGaraNarrative(id, cal, resultsRaw);
  // Inoltra la regolazione manuale foto (se presente in questo stesso URL,
  // vedi window.shareOnFacebook in app.js) all'URL dell'immagine — è questo
  // il campo che Facebook legge davvero per l'anteprima.
  const adjustQS = ['s', 'ox', 'oy']
    .filter(k => req.query[k] != null)
    .map(k => `&${k}=${encodeURIComponent(req.query[k])}`).join('');
  const img     = `${API_BASE_URL}/api/og-image/gara/${encodeURIComponent(id)}?v=${OG_IMG_VERSION}${adjustQS}`;
  const redirect = `${SITE_URL}/gara/${encodeURIComponent(id)}`;
  // Canonical sulla pagina pulita reale (indicizzabile da quando esiste il
  // router URL puliti, vedi commento in ogHtml) invece che su questa stessa
  // pagina bot-only: senza, Google indicizzava/mostrava in ricerca l'URL
  // spoglio /og/gara/... al posto della vera app.
  const canonical = redirect;
  // Tabella con TUTTA la classifica (non solo il podio) — contenuto reale e
  // indicizzabile, non solo meta tag: è la parte che rende questa pagina
  // utile a Google oltre che ai crawler social.
  const bodyHtml = results.length ? `<table>
    <thead><tr><th>Pos</th><th>Atleta</th><th>Team</th><th>Punti</th></tr></thead>
    <tbody>${results.map(r => `<tr>
      <td>${_ogHtmlEsc(r.posizione ?? '')}°</td>
      <td>${_ogHtmlEsc(r.cognome)} ${_ogHtmlEsc(r.nome)}</td>
      <td>${_ogHtmlEsc(r.team || '')}</td>
      <td>${_ogHtmlEsc(r.punti_effettivi ?? 0)}</td>
    </tr>`).join('')}</tbody>
  </table>` : '';
  res.setHeader('Content-Type','text/html');
  res.send(ogHtml({ title, desc, img, redirect, canonical, bodyHtml }));
});

// Testo pronto da incollare a mano nel post Facebook: Facebook non permette
// di precompilare il corpo del post via URL (solo il link, che genera lui
// stesso l'anteprima), quindi qui prepariamo lo stesso tipo di narrazione
// dinamica usata per i meta tag — l'admin lo copia e lo incolla nella
// finestra "Crea post" sopra alla grafica già generata.
// Credit del fotografo della foto che accompagna la condivisione — stessa
// priorità/alias usati da /api/og-image/gara/:id per scegliere la copertina,
// così il credit corrisponde SEMPRE alla foto che si vede nell'anteprima.
// Condividere una foto (specie di terzi, es. xpix.it) senza credit espone a
// contestazioni: qui viene sempre incluso quando disponibile.
async function _photoCreditFor(garaId) {
  const uploaded = await queries.getApprovedRacePhotos(garaId).catch(() => []);
  if (uploaded && uploaded.length && uploaded[0].photographer) return uploaded[0].photographer;
  const aliases = [garaId, garaId.replace(/^\d+_/, ''), garaId.replace(/_[A-Z0-9]+_[MF]$/, '')];
  const [xpix, ic] = await Promise.all([readXpixPhotos(), readICPhotos()]);
  for (const alias of aliases) if (xpix[alias]) return 'xpix.it';
  for (const alias of aliases) if (ic[alias]) return 'ciclismo.info';
  return null;
}

// Testo lungo "in stile Gazzetta" generato da Claude (titolo a effetto,
// racconto della corsa con km/media/distacchi, podio, hashtag) — molto più
// ricco della narrazione a template sopra, che resta come fallback se
// l'AI non è configurata o fallisce. Persistito su Postgres (tabella
// gara_narratives, vedi sotto _generateAndStoreGaraNarrative) invece che in
// una cache in memoria: sopravvive ai redeploy ed è la stessa copia usata
// anche dalla pagina gara pubblica, non generata due volte separatamente.

// Le correzioni manuali (pannello admin: posizione/genere/categoria di un
// singolo risultato, campi di una gara, gare escluse) vivono in Supabase e
// NON sono nel JSON statico results_raw.json scrapato dalla FCI — il
// frontend le applica sempre (vedi applyRisultatoCorrections/
// applyGaraCorrections in app.js) prima di calcolare classifiche o
// conteggi vittorie/podi. Qui replichiamo la stessa cosa lato server:
// senza, un risultato corretto a mano (es. una vittoria assegnata dopo un
// reclamo) restava invisibile al testo generato, facendo sballare il
// conteggio "vittorie stagionali" mostrato all'utente.
let _corrCacheTs = 0, _corrCache = null;
const _CORR_TTL = 5 * 60 * 1000;
async function _getResultCorrections() {
  if (_corrCache && (Date.now() - _corrCacheTs) < _CORR_TTL) return _corrCache;
  const [garaRes, risRes, excRes] = await Promise.all([
    supabase.from('gara_overrides').select('gara_id, field, new_value').in('field', GARA_EDITABLE_FIELDS),
    supabase.from('risultato_overrides').select('risultato_key, field, new_value').in('field', RISULTATO_EDITABLE_FIELDS),
    supabase.from('gara_overrides').select('gara_id').eq('field', 'excluded').eq('new_value', 'true'),
  ]);
  const garaCorrections = {};
  for (const r of (garaRes.data || [])) { (garaCorrections[r.gara_id] ||= {})[r.field] = r.new_value; }
  const risultatoCorrections = {};
  for (const r of (risRes.data || [])) { (risultatoCorrections[r.risultato_key] ||= {})[r.field] = r.new_value; }
  const excludedIds = new Set((excRes.data || []).map(r => r.gara_id));
  _corrCache = { garaCorrections, risultatoCorrections, excludedIds };
  _corrCacheTs = Date.now();
  return _corrCache;
}
const _CORR_FIELD_ALIASES = { nome: ['nome_gara', 'gara'], cat: ['categoria', 'cat'] };
function _applyCorrectionsToRow(row, fields) {
  for (const [field, value] of Object.entries(fields)) {
    const targets = _CORR_FIELD_ALIASES[field] || [field];
    for (const t of targets) if (t in row) row[t] = value;
  }
}
// Ritorna una COPIA corretta/filtrata di resultsRaw — mai muta l'array
// originale, che è condiviso e cachato 30min da readDataJsonFromGH tra
// tutte le richieste (mutarlo corromperebbe silenziosamente altri endpoint).
function _applyResultCorrections(resultsRaw, corr) {
  const out = [];
  for (const r0 of (resultsRaw || [])) {
    if (corr.excludedIds.has(r0.gara_id)) continue;
    const r = { ...r0 };
    const gc = corr.garaCorrections[r.gara_id];
    if (gc) _applyCorrectionsToRow(r, gc);
    const rc = corr.risultatoCorrections[`${r.atleta_id}|${r.data}`];
    if (rc) _applyCorrectionsToRow(r, rc);
    out.push(r);
  }
  return out;
}

// Risultati inseriti a mano da un admin (tabella Postgres manual_results —
// es. Campionati Italiani a Squadre Cronometro o gare non coperte dallo
// scraper FCI) NON sono nel JSON statico results_raw.json e vivevano finora
// solo nel merge lato frontend (_mergeManualIntoRaw in app.js): un atleta
// con una vittoria inserita così risultava sistematicamente sottostimato
// di quella vittoria nel testo AI. Stessa identica logica di merge/dedupe
// (per gara_id+posizione) replicata qui lato server.
async function _mergeManualResultsIntoRaw(resultsRaw) {
  try {
    const manualRows = await queries.getAllManualResults();
    if (!manualRows || !manualRows.length) return resultsRaw;
    const realKeys = new Set((resultsRaw || []).filter(r => r.atleta_id && r.data).map(r => `${r.atleta_id}|${r.data}`));
    const active = manualRows.filter(r => !(r.atleta_id && r.data && realKeys.has(`${r.atleta_id}|${r.data}`)));
    if (!active.length) return resultsRaw;
    const byKey = new Set(active.map(r => `${r.gara_id}|${r.posizione}`));
    const merged = (resultsRaw || []).filter(r => !byKey.has(`${r.gara_id}|${r.posizione}`));
    for (const r of active) {
      merged.push({
        gara_id: r.gara_id, nome_gara: r.nome_gara || '', data: r.data || '',
        categoria: r.categoria || '', genere: r.genere || '', tipo: r.tipo || 'regionale',
        moltiplicatore: r.moltiplicatore || 1,
        campionato_regionale: !!r.campionato_regionale, campionato_italiano: !!r.campionato_italiano,
        regione: r.regione || '', posizione: r.posizione, cognome: r.cognome, nome: r.nome || '',
        atleta_id: r.atleta_id, team: r.team || '', team_id: r.team_id || '',
        tempo: r.tempo || '', km: r.km || '', media: r.media || '',
        punti_base: r.punti_base || 0, punti_effettivi: r.punti_effettivi || 0,
      });
    }
    return merged;
  } catch (e) {
    console.warn('[gara-share-text] manual results merge error:', e.message);
    return resultsRaw;
  }
}

async function _buildGaraAiCaption(id, cal, resultsRawIn) {
  const ai = getAnthropic();
  if (!ai) return null;
  const corr = await _getResultCorrections().catch(() => ({ garaCorrections: {}, risultatoCorrections: {}, excludedIds: new Set() }));
  let resultsRaw = _applyResultCorrections(resultsRawIn, corr);
  resultsRaw = await _mergeManualResultsIntoRaw(resultsRaw);
  const results = (resultsRaw || []).filter(r => r.gara_id === id).sort((a, b) => a.posizione - b.posizione);
  if (!results.length) return null;
  const winner = results[0];
  const raceName = cal?.nome || id.replace(/_\d{4}-\d{2}-\d{2}.*$/, '').replace(/_/g, ' ');
  const raceDate = winner?.data || cal?.data || '';
  const date = raceDate ? new Date(raceDate).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const luogo = cal?.luogo || cal?.regione || winner?.regione || '';

  const podio = results.slice(0, 5).map(r => ({
    posizione: r.posizione,
    nome: (r.cognome || r.nome) ? `${r.cognome || ''} ${r.nome || ''}`.trim() : (r.team || ''),
    team: r.team || '',
    distacco: r.posizione === 1 ? null : (r.tempo || null),
  }));

  // Conteggio ufficiale vittorie/podi stagionali (stessa fonte usata dalla
  // narrazione a template, _ogSeasonTally) — include QUESTA gara. Passato
  // esplicito a Claude perché altrimenti tende a contare solo le gare che
  // gli passiamo come esempio (poche, per non sovraccaricare il prompt) e
  // sottostima vistosamente il totale reale (es. "prima vittoria" per un
  // atleta che ne ha già 11 in stagione).
  // TUTTI i risultati stagionali del vincitore (non un campione curato):
  // Claude deve poterli leggere e contare da sé, non fidarsi solo di un
  // riassunto — con un campione ridotto capitava di sottostimare il totale
  // vittorie/podi reale. Il conteggio ufficiale sotto (stagione_vincitore)
  // resta comunque incluso come riferimento definitivo, calcolato dagli
  // stessi dati corretti.
  let stagione_vincitore = null;
  let tutti_i_risultati_stagione_vincitore = [];
  if (winner?.atleta_id) {
    const tally = _ogSeasonTally(resultsRaw || [], winner.atleta_id, winner.genere, raceDate);
    stagione_vincitore = { vittorie_totali_stagione_QUESTA_INCLUSA: tally.wins, podi_totali_stagione_QUESTO_INCLUSO: tally.podiums };
    tutti_i_risultati_stagione_vincitore = (resultsRaw || [])
      .filter(r => r.atleta_id === winner.atleta_id && (r.data || '') <= raceDate)
      .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0))
      .map(r => ({ data: r.data || '', posizione: Number(r.posizione) || null, gara: r.nome_gara || r.gara_id, questa_gara: r.gara_id === id }));
  }
  const compagni_di_squadra_a_podio = winner
    ? results.filter(r => r.posizione > 1 && r.posizione <= 3 && r.team_id === winner.team_id)
        .map(r => `${r.posizione}° ${r.cognome} ${r.nome}`)
    : [];

  // Stesso conteggio ufficiale, ma per i risultati "a squadre" del team del
  // vincitore (podi/vittorie ottenuti dai propri corridori in stagione,
  // stessa fonte del profilo team) — utile per un accenno al buon momento
  // del club, non solo dell'atleta.
  let stagione_team_del_vincitore = null;
  if (winner?.team_id) {
    const teamWins = (resultsRaw || []).filter(r => r.team_id === winner.team_id && r.genere === winner.genere && (r.data || '') <= raceDate && Number(r.posizione) === 1).length;
    const teamPodiums = (resultsRaw || []).filter(r => r.team_id === winner.team_id && r.genere === winner.genere && (r.data || '') <= raceDate && Number(r.posizione) >= 1 && Number(r.posizione) <= 3).length;
    stagione_team_del_vincitore = { vittorie_totali_stagione_squadra_QUESTA_INCLUSA: teamWins, podi_totali_stagione_squadra_QUESTO_INCLUSO: teamPodiums };
  }

  const dataForPrompt = {
    gara: raceName,
    data: date,
    luogo,
    categoria: winner?.categoria || '',
    genere: winner?.genere || '',
    km_percorsi: winner?.km || null,
    media_kmh: winner?.media || null,
    podio,
    team_del_vincitore: winner?.team || '',
    compagni_di_squadra_a_podio,
    stagione_vincitore,
    tutti_i_risultati_stagione_vincitore,
    stagione_team_del_vincitore,
  };

  try {
    const msg = await ai.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      messages: [{
        role: 'user',
        content: `Sei il social media manager di un sito italiano di statistiche di ciclismo amatoriale (italiacyclingstats.com). Scrivi un post per Facebook/Instagram in italiano su questo risultato di ciclismo su strada, con lo stile entusiasta e narrativo tipico della Gazzetta dello Sport.

Struttura richiesta:
1. Un titolo ad effetto con emoji (una riga, maiuscolo o quasi, tipo titolo di giornale sportivo).
2. Uno o due paragrafi che raccontano la corsa: cita km percorsi e media km/h se presenti, i distacchi dei primi classificati se presenti, e se più corridori dello stesso team sono a podio celebra la doppietta/tripletta di squadra.
3. Una riga vuota, poi "📊 Il Podio" seguito da un elenco puntato (emoji numeriche 1️⃣2️⃣3️⃣ ecc.) di posizione, nome, team e distacco.
4. Una riga vuota, poi 8-10 hashtag pertinenti (nomi propri, nome gara senza spazi, #CiclismoDilettanti, #ItaliaCyclingStats ecc.).

Regole importanti sui dati stagionali del vincitore (LEGGI CON ATTENZIONE, è la causa più comune di errore): "tutti_i_risultati_stagione_vincitore" è l'elenco COMPLETO di ogni risultato ottenuto dal vincitore in stagione fino ad oggi compreso (non un campione ridotto) — {data, posizione, gara, questa_gara}. Prima di scrivere qualunque numero di vittorie/podi, CONTA TU STESSO quante righe hanno posizione=1 (vittorie) e quante hanno posizione tra 1 e 3 (podi) in quell'elenco: il totale deve corrispondere esattamente al campo "stagione_vincitore" (vittorie_totali_stagione_QUESTA_INCLUSA / podi_totali_stagione_QUESTO_INCLUSO), che è il conteggio ufficiale di riferimento — se non corrispondono, fidati di "stagione_vincitore". NON limitarti a guardare solo le ultime 3-4 righe dell'elenco: scorrilo tutto. Se il conteggio è 1, è davvero la prima vittoria stagionale — non scrivere mai "prima vittoria" se è maggiore di 1. Per dare colore al racconto puoi citare 1-2 gare specifiche (nome/posizione) prese da "tutti_i_risultati_stagione_vincitore", ma il numero totale citato nel testo deve sempre essere quello ufficiale.

Stesso principio per "stagione_team_del_vincitore": se utile, puoi accennare al buon momento stagionale del team (es. "Nª vittoria stagionale per il team" o "N° podio stagionale"), usando SOLO quei numeri ufficiali, senza inventare classifiche o piazzamenti del team non forniti. Non è obbligatorio menzionarlo se non aggiunge nulla al racconto.

Altre regole: NON inventare dettagli non forniti nei dati (niente percorso, meteo, tattiche, aneddoti inventati). Se non ci sono distacchi non menzionarli. Se "compagni_di_squadra_a_podio" è vuoto non parlare di doppiette di squadra. Scrivi in italiano corretto e scorrevole, senza markdown (no **, no #titoli).

Dati della gara (JSON):
${JSON.stringify(dataForPrompt, null, 2)}`
      }]
    });
    const text = msg.content[0].text.trim();
    // Il link del sito va inserito subito dopo il titolo (prima riga), non
    // lasciato scrivere a Claude: così chi legge il post lo vede sempre,
    // nella stessa posizione, indipendentemente da come il modello formatta
    // il resto — un'istruzione nel prompt rischierebbe di finire persa in
    // fondo al testo o omessa. Link generico al sito (non alla gara
    // specifica): l'obiettivo è portare traffico al sito in generale.
    const lines = text.split('\n');
    lines.splice(1, 0, '', SITE_URL);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  } catch (e) {
    console.warn('[gara-share-text] Claude error:', e.message);
    return null;
  }
}

app.get('/api/admin/gara-share-text/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { cal, resultsRaw } = await _fetchCalAndResultsFor(id);

    // Stessa tabella persistita usata dalla pagina gara pubblica (vedi
    // _generateAndStoreGaraNarrative) — un'unica generazione serve sia il
    // testo copiabile per i social sia il racconto sulla pagina, invece di
    // due cache separate che pagavano due volte la stessa chiamata Claude.
    const forceRegen = req.query.regen === '1';
    const stored = forceRegen ? null : await queries.getGaraNarrative(id).catch(() => null);
    let aiText = stored?.text || null;
    if (!aiText) {
      aiText = await _generateAndStoreGaraNarrative(id).catch(() => null);
    }
    if (aiText) {
      const credit = await _photoCreditFor(id).catch(() => null);
      const text = credit ? `${aiText}\n\n📷 Foto: ${credit}` : aiText;
      return res.json({ text, ai: true });
    }

    // Fallback: narrazione deterministica a template, senza chiamata AI
    // (Claude non configurato, o la generazione è fallita).
    const { raceName, date, luogo, top3, podiumLines } = _buildGaraNarrative(id, cal, resultsRaw);
    const credit = await _photoCreditFor(id).catch(() => null);
    const lines = [
      raceName.toUpperCase(),
      '',
      SITE_URL,
      [date, luogo].filter(Boolean).join(' · '),
      '',
      top3,
      '',
      podiumLines.join(' '),
      credit ? '' : undefined,
      credit ? `📷 Foto: ${credit}` : undefined,
    ].filter(l => l !== undefined && l !== null);
    res.json({ text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), ai: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Il testo AI (_buildGaraAiCaption) è pensato per un post social: titolo,
// link al sito, racconto, podio, hashtag. Sulla pagina gara pubblica il link
// al sito è ridondante (siamo già lì) e gli hashtag stonano in un paragrafo
// di prosa — qui si tolgono entrambi, tenendo titolo/racconto/podio intatti.
function _stripSocialExtrasForPage(text) {
  const lines = (text || '').split('\n').filter(l => {
    const t = l.trim();
    if (t === SITE_URL) return false;
    if (/^#\S+(\s+#\S+)*$/.test(t)) return false; // riga di soli hashtag
    return true;
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function _fetchCalAndResultsFor(id) {
  const [calRaw, resultsRaw] = await Promise.all([
    readDataJsonFromGH('calendar.json'),
    readDataJsonFromGH('results_raw.json'),
  ]);
  const cal = (calRaw || []).find(g => g.id === id)
    || (calRaw || []).find(g => g.id === id.replace(/_[A-Z0-9]+_[MF]$/, ''));
  return { cal, resultsRaw };
}

// Genera (Claude) e persiste (tabella gara_narratives) il racconto di una
// gara — condiviso da: generazione lazy al primo visitatore della pagina
// gara, sweep periodico (vedi _sweepGaraNarratives), backfill storico, e il
// bottone admin "Rigenera" nella modale di condivisione social.
async function _generateAndStoreGaraNarrative(id) {
  const { cal, resultsRaw } = await _fetchCalAndResultsFor(id);
  const text = await _buildGaraAiCaption(id, cal, resultsRaw);
  if (text) await queries.upsertGaraNarrative(id, text);
  return text;
}

// Fire-and-forget: non blocca la richiesta che l'ha innescata (chi visita la
// pagina per primo vede il vecchio testo a template, chi la ricarica poco
// dopo trova già il racconto AI pronto). Guard in memoria per evitare
// generazioni duplicate in parallelo sulla stessa gara.
const _narrativeGenInFlight = new Set();
function _scheduleGaraNarrativeGeneration(id) {
  if (_narrativeGenInFlight.has(id)) return;
  _narrativeGenInFlight.add(id);
  _generateAndStoreGaraNarrative(id)
    .catch(e => console.warn('[gara-narrative] generazione fallita:', id, e.message))
    .finally(() => _narrativeGenInFlight.delete(id));
}

// Ricontrolla periodicamente le gare recenti: i risultati possono ancora
// cambiare nei giorni subito dopo la corsa (correzioni FCI, risultati PCS
// esteri che arrivano in ritardo — vedi _mergeManualResultsIntoRaw), quindi
// un racconto generato subito dopo la gara può restare indietro. Richiamata
// da /api/cron/tick con un throttle proprio; genera/rigenera in un batch
// piccolo per giro per non bruciare in un colpo solo il budget Claude.
const GARA_NARRATIVE_RECENT_WINDOW_DAYS = 14;
const GARA_NARRATIVE_REFRESH_MS = 12 * 60 * 60 * 1000;
async function _sweepGaraNarratives() {
  try {
    const resultsRaw = await readDataJsonFromGH('results_raw.json');
    if (!resultsRaw) return;
    const today = new Date().toISOString().slice(0, 10);
    const cutoffRecent = new Date(Date.now() - GARA_NARRATIVE_RECENT_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
    const dateByGara = new Map();
    for (const r of resultsRaw) {
      if (!r.gara_id || !r.data || r.data > today) continue;
      if (!dateByGara.has(r.gara_id)) dateByGara.set(r.gara_id, r.data);
    }
    const existing = await queries.getAllGaraNarrativeIds().catch(() => []);
    const existingMap = new Map(existing.map(r => [r.gara_id, r.generated_at]));
    const missing = [], staleRecent = [];
    for (const [gid, date] of dateByGara) {
      const gen = existingMap.get(gid);
      if (!gen) { missing.push(gid); continue; }
      if (date >= cutoffRecent && (Date.now() - new Date(gen).getTime()) > GARA_NARRATIVE_REFRESH_MS) {
        staleRecent.push(gid);
      }
    }
    const batch = [...missing, ...staleRecent].slice(0, 5);
    for (const gid of batch) {
      _scheduleGaraNarrativeGeneration(gid);
      await new Promise(r => setTimeout(r, 1500));
    }
    if (batch.length) console.log(`[gara-narrative] sweep: ${missing.length} mancanti, ${staleRecent.length} recenti da rinfrescare — avviate ${batch.length}`);
  } catch (e) { console.warn('[gara-narrative] sweep error:', e.message); }
}

// Rigenerazione forzata (admin) — usata dal backfill storico e disponibile
// per correggere a mano una gara specifica dopo una correzione risultati.
app.post('/api/admin/gara-narrative/:id/regenerate', requireAdmin, async (req, res) => {
  try {
    const text = await _generateAndStoreGaraNarrative(req.params.id);
    if (!text) return res.status(503).json({ error: 'Generazione non disponibile (AI non configurata o nessun risultato per questa gara)' });
    res.json({ ok: true, text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Racconto AI (o, in sua assenza temporanea, la vecchia narrazione a
// template) mostrato sulla pagina della gara stessa, tra foto e classifica,
// visibile a tutti — non solo all'admin che copia il testo per i social.
app.get('/api/gara-narrative/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const stored = await queries.getGaraNarrative(id).catch(() => null);
    if (stored?.text) {
      return res.json({ text: _stripSocialExtrasForPage(stored.text), ai: true });
    }
    // Nessun racconto AI ancora pronto per questa gara: la genera in
    // background per la prossima visita, intanto risponde subito con la
    // vecchia narrazione a template così la pagina non resta mai vuota.
    _scheduleGaraNarrativeGeneration(id);
    const { cal, resultsRaw } = await _fetchCalAndResultsFor(id);
    const { top3, podiumLines } = _buildGaraNarrative(id, cal, resultsRaw);
    const text = [top3, podiumLines.join(' ')].filter(Boolean).join('\n\n');
    res.json({ text, top3, podiumText: podiumLines.join(' '), ai: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Anteprima Facebook/social per un video o una diretta condivisi dalla pagina
// Media (vedi window._mediaShareUrl in app.js) — stesso pattern di
// /og/gara/:id: un bot (Facebook/WhatsApp/ecc., niente JS) legge i meta tag
// con la copertina YouTube reale; un utente vero viene rediretto subito alla
// pagina Media pulita, che apre automaticamente il player giusto (vedi
// route() in app.js) — mai su youtube.com.
async function _findVideoByYtId(ytIdWanted) {
  const videos = await readDataJsonFromGH('videos.json') || {};
  for (const [garaId, arr] of Object.entries(videos)) {
    for (const v of (arr || [])) {
      const m = (v.url || '').match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
      if (m && m[1] === ytIdWanted) return { garaId, video: v };
    }
  }
  return null;
}
app.get('/og/media-live/:vid', async (req, res) => {
  const vid = req.params.vid;
  const redirect = `${SITE_URL}/media/live/${encodeURIComponent(vid)}`;
  if (!OG_BOT_RE.test(req.headers['user-agent'] || '')) return res.redirect(302, redirect);
  const hit = await _findVideoByYtId(vid);
  const title = hit?.video?.title || 'Diretta';
  const img   = `https://img.youtube.com/vi/${encodeURIComponent(vid)}/hqdefault.jpg`;
  res.send(ogHtml({
    title: `🔴 ${title}`,
    desc: 'Guarda la diretta su Italia Cycling Stats',
    img, redirect, canonical: redirect,
  }));
});
app.get('/og/media-video/:vid', async (req, res) => {
  const vid = req.params.vid;
  const redirect = `${SITE_URL}/media/video/${encodeURIComponent(vid)}`;
  if (!OG_BOT_RE.test(req.headers['user-agent'] || '')) return res.redirect(302, redirect);
  const hit = await _findVideoByYtId(vid);
  const title = hit?.video?.title || 'Video';
  const img   = `https://img.youtube.com/vi/${encodeURIComponent(vid)}/hqdefault.jpg`;
  res.send(ogHtml({
    title,
    desc: 'Guarda il video su Italia Cycling Stats',
    img, redirect, canonical: redirect,
  }));
});

// Condivisione di un profilo Media (creator o fotografo) — l'immagine è la
// cover del profilo, che per i canali YouTube importati in blocco È
// l'immagine profilo/logo del canale (salvata al momento dell'import).
app.get('/og/media/:id', async (req, res) => {
  const id = req.params.id;
  const redirect = `${SITE_URL}/media/${encodeURIComponent(id)}`;
  if (!OG_BOT_RE.test(req.headers['user-agent'] || '')) return res.redirect(302, redirect);
  const profile = await queries.getMediaProfileById(id).catch(() => null);
  if (!profile) return res.send(ogHtml({ title: 'Media', desc: 'Italia Cycling Stats', redirect, canonical: redirect }));
  const img = profile.cover_url ? (/^https?:\/\//.test(profile.cover_url) ? profile.cover_url : `${SITE_URL}${profile.cover_url}`) : null;
  res.send(ogHtml({
    title: profile.display_name || 'Media',
    desc: `Foto e video di ${profile.display_name || 'questo creator'} su Italia Cycling Stats`,
    img, redirect, canonical: redirect,
  }));
});

app.get('/og/atleta/:id', async (req, res) => {
  const id       = req.params.id;
  if (!OG_BOT_RE.test(req.headers['user-agent'] || '')) {
    return res.redirect(302, `${SITE_URL}/atleta/${encodeURIComponent(id)}`);
  }
  const [athletes, resultsRaw] = await Promise.all([
    readDataJsonFromGH('athletes.json'),
    readDataJsonFromGH('results_raw.json'),
  ]);
  const ath      = (athletes || {})[id] || {};
  const title    = `${ath.cognome||''} ${ath.nome||''}`.trim() || id;
  const cat      = _OG_CAT_MAP[ath.categoria] || ath.categoria || '';
  const parts    = [cat, ath.team_attuale].filter(Boolean);
  if (ath.punti_totali) parts.push(`${ath.punti_totali} pt`);
  if (ath.vittorie)     parts.push(`${ath.vittorie} vitt.`);
  const desc     = parts.join(' · ') || 'Ciclista — Italia Cycling Stats';
  const img      = `${API_BASE_URL}/api/og-image/atleta/${encodeURIComponent(id)}?v=${OG_IMG_VERSION}`;
  const redirect = `${SITE_URL}/atleta/${encodeURIComponent(id)}`;
  const canonical = redirect;
  // Ultimi risultati dell'atleta — contenuto reale per l'indicizzazione,
  // stesso pattern di filtro per atleta_id già usato altrove nel file.
  const recent = (resultsRaw || [])
    .filter(r => r.atleta_id === id)
    .sort((a, b) => (b.data || '').localeCompare(a.data || ''))
    .slice(0, 20);
  const bodyHtml = recent.length ? `<table>
    <thead><tr><th>Data</th><th>Gara</th><th>Pos</th><th>Punti</th></tr></thead>
    <tbody>${recent.map(r => `<tr>
      <td>${_ogHtmlEsc(r.data || '')}</td>
      <td>${_ogHtmlEsc(r.nome_gara || '')}</td>
      <td>${_ogHtmlEsc(r.posizione ?? '')}°</td>
      <td>${_ogHtmlEsc(r.punti_effettivi ?? 0)}</td>
    </tr>`).join('')}</tbody>
  </table>` : '';
  res.setHeader('Content-Type','text/html');
  res.send(ogHtml({ title, desc, img, redirect, canonical, bodyHtml }));
});

app.get('/og/team/:id', async (req, res) => {
  const id    = req.params.id;
  if (!OG_BOT_RE.test(req.headers['user-agent'] || '')) {
    return res.redirect(302, `${SITE_URL}/team/${encodeURIComponent(id)}`);
  }
  const [teams, athletes] = await Promise.all([
    readDataJsonFromGH('teams.json'),
    readDataJsonFromGH('athletes.json'),
  ]);
  const team  = (teams || {})[id] || {};
  const title = team.nome || id.replace(/_/g,' ');
  const roster = Object.values(athletes || {}).filter(a => a.team_id === id)
    .sort((a, b) => (b.punti_totali || 0) - (a.punti_totali || 0));
  const desc  = roster.length ? `${roster.length} corridori — Italia Cycling Stats` : 'Team — Italia Cycling Stats';
  const img   = `${API_BASE_URL}/api/og-image/team/${encodeURIComponent(id)}?v=${OG_IMG_VERSION}`;
  const redirect = `${SITE_URL}/team/${encodeURIComponent(id)}`;
  const canonical = redirect;
  // Elenco nominale del roster — contenuto reale al posto del solo conteggio.
  const bodyHtml = roster.length ? `<table>
    <thead><tr><th>Atleta</th><th>Categoria</th><th>Punti</th></tr></thead>
    <tbody>${roster.map(a => `<tr>
      <td>${_ogHtmlEsc(a.cognome || '')} ${_ogHtmlEsc(a.nome || '')}</td>
      <td>${_ogHtmlEsc(_OG_CAT_MAP[a.categoria] || a.categoria || '')}</td>
      <td>${_ogHtmlEsc(a.punti_totali ?? 0)}</td>
    </tr>`).join('')}</tbody>
  </table>` : '';
  res.setHeader('Content-Type','text/html');
  res.send(ogHtml({ title, desc, img, redirect, canonical, bodyHtml }));
});

const _CLASS_CAT_LABELS = { ELI_M:'Elite', ELI_F:'Elite Donne', JUN_M:'Juniores', JUN_F:'Juniores Donne',
  AL_M:'Allievi', AL_F:'Allieve', ES1_M:'Esordienti 1°', ES2_M:'Esordienti 2°',
  ES1_F:'Esordienti 1° Donne', ES2_F:'Esordienti 2° Donne' };
const _CLASS_MONTHS = ['','Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

// Stesso codice categoria usato ovunque nel resto dell'app (getRankingFileCode
// lato client), versione minima lato server: dal suffisso del gara_id, con
// fallback su categoria se già in formato codice. Niente ATHLETE_GENDER_FIXES
// qui (lista di correzioni curate manualmente, non critica per un aggregato).
function _rankingCodeFromRow(r) {
  const m = (r.gara_id || '').match(/_(ELI|JUN|AL|ES1|ES2)_(M|F)$/i);
  if (m) return `${m[1].toUpperCase()}_${m[2].toUpperCase()}`;
  if (r.categoria && /^[A-Z0-9]+_[MF]$/.test(r.categoria)) return r.categoria;
  return null;
}

// Ricostruisce una classifica (top 10) dai filtri codificati nell'id
// condiviso: "CATCODE__REGIONE_SLUG__MESE" (regione/mese opzionali, vuoti se
// nazionale/tutto l'anno). Nessun dato salvato lato server: si rilegge
// results_raw.json e si aggrega al volo, stessa logica di shareClassifica lato
// client quando ci sono filtri regione/mese attivi.
// opts.view: 'atleti' (default) o 'team' — aggrega per team_id invece che per
// atleta_id. opts.sort: 'punti' (default) o 'vittorie' — ordina/valorizza per
// numero di primi posti invece che per punteggio (r.score riflette sempre
// la metrica scelta, r.punti/r.wins restano entrambi disponibili).
async function _computeClassRanking(rawId, opts = {}) {
  const view = opts.view === 'team' ? 'team' : 'atleti';
  const sort = opts.sort === 'vittorie' ? 'vittorie' : 'punti';
  const [catCode, regionSlug, month] = decodeURIComponent(rawId).split('__');
  const resultsRaw = (await readDataJsonFromGH('results_raw.json')) || [];
  const gender = catCode.endsWith('_F') ? 'F' : 'M';
  const region = regionSlug ? regionSlug.replace(/_/g, ' ') : '';
  const agg = {};
  for (const r of resultsRaw) {
    if (r.genere !== gender) continue;
    if (_rankingCodeFromRow(r) !== catCode) continue;
    if (region && (r.regione || '').toUpperCase() !== region.toUpperCase()) continue;
    if (month && (r.data || '').split('-')[1] !== month) continue;
    const key = view === 'team' ? (r.team_id || r.team) : r.atleta_id;
    if (!key) continue;
    if (!agg[key]) agg[key] = view === 'team'
      ? { team: r.team, punti: 0, wins: 0 }
      : { cognome: r.cognome, nome: r.nome, team: r.team, punti: 0, wins: 0 };
    agg[key].punti += (r.punti_effettivi || 0);
    if (r.posizione === 1) agg[key].wins++;
  }
  const scoreKey = sort === 'vittorie' ? 'wins' : 'punti';
  const ranking = Object.values(agg).sort((a, b) => b[scoreKey] - a[scoreKey]).slice(0, 10)
    .map((r, i) => ({ ...r, pos: i + 1, score: r[scoreKey] }));
  const catLabelText = _CLASS_CAT_LABELS[catCode] || catCode.replace(/_/g, ' ');
  const scopeLabel = region ? `Classifica ${region}` : 'Classifica Nazionale';
  const monthLabel = month ? _CLASS_MONTHS[parseInt(month, 10)] : '';
  return { catCode, region, month, view, sort, catLabelText, scopeLabel, monthLabel, ranking };
}

app.get('/og/class/:id', async (req, res) => {
  if (!OG_BOT_RE.test(req.headers['user-agent'] || '')) {
    return res.redirect(302, `${SITE_URL}/classifica/${encodeURIComponent(req.params.id)}`);
  }
  const { catLabelText, scopeLabel, monthLabel, ranking } = await _computeClassRanking(req.params.id);
  const title = `Classifica ${catLabelText}`;
  const top3  = ranking.slice(0, 3).map(r => `${r.pos}° ${r.cognome} ${r.nome}`).join(' · ');
  const desc  = [scopeLabel, monthLabel, top3].filter(Boolean).join(' — ');
  const img   = `${API_BASE_URL}/api/og-image/class/${encodeURIComponent(req.params.id)}?v=${OG_IMG_VERSION}`;
  const redirect  = `${SITE_URL}/classifica/${encodeURIComponent(req.params.id)}`;
  const canonical = redirect;
  // Top 10 completa (ranking già la calcola per intero) invece dei soli primi 3.
  const bodyHtml = ranking.length ? `<table>
    <thead><tr><th>Pos</th><th>Atleta</th><th>Team</th><th>Punti</th></tr></thead>
    <tbody>${ranking.map(r => `<tr>
      <td>${_ogHtmlEsc(r.pos)}°</td>
      <td>${_ogHtmlEsc(r.cognome)} ${_ogHtmlEsc(r.nome)}</td>
      <td>${_ogHtmlEsc(r.team || '')}</td>
      <td>${_ogHtmlEsc(r.punti ?? 0)}</td>
    </tr>`).join('')}</tbody>
  </table>` : '';
  res.setHeader('Content-Type','text/html');
  res.send(ogHtml({ title, desc, img, redirect, canonical, bodyHtml }));
});

// Variante di /og/class/:id che rispecchia l'URL pulito reale della pagina
// classifica (#/classifica/:cat/:view/:sort — vedi _syncRankUrl lato client):
// nome della route allineato al prefisso "classifica" apposta, così la
// regola Cloudflare che rimanda i bot dal link pulito può limitarsi a
// anteporre "/og" al path invece di doverlo riscrivere. Copre sia la vista
// Team sia l'ordinamento per Vittorie, che /og/class/:id da solo non
// gestiva affatto (sempre e solo atleti/punti).
app.get('/og/classifica/:id/:view?/:sort?', async (req, res) => {
  const view = req.params.view === 'team' ? 'team' : 'atleti';
  const sort = req.params.sort === 'vittorie' ? 'vittorie' : 'punti';
  if (!OG_BOT_RE.test(req.headers['user-agent'] || '')) {
    const tail = [view !== 'atleti' ? view : null, sort !== 'punti' ? sort : null].filter(Boolean);
    return res.redirect(302, `${SITE_URL}/classifica/${encodeURIComponent(req.params.id)}${tail.length ? '/' + tail.join('/') : ''}`);
  }
  const { catLabelText, scopeLabel, monthLabel, ranking } = await _computeClassRanking(req.params.id, { view, sort });
  const scoreLabel = sort === 'vittorie' ? 'Vittorie' : 'Punti';
  const title = `Classifica ${view === 'team' ? 'Team ' : ''}${catLabelText}${sort === 'vittorie' ? ' — Vittorie' : ''}`;
  const top3  = ranking.slice(0, 3).map(r => `${r.pos}° ${view === 'team' ? r.team : `${r.cognome} ${r.nome}`}`).join(' · ');
  const desc  = [scopeLabel, monthLabel, top3].filter(Boolean).join(' — ');
  const img   = `${API_BASE_URL}/api/og-image/classifica/${encodeURIComponent(req.params.id)}/${view}/${sort}?v=${OG_IMG_VERSION}`;
  const tail = [view !== 'atleti' ? view : null, sort !== 'punti' ? sort : null].filter(Boolean);
  const redirect  = `${SITE_URL}/classifica/${encodeURIComponent(req.params.id)}${tail.length ? '/' + tail.join('/') : ''}`;
  const canonical = redirect;
  const bodyHtml = ranking.length ? `<table>
    <thead><tr><th>Pos</th><th>${view === 'team' ? 'Team' : 'Atleta'}</th>${view === 'team' ? '' : '<th>Team</th>'}<th>${_ogHtmlEsc(scoreLabel)}</th></tr></thead>
    <tbody>${ranking.map(r => `<tr>
      <td>${_ogHtmlEsc(r.pos)}°</td>
      <td>${view === 'team' ? _ogHtmlEsc(r.team || '') : `${_ogHtmlEsc(r.cognome)} ${_ogHtmlEsc(r.nome)}`}</td>
      ${view === 'team' ? '' : `<td>${_ogHtmlEsc(r.team || '')}</td>`}
      <td>${_ogHtmlEsc(r.score ?? 0)}</td>
    </tr>`).join('')}</tbody>
  </table>` : '';
  res.setHeader('Content-Type','text/html');
  res.send(ogHtml({ title, desc, img, redirect, canonical, bodyHtml }));
});

app.get('/api/og-image/classifica/:id/:view/:sort', async (req, res) => {
  try {
    const view = req.params.view === 'team' ? 'team' : 'atleti';
    const sort = req.params.sort === 'vittorie' ? 'vittorie' : 'punti';
    const cacheKey = `classifica_${req.params.id}_${view}_${sort}`;
    const buf = await _ogGenerateDeduped(cacheKey, async () => {
      const { catLabelText, region, monthLabel, ranking } = await _computeClassRanking(req.params.id, { view, sort });
      if (!ranking.length) return null;
      const svg = buildClassCardSvg({
        catLabel: catLabelText, region, month: monthLabel, rows: ranking, view,
        scoreLabel: sort === 'vittorie' ? 'VITTORIE' : 'PUNTI',
        scoreSuffix: sort === 'vittorie' ? 'V' : 'pt',
      });
      return await renderOgPng(svg);
    });
    if (!buf) return res.redirect('/assets/og-default.png');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.send(buf);
  } catch (e) { res.redirect('/assets/og-default.png'); }
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
    if (!user.password) return res.status(401).json({ error: 'Questo account usa l\'accesso con Google. Usa il pulsante "Accedi con Google".' });

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

// Accesso/collegamento con Google. Se l'email risulta già registrata (account
// creato con password) colleghiamo il google_id automaticamente: l'email è
// già stata verificata da Google, quindi è un collegamento sicuro. Se invece
// non esiste alcun account, rispondiamo needsRegistration così il frontend
// porta l'utente sul form di registrazione (serve comunque scegliere un ruolo
// e compilare i campi specifici, es. squadra/atleta collegato).
app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: 'Credenziale Google mancante' });
    const { googleId, email, name } = await verifyGoogleCredential(credential);

    let user = await queries.getUserByGoogleId(googleId);
    if (!user) {
      const byEmail = await queries.getUserByEmail(email);
      if (byEmail) {
        await queries.linkGoogleId(byEmail.id, googleId);
        user = byEmail;
      }
    }
    if (!user) {
      return res.json({ needsRegistration: true, email, name });
    }

    await queries.updateLastLogin(user.id);
    const safe = await queries.getUserById(user.id);
    try { const _p = await queries.getAthleteProfile(user.id); if (_p?.atleta_id) safe.atleta_id = _p.atleta_id; } catch {}
    res.json({ token: makeToken(safe), user: safe });
  } catch (e) {
    res.status(401).json({ error: 'Accesso con Google non riuscito: ' + e.message });
  }
});

app.post('/api/auth/google/register', async (req, res) => {
  try {
    const { credential, role, display_name } = req.body || {};
    const ALLOWED_ROLES = ['atleta', 'team', 'genitore', 'parente', 'appassionato', 'media'];
    if (!credential) return res.status(400).json({ error: 'Credenziale Google mancante' });
    if (!ALLOWED_ROLES.includes(role)) return res.status(400).json({ error: 'Tipo utente non valido' });

    const { googleId, email, name } = await verifyGoogleCredential(credential);

    const existingByGoogle = await queries.getUserByGoogleId(googleId);
    if (existingByGoogle) return res.status(409).json({ error: 'Account Google già registrato' });
    const existingByEmail = await queries.getUserByEmail(email);
    if (existingByEmail) return res.status(409).json({ error: 'Email già registrata' });

    const user = await queries.createUser({
      email:        email.trim().toLowerCase(),
      password:     null,
      google_id:    googleId,
      role,
      display_name: display_name?.trim() || name || email.split('@')[0],
    });
    res.status(201).json({ token: makeToken(user), user });
  } catch (e) {
    res.status(401).json({ error: 'Registrazione con Google non riuscita: ' + e.message });
  }
});

// ── Recupero password ──────────────────────────────────────────────────────
// Le password sono hashate (bcrypt, one-way) — nessuno, admin compreso, può
// "vederle": l'unica soluzione corretta a "utente ha dimenticato la
// password" è reimpostarla, non recuperare quella vecchia. Token monouso a
// scadenza salvato in kv_store (stesso pattern già usato per videos/
// monthly-recap), niente tabella dedicata.
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email obbligatoria' });
    // Risposta identica sia che l'email esista sia che non esista: non deve
    // rivelare quali email sono registrate (evita enumerazione account).
    const generic = { ok: true, message: 'Se l\'indirizzo è registrato, riceverai a breve un\'email con le istruzioni.' };
    const user = await queries.getUserByEmail(email.trim());
    if (!user || !supabase) return res.json(generic);
    const token = require('crypto').randomBytes(32).toString('hex');
    const key = `pwreset_${token}`;
    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 ora
    const { error } = await supabase.from('kv_store')
      .upsert({ key, value: { user_id: user.id, expiresAt }, updated_at: new Date().toISOString() });
    if (error) throw error;
    const resetUrl = `${SITE_URL}/reset-password?token=${token}`;
    // Non awaited: una connessione SMTP lenta o bloccata (comune su hosting
    // cloud per prevenire spam) non deve tenere appesa la risposta — l'utente
    // vede comunque subito il messaggio generico, l'email parte in background.
    sendEmail({
      to: user.email,
      subject: 'Reimposta la tua password — Italia Cycling Stats',
      html: `<p>Hai richiesto di reimpostare la password del tuo account ItaliacritResultati.</p>
<p><a href="${resetUrl}" style="display:inline-block;padding:12px 22px;background:#e65c00;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Reimposta password</a></p>
<p>Il link scade tra 1 ora. Se non hai richiesto tu il reset, ignora questa email — la tua password resta invariata.</p>`,
      text: `Reimposta la password: ${resetUrl} (scade tra 1 ora, ignora se non richiesto)`,
    }).catch(e => console.warn('[password-reset] invio email fallito:', e.message));
    res.json(generic);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) return res.status(400).json({ error: 'Dati mancanti' });
    if (password.length < 6) return res.status(400).json({ error: 'Password minimo 6 caratteri' });
    if (!supabase) return res.status(500).json({ error: 'Servizio non disponibile' });
    const key = `pwreset_${token}`;
    const { data } = await supabase.from('kv_store').select('value').eq('key', key).single();
    if (!data?.value || Date.now() > data.value.expiresAt)
      return res.status(400).json({ error: 'Link non valido o scaduto — richiedine uno nuovo' });
    const hash = bcrypt.hashSync(password, 10);
    await queries.updatePassword(data.value.user_id, hash);
    await supabase.from('kv_store').delete().eq('key', key); // monouso
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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

// ID atleta generato a mano: stessa convenzione COGNOME_NOME già usata dal
// merge extra_roster lato frontend (app.js, slug(cognome+'_'+nome)) — così
// un atleta creato qui e uno creato manualmente nel vecchio file statico
// finiscono con lo stesso ID se sono la stessa persona, invece di duplicarsi.
function _athleteSlugBase(cognome, nome) {
  const s = `${cognome || ''}_${nome || ''}`.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return s.toUpperCase();
}
async function _uniqueManualAthleteId(cognome, nome) {
  const base = _athleteSlugBase(cognome, nome) || 'ATLETA';
  let id = base, n = 1;
  while (await queries.getManualAthlete(id)) { n++; id = `${base}_${n}`; }
  return id;
}

app.post('/api/profile/link-athlete', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'atleta') return res.status(403).json({ error: 'Solo per atleti' });
    let { atleta_id, fci_code, first_name, last_name, team, birth_year } = req.body;

    const existing = await queries.getAthleteProfile(req.user.id);
    if (existing) return res.status(409).json({ error: 'Profilo già presente' });

    // Non risulta fra gli atleti scrapati dalla FCI: gli si crea comunque un
    // atleta_id vero e proprio (roster manuale, 0 punti finché non compaiono
    // risultati reali) invece di lasciarlo in sospeso in attesa che lo
    // scraper lo trovi da solo — visibile subito, nessuna approvazione admin.
    let generatedId = false;
    if (!atleta_id && (first_name || last_name)) {
      atleta_id = await _uniqueManualAthleteId(last_name, first_name);
      await queries.createManualAthlete({
        atleta_id, cognome: (last_name || '').toUpperCase(), nome: (first_name || '').toUpperCase(),
        team: team || null, created_by: req.user.id, source: 'self',
      });
      generatedId = true;
    }

    await queries.createAthleteProfile({
      user_id: req.user.id,
      atleta_id: atleta_id || null,
      fci_code: fci_code || null,
      first_name: first_name || null,
      last_name: last_name || null,
      team: team || null,
      birth_year: birth_year || null,
      status: 'active',
    });
    res.status(201).json({ ok: true, status: 'active', atleta_id: atleta_id || null, generated: generatedId });
  } catch (e) {
    res.status(500).json({ error: 'Errore durante il collegamento' });
  }
});

// Un account team aggiunge al proprio roster un corridore che non risulta
// (ancora) fra gli atleti scrapati dalla FCI — crea subito un profilo visibile
// (0 punti/risultati finché non gareggia davvero), nessuna approvazione admin.
app.post('/api/team/add-athlete', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'team') return res.status(403).json({ error: 'Solo per account team' });
    const profile = await queries.getTeamProfile(req.user.id);
    if (!profile || profile.status !== 'active' || !profile.team_id)
      return res.status(403).json({ error: 'Il tuo profilo team deve essere collegato a una squadra esistente prima di poter aggiungere corridori' });
    const { cognome, nome, categoria, genere } = req.body;
    if (!cognome?.trim() || !nome?.trim()) return res.status(400).json({ error: 'Nome e cognome obbligatori' });

    const atleta_id = await _uniqueManualAthleteId(cognome, nome);
    const row = await queries.createManualAthlete({
      atleta_id, cognome: cognome.trim().toUpperCase(), nome: nome.trim().toUpperCase(),
      team_id: profile.team_id, team: profile.team_name || profile.team_id,
      categoria: categoria || null, genere: genere === 'F' ? 'F' : 'M',
      created_by: req.user.id, source: 'team',
    });
    res.status(201).json({ ok: true, athlete: row });
  } catch (e) {
    res.status(500).json({ error: 'Errore durante l\'aggiunta del corridore' });
  }
});

// Roster manuale (team + auto-registrazioni), stessa forma di /api/data/pcs-extra-roster
// così il frontend può unirli con la stessa identica logica di merge già esistente.
app.get('/api/data/manual-athletes', async (req, res) => {
  try {
    const rows = await queries.getAllManualAthletes();
    const result = {};
    for (const r of rows) {
      const tid = r.team_id || '_SENZA_TEAM_';
      if (!result[tid]) result[tid] = { nome: r.team || tid, atleti: [] };
      result[tid].atleti.push({ atleta_id: r.atleta_id, cognome: r.cognome, nome: r.nome, categoria: r.categoria || '', genere: r.genere || 'M' });
    }
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
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

    // Prima restava sempre "in attesa" di approvazione admin anche quando
    // l'atleta_id collegato era già valido — inutile: attivo subito, come
    // già succede per atleta/team quando trovano una corrispondenza.
    await queries.createFamilyLink({
      user_id: req.user.id,
      linked_atleta_id,
      relation: req.user.role,
      status: 'active',
    });
    res.status(201).json({ ok: true, status: 'active' });
  } catch (e) {
    res.status(500).json({ error: 'Errore durante il collegamento' });
  }
});

// ── Admin routes ──────────────────────────────────────────────────────────────

// Gare escluse (es. gare estere finite per errore nei risultati/classifica
// tramite lo scraper FCI — vedi gara_overrides, field='excluded'). Pubblico
// in lettura: il frontend lo usa per filtrare i dati statici GitHub Pages
// prima di calcolare punti/classifica, non serve autenticazione per leggerlo.
let _excludedGareCache = null, _excludedGareCacheTs = 0;
app.get('/api/gara-overrides/excluded', async (req, res) => {
  try {
    if (_excludedGareCache && (Date.now() - _excludedGareCacheTs) < 5 * 60 * 1000) {
      return res.json({ excluded: _excludedGareCache });
    }
    const { data, error } = await supabase.from('gara_overrides')
      .select('gara_id').eq('field', 'excluded').eq('new_value', 'true');
    if (error) throw error;
    _excludedGareCache = [...new Set((data || []).map(r => r.gara_id))];
    _excludedGareCacheTs = Date.now();
    res.json({ excluded: _excludedGareCache });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/gare/:gara_id', requireAdmin, async (req, res) => {
  try {
    const gara_id = req.params.gara_id;
    const { error } = await supabase.from('gara_overrides').insert({
      gara_id, field: 'excluded', new_value: 'true', edited_by: req.user.id,
    });
    if (error) throw error;
    _excludedGareCache = null; // invalida la cache
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/gare/:gara_id/restore', requireAdmin, async (req, res) => {
  try {
    const gara_id = req.params.gara_id;
    const { error } = await supabase.from('gara_overrides')
      .delete().eq('gara_id', gara_id).eq('field', 'excluded');
    if (error) throw error;
    _excludedGareCache = null;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Correzioni manuali ai campi di una gara (es. regione sbagliata nei dati
// FCI sorgente — capita quando la federazione tiene un record separato per
// ogni categoria della stessa manifestazione e chi inserisce i dati sbaglia
// la regione su una sola sotto-gara). Stessa tabella gara_overrides delle
// gare escluse, un field diverso per ogni campo corretto. Pubblico in
// lettura, come /excluded, per lo stesso motivo (il frontend lo applica
// prima di renderizzare i dati statici GitHub Pages).
const GARA_EDITABLE_FIELDS = ['nome', 'data', 'cat', 'km', 'media', 'tipo', 'regione'];
let _garaCorrectionsCache = null, _garaCorrectionsCacheTs = 0;
app.get('/api/gara-overrides/corrections', async (req, res) => {
  try {
    if (_garaCorrectionsCache && (Date.now() - _garaCorrectionsCacheTs) < 5 * 60 * 1000) {
      return res.json({ corrections: _garaCorrectionsCache });
    }
    const { data, error } = await supabase.from('gara_overrides')
      .select('gara_id, field, new_value').in('field', GARA_EDITABLE_FIELDS);
    if (error) throw error;
    const corrections = {};
    for (const r of (data || [])) {
      if (!corrections[r.gara_id]) corrections[r.gara_id] = {};
      corrections[r.gara_id][r.field] = r.new_value;
    }
    _garaCorrectionsCache = corrections;
    _garaCorrectionsCacheTs = Date.now();
    res.json({ corrections });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Correzioni a singole righe risultato (es. genere/categoria sbagliati alla
// fonte SOLO per un atleta in una gara che mischia categorie/generi nella
// stessa pagina FCI — a differenza di gara_overrides, qui non si può
// correggere per gara_id perché cambierebbe anche gli altri atleti
// correttamente scrapati in quella stessa gara). risultato_key è sempre
// "atleta_id|data": non l'esatto gara_id, che ha un suffisso categoria/genere
// spesso diverso da quello con cui è stata fatta la correzione a mano.
const RISULTATO_EDITABLE_FIELDS = ['cat', 'genere', 'posizione'];
let _risultatoCorrectionsCache = null, _risultatoCorrectionsCacheTs = 0;
app.get('/api/risultato-overrides/corrections', async (req, res) => {
  try {
    if (_risultatoCorrectionsCache && (Date.now() - _risultatoCorrectionsCacheTs) < 5 * 60 * 1000) {
      return res.json({ corrections: _risultatoCorrectionsCache });
    }
    const { data, error } = await supabase.from('risultato_overrides')
      .select('risultato_key, field, new_value').in('field', RISULTATO_EDITABLE_FIELDS);
    if (error) throw error;
    const corrections = {};
    for (const r of (data || [])) {
      if (!corrections[r.risultato_key]) corrections[r.risultato_key] = {};
      corrections[r.risultato_key][r.field] = r.new_value;
    }
    _risultatoCorrectionsCache = corrections;
    _risultatoCorrectionsCacheTs = Date.now();
    res.json({ corrections });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/gare/:gara_id', requireAdmin, async (req, res) => {
  try {
    const gara_id = req.params.gara_id;
    const rows = GARA_EDITABLE_FIELDS
      .filter(f => req.body[f] != null && String(req.body[f]).trim() !== '')
      .map(f => ({ gara_id, field: f, new_value: String(req.body[f]).trim(), edited_by: req.user.id }));
    if (!rows.length) return res.json({ ok: true });
    const { error } = await supabase.from('gara_overrides')
      .upsert(rows, { onConflict: 'gara_id,field' });
    if (error) throw error;
    _garaCorrectionsCache = null;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Correzioni al nome di un team fatte dal pannello admin ("Modifica team").
// L'override finiva in entity_overrides ma nessuna pagina lo rileggeva mai —
// il modulo di modifica salvava un dato che non veniva più applicato da
// nessuna parte. Stesso pattern di /api/gara-overrides/corrections: pubblico
// in lettura, il frontend lo applica a globalData.teams subito dopo il
// caricamento dei dati, prima di qualunque render.
let _teamNomeCorrectionsCache = null, _teamNomeCorrectionsCacheTs = 0;
app.get('/api/team-overrides/corrections', async (req, res) => {
  try {
    if (_teamNomeCorrectionsCache && (Date.now() - _teamNomeCorrectionsCacheTs) < 5 * 60 * 1000) {
      return res.json({ corrections: _teamNomeCorrectionsCache });
    }
    const { data, error } = await supabase.from('entity_overrides')
      .select('entity_id, new_value').eq('entity_type', 'team').eq('field', 'nome');
    if (error) throw error;
    const corrections = {};
    for (const r of (data || [])) {
      if (r.new_value) corrections[r.entity_id] = r.new_value;
    }
    _teamNomeCorrectionsCache = corrections;
    _teamNomeCorrectionsCacheTs = Date.now();
    res.json({ corrections });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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
    _risultatoCorrectionsCache = null;
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
    if (entity_type === 'team' && field === 'nome') _teamNomeCorrectionsCache = null;

    // Sincronizza extra_roster.json per nomi team e team_id atleti
    const rosterPath = path.join(__dirname, '..', 'data', 'extra_roster.json');
    try {
      const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
      if (entity_type === 'team' && field === 'nome' && roster[entity_id]) {
        roster[entity_id].nome = new_value;
        fs.writeFileSync(rosterPath, JSON.stringify(roster, null, 2), 'utf8');
      }
    } catch (fsErr) {
      console.warn('[admin] sync extra_roster.json fallito:', fsErr.message);
    }

    // Sincronizza pcs_race_slug su Supabase (letto da pcs-race-scraper.js)
    if (entity_type === 'gara' && field === 'pcs_race_slug' && supabase) {
      try {
        const { error: sbErr } = await supabase
          .from('entity_overrides')
          .upsert(
            { entity_type: 'gara', entity_id, field: 'pcs_race_slug', new_value: new_value || null, edited_by: null },
            { onConflict: 'entity_type,entity_id,field' }
          );
        if (sbErr) console.warn('[admin] sync pcs_race_slug su Supabase fallito:', sbErr.message);
        else console.log(`[admin] pcs_race_slug "${new_value}" salvato su Supabase per gara ${entity_id}`);
      } catch (sbEx) {
        console.warn('[admin] sync pcs_race_slug su Supabase eccezione:', sbEx.message);
      }
    }

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

    // Sincronizza extra_roster.json: sposta l'atleta nel team corretto
    if (team_id !== undefined) {
      const rosterPath = path.join(__dirname, '..', 'data', 'extra_roster.json');
      try {
        const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
        let atletaEntry = null;
        // Trova e rimuovi dall'attuale bucket
        for (const [tid, bucket] of Object.entries(roster)) {
          if (!Array.isArray(bucket.atleti)) continue;
          const idx = bucket.atleti.findIndex(a => a.atleta_id === aid);
          if (idx !== -1) {
            [atletaEntry] = bucket.atleti.splice(idx, 1);
            if (bucket.atleti.length === 0) delete roster[tid];
            break;
          }
        }
        if (atletaEntry && team_id) {
          // Aggiorna il team nell'entry
          atletaEntry.team_id = team_id;
          if (!roster[team_id]) roster[team_id] = { nome: team || team_id, atleti: [] };
          roster[team_id].atleti.push(atletaEntry);
          fs.writeFileSync(rosterPath, JSON.stringify(roster, null, 2), 'utf8');
        }
      } catch (fsErr) {
        console.warn('[admin] sync extra_roster.json fallito:', fsErr.message);
      }
    }

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
      } else if (entity_type === 'atleta' && user.role === 'team') {
        // Un team verificato può modificare la foto profilo degli atleti del
        // proprio roster (staff/DS spesso hanno le foto più prontamente
        // dell'atleta stesso) — mancava del tutto, un team riceveva sempre
        // 403 su qualsiasi atleta, segnalato dall'utente.
        const profile = await queries.getTeamProfile(user.id);
        if (!profile || profile.status !== 'active')
          return res.status(403).json({ error: 'Profilo team non collegato o non verificato' });
        const athletes = (await readDataJsonFromGH('athletes.json')) || {};
        if (athletes[entity_id]?.team_id !== profile.team_id)
          return res.status(403).json({ error: 'Atleta non nel roster del tuo team' });
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
    const display_name = req.user.display_name || req.user.email;
    // Marchiato nel file stesso (non solo mostrato sopra a schermo): anche
    // scaricando la foto il credit resta impresso — vedi _watermarkPhoto.
    const filename = await savePhoto(req, req.file, photographer || display_name);
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
    // Il pannello "tagga corridori" rapido invia solo atleta_ids (nessun
    // campo caption/photographer nel body): aggiornare comunque quelle due
    // colonne con "|| ''" le azzerava ad ogni tag, cancellando la
    // didascalia esistente. Aggiorna caption/photographer solo se il body
    // li include davvero, e in tal caso mantieni l'altro campo invariato
    // se non è stato inviato.
    if (caption !== undefined || photographer !== undefined) {
      const photo = await queries.getRacePhotoById(req.params.id);
      await queries.updateRacePhoto({
        id: req.params.id,
        caption:      caption      !== undefined ? caption      : (photo?.caption      || ''),
        photographer: photographer !== undefined ? photographer : (photo?.photographer || ''),
      });
    }
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
let _lastLiveCheck = 0;
let _lastMonthlyRecapCheck = 0;
let _lastNarrativeSweep = 0;
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
  // Controlla se una diretta programmata per oggi è appena iniziata e, se
  // sì, notifica tutti gli iscritti — max una volta ogni 3 min (il pinger
  // esterno colpisce /cron/tick ogni ~10 min, questo throttle protegge solo
  // da eventuali ping più ravvicinati, es. più utenti sul sito insieme).
  if (now - _lastLiveCheck >= 3 * 60 * 1000) {
    _lastLiveCheck = now;
    checkLiveTransitionsAndNotify();
  }
  // Riepilogo mensile: la funzione stessa esce subito se non è il giorno 1
  // (controllo economico), il throttle qui evita solo query Supabase
  // ripetute inutilmente da più tick ravvicinati proprio il giorno 1 — la
  // vera protezione da invii doppi è il flag persistito in kv_store.
  if (now - _lastMonthlyRecapCheck >= 10 * 60 * 1000) {
    _lastMonthlyRecapCheck = now;
    _checkMonthlyRecap();
  }
  // Racconti AI delle gare (pagina pubblica + testo social): genera quelli
  // mancanti e rinfresca quelli recenti — vedi _sweepGaraNarratives. Max una
  // volta ogni 30 min per non bruciare il budget Claude ad ogni tick.
  if (now - _lastNarrativeSweep >= 30 * 60 * 1000) {
    _lastNarrativeSweep = now;
    _sweepGaraNarratives();
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
    notifyRankChanges().catch(e => console.warn('[rank] notify error:', e.message));
    _warmRecentOgImages().catch(e => console.warn('[og-warm] notify error:', e.message));
    _reconcilePendingStageVideos().catch(e => console.warn('[videos] reconcile error:', e.message));
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

// Trova il gara_id REALE (con suffisso categoria, es. _ELI_M) per una chiave
// video sintetica "calId::dataTappa" (vedi window._maddSubmitStageVideo),
// una volta che la FCI ha pubblicato i risultati di quella tappa. calId è
// l'id calendario del PRIMO giorno del giro (es. "..._MONT_BLANC_2026-07-16");
// le tappe successive seguono sempre il pattern
// "{stessoPrefisso}_{ordinale}_TAPPA_{dataTappa}" nel calendario — cerchiamo
// quindi per data + prefisso id, non per nome (più affidabile, stesso
// pattern già verificato per Giro d'Italia Next Gen/Women).
function _findRealGaraIdForPendingVideo(gid) {
  const idx = gid.lastIndexOf('::');
  if (idx === -1) return null;
  const calId = gid.slice(0, idx);
  const stageDate = gid.slice(idx + 2);
  const tourPrefix = calId.replace(/_\d{4}-\d{2}-\d{2}$/, '');
  const calendar = readDataJson('calendar.json') || [];
  const candidates = calendar.filter(c => c.data === stageDate && c.id.startsWith(tourPrefix));
  if (!candidates.length) return null;
  const resultsRaw = readDataJson('results_raw.json') || [];
  const resultedIds = new Set(resultsRaw.map(r => r.gara_id));
  for (const c of candidates) {
    const withCat = [...resultedIds].find(rid => rid.startsWith(c.id + '_'));
    if (withCat) return withCat;
  }
  return null;
}

function _normVideoName(s) {
  return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ').trim();
}

// Caso diverso dal precedente: la voce calendario a cui è agganciato il
// video ESISTE (non è una chiave sintetica) ma non ha mai ricevuto
// risultati — tipicamente un doppione creato con un nome leggermente
// diverso da quello poi usato per i risultati reali (es. "50 GRAN PREMIO
// SPORTIVI DI POGGIANA - 50 TROFEO BONIN COSTRUZIONI - ..." per il video,
// "50 GRAN PREMIO SPORTIVI DI POGGIANA UNDER23" per i risultati — stesso
// giorno, stesso evento, nomi diversi). Cerca un'altra voce calendario
// nello stesso giorno CON risultati reali e un buon numero di parole in
// comune con quella orfana.
function _findRealGaraIdForOrphanCalendarVideo(gid) {
  if (gid.includes('::')) return null;
  const calendar = readDataJson('calendar.json') || [];
  const own = calendar.find(c => c.id === gid);
  if (!own) return null;
  const resultsRaw = readDataJson('results_raw.json') || [];
  const resultedIds = new Set(resultsRaw.map(r => r.gara_id));
  if ([...resultedIds].some(rid => rid === gid || rid.startsWith(gid + '_'))) return null; // ha già risultati, non è orfana
  const ownWords = new Set(_normVideoName(own.nome).split(' ').filter(w => w.length > 4));
  if (!ownWords.size) return null;
  let best = null, bestScore = 0;
  for (const c of calendar) {
    if (c.id === gid || c.data !== own.data) continue;
    const withCat = [...resultedIds].find(rid => rid.startsWith(c.id + '_'));
    if (!withCat) continue;
    const cWords = new Set(_normVideoName(c.nome).split(' ').filter(w => w.length > 4));
    let score = 0;
    for (const w of ownWords) if (cWords.has(w)) score++;
    if (score > bestScore) { bestScore = score; best = withCat; }
  }
  // Richiedi almeno 2 parole significative in comune (es. "GRAN PREMIO
  // SPORTIVI POGGIANA") per evitare falsi positivi tra gare diverse dello
  // stesso giorno con un solo termine generico condiviso.
  return bestScore >= 2 ? best : null;
}

// Sposta le "dirette caricate in anticipo" (chiave sintetica) sul gara_id
// reale non appena i risultati di quella tappa vengono pubblicati —
// altrimenti restano per sempre invisibili sulla pagina della gara (si
// vedono solo nella sezione Media/Dirette, che le recupera con un fallback
// SOLO per la visualizzazione, mai persistito). Va richiamata dopo ogni
// scrape (vedi /api/internal/notify-results) e resta comunque disponibile
// come azione admin per un giro manuale.
async function _reconcilePendingStageVideos() {
  const videos = await readVideos();
  let changed = false;
  for (const gid of Object.keys(videos)) {
    const realId = gid.includes('::')
      ? _findRealGaraIdForPendingVideo(gid)
      : _findRealGaraIdForOrphanCalendarVideo(gid);
    if (!realId) continue;
    const arr = videos[gid] || [];
    if (!videos[realId]) videos[realId] = [];
    const existingUrls = new Set(videos[realId].map(v => v.url));
    for (const v of arr) { if (!existingUrls.has(v.url)) videos[realId].push(v); }
    delete videos[gid];
    changed = true;
    console.log(`[videos] riconciliata diretta in anticipo: ${gid} → ${realId}`);
  }
  if (changed) await writeVideos(videos);
  return changed;
}

// ══════════════════════════════════════════════════════════════════════════════
// Riepilogo mensile (per animare la pagina social oltre ai soli risultati
// gara): top atleti/team del mese per punti, generato automaticamente il
// giorno 1 (notifica push all'admin) e comunque generabile a mano per
// qualsiasi mese dalla dashboard admin. Testo pronto da copiare, stesso
// principio del testo FB per la singola gara (_buildGaraNarrative).
// ══════════════════════════════════════════════════════════════════════════════
const _MONTH_NAMES_IT = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const _RECAP_CAT_ORDER = ['ES1_M','ES1_F','ES2_M','ES2_F','AL_M','AL_F','JUN_M','JUN_F','ELI_M','ELI_F'];
const _RECAP_CAT_LABELS = {
  ES1_M:'Esordienti 1° anno M', ES1_F:'Esordienti 1° anno F',
  ES2_M:'Esordienti 2° anno M', ES2_F:'Esordienti 2° anno F',
  AL_M:'Allievi', AL_F:'Allieve', JUN_M:'Juniores M', JUN_F:'Juniores F',
  ELI_M:'Elite/U23 M', ELI_F:'Elite/U23 F',
};

function _computeMonthlyRecap(resultsRaw, year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const rows = (resultsRaw || []).filter(r => (r.data || '').startsWith(prefix));
  const byAthlete = new Map(), byTeam = new Map(), garaSet = new Set();
  // Aggregazione anche per categoria+sesso — serve per le card individuali
  // "atleta/team del mese" per ogni categoria, richieste in aggiunta al
  // riepilogo generale (che resta top-5 assoluto, senza distinzione).
  const byCatAthlete = new Map(), byCatTeam = new Map();
  for (const r of rows) {
    if (r.gara_id) garaSet.add(r.gara_id);
    const pts = r.punti_effettivi || 0;
    const pos = Number(r.posizione);
    const catCode = _rankingCodeFromRow(r);
    if (r.atleta_id) {
      if (!byAthlete.has(r.atleta_id)) byAthlete.set(r.atleta_id, { atleta_id: r.atleta_id, cognome: r.cognome, nome: r.nome, team: r.team, punti: 0, wins: 0, podi: 0 });
      const a = byAthlete.get(r.atleta_id);
      a.punti += pts;
      if (pos === 1) a.wins++;
      if (pos >= 1 && pos <= 3) a.podi++;
      if (catCode) {
        if (!byCatAthlete.has(catCode)) byCatAthlete.set(catCode, new Map());
        const m = byCatAthlete.get(catCode);
        if (!m.has(r.atleta_id)) m.set(r.atleta_id, { atleta_id: r.atleta_id, cognome: r.cognome, nome: r.nome, team: r.team, punti: 0, p1: 0, p2: 0, p3: 0, gareSet: new Set() });
        const ca = m.get(r.atleta_id);
        ca.punti += pts;
        if (pos === 1) ca.p1++; else if (pos === 2) ca.p2++; else if (pos === 3) ca.p3++;
        if (r.gara_id) ca.gareSet.add(r.gara_id);
      }
    }
    if (r.team_id) {
      if (!byTeam.has(r.team_id)) byTeam.set(r.team_id, { team_id: r.team_id, nome: r.team, punti: 0, wins: 0 });
      const t = byTeam.get(r.team_id);
      t.punti += pts;
      if (pos === 1) t.wins++;
      if (catCode) {
        if (!byCatTeam.has(catCode)) byCatTeam.set(catCode, new Map());
        const m = byCatTeam.get(catCode);
        if (!m.has(r.team_id)) m.set(r.team_id, { team_id: r.team_id, nome: r.team, punti: 0, p1: 0, p2: 0, p3: 0 });
        const ct = m.get(r.team_id);
        ct.punti += pts;
        if (pos === 1) ct.p1++; else if (pos === 2) ct.p2++; else if (pos === 3) ct.p3++;
      }
    }
  }
  const byCategory = {};
  for (const cat of _RECAP_CAT_ORDER) {
    const athletes = [...(byCatAthlete.get(cat) || new Map()).values()]
      .map(a => ({ ...a, gare: a.gareSet.size, gareSet: undefined }))
      .sort((a, b) => b.punti - a.punti);
    const teams = [...(byCatTeam.get(cat) || new Map()).values()].sort((a, b) => b.punti - a.punti);
    if (athletes.length || teams.length) {
      byCategory[cat] = { label: _RECAP_CAT_LABELS[cat], topAthlete: athletes[0] || null, topTeam: teams[0] || null };
    }
  }
  return {
    year, month,
    totalGare: garaSet.size,
    totalRisultati: rows.length,
    topAthletes: [...byAthlete.values()].sort((a, b) => b.punti - a.punti).slice(0, 5),
    topTeams: [...byTeam.values()].sort((a, b) => b.punti - a.punti).slice(0, 5),
    byCategory,
  };
}

function _monthlyRecapText(recap) {
  const lines = [];
  lines.push(`RIEPILOGO ${_MONTH_NAMES_IT[recap.month - 1].toUpperCase()} ${recap.year}`);
  lines.push(`${recap.totalGare} gare disputate`);
  lines.push('');
  if (recap.topAthletes.length) {
    lines.push('🏆 TOP ATLETI DEL MESE');
    recap.topAthletes.forEach((a, i) => lines.push(`${i + 1}. ${a.cognome} ${a.nome} (${a.team || 'N/D'}) — ${a.punti} pt, ${a.wins} vittorie`));
    lines.push('');
  }
  if (recap.topTeams.length) {
    lines.push('🚴 TOP TEAM DEL MESE');
    recap.topTeams.forEach((t, i) => lines.push(`${i + 1}. ${t.nome || t.team_id} — ${t.punti} pt, ${t.wins} vittorie`));
  }
  return lines.join('\n');
}

app.get('/api/admin/monthly-recap/latest', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.json({ recap: null });
    const { data, error } = await supabase.from('kv_store').select('key, value')
      .like('key', 'monthly_recap_%').order('key', { ascending: false }).limit(1);
    if (error) throw error;
    res.json({ recap: data?.[0]?.value || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/monthly-recap/:year/:month', requireAdmin, async (req, res) => {
  try {
    const year = parseInt(req.params.year, 10), month = parseInt(req.params.month, 10);
    if (!year || !month || month < 1 || month > 12) return res.status(400).json({ error: 'anno/mese non validi' });
    const resultsRaw = readDataJson('results_raw.json') || [];
    const recap = _computeMonthlyRecap(resultsRaw, year, month);
    res.json({ recap, text: _monthlyRecapText(recap) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Controllo automatico, chiamato da /api/cron/tick: se oggi è il giorno 1
// del mese e il riepilogo del mese appena concluso non è ancora stato
// generato (flag persistito in kv_store, sopravvive ai redeploy — a
// differenza di una variabile in memoria), lo genera e notifica l'admin via
// push. Il flag stesso è la protezione da invii doppi, niente throttle
// separato necessario.
async function _checkMonthlyRecap() {
  if (!supabase) return;
  const now = new Date();
  if (now.getDate() !== 1) return;
  let month = now.getMonth(); // 0-based: mese-1 = mese scorso (1-based)
  let year = now.getFullYear();
  if (month === 0) { month = 12; year -= 1; }
  const key = `monthly_recap_${year}-${String(month).padStart(2, '0')}`;
  try {
    const { data } = await supabase.from('kv_store').select('key').eq('key', key).single();
    if (data) return; // già generato/inviato per questo mese
    const resultsRaw = readDataJson('results_raw.json') || [];
    const recap = _computeMonthlyRecap(resultsRaw, year, month);
    const text = _monthlyRecapText(recap);
    const { error } = await supabase.from('kv_store')
      .upsert({ key, value: { ...recap, text }, updated_at: now.toISOString() });
    if (error) throw error;
    const admins = await rawQuery(`SELECT id FROM users WHERE role='admin'`).then(r => r.rows).catch(() => []);
    for (const a of admins) {
      sendPushToUser(a.id, {
        title: '📊 Riepilogo mensile pronto',
        body: `${_MONTH_NAMES_IT[month - 1]} ${year}: ${recap.topAthletes[0] ? recap.topAthletes[0].cognome + ' ' + recap.topAthletes[0].nome + ' in testa' : 'testo pronto in dashboard'}.`,
        url: '/#/dashboard',
      }).catch(() => {});
    }
    console.log(`[monthly-recap] Generato e notificato per ${year}-${month}`);
  } catch (e) { console.warn('[monthly-recap] error:', e.message); }
}

// ══════════════════════════════════════════════════════════════════════════════
// Percorsi gara ricostruiti automaticamente (vedi server/route-builder.js) —
// oggetto in kv_store chiave "race_routes", indicizzato per calendar id
// (condiviso fra tutte le categorie della stessa gara/evento).
// ══════════════════════════════════════════════════════════════════════════════
const { buildRaceRoute } = require('./route-builder');

async function readRaceRoutes() {
  if (supabase) {
    const { data, error } = await supabase.from('kv_store').select('value').eq('key', 'race_routes').single();
    if (error && error.code !== 'PGRST116') console.error('[race_routes] read error:', error.message);
    return data?.value || {};
  }
  return {};
}
async function writeRaceRoutes(obj) {
  if (supabase) {
    const { error } = await supabase.from('kv_store')
      .upsert({ key: 'race_routes', value: obj, updated_at: new Date().toISOString() });
    if (error) throw new Error('Supabase write error: ' + error.message);
  }
}

app.get('/api/race-route/:calId', async (req, res) => {
  const routes = await readRaceRoutes();
  const r = routes[req.params.calId];
  if (!r) return res.status(404).json({ error: 'Percorso non disponibile' });
  res.json(r);
});

// Job in background (come pcs-import/xpix): geocodifica + instradamento
// hanno un ritmo imposto dalle policy dei servizi gratuiti usati (Nominatim
// max ~1 richiesta/sec), quindi un giro completo su tutto il calendario
// richiede diversi minuti — non può essere sincrono su una singola richiesta HTTP.
let _routeBuilderJob = null; // { running, log[], done, total, skipped, failed, startedAt }

app.post('/api/admin/route-builder/run', requireAdmin, async (req, res) => {
  if (_routeBuilderJob?.running) return res.status(409).json({ error: 'Già in corso' });
  const force = !!req.body?.force;
  const limit = req.body?.limit ? parseInt(req.body.limit, 10) : null;

  _routeBuilderJob = { running: true, log: [], done: 0, total: 0, skipped: 0, failed: 0, startedAt: new Date().toISOString() };
  res.json({ ok: true, message: 'Generazione percorsi avviata in background' });

  (async () => {
    const job = _routeBuilderJob;
    try {
      const [calendar, raceDetails] = await Promise.all([
        readDataJsonFromGH('calendar.json'),
        readDataJsonFromGH('race_details.json'),
      ]);
      const routes = await readRaceRoutes();
      // Una voce per calendar id — l'evento, non la singola categoria.
      let todo = (calendar || []).filter(g => g.id && (force || !routes[g.id]));
      if (limit) todo = todo.slice(0, limit);
      job.total = todo.length;
      job.log.push(`${todo.length} gare da elaborare (su ${(calendar||[]).length} nel calendario).`);

      for (const g of todo) {
        // race_details.json è indicizzato con la stessa convenzione degli id
        // di calendar.json (stesso slug nome+data) — verificato sui dati reali.
        const det = (raceDetails || {})[g.id];
        if (!det) { job.skipped++; job.done++; continue; }
        try {
          const built = await buildRaceRoute(det);
          if (built) {
            routes[g.id] = built;
            await writeRaceRoutes(routes);
            job.log.push(`✓ ${g.nome} — ${built.isCircuit ? 'circuito (segnaposto)' : (built.geometry ? built.distanceKm + ' km' : 'solo partenza')}`);
          } else {
            job.skipped++;
            job.log.push(`— ${g.nome}: testo insufficiente, saltata`);
          }
        } catch (e) {
          job.failed++;
          job.log.push(`✗ ${g.nome}: ${e.message}`);
        }
        job.done++;
        if (job.log.length > 300) job.log = job.log.slice(-300);
      }
      job.log.push(`Completato: ${job.done} elaborate, ${job.skipped} saltate, ${job.failed} errori.`);
    } catch (e) {
      job.log.push('ERRORE FATALE: ' + e.message);
    } finally {
      job.running = false;
    }
  })();
});

app.get('/api/admin/route-builder/status', requireAdmin, (req, res) => {
  if (!_routeBuilderJob) return res.json({ running: false, log: [], done: 0, total: 0 });
  res.json(_routeBuilderJob);
});
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

// Endpoint pubblico: c'è una diretta IN CORSO ORA da segnalare all'apertura
// del sito? Limita il controllo ai video is_live la cui gara_id contiene una
// data entro ±1 giorno da oggi (le dirette più vecchie sono già concluse da
// tempo, non ha senso ricontrollarle a ogni apertura) — poi verifica lo stato
// reale su YouTube (liveStreamingDetails.actualStartTime senza actualEndTime)
// tramite lo stesso helper già usato per la coda scraper.
// Raccoglie i candidati "diretta di oggi" (video/tappe con is_live=true e
// data == oggi) e il loro stato live/orario da YouTube — condiviso fra
// /api/live-now (chiamato dal client) e checkLiveTransitionsAndNotify()
// (chiamato dal cron server-side per le notifiche push, indipendente da
// eventuali utenti collegati in quel momento).
async function _getLiveNowState() {
  if (!YOUTUBE_API_KEY) return { candidates: [], infoById: {}, todayStr: '' };
  const videos = await readVideos();
  // Data odierna nel fuso delle gare (Italia), non UTC del server: vicino
  // alla mezzanotte le due possono differire di un giorno.
  const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  const candidates = []; // { gid, v, videoId, dateStr }
  for (const [gid, arr] of Object.entries(videos)) {
    for (const v of (arr || [])) {
      if (!v.is_live) continue;
      // Una tappa caricata in anticipo (chiave sintetica "calId::data tappa",
      // vedi window._maddSubmitStageVideo) ha la data della TAPPA dopo "::",
      // non quella di inizio del giro embedded nel calId — usarla altrimenti
      // il banner/countdown/notifica scatterebbe (o non scatterebbe mai) nel
      // giorno sbagliato per ogni tappa successiva alla prima.
      const stageIdx = gid.lastIndexOf('::');
      const dateStr = stageIdx !== -1 ? gid.slice(stageIdx + 2) : (gid.match(/_(\d{4}-\d{2}-\d{2})/) || [])[1];
      // Confronto sulla data ESATTA di oggi, non una tolleranza di ±1 giorno:
      // un organizzatore che apre lo streaming in "sala d'attesa" con un
      // giorno di anticipo (isLiveNow risulta vero su YouTube anche prima
      // che la gara inizi davvero) altrimenti veniva mostrato/notificato un
      // giorno prima del reale inizio della tappa.
      if (dateStr !== todayStr) continue;
      const videoId = _extractYouTubeId(v.url);
      if (!videoId) continue;
      candidates.push({ gid, v, videoId, dateStr });
    }
  }
  if (!candidates.length) return { candidates, infoById: {}, todayStr };
  const infoById = await fetchVideosInfoBatch(candidates.map(c => c.videoId), YOUTUBE_API_KEY);
  return { candidates, infoById, todayStr };
}

// ── Notifiche push "diretta iniziata" ────────────────────────────────────
// Persistenza dei video_id già notificati oggi (kv_store, sopravvive ai
// riavvii del server free-tier) — evita di rinotificare la stessa diretta
// ad ogni tick del cron finché resta "isLiveNow".
async function readLiveNotified() {
  if (supabase) {
    const { data, error } = await supabase.from('kv_store').select('value').eq('key', 'live_notified').maybeSingle();
    if (error) console.error('[live-notified] read error:', error.message);
    return data?.value || {};
  }
  return {};
}
async function writeLiveNotified(obj) {
  if (supabase) {
    const { error } = await supabase.from('kv_store').upsert({ key: 'live_notified', value: obj, updated_at: new Date().toISOString() });
    if (error) console.error('[live-notified] write error:', error.message);
  }
}

// Manda la notifica push per ogni candidato isLiveNow non ancora notificato
// oggi. Riusata sia dal cron server-side sia (con throttle condiviso) dalle
// chiamate client a /api/live-now, così la notifica parte più rapidamente
// quando c'è già qualcuno sul sito, senza dover aspettare il prossimo tick
// del pinger esterno (~10 min) né fare una seconda chiamata a YouTube.
async function _notifyLiveCandidates(liveCands, todayStr) {
  if (!liveCands.length) return;
  try {
    const notified = await readLiveNotified();
    let changed = false;
    for (const c of liveCands) {
      if (notified[c.videoId]) continue;
      // Chiave sintetica "calId::data tappa": la gara reale non esiste
      // ancora, rimanda alla pagina del calendario (l'unica esistente finora).
      const cleanGid = c.gid.includes('::') ? c.gid.split('::')[0] : c.gid;
      await sendPushToAll({
        title: '🔴 Diretta iniziata!',
        body: c.v.title || 'Una diretta è appena iniziata',
        url: `/gara/${encodeURIComponent(cleanGid)}`,
      });
      notified[c.videoId] = todayStr;
      changed = true;
    }
    // Pulizia: tieni solo le ultime 48h, altrimenti l'oggetto cresce all'infinito
    for (const [vid, d] of Object.entries(notified)) {
      if (d === todayStr) continue;
      if ((Date.now() - new Date(d).getTime()) / 86400000 > 2) delete notified[vid];
    }
    if (changed) await writeLiveNotified(notified);
  } catch (e) { console.warn('[live-notify]', e.message); }
}

// Chiamata dal cron server-side (vedi /api/cron/tick): rileva il momento
// esatto in cui una diretta programmata passa da "non ancora iniziata" a
// "isLiveNow" su YouTube, e manda una notifica push a tutti gli iscritti —
// funziona anche per chi non ha il sito aperto in quel momento.
async function checkLiveTransitionsAndNotify() {
  try {
    const { candidates, infoById, todayStr } = await _getLiveNowState();
    const liveCands = candidates.filter(c => infoById[c.videoId]?.isLiveNow);
    await _notifyLiveCandidates(liveCands, todayStr);
  } catch (e) { console.warn('[live-notify]', e.message); }
}

app.get('/api/live-now', async (req, res) => {
  res.set('Cache-Control', 'no-cache');
  try {
    const { candidates, infoById, todayStr } = await _getLiveNowState();
    if (!candidates.length) return res.json({ live: null, upcoming: null });

    const todayMs = Date.now();
    // Notifica push opportunistica: se c'è già traffico sul sito la diretta
    // appena iniziata viene notificata subito invece di aspettare il
    // prossimo tick del pinger esterno (~10 min) — throttle condiviso con
    // /api/cron/tick tramite _lastLiveCheck, quindi anche con molti client
    // collegati in parallelo la scansione non riparte più di una volta ogni
    // 3 min, e non blocca la risposta a questa richiesta (fire-and-forget).
    if (Date.now() - _lastLiveCheck >= 3 * 60 * 1000) {
      _lastLiveCheck = Date.now();
      const liveCandsForNotify = candidates.filter(c => infoById[c.videoId]?.isLiveNow);
      _notifyLiveCandidates(liveCandsForNotify, todayStr);
    }
    const allLiveNow = candidates.filter(c => infoById[c.videoId]?.isLiveNow);
    const liveNow = allLiveNow[0];
    if (liveNow) {
      const toLive = c => ({
        gara_id: c.gid,
        title: c.v.title || c.gid,
        channel: c.v.channel || '',
        url: c.v.url,
        video_id: c.videoId,
      });
      return res.json({
        live: toLive(liveNow),
        // Fino a 2 dirette in contemporanea (multi-schermo): null se ce n'è
        // solo una, altrimenti le prime 2 trovate — il client mostra un
        // pulsante "guarda entrambe" solo quando questo campo è valorizzato.
        liveSecond: allLiveNow.length > 1 ? toLive(allLiveNow[1]) : null,
        upcoming: null,
      });
    }

    // Nessuna diretta attiva ORA: se una di oggi ha un orario programmato
    // futuro noto (scheduledStartTime, salvato al momento dell'inserimento
    // del link — vedi _fetchYouTubeVideoMeta), la segnaliamo come "upcoming"
    // per mostrare un countdown sul sito prima che inizi davvero.
    // (candidates è già filtrato sulla data di oggi da _getLiveNowState)
    const upcomingCands = candidates
      .map(c => ({ ...c, scheduledStart: c.v.scheduled_start || infoById[c.videoId]?.scheduledStartTime || null }))
      .filter(c => c.scheduledStart && new Date(c.scheduledStart).getTime() > todayMs)
      .sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart));
    const next = upcomingCands[0];

    res.json({
      live: null,
      upcoming: next ? {
        gara_id: next.gid,
        title: next.v.title || next.gid,
        channel: next.v.channel || '',
        url: next.v.url,
        video_id: next.videoId,
        scheduled_start: next.scheduledStart,
      } : null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Stato "è ancora davvero live" per OGNI diretta di oggi (non solo le prime
// due mostrate dal banner) — usato dalla pagina Media per spostare una
// diretta appena conclusa fuori dalla sezione "In Diretta Ora" verso "A
// seguire", invece di lasciarla lì semplicemente perché la sua data è
// ancora quella di oggi (is_live=true è un flag statico impostato
// all'inserimento, non riflette da solo la fine reale della trasmissione).
app.get('/api/live-status-today', async (req, res) => {
  res.set('Cache-Control', 'no-cache');
  try {
    const { candidates, infoById } = await _getLiveNowState();
    const status = {};
    for (const c of candidates) status[c.videoId] = !!infoById[c.videoId]?.isLiveNow;
    res.json(status);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Recupera i metadati REALI del video da YouTube — data di pubblicazione
// (snippet.publishedAt) e logo del canale — per gli inserimenti manuali che
// altrimenti avrebbero sempre la data odierna (rendendo inutile un
// ordinamento cronologico "dal più vecchio al più recente") e un'iniziale
// generica al posto del vero logo del canale.
// Ritorna { published_at, channel_avatar } con valori null quando non
// disponibili (URL non riconosciuto, manca la API key, chiamata fallita) —
// i chiamanti ricadono sulla data odierna / iniziale come prima.
async function _fetchYouTubeVideoMeta(url) {
  const videoId = _extractYouTubeId(url);
  if (!videoId || !YOUTUBE_API_KEY) return { published_at: null, channel_avatar: null, scheduled_start: null };
  try {
    const info = (await fetchVideosInfoBatch([videoId], YOUTUBE_API_KEY))[videoId];
    if (!info) return { published_at: null, channel_avatar: null, scheduled_start: null };
    const channel_avatar = info.channelId ? await _getChannelAvatar(info.channelId) : null;
    return { published_at: info.publishedAt || null, channel_avatar, scheduled_start: info.scheduledStartTime || null };
  } catch { return { published_at: null, channel_avatar: null, scheduled_start: null }; }
}

// Metadati (titolo, nome pagina, copertina) di un link video Facebook,
// via scraping dei meta tag Open Graph della pagina pubblica — NON la
// Graph API (che richiederebbe un'app Meta con access token): Facebook
// serve questi tag già pronti a chi si presenta con lo user-agent del
// proprio crawler ufficiale (usato da WhatsApp/Messenger per le anteprime
// dei link), quindi funziona per qualunque video pubblico senza
// autenticazione. Segue anche i redirect dei link "condividi" (facebook.com/share/v/...).
//
// Restituisce anche canonical_url: il player pubblico incorporabile
// (plugins/video.php) NON accetta un link "condividi" (facebook.com/share/v/...,
// verificato dal vivo — mostra "Video non disponibile" anche seguendo il
// redirect da solo) né un link di una diretta ancora sotto /watch/live/?v=...
// (stesso errore) — vuole l'URL canonico finale, ed è lo stesso identico
// video sotto /watch/?v=... (diretta) o /pagina/videos/ID/ (video normale).
// Quindi l'URL salvato per un video Facebook deve sempre essere quello
// risolto qui, non quello incollato dall'admin.
async function _fetchFacebookVideoMeta(url, _depth = 0) {
  const empty = { title: null, channel: null, thumbnail: null, canonical_url: null };
  if (_depth > 3) return empty;
  const https = require('https');
  try {
    const result = await new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' },
      }, (r) => {
        if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location) {
          r.resume();
          return resolve({ redirect: r.headers.location });
        }
        let data = '';
        r.on('data', d => data += d);
        r.on('end', () => resolve({ html: data }));
      });
      req.on('error', reject);
      req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    });
    if (result.redirect) return _fetchFacebookVideoMeta(result.redirect, _depth + 1);
    const html = result.html || '';
    const og = (prop) => {
      const m = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']*)["']`, 'i'))
        || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:${prop}["']`, 'i'));
      return m ? m[1].replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&') : null;
    };
    // /watch/live/?v=ID non è accettato dal player, /watch/?v=ID (stesso ID) sì.
    const canonical = (og('url') || url).replace(/\/watch\/live\/(\?|$)/i, '/watch/$1');
    return { title: og('title'), channel: og('site_name'), thumbnail: og('image'), canonical_url: canonical };
  } catch { return empty; }
}

// Usato dal form "Aggiungi video" in admin per compilare da solo titolo e
// nome pagina quando si incolla un link Facebook, come già succede per
// YouTube via oEmbed (che invece non serve qui, girando lato client, perché
// il fetch diretto a facebook.com dal browser è bloccato da CORS).
app.get('/api/fb-video-meta', requireAuth, async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\/(www\.|m\.|web\.)?(facebook\.com|fb\.watch)\//i.test(url)) {
    return res.status(400).json({ error: 'URL Facebook non valido' });
  }
  res.json(await _fetchFacebookVideoMeta(url));
});

// Submit URL YouTube (utenti autenticati)
app.post('/api/videos/submit', requireAuth, async (req, res) => {
  try {
    const { gara_id, cal_id, url, title, description, channel, atleta_ids, is_live } = req.body;
    if (!gara_id || !url) return res.status(400).json({ error: 'gara_id e url obbligatori' });
    // Usa sempre gara_id (include la categoria es. _JUN_M, _ELI_M) come chiave
    // così ogni categoria della stessa gara ha i propri video separati
    const key = gara_id;
    const tags = [...new Set(String(atleta_ids || '').split(',').map(s => s.trim()).filter(Boolean))].join(',');
    const ytMeta = await _fetchYouTubeVideoMeta(url);
    if (req.user.role === 'admin') {
      const videos = await readVideos();
      if (!videos[key]) videos[key] = [];
      if (videos[key].some(v => v.url === url)) return res.status(409).json({ error: 'Video già presente' });
      videos[key].push({ url, title: title || url, description: description || '', channel: channel || req.user.display_name || 'Admin', published_at: ytMeta.published_at || new Date().toISOString().slice(0,10), channel_avatar: ytMeta.channel_avatar, atleta_ids: tags, is_live: !!is_live, scheduled_start: ytMeta.scheduled_start });
      await writeVideos(videos);
      return res.json({ ok: true, status: 'approved' });
    }
    const pending = await readPendingVideos();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2,7);
    pending.push({ id, gara_id, cal_id: key, type: 'youtube', url, title: title || url, description: description || '', channel: channel || '', atleta_ids: tags, is_live: !!is_live, published_at: ytMeta.published_at, channel_avatar: ytMeta.channel_avatar, scheduled_start: ytMeta.scheduled_start, submitted_by: req.user.display_name || req.user.email, submitted_at: new Date().toISOString() });
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
// Sposta a mano le "dirette caricate in anticipo" sul gara_id reale, senza
// aspettare il prossimo scrape (vedi _reconcilePendingStageVideos).
app.post('/api/admin/videos/reconcile-pending', requireAdmin, async (req, res) => {
  try { res.json({ ok: true, changed: await _reconcilePendingStageVideos() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

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
    videos[key].push({ url: v.url, title: v.title, description: v.description || '', channel: v.channel || v.submitted_by || '', published_at: v.published_at || (v.submitted_at || '').slice(0, 10), channel_avatar: v.channel_avatar || null, atleta_ids: v.atleta_ids || '', is_live: !!v.is_live, scheduled_start: v.scheduled_start || null });
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
    const ytMeta = await _fetchYouTubeVideoMeta(url);
    videos[calId].push({
      url, title: title || url,
      description: description || '',
      channel: channel || 'Admin',
      published_at: ytMeta.published_at || new Date().toISOString().slice(0,10),
      channel_avatar: ytMeta.channel_avatar,
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
    const { url, title, channel, is_live, live_ended } = req.body;
    const videos = await readVideos();
    if (!videos[calId]?.[parseInt(idx)]) return res.status(404).json({ error: 'Video non trovato' });
    const v = videos[calId][parseInt(idx)];
    if (url) v.url = url;
    if (title !== undefined) v.title = title;
    if (channel !== undefined) v.channel = channel;
    if (is_live !== undefined) v.is_live = !!is_live;
    // Distinto da is_live: per le dirette senza rilevamento automatico (es.
    // Facebook, che non ha un equivalente della YouTube Data API) permette di
    // segnare a mano "questa diretta è finita" mantenendo il badge 🔴 DIRETTA
    // (storico) ma spostandola fuori da "In Diretta Ora" — stesso comportamento
    // che per YouTube avviene da solo tramite /api/live-status-today.
    if (live_ended !== undefined) v.live_ended = !!live_ended;
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

// Supabase limita di default a 1000 righe per query (il .limit(5000) viene ignorato).
// Pagina con .range() per leggere TUTTI i profili pcs_atleta — altrimenti gli atleti
// oltre il 1000° spariscono dal frontend (pagina 404).
async function _fetchAllPcsProfiles(select = 'entity_id, new_value') {
  if (!supabase) return [];
  const all = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('entity_overrides').select(select)
      .eq('entity_type', 'pcs_atleta').eq('field', 'profile')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

// Tutti i risultati PCS per un atleta (circuito + extra)
// Restituisce atleti creati da import PCS, in formato extra_roster.json (per il frontend)
// Pagina tutte le righe pcs_gara_results con un atleta_id (oltre il limite di 1000 di Supabase)
async function _fetchAllPcsResultRiders() {
  if (!supabase) return [];
  const all = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('pcs_gara_results').select('atleta_id, rider_name, team_name, gara_id')
      .not('atleta_id', 'is', null).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

// Pagina gli override di team su entity atleta (modifica profilo) — priorità massima
async function _fetchAllAtletaTeamOverrides() {
  if (!supabase) return {};
  const map = {};
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('entity_overrides').select('entity_id, field, new_value')
      .eq('entity_type', 'atleta').in('field', ['team', 'team_id']).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    for (const o of data) { (map[o.entity_id] ||= {})[o.field] = o.new_value; }
    if (data.length < PAGE) break;
  }
  return map;
}

// Risolve identità + team di un atleta PCS unendo le fonti. Priorità del team:
//   override atleta (team_id/team) > profilo pcs_atleta > fuzzy match nome > derivato dal nome.
function _resolvePcsAthlete(aid, sample, profMap, ovMap, teamIndex) {
  const prof = profMap[aid] || {};
  const ov   = ovMap[aid]   || {};
  let cognome = prof.cognome, nome = prof.nome;
  if (!cognome && !nome && sample?.rider_name) {
    const parsed = _parsePcsRiderName(sample.rider_name);
    cognome = parsed.cognome; nome = parsed.nome;
  }
  // Ultimo fallback: deriva da atleta_id (COGNOME_NOME, ultimo segmento = nome)
  if (!cognome && !nome && aid) {
    const parts = aid.split('_');
    nome = (parts.pop() || '').toUpperCase();
    cognome = parts.join(' ').toUpperCase();
  }
  const categoria = prof.categoria || _garaIdToCategoria(sample?.gara_id || '');
  const genere    = prof.genere || (categoria.endsWith('_F') ? 'F' : 'M');
  let teamId   = (ov.team_id || '').trim() || (prof.team_id || '').trim() || null;
  let teamNome = (ov.team || '').trim() || prof.team_nome || sample?.team_name || 'SCONOSCIUTO';
  if (!teamId) {
    const real = _findExistingTeam(teamNome, teamIndex, genere);
    if (real) { teamId = real.tid; teamNome = real.nome; }
    else teamId = _makeTeamId(teamNome);
  } else {
    // se il team_id risolto è reale, usa il suo nome ufficiale
    const realById = teamIndex.find(e => e.tid === teamId);
    if (realById) teamNome = realById.nome;
  }
  return { cognome, nome, categoria, genere, team_id: teamId, team_nome: teamNome };
}

// Insieme delle chiavi atleti FCI (athletes.json), cache 5 min.
let _fciKeysCache = null, _fciKeysTs = 0;
function _fciAthleteKeys() {
  if (_fciKeysCache && (Date.now() - _fciKeysTs) < 300000) return _fciKeysCache;
  let keys = new Set();
  try {
    const p = path.join(__dirname, '..', 'data', 'athletes.json');
    keys = new Set(Object.keys(JSON.parse(fs.readFileSync(p, 'utf8'))));
  } catch {}
  _fciKeysCache = keys; _fciKeysTs = Date.now();
  return keys;
}

function _levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = a[i - 1] === b[j - 1] ? d[i - 1][j - 1]
        : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
    }
  }
  return d[m][n];
}

// Indice cognome|team_id → [nome,...] degli atleti FCI, TENENDO CONTO degli
// eventuali override di squadra (stesso ovMap che risolve i candidati PCS,
// vedi _resolvePcsAthlete) — altrimenti il confronto usa due team_id diversi
// per la stessa persona (es. SAVEKIN_ILIA ha team_id "NEUTRAL_TEAM" nei dati
// FCI grezzi ma è stato riassegnato a "LOKOMOTIV_MANAS" via override, quindi
// senza applicare l'override qui il match cognome+squadra non scatterebbe
// mai). Serve a scartare i "fantasmi" PCS-only che sono in realtà lo STESSO
// atleta FCI con una trascrizione diversa del nome (es. nomi cirillici:
// "ILIA" negli esiti FCI vs "ILYA" nel roster PCS). Ricostruito ad ogni
// chiamata di _buildPcsRosterMap (già cache 90s a quel livello).
function _buildFciFuzzyIndex(ovMap) {
  const byCognomeTeam = new Map();
  try {
    const p = path.join(__dirname, '..', 'data', 'athletes.json');
    const all = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const a of Object.values(all)) {
      if (!a.cognome) continue;
      const teamId = ovMap[a.id]?.team_id || a.team_id;
      if (!teamId) continue;
      const key = `${a.cognome.toUpperCase()}|${teamId}`;
      if (!byCognomeTeam.has(key)) byCognomeTeam.set(key, []);
      byCognomeTeam.get(key).push((a.nome || '').toUpperCase());
    }
  } catch {}
  return byCognomeTeam;
}

// Un candidato PCS-only è un probabile "fantasma" duplicato se esiste già
// un atleta FCI con stesso cognome, stessa squadra, e nome a distanza di
// edit <= 2 (soglia bassa apposta: sorelle/fratelli con stesso cognome e
// stessa squadra sono rari ma possibili, non vogliamo scartarli).
function _isLikelyFciDuplicate(fuzzyIndex, cognome, nome, teamId) {
  if (!cognome || !nome || !teamId) return false;
  const names = fuzzyIndex.get(`${cognome.toUpperCase()}|${teamId}`);
  if (!names) return false;
  const n = nome.toUpperCase();
  return names.some(fciNome => fciNome === n || _levenshtein(fciNome, n) <= 2);
}

// Costruisce la mappa team_id → { nome, atleti[] } degli atleti PCS.
// IMPORTANTE: include SOLO atleti PCS-only (non in athletes.json). Gli atleti FCI
// hanno già un team dai risultati ufficiali; il loro team si cambia solo con un
// override esplicito, applicato a parte dal frontend (così non finiscono nel team
// sbagliato per via di un team_name PCS incoerente, es. nazionali/guest).
// Cache in-memory: questa funzione pagina 3 tabelle Supabase intere (pcs_gara_results
// arriva a 10mila+ righe) a OGNI caricamento del sito da OGNI visitatore — misurato
// a ~3.6s in produzione, il singolo endpoint più lento del caricamento iniziale.
// I dati sottostanti cambiano solo per azioni admin (import/rematch/merge PCS),
// quindi un TTL breve più invalidazione esplicita sui punti di scrittura elimina
// quasi tutto il costo per il caso comune senza rischiare dati stantii a lungo.
let _pcsRosterMapCache = null, _pcsRosterMapTs = 0;
const _PCS_ROSTER_CACHE_TTL = 90000;
function _invalidatePcsRosterCache() { _pcsRosterMapCache = null; }
async function _buildPcsRosterMap() {
  if (_pcsRosterMapCache && (Date.now() - _pcsRosterMapTs) < _PCS_ROSTER_CACHE_TTL) return _pcsRosterMapCache;
  const [riders, profRows, ovMap] = await Promise.all([
    _fetchAllPcsResultRiders(),
    _fetchAllPcsProfiles(),
    _fetchAllAtletaTeamOverrides(),
  ]);
  const profMap = {};
  for (const r of profRows) { try { profMap[r.entity_id] = JSON.parse(r.new_value); } catch {} }
  const teamIndex = _buildTeamIndex();
  const fciKeys = _fciAthleteKeys();

  const seen = {};
  for (const r of riders) { if (r.atleta_id && !seen[r.atleta_id]) seen[r.atleta_id] = r; }
  for (const aid of Object.keys(profMap)) { if (!(aid in seen)) seen[aid] = null; }
  for (const aid of Object.keys(ovMap)) { if (!(aid in seen)) seen[aid] = null; }
  // togli gli atleti FCI: li gestisce il frontend coi dati ufficiali + override
  for (const aid of Object.keys(seen)) { if (fciKeys.has(aid)) delete seen[aid]; }

  const fuzzyIndex = _buildFciFuzzyIndex(ovMap);
  const result = {};
  for (const aid of Object.keys(seen)) {
    const a = _resolvePcsAthlete(aid, seen[aid], profMap, ovMap, teamIndex);
    if (!a.cognome && !a.nome) continue;
    // Stesso cognome + stessa squadra + nome quasi identico a un atleta FCI
    // già esistente (vedi _isLikelyFciDuplicate): quasi certamente lo stesso
    // corridore con una trascrizione diversa del nome, non un fantasma
    // nuovo — saltalo invece di creare un secondo profilo duplicato.
    if (_isLikelyFciDuplicate(fuzzyIndex, a.cognome, a.nome, a.team_id)) continue;
    if (!result[a.team_id]) result[a.team_id] = { nome: a.team_nome, atleti: [] };
    if (!result[a.team_id].atleti.find(x => x.atleta_id === aid)) {
      result[a.team_id].atleti.push({ atleta_id: aid, cognome: a.cognome, nome: a.nome, categoria: a.categoria, genere: a.genere });
    }
  }
  _pcsRosterMapCache = result; _pcsRosterMapTs = Date.now();
  return result;
}

app.get('/api/data/pcs-extra-roster', async (req, res) => {
  if (!supabase) return res.json({});
  try { res.json(await _buildPcsRosterMap()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Mappa atleta_id → { team_id, team } degli override manuali di team (entity atleta).
// Usata dal frontend per riassegnare gli atleti FCI al team scelto (atleti + risultati).
app.get('/api/data/atleta-team-overrides', async (req, res) => {
  if (!supabase) return res.json({});
  try { res.json(await _fetchAllAtletaTeamOverrides()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Righe risultato aggiunte/corrette a mano da un admin (persistono su Postgres,
// così sopravvivono a redeploy e a nuovi passaggi dello scraper FCI, che
// sovrascrive results_raw.json ma non tocca questa tabella). Il frontend le
// unisce a resultsRaw al caricamento di globalData.
app.get('/api/data/manual-results', async (req, res) => {
  try {
    const rows = await queries.getAllManualResults();
    res.json(_dropSupersededManualResults(rows));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Una riga manuale è "superata" quando lo scraper FCI ha nel frattempo
// pubblicato un risultato REALE per lo stesso atleta nella stessa data — il
// gara_id scrapato spesso ha un suffisso categoria/genere diverso da quello
// usato per l'inserimento manuale (fatto sul gara_id del calendario, ancora
// senza suffisso), quindi il confronto va fatto su (atleta_id, data) e non
// sul gara_id esatto. Qui la nascondiamo solo dalla risposta (il frontend fa
// lo stesso identico filtro) senza toccare il DB: la riga resta visibile e
// cancellabile a mano dalla pagina admin di gestione risultati.
function _dropSupersededManualResults(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows || [];
  const resultsRaw = readDataJson('results_raw.json') || [];
  const realKeys = new Set(resultsRaw.filter(r => r.atleta_id && r.data).map(r => `${r.atleta_id}|${r.data}`));
  return rows.filter(r => !(r.atleta_id && r.data && realKeys.has(`${r.atleta_id}|${r.data}`)));
}

// Stessa tabella punti-base dello scraper FCI (scraper/fci_complete_scraper.py BASE_PTS)
const _MANUAL_BASE_PTS = { 1: 15, 2: 12, 3: 10, 4: 8, 5: 6, 6: 5, 7: 4, 8: 3, 9: 2, 10: 1 };

// I km sono uguali per tutti i corridori della stessa gara: se non specificato,
// li prende da un'altra riga (manuale o scrapata) della stessa gara_id.
async function _resolveManualKm(garaId) {
  try {
    const siblings = await queries.getManualResults(garaId);
    const fromManual = siblings.find(r => r.km)?.km;
    if (fromManual) return fromManual;
  } catch {}
  const resultsRaw = readDataJson('results_raw.json') || [];
  const fromScraped = resultsRaw.find(r => r.gara_id === garaId && r.km)?.km;
  return fromScraped || '';
}

// Crea il profilo pcs_atleta (Supabase + extra_roster.json) se l'atleta inserito a
// mano non esiste ancora da nessuna parte — stesso meccanismo usato per gli atleti
// creati dall'import PCS, così ha subito una scheda profilo e finisce nel roster
// del team giusto invece di restare "orfano".
async function _ensureManualAthleteProfile({ atletaId, cognome, nome, teamId, teamNome, categoria, genere }) {
  if (_fciAthleteKeys().has(atletaId)) return false; // già un atleta FCI, non toccare
  if (supabase) {
    const { data: existing } = await supabase.from('entity_overrides')
      .select('id').eq('entity_type', 'pcs_atleta').eq('field', 'profile').eq('entity_id', atletaId).maybeSingle();
    if (existing) return false; // profilo già presente
    const { error } = await supabase.from('entity_overrides').upsert([{
      entity_type: 'pcs_atleta', entity_id: atletaId, field: 'profile',
      new_value: JSON.stringify({ cognome, nome, team_id: teamId, team_nome: teamNome, categoria, genere }),
      edited_by: null,
    }], { onConflict: 'entity_type,entity_id,field' });
    if (error) { console.warn('[manual-result] creazione profilo fallita:', error.message); return false; }
  }
  // Roster locale (fallback quando Supabase non è raggiungibile dal frontend)
  try {
    const rosterPath = path.join(__dirname, '..', 'data', 'extra_roster.json');
    let roster = {};
    try { roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8')); } catch {}
    if (!roster[teamId]) roster[teamId] = { nome: teamNome, atleti: [] };
    if (!roster[teamId].atleti.find(a => a.atleta_id === atletaId)) {
      roster[teamId].atleti.push({ atleta_id: atletaId, nome, cognome, categoria, genere });
      fs.writeFileSync(rosterPath, JSON.stringify(roster, null, 2), 'utf8');
      _commitExtraRosterToGH(roster).catch(() => {});
    }
  } catch (e) { console.warn('[manual-result] extra_roster.json update fallito:', e.message); }
  return true;
}

app.post('/api/admin/gara/:garaId/manual-result', requireAdmin, async (req, res) => {
  try {
    const garaId = req.params.garaId;
    const { posizione, cognome, nome, team, tempo, km, media,
            nome_gara, data, categoria, genere, tipo, moltiplicatore,
            campionato_regionale, campionato_italiano, regione, punti_override } = req.body || {};
    const cognomeU = String(cognome || '').trim().toUpperCase();
    const nomeU    = String(nome || '').trim().toUpperCase();
    const teamU    = String(team || '').trim().toUpperCase();
    // Cognome è opzionale SOLO se c'è un team: serve per le gare a squadre
    // (crono a squadre), dove si vuole correggere posizione/distacco/nome
    // squadra di una riga SENZA per forza indicare già un corridore — niente
    // atleta_id in quel caso, la riga conta solo per la classifica squadre
    // (nessun finto "atleta" creato, vedi sotto).
    if (!posizione || (!cognomeU && !teamU)) return res.status(400).json({ error: 'posizione e (cognome o team) obbligatori' });
    const pos      = parseInt(posizione, 10);
    const mult     = parseInt(moltiplicatore, 10) || 1;
    const puntiBase = _MANUAL_BASE_PTS[pos] || 0;
    // Scala ridotta per formati minori (es. "tipo pista": pochi partecipanti,
    // non rappresentativa come una gara normale — l'admin può forzare il
    // punteggio EFFETTIVO invece di quello calcolato dalla tabella standard,
    // senza toccare punti_base (resta lo storico "quanto varrebbe normalmente").
    const puntiOverride = punti_override != null && punti_override !== '' ? Math.round(Number(punti_override)) : null;
    const atletaId = cognomeU ? _makeAtletaId(cognomeU, nomeU) : '';

    // Team: fuzzy-match su teams.json (rispettando il genere) così finisce nel
    // team reale invece di crearne uno doppione con una stringa leggermente diversa
    let finalTeamId = teamU ? _makeTeamId(teamU) : '';
    let finalTeamNome = teamU;
    if (teamU) {
      const resolved = _findExistingTeam(teamU, _buildTeamIndex(), genere || '');
      if (resolved) { finalTeamId = resolved.tid; finalTeamNome = resolved.nome; }
    }

    // Km: se non specificato, eredita quello della gara (uguale per tutti)
    const finalKm = km || await _resolveManualKm(garaId);

    if (atletaId && atletaId !== '_') {
      // Il profilo pcs_atleta vuole la categoria in formato CODICE (es. "AL_F",
      // "ES1_F"), non l'etichetta leggibile ("Allievi", "Esordienti 1° Anno") che
      // arriva dal form — altrimenti getRankingFileCode non la riconosce e la
      // pagina team non riesce a metterla nel tab/roster giusto.
      const profCategoria = _garaIdToCategoria(garaId);
      const profGenere = profCategoria.endsWith('_F') ? 'F' : 'M';
      await _ensureManualAthleteProfile({
        atletaId, cognome: cognomeU, nome: nomeU,
        teamId: finalTeamId, teamNome: finalTeamNome,
        categoria: profCategoria, genere: profGenere,
      });
    }

    const row = await queries.upsertManualResult({
      gara_id: garaId,
      posizione: pos,
      cognome: cognomeU,
      nome: nomeU,
      atleta_id: atletaId,
      team: finalTeamNome,
      team_id: finalTeamId,
      tempo: tempo || '',
      nome_gara: nome_gara || '',
      data: data || '',
      categoria: categoria || '',
      genere: genere || '',
      tipo: tipo || 'regionale',
      moltiplicatore: mult,
      campionato_regionale: !!campionato_regionale,
      campionato_italiano: !!campionato_italiano,
      regione: regione || '',
      km: finalKm || '',
      media: media || '',
      punti_base: puntiBase,
      punti_effettivi: puntiOverride != null ? puntiOverride : puntiBase * mult,
      edited_by: req.user.id,
    });
    res.json({ ok: true, row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/manual-result/:id', requireAdmin, async (req, res) => {
  try { await queries.deleteManualResult(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Roster PCS di un singolo team — fallback on-demand per la pagina team
app.get('/api/pcs-team/:teamId', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase non disponibile' });
  try {
    const tid = req.params.teamId;
    const map = await _buildPcsRosterMap();
    const bucket = map[tid];
    if (!bucket) return res.status(404).json({ error: 'Team PCS non trovato' });
    res.json({ team_id: tid, team_nome: bucket.nome, atleti: bucket.atleti });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Profilo PCS di un singolo atleta — fallback on-demand quando non è in globalData
app.get('/api/pcs-athlete/:id', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase non disponibile' });
  try {
    const aid = req.params.id;
    const [profR, ovs, sample] = await Promise.all([
      supabase.from('entity_overrides').select('new_value')
        .eq('entity_type', 'pcs_atleta').eq('field', 'profile').eq('entity_id', aid).maybeSingle(),
      supabase.from('entity_overrides').select('field, new_value')
        .eq('entity_type', 'atleta').in('field', ['team', 'team_id']).eq('entity_id', aid),
      supabase.from('pcs_gara_results').select('rider_name, team_name, gara_id')
        .eq('atleta_id', aid).limit(1).maybeSingle(),
    ]);
    const profMap = {}; if (profR.data?.new_value) { try { profMap[aid] = JSON.parse(profR.data.new_value); } catch {} }
    const ovMap = { [aid]: {} }; for (const o of (ovs.data || [])) ovMap[aid][o.field] = o.new_value;
    if (!profMap[aid] && !sample.data && !(ovs.data || []).length) return res.status(404).json({ error: 'Atleta PCS non trovato' });
    const a = _resolvePcsAthlete(aid, sample.data, profMap, ovMap, _buildTeamIndex());
    res.json({ atleta_id: aid, ...a });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/pcs-results/atleta/:atletaId', async (req, res) => {
  const season = parseInt(req.query.season) || new Date().getFullYear();
  try {
    const { data, error } = await supabase
      .from('pcs_results')
      .select('gara_name, data, posizione, distacco, pcs_race_slug, pcs_url, gara_id, country')
      .eq('atleta_id', req.params.atletaId)
      .eq('season', season)
      .order('data', { ascending: false })
      .limit(500);
    if (error) throw error;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Tutti i risultati (dei NOSTRI atleti) per UNA gara estera specifica —
// usato per il modale "risultati gara" al posto del link esterno a PCS: la
// gara resta consultabile sul sito invece di mandare il traffico via.
app.get('/api/pcs-results/gara-estera', async (req, res) => {
  const raceSlug = req.query.race_slug;
  const season = parseInt(req.query.season) || new Date().getFullYear();
  if (!raceSlug) return res.status(400).json({ error: 'race_slug mancante' });
  try {
    const { data, error } = await supabase
      .from('pcs_results')
      .select('atleta_id, gara_name, data, posizione, distacco, country, pcs_url')
      .eq('pcs_race_slug', raceSlug)
      .eq('season', season)
      .order('posizione', { ascending: true, nullsFirst: false })
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
      .like('gara_id', `%${season}-%`)
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
      .like('gara_id', `%${season}-%`)
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

// Normalizza nome per confronto (rimuove accenti, lowercase, solo alfanumerici)
function _normName(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Normalizza per ID (come roster-import.js: trattino, poi uppercase, poi _ al posto di -)
function _normForId(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
}

// Genera atleta_id da cognome + nome (stesso algoritmo di roster-import.js)
function _makeAtletaId(cognome, nome) {
  return _normForId(cognome) + '_' + _normForId(nome);
}

// Genera team_id da nome team
function _makeTeamId(teamName) {
  return _normForId(teamName);
}

// "Squash": rimuove TUTTO ciò che non è alfanumerico (anche spazi) → confronto robusto
// "TEAM MAZZOLA PGC" e "TEAM MAZZOLA P.G.C. U23" → "teammazzolapgc" / "teammazzolapgcu23"
function _squashTeam(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Cerca un team esistente (in teams.json) con nome quasi identico al nome PCS.
// Strategia: 1) squash esatto su nome o id, 2) contenimento squash (min 6 char).
// Niente match per singola parola: troppo rischioso (unirebbe team diversi che
// condividono una parola comune). Restituisce { tid, nome } del team reale o null.
function _findExistingTeam(pcsName, teamEntries, genere) {
  const sq = _squashTeam(pcsName);
  if (!sq) return null;
  // 1) esatto su nome o id (rispettando il genere)
  for (const e of teamEntries) {
    if (!_genderOk(e, genere)) continue;
    if (e.nameSq === sq || e.idSq === sq) return { tid: e.tid, nome: e.nome };
  }
  // 2) contenimento (entrambe le direzioni). Per evitare falsi positivi quando il
  // nome reale è una parola corta comune (es. "VPT VENETO PROJECT TEAM" vs "VENETO"),
  // richiedi che le due stringhe siano di lunghezza simile: il più corto deve essere
  // almeno il 60% del più lungo. Così "TEAM MAZZOLA PGC" ~ "TEAM MAZZOLA P.G.C. U23"
  // (82%) passa, mentre "veneto" dentro "vptvenetoprojectteam" (30%) viene scartato.
  if (sq.length >= 6) {
    for (const e of teamEntries) {
      if (!_genderOk(e, genere)) continue;
      if (e.nameSq.length < 6) continue;
      if (!(e.nameSq.includes(sq) || sq.includes(e.nameSq))) continue;
      const shorter = Math.min(sq.length, e.nameSq.length);
      const longer  = Math.max(sq.length, e.nameSq.length);
      if (shorter / longer >= 0.6) return { tid: e.tid, nome: e.nome };
    }
  }
  return null;
}

// Costruisce l'indice dei team reali da teams.json (per il fuzzy match).
// Ricava i generi (M/F) in cui ogni team compete da `punti_per_cat` (es. {JUN_M, ES1_M})
// così non si uniscono team maschili con femminili. Cache 5 min (teams.json è 4MB).
let _teamIndexCache = null, _teamIndexTs = 0;
function _buildTeamIndex() {
  if (_teamIndexCache && (Date.now() - _teamIndexTs) < 300000) return _teamIndexCache;
  const out = [];
  try {
    const teamsPath = path.join(__dirname, '..', 'data', 'teams.json');
    const obj = JSON.parse(fs.readFileSync(teamsPath, 'utf8'));
    for (const [tid, t] of Object.entries(obj)) {
      const nome = t.nome || tid;
      const genders = new Set();
      for (const cat of Object.keys(t.punti_per_cat || {})) {
        if (cat.endsWith('_M')) genders.add('M');
        else if (cat.endsWith('_F')) genders.add('F');
      }
      out.push({ tid, nome, nameSq: _squashTeam(nome), idSq: _squashTeam(tid), genders });
    }
  } catch {}
  _teamIndexCache = out; _teamIndexTs = Date.now();
  return out;
}

// Un team reale è compatibile col genere richiesto se compete in quel genere
// (oppure se non abbiamo dati di genere — non blocchiamo in mancanza d'info).
function _genderOk(entry, genere) {
  if (!genere) return true;
  if (!entry.genders || entry.genders.size === 0) return true;
  return entry.genders.has(genere);
}

// Rivaluta categoria/genere e team di ogni profilo pcs_atleta.
// Storicamente _garaIdToCategoria non riconosceva _AL_/_ES1_/_ES2_ e ricadeva
// sempre su 'ELI_M': i profili creati PRIMA del fix hanno genere/categoria
// sbagliati salvati nel JSON (es. atlete Esordienti/Allieve segnate 'M' e
// quindi cercate/messe in un team maschile). Qui si ricalcola categoria/genere
// da una riga campione dei risultati PCS di quell'atleta (con la regex corretta)
// e SOLO SE cambia si aggiorna il profilo e si ri-fa il fuzzy match del team.
// Rende "↺ Rimatch Atleti" capace di auto-correggere anche questi casi vecchi.
async function _fixPcsAthleteTeams() {
  if (!supabase) return 0;
  const teamIndex = _buildTeamIndex();
  if (!teamIndex.length) return 0;
  let fixed = 0;
  try {
    // Prima gara nota di ogni atleta, per ricalcolare categoria/genere corretti.
    // Include sia le righe PCS sia i risultati inseriti a mano (manual_results):
    // un atleta creato SOLO da un risultato manuale non ha righe in pcs_gara_results,
    // quindi senza questa seconda fonte il suo profilo non verrebbe mai ricontrollato.
    const sampleGaraByAtleta = {};
    for (const r of await _fetchAllPcsResultRiders()) {
      if (r.atleta_id && !sampleGaraByAtleta[r.atleta_id]) sampleGaraByAtleta[r.atleta_id] = r.gara_id;
    }
    for (const r of await queries.getAllManualResults()) {
      if (r.atleta_id && !sampleGaraByAtleta[r.atleta_id]) sampleGaraByAtleta[r.atleta_id] = r.gara_id;
    }

    const data = await _fetchAllPcsProfiles('id, entity_id, new_value');
    for (const row of (data || [])) {
      let p; try { p = JSON.parse(row.new_value); } catch { continue; }
      let changed = false;

      const sampleGara = sampleGaraByAtleta[row.entity_id];
      if (sampleGara) {
        const realCat = _garaIdToCategoria(sampleGara);
        const realGen = realCat.endsWith('_F') ? 'F' : 'M';
        if (realCat !== p.categoria || realGen !== p.genere) {
          p.categoria = realCat; p.genere = realGen; changed = true;
        }
      }

      const real = _findExistingTeam(p.team_nome || '', teamIndex, p.genere);
      if (real && real.tid !== p.team_id) { p.team_id = real.tid; p.team_nome = real.nome; changed = true; }

      if (changed) {
        const { error } = await supabase.from('entity_overrides')
          .update({ new_value: JSON.stringify(p) }).eq('id', row.id);
        if (!error) fixed++;
      }
    }
  } catch (e) { console.warn('[pcs] fix team profili fallito:', e.message); }
  return fixed;
}

// Divide nome PCS "COGNOME Nome" → { cognome, nome } tutto uppercase
// PCS: parole senza lettere minuscole = cognome; prima parola con lowercase = inizio nome
function _parsePcsRiderName(fullName) {
  if (!fullName) return { cognome: '', nome: '' };
  const words = fullName.trim().split(/\s+/);
  if (words.length === 1) return { cognome: words[0].toUpperCase(), nome: '' };
  let firstLower = words.findIndex(w => /[a-z]/.test(w));
  if (firstLower <= 0) firstLower = words.length - 1; // all-caps: last word = nome
  return {
    cognome: words.slice(0, firstLower).join(' ').toUpperCase(),
    nome:    words.slice(firstLower).join(' ').toUpperCase(),
  };
}

// Estrae categoria (es. ELI_M, JUN_F, ES1_F) dal gara_id.
// BUG STORICO: mancavano AL (Allievi), ES1/ES2 (Esordienti) — un gara_id che
// finiva con _ES1_F o _AL_F non veniva mai riconosciuto e ricadeva sempre sul
// default 'ELI_M', facendo finire atlete donne nel team/categoria maschile.
function _garaIdToCategoria(garaId) {
  const m = (garaId || '').match(/_(ELI|JUN|AL|ES1|ES2)_(M|F)$/i);
  return m ? m[0].slice(1).toUpperCase() : 'ELI_M';
}

// Committa extra_roster.json su GitHub via Contents API (usa GH_DISPATCH_TOKEN)
async function _commitExtraRosterToGH(rosterData) {
  const token = process.env.GH_DISPATCH_TOKEN;
  const repo  = process.env.GH_REPO || 'Vezz90/italiacrit';
  if (!token) { console.warn('[pcs] GH_DISPATCH_TOKEN mancante — extra_roster non persistito su GitHub'); return; }
  try {
    const content = Buffer.from(JSON.stringify(rosterData, null, 2), 'utf8').toString('base64');
    const filePath = 'data/extra_roster.json';
    const apiBase  = `https://api.github.com/repos/${repo}/contents/${filePath}`;
    const headers  = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'italiacrit-server',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const getResp = await fetch(apiBase, { headers });
    if (!getResp.ok) throw new Error(`GET SHA: HTTP ${getResp.status}`);
    const { sha } = await getResp.json();
    const putResp = await fetch(apiBase, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'chore: add PCS athletes/teams from web import', content, sha }),
    });
    if (!putResp.ok) throw new Error(`PUT: HTTP ${putResp.status} — ${(await putResp.text()).slice(0, 200)}`);
    console.log('[pcs] extra_roster.json committato su GitHub');
  } catch (e) {
    console.warn('[pcs] commit extra_roster su GitHub fallito:', e.message);
  }
}

// Crea atleti e team mancanti, aggiorna atleta_id nelle righe.
// Idempotente: ricrea il profilo per ogni atleta_id che non esiste ancora tra
// gli atleti noti (athletes.json + extra_roster.json + Supabase pcs_atleta),
// anche se la riga aveva già un atleta_id impostato da un import precedente.
// Restituisce il numero di profili nuovi salvati su Supabase.
async function _createMissingPcsAthletes(rows, garaId) {
  const rosterPath = path.join(__dirname, '..', 'data', 'extra_roster.json');
  const athletesPath = path.join(__dirname, '..', 'data', 'athletes.json');

  // Carica mappe esistenti
  let roster = {};
  try { roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8')); } catch {}
  let athletesKeys = new Set();
  try { athletesKeys = new Set(Object.keys(JSON.parse(fs.readFileSync(athletesPath, 'utf8')))); } catch {}

  // Set di atleta_id già noti: athletes.json + extra_roster.json + Supabase pcs_atleta
  const knownIds = new Set(athletesKeys);
  for (const bucket of Object.values(roster)) {
    for (const a of (bucket.atleti || [])) knownIds.add(a.atleta_id);
  }
  if (supabase) {
    try {
      const data = await _fetchAllPcsProfiles('entity_id');
      for (const r of (data || [])) knownIds.add(r.entity_id);
    } catch (e) { console.warn('[pcs] load pcs_atleta ids fallito:', e.message); }
  }

  // Indice dei team reali (teams.json) per il fuzzy match
  const teamIndex = _buildTeamIndex();

  const categoria = _garaIdToCategoria(garaId);
  const genere    = categoria.endsWith('_F') ? 'F' : 'M';
  const toUpsert  = [];
  let created = 0;
  let modified = false;

  for (const row of rows) {
    if (!row.rider_name) continue;

    // Se ha già un atleta_id che corrisponde a un atleta noto, lascialo così
    if (row.atleta_id && knownIds.has(row.atleta_id)) continue;

    const { cognome, nome } = _parsePcsRiderName(row.rider_name);
    if (!cognome) continue;

    const atletaId = _makeAtletaId(cognome, nome);
    if (!atletaId || atletaId === '_') continue;

    row.atleta_id = atletaId;

    // Già noto (anche se la riga prima non lo aveva)? niente da creare
    if (knownIds.has(atletaId)) continue;

    // Team: prima cerca un team reale (teams.json) con nome quasi identico,
    // così l'atleta finisce nel team già esistente invece di crearne un doppione.
    const pcsTeamNome = (row.team_name || 'SCONOSCIUTO').toUpperCase();
    const existing    = _findExistingTeam(pcsTeamNome, teamIndex, genere);
    const teamId      = existing ? existing.tid  : _makeTeamId(pcsTeamNome);
    const teamNome    = existing ? existing.nome : pcsTeamNome;

    // Registra l'atleta nel roster sotto il team_id risolto (reale o nuovo) così
    // il frontend lo associa al team corretto
    if (!roster[teamId]) { roster[teamId] = { nome: teamNome, atleti: [] }; modified = true; }
    if (!roster[teamId].atleti.find(a => a.atleta_id === atletaId)) {
      roster[teamId].atleti.push({ atleta_id: atletaId, nome, cognome, categoria, genere });
      modified = true;
    }
    knownIds.add(atletaId);
    created++;

    toUpsert.push({
      entity_type: 'pcs_atleta', entity_id: atletaId, field: 'profile',
      new_value: JSON.stringify({ cognome, nome, team_id: teamId, team_nome: teamNome, categoria, genere }),
      edited_by: null,
    });
  }

  // Salva su Supabase (persistente, sopravvive ai redeploy) — atteso, così sappiamo se fallisce
  if (supabase && toUpsert.length) {
    const { error } = await supabase.from('entity_overrides')
      .upsert(toUpsert, { onConflict: 'entity_type,entity_id,field' });
    if (error) console.warn('[pcs] Supabase upsert pcs_atleta fallito:', error.message);
    else console.log(`[pcs] ${toUpsert.length} profili pcs_atleta salvati su Supabase`);
  }

  if (modified) {
    try { fs.writeFileSync(rosterPath, JSON.stringify(roster, null, 2), 'utf8'); }
    catch (e) { console.warn('[pcs] extra_roster.json write failed:', e.message); }
    _commitExtraRosterToGH(roster).catch(() => {});
  }

  return created;
}

// Costruisce mappa nome→atleta_id dagli atleti nel sistema
function _buildAthleteMap() {
  const map = new Map();
  try {
    const athletesPath = path.join(__dirname, '..', 'data', 'athletes.json');
    const obj = JSON.parse(fs.readFileSync(athletesPath, 'utf8'));
    for (const [id, a] of Object.entries(obj)) {
      const c = a.cognome || '', n = a.nome || '';
      if (!c && !n) continue;
      map.set(_normName(c + ' ' + n), id);
      map.set(_normName(n + ' ' + c), id);
    }
  } catch {}
  // Anche extra_roster.json
  try {
    const rosterPath = path.join(__dirname, '..', 'data', 'extra_roster.json');
    const obj = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
    for (const entry of Object.values(obj)) {
      for (const a of (entry.atleti || [])) {
        if (!a.atleta_id) continue;
        const c = a.cognome || '', n = a.nome || '';
        map.set(_normName(c + ' ' + n), a.atleta_id);
        map.set(_normName(n + ' ' + c), a.atleta_id);
      }
    }
  } catch {}
  return map;
}

// Versione async che include anche gli atleti PCS salvati su Supabase
async function _buildAthleteMapAsync() {
  const map = _buildAthleteMap();
  if (!supabase) return map;
  try {
    const { data } = await supabase
      .from('entity_overrides')
      .select('entity_id, new_value')
      .eq('entity_type', 'pcs_atleta')
      .eq('field', 'profile')
      .limit(5000);
    for (const row of (data || [])) {
      try {
        const p = JSON.parse(row.new_value);
        const c = p.cognome || '', n = p.nome || '';
        map.set(_normName(c + ' ' + n), row.entity_id);
        map.set(_normName(n + ' ' + c), row.entity_id);
      } catch {}
    }
  } catch {}
  return map;
}

// Estrae il primo orario valido (M:SS o H:MM:SS) dalla cella tempo di PCS.
// PCS mette due span (visibile + nascosto) con lo stesso valore → cheerio.text()
// li concatena ("1:501:50", "3:54:043:54:04", ",,1:50"). Prendiamo solo il primo
// token orario così il distacco è pulito.
function _extractPcsTime(raw) {
  if (!raw) return null;
  const s = String(raw);
  // Cronometro PCS: il tempo è "M.SS,hh" (punto = minuti.secondi, virgola = centesimi),
  // es. "0.15,65" = +0:15, "29.03,54" = 29:03. Lo normalizziamo in "M:SS".
  // La virgola distingue questo formato dalla colonna media (es. "45.838", senza virgola).
  const tt = s.match(/(\d{1,3})\.(\d{2}),\d+/);
  if (tt && parseInt(tt[2], 10) < 60) return `${tt[1]}:${tt[2]}`;
  const m = s.match(/\d{1,2}:\d{2}(?::\d{2})?/);
  return m ? m[0] : null;
}

// Converte un orario PCS ("M:SS" o "H:MM:SS") in secondi.
function _pcsTimeToSec(raw) {
  const t = _extractPcsTime(raw);
  if (!t) return null;
  const p = t.split(':').map(Number);
  if (p.some(isNaN)) return null;
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return p[0];
}

// Sceglie la colonna del DISTACCO in modo robusto: in ogni classifica il distacco
// cresce con la posizione, quindi tra le colonne con valori orari scegliamo quella
// i cui secondi sono monotòni crescenti (ignorando il vincitore). Questo evita di
// leggere colonne sbagliate (es. "Today"/UCI) nelle pagine GC e cronometro PCS.
// `iTimeHeader` (colonna dedotta dall'header) è usata solo come tiebreak.
function _pickGapColumn(rawRows, nCols, skip, iTimeHeader) {
  const ordered = rawRows.filter(r => r.pos >= 2).sort((a, b) => a.pos - b.pos);
  let best = -1, bestScore = -1;
  for (let c = 0; c < nCols; c++) {
    if (skip.has(c)) continue;
    const seq = ordered.map(r => r.colSec[c]);
    const present = seq.filter(v => v != null);
    if (present.length < Math.max(3, Math.floor(seq.length * 0.6))) continue;
    let ok = 0, tot = 0, prev = null;
    for (const v of seq) {
      if (v == null) continue;
      if (prev != null) { tot++; if (v >= prev) ok++; }
      prev = v;
    }
    if (tot === 0) continue;
    const monoFrac = ok / tot;
    if (monoFrac < 0.85) continue;
    // punteggio: monotonìa + copertura + bonus se è la colonna tempo da header
    const score = monoFrac + (present.length / seq.length) * 0.05 + (c === iTimeHeader ? 0.1 : 0);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best >= 0 ? best : iTimeHeader;
}

// Estrae tabella risultati dall'HTML con cheerio
// PCS mette il link del team DENTRO la cella del rider → usa solo il primo <a> per il nome
function _parsePcsResultsHtml(html, garaId, season, pcsSlug) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  const athleteMap = _buildAthleteMap();
  const rows = [];
  $('table').each((_, table) => {
    if (rows.length) return false;
    // Salta le tabelle dentro i tab NASCOSTI di PCS (.hide): nelle pagine a tappe
    // la pagina contiene sia la tappa sia il GC sia le altre classifiche, ma solo
    // il tab attivo è visibile. Parsare la prima tabella prenderebbe quella sbagliata.
    if ($(table).parents('.hide').length) return;
    const headers = $(table).find('th').map((_, el) => $(el).text().trim().toLowerCase()).get();
    const hasRnk   = headers.some(h => /rnk|pos|#/.test(h));
    const hasRider = headers.some(h => /rider|name|cyclist/.test(h));
    if (!hasRnk || !hasRider) return;
    let iPos = -1, iRider = -1, iTeam = -1, iTime = -1;
    headers.forEach((h, i) => {
      if (iPos   < 0 && /rnk|pos|#/.test(h))           iPos   = i;
      if (iRider < 0 && /rider|name|cyclist/.test(h))  iRider = i;
      if (iTeam  < 0 && /team/.test(h))                 iTeam  = i;
      if (iTime  < 0 && /time|gap|\//.test(h))         iTime  = i;
    });

    const linkFirst = cell => {
      const c = $(cell);
      const a = c.find('a').first();
      return (a.length ? a.text() : c.text()).replace(/\s+/g, ' ').trim();
    };
    const fullText = cell => $(cell).text().replace(/\s+/g, ' ').trim();

    // Primo passaggio: raccogli tutte le righe con i secondi di OGNI colonna
    const raw = [];
    let nCols = 0;
    $(table).find('tbody tr').each((_, tr) => {
      const cells = $(tr).find('td').toArray();
      if (cells.length < 2) return;
      nCols = Math.max(nCols, cells.length);
      const pos = parseInt(fullText(cells[iPos]));
      const rider = iRider >= 0 ? linkFirst(cells[iRider]) : '';
      if (!pos || !rider) return;
      raw.push({
        pos, rider,
        team: iTeam >= 0 ? linkFirst(cells[iTeam]) : '',
        colSec:  cells.map(c => _pcsTimeToSec(fullText(c))),
        colText: cells.map(c => fullText(c)),
      });
    });
    if (!raw.length) return;

    // Scegli la colonna distacco per monotonìa
    const skip = new Set([iPos, iRider, iTeam].filter(i => i >= 0));
    const gapCol = _pickGapColumn(raw, nCols, skip, iTime);

    for (const r of raw) {
      const distacco = r.pos === 1 ? null
        : (gapCol >= 0 ? _extractPcsTime(r.colText[gapCol]) : null);
      rows.push({
        gara_id: garaId, season, posizione: r.pos, rider_name: r.rider,
        team_name: r.team || null, distacco,
        pcs_race_slug: pcsSlug, atleta_id: athleteMap.get(_normName(r.rider)) || null,
      });
    }
  });
  return rows;
}

// Ripassa i risultati inseriti a mano (manual_results): riempie i km mancanti
// (ereditandoli da un'altra riga della stessa gara), crea il profilo atleta se
// manca e ri-fa il fuzzy match del team — utile per le righe inserite prima di
// questi fix, o quando la gara non ha righe PCS (quindi il rematch normale la
// salterebbe del tutto).
async function _backfillManualResults(garaId) {
  const rows = garaId ? await queries.getManualResults(garaId) : await queries.getAllManualResults();
  let fixed = 0;
  for (const row of rows) {
    let changed = false;
    let km = row.km;
    if (!km) { km = await _resolveManualKm(row.gara_id); if (km) changed = true; }

    let teamId = row.team_id, teamNome = row.team;
    if (row.team) {
      const resolved = _findExistingTeam(row.team, _buildTeamIndex(), row.genere || '');
      if (resolved && resolved.tid !== row.team_id) { teamId = resolved.tid; teamNome = resolved.nome; changed = true; }
    }

    if (row.atleta_id) {
      // Categoria in formato codice (vedi commento nell'endpoint manual-result)
      const profCategoria = _garaIdToCategoria(row.gara_id);
      const profGenere = profCategoria.endsWith('_F') ? 'F' : 'M';
      const created = await _ensureManualAthleteProfile({
        atletaId: row.atleta_id, cognome: row.cognome, nome: row.nome || '',
        teamId, teamNome, categoria: profCategoria, genere: profGenere,
      });
      if (created) changed = true;
    }

    if (!changed) continue;
    await queries.upsertManualResult({
      gara_id: row.gara_id, posizione: row.posizione, cognome: row.cognome, nome: row.nome || '',
      atleta_id: row.atleta_id, team: teamNome, team_id: teamId, tempo: row.tempo || '',
      nome_gara: row.nome_gara || '', data: row.data || '', categoria: row.categoria || '',
      genere: row.genere || '', tipo: row.tipo || 'regionale', moltiplicatore: row.moltiplicatore || 1,
      campionato_regionale: !!row.campionato_regionale, campionato_italiano: !!row.campionato_italiano,
      regione: row.regione || '', km: km || '', media: row.media || '',
      punti_base: row.punti_base || 0, punti_effettivi: row.punti_effettivi || 0,
      edited_by: row.edited_by,
    });
    fixed++;
  }
  return fixed;
}

// Rimatch atleta_id su tutte le righe di pcs_gara_results già importate
app.post('/api/admin/pcs-rematch-athletes', requireAdmin, async (req, res) => {
  try {
    const garaId = req.query.gara_id || null;
    const manualFixed = await _backfillManualResults(garaId);
    // _fixPcsAthleteTeams ricontrolla TUTTI i profili pcs_atleta (non solo quelli
    // di questa gara): deve girare sempre, non solo quando la gara ha righe PCS,
    // altrimenti cliccare "Rimatch" su una gara FCI-nativa (senza righe PCS, es.
    // un campionato italiano con solo risultati manuali) non correggerebbe mai
    // categoria/genere di un profilo creato/sbagliato lì.
    const teamFixed = await _fixPcsAthleteTeams();

    if (!supabase) return res.json({ ok: true, updated: 0, total: 0, newAtleti: 0, teamFixed, manualFixed });

    // Carica tutte le righe (con team_name per poter creare profili)
    let query = supabase.from('pcs_gara_results').select('id, gara_id, rider_name, team_name, atleta_id');
    if (garaId) query = query.eq('gara_id', garaId);
    const { data: sbRows, error } = await query.limit(5000);
    if (error) throw error;
    if (!sbRows?.length) return res.json({ ok: true, updated: 0, total: 0, newAtleti: 0, teamFixed, manualFixed });

    // Ricorda l'atleta_id originale per capire cosa è cambiato
    for (const row of sbRows) row._orig = row.atleta_id || null;

    // Prima: match per nome con atleti già nel sistema (inclusi i PCS su Supabase)
    const athleteMap = await _buildAthleteMapAsync();
    for (const row of sbRows) {
      if (!row.atleta_id) {
        const matched = athleteMap.get(_normName(row.rider_name)) || null;
        if (matched) row.atleta_id = matched;
      }
    }

    // Secondo: per OGNI riga, assicura un atleta_id valido e crea i profili mancanti.
    // Idempotente: ricrea profili anche per righe con atleta_id che non esiste più
    // (es. profili persi in un redeploy passato).
    const byGara = {};
    for (const row of sbRows) {
      const gid = row.gara_id || garaId || 'UNKNOWN_ELI_M';
      (byGara[gid] ||= []).push(row);
    }
    let newAtleti = 0;
    for (const [gid, garaRows] of Object.entries(byGara)) {
      newAtleti += await _createMissingPcsAthletes(garaRows, gid);
    }

    // Aggiorna Supabase solo per le righe il cui atleta_id è cambiato
    let updated = 0;
    for (const row of sbRows) {
      if (row.atleta_id && row.atleta_id !== row._orig) {
        await supabase.from('pcs_gara_results').update({ atleta_id: row.atleta_id }).eq('id', row.id);
        updated++;
      }
    }

    console.log(`[rematch] ${updated}/${sbRows.length} righe aggiornate, ${newAtleti} nuovi profili, ${teamFixed} team corretti, ${manualFixed} risultati manuali sistemati`);
    _invalidatePcsRosterCache();
    res.json({ ok: true, updated, total: sbRows.length, newAtleti, teamFixed, manualFixed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Suggerisce, per ogni team PCS NON ancora collegato a un team reale, i possibili
// team reali simili (parole condivise / contenimento) da unire manualmente.
function _teamSuggestions(pcsNome, teamEntries, genere) {
  const sq = _squashTeam(pcsNome);
  const STOP = new Set(['team','cycling','asd','club','sc','gs','uc','us','ssd','ciclistica','velo','pro','racing']);
  const words = w => String(w || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter(x => x.length >= 4 && !STOP.has(x));
  const pcsWords = new Set(words(pcsNome));
  const out = [];
  for (const e of teamEntries) {
    if (!_genderOk(e, genere)) continue;   // non suggerire team di genere diverso
    let score = 0;
    // parole significative condivise
    const realWords = words(e.nome);
    for (const w of realWords) if (pcsWords.has(w)) score += 3;
    // contenimento squash
    if (sq.length >= 5 && e.nameSq.length >= 5 && (e.nameSq.includes(sq) || sq.includes(e.nameSq))) score += 4;
    if (score > 0) out.push({ tid: e.tid, nome: e.nome, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 4);
}

// Elenco dei team PCS (profili pcs_atleta) con possibili corrispondenze reali
app.get('/api/admin/pcs-team-suggestions', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase non disponibile' });
    const teamIndex = _buildTeamIndex();
    const realIds = new Set(teamIndex.map(e => e.tid));
    const data = await _fetchAllPcsProfiles('new_value');
    // Raggruppa per team PCS (tiene traccia del genere prevalente del gruppo)
    const groups = {};
    for (const row of (data || [])) {
      let p; try { p = JSON.parse(row.new_value); } catch { continue; }
      const tid = p.team_id || 'SCONOSCIUTO';
      if (realIds.has(tid)) continue;            // già un team reale → niente da suggerire
      if (!groups[tid]) groups[tid] = { team_id: tid, team_nome: p.team_nome || tid, count: 0, genere: p.genere || null };
      groups[tid].count++;
    }
    const list = Object.values(groups)
      .filter(g => g.team_id !== 'SCONOSCIUTO')
      .map(g => ({ ...g, candidates: _teamSuggestions(g.team_nome, teamIndex, g.genere) }))
      .filter(g => g.candidates.length)
      .sort((a, b) => b.candidates[0].score - a.candidates[0].score);
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Unisci tutti gli atleti di un team PCS in un team reale (o rinomina manualmente)
app.post('/api/admin/pcs-merge-team', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase non disponibile' });
    const { from_id, to_id, to_nome } = req.body || {};
    if (!from_id || !to_id || !to_nome) return res.status(400).json({ error: 'from_id, to_id e to_nome richiesti' });
    const data = await _fetchAllPcsProfiles('id, entity_id, new_value');

    // Protezione genere: il team reale di destinazione deve competere nel genere
    // degli atleti che stiamo spostando (evita di unire uomini con donne).
    const targetTeam = _buildTeamIndex().find(e => e.tid === to_id);
    const srcGeneri = new Set();
    for (const row of (data || [])) {
      try { const p = JSON.parse(row.new_value); if ((p.team_id || 'SCONOSCIUTO') === from_id && p.genere) srcGeneri.add(p.genere); } catch {}
    }
    if (targetTeam && targetTeam.genders && targetTeam.genders.size) {
      const incompat = [...srcGeneri].filter(g => !targetTeam.genders.has(g));
      if (incompat.length) {
        return res.status(409).json({
          error: `Genere incompatibile: "${to_nome}" compete in ${[...targetTeam.genders].join('/')}, ` +
                 `ma stai spostando atleti ${incompat.join('/')}. Scegli un team del genere corretto.`,
        });
      }
    }

    let updated = 0;
    for (const row of (data || [])) {
      let p; try { p = JSON.parse(row.new_value); } catch { continue; }
      if ((p.team_id || 'SCONOSCIUTO') !== from_id) continue;
      p.team_id = to_id; p.team_nome = to_nome;
      const { error: uErr } = await supabase.from('entity_overrides')
        .update({ new_value: JSON.stringify(p) }).eq('id', row.id);
      if (!uErr) {
        updated++;
        // Rimuovi override atleta/team(_id) che vincerebbero sulla visualizzazione
        await supabase.from('entity_overrides').delete()
          .eq('entity_type', 'atleta').eq('entity_id', row.entity_id).in('field', ['team', 'team_id']);
      }
    }
    _invalidatePcsRosterCache();
    res.json({ ok: true, updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Elenco atleti PCS con team sconosciuto o assente
app.get('/api/admin/pcs-orphan-athletes', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase non disponibile' });
    const data = await _fetchAllPcsProfiles('entity_id, new_value');
    const out = [];
    for (const row of (data || [])) {
      let p; try { p = JSON.parse(row.new_value); } catch { continue; }
      const tid = (p.team_id || '').trim();
      if (!tid || tid === 'SCONOSCIUTO') {
        out.push({ atleta_id: row.entity_id, cognome: p.cognome || '', nome: p.nome || '', team_nome: p.team_nome || '' });
      }
    }
    out.sort((a, b) => (a.cognome || '').localeCompare(b.cognome || ''));
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Assegna manualmente un team a un atleta PCS
app.post('/api/admin/pcs-set-athlete-team', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase non disponibile' });
    const { atleta_id, team_id, team_nome } = req.body || {};
    if (!atleta_id || !team_id || !team_nome) return res.status(400).json({ error: 'atleta_id, team_id e team_nome richiesti' });
    // Carica il profilo se esiste, altrimenti creane uno (anche per atleti senza profilo,
    // es. quelli con solo override o solo righe risultato)
    const { data: existing } = await supabase
      .from('entity_overrides').select('new_value')
      .eq('entity_type', 'pcs_atleta').eq('field', 'profile').eq('entity_id', atleta_id).maybeSingle();
    let p = {};
    if (existing?.new_value) { try { p = JSON.parse(existing.new_value); } catch {} }
    if (!p.cognome && !p.nome) {
      const { data: s } = await supabase.from('pcs_gara_results')
        .select('rider_name, gara_id').eq('atleta_id', atleta_id).limit(1).maybeSingle();
      if (s?.rider_name) { const pn = _parsePcsRiderName(s.rider_name); p.cognome = pn.cognome; p.nome = pn.nome; }
      const cat = p.categoria || _garaIdToCategoria(s?.gara_id || '');
      p.categoria = cat; p.genere = p.genere || (cat.endsWith('_F') ? 'F' : 'M');
    }
    p.team_id = team_id; p.team_nome = team_nome;
    const { error: uErr } = await supabase.from('entity_overrides').upsert(
      { entity_type: 'pcs_atleta', entity_id: atleta_id, field: 'profile', new_value: JSON.stringify(p), edited_by: null },
      { onConflict: 'entity_type,entity_id,field' });
    if (uErr) throw uErr;
    // Rimuovi eventuali override atleta/team(_id) che vincerebbero sulla visualizzazione,
    // così il team appena assegnato è quello mostrato e linkato.
    await supabase.from('entity_overrides').delete()
      .eq('entity_type', 'atleta').eq('entity_id', atleta_id).in('field', ['team', 'team_id']);
    _invalidatePcsRosterCache();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Import risultati PCS — prima prova HTTP fetch, poi Playwright headless come fallback
app.post('/api/admin/gara/:garaId/pcs-import', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase non disponibile' });
    const garaId = req.params.garaId;

    // Leggi slug configurato su Supabase
    const { data: ovRow } = await supabase
      .from('entity_overrides')
      .select('new_value')
      .eq('entity_type', 'gara').eq('entity_id', garaId).eq('field', 'pcs_race_slug')
      .single();
    if (!ovRow?.new_value) return res.status(404).json({ error: 'Slug PCS non configurato per questa gara' });
    const pcsSlug = ovRow.new_value.replace(/\/result$/, '').replace(/\/$/, '');
    const season = parseInt(pcsSlug.match(/\/(\d{4})/)?.[1]) || new Date().getFullYear();

    const PCS = 'https://www.procyclingstats.com';
    const hasPfx = /^(race|national-race|stage-race|one-day-race)\//.test(pcsSlug);
    const urls = hasPfx
      ? [`${PCS}/${pcsSlug}/result`, `${PCS}/${pcsSlug}`]
      : [`${PCS}/race/${pcsSlug}/result`, `${PCS}/race/${pcsSlug}`,
         `${PCS}/national-race/${pcsSlug}/result`, `${PCS}/national-race/${pcsSlug}`];

    const reqHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
    };

    const hasResults = t => t.includes('<table') && (t.toLowerCase().includes('rider') || t.toLowerCase().includes('cyclist'));

    // Tentativo 1: HTTP fetch semplice
    let html = null, usedUrl = null;
    for (const url of urls) {
      try {
        const resp = await fetch(url, { headers: reqHeaders, redirect: 'follow' });
        console.log(`[pcs-import] fetch ${url} → ${resp.status}`);
        if (!resp.ok) continue;
        const text = await resp.text();
        if (hasResults(text)) { html = text; usedUrl = url; break; }
      } catch (e) { console.log(`[pcs-import] fetch error: ${e.message}`); }
    }

    // Tentativo 2: Playwright headless (bypassa anti-bot Cloudflare)
    if (!html) {
      console.log('[pcs-import] fetch bloccato, provo Playwright headless…');
      let browser;
      try {
        const { chromium } = require('playwright');
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
        const ctx = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          locale: 'it-IT', viewport: { width: 1280, height: 800 },
        });
        await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
        const page = await ctx.newPage();
        for (const url of urls) {
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
            const finalUrl = page.url();
            console.log(`[pcs-import] playwright → ${finalUrl}`);
            if (finalUrl === 'https://www.procyclingstats.com/' || finalUrl.includes('pagenotfound')) continue;
            await page.waitForTimeout(1500);
            const text = await page.content();
            if (hasResults(text)) { html = text; usedUrl = url; break; }
          } catch (e) { console.log(`[pcs-import] playwright nav error: ${e.message}`); }
        }
      } catch (e) { console.log('[pcs-import] Playwright non disponibile:', e.message); }
      finally { if (browser) await browser.close().catch(() => {}); }
    }

    if (!html) return res.status(502).json({
      error: `PCS non ha restituito risultati. Verifica che lo slug "${pcsSlug}" esista su procyclingstats.com`
    });
    console.log(`[pcs-import] pagina trovata: ${usedUrl}`);

    const parsedRows = _parsePcsResultsHtml(html, garaId, season, pcsSlug);
    if (!parsedRows.length) return res.status(422).json({ error: 'Nessun corridore trovato nella pagina PCS. Struttura tabella non riconosciuta.' });

    const newAtleti = await _createMissingPcsAthletes(parsedRows, garaId);
    await supabase.from('pcs_gara_results').delete().eq('gara_id', garaId);
    const { error: insErr } = await supabase.from('pcs_gara_results').insert(parsedRows);
    if (insErr) throw insErr;

    console.log(`[pcs-import] ${garaId}: ${parsedRows.length} corridori salvati, ${newAtleti} nuovi profili creati`);
    _invalidatePcsRosterCache();
    res.json({ ok: true, riders: parsedRows.length, newAtleti, slug: pcsSlug, url: usedUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Import risultati PCS da HTML incollato manualmente (bypassa anti-bot)
app.post('/api/admin/gara/:garaId/pcs-import-html', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase non disponibile' });
    const garaId = req.params.garaId;
    const html   = req.body?.html;
    if (!html || html.length < 100) return res.status(400).json({ error: 'HTML mancante o troppo corto' });

    // Leggi slug da Supabase per associare i risultati
    const { data: ovRow } = await supabase
      .from('entity_overrides').select('new_value')
      .eq('entity_type', 'gara').eq('entity_id', garaId).eq('field', 'pcs_race_slug').single();
    const pcsSlug = (ovRow?.new_value || '').replace(/\/result$/, '').replace(/\/$/, '') || garaId;
    const season  = parseInt(pcsSlug.match(/\/(\d{4})/)?.[1]) || new Date().getFullYear();

    const parsedRows = _parsePcsResultsHtml(html, garaId, season, pcsSlug);
    if (!parsedRows.length) return res.status(422).json({ error: 'Nessun corridore trovato. Assicurati di aver incollato il sorgente della pagina risultati PCS.' });

    const newAtleti = await _createMissingPcsAthletes(parsedRows, garaId);
    await supabase.from('pcs_gara_results').delete().eq('gara_id', garaId);
    const { error: insErr } = await supabase.from('pcs_gara_results').insert(parsedRows);
    if (insErr) throw insErr;

    console.log(`[pcs-import-html] ${garaId}: ${parsedRows.length} corridori salvati, ${newAtleti} nuovi profili creati`);
    _invalidatePcsRosterCache();
    res.json({ ok: true, riders: parsedRows.length, newAtleti, slug: pcsSlug });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// YouTube Auto-Scraper
// ══════════════════════════════════════════════════════════════════════════════
const { DEFAULT_CHANNELS, fetchAllChannels, fetchVideoDuration, fetchVideoLiveInfo, fetchVideosInfoBatch, fetchChannelAvatars, resolveHandle } = require('./youtube-scraper');
// YouTube Data API v3 (opzionale): se impostata, usata al posto dello scraping
// della pagina watch per durata/stato-diretta, perché lo scraping viene ormai
// bloccato da YouTube (risposta 429 + redirect a un consent/CAPTCHA wall) sugli
// IP dei server cloud come Render. Mai hardcodare: solo da env/.env.local.
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';

// Cache in-memory (per-processo) channelId → URL logo canale, per non rifare
// la stessa chiamata channels.list ad ogni video dello stesso canale.
const _channelAvatarCache = {};
async function _getChannelAvatar(channelId) {
  if (!channelId || !YOUTUBE_API_KEY) return null;
  if (channelId in _channelAvatarCache) return _channelAvatarCache[channelId];
  const map = await fetchChannelAvatars([channelId], YOUTUBE_API_KEY);
  const url = map[channelId] || null;
  _channelAvatarCache[channelId] = url;
  return url;
}

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

// Canali YouTube registrati per l'import automatico continuo in Media Video
// (popolato da POST /api/admin/media/import-channel al primo import massiccio).
async function readYTMediaChannels() {
  if (supabase) {
    const { data, error } = await supabase.from('kv_store').select('value').eq('key', 'yt_media_channels').single();
    if (error && error.code !== 'PGRST116') console.error('[yt_media_channels] read error:', error.message);
    return data?.value || [];
  }
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '../data/yt_media_channels.json'), 'utf8')); } catch { return []; }
}
async function writeYTMediaChannels(arr) {
  if (supabase) {
    const { error } = await supabase.from('kv_store')
      .upsert({ key: 'yt_media_channels', value: arr, updated_at: new Date().toISOString() });
    if (error) throw new Error('Supabase write: ' + error.message);
    return;
  }
  fs.writeFileSync(path.join(__dirname, '../data/yt_media_channels.json'), JSON.stringify(arr, null, 2));
}

// Feed podcast registrati per il sync automatico delle nuove puntate (stesso
// concetto di yt_media_channels, per i podcast importati via RSS/Spotify).
async function readPodcastFeeds() {
  if (supabase) {
    const { data, error } = await supabase.from('kv_store').select('value').eq('key', 'podcast_feeds').single();
    if (error && error.code !== 'PGRST116') console.error('[podcast_feeds] read error:', error.message);
    return data?.value || [];
  }
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '../data/podcast_feeds.json'), 'utf8')); } catch { return []; }
}
async function writePodcastFeeds(arr) {
  if (supabase) {
    const { error } = await supabase.from('kv_store')
      .upsert({ key: 'podcast_feeds', value: arr, updated_at: new Date().toISOString() });
    if (error) throw new Error('Supabase write: ' + error.message);
    return;
  }
  fs.writeFileSync(path.join(__dirname, '../data/podcast_feeds.json'), JSON.stringify(arr, null, 2));
}

// Rileva se un video YouTube è uno Short — la durata NON è un segnale
// affidabile (dal 2024 YouTube accetta Shorts fino a 3 minuti, e ci sono
// video normali per i social altrettanto brevi): l'unico modo corretto è
// quello che usa YouTube stesso, cioè se l'URL youtube.com/shorts/{id}
// resta tale o viene rimandato automaticamente a /watch?v= (un video NON
// Short non ha una pagina /shorts/ propria, quindi redirige).
async function isYouTubeShort(videoId) {
  try {
    const r = await fetch(`https://www.youtube.com/shorts/${videoId}`, { redirect: 'follow' });
    return r.url.includes('/shorts/');
  } catch { return false; } // errore di rete: non escludiamo per un dubbio
}
async function filterOutShorts(videoIds, includeShorts) {
  if (includeShorts) return new Set();
  const shorts = new Set();
  const CONCURRENCY = 8;
  for (let i = 0; i < videoIds.length; i += CONCURRENCY) {
    const batch = videoIds.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async id => [id, await isYouTubeShort(id)]));
    for (const [id, isShort] of results) if (isShort) shorts.add(id);
  }
  return shorts;
}

// Controlla i canali registrati per novità (solo la prima pagina della
// playlist upload, cioè i più recenti) e importa in automatico i video nuovi
// nel palinsesto scelto al momento della registrazione del canale.
async function syncMediaChannels() {
  if (!YOUTUBE_API_KEY) return { added: 0 };
  const channels = await readYTMediaChannels();
  let added = 0;
  for (const ch of channels) {
    try {
      const plUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${ch.uploadsPlaylist}&maxResults=25&key=${YOUTUBE_API_KEY}`;
      const plResp = await fetch(plUrl).then(r => r.json());
      if (plResp.error) { console.warn('[media-yt-sync] errore canale', ch.displayName, plResp.error.message); continue; }
      const existing = await queries.getMediaVideosByProfile(ch.profileId);
      const existingUrls = new Set(existing.map(v => v.url));
      const candidateIds = (plResp.items || []).map(it => it.snippet?.resourceId?.videoId).filter(Boolean);
      const shorts = await filterOutShorts(candidateIds, ch.includeShorts);
      const liveInfoById = await fetchVideosInfoBatch(candidateIds, YOUTUBE_API_KEY);
      for (const item of (plResp.items || [])) {
        const vid = item.snippet?.resourceId?.videoId;
        if (!vid) continue;
        if (shorts.has(vid)) continue;
        const url = `https://www.youtube.com/watch?v=${vid}`;
        if (existingUrls.has(url)) continue;
        await queries.createMediaVideo({
          media_profile_id: ch.profileId, palinsesto: ch.palinsesto,
          title: item.snippet?.title || 'Video',
          description: (item.snippet?.description || '').slice(0, 500),
          source_type: 'link', url,
          thumbnail_url: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '',
          published_at: item.snippet?.publishedAt || null,
          series: ch.series || null,
          is_live: !!liveInfoById[vid]?.isLiveContent,
          scheduled_start: liveInfoById[vid]?.scheduledStartTime || null,
        });
        added++;
      }
      // Ricontrolla le dirette di QUESTO creator già segnate is_live ma non
      // ancora concluse: appena YouTube smette di segnarle come "in corso",
      // le spostiamo fuori dal badge "🔴 diretta ora".
      const stillLive = existing.filter(v => v.is_live && !v.live_ended);
      if (stillLive.length) {
        const liveCheck = await fetchVideosInfoBatch(stillLive.map(v => { const m = (v.url||'').match(/[?&]v=([\w-]+)/); return m ? m[1] : null; }).filter(Boolean), YOUTUBE_API_KEY);
        for (const v of stillLive) {
          const m = (v.url || '').match(/[?&]v=([\w-]+)/);
          const vid2 = m ? m[1] : null;
          const info = vid2 ? liveCheck[vid2] : null;
          // isLiveNow è true SOLO mentre la trasmissione è realmente in corso
          // (actualStartTime presente, actualEndTime assente) — appena YouTube
          // registra la fine, questo passa a false e segniamo la diretta conclusa.
          if (info && !info.isLiveNow) await queries.markMediaVideoLiveEnded(v.id);
        }
      }
    } catch (e) { console.warn('[media-yt-sync] errore canale', ch.displayName, e.message); }
  }
  return { added };
}

app.post('/api/admin/media/sync-channels', requireAdmin, async (req, res) => {
  try { res.json({ ok: true, ...(await syncMediaChannels()) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

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

  // Raccogli prima tutti i nuovi video candidati, poi chiedi durata/diretta in
  // blocco (batch da 50 con l'API ufficiale se c'è una key, altrimenti scraping
  // uno a uno come fallback) invece di una richiesta HTTP per video nel loop.
  const candidates = [];
  for (const [chId, videos] of Object.entries(fetched)) {
    const ch = channels.find(c => c.id === chId);
    for (const v of videos) {
      if (knownUrls.has(v.url)) continue;
      if (!_isVideoRecent(v)) continue;
      knownUrls.add(v.url);
      const videoId = (v.url.match(/[?&]v=([\w-]+)/) || [])[1];
      candidates.push({ chId, ch, v, videoId });
    }
  }

  let liveInfoById = {};
  if (YOUTUBE_API_KEY) {
    liveInfoById = await fetchVideosInfoBatch(candidates.map(c => c.videoId), YOUTUBE_API_KEY);
  }

  // Loghi canale (logo reale al posto dell'iniziale generica sulle card) —
  // un'unica chiamata batch per tutti i channelId distinti coinvolti.
  let avatarByChannelId = {};
  if (YOUTUBE_API_KEY) {
    const chIds = [...new Set(Object.values(liveInfoById).map(v => v.channelId).filter(Boolean))];
    avatarByChannelId = await fetchChannelAvatars(chIds, YOUTUBE_API_KEY);
  }

  for (const { chId, ch, v, videoId } of candidates) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    // Segnale diretta: richiede isLiveContent (trasmesso via infrastruttura
    // live di YouTube) E (durata > 1 ora O ancora in corso ora) — isLiveContent
    // da solo include anche le "Premiere" (video normali con anteprima
    // programmata) e dirette brevi (interviste post-gara), che non sono la
    // gara vera; una diretta ancora in corso non ha durata finalizzata, quindi
    // conta comunque. Usato come suggerimento automatico nella queue, l'admin
    // conferma o toglie.
    const liveInfo = videoId
      ? (liveInfoById[videoId] || (YOUTUBE_API_KEY ? { duration: null, isLiveContent: false, isLiveNow: false } : await fetchVideoLiveInfo(videoId)))
      : { duration: null, isLiveContent: false, isLiveNow: false };
    const { duration, isLiveContent, isLiveNow } = liveInfo;
    queue.push({
      id,
      channel_id:   chId,
      channel_name: ch?.name || chId,
      url:          v.url,
      title:        v.title,
      published_at: liveInfo.publishedAt || v.published_at,
      channel_avatar: liveInfo.channelId ? (avatarByChannelId[liveInfo.channelId] || null) : null,
      thumbnail:    v.thumbnail,
      status:       'pending',
      suggested_gara_id: null,
      added_at:     new Date().toISOString(),
      duration_seconds: duration,
      // diretta E (>39min O in corso ora): soglia scelta per lasciar fuori
      // gare "regolari" più brevi di un video normale (che potrebbero durare
      // anche 15-30 min) pur restando sotto l'ora delle gare Esordienti/
      // Allievi più lunghe, evitando falsi positivi da trailer/interviste.
      is_live_guess: !!(isLiveContent && (isLiveNow || (duration && duration > 2340))),
    });
    added++;
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

async function autoMediaChannelsSync() {
  try {
    const r = await syncMediaChannels();
    if (r.added) console.log(`[media-yt-auto] ${r.added} nuovi video importati automaticamente in Media Video`);
  } catch (e) { console.warn('[media-yt-auto] Errore:', e.message); }
}

// Ricontrolla i feed podcast registrati: nuove puntate pubblicate dall'ultimo
// giro vengono importate da sole, stesso principio del sync canali YouTube.
async function syncPodcastFeeds() {
  const feeds = await readPodcastFeeds();
  let added = 0;
  for (const feed of feeds) {
    try {
      const xml = await fetch(feed.feedUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); });
      const { items } = _parsePodcastRss(xml);
      const existing = await queries.getMediaVideosByProfile(feed.profileId);
      const existingUrls = new Set(existing.map(v => v.url));
      for (const ep of items) {
        if (existingUrls.has(ep.url)) continue;
        await queries.createMediaVideo({
          media_profile_id: feed.profileId, palinsesto: feed.palinsesto, title: ep.title, description: ep.description,
          source_type: 'link', url: ep.url, thumbnail_url: ep.thumbnail_url, published_at: ep.published_at,
        });
        added++;
      }
    } catch (e) { console.warn('[podcast-sync] errore feed', feed.displayName, e.message); }
  }
  return { added };
}
async function autoPodcastFeedsSync() {
  try {
    const r = await syncPodcastFeeds();
    if (r.added) console.log(`[podcast-auto] ${r.added} nuove puntate importate automaticamente`);
  } catch (e) { console.warn('[podcast-auto] Errore:', e.message); }
}

// GET queue
app.get('/api/admin/youtube/queue', requireAdmin, async (req, res) => {
  try { res.json({ queue: await readYTQueue() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST approva: assegna video a una gara e lo pubblica
// Bucket "virtuali" nella stessa mappa videos[] (chiave = gara_id normalmente)
// per contenuti NON legati a nessuna gara specifica: presentazioni squadra,
// programmi TV. Riusano tutta l'infrastruttura esistente (readVideos/
// writeVideos, la stessa pagina Media) invece di uno storage separato.
// "altro": video reali (spesso di gara) che lo scraper trova ma non riesce a
// collegare a nessuna gara del calendario (titolo troppo diverso, gara
// straniera, gara non ancora censita) — prima restavano bloccati in coda
// senza un modo pulito per pubblicarli comunque.
const MEDIA_EXTRA_BUCKETS = { presentazione: '__PRESENTAZIONI__', programma_tv: '__PROGRAMMI_TV__', altro: '__ALTRO__' };

app.post('/api/admin/youtube/queue/:id/approve', requireAdmin, async (req, res) => {
  try {
    const { gara_id, gara_ids, title, channel, is_live, tipo } = req.body;
    // "Presentazione"/"Programma TV": non serve nessuna gara, va nel bucket virtuale.
    const extraBucket = MEDIA_EXTRA_BUCKETS[tipo];
    const targets = extraBucket
      ? [extraBucket]
      : (Array.isArray(gara_ids) && gara_ids.length ? gara_ids : (gara_id ? [gara_id] : []));
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
          channel_avatar: item.channel_avatar || null,
          is_live:      !!is_live,
          duration_seconds: item.duration_seconds || null,
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

// Aggiunta manuale diretta di Presentazioni/Programmi TV (nessuna gara da
// scegliere) dalla pagina Media — per reinserire a mano video già scartati
// dalla coda scraper, o per contenuti che non passano mai dallo scraper.
app.post('/api/admin/media/extra', requireAdmin, async (req, res) => {
  try {
    const { tipo, url, title, channel } = req.body;
    const bucket = MEDIA_EXTRA_BUCKETS[tipo];
    if (!bucket) return res.status(400).json({ error: 'tipo non valido (presentazione | programma_tv | altro)' });
    if (!url) return res.status(400).json({ error: 'url obbligatorio' });
    const videos = await readVideos();
    if (!videos[bucket]) videos[bucket] = [];
    if (videos[bucket].some(v => v.url === url)) return res.status(409).json({ error: 'Video già presente' });
    const ytMeta = await _fetchYouTubeVideoMeta(url);
    videos[bucket].push({
      url, title: title || url, channel: channel || '',
      published_at: ytMeta.published_at || new Date().toISOString().slice(0, 10),
      channel_avatar: ytMeta.channel_avatar,
    });
    await writeVideos(videos);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/media/extra/:tipo/:idx', requireAdmin, async (req, res) => {
  try {
    const bucket = MEDIA_EXTRA_BUCKETS[req.params.tipo];
    if (!bucket) return res.status(400).json({ error: 'tipo non valido' });
    const idx = parseInt(req.params.idx, 10);
    const videos = await readVideos();
    if (!videos[bucket] || !videos[bucket][idx]) return res.status(404).json({ error: 'Non trovato' });
    videos[bucket].splice(idx, 1);
    await writeVideos(videos);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ricontrolla TUTTI i video YouTube già pubblicati (videos.json) contro il
// criterio vero (isLiveContent E durata > 1 ora): marca is_live quelli non
// ancora segnalati che lo soddisfano, E smarca quelli già segnalati che NON
// lo soddisfano più (falsi positivi da run precedenti, es. con la sola
// isLiveContent, che prende anche "Premiere" e dirette brevi non-gara) — così
// non serve controllare i video uno a uno a mano.
// Con YOUTUBE_API_KEY impostata usa la Data API v3 in batch da 50 (nessuna
// nuova ricerca: sono gli stessi ID video già nel nostro DB, solo lookup);
// senza key ripiega sullo scraping della pagina watch uno a uno, che YouTube
// blocca sistematicamente dagli IP dei server cloud (vedi fetchVideoLiveInfo).
app.post('/api/admin/youtube/detect-live', requireAdmin, async (req, res) => {
  try {
    const videos = await readVideos();
    const candidates = [];
    for (const [gid, arr] of Object.entries(videos)) {
      (arr || []).forEach((v, idx) => {
        const vid = (v.url || '').match(/[?&]v=([\w-]+)/)?.[1] || (v.url || '').match(/youtu\.be\/([\w-]+)/)?.[1];
        if (!vid) return;
        candidates.push({ gid, idx, vid, wasLive: !!v.is_live });
      });
    }
    let checked = 0, marked = 0, unmarked = 0;
    const reasonCounts = {}; // diagnostica: perché un video NON è stato marcato

    const _apply = (c, dur, isLiveContent, isLiveNow, reason) => {
      checked++;
      // Una diretta ANCORA IN CORSO (isLiveNow) qualifica sempre, anche se la
      // durata non è ancora nota/finalizzata da YouTube — altrimenti una gara
      // trasmessa in questo momento sparirebbe dal sito proprio mentre è utile
      // vederla, prima che il video superi "sulla carta" la soglia di durata.
      // Soglia 39 min: lascia fuori video "normali" più brevi (che potrebbero
      // durare 15-30 min) restando sotto le gare Esordienti/Allievi più lunghe
      // (spesso 40-50 min), evitando falsi positivi da trailer/interviste.
      const qualifies = isLiveContent && (isLiveNow || (dur && dur > 2340));
      if (qualifies && !c.wasLive) {
        videos[c.gid][c.idx].is_live = true;
        if (dur) videos[c.gid][c.idx].duration_seconds = dur;
        marked++;
      } else if (!qualifies && c.wasLive) {
        videos[c.gid][c.idx].is_live = false;
        unmarked++;
        const key = reason || (isLiveContent ? 'live_ma_troppo_breve' : 'non_diretta');
        reasonCounts[key] = (reasonCounts[key] || 0) + 1;
      } else if (!qualifies) {
        const key = reason || (isLiveContent ? 'live_ma_troppo_breve' : 'non_diretta');
        reasonCounts[key] = (reasonCounts[key] || 0) + 1;
      }
    };

    if (YOUTUBE_API_KEY) {
      const infoById = await fetchVideosInfoBatch(candidates.map(c => c.vid), YOUTUBE_API_KEY);
      for (const c of candidates) {
        const info = infoById[c.vid] || { duration: null, isLiveContent: false, isLiveNow: false, reason: 'not_returned_by_api' };
        _apply(c, info.duration, info.isLiveContent, info.isLiveNow, info.reason);
      }
    } else {
      const CONCURRENCY = 5;
      for (let i = 0; i < candidates.length; i += CONCURRENCY) {
        const batch = candidates.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (c) => {
          const { duration: dur, isLiveContent, reason } = await fetchVideoLiveInfo(c.vid);
          _apply(c, dur, isLiveContent, false, reason || 'no_api_key_scraping_fallback');
        }));
      }
    }
    if (marked || unmarked) await writeVideos(videos);
    res.json({ ok: true, checked, marked, unmarked, total: candidates.length, reasonCounts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ricalcola data di pubblicazione reale + logo canale per TUTTI i video già
// salvati in videos.json (incluse Presentazioni/Programmi TV). Serve per i
// video aggiunti a mano PRIMA che _fetchYouTubeVideoMeta esistesse: quelli
// hanno published_at = data di inserimento (non quella vera di YouTube),
// che rende inutile l'ordinamento cronologico, e nessun channel_avatar
// (mostrano l'iniziale generica). Va lanciato una tantum dall'admin.
app.post('/api/admin/youtube/backfill-metadata', requireAdmin, async (req, res) => {
  try {
    if (!YOUTUBE_API_KEY) return res.status(400).json({ error: 'YOUTUBE_API_KEY non configurata' });
    const videos = await readVideos();
    const candidates = [];
    for (const [gid, arr] of Object.entries(videos)) {
      (arr || []).forEach((v, idx) => {
        const vid = _extractYouTubeId(v.url);
        if (!vid) return;
        candidates.push({ gid, idx, vid });
      });
    }
    const infoById = await fetchVideosInfoBatch(candidates.map(c => c.vid), YOUTUBE_API_KEY);
    const chIds = [...new Set(Object.values(infoById).map(v => v.channelId).filter(Boolean))];
    const avatarByChannelId = await fetchChannelAvatars(chIds, YOUTUBE_API_KEY);

    let updated = 0;
    for (const c of candidates) {
      const info = infoById[c.vid];
      if (!info) continue;
      const v = videos[c.gid][c.idx];
      let changed = false;
      if (info.publishedAt && v.published_at !== info.publishedAt) { v.published_at = info.publishedAt; changed = true; }
      const avatar = info.channelId ? (avatarByChannelId[info.channelId] || null) : null;
      if (avatar && v.channel_avatar !== avatar) { v.channel_avatar = avatar; changed = true; }
      if (v.is_live && info.scheduledStartTime && v.scheduled_start !== info.scheduledStartTime) { v.scheduled_start = info.scheduledStartTime; changed = true; }
      if (changed) updated++;
    }
    if (updated) await writeVideos(videos);
    res.json({ ok: true, checked: candidates.length, updated });
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
    // maybeSingle: nessuna riga → data null (ok). Errore reale → lancia, così i
    // chiamanti (sync/approve) NON sovrascrivono la coda con un array vuoto e non
    // perdono gli stati approvato/scartato per un errore transitorio di rete.
    const { data, error } = await supabase.from('kv_store').select('value').eq('key', 'xpix_queue').maybeSingle();
    if (error) throw new Error('read xpix_queue: ' + error.message);
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

    // Riconcilia con le foto GIÀ pubblicate: se un album è presente in xpix_photos
    // ma in coda risulta ancora "pending" (es. la coda era stata resettata), segnalo
    // come approvato — così non ricompare tra le foto da approvare.
    try {
      const published = await readXpixPhotos();
      const garaBySlug = {};
      for (const [gid, ph] of Object.entries(published || {})) {
        if (ph?.album_slug) (garaBySlug[ph.album_slug] ||= []).push(gid);
      }
      for (const item of queue) {
        if (item.status === 'pending' && item.album_slug && garaBySlug[item.album_slug]) {
          item.status = 'approved';
          item.approved_gara_ids = garaBySlug[item.album_slug];
          item.approved_gara_id  = garaBySlug[item.album_slug][0];
        }
      }
    } catch (e) { console.warn('[xpix-sync] riconciliazione foto:', e.message); }

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
const _xpixImgCache = new Map(); // url → { buf, ct, ts }
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

// Proxy immagini xpix.it: il loro storage (xpix.fsn1.your-objectstorage.com)
// non manda alcun header CORS, quindi un fetch(mode:'cors') diretto dal
// browser fallisce SEMPRE (non è un problema di rete lenta) — impediva alla
// grafica di condivisione di usare la foto xpix come sfondo. Stesso
// meccanismo già usato per ciclismo.info sopra.
app.get('/api/xpix-image', async (req, res) => {
  try {
    const target = req.query.url;
    if (!target || !/^https:\/\/xpix\.fsn1\.your-objectstorage\.com\//i.test(target)) {
      return res.status(400).send('url non valido');
    }
    const cached = _xpixImgCache.get(target);
    if (cached && (Date.now() - cached.ts) < 3600000) {
      res.set('Content-Type', cached.ct);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(cached.buf);
    }
    const https = require('https');
    const u = new URL(target);
    const proxyReq = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 },
      proxyRes => {
        if (proxyRes.statusCode !== 200) { res.status(502).send('fetch fallito'); proxyRes.resume(); return; }
        const chunks = [];
        proxyRes.on('data', c => chunks.push(c));
        proxyRes.on('end', () => {
          const buf = Buffer.concat(chunks);
          const ct = proxyRes.headers['content-type'] || 'image/jpeg';
          _xpixImgCache.set(target, { buf, ct, ts: Date.now() });
          if (_xpixImgCache.size > 500) _xpixImgCache.delete(_xpixImgCache.keys().next().value);
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
    const { display_name, bio, website, instagram, facebook, media_type } = req.body;
    if (!display_name?.trim()) return res.status(400).json({ error: 'Il nome è obbligatorio' });
    if (!['foto', 'video', 'entrambi'].includes(media_type)) return res.status(400).json({ error: 'Specifica se Media Foto, Media Video o entrambi' });
    const profile = await queries.createMediaProfile({
      user_id: req.user.id,
      display_name: display_name.trim(),
      bio: bio?.trim() || '',
      website: website?.trim() || '',
      instagram: instagram?.trim() || '',
      facebook: facebook?.trim() || '',
      media_type,
    });
    res.status(201).json({ ok: true, profile });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Aggiorna profilo media (utente media o admin)
app.patch('/api/profile/media', requireAuth, async (req, res) => {
  try {
    const profile = await queries.getMediaProfileByUser(req.user.id);
    if (!profile && req.user.role !== 'admin') return res.status(404).json({ error: 'Profilo non trovato' });
    const { display_name, bio, website, instagram, facebook, media_type } = req.body;
    await queries.updateMediaProfile({
      id: profile.id,
      display_name: display_name?.trim() || profile.display_name,
      bio: bio?.trim() ?? profile.bio,
      website: website?.trim() ?? profile.website,
      instagram: instagram?.trim() ?? profile.instagram,
      facebook: facebook?.trim() ?? (profile.facebook || ''),
      media_type: ['foto', 'video', 'entrambi'].includes(media_type) ? media_type : (profile.media_type || 'foto'),
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

// Profilo media singolo (pubblico) con album e video
app.get('/api/media/profile/:id', async (req, res) => {
  try {
    const profile = await queries.getMediaProfileById(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profilo non trovato' });
    const albums  = await queries.getMediaAlbumsByProfile(profile.id);
    const videos  = await queries.getMediaVideosByProfile(profile.id);
    const stats   = await queries.countMediaPhotosByProfile(profile.id);
    res.json({ profile, albums, videos, stats });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Album e video di una gara (pubblico)
app.get('/api/media/gara/:gara_id', async (req, res) => {
  try {
    const [albums, videos] = await Promise.all([
      queries.getMediaAlbumsByGara(req.params.gara_id),
      queries.getMediaVideosByGara(req.params.gara_id),
    ]);
    res.json({ albums, videos });
  } catch (e) { res.status(500).json({ error: e.message }); }
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

// ── Media videos (Media Video: link esterno YouTube/Instagram/TikTok o file caricato) ──

const MEDIA_PALINSESTI = ['highlights', 'interviste', 'vlog', 'podcast'];

// Elenco pubblico (sezione Media → tab Creator), filtrabile per palinsesto
app.get('/api/media/videos', async (req, res) => {
  try {
    const { palinsesto } = req.query;
    res.json({ videos: await queries.getAllMediaVideos(palinsesto || null) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Profili che pubblicano video (registrati da un utente, non scrapati) — striscia avatar
app.get('/api/media/video-creators', async (req, res) => {
  try { res.json({ profiles: await queries.getVideoCreatorProfiles() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Dirette dei creator attualmente in corso — badge "🔴 diretta ora" sui
// cerchietti Creator/canale e sul profilo (vedi syncMediaChannels per come
// vengono rilevate/aggiornate).
app.get('/api/media/live-now', async (req, res) => {
  try { res.json({ live: await queries.getLiveMediaVideosNow() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Contatore visualizzazioni — un video Media Video caricato/collegato da un creator
app.post('/api/media/video/:id/view', async (req, res) => {
  try { await queries.incrementMediaVideoView(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Contatore visualizzazioni — video del sistema esistente (gara/dirette/presentazioni/
// programmi TV/altro), tracciati per chiave testuale visto che non hanno un ID DB.
app.post('/api/videos/view', async (req, res) => {
  try {
    const key = (req.body?.key || '').toString().trim();
    if (!key) return res.status(400).json({ error: 'key mancante' });
    await queries.incrementLegacyVideoView(key);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mappa video_key → visualizzazioni per i video del sistema esistente (letta in blocco
// all'apertura della sezione Media, invece di una richiesta per ogni card).
app.get('/api/videos/views', async (req, res) => {
  try {
    const rows = await queries.getAllLegacyVideoViews();
    const map = {};
    for (const r of rows) map[r.video_key] = r.views;
    res.json({ views: map });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Import in blocco di TUTTI (fino a un limite) i video di un canale YouTube
// come Media Video — evita di doverli aggiungere uno per uno a mano. Crea
// (o riusa) un profilo media "senza utente" per il canale, stesso schema
// già usato per i fotografi scrapati (xpix.it, ecc.), e ci appende i video
// trovati con il palinsesto scelto.
app.post('/api/admin/media/import-channel', requireAdmin, async (req, res) => {
  try {
    if (!YOUTUBE_API_KEY) return res.status(400).json({ error: 'YOUTUBE_API_KEY non configurata' });
    const { channel, palinsesto, limit, includeShorts } = req.body;
    if (!channel?.trim()) return res.status(400).json({ error: 'Canale mancante (URL, @handle o channel ID)' });
    if (!MEDIA_PALINSESTI.includes(palinsesto)) return res.status(400).json({ error: 'Palinsesto non valido' });
    const maxVideos = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 300);

    const raw = channel.trim();
    let uploadsPlaylist, channelTitle, channelThumb;
    let seriesName = null; // nome della playlist, solo se si importa una playlist specifica

    // Link playlist (es. .../playlist?list=PLxxxx): importa direttamente quella
    // playlist invece delle uploads del canale — utile per prendere solo una
    // serie/rassegna specifica invece di tutto quello che un canale pubblica.
    // Il profilo creato/riusato resta comunque quello del CANALE proprietario
    // (non uno per playlist), così più playlist dello stesso canale confluiscono
    // nello stesso creator — ma il nome della playlist viene salvato su ogni
    // video (colonna series) per poterle distinguere nel profilo (due playlist
    // diverse dello stesso canale, es. "Ciclismo 360" e "A Ruota Libera" di
    // Eurosport, altrimenti finiscono mescolate senza modo di separarle).
    const listMatch = raw.match(/[?&]list=([\w-]+)/);
    if (listMatch) {
      uploadsPlaylist = listMatch[1];
      const plMetaResp = await fetch(`https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${uploadsPlaylist}&key=${YOUTUBE_API_KEY}`).then(r => r.json());
      const plItem = plMetaResp.items?.[0];
      if (!plItem) return res.status(404).json({ error: 'Playlist non trovata — controlla che sia pubblica' });
      channelTitle = plItem.snippet?.channelTitle || plItem.snippet?.title || raw;
      seriesName = plItem.snippet?.title || null;
      const chUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${plItem.snippet?.channelId}&key=${YOUTUBE_API_KEY}`;
      const chResp = plItem.snippet?.channelId ? await fetch(chUrl).then(r => r.json()) : {};
      channelThumb = chResp.items?.[0]?.snippet?.thumbnails?.medium?.url || plItem.snippet?.thumbnails?.medium?.url || plItem.snippet?.thumbnails?.default?.url || '';
    } else {
      // Risolvi l'input (URL/@handle/ID) in un channel_id (UCxxxxxxxx...).
      let channelId = null;
      const idMatch = raw.match(/(UC[\w-]{22})/);
      if (idMatch) {
        channelId = idMatch[1];
      } else {
        // Estrae l'handle: cerca "@nome" ovunque nella stringa (non ancorato alla
        // fine) perché URL come .../@canale/videos altrimenti facevano catturare
        // "videos" invece del vero handle.
        const atMatch = raw.match(/@([\w.-]+)/);
        const pathMatch = !atMatch && raw.match(/youtube\.com\/(?:c\/|user\/)([\w.-]+)/);
        const handle = atMatch ? atMatch[1] : (pathMatch ? pathMatch[1] : raw.replace(/\/+$/, '').split('/').pop());
        // Endpoint ufficiale forHandle (richiede solo la API key, già
        // disponibile qui) invece dello scraping HTML di resolveHandle() —
        // quest'ultimo è pensato per il fallback SENZA API key e può fallire
        // silenziosamente quando YouTube cambia la struttura della pagina.
        const byHandleUrl = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${YOUTUBE_API_KEY}`;
        const byHandleResp = await fetch(byHandleUrl).then(r => r.json());
        channelId = byHandleResp.items?.[0]?.id || await resolveHandle(handle);
      }
      if (!channelId) return res.status(404).json({ error: 'Canale non trovato — prova a incollare l\'URL completo del canale' });

      // Titolo/logo del canale + playlist "uploads" (tutti i video pubblicati) in una chiamata.
      const chUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&id=${channelId}&key=${YOUTUBE_API_KEY}`;
      const chResp = await fetch(chUrl).then(r => r.json());
      const chItem = chResp.items?.[0];
      if (!chItem) return res.status(404).json({ error: 'Canale non trovato su YouTube' });
      channelTitle = chItem.snippet?.title || raw;
      channelThumb = chItem.snippet?.thumbnails?.medium?.url || chItem.snippet?.thumbnails?.default?.url || '';
      uploadsPlaylist = chItem.contentDetails?.relatedPlaylists?.uploads;
      if (!uploadsPlaylist) return res.status(404).json({ error: 'Nessun video pubblico trovato per questo canale' });
    }

    // Trova o crea il profilo media "senza utente" per questo canale (stesso
    // pattern dei fotografi scrapati) — riusato ai giri successivi cercandolo per nome.
    let profile = (await queries.getUnclaimedMediaProfiles()).find(p => p.display_name === channelTitle);
    if (!profile) {
      profile = await queries.createMediaProfile({ user_id: null, display_name: channelTitle, media_type: 'video' });
      await queries.approveMediaProfile(profile.id);
      if (channelThumb) await queries.updateMediaProfileCover(profile.id, channelThumb);
    }

    // Pagina la playlist "uploads" finché non si raggiunge il limite richiesto.
    // La playlist "uploads" contiene Shorts e video normali mescolati (l'API
    // non li distingue a livello di playlistItems): per ogni pagina, controllo
    // isYouTubeShort() reale (redirect di youtube.com/shorts/{id}) e scarto
    // quelli — la durata NON basta, ci sono Shorts fino a 3 minuti.
    // Limite di 10 pagine (500 candidati grezzi) per non sprecare quota se un
    // canale ha moltissimi Shorts e pochissimi video "veri".
    const videos = [];
    let pageToken = '';
    let pagesFetched = 0;
    while (videos.length < maxVideos && pagesFetched < 10) {
      const plUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylist}&maxResults=50&pageToken=${pageToken}&key=${YOUTUBE_API_KEY}`;
      const plResp = await fetch(plUrl).then(r => r.json());
      if (plResp.error) throw new Error(plResp.error.message || 'Errore API YouTube (playlistItems)');
      pagesFetched++;
      const pageItems = (plResp.items || []).map(item => ({
        vid: item.snippet?.resourceId?.videoId,
        title: item.snippet?.title || 'Video',
        description: (item.snippet?.description || '').slice(0, 500),
        thumbnail_url: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '',
        published_at: item.snippet?.publishedAt || null,
      })).filter(x => x.vid);

      const shorts = await filterOutShorts(pageItems.map(x => x.vid), includeShorts);
      for (const x of pageItems) {
        if (shorts.has(x.vid)) continue;
        videos.push({ vid: x.vid, url: `https://www.youtube.com/watch?v=${x.vid}`, title: x.title, description: x.description, thumbnail_url: x.thumbnail_url, published_at: x.published_at });
        if (videos.length >= maxVideos) break;
      }
      pageToken = plResp.nextPageToken;
      if (!pageToken) break;
    }

    // Sistema dirette (stesso di quello per le gare, vedi fetchVideosInfoBatch):
    // scopre quali video importati sono/sono stati trasmessi in diretta, così
    // le dirette dei creator si vedono col player già usato per le gare, senza
    // che l'admin debba segnalarle a mano.
    const liveInfoById = await fetchVideosInfoBatch(videos.map(v => v.vid), YOUTUBE_API_KEY);
    for (const v of videos) {
      const info = liveInfoById[v.vid];
      v.is_live = !!info?.isLiveContent;
      v.scheduled_start = info?.scheduledStartTime || null;
    }

    // Salta i video già importati in precedenza per questo profilo (stesso URL).
    const existing = await queries.getMediaVideosByProfile(profile.id);
    const existingUrls = new Set(existing.map(v => v.url));
    let imported = 0;
    for (const v of videos) {
      if (existingUrls.has(v.url)) continue;
      await queries.createMediaVideo({
        media_profile_id: profile.id, palinsesto, title: v.title, description: v.description,
        source_type: 'link', url: v.url, thumbnail_url: v.thumbnail_url, published_at: v.published_at,
        series: seriesName, is_live: v.is_live, scheduled_start: v.scheduled_start,
      });
      imported++;
    }
    // Registra il canale per la sincronizzazione automatica dei prossimi video
    // (vedi syncMediaChannels/autoMediaChannelsSync) così i video nuovi che il
    // canale pubblica in futuro vengono importati da soli, senza rifare
    // l'import manuale.
    const mediaChannels = await readYTMediaChannels();
    const idx = mediaChannels.findIndex(c => c.uploadsPlaylist === uploadsPlaylist);
    const entry = { uploadsPlaylist, palinsesto, profileId: profile.id, displayName: channelTitle, includeShorts: !!includeShorts, series: seriesName };
    if (idx >= 0) mediaChannels[idx] = entry; else mediaChannels.push(entry);
    await writeYTMediaChannels(mediaChannels);

    res.json({ ok: true, imported, skipped: videos.length - imported, profile: { id: profile.id, display_name: channelTitle } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Import podcast (Spotify/RSS) in blocco, stesso concetto dei canali YouTube ──
// Spotify richiede un account Premium per l'app per leggere show/puntate via
// API ufficiale (restrizione imposta da Spotify, non aggirabile) — ma la
// maggior parte dei podcast ha comunque un feed RSS pubblico, ospitato altrove
// (Podomatic, Anchor/Spotify for Podcasters, Buzzsprout, ecc.), che Spotify
// stesso importa per distribuirlo. Se l'utente incolla un link Spotify,
// risolviamo il feed passando dal nome dello show (oEmbed, pubblico, nessuna
// restrizione) cercato su iTunes (API pubblica, restituisce feedUrl per la
// maggior parte dei podcast). Se incolla direttamente un URL di feed, lo
// usiamo così com'è.
async function _resolvePodcastFeedUrl(input) {
  const raw = input.trim();
  const showMatch = raw.match(/open\.spotify\.com\/show\/([a-zA-Z0-9]+)/);
  const episodeMatch = !showMatch && raw.match(/open\.spotify\.com\/episode\/([a-zA-Z0-9]+)/);
  if (!showMatch && !episodeMatch) return raw; // non è un link Spotify: trattalo già come feed RSS

  let showName = '';
  if (showMatch) {
    const oembed = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/show/${showMatch[1]}`)}`).then(r => r.json()).catch(() => null);
    // Il campo "title" dell'oEmbed di uno show è l'ultima puntata, non il nome
    // dello show — il nome vero va preso dal <title>/JSON della pagina pubblica.
    const html = await fetch(`https://open.spotify.com/show/${showMatch[1]}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.text()).catch(() => '');
    const nameMatch = html.match(/"name"\s*:\s*"([^"]{2,80})"/) || html.match(/<title>([^<|]+)/);
    showName = (nameMatch?.[1] || oembed?.title || '').trim();
  } else {
    // Da un link a un SINGOLO episodio non c'è modo diretto di risalire allo
    // show ID, ma la <meta name="description"> di Spotify segue sempre il
    // formato "Listen to this episode from {NomeShow} on Spotify. ..." —
    // pattern stabile e pubblico, nessuna API richiesta.
    const html = await fetch(`https://open.spotify.com/episode/${episodeMatch[1]}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.text()).catch(() => '');
    const descMatch = html.match(/Listen to this episode from (.+?) on Spotify\./);
    showName = (descMatch?.[1] || '').trim();
  }
  if (!showName) throw new Error('Non riesco a risalire al nome dello show da questo link Spotify');
  const itunesResp = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(showName)}&entity=podcast&country=IT`).then(r => r.json());
  const hit = itunesResp.results?.find(r => r.feedUrl);
  if (!hit) throw new Error(`Nessun feed RSS pubblico trovato per "${showName}" — prova a incollare direttamente l'URL del feed RSS, se lo conosci`);
  return hit.feedUrl;
}

// Parsing RSS minimale (stesso approccio già usato per l'RSS di YouTube in
// youtube-scraper.js) — sufficiente per titolo/audio/data/copertina di ogni
// puntata, senza dipendenze XML esterne.
function _parsePodcastRss(xml) {
  const decodeEntities = (s) => (s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  const stripCdata = (s) => decodeEntities((s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').replace(/<[^>]+>/g, '')).trim();
  const channelEnd = xml.indexOf('<item');
  const channelBlock = channelEnd > 0 ? xml.slice(0, channelEnd) : xml;
  const channelTitle = stripCdata(channelBlock.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '');
  const channelImage = channelBlock.match(/<itunes:image[^>]*href="([^"]+)"/)?.[1]
    || channelBlock.match(/<image>[\s\S]*?<url>([^<]+)<\/url>/)?.[1] || '';
  const items = [];
  const itemRe = /<item[\s\S]*?<\/item>/g;
  const blocks = xml.match(itemRe) || [];
  for (const block of blocks) {
    const title = stripCdata(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '') || 'Episodio';
    const description = stripCdata(block.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '').slice(0, 500);
    const enclosureUrl = block.match(/<enclosure[^>]*url="([^"]+)"/)?.[1] || '';
    const pubDateRaw = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || '';
    const published_at = pubDateRaw ? new Date(pubDateRaw).toISOString() : null;
    const thumbnail_url = block.match(/<itunes:image[^>]*href="([^"]+)"/)?.[1] || channelImage;
    if (enclosureUrl) items.push({ title, description, url: enclosureUrl, thumbnail_url, published_at: published_at && !isNaN(Date.parse(published_at)) ? published_at : null });
  }
  return { channelTitle, channelImage, items };
}

app.post('/api/admin/media/import-podcast', requireAdmin, async (req, res) => {
  try {
    const { input, palinsesto, limit } = req.body;
    if (!input?.trim()) return res.status(400).json({ error: 'Link Spotify o URL feed RSS mancante' });
    if (!MEDIA_PALINSESTI.includes(palinsesto)) return res.status(400).json({ error: 'Palinsesto non valido' });
    const maxEpisodes = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);

    const feedUrl = await _resolvePodcastFeedUrl(input);
    const xml = await fetch(feedUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => { if (!r.ok) throw new Error(`Feed non raggiungibile (HTTP ${r.status})`); return r.text(); });
    const { channelTitle, channelImage, items } = _parsePodcastRss(xml);
    if (!channelTitle) return res.status(404).json({ error: 'Feed RSS non valido o vuoto' });

    let profile = (await queries.getUnclaimedMediaProfiles()).find(p => p.display_name === channelTitle);
    if (!profile) {
      profile = await queries.createMediaProfile({ user_id: null, display_name: channelTitle, media_type: 'video' });
      await queries.approveMediaProfile(profile.id);
      if (channelImage) await queries.updateMediaProfileCover(profile.id, channelImage);
    }

    const existing = await queries.getMediaVideosByProfile(profile.id);
    const existingUrls = new Set(existing.map(v => v.url));
    let imported = 0;
    for (const ep of items.slice(0, maxEpisodes)) {
      if (existingUrls.has(ep.url)) continue;
      await queries.createMediaVideo({
        media_profile_id: profile.id, palinsesto, title: ep.title, description: ep.description,
        source_type: 'link', url: ep.url, thumbnail_url: ep.thumbnail_url, published_at: ep.published_at,
      });
      imported++;
    }
    // Registra il feed per il sync automatico delle prossime puntate (vedi
    // syncPodcastFeeds/autoPodcastFeedsSync).
    const feeds = await readPodcastFeeds();
    const idx = feeds.findIndex(f => f.feedUrl === feedUrl);
    const entry = { feedUrl, palinsesto, profileId: profile.id, displayName: channelTitle };
    if (idx >= 0) feeds[idx] = entry; else feeds.push(entry);
    await writePodcastFeeds(feeds);

    res.json({ ok: true, imported, skipped: items.length - imported, profile: { id: profile.id, display_name: channelTitle } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Crea video — link esterno (YouTube/Instagram/TikTok, nessun upload)
app.post('/api/media/video', requireMediaOrAdmin, async (req, res) => {
  try {
    const profile = req.user.role === 'admin'
      ? await queries.getMediaProfileById(req.body.media_profile_id)
      : await queries.getMediaProfileByUser(req.user.id);
    if (!profile) return res.status(404).json({ error: 'Profilo media non trovato' });
    const { gara_id, palinsesto, title, description, url } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Titolo obbligatorio' });
    if (!url?.trim()) return res.status(400).json({ error: 'Link obbligatorio' });
    if (!MEDIA_PALINSESTI.includes(palinsesto)) return res.status(400).json({ error: 'Palinsesto non valido' });
    const video = await queries.createMediaVideo({
      media_profile_id: profile.id,
      gara_id: gara_id || null,
      palinsesto,
      title: title.trim(),
      description: description?.trim() || '',
      source_type: 'link',
      url: url.trim(),
    });
    res.status(201).json({ ok: true, video });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Crea video — file caricato (stesso multer/bucket "videos" già usato altrove)
app.post('/api/media/video/upload', requireMediaOrAdmin, videoUpload.single('video'), async (req, res) => {
  try {
    const profile = req.user.role === 'admin'
      ? await queries.getMediaProfileById(req.body.media_profile_id)
      : await queries.getMediaProfileByUser(req.user.id);
    if (!profile) return res.status(404).json({ error: 'Profilo media non trovato' });
    const { gara_id, palinsesto, title, description } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Titolo obbligatorio' });
    if (!req.file) return res.status(400).json({ error: 'Nessun file ricevuto' });
    if (!MEDIA_PALINSESTI.includes(palinsesto)) return res.status(400).json({ error: 'Palinsesto non valido' });
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
    const video = await queries.createMediaVideo({
      media_profile_id: profile.id,
      gara_id: gara_id || null,
      palinsesto,
      title: title.trim(),
      description: description?.trim() || '',
      source_type: 'upload',
      url: videoUrl,
      filename,
    });
    res.status(201).json({ ok: true, video });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Modifica video (titolo/descrizione/palinsesto/gara collegata)
app.patch('/api/media/video/:id', requireMediaOrAdmin, async (req, res) => {
  try {
    const video = await queries.getMediaVideo(req.params.id);
    if (!video) return res.status(404).json({ error: 'Video non trovato' });
    if (req.user.role !== 'admin') {
      const profile = await queries.getMediaProfileByUser(req.user.id);
      if (!profile || video.media_profile_id !== profile.id)
        return res.status(403).json({ error: 'Non autorizzato' });
    }
    const { title, gara_id, palinsesto, description } = req.body;
    if (palinsesto !== undefined && !MEDIA_PALINSESTI.includes(palinsesto)) return res.status(400).json({ error: 'Palinsesto non valido' });
    await queries.updateMediaVideo({
      id: video.id,
      title: title?.trim() || video.title,
      gara_id: gara_id !== undefined ? (gara_id || null) : video.gara_id,
      palinsesto: palinsesto || video.palinsesto,
      description: description?.trim() ?? video.description,
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Elimina video
app.delete('/api/media/video/:id', requireMediaOrAdmin, async (req, res) => {
  try {
    const video = await queries.getMediaVideo(req.params.id);
    if (!video) return res.status(404).json({ error: 'Video non trovato' });
    if (req.user.role !== 'admin') {
      const profile = await queries.getMediaProfileByUser(req.user.id);
      if (!profile || video.media_profile_id !== profile.id)
        return res.status(403).json({ error: 'Non autorizzato' });
    }
    if (video.source_type === 'upload' && video.filename) {
      if (supabase) await supabase.storage.from('videos').remove([video.filename]).catch(() => {});
      else fs.unlinkSync(path.join(UPLOADS_DIR, video.filename));
    }
    await queries.deleteMediaVideo(video.id);
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

// Foto profilo/logo del profilo Media — in fase di creazione o in un secondo
// momento (usato sia dal form "Crea profilo" sia dal pulsante "Cambia foto"
// in dashboard/modifica profilo).
app.post('/api/profile/media/cover', requireMediaOrAdmin, uploadMedia.single('cover'), async (req, res) => {
  try {
    const profile = req.user.role === 'admin' && req.body.media_profile_id
      ? await queries.getMediaProfileById(req.body.media_profile_id)
      : await queries.getMediaProfileByUser(req.user.id);
    if (!profile) return res.status(404).json({ error: 'Profilo media non trovato' });
    if (!req.file) return res.status(400).json({ error: 'Nessuna immagine ricevuta' });
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const filename = `media_cover_${profile.id}_${Date.now()}${ext}`;
    if (supabase) {
      const { error } = await supabase.storage.from('photos').upload(filename, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
      if (error) throw new Error(error.message);
    } else {
      fs.writeFileSync(path.join(UPLOADS_DIR, filename), req.file.buffer || fs.readFileSync(req.file.path));
    }
    const cover_url = `/photos/${filename}`;
    await queries.updateMediaProfileCover(profile.id, cover_url);
    res.json({ ok: true, cover_url });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
      const d = (r.data || '').slice(0, 10);
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

// Precarica la grafica OG (foto/podio) delle gare con risultati appena
// importati, chiamando in autonomia il proprio endpoint subito dopo lo
// scraping — così la cache in-memory (_ogCache, 30 min) è già calda quando
// qualcuno condivide il link, invece di lasciare che il PRIMO a farlo sia
// il crawler di Facebook stesso: la primissima generazione può richiedere
// diversi secondi (foto + composizione avatar) e Facebook può arrendersi
// prima che finisca, mostrando poi l'anteprima senza immagine.
async function _warmRecentOgImages() {
  try {
    const results   = readDataJson('results_raw.json') || [];
    const today     = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const recentGaraIds = new Set();
    for (const r of results) {
      const d = (r.data || '').slice(0, 10);
      if ((d === today || d === yesterday) && r.gara_id) recentGaraIds.add(r.gara_id);
    }
    if (!recentGaraIds.size) return;
    // Concorrenza limitata (3 alla volta) invece di sparare tutte le
    // richieste in parallelo: con molte gare della stessa giornata (es. un
    // weekend pieno), generarle tutte insieme si rallentavano a vicenda per
    // CPU/rete condivisa — probabile causa reale di parte dei timeout sul
    // percorso foto inseguiti in questa sessione, non solo cold-start.
    // Attesa (non piu' fire-and-forget) cosi' la funzione ritorna solo
    // quando la cache e' davvero calda per tutte, utile anche per il log.
    const ids = [...recentGaraIds];
    let done = 0, failed = 0;
    const CONCURRENCY = 3;
    async function worker() {
      while (ids.length) {
        const garaId = ids.shift();
        try {
          const r = await fetch(`http://localhost:${PORT}/api/og-image/gara/${encodeURIComponent(garaId)}`);
          if (r.ok) done++; else failed++;
        } catch { failed++; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, recentGaraIds.size) }, worker));
    console.log(`[og-warm] Precaricate ${done}/${recentGaraIds.size} grafiche OG per gare recenti${failed ? ` (${failed} fallite)` : ''}`);
  } catch (e) { console.warn('[og-warm] error:', e.message); }
}

// ── Notifica variazione posizione in classifica ──────────────────────────────
// Chiamata da notify-results insieme a notifyFollowers(): per ogni atleta con
// risultati recenti (oggi/ieri), ricalcola la sua posizione in classifica
// (stessa categoria via _rankingCodeFromRow) confrontando il totale punti
// PRIMA e DOPO l'inclusione dei risultati recenti — stessa logica di trend
// già usata lato client in updateRankTable(), qui applicata per decidere se
// notificare. Notifica sia l'atleta stesso (se ha un account collegato) sia
// i suoi follower.
async function notifyRankChanges() {
  try {
    const results = readDataJson('results_raw.json') || [];
    const today     = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const recentAtleti = new Set();
    for (const r of results) {
      const d = (r.data || '').slice(0, 10);
      if ((d === today || d === yesterday) && r.atleta_id) recentAtleti.add(r.atleta_id);
    }
    if (!recentAtleti.size) return;

    // Raggruppa i risultati per categoria di classifica (un atleta appartiene
    // sempre a una sola categoria) e somma i punti totali per atleta, sia
    // includendo che escludendo i risultati recenti.
    const byCat = {}; // catCode → rows[]
    for (const r of results) {
      if (!r.atleta_id) continue;
      const cat = _rankingCodeFromRow(r);
      if (!cat) continue;
      (byCat[cat] = byCat[cat] || []).push(r);
    }

    const changes = {}; // atleta_id → { cat, curPos, prevPos, isNew }
    const nomiById = {};
    for (const [cat, rows] of Object.entries(byCat)) {
      const curPts = {}, prevPts = {};
      for (const r of rows) {
        const pts = Number(r.punti_effettivi) || 0;
        curPts[r.atleta_id] = (curPts[r.atleta_id] || 0) + pts;
        const d = (r.data || '').slice(0, 10);
        if (d !== today && d !== yesterday) prevPts[r.atleta_id] = (prevPts[r.atleta_id] || 0) + pts;
        if (!nomiById[r.atleta_id]) nomiById[r.atleta_id] = `${r.cognome || ''} ${r.nome || ''}`.trim();
      }
      const rankOf = (ptsMap) => {
        const rank = {};
        Object.entries(ptsMap).sort(([, a], [, b]) => b - a).forEach(([id], i) => { rank[id] = i + 1; });
        return rank;
      };
      const curRank = rankOf(curPts), prevRank = rankOf(prevPts);
      for (const id of Object.keys(curPts)) {
        if (!recentAtleti.has(id)) continue;
        const cur = curRank[id];
        const prev = prevRank[id];
        if (prev == null) changes[id] = { cat, curPos: cur, isNew: true };
        else if (cur !== prev) changes[id] = { cat, curPos: cur, prevPos: prev, isNew: false };
      }
    }
    if (!Object.keys(changes).length) return;

    const allFollows = await queries.getAllAtletaFollows();
    const byAtleta = {};
    for (const { user_id, atleta_id } of allFollows) {
      if (!byAtleta[atleta_id]) byAtleta[atleta_id] = new Set();
      byAtleta[atleta_id].add(user_id);
    }

    for (const [atletaId, ch] of Object.entries(changes)) {
      const nome = nomiById[atletaId] || '';
      const title = ch.isNew
        ? `📊 ${nome} è entrato in classifica`
        : ch.curPos < ch.prevPos
          ? `📈 ${nome} sale al ${ch.curPos}° posto`
          : `📉 ${nome} scende al ${ch.curPos}° posto`;
      const body = ch.isNew
        ? `${ch.curPos}° posto in classifica`
        : `Classifica: ${ch.prevPos}° → ${ch.curPos}°`;
      const url = `/#/classifica/${encodeURIComponent(ch.cat)}`;

      const recipients = new Set(byAtleta[atletaId] || []);
      try {
        const u = await queries.getUserByAtletaId(atletaId);
        if (u) recipients.add(u.id);
      } catch {}
      for (const userId of recipients) {
        sendPushToUser(userId, { title, body, url }).catch(() => {});
      }
    }
    console.log(`[rank] Notifiche variazione classifica inviate per ${Object.keys(changes).length} atleti`);
  } catch (e) { console.warn('[rank] notifyRankChanges error:', e.message); }
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
// Deduplica generazioni concorrenti per la stessa chiave: senza questa mappa,
// due richieste quasi simultanee sulla stessa immagine ancora non in cache
// (tipicamente: il pre-riscaldamento nostro + Facebook che scrapa nello
// stesso istante) rifanno ENTRAMBE da zero il lavoro pesante (foto + sharp),
// invece che la seconda aspetti il risultato della prima già in corso — con
// due generazioni da 5-6s in corsa, la richiesta di Facebook può comunque
// arrivare tardi e trovare l'anteprima vuota.
const _ogInFlight = new Map(); // key → Promise<Buffer|null>
async function _ogGenerateDeduped(cacheKey, generator) {
  const cached = _ogCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < OG_TTL) return cached.buf;
  const pending = _ogInFlight.get(cacheKey);
  if (pending) return pending;
  const promise = (async () => {
    try {
      const buf = await generator();
      if (buf) { _ogCache.set(cacheKey, { buf, ts: Date.now() }); return buf; }
      // Generazione fallita (timeout, foto irraggiungibile, ecc.): se esiste
      // già una versione buona precedente (anche scaduta), la riserviamo
      // invece di cadere sul logo generico. Senza questo, basta che Facebook
      // ri-scrapi il link in un momento sfortunato per perdere la foto da un
      // post già pubblicato — anche se il sito torna a generarla bene un
      // minuto dopo, il danno sulla condivisione è già fatto e resta a lungo
      // (Facebook non ri-scrapa da solo). Aggiorniamo il timestamp così non
      // si ritenta la generazione ad ogni richiesta finché non ne va a buon fine una vera.
      if (cached) { cached.ts = Date.now(); return cached.buf; }
      return null;
    } catch (e) {
      console.warn('[og] generazione fallita per', cacheKey, ':', e.message);
      if (cached) { cached.ts = Date.now(); return cached.buf; }
      return null;
    } finally {
      _ogInFlight.delete(cacheKey);
    }
  })();
  _ogInFlight.set(cacheKey, promise);
  return promise;
}

// s ?? '' (non s || ''): un valore statistico 0 (es. "3° posti: 0") è
// legittimo e deve mostrare la cifra "0", non sparire come stringa vuota —
// con || il numero 0 è falsy e veniva scartato, lasciando la cella statistica
// vuota invece di mostrare "0" (bug osservato live: "3° POSTI" senza numero).
const _ogEsc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// Cornice condivisa (sfondo scuro, bagliore rosso, accento a sinistra, logo,
// footer col tricolore) — stessa identità visiva "Velon" delle card che il
// sito genera lato client per Instagram (generateShareCanvas/_bg/_header/
// _footer), portata qui per il preview automatico di Facebook così le
// immagini condivise sono coerenti indipendentemente dal canale.
function _ogWrap(body, { headerRight } = {}) {
  const W = 1200, H = 630, headerH = 58, footerH = 38;
  const logo = _ogLogoDataUri();
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="ogBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0c0e12"/><stop offset="60%" stop-color="#0a0c10"/><stop offset="100%" stop-color="#070809"/>
    </linearGradient>
    <radialGradient id="ogGlow" cx="92%" cy="0%" r="90%">
      <stop offset="0%" stop-color="#e8001d" stop-opacity="0.12"/><stop offset="100%" stop-color="#e8001d" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ogHero" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#e8001d"/><stop offset="100%" stop-color="#f5c400"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#ogBg)"/>
  <rect width="${W}" height="${H}" fill="url(#ogGlow)"/>
  <rect x="0" y="0" width="6" height="${H}" fill="#e8001d"/>
  ${logo ? `<image href="${logo}" x="24" y="${Math.round((headerH-42)/2)}" width="128" height="42" preserveAspectRatio="xMidYMid meet"/>`
         : `<text x="24" y="${Math.round(headerH*0.6)}" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="900" fill="white">ICS</text>`}
  ${headerRight || ''}
  <rect x="0" y="${headerH}" width="${W}" height="1" fill="rgba(255,255,255,0.07)"/>
  ${body}
  <rect x="0" y="${H-footerH}" width="${W}" height="1" fill="rgba(255,255,255,0.07)"/>
  <rect x="24" y="${H-footerH+18}" width="14" height="3" fill="#009246"/>
  <rect x="38" y="${H-footerH+18}" width="14" height="3" fill="#f0f0ee"/>
  <rect x="52" y="${H-footerH+18}" width="14" height="3" fill="#ce2b37"/>
  <text x="${W-24}" y="${H-footerH+27}" font-family="Arial,Helvetica,sans-serif" font-size="16" fill="rgba(255,255,255,0.35)" text-anchor="end">@italiacrit · italiacyclingstats.com</text>
</svg>`;
}

function _ogStatCell(x, y, w, h, val, label, color) {
  const fsV = Math.min(Math.round(h * 0.34), Math.round(w * 0.30));
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="rgba(255,255,255,0.04)"/>
    <rect x="${x}" y="${y}" width="${w}" height="4" rx="2" fill="${color}"/>
    <text x="${x+w/2}" y="${y+h*0.58}" font-family="Arial,Helvetica,sans-serif" font-size="${fsV}" font-weight="900" fill="${color}" text-anchor="middle">${_ogEsc(val)}</text>
    <text x="${x+w/2}" y="${y+h*0.82}" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="600" fill="rgba(255,255,255,0.42)" text-anchor="middle" letter-spacing="0.5">${_ogEsc(label)}</text>`;
}

function _ogStatHero(x, y, w, h, val, label, grad) {
  const fsV = Math.round(h * 0.40);
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.09)"/>
    <text x="${x+w/2}" y="${y+h*0.58}" font-family="Arial,Helvetica,sans-serif" font-size="${fsV}" font-weight="900" fill="${grad ? 'url(#ogHero)' : '#f5c400'}" text-anchor="middle">${_ogEsc(val)}</text>
    <text x="${x+w/2}" y="${y+h*0.82}" font-family="Arial,Helvetica,sans-serif" font-size="15" font-weight="600" fill="rgba(255,255,255,0.46)" text-anchor="middle" letter-spacing="1">${_ogEsc(label)}</text>`;
}

// Contenuto della card atleta (senza cornice): cognome/nome grandi, team,
// due box "hero" (punti stagione + posizione in classifica), griglia di 4
// statistiche colorate (oro/argento/bronzo/bianco). pad tenuto come
// parametro (usato sempre con lo stesso valore da buildAtletaCardSvg) per
// simmetria con _teamCardBody.
function _atletaCardBody(pad, { cognome, nome, team, punti, pos, p1, p2, p3, p4_10 }) {
  const cTop = 100, cBot = 578, right = 1200 - 66;
  const fsC = (cognome || '').length > 12 ? 56 : 72;
  const nameY = cTop + fsC;
  const nomeY = nameY + Math.round(fsC * 0.46 * 1.55);
  const teamY = nomeY + 40;
  const heroTop = teamY + 28, heroH = 128, gap = 24;
  const boxW = (right - pad - gap) / 2;
  const gridTop = heroTop + heroH + 30, gridH = cBot - gridTop;
  const cw = (right - pad - 24 * 3) / 4;
  const cells = [['VITTORIE', p1, '#f5c400'], ['2° POSTI', p2, '#cfcfcf'], ['3° POSTI', p3, '#cd7f32'], ['4°-10°', p4_10, '#f0f0f0']];
  return `
    <text x="${pad}" y="${nameY}" font-family="Arial,Helvetica,sans-serif" font-size="${fsC}" font-weight="900" fill="#f4f4f4">${_ogEsc((cognome || '').toUpperCase())}</text>
    <text x="${pad}" y="${nomeY}" font-family="Arial,Helvetica,sans-serif" font-size="${Math.round(fsC * 0.46)}" font-weight="700" fill="#e8001d">${_ogEsc((nome || '').toUpperCase())}</text>
    ${team ? `<text x="${pad}" y="${teamY}" font-family="Arial,Helvetica,sans-serif" font-size="24" font-weight="600" fill="rgba(255,255,255,0.55)">${_ogEsc(team.slice(0, 40))}</text>` : ''}
    ${_ogStatHero(pad, heroTop, boxW, heroH, punti, 'PUNTI STAGIONE', true)}
    ${_ogStatHero(pad + boxW + gap, heroTop, boxW, heroH, pos ? `${pos}°` : '—', 'IN CLASSIFICA', false)}
    ${cells.map((c, i) => _ogStatCell(pad + i * (cw + 24), gridTop, cw, gridH, c[1], c[0], c[2])).join('')}`;
}
function buildAtletaCardSvg(data) {
  const pad = 66;
  const headerRight = data.badge ? `<text x="1176" y="35" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="700" fill="#e8001d" text-anchor="end" letter-spacing="1">${_ogEsc(data.badge.toUpperCase())}</text>` : '';
  return _ogWrap(_atletaCardBody(pad, data), { headerRight });
}

// Stesso schema per la card team (senza cornice): nome grande, hero punti
// totali, griglia statistiche (vittorie/podi/gare/corridori) — versione
// semplificata rispetto alla card atleta (niente box "miglior atleta":
// richiederebbe calcolare il ranking di ogni corridore per categoria, fuori
// scope per un'immagine di preview).
function _teamCardBody(pad, { nome, punti, wins, top3, races, riders }) {
  const cTop = 100, cBot = 578, right = 1200 - 66;
  const fsN = (nome || '').length > 20 ? 46 : 62;
  const nameY = cTop + fsN;
  const heroTop = nameY + 40, heroH = 150;
  const gridTop = heroTop + heroH + 34, gridH = cBot - gridTop;
  const cw = (right - pad - 24 * 3) / 4;
  const cells = [['VITTORIE', wins, '#f5c400'], ['PODI', top3, '#cfcfcf'], ['GARE', races, '#cd7f32'], ['CORRIDORI', riders, '#f0f0f0']];
  return `
    <text x="${pad}" y="${nameY}" font-family="Arial,Helvetica,sans-serif" font-size="${fsN}" font-weight="900" fill="#f4f4f4">${_ogEsc((nome || '').toUpperCase().slice(0, 34))}</text>
    ${_ogStatHero(pad, heroTop, right - pad, heroH, punti, 'PUNTI TOTALI STAGIONE', true)}
    ${cells.map((c, i) => _ogStatCell(pad + i * (cw + 24), gridTop, cw, gridH, c[1], c[0], c[2])).join('')}`;
}
function buildTeamCardSvg(data) {
  const pad = 66;
  const headerRight = `<text x="1176" y="35" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="700" fill="#e8001d" text-anchor="end" letter-spacing="1">${_ogEsc(data.badge || 'TEAM')}</text>`;
  return _ogWrap(_teamCardBody(pad, data), { headerRight });
}

// Card classifica: intestazione "CLASSIFICA <categoria>" (+ regione/mese se
// filtrata) a destra, righe numerate con colore oro/argento/bronzo pei primi 3.
function buildClassCardSvg({ catLabel, region, month, rows = [], view = 'atleti', scoreLabel = 'PUNTI', scoreSuffix = 'pt' }) {
  const pad = 60, top = 88, bottom = 578;
  const medal = ['#f5c400', '#dadada', '#cd7f32'];
  const headerRight = `
    <text x="1176" y="34" font-family="Arial,Helvetica,sans-serif" font-size="21" font-weight="700" fill="#f2f2f2" text-anchor="end">${_ogEsc((catLabel || '').toUpperCase())}</text>
    <text x="${1176 - (catLabel || '').length * 12 - 14}" y="34" font-family="Arial,Helvetica,sans-serif" font-size="21" font-weight="500" fill="rgba(255,255,255,0.42)" text-anchor="end" letter-spacing="1">CLASSIFICA${view === 'team' ? ' TEAM' : ''}</text>
    ${region ? `<text x="1176" y="50" font-family="Arial,Helvetica,sans-serif" font-size="15" font-weight="600" fill="#f5c400" text-anchor="end">${_ogEsc(region.toUpperCase())}</text>` : ''}
    ${month ? `<text x="${region ? 1176 - region.length*9 - 14 : 1176}" y="50" font-family="Arial,Helvetica,sans-serif" font-size="15" font-weight="600" fill="rgba(255,255,255,0.45)" text-anchor="end">${_ogEsc(month.toUpperCase())}</text>` : ''}`;
  const rH = Math.round((bottom - top - 30) / Math.max(rows.length, 1));
  const rowsHtml = rows.slice(0, 10).map((r, i) => {
    const ry = top + 30 + i * rH, mid = ry + rH / 2;
    const col = i < 3 ? medal[i] : 'rgba(255,255,255,0.45)';
    const name = view === 'team' ? (r.team || '') : `${r.cognome || ''} ${r.nome || ''}`.trim();
    return `${i % 2 === 0 ? `<rect x="${pad}" y="${ry}" width="${1200-pad*2}" height="${rH}" fill="rgba(255,255,255,0.022)"/>` : ''}
    ${i < 3 ? `<rect x="${pad+8}" y="${mid - rH*0.3}" width="3" height="${rH*0.6}" fill="${col}"/>` : ''}
    <text x="${pad+30}" y="${mid+8}" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="700" fill="${col}">${r.pos}°</text>
    <text x="${pad+80}" y="${mid+8}" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="700" fill="#f0f0f0">${_ogEsc(name.slice(0, 26))}</text>
    ${view === 'team' ? '' : `<text x="${pad+560}" y="${mid+8}" font-family="Arial,Helvetica,sans-serif" font-size="17" fill="rgba(255,255,255,0.42)">${_ogEsc((r.team || '').slice(0, 30))}</text>`}
    <text x="${1200-pad-10}" y="${mid+8}" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="700" fill="#f5c400" text-anchor="end">${_ogEsc(r.score)} ${scoreSuffix}</text>`;
  }).join('');
  const body = `
    <text x="${pad}" y="${top+8}" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="600" fill="rgba(255,255,255,0.34)" letter-spacing="1.5">POS</text>
    <text x="${pad+80}" y="${top+8}" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="600" fill="rgba(255,255,255,0.34)" letter-spacing="1.5">${view === 'team' ? 'TEAM' : 'ATLETA'}</text>
    <text x="${1200-pad-10}" y="${top+8}" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="600" fill="rgba(255,255,255,0.34)" text-anchor="end" letter-spacing="1.5">${_ogEsc(scoreLabel)}</text>
    <rect x="${pad}" y="${top+16}" width="1080" height="1" fill="rgba(255,255,255,0.06)"/>
    ${rowsHtml}`;
  return _ogWrap(body, { headerRight });
}

// Logo ICS come data URI base64 (cache) per embeddarlo negli SVG OG
let _ogLogoUri = null;
function _ogLogoDataUri() {
  if (_ogLogoUri !== null) return _ogLogoUri;
  try {
    const p = path.join(FRONTEND_DIR, 'assets', 'logo.png');
    _ogLogoUri = 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
  } catch { _ogLogoUri = ''; }
  return _ogLogoUri;
}

// Logo xpix.it (stesso file usato lato client, vedi _getXpixLogo in app.js)
// per l'attribuzione con logo vero — non solo testo — anche sulla grafica
// generata server-side per Facebook.
let _ogXpixLogoUri = null;
function _ogXpixLogoDataUri() {
  if (_ogXpixLogoUri !== null) return _ogXpixLogoUri;
  try {
    const p = path.join(FRONTEND_DIR, 'assets', 'xpix-logo.png');
    _ogXpixLogoUri = 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
  } catch { _ogXpixLogoUri = ''; }
  return _ogXpixLogoUri;
}

// Immagine OG di fallback per una gara: logo ICS in alto + nome gara sotto.
function buildGaraNameSvg(title, subtitle) {
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  // Wrap del nome gara su massimo 2 righe
  const words = String(title || '').trim().split(/\s+/);
  const lines = []; let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 22 && cur) { lines.push(cur); cur = w; }
    else cur = (cur ? cur + ' ' : '') + w;
    if (lines.length === 2) break;
  }
  if (cur && lines.length < 2) lines.push(cur);
  if (lines.length === 2 && words.join(' ').length > lines.join(' ').length) lines[1] += '…';
  const fontSize = lines.some(l => l.length > 16) ? 58 : 70;
  const startY = lines.length === 2 ? 400 : 430;
  const titleTspans = lines.map((l, i) => `<text x="600" y="${startY + i*(fontSize+8)}" font-family="Arial,Helvetica,sans-serif" font-size="${fontSize}" font-weight="900" fill="white" text-anchor="middle">${esc(l)}</text>`).join('');
  const logo = _ogLogoDataUri();
  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#0f172a"/><stop offset="100%" stop-color="#1e293b"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="10" height="630" fill="#e8001d"/>
  ${logo ? `<image href="${logo}" x="470" y="90" width="260" height="160" preserveAspectRatio="xMidYMid meet"/>` : `<text x="600" y="200" font-family="Arial,Helvetica,sans-serif" font-size="40" font-weight="900" fill="white" text-anchor="middle">ICS — ITALIA CYCLING STATS</text>`}
  ${titleTspans}
  ${subtitle ? `<text x="600" y="${startY + lines.length*(fontSize+8) + 10}" font-family="Arial,Helvetica,sans-serif" font-size="30" fill="#94a3b8" text-anchor="middle">${esc(subtitle.slice(0,60))}</text>` : ''}
  <text x="600" y="595" font-family="Arial,Helvetica,sans-serif" font-size="22" fill="#e8001d" font-weight="600" text-anchor="middle">italiacyclingstats.com</text>
</svg>`;
}

// Tempo vincitore da km/media (stessa formula di _calcWinnerTime lato client).
function _ogWinnerTime(km, media) {
  const k = parseFloat(km), m = parseFloat(media);
  if (!k || !m) return '';
  const totalSec = Math.round(k / m * 3600);
  const h = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  const mm = String(min).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}h ${mm}'${ss}"` : `${mm}'${ss}"`;
}
// Distacco FCI "a 14\"" → "+14\"" (stessa pulizia di _fmtGap lato client).
function _ogFmtGap(tempo) {
  if (!tempo || !String(tempo).trim()) return 'ST';
  return String(tempo).trim().replace(/^a\s*/, '+');
}

// Card OG per una gara SENZA foto disponibile: stessa lista risultati (fino
// a 10) mostrata nelle grafiche Instagram/Post generate lato client, invece
// della card generica con solo il nome della gara — più informativa e
// coerente su tutti i canali di condivisione, non solo su chi ha una foto
// caricata. Righe compatte e centrate verticalmente quando i risultati sono
// pochi (stesso fix applicato a _drawGaraColumn lato client), non stirate a
// riempire tutto lo spazio disponibile.
function buildGaraResultsCardSvg({ title, catLabel, date, mult, km, media, winnerTime, results = [] }) {
  const pad = 60;
  const medal = ['#f5c400', '#dadada', '#cd7f32'];
  // Niente regione in card: il dato non è sempre affidabile nei risultati
  // gara (a differenza della categoria, sempre corretta) — meglio ometterla
  // che rischiare di mostrarne una sbagliata su un'immagine pubblica.
  const headerRight = `
    <text x="1176" y="38" font-family="Arial,Helvetica,sans-serif" font-size="21" font-weight="800" fill="#e8001d" text-anchor="end" letter-spacing="1">${_ogEsc((catLabel || '').toUpperCase())}</text>`;

  const titleStr = (title || '').toUpperCase();
  const fsT = titleStr.length > 34 ? Math.max(26, Math.round(42 * 34 / titleStr.length)) : 42;
  const metaParts = [date, mult ? `×${mult}` : '', km ? `${km} km` : '', media ? `${media} km/h` : '', winnerTime ? `⏱ ${winnerTime}` : ''].filter(Boolean);

  const listTop0 = 150, listBot = 578;
  const n = results.length;
  const availH = listBot - listTop0;
  const rH = n ? Math.min(Math.round(availH / n), Math.round(availH / 6)) : 0;
  const listTop = listTop0 + Math.round((availH - rH * n) / 2);

  const rowsHtml = results.slice(0, 10).map((r, i) => {
    const ry = listTop + i * rH, mid = ry + rH / 2;
    const isFirst = i === 0;
    const name = `${r.cognome || ''} ${r.nome || ''}`.trim();
    return `${isFirst
        ? `<rect x="${pad}" y="${ry + 2}" width="${1200 - pad * 2}" height="${rH - 4}" rx="8" fill="rgba(245,196,0,0.07)" stroke="rgba(245,196,0,0.35)"/>`
        : (i % 2 === 0 ? `<rect x="${pad}" y="${ry}" width="${1200 - pad * 2}" height="${rH}" fill="rgba(255,255,255,0.022)"/>` : '')}
    <rect x="${pad + 10}" y="${mid - 15}" width="42" height="30" rx="6" fill="${i < 3 ? medal[i] : 'rgba(255,255,255,0.08)'}"/>
    <text x="${pad + 31}" y="${mid + 7}" font-family="Arial,Helvetica,sans-serif" font-size="17" font-weight="800" fill="${i < 3 ? '#1a1200' : 'rgba(255,255,255,0.5)'}" text-anchor="middle">${String(i + 1).padStart(2, '0')}</text>
    <text x="${pad + 68}" y="${mid + 7}" font-family="Arial,Helvetica,sans-serif" font-size="23" font-weight="700" fill="${i < 3 ? '#f4f4f4' : 'rgba(255,255,255,0.88)'}">${_ogEsc(name.slice(0, 26))}</text>
    <text x="${pad + 560}" y="${mid + 7}" font-family="Arial,Helvetica,sans-serif" font-size="16" fill="rgba(255,255,255,0.4)">${_ogEsc((r.team || '').slice(0, 26))}</text>
    <text x="${1200 - pad - 10}" y="${mid + 7}" font-family="Arial,Helvetica,sans-serif" font-size="19" font-weight="700" fill="${isFirst ? 'rgba(245,196,0,0.85)' : 'rgba(255,255,255,0.4)'}" text-anchor="end">${_ogEsc(isFirst ? (winnerTime || '') : _ogFmtGap(r.tempo))}</text>`;
  }).join('');

  const body = `
    <text x="${pad}" y="102" font-family="Arial,Helvetica,sans-serif" font-size="${fsT}" font-weight="800" fill="#f4f4f4">${_ogEsc(titleStr)}</text>
    <text x="${pad}" y="128" font-family="Arial,Helvetica,sans-serif" font-size="18" fill="rgba(255,255,255,0.4)">${_ogEsc(metaParts.join('   ·   '))}</text>
    <rect x="${pad}" y="138" width="${1200 - pad * 2}" height="1" fill="rgba(255,255,255,0.08)"/>
    ${rowsHtml}`;
  return _ogWrap(body, { headerRight });
}

async function renderOgPng(svgStr) {
  try {
    const sharp = require('sharp');
    // JPEG invece di PNG per l'output finale: le card sono foto/pannelli
    // scuri con testo, non grafica piatta — PNG lossless le rendeva 3-5
    // volte piu' pesanti del necessario per un'immagine di anteprima social,
    // un costo diretto in banda (rilevante dopo l'aggiornamento al piano
    // Render Pro per aver esaurito i GB inclusi).
    return await sharp(Buffer.from(svgStr)).flatten({ background: '#0a0c10' }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
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
    // _ogGenerateDeduped: se la generazione fallisce ma esiste già una
    // versione buona precedente (anche scaduta), la riserve invece del logo
    // generico — vedi commento sulla funzione per il perché.
    const buf = await _ogGenerateDeduped(cacheKey, async () => {
      // Statistiche atleta (servono sia per la card foto+testo sia per quella
      // di solo testo): athletes.json da GitHub, affidabile su Render.
      const athletes = (await readDataJsonFromGH('athletes.json')) || {};
      const a = athletes[atletaId] || {};
      const cognome = a.cognome || '', nomeP = a.nome || '';
      const ris = a.risultati || [];
      const p1 = ris.filter(r => Number(r.posizione) === 1).length;
      const p2 = ris.filter(r => Number(r.posizione) === 2).length;
      const p3 = ris.filter(r => Number(r.posizione) === 3).length;
      const p4_10 = ris.filter(r => Number(r.posizione) >= 4 && Number(r.posizione) <= 10).length;
      const badge = (a.categoria || '').replace(/_/g, ' ');
      // Posizione in classifica di categoria: stessi criteri della pagina
      // Classifiche (punti_totali stagionali), confrontata con gli atleti della
      // stessa categoria/genere.
      let pos = null;
      if (a.categoria && a.genere) {
        const peers = Object.values(athletes)
          .filter(x => x.categoria === a.categoria && x.genere === a.genere && (x.punti_totali || 0) > 0)
          .sort((x, y) => (y.punti_totali || 0) - (x.punti_totali || 0));
        const idx = peers.findIndex(x => x.id === atletaId);
        if (idx >= 0) pos = idx + 1;
      }
      const cardData = { cognome, nome: nomeP, team: a.team_attuale || '', badge, punti: a.punti_totali || 0, pos, p1, p2, p3, p4_10 };

      // Card di testo piena larghezza (nome, badge, hero punti+posizione,
      // griglia statistiche) sempre come base; se l'atleta ha una foto profilo,
      // sovrapponiamo un avatar circolare in alto a destra — stesso layout
      // della card "Post Quadrato" generata lato client (generateShareCanvas),
      // indicato dall'utente come riferimento esatto da seguire.
      const svg = buildAtletaCardSvg(cardData);
      let b;
      try {
        const photo = await getEntityPhoto('atleta', atletaId);  // URL pubblico o null
        b = photo ? await _ogCardWithAvatar(svg, photo) : null;
      } catch { b = null; }
      if (!b) b = await renderOgPng(svg);
      return b;
    });
    if (!buf) return res.redirect('/assets/og-default.png');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.send(buf);
  } catch (e) { res.redirect('/assets/og-default.png'); }
});

// Estrae l'id video da un URL YouTube (watch?v=, youtu.be/, embed/).
function _extractYouTubeId(url) {
  if (!url) return null;
  const m = url.match(/[?&]v=([\w-]{11})/) || url.match(/youtu\.be\/([\w-]{11})/) || url.match(/embed\/([\w-]{11})/);
  return m ? m[1] : null;
}

// Scarica una foto (file locale in uploads/ o URL) come buffer grezzo, senza
// ridimensionarla — il resize/crop dipende da dove verrà usata (sfondo pieno
// per le gare, pannello stretto per le card atleta/team a due colonne).
async function _fetchRawImageBuffer(filename) {
  if (!filename) return null;
  try {
    const local = path.join(UPLOADS_DIR, filename);
    if (fs.existsSync(local)) return fs.readFileSync(local);
    const url = /^https?:\/\//.test(filename)
      ? filename
      : `${SUPABASE_PUB}/photos/${filename.replace(/^\/+/, '')}`;
    // User-Agent "da browser": alcuni object storage esterni (es. xpix.it,
    // ospitato su un bucket Hetzner) rifiutano o rallentano richieste con lo
    // User-Agent generico di Node/undici usato di default da fetch() — le
    // foto xpix nella card di condivisione fallivano silenziosamente e
    // ricadevano sul logo statico, senza errore visibile nei log.
    const r = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ItaliaCyclingStatsBot/1.0; +https://italiacyclingstats.com)' },
    });
    if (!r.ok) { console.error(`[og-image] fetch fallito (${r.status}) per ${url}`); return null; }
    return Buffer.from(await r.arrayBuffer());
  } catch (e) { console.error(`[og-image] fetch eccezione per ${filename}:`, e.message); return null; }
}

// Sceglie la strategia di posizionamento per un ritaglio "cover": per le
// foto orizzontali/quadrate 'attention' (analisi entropia/salienza di sharp)
// funziona bene, il ritaglio necessario è modesto. Per le foto VERTICALI
// (tipiche degli scatti da smartphone all'arrivo) il ritaglio verso un
// formato largo è invece drastico — su un caso reale verificato (foto
// 1152x2048 ridotta a una fascia di soli 630px) 'attention' ha scelto lo
// striscione/l'arco d'arrivo sopra la testa del corridore (alto contrasto
// per le righe del tessuto e il fogliame degli alberi) invece del corridore
// stesso, che pur essendo il soggetto ha meno "rumore" visivo grezzo di
// quanto ne rilevi l'euristica. In verticale il fotografo inquadra quasi
// sempre il soggetto vicino al centro: il centro geometrico ('centre',
// default di sharp) si è dimostrato molto più affidabile in questo caso.
function _ogCropPosition(meta) {
  const sharp = require('sharp');
  return (meta && meta.height > meta.width * 1.15) ? 'centre' : sharp.strategy.attention;
}

// Carica una foto e la adatta a 1200x630 PNG (sfondo pieno, usato per le gare).
// Rettangolo di ritaglio manuale — stessa formula di _photoCoverRect lato
// client (app.js), qui su meta.width/height di sharp invece che su un
// elemento Image del DOM. Usato SOLO quando l'admin ha regolato a mano
// zoom/posizione nella modale di condivisione (altrimenti si continua a
// usare il ritaglio automatico 'attention'/'centre' già esistente, che
// resta il default per tutte le gare mai regolate a mano).
function _photoCoverRectServer(meta, W, H, adjust) {
  const { scale = 1, offsetX = 0, offsetY = 0 } = adjust || {};
  const ir = meta.width / meta.height, cr = W / H;
  let baseSw, baseSh;
  if (ir > cr) { baseSh = meta.height; baseSw = baseSh * cr; }
  else { baseSw = meta.width; baseSh = baseSw / cr; }
  const s = Math.max(1.12, scale);
  let sw = baseSw / s, sh = baseSh / s;
  let sx = (meta.width - baseSw) / 2 + (baseSw - sw) / 2 - offsetX * (baseSw / W);
  let sy = (meta.height - baseSh) / 2 + (baseSh - sh) / 2 - offsetY * (baseSh / H);
  sx = Math.max(0, Math.min(sx, meta.width - sw));
  sy = Math.max(0, Math.min(sy, meta.height - sh));
  return { left: Math.round(sx), top: Math.round(sy), width: Math.max(1, Math.round(sw)), height: Math.max(1, Math.round(sh)) };
}
// Un adjust è "attivo" solo se scale/offset si discostano davvero dal default
// — evita di deviare sul ritaglio manuale (e invalidare la cache) per un
// oggetto {scale:1,offsetX:0,offsetY:0} passato ma non voluto dall'utente.
function _hasImgAdjust(adjust) {
  return !!adjust && (adjust.scale > 1.001 || Math.abs(adjust.offsetX || 0) > 0.5 || Math.abs(adjust.offsetY || 0) > 0.5);
}

async function _photoToOgPng(filename, adjust) {
  const raw = await _fetchRawImageBuffer(filename);
  if (!raw) return null;
  try {
    const sharp = require('sharp');
    const meta = await sharp(raw).metadata();
    const pipeline = _hasImgAdjust(adjust)
      ? sharp(raw).extract(_photoCoverRectServer(meta, 1200, 630, adjust)).resize(1200, 630, { fit: 'fill' })
      : sharp(raw).resize(1200, 630, { fit: 'cover', position: _ogCropPosition(meta) });
    // Qualità alta (95): a 85 le foto condivise su FB apparivano visibilmente
    // compresse/sgranate — questa è l'immagine finale mostrata nell'anteprima
    // social, vale la pena di qualche KB in più.
    return await pipeline.jpeg({ quality: 95, mozjpeg: true }).toBuffer();
  } catch { return null; }
}

// Card "risultati su foto intera" (stile indicato dall'utente, riferimento
// una grafica del sito "domestique"): a differenza del vecchio pannello a
// metà larghezza (buildGaraPodiumPanelSvg, sostituito da questa), la foto
// riempie TUTTO il riquadro 1200x630 e i risultati sono sovrapposti in
// basso su un degradé scuro — la foto resta protagonista, il testo è
// leggibile solo dove serve. Fino a 5 posizioni (non solo il podio):
// più contenuto reale nella stessa card, come nel riferimento.
function buildGaraResultOverlaySvg({ catLabel, title, subtitle, results = [], credit = null }) {
  const W = 1200, H = 630, pad = 56;
  const medal = ['#f5c400', '#dadada', '#cd7f32'];
  const titleStr = (title || '').toUpperCase();
  const fitTitle = (text, base, maxW) => {
    const est = (text || '').length * base * 0.6;
    return est > maxW ? Math.max(30, Math.floor(base * maxW / est)) : base;
  };
  const fsT = fitTitle(titleStr, 56, W - pad * 2);

  // Solo podio (3): con meno righe c'è più spazio verticale per riga,
  // sfruttato per nomi/team più grandi invece di stiparne fino a 5.
  const n = Math.min(results.length, 3);
  const rowsTop = 344, rowsBottom = H - 66;
  const rH = Math.round((rowsBottom - rowsTop) / n);
  const nameX = pad + 62, teamX = 760, timeX = W - pad;
  const fitRow = (text, base, avail) => {
    const est = (text || '').length * base * 0.58;
    return est > avail ? Math.max(13, Math.floor(base * avail / est)) : base;
  };

  const rows3 = results.slice(0, n).map((r) => {
    const isTeamResult = !r.atleta_id && (r.team || r.team_id);
    const name = isTeamResult ? (r.team || r.team_id) : `${r.cognome || ''} ${r.nome || ''}`.trim();
    const team = isTeamResult ? '' : (r.team || '');
    return { r, name, team };
  });
  // Un'unica dimensione team per tutte le righe (non una a riga, che le
  // rendeva disomogenee) — calcolata sul nome team più lungo dei tre, così
  // restano leggibili e della stessa grandezza tra loro.
  const teamAvail = timeX - 130 - teamX - 20;
  const teamSizeShared = rows3.reduce((min, { team }) => Math.min(min, fitRow(team, 21, teamAvail)), 21);

  const rowsHtml = rows3.map(({ r, name, team }, i) => {
    const ry = rowsTop + i * rH, mid = ry + rH / 2;
    const nameSize = fitRow(name, 26, teamX - nameX - 20);
    const time = r.posizione === 1 ? (r.tempo || '') : _ogFmtGap(r.tempo);
    return `
    <line x1="${pad}" y1="${ry}" x2="${W - pad}" y2="${ry}" stroke="rgba(255,255,255,0.15)"/>
    <rect x="${pad}" y="${mid - 17}" width="44" height="34" rx="6" fill="${medal[i]}"/>
    <text x="${pad + 22}" y="${mid + 7}" font-family="Arial,Helvetica,sans-serif" font-size="17" font-weight="800" fill="#1a1200" text-anchor="middle">${String(r.posizione ?? i + 1).padStart(2, '0')}</text>
    <text x="${nameX}" y="${mid + 8}" font-family="Arial,Helvetica,sans-serif" font-size="${nameSize}" font-weight="800" fill="#fff">${_ogEsc(name)}</text>
    ${team ? `<text x="${teamX}" y="${mid + 7}" font-family="Arial,Helvetica,sans-serif" font-size="${teamSizeShared}" font-weight="700" fill="rgba(255,255,255,0.65)">${_ogEsc(team)}</text>` : ''}
    ${time ? `<text x="${timeX}" y="${mid + 7}" font-family="Arial,Helvetica,sans-serif" font-size="19" fill="rgba(255,255,255,0.85)" text-anchor="end">${_ogEsc(time)}</text>` : ''}`;
  }).join('');

  const logo = _ogLogoDataUri();

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="ovg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity="0"/>
      <stop offset="38%" stop-color="#000" stop-opacity="0"/>
      <stop offset="60%" stop-color="#000" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.94"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#ovg)"/>
  <text x="${pad}" y="248" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="800" letter-spacing="2" fill="#e8001d">RISULTATI${catLabel ? ' · ' + _ogEsc((catLabel||'').toUpperCase()) : ''}</text>
  <text x="${pad}" y="304" font-family="Arial,Helvetica,sans-serif" font-size="${fsT}" font-weight="800" fill="#fff">${_ogEsc(titleStr.slice(0, 48))}</text>
  ${subtitle ? `<text x="${pad}" y="336" font-family="Arial,Helvetica,sans-serif" font-size="19" fill="rgba(255,255,255,0.55)">${_ogEsc(subtitle)}</text>` : ''}
  ${rowsHtml}
  <line x1="${pad}" y1="${rowsBottom}" x2="${W - pad}" y2="${rowsBottom}" stroke="rgba(255,255,255,0.15)"/>
  ${logo ? `<image href="${logo}" x="${pad}" y="${H - 46}" width="72" height="24" preserveAspectRatio="xMidYMid meet"/>` : ''}
  <text x="${pad + (logo ? 84 : 0)}" y="${H - 28}" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="700" fill="rgba(255,255,255,0.55)">italiacyclingstats.com</text>
  ${/xpix/i.test(credit || '') && _ogXpixLogoDataUri()
    ? `<image href="${_ogXpixLogoDataUri()}" x="${W - pad - 130}" y="${H - 44}" width="24" height="24" preserveAspectRatio="xMidYMid meet"/>
       <text x="${W - pad}" y="${H - 28}" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="700" fill="rgba(255,255,255,0.6)" text-anchor="end">xpix.it</text>`
    : credit ? `<text x="${W - pad}" y="${H - 28}" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="700" fill="rgba(255,255,255,0.6)" text-anchor="end">📷 ${_ogEsc(credit)}</text>` : ''}
</svg>`;
}

// Compone la foto a piena pagina (1200x630, ritaglio "cover") con l'overlay
// testo sopra — stessa strategia di ritaglio (_ogCropPosition) del resto
// delle card gara, ma senza dividere la foto a metà: rimane protagonista.
async function _photoOverlayOgPng(filename, overlaySvg, adjust) {
  const raw = await _fetchRawImageBuffer(filename);
  if (!raw) return null;
  try {
    const sharp = require('sharp');
    const meta = await sharp(raw).metadata();
    // photoBuf resta PNG (senza perdita) qui: un .toBuffer() "nudo" dopo
    // resize() riesporta nel formato sorgente (spesso JPEG) alla qualità di
    // default di sharp (80) — un primo giro di compressione invisibile PRIMA
    // ancora di comporre l'overlay e ri-comprimere in JPEG finale, che
    // sommato rendeva le foto condivise su FB visibilmente più sgranate.
    const photoPipeline = _hasImgAdjust(adjust)
      ? sharp(raw).extract(_photoCoverRectServer(meta, 1200, 630, adjust)).resize(1200, 630, { fit: 'fill' })
      : sharp(raw).resize(1200, 630, { fit: 'cover', position: _ogCropPosition(meta) });
    const photoBuf = await photoPipeline.png({ compressionLevel: 6 }).toBuffer();
    const overlayBuf = await sharp(Buffer.from(overlaySvg)).png().toBuffer();
    return await sharp(photoBuf).composite([{ input: overlayBuf, left: 0, top: 0 }]).jpeg({ quality: 95, mozjpeg: true }).toBuffer();
  } catch (e) { console.error('[og-image] overlay card fallita:', e.message); return null; }
}

// Ritaglia una foto in un cerchio (avatar), stesso trattamento della card
// "Post Quadrato" generata lato client (generateShareCanvas/_drawAtleta):
// avatar circolare in alto a destra, non una foto a piena pagina o a
// pannello — è il riferimento visivo esatto indicato dall'utente.
async function _ogCircleAvatar(photoSource, diameter) {
  const raw = await _fetchRawImageBuffer(photoSource);
  if (!raw) return null;
  try {
    const sharp = require('sharp');
    // Ancorato in alto ('top'), non centro/attenzione come le foto gara: le
    // foto profilo (headshot PCS) hanno quasi sempre il viso nella parte alta
    // dell'inquadratura — stessa convenzione già usata lato client per
    // l'avatar della card atleta (_drawAtleta: "ritaglia dall'alto, viso in
    // cima") e per il crop dell'immagine profilo nella pagina atleta
    // (object-position: 50% 0%). Un ritaglio centrato, corretto per le foto
    // di gara (soggetto a figura intera), su un headshot stretto in un
    // cerchio piccolo tagliava il viso in modo molto più evidente.
    const resized = await sharp(raw).resize(diameter, diameter, { fit: 'cover', position: 'top' }).toBuffer();
    const mask = Buffer.from(`<svg width="${diameter}" height="${diameter}"><circle cx="${diameter/2}" cy="${diameter/2}" r="${diameter/2}" fill="#fff"/></svg>`);
    const circle = await sharp(resized).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    // Bordo sottile per staccare l'avatar dallo sfondo scuro
    const ring = Buffer.from(`<svg width="${diameter}" height="${diameter}"><circle cx="${diameter/2}" cy="${diameter/2}" r="${diameter/2-1}" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="2"/></svg>`);
    return await sharp(circle).composite([{ input: ring }]).png().toBuffer();
  } catch { return null; }
}

// Compone la card di testo (piena larghezza, stessa identità delle card
// senza foto) con un avatar circolare sovrapposto in alto a destra, quando
// l'atleta/team ha una foto profilo.
async function _ogCardWithAvatar(cardSvg, photoSource, { diameter = 150, cx = 1200 - 66 - 150, cy = 74 } = {}) {
  const buf = await renderOgPng(cardSvg);
  if (!buf) return null;
  const avatar = await _ogCircleAvatar(photoSource, diameter);
  if (!avatar) return buf;
  try {
    const sharp = require('sharp');
    return await sharp(buf).composite([{ input: avatar, left: Math.round(cx), top: Math.round(cy) }]).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  } catch { return buf; }
}

// Percorso "con foto" (foto gara a piena pagina + risultati in overlay),
// estratto in una funzione a parte per poterlo mettere in gara contro un
// timeout in _generateGaraOgBuffer — vedi commento lì. Ritorna il buffer
// JPEG o null.
async function _generateGaraPhotoBuffer(garaId, results, catLabel, title, subtitle, adjust) {
  try {
    // Il credit (nome fotografo o fonte esterna) dipende da QUALE foto viene
    // trovata — l'overlay va quindi ricostruito per ogni fonte tentata
    // (foto caricata a mano → xpix.it → ciclismo.info), non una volta sola
    // prima di sapere quale foto si userà davvero.
    const toImage = async (photoSource, credit) => {
      const overlaySvg = results.length ? buildGaraResultOverlaySvg({ catLabel, title, subtitle, results, credit }) : null;
      return overlaySvg
        ? (await _photoOverlayOgPng(photoSource, overlaySvg, adjust)) || (await _photoToOgPng(photoSource, adjust))
        : await _photoToOgPng(photoSource, adjust);
    };

    const uploaded = await queries.getApprovedRacePhotos(garaId).catch(() => []);
    if (uploaded && uploaded.length) {
      const buf = await toImage(uploaded[0].filename || uploaded[0].photo_url, uploaded[0].photographer || null);
      if (buf) return buf;
    }
    const aliases = [garaId, garaId.replace(/^\d+_/, ''), garaId.replace(/_[A-Z0-9]+_[MF]$/, '')];
    const [xpix, ic] = await Promise.all([readXpixPhotos(), readICPhotos()]);
    for (const [src, srcCredit] of [[xpix, 'xpix.it'], [ic, 'ciclismo.info']]) {
      for (const alias of aliases) {
        const entry = src[alias];
        if (entry && (entry.url || entry.filename)) {
          const buf = await toImage(entry.url || entry.filename, srcCredit);
          if (buf) return buf;
        }
      }
    }

    // Niente foto: se c'è un video collegato, usa la sua miniatura come
    // copertina (a piena larghezza, senza pannello podio — la miniatura
    // YouTube è già bassa risoluzione, dividerla a metà la renderebbe
    // illeggibile) — meglio di una card generica se almeno un contenuto
    // reale della gara esiste. Un video può essere stato collegato usando
    // il gara_id del calendario (prima dello scraping) invece di quello
    // reale suffissato: stessi alias usati sopra per le foto.
    const allVideos = await readVideos().catch(() => ({}));
    for (const alias of aliases) {
      const vids = allVideos[alias];
      if (vids && vids.length) {
        const vidId = _extractYouTubeId(vids[0].url);
        if (vidId) {
          const buf = await _photoToOgPng(`https://img.youtube.com/vi/${vidId}/hqdefault.jpg`);
          if (buf) return buf;
        }
      }
    }
  } catch (e) { console.error(`[og-image] lookup foto fallito per ${garaId}:`, e.message); }
  return null;
}

async function _generateGaraOgBuffer(garaId, adjust) {
  // Nome gara: dal calendario (GitHub, affidabile su Render) o dall'id.
  // Il calendario usa l'id senza suffisso categoria/genere: stesso fallback
  // di /og/gara/:id, altrimenti titolo/data/luogo restano vuoti quando si
  // condivide dalla pagina di una gara già scrapata (id suffissato).
  const calendar = (await readDataJsonFromGH('calendar.json')) || [];
  const cal = calendar.find(g => g.id === garaId)
    || calendar.find(g => g.id === garaId.replace(/_[A-Z0-9]+_[MF]$/, ''));
  const title = cal?.nome || garaId.replace(/_\d{4}-\d{2}-\d{2}.*$/, '').replace(/_/g, ' ');

  // Risultati caricati una sola volta, riusati sia per il pannello podio
  // accanto alla foto (quando c'è) sia per la card "lista risultati" a
  // piena larghezza (quando non c'è) — prima venivano ricaricati solo nel
  // fallback senza foto, la foto e i risultati non comparivano mai insieme.
  const resultsRaw = (await readDataJsonFromGH('results_raw.json')) || [];
  const results = resultsRaw.filter(r => r.gara_id === garaId).sort((a, b) => a.posizione - b.posizione);
  const first = results[0];
  const catCode = first ? _rankingCodeFromRow(first) : null;
  const catLabel = first ? ((catCode && _OG_CAT_MAP[catCode]) || first.categoria || '') : '';
  const dateShort = cal?.data ? new Date(cal.data).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  // 1) Se la gara ha una foto, usala come metà sinistra della card, con un
  // pannello podio (primi 3) nella metà destra quando ci sono risultati —
  // così la card è sempre coerente (stessa identità visiva ovunque) invece
  // di essere a volte solo la foto e a volte solo un pannello testuale.
  // Tre fonti possibili per la foto (stessa priorità e stesso matching
  // "fuzzy" del gara_id usati lato frontend in loadRisPhotos/_extAlias):
  // caricata a mano (race_photos) vince se presente, altrimenti xpix.it,
  // altrimenti ciclismo.info.
  // Percorso con foto messo in gara contro un timeout: comporta più fetch
  // remoti (foto gara + avatar podio) e su una gara mai richiesta prima può
  // richiedere diversi secondi — troppo per la pazienza dello scraper di
  // Facebook al primo tentativo (segnalato piu' volte dall'utente). Se scade
  // il timeout si passa subito alla card di solo testo (molto più veloce,
  // niente fetch di immagini remote) invece di lasciare la richiesta appesa.
  // 8s: nei test reali anche generazioni riuscite (foto + 3 avatar podio)
  // hanno impiegato fino a ~6.3s in condizioni normali (non cold-start) —
  // un timeout più stretto (provati 3.5s e 5s) buttava via la card con
  // foto anche in casi legittimi, segnalato piu' volte dall'utente
  // (Bassano Monte Grappa: foto xpix.it verificata veloce da sola, quindi
  // il rallentamento viene dal fetch delle foto profilo dei 3 del podio).
  const photoSubtitle = [dateShort, cal?.luogo || cal?.regione || ''].filter(Boolean).join(' · ');
  const photoBuf = await Promise.race([
    _generateGaraPhotoBuffer(garaId, results, catLabel, title, photoSubtitle, adjust),
    new Promise(resolve => setTimeout(() => resolve(null), 8000)),
  ]);
  if (photoBuf) return photoBuf;

  // 2) Niente foto né video (o il percorso foto ha impiegato troppo): la
  // stessa card "lista risultati" mostrata
  // nelle grafiche Instagram/Post generate lato client (posizioni, nomi,
  // team, tempi) invece della card generica con solo il nome.
  try {
    if (results.length) {
      const svg = buildGaraResultsCardSvg({
        title, catLabel, date: dateShort,
        mult: first.moltiplicatore || 1,
        km: first.km || '', media: first.media || '',
        winnerTime: _ogWinnerTime(first.km || '', first.media || ''),
        results,
      });
      const buf = await renderOgPng(svg);
      if (buf) return buf;
    }
  } catch (e) { console.error(`[og-image] card risultati fallita per ${garaId}:`, e.message); }

  // 3) Nessun risultato disponibile (gara futura): logo ICS + nome gara
  const date = cal?.data ? new Date(cal.data).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const subtitle = [date, cal?.luogo || cal?.regione || ''].filter(Boolean).join(' · ');
  const svg = buildGaraNameSvg(title, subtitle);
  return await renderOgPng(svg);
}

// Svuota la cache in-memory della grafica OG per una gara, cosi' la prossima
// richiesta rigenera da zero — utile quando il timeout di 3.5s (vedi
// _generateGaraOgBuffer) e' scattato su un caso limite e la card di solo
// testo e' rimasta in cache per i restanti 30 minuti anche se un secondo
// tentativo con piu' margine avrebbe trovato la foto in tempo.
app.post('/api/admin/og-cache-bust/gara/:id', requireAdmin, (req, res) => {
  const garaId = decodeURIComponent(req.params.id);
  const had = _ogCache.delete(`gara_${garaId}`);
  res.json({ ok: true, hadCache: had });
});

// Diagnostica invio email: sendEmail() cattura l'errore internamente e non lo
// espone mai al chiamante (per non rivelare dettagli su endpoint pubblici
// come forgot-password) — qui invece, solo per l'admin, chiamiamo il
// provider direttamente e restituiamo l'errore reale così si vede cosa
// blocca davvero l'invio. Prova prima Brevo (se configurato), altrimenti SMTP.
app.post('/api/admin/test-email', requireAdmin, async (req, res) => {
  const to = (req.body && req.body.to) || req.user.email;
  const subject = 'Test invio email — Italia Cycling Stats';
  const text = 'Email di test per verificare la configurazione email del sito. Se la leggi, funziona!';
  const html = '<p>Email di test per verificare la configurazione email del sito. Se la leggi, funziona!</p>';

  if (process.env.BREVO_API_KEY) {
    try {
      const info = await _sendViaBrevo({ to, subject, html, text });
      return res.json({ ok: true, provider: 'brevo', message: `Inviata a ${to} via Brevo. Controlla la casella (anche spam).`, messageId: info.messageId });
    } catch (e) {
      return res.json({ ok: false, provider: 'brevo', error: e.message, code: e.code, sender: process.env.BREVO_SENDER_EMAIL || process.env.SMTP_USER });
    }
  }

  if (!_transporter) {
    return res.json({ ok: false, error: 'Nessun provider email configurato: manca BREVO_API_KEY oppure SMTP_HOST/SMTP_USER/SMTP_PASS su Render.' });
  }
  try {
    const info = await _transporter.sendMail({
      from: process.env.SMTP_FROM || `"ItaliacritResultati" <${process.env.SMTP_USER}>`,
      to, subject, text, html,
    });
    res.json({ ok: true, provider: 'smtp', message: `Inviata a ${to}. Controlla la casella (anche spam).`, messageId: info.messageId, response: info.response });
  } catch (e) {
    res.json({ ok: false, provider: 'smtp', error: e.message, code: e.code, host: process.env.SMTP_HOST, port: process.env.SMTP_PORT || '587', user: process.env.SMTP_USER });
  }
});

// Regolazione manuale zoom/posizione della foto (?s=scala&ox=..&oy=..),
// impostata nella modale di condivisione — vedi _shareImgAdjust in app.js.
// null se assente/di default, così il ritaglio automatico esistente resta
// invariato per tutte le gare mai regolate a mano.
function _parseImgAdjust(q) {
  const s = parseFloat(q.s), ox = parseFloat(q.ox), oy = parseFloat(q.oy);
  const adjust = {
    scale: Number.isFinite(s) && s > 0 ? s : 1,
    offsetX: Number.isFinite(ox) ? ox : 0,
    offsetY: Number.isFinite(oy) ? oy : 0,
  };
  return _hasImgAdjust(adjust) ? adjust : null;
}

app.get('/api/og-image/gara/:id', async (req, res) => {
  const garaId = decodeURIComponent(req.params.id);
  const adjust = _parseImgAdjust(req.query);
  // Una regolazione manuale rende la cache condivisa "gara_<id>" inadatta
  // (sovrascriverebbe/servirebbe l'inquadratura di un altro utente) — la
  // chiave include quindi i parametri quando presenti.
  const cacheKey = `gara_${garaId}` + (adjust ? `_${adjust.scale.toFixed(2)}_${Math.round(adjust.offsetX)}_${Math.round(adjust.offsetY)}` : '');
  try {
    const buf = await _ogGenerateDeduped(cacheKey, () => _generateGaraOgBuffer(garaId, adjust));
    if (!buf) return res.redirect('/assets/og-default.png');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.send(buf);
  } catch (e) { res.redirect('/assets/og-default.png'); }
});

app.get('/api/og-image/team/:id', async (req, res) => {
  try {
    const teamId = decodeURIComponent(req.params.id);
    const cacheKey = `team_${teamId}`;
    const buf = await _ogGenerateDeduped(cacheKey, async () => {
      // Bug corretto: confrontava r.team (il NOME visualizzato, es. "Team
      // Hoppla'") con teamId (lo slug id, es. "TEAM_HOPPLA") — non
      // corrispondevano mai, quindi l'immagine falliva sempre e finiva sul logo
      // generico di default. Va confrontato team_id. Anche readDataJsonFromGH
      // invece di readDataJson (locale, non affidabile su Render), come il
      // resto delle route OG.
      const [results, teams] = await Promise.all([
        readDataJsonFromGH('results_raw.json'),
        readDataJsonFromGH('teams.json'),
      ]);
      const teamRows = (results || []).filter(r => (r.team_id || '') === teamId);
      if (!teamRows.length) return null;
      const teamName = (teams || {})[teamId]?.nome || teamId.replace(/_/g, ' ');
      const punti = (teams || {})[teamId]?.punti_totali || 0;
      const wins  = teamRows.filter(r => Number(r.posizione) === 1).length;
      const top3  = teamRows.filter(r => Number(r.posizione) <= 3).length;
      const races = new Set(teamRows.map(r => r.gara_id)).size;
      const riders = new Set(teamRows.map(r => r.atleta_id)).size;
      const teamCardData = { nome: teamName, punti, wins, top3, races, riders };

      // Card di testo piena larghezza come base, con avatar circolare in alto
      // a destra sovrapposto se il team ha un logo/foto profilo (override
      // admin) — stessa impostazione dell'atleta.
      const svg = buildTeamCardSvg({ ...teamCardData, badge: 'TEAM' });
      let b;
      try {
        const photo = await getEntityPhoto('team', teamId);
        b = photo ? await _ogCardWithAvatar(svg, photo) : null;
      } catch { b = null; }
      if (!b) b = await renderOgPng(svg);
      return b;
    });
    if (!buf) return res.redirect('/assets/og-default.png');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.send(buf);
  } catch (e) { res.redirect('/assets/og-default.png'); }
});

app.get('/api/og-image/class/:id', async (req, res) => {
  try {
    const cacheKey = `class_${req.params.id}`;
    const buf = await _ogGenerateDeduped(cacheKey, async () => {
      const { catLabelText, region, monthLabel, ranking } = await _computeClassRanking(req.params.id);
      if (!ranking.length) return null;
      const svg = buildClassCardSvg({ catLabel: catLabelText, region, month: monthLabel, rows: ranking });
      return await renderOgPng(svg);
    });
    if (!buf) return res.redirect('/assets/og-default.png');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.send(buf);
  } catch (e) { res.redirect('/assets/og-default.png'); }
});

// ── SPA fallback (Fase 2 SEO: URL puliti) ───────────────────────────────────
// DEVE essere l'ultima route (registrata dopo tutte le API e dopo
// express.static più sopra): se nessuna route/file statico precedente ha
// già risposto, il path non è un'API né un file reale — lo trattiamo come
// una pagina interna della SPA (es. /gara/xxx) e serviamo comunque
// index.html con status 200. L'app JS legge poi il vero path da
// location.pathname e renderizza la pagina corretta lato client. Senza
// questo, una navigazione diretta o un refresh su un URL pulito darebbe un
// 404 reale (quel path non esiste come file sul server).
// Bot di anteprima social (WhatsApp, Telegram, Facebook, Twitter/X, ecc.):
// non eseguono JavaScript, quindi su un URL "pulito" come /gara/:id
// vedrebbero solo la shell SPA vuota con i meta tag generici della home,
// non il titolo/descrizione/immagine di quella gara specifica — che invece
// esistono già, ma solo sotto /og/gara/:id. Per gli utenti umani non
// cambia nulla: solo questi bot vengono rediretti alla versione con i
// meta tag corretti, che loro seguono normalmente (non eseguono JS ma
// seguono i redirect HTTP).
app.get('*', (req, res, next) => {
  const p = req.path;
  if (p.startsWith('/api/') || p.startsWith('/og/') || p.startsWith('/data/') ||
      p.startsWith('/uploads/') || p.startsWith('/photos/') ||
      p === '/sitemap.xml' || p === '/robots.txt') return next();
  // Un path con estensione (es. /assets/logo.png mancante) è una richiesta
  // di file reale: se express.static non l'ha già servito sopra, è
  // genuinamente mancante — meglio un 404 vero che un index.html silenzioso.
  if (/\.[a-zA-Z0-9]+$/.test(p)) return next();

  const ua = req.headers['user-agent'] || '';
  if (OG_BOT_RE.test(ua)) {
    let m = p.match(/^\/(gara|atleta|team)\/([^/]+)\/?$/);
    if (m) return res.redirect(302, `/og/${m[1]}/${encodeURIComponent(m[2])}`);
    m = p.match(/^\/classifica\/([^/]+)\/?$/);
    if (m) return res.redirect(302, `/og/class/${encodeURIComponent(m[1])}`);
    // Profilo Media (creator o fotografo) — il link "vero" è /media/:id (ID
    // numerico o slug leggibile, es. /media/dnf-podcast); /media/creator/:id
    // (Creator tab) porta allo stesso profilo, stessa immagine/testo di
    // condivisione. Esclude le schede fisse (video/dirette/ecc.), che non
    // sono un profilo e hanno già il loro instradamento sopra.
    const MEDIA_FIXED_TABS = 'video|dirette|presentazioni|programmi-tv|altro|creator';
    m = p.match(new RegExp(`^/media/(?!(?:${MEDIA_FIXED_TABS})$)([\\w-]+)/?$`))
      || p.match(/^\/media\/creator\/([\w-]+)\/?$/);
    if (m) return res.redirect(302, `/og/media/${encodeURIComponent(m[1])}`);
  }

  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
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
      autoMediaChannelsSync();
      autoPodcastFeedsSync();
      setInterval(autoXpixSync, SYNC_INTERVAL);
      setInterval(autoYoutubeSync, SYNC_INTERVAL);
      setInterval(autoICSync, SYNC_INTERVAL);
      setInterval(autoMediaChannelsSync, SYNC_INTERVAL);
      setInterval(autoPodcastFeedsSync, SYNC_INTERVAL);
    }, 2 * 60 * 1000);
    app.listen(PORT, () => {
      console.log(`[server] ItaliacritAuth in ascolto su http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('[fatal] Impossibile connettersi al database:', err.message);
    process.exit(1);
  });
