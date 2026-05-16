const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'italiacrit.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password    TEXT    NOT NULL,
    role        TEXT    NOT NULL DEFAULT 'appassionato',
    -- role: admin | atleta | team | genitore | parente | appassionato
    display_name TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login  TEXT
  );

  CREATE TABLE IF NOT EXISTS entity_overrides (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT    NOT NULL,   -- 'gara' | 'atleta' | 'team' | 'risultato'
    entity_id   TEXT    NOT NULL,
    field       TEXT    NOT NULL,
    new_value   TEXT,
    edited_by   INTEGER REFERENCES users(id),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(entity_type, entity_id, field)
  );

  CREATE TABLE IF NOT EXISTS athlete_profiles (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    atleta_id     TEXT,           -- matches athletes.json atleta_id; NULL if pending
    fci_code      TEXT,
    first_name    TEXT,
    last_name     TEXT,
    team          TEXT,
    birth_year    INTEGER,
    status        TEXT NOT NULL DEFAULT 'pending',
    -- status: active | pending | rejected
    notes         TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS team_profiles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id     TEXT,             -- matches teams.json team_id; NULL if pending
    team_name   TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    notes       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS family_links (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    linked_atleta_id TEXT NOT NULL,
    relation        TEXT NOT NULL DEFAULT 'parente',
    -- relation: genitore | parente
    status          TEXT NOT NULL DEFAULT 'pending',
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gara_overrides (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    gara_id     TEXT NOT NULL,
    field       TEXT NOT NULL,
    old_value   TEXT,
    new_value   TEXT,
    edited_by   INTEGER REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(gara_id, field)
  );

  CREATE TABLE IF NOT EXISTS risultato_overrides (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    risultato_key TEXT NOT NULL,
    field         TEXT NOT NULL,
    old_value     TEXT,
    new_value     TEXT,
    edited_by     INTEGER REFERENCES users(id),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(risultato_key, field)
  );

  CREATE TABLE IF NOT EXISTS race_photos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    gara_id      TEXT    NOT NULL,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    display_name TEXT,
    filename     TEXT    NOT NULL,
    caption      TEXT    DEFAULT '',
    photographer TEXT    DEFAULT '',
    status       TEXT    NOT NULL DEFAULT 'pending',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migration: add photographer column if it doesn't exist yet
try { db.exec(`ALTER TABLE race_photos ADD COLUMN photographer TEXT DEFAULT ''`); } catch {}

// ── Seed admin user ──────────────────────────────────────────────────────────

const adminExists = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
if (!adminExists) {
  const hash = bcrypt.hashSync('admin2026', 10);
  db.prepare(`
    INSERT INTO users (email, password, role, display_name)
    VALUES ('admin@italiacrit.local', ?, 'admin', 'Amministratore')
  `).run(hash);
  console.log('[db] Admin creato: admin@italiacrit.local / admin2026');
}

// ── Query helpers ────────────────────────────────────────────────────────────

const queries = {
  getUserByEmail: db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE'),
  getUserById:    db.prepare('SELECT id, email, role, display_name, created_at, last_login FROM users WHERE id = ?'),
  createUser:     db.prepare(`
    INSERT INTO users (email, password, role, display_name)
    VALUES (@email, @password, @role, @display_name)
  `),
  updateLastLogin: db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?"),

  getAthleteProfile: db.prepare('SELECT * FROM athlete_profiles WHERE user_id = ?'),
  createAthleteProfile: db.prepare(`
    INSERT INTO athlete_profiles (user_id, atleta_id, fci_code, first_name, last_name, team, birth_year, status)
    VALUES (@user_id, @atleta_id, @fci_code, @first_name, @last_name, @team, @birth_year, @status)
  `),

  getTeamProfile: db.prepare('SELECT * FROM team_profiles WHERE user_id = ?'),
  createTeamProfile: db.prepare(`
    INSERT INTO team_profiles (user_id, team_id, team_name, status)
    VALUES (@user_id, @team_id, @team_name, @status)
  `),

  createFamilyLink: db.prepare(`
    INSERT INTO family_links (user_id, linked_atleta_id, relation, status)
    VALUES (@user_id, @linked_atleta_id, @relation, @status)
  `),
  getFamilyLinks: db.prepare('SELECT * FROM family_links WHERE user_id = ?'),

  // Admin queries
  getAllUsers: db.prepare('SELECT id, email, role, display_name, created_at, last_login FROM users ORDER BY created_at DESC'),
  getPendingProfiles: db.prepare(`
    SELECT * FROM (
      SELECT 'athlete' as type, ap.id, ap.user_id, ap.atleta_id, ap.first_name || ' ' || ap.last_name as name, ap.fci_code, ap.status, ap.created_at as created_at, u.email
      FROM athlete_profiles ap JOIN users u ON u.id = ap.user_id
      WHERE ap.status = 'pending'
      UNION ALL
      SELECT 'team' as type, tp.id, tp.user_id, tp.team_id, tp.team_name as name, NULL as fci_code, tp.status, tp.created_at as created_at, u.email
      FROM team_profiles tp JOIN users u ON u.id = tp.user_id
      WHERE tp.status = 'pending'
      UNION ALL
      SELECT 'family' as type, fl.id, fl.user_id, fl.linked_atleta_id as atleta_id, fl.relation as name, NULL as fci_code, fl.status, fl.created_at as created_at, u.email
      FROM family_links fl JOIN users u ON u.id = fl.user_id
      WHERE fl.status = 'pending'
    ) ORDER BY created_at DESC
  `),
  approveAthleteProfile: db.prepare("UPDATE athlete_profiles SET status = 'active' WHERE id = ?"),
  rejectAthleteProfile:  db.prepare("UPDATE athlete_profiles SET status = 'rejected' WHERE id = ?"),
  approveTeamProfile:    db.prepare("UPDATE team_profiles SET status = 'active' WHERE id = ?"),
  rejectTeamProfile:     db.prepare("UPDATE team_profiles SET status = 'rejected' WHERE id = ?"),
  approveFamilyLink:     db.prepare("UPDATE family_links SET status = 'active' WHERE id = ?"),
  rejectFamilyLink:      db.prepare("UPDATE family_links SET status = 'rejected' WHERE id = ?"),

  setEntityOverride: db.prepare(`
    INSERT INTO entity_overrides (entity_type, entity_id, field, new_value, edited_by)
    VALUES (@entity_type, @entity_id, @field, @new_value, @edited_by)
    ON CONFLICT(entity_type, entity_id, field) DO UPDATE SET new_value = @new_value, edited_by = @edited_by, created_at = datetime('now')
  `),
  getEntityOverrides: db.prepare('SELECT field, new_value FROM entity_overrides WHERE entity_type = ? AND entity_id = ?'),
  getAllEntityOverrides: db.prepare('SELECT * FROM entity_overrides ORDER BY created_at DESC'),

  insertRacePhoto: db.prepare(`
    INSERT INTO race_photos (gara_id, user_id, display_name, filename, caption, photographer, status)
    VALUES (@gara_id, @user_id, @display_name, @filename, @caption, @photographer, @status)
  `),
  getApprovedRacePhotos: db.prepare(
    `SELECT * FROM race_photos WHERE gara_id = ? AND status = 'approved' ORDER BY created_at DESC`
  ),
  getAllApprovedRacePhotos: db.prepare(
    `SELECT * FROM race_photos WHERE status = 'approved' ORDER BY created_at DESC`
  ),
  getPendingRacePhotos: db.prepare(`
    SELECT rp.*, u.email FROM race_photos rp
    JOIN users u ON rp.user_id = u.id
    WHERE rp.status = 'pending' ORDER BY rp.created_at DESC
  `),
  approveRacePhoto:  db.prepare(`UPDATE race_photos SET status = 'approved' WHERE id = ?`),
  rejectRacePhoto:   db.prepare(`UPDATE race_photos SET status = 'rejected'  WHERE id = ?`),
  getRacePhotoById:  db.prepare(`SELECT * FROM race_photos WHERE id = ?`),
  updateRacePhoto:   db.prepare(`UPDATE race_photos SET caption = @caption, photographer = @photographer WHERE id = @id`),
  deleteRacePhoto:   db.prepare(`DELETE FROM race_photos WHERE id = ?`),

  setGaraOverride: db.prepare(`
    INSERT INTO gara_overrides (gara_id, field, old_value, new_value, edited_by)
    VALUES (@gara_id, @field, @old_value, @new_value, @edited_by)
    ON CONFLICT(gara_id, field) DO UPDATE SET new_value = @new_value, edited_by = @edited_by, created_at = datetime('now')
  `),
  getGaraOverrides: db.prepare('SELECT * FROM gara_overrides WHERE gara_id = ?'),
  getAllGaraOverrides: db.prepare('SELECT * FROM gara_overrides ORDER BY created_at DESC'),

  setRisultatoOverride: db.prepare(`
    INSERT INTO risultato_overrides (risultato_key, field, old_value, new_value, edited_by)
    VALUES (@risultato_key, @field, @old_value, @new_value, @edited_by)
    ON CONFLICT(risultato_key, field) DO UPDATE SET new_value = @new_value, edited_by = @edited_by, created_at = datetime('now')
  `),
  getAllRisultatoOverrides: db.prepare('SELECT * FROM risultato_overrides ORDER BY created_at DESC'),
};

module.exports = { db, queries };
