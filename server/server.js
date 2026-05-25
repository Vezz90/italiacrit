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
const VIDEOS_PATH = path.join(__dirname, '../data/videos.json');

function readVideos() {
  try { return JSON.parse(fs.readFileSync(VIDEOS_PATH, 'utf8')); } catch { return {}; }
}
function writeVideos(data) {
  fs.writeFileSync(VIDEOS_PATH, JSON.stringify(data, null, 2));
}

// Endpoint PUBBLICO — usato dal frontend in produzione invece del file statico
// Serve sempre la versione live di videos.json (aggiornata dall'admin)
app.get('/api/videos', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300'); // cache 5 min nei browser
  res.json(readVideos());
});

// Lista tutti i video approvati (senza cache — legge sempre dal disco)
app.get('/api/admin/videos', requireAdmin, (req, res) => {
  res.json(readVideos());
});

// Aggiungi video manualmente a una gara (admin diretto, senza pending)
app.post('/api/admin/videos/:calId', requireAdmin, (req, res) => {
  try {
    const { calId } = req.params;
    const { url, title, channel, description } = req.body;
    if (!url) return res.status(400).json({ error: 'url obbligatorio' });
    const videos = readVideos();
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
    writeVideos(videos);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Sposta un video da una gara a un'altra
app.post('/api/admin/videos/:calId/:idx/move', requireAdmin, (req, res) => {
  try {
    const { calId, idx } = req.params;
    const { newCalId } = req.body;
    if (!newCalId) return res.status(400).json({ error: 'newCalId obbligatorio' });
    const videos = readVideos();
    if (!videos[calId]?.[parseInt(idx)]) return res.status(404).json({ error: 'Video non trovato' });
    const v = videos[calId].splice(parseInt(idx), 1)[0];
    if (!videos[calId].length) delete videos[calId];
    if (!videos[newCalId]) videos[newCalId] = [];
    videos[newCalId].unshift(v);
    writeVideos(videos);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/videos/:calId/:idx', requireAdmin, (req, res) => {
  try {
    const { calId, idx } = req.params;
    const videos = readVideos();
    if (!videos[calId]) return res.status(404).json({ error: 'Gara non trovata' });
    videos[calId].splice(parseInt(idx), 1);
    if (!videos[calId].length) delete videos[calId];
    writeVideos(videos);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/videos/:calId/:idx', requireAdmin, (req, res) => {
  try {
    const { calId, idx } = req.params;
    const { url, title } = req.body;
    const videos = readVideos();
    if (!videos[calId]?.[parseInt(idx)]) return res.status(404).json({ error: 'Video non trovato' });
    const v = videos[calId][parseInt(idx)];
    if (url) v.url = url;
    if (title !== undefined) v.title = title;
    writeVideos(videos);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
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
