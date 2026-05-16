const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { queries } = require('./db');

const app  = express();
const PORT = 8002;
const JWT_SECRET = process.env.JWT_SECRET || 'italiacrit-dev-secret-2026';
const JWT_EXPIRES = '30d';

app.use(cors({ origin: '*' }));
app.use(express.json());

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

// ── Health ───────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`[server] ItaliacritAuth in ascolto su http://localhost:${PORT}`);
});
