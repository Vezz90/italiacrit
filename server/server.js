const express        = require('express');
const cors           = require('cors');
const bcrypt         = require('bcryptjs');
const jwt            = require('jsonwebtoken');
const multer         = require('multer');
const path           = require('path');
const fs             = require('fs');
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

// ── Supabase Storage ──────────────────────────────────────────────────────────
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
let supabase = null;
if (SUPABASE_URL && SUPABASE_SECRET) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);
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

app.use(cors({ origin: '*' }));
app.options('*', cors());
app.use(express.json());
app.use('/photos', express.static(UPLOADS_DIR));

const FRONTEND_DIR = path.join(__dirname, '..');
app.use(express.static(FRONTEND_DIR));

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

app.get('/og/gara/:id', async (req, res) => {
  const id  = req.params.id;
  const cal = (readDataJson('calendar.json') || []).find(g => g.id === id);
  const results = (readDataJson('results_raw.json') || [])
    .filter(r => r.gara_id === id)
    .sort((a,b) => a.posizione - b.posizione);
  const winner = results[0];

  const title = cal?.nome || id.replace(/_/g,' ');
  const date  = cal?.data ? new Date(cal.data).toLocaleDateString('it-IT',{day:'numeric',month:'long',year:'numeric'}) : '';
  const top3  = results.slice(0,3).map((r,i)=>`${i+1}° ${r.cognome} ${r.nome}`).join(' · ');
  const desc  = [date, top3].filter(Boolean).join(' — ');

  // Foto: prova foto vincitore, poi nessuna (usa default)
  const img = winner ? await getEntityPhoto('atleta', winner.atleta_id) : null;
  const redirect = `${SITE_URL}/#/gara/${encodeURIComponent(id)}`;
  res.setHeader('Content-Type','text/html');
  res.send(ogHtml({ title, desc, img, redirect }));
});

app.get('/og/atleta/:id', async (req, res) => {
  const id       = req.params.id;
  const athletes = readDataJson('athletes.json') || {};
  const ath      = athletes[id] || {};
  const title    = `${ath.cognome||''} ${ath.nome||''}`.trim() || id;
  const desc     = [ath.team_attuale, ath.categoria].filter(Boolean).join(' · ') || 'Atleta ItaliacritResultati';
  const img      = await getEntityPhoto('atleta', id);
  const redirect = `${SITE_URL}/#/atleta/${encodeURIComponent(id)}`;
  res.setHeader('Content-Type','text/html');
  res.send(ogHtml({ title, desc, img, redirect }));
});

app.get('/og/team/:id', async (req, res) => {
  const id    = req.params.id;
  const teams = readDataJson('teams.json') || {};
  const team  = teams[id] || {};
  const title = team.nome || id.replace(/_/g,' ');
  const desc  = `Team — ItaliacritResultati`;
  const img   = await getEntityPhoto('team', id);
  const redirect = `${SITE_URL}/#/team/${encodeURIComponent(id)}`;
  res.setHeader('Content-Type','text/html');
  res.send(ogHtml({ title, desc, img, redirect }));
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
    res.json({ token: makeToken(safe), user: safe });
  } catch (e) {
    res.status(500).json({ error: 'Errore durante il login' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await queries.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Utente non trovato' });
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
    const { gara_id, caption, photographer } = req.body;
    if (!gara_id) return res.status(400).json({ error: 'gara_id mancante' });
    if (!req.file) return res.status(400).json({ error: 'Nessun file ricevuto' });
    const filename     = await savePhoto(req, req.file);
    const display_name = req.user.display_name || req.user.email;
    const status       = req.user.role === 'admin' ? 'approved' : 'pending';
    await queries.insertRacePhoto({
      gara_id, user_id: req.user.id, display_name,
      filename, caption: caption || '', photographer: photographer || '', status,
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
    const { caption, photographer } = req.body;
    await queries.updateRacePhoto({ id: req.params.id, caption: caption || '', photographer: photographer || '' });
    res.json({ ok: true });
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

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

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
    const { gara_id, cal_id, url, title, description, channel } = req.body;
    if (!gara_id || !url) return res.status(400).json({ error: 'gara_id e url obbligatori' });
    // Usa sempre gara_id (include la categoria es. _JUN_M, _ELI_M) come chiave
    // così ogni categoria della stessa gara ha i propri video separati
    const key = gara_id;
    if (req.user.role === 'admin') {
      const videos = await readVideos();
      if (!videos[key]) videos[key] = [];
      if (videos[key].some(v => v.url === url)) return res.status(409).json({ error: 'Video già presente' });
      videos[key].unshift({ url, title: title || url, description: description || '', channel: channel || req.user.display_name || 'Admin', published_at: new Date().toISOString().slice(0,10) });
      await writeVideos(videos);
      return res.json({ ok: true, status: 'approved' });
    }
    const pending = await readPendingVideos();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2,7);
    pending.push({ id, gara_id, cal_id: key, type: 'youtube', url, title: title || url, description: description || '', channel: channel || '', submitted_by: req.user.display_name || req.user.email, submitted_at: new Date().toISOString() });
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
    const { gara_id, cal_id, title, channel } = req.body; // cal_id ignorato, usiamo sempre gara_id
    if (!gara_id) return res.status(400).json({ error: 'gara_id mancante' });
    if (!req.file) return res.status(400).json({ error: 'Nessun file ricevuto' });
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
      videos[key].unshift({ url: videoUrl, title: title || filename, description: '', channel: channel || req.user.display_name || 'Admin', published_at: new Date().toISOString().slice(0,10) });
      await writeVideos(videos);
      return res.json({ ok: true, status: 'approved', url: videoUrl });
    }
    const pending = await readPendingVideos();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2,7);
    pending.push({ id, gara_id, cal_id: key, type: 'upload', url: videoUrl, title: title || filename, description: '', channel: channel || '', submitted_by: req.user.display_name || req.user.email, submitted_at: new Date().toISOString() });
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
    videos[key].unshift({ url: v.url, title: v.title, description: v.description || '', channel: v.channel || v.submitted_by || '', published_at: (v.submitted_at || '').slice(0, 10) });
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
    videos[calId].unshift({
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

  for (const [chId, videos] of Object.entries(fetched)) {
    const ch = channels.find(c => c.id === chId);
    for (const v of videos) {
      if (knownUrls.has(v.url)) continue;
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
    const { gara_id, title, channel } = req.body;
    if (!gara_id) return res.status(400).json({ error: 'gara_id obbligatorio' });

    const queue = await readYTQueue();
    const i = queue.findIndex(q => q.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Non trovato' });

    const item   = queue[i];
    const videos = await readVideos();
    if (!videos[gara_id]) videos[gara_id] = [];

    if (!videos[gara_id].some(v => v.url === item.url)) {
      videos[gara_id].unshift({
        url:          item.url,
        title:        title   || item.title,
        description:  '',
        channel:      channel || item.channel_name || '',
        published_at: item.published_at || new Date().toISOString().slice(0, 10),
      });
      await writeVideos(videos);
    }

    queue[i].status           = 'approved';
    queue[i].approved_gara_id = gara_id;
    await writeYTQueue(queue);

    res.json({ ok: true });
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
    const { gara_id, selected_photo_url } = req.body;
    if (!gara_id) return res.status(400).json({ error: 'gara_id obbligatorio' });

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
    photos[gara_id] = {
      url:        chosenUrl,
      photos:     albumPhotos.length ? albumPhotos : [chosenUrl],
      album_name: item.album_name,
      album_slug: item.album_slug,
      album_page: item.album_page,
      source:     'xpix',
      gara_id,
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

app.get('/api/admin/ic/queue', requireAdmin, async (req, res) => {
  try { res.json({ queue: await readICQueue() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
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
    const { gara_id, selected_photo_url } = req.body;
    if (!gara_id) return res.status(400).json({ error: 'gara_id obbligatorio' });
    const queue = await readICQueue();
    const i = queue.findIndex(q => q.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Non trovato' });
    const item   = queue[i];
    const photos = await readICPhotos();
    photos[gara_id] = {
      url:        selected_photo_url || item.photo_url,
      gara_url:   item.gara_url,
      name:       item.name,
      gara_id,
      source:     'italiaciclismo',
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
