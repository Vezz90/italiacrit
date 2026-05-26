const express        = require('express');
const cors           = require('cors');
const bcrypt         = require('bcryptjs');
const jwt            = require('jsonwebtoken');
const multer         = require('multer');
const path           = require('path');
const fs             = require('fs');
const { queries, init } = require('./db');

const app  = express();
const PORT = 8002;
const JWT_SECRET  = process.env.JWT_SECRET || 'italiacrit-dev-secret-2026';
const JWT_EXPIRES = '30d';

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

// ── Auth routes ───────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, role, display_name } = req.body;
    const ALLOWED_ROLES = ['atleta', 'team', 'genitore', 'parente', 'appassionato'];
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
    res.json({ user });
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
app.post('/api/admin/youtube/sync', requireAdmin, async (req, res) => {
  try {
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
          status:       'pending',   // pending | approved | dismissed
          suggested_gara_id: null,
          added_at:     new Date().toISOString(),
        });
        added++;
      }
    }

    // Conserva TUTTI gli approvati/scartati (servono per la deduplicazione degli URL)
    // Limita solo i pending a max 200 (i più recenti)
    const nonPending = queue.filter(q => q.status !== 'pending');
    const pending    = queue
      .filter(q => q.status === 'pending')
      .sort((a, b) => (b.added_at || '').localeCompare(a.added_at || ''))
      .slice(0, 200);
    const trimmed = [...nonPending, ...pending];
    await writeYTQueue(trimmed);

    res.json({ ok: true, added, total: trimmed.length });
  } catch (e) {
    console.error('[yt-sync] errore:', e.message);
    res.status(500).json({ error: e.message });
  }
});

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
const { fetchXpixCandidates, fetchPhotosForAlbum } = require('./xpix-scraper');

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
    const knownSlugs = new Set(queue.map(q => q.album_slug));

    const candidates = await fetchXpixCandidates(knownSlugs, 30);
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

    // Usa la foto selezionata dall'admin (o la prima di default)
    const chosenUrl = selected_photo_url || item.photo_url;
    photos[gara_id] = {
      url:        chosenUrl,
      album_name: item.album_name,
      album_slug: item.album_slug,
      album_page: item.album_page,
      gara_id,
      approved_at: new Date().toISOString(),
    };
    await writeXpixPhotos(photos);

    queue[i].status           = 'approved';
    queue[i].approved_gara_id = gara_id;
    await writeXpixQueue(queue);

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
const { fetchItaliaciclismoCandidates } = require('./italiaciclismo-scraper');

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

app.post('/api/admin/ic/sync', requireAdmin, async (req, res) => {
  try {
    const queue     = await readICQueue();
    const knownUrls = new Set(queue.map(q => q.gara_url));
    const candidates = await fetchItaliaciclismoCandidates(knownUrls, 20);
    let added = 0;
    for (const c of candidates) {
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
    const nonPending = queue.filter(q => q.status !== 'pending');
    const pending    = queue.filter(q => q.status === 'pending')
      .sort((a, b) => (b.added_at || '').localeCompare(a.added_at || ''))
      .slice(0, 200);
    const trimmed = [...nonPending, ...pending];
    await writeICQueue(trimmed);
    res.json({ ok: true, added, total: trimmed.length });
  } catch (e) {
    console.error('[ic-sync]', e.message);
    res.status(500).json({ error: e.message });
  }
});

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

// GET foto xpix approvate (endpoint pubblico usato dal frontend)
app.get('/api/xpix-photos', async (req, res) => {
  try {
    const photos = await readXpixPhotos();
    res.json({ photos: Object.values(photos) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Errore interno del server' });
});

// ── Startup ───────────────────────────────────────────────────────────────────

init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[server] ItaliacritAuth in ascolto su http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('[fatal] Impossibile connettersi al database:', err.message);
    process.exit(1);
  });
