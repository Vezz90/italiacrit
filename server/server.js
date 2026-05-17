const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { queries } = require('./db');

const app  = express();
const PORT = 8002;
const JWT_SECRET = process.env.JWT_SECRET || 'italiacrit-dev-secret-2026';
const JWT_EXPIRES = '30d';

// ── Supabase Storage (produzione) o disco locale (sviluppo) ─────────────────
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
app.options('*', cors());   // preflight per tutte le route
app.use(express.json());
app.use('/photos', express.static(UPLOADS_DIR));

// Serve frontend statico dalla directory padre
const FRONTEND_DIR = path.join(__dirname, '..');
app.use(express.static(FRONTEND_DIR));

// ── Auth middleware ──────────────────────────────────────────────────────────

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

// ── Auth routes ──────────────────────────────────────────────────────────────

// POST /api/auth/register
app.post('/api/auth/register', (req, res) => {
  const { email, password, role, display_name } = req.body;

  const ALLOWED_ROLES = ['atleta', 'team', 'genitore', 'parente', 'appassionato'];
  if (!email || !password) return res.status(400).json({ error: 'Email e password obbligatorie' });
  if (password.length < 6)  return res.status(400).json({ error: 'Password minimo 6 caratteri' });
  if (!ALLOWED_ROLES.includes(role)) return res.status(400).json({ error: 'Tipo utente non valido' });

  const existing = queries.getUserByEmail.get(email);
  if (existing) return res.status(409).json({ error: 'Email già registrata' });

  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = queries.createUser.run({
      email:        email.trim().toLowerCase(),
      password:     hash,
      role:         role,
      display_name: display_name?.trim() || email.split('@')[0],
    });
    const user = queries.getUserById.get(result.lastInsertRowid);
    res.status(201).json({ token: makeToken(user), user });
  } catch (e) {
    res.status(500).json({ error: 'Errore durante la registrazione' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e password obbligatorie' });

  const user = queries.getUserByEmail.get(email.trim());
  if (!user) return res.status(401).json({ error: 'Credenziali non valide' });

  const ok = bcrypt.compareSync(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Credenziali non valide' });

  queries.updateLastLogin.run(user.id);
  const safe = queries.getUserById.get(user.id);
  res.json({ token: makeToken(safe), user: safe });
});

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = queries.getUserById.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Utente non trovato' });
  res.json({ user });
});

// ── Profile routes ───────────────────────────────────────────────────────────

// GET /api/profile
app.get('/api/profile', requireAuth, (req, res) => {
  const uid = req.user.id;
  const role = req.user.role;
  let profile = null;

  if (role === 'atleta') {
    profile = queries.getAthleteProfile.get(uid);
  } else if (role === 'team') {
    profile = queries.getTeamProfile.get(uid);
  } else if (role === 'genitore' || role === 'parente') {
    profile = queries.getFamilyLinks.all(uid);
  }

  res.json({ profile });
});

// POST /api/profile/link-athlete  — collega atleta esistente
app.post('/api/profile/link-athlete', requireAuth, (req, res) => {
  if (req.user.role !== 'atleta') return res.status(403).json({ error: 'Solo per atleti' });
  const { atleta_id, fci_code, first_name, last_name, team, birth_year } = req.body;

  const existing = queries.getAthleteProfile.get(req.user.id);
  if (existing) return res.status(409).json({ error: 'Profilo già presente' });

  try {
    queries.createAthleteProfile.run({
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

// POST /api/profile/link-team
app.post('/api/profile/link-team', requireAuth, (req, res) => {
  if (req.user.role !== 'team') return res.status(403).json({ error: 'Solo per team' });
  const { team_id, team_name } = req.body;

  const existing = queries.getTeamProfile.get(req.user.id);
  if (existing) return res.status(409).json({ error: 'Profilo già presente' });

  try {
    queries.createTeamProfile.run({
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

// POST /api/profile/link-family
app.post('/api/profile/link-family', requireAuth, (req, res) => {
  if (!['genitore', 'parente'].includes(req.user.role))
    return res.status(403).json({ error: 'Solo per genitore/parente' });
  const { linked_atleta_id } = req.body;
  if (!linked_atleta_id) return res.status(400).json({ error: 'atleta_id obbligatorio' });

  try {
    queries.createFamilyLink.run({
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

// ── Admin routes ─────────────────────────────────────────────────────────────

// GET /api/admin/users
app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json({ users: queries.getAllUsers.all() });
});

// GET /api/admin/pending
app.get('/api/admin/pending', requireAdmin, (req, res) => {
  res.json({ pending: queries.getPendingProfiles.all() });
});

// POST /api/admin/approve  { type, id }
app.post('/api/admin/approve', requireAdmin, (req, res) => {
  const { type, id } = req.body;
  if (type === 'athlete') queries.approveAthleteProfile.run(id);
  else if (type === 'team') queries.approveTeamProfile.run(id);
  else if (type === 'family') queries.approveFamilyLink.run(id);
  else return res.status(400).json({ error: 'Tipo non valido' });
  res.json({ ok: true });
});

// POST /api/admin/reject  { type, id }
app.post('/api/admin/reject', requireAdmin, (req, res) => {
  const { type, id } = req.body;
  if (type === 'athlete') queries.rejectAthleteProfile.run(id);
  else if (type === 'team') queries.rejectTeamProfile.run(id);
  else if (type === 'family') queries.rejectFamilyLink.run(id);
  else return res.status(400).json({ error: 'Tipo non valido' });
  res.json({ ok: true });
});

// GET /api/admin/overrides
app.get('/api/admin/overrides', requireAdmin, (req, res) => {
  res.json({
    gare: queries.getAllGaraOverrides.all(),
    risultati: queries.getAllRisultatoOverrides.all(),
  });
});

// POST /api/admin/override/gara
app.post('/api/admin/override/gara', requireAdmin, (req, res) => {
  const { gara_id, field, old_value, new_value } = req.body;
  if (!gara_id || !field) return res.status(400).json({ error: 'Campi mancanti' });
  queries.setGaraOverride.run({ gara_id, field, old_value: old_value ?? null, new_value, edited_by: req.user.id });
  res.json({ ok: true });
});

// POST /api/admin/override/risultato
app.post('/api/admin/override/risultato', requireAdmin, (req, res) => {
  const { risultato_key, field, old_value, new_value } = req.body;
  if (!risultato_key || !field) return res.status(400).json({ error: 'Campi mancanti' });
  queries.setRisultatoOverride.run({ risultato_key, field, old_value: old_value ?? null, new_value, edited_by: req.user.id });
  res.json({ ok: true });
});

// GET /api/admin/gara-overrides/:gara_id
app.get('/api/admin/gara-overrides/:gara_id', requireAdmin, (req, res) => {
  res.json({ overrides: queries.getGaraOverrides.all(req.params.gara_id) });
});

// POST /api/admin/override/entity  { entity_type, entity_id, field, new_value }
app.post('/api/admin/override/entity', requireAdmin, (req, res) => {
  const { entity_type, entity_id, field, new_value } = req.body;
  if (!entity_type || !entity_id || !field) return res.status(400).json({ error: 'Campi mancanti' });
  queries.setEntityOverride.run({ entity_type, entity_id, field, new_value, edited_by: req.user.id });
  res.json({ ok: true });
});

// GET /api/admin/override/entity/:type/:id
app.get('/api/admin/override/entity/:type/:id', (req, res) => {
  const overrides = queries.getEntityOverrides.all(req.params.type, req.params.id);
  const map = {};
  overrides.forEach(o => { map[o.field] = o.new_value; });
  res.json({ overrides: map });
});

// GET /api/admin/all-entity-overrides
app.get('/api/admin/all-entity-overrides', requireAdmin, (req, res) => {
  res.json({ overrides: queries.getAllEntityOverrides.all() });
});

// ── Photo upload ─────────────────────────────────────────────────────────────

app.post('/api/upload/photo', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    const { entity_type, entity_id } = req.body;
    if (!entity_type || !entity_id) return res.status(400).json({ error: 'Dati mancanti' });
    if (!req.file) return res.status(400).json({ error: 'Nessun file ricevuto' });

    const user = req.user;

    // Ownership check (admin bypasses)
    if (user.role !== 'admin') {
      if (entity_type === 'atleta' && user.role === 'atleta') {
        const profile = queries.getAthleteProfile.get(user.id);
        if (!profile || profile.atleta_id !== entity_id || profile.status !== 'active')
          return res.status(403).json({ error: 'Profilo atleta non collegato o non verificato' });
      } else if (entity_type === 'team' && user.role === 'team') {
        const profile = queries.getTeamProfile.get(user.id);
        if (!profile || profile.team_id !== entity_id || profile.status !== 'active')
          return res.status(403).json({ error: 'Profilo team non collegato o non verificato' });
      } else {
        return res.status(403).json({ error: 'Non autorizzato' });
      }
    }

    const filename  = await savePhoto(req, req.file);
    const photo_url = `/photos/${filename}`;
    queries.setEntityOverride.run({
      entity_type, entity_id, field: 'photo_url', new_value: photo_url, edited_by: user.id,
    });
    res.json({ ok: true, photo_url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Race Photos ──────────────────────────────────────────────────────────────

// POST /api/race-photos/upload  — qualsiasi utente loggato
app.post('/api/race-photos/upload', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    const { gara_id, caption, photographer } = req.body;
    if (!gara_id) return res.status(400).json({ error: 'gara_id mancante' });
    if (!req.file) return res.status(400).json({ error: 'Nessun file ricevuto' });
    const filename     = await savePhoto(req, req.file);
    const display_name = req.user.display_name || req.user.email;
    const status       = req.user.role === 'admin' ? 'approved' : 'pending';
    queries.insertRacePhoto.run({
      gara_id, user_id: req.user.id, display_name,
      filename,
      caption: caption || '',
      photographer: photographer || '',
      status,
    });
    res.json({ ok: true, status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/race-photos  — tutte le approvate (per Risultati page)
app.get('/api/race-photos', (req, res) => {
  res.json({ photos: queries.getAllApprovedRacePhotos.all() });
});

// GET /api/race-photos/:gara_id  — pubblico, solo approvate
app.get('/api/race-photos/:gara_id', (req, res) => {
  const photos = queries.getApprovedRacePhotos.all(req.params.gara_id);
  res.json({ photos });
});

// GET /api/admin/race-photos/pending
app.get('/api/admin/race-photos/pending', requireAdmin, (req, res) => {
  res.json({ photos: queries.getPendingRacePhotos.all() });
});

// POST /api/admin/race-photos/:id/approve
app.post('/api/admin/race-photos/:id/approve', requireAdmin, (req, res) => {
  queries.approveRacePhoto.run(req.params.id);
  res.json({ ok: true });
});

// POST /api/admin/race-photos/:id/reject
app.post('/api/admin/race-photos/:id/reject', requireAdmin, (req, res) => {
  queries.rejectRacePhoto.run(req.params.id);
  res.json({ ok: true });
});

// PATCH /api/admin/race-photos/:id  { caption, photographer }
app.patch('/api/admin/race-photos/:id', requireAdmin, (req, res) => {
  const { caption, photographer } = req.body;
  queries.updateRacePhoto.run({ id: req.params.id, caption: caption || '', photographer: photographer || '' });
  res.json({ ok: true });
});

// DELETE /api/admin/race-photos/:id
app.delete('/api/admin/race-photos/:id', requireAdmin, async (req, res) => {
  const photo = queries.getRacePhotoById.get(req.params.id);
  if (!photo) return res.status(404).json({ error: 'Foto non trovata' });
  queries.deleteRacePhoto.run(req.params.id);
  await deletePhoto(photo.filename);
  res.json({ ok: true });
});

// ── Health ───────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Global JSON error handler — catches multer errors, unhandled exceptions
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Errore interno del server' });
});

app.listen(PORT, () => {
  console.log(`[server] ItaliacritAuth in ascolto su http://localhost:${PORT}`);
});
