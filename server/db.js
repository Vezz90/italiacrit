const { Pool } = require('pg');
const bcrypt    = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function one(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows[0] || null;
}

async function all(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function run(sql, params = []) {
  return pool.query(sql, params);
}

// ── Schema ───────────────────────────────────────────────────────────────────

async function createSchema() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id           SERIAL PRIMARY KEY,
      email        TEXT NOT NULL UNIQUE,
      password     TEXT NOT NULL,
      role         TEXT NOT NULL DEFAULT 'appassionato',
      display_name TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login   TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS entity_overrides (
      id          SERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id   TEXT NOT NULL,
      field       TEXT NOT NULL,
      new_value   TEXT,
      edited_by   INTEGER REFERENCES users(id),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(entity_type, entity_id, field)
    );

    CREATE TABLE IF NOT EXISTS athlete_profiles (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      atleta_id  TEXT,
      fci_code   TEXT,
      first_name TEXT,
      last_name  TEXT,
      team       TEXT,
      birth_year INTEGER,
      status     TEXT NOT NULL DEFAULT 'pending',
      notes      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS team_profiles (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id    TEXT,
      team_name  TEXT,
      status     TEXT NOT NULL DEFAULT 'pending',
      notes      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS family_links (
      id               SERIAL PRIMARY KEY,
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      linked_atleta_id TEXT NOT NULL,
      relation         TEXT NOT NULL DEFAULT 'parente',
      status           TEXT NOT NULL DEFAULT 'pending',
      notes            TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS gara_overrides (
      id         SERIAL PRIMARY KEY,
      gara_id    TEXT NOT NULL,
      field      TEXT NOT NULL,
      old_value  TEXT,
      new_value  TEXT,
      edited_by  INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(gara_id, field)
    );

    CREATE TABLE IF NOT EXISTS risultato_overrides (
      id            SERIAL PRIMARY KEY,
      risultato_key TEXT NOT NULL,
      field         TEXT NOT NULL,
      old_value     TEXT,
      new_value     TEXT,
      edited_by     INTEGER REFERENCES users(id),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(risultato_key, field)
    );

    CREATE TABLE IF NOT EXISTS race_photos (
      id           SERIAL PRIMARY KEY,
      gara_id      TEXT NOT NULL,
      user_id      INTEGER NOT NULL REFERENCES users(id),
      display_name TEXT,
      filename     TEXT NOT NULL,
      caption      TEXT DEFAULT '',
      photographer TEXT DEFAULT '',
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── Media / Fotografi ──────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS media_profiles (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      bio          TEXT    DEFAULT '',
      website      TEXT    DEFAULT '',
      instagram    TEXT    DEFAULT '',
      cover_url    TEXT    DEFAULT '',
      status       TEXT    NOT NULL DEFAULT 'pending',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS media_albums (
      id               SERIAL PRIMARY KEY,
      media_profile_id INTEGER NOT NULL REFERENCES media_profiles(id) ON DELETE CASCADE,
      gara_id          TEXT,
      title            TEXT NOT NULL,
      description      TEXT DEFAULT '',
      cover_url        TEXT DEFAULT '',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS media_photos (
      id         SERIAL PRIMARY KEY,
      album_id   INTEGER NOT NULL REFERENCES media_albums(id) ON DELETE CASCADE,
      filename   TEXT,
      ext_url    TEXT,
      caption    TEXT DEFAULT '',
      ord        INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function seedAdmin() {
  const existing = await one(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  if (!existing) {
    const hash = bcrypt.hashSync('admin2026', 10);
    await run(
      `INSERT INTO users (email, password, role, display_name) VALUES ($1, $2, 'admin', 'Amministratore')`,
      ['admin@italiacrit.local', hash]
    );
    console.log('[db] Admin creato: admin@italiacrit.local / admin2026');
  }
}

async function init() {
  await createSchema();
  await seedAdmin();
  console.log('[db] PostgreSQL pronto');
}

// ── Query helpers ─────────────────────────────────────────────────────────────

const queries = {
  // Auth
  getUserByEmail:  (email) =>
    one(`SELECT * FROM users WHERE LOWER(email) = LOWER($1)`, [email]),

  getUserById: (id) =>
    one(`SELECT id, email, role, display_name, created_at, last_login FROM users WHERE id = $1`, [id]),

  createUser: ({ email, password, role, display_name }) =>
    one(
      `INSERT INTO users (email, password, role, display_name)
       VALUES ($1, $2, $3, $4) RETURNING id, email, role, display_name, created_at`,
      [email, password, role, display_name]
    ),

  updateLastLogin: (id) =>
    run(`UPDATE users SET last_login = NOW() WHERE id = $1`, [id]),

  // Athlete profiles
  getAthleteProfile: (user_id) =>
    one(`SELECT * FROM athlete_profiles WHERE user_id = $1`, [user_id]),

  createAthleteProfile: ({ user_id, atleta_id, fci_code, first_name, last_name, team, birth_year, status }) =>
    run(
      `INSERT INTO athlete_profiles (user_id, atleta_id, fci_code, first_name, last_name, team, birth_year, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [user_id, atleta_id, fci_code, first_name, last_name, team, birth_year, status]
    ),

  approveAthleteProfile: (id) =>
    run(`UPDATE athlete_profiles SET status = 'active' WHERE id = $1`, [id]),

  rejectAthleteProfile: (id) =>
    run(`UPDATE athlete_profiles SET status = 'rejected' WHERE id = $1`, [id]),

  // Team profiles
  getTeamProfile: (user_id) =>
    one(`SELECT * FROM team_profiles WHERE user_id = $1`, [user_id]),

  createTeamProfile: ({ user_id, team_id, team_name, status }) =>
    run(
      `INSERT INTO team_profiles (user_id, team_id, team_name, status) VALUES ($1, $2, $3, $4)`,
      [user_id, team_id, team_name, status]
    ),

  approveTeamProfile: (id) =>
    run(`UPDATE team_profiles SET status = 'active' WHERE id = $1`, [id]),

  rejectTeamProfile: (id) =>
    run(`UPDATE team_profiles SET status = 'rejected' WHERE id = $1`, [id]),

  // Family links
  createFamilyLink: ({ user_id, linked_atleta_id, relation, status }) =>
    run(
      `INSERT INTO family_links (user_id, linked_atleta_id, relation, status) VALUES ($1, $2, $3, $4)`,
      [user_id, linked_atleta_id, relation, status]
    ),

  getFamilyLinks: (user_id) =>
    all(`SELECT * FROM family_links WHERE user_id = $1`, [user_id]),

  approveFamilyLink: (id) =>
    run(`UPDATE family_links SET status = 'active' WHERE id = $1`, [id]),

  rejectFamilyLink: (id) =>
    run(`UPDATE family_links SET status = 'rejected' WHERE id = $1`, [id]),

  // Admin
  getAllUsers: () =>
    all(`SELECT id, email, role, display_name, created_at, last_login FROM users ORDER BY created_at DESC`),

  getPendingProfiles: () =>
    all(`
      SELECT * FROM (
        SELECT 'athlete' as type, ap.id, ap.user_id, ap.atleta_id,
               (ap.first_name || ' ' || ap.last_name) as name,
               ap.fci_code, ap.status, ap.created_at, u.email
        FROM athlete_profiles ap JOIN users u ON u.id = ap.user_id
        WHERE ap.status = 'pending'
        UNION ALL
        SELECT 'team' as type, tp.id, tp.user_id, tp.team_id, tp.team_name as name,
               NULL as fci_code, tp.status, tp.created_at, u.email
        FROM team_profiles tp JOIN users u ON u.id = tp.user_id
        WHERE tp.status = 'pending'
        UNION ALL
        SELECT 'family' as type, fl.id, fl.user_id, fl.linked_atleta_id as atleta_id,
               fl.relation as name, NULL as fci_code, fl.status, fl.created_at, u.email
        FROM family_links fl JOIN users u ON u.id = fl.user_id
        WHERE fl.status = 'pending'
        UNION ALL
        SELECT 'media' as type, mp.id, mp.user_id, NULL as atleta_id,
               mp.display_name as name, NULL as fci_code, mp.status, mp.created_at, u.email
        FROM media_profiles mp JOIN users u ON u.id = mp.user_id
        WHERE mp.status = 'pending'
      ) sub ORDER BY created_at DESC
    `),

  // Entity overrides
  setEntityOverride: ({ entity_type, entity_id, field, new_value, edited_by }) =>
    run(
      `INSERT INTO entity_overrides (entity_type, entity_id, field, new_value, edited_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (entity_type, entity_id, field) DO UPDATE
         SET new_value = $4, edited_by = $5, created_at = NOW()`,
      [entity_type, entity_id, field, new_value, edited_by]
    ),

  getEntityOverrides: (entity_type, entity_id) =>
    all(`SELECT field, new_value FROM entity_overrides WHERE entity_type = $1 AND entity_id = $2`,
        [entity_type, entity_id]),

  getAllEntityOverrides: () =>
    all(`SELECT * FROM entity_overrides ORDER BY created_at DESC`),

  // Gara overrides
  setGaraOverride: ({ gara_id, field, old_value, new_value, edited_by }) =>
    run(
      `INSERT INTO gara_overrides (gara_id, field, old_value, new_value, edited_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (gara_id, field) DO UPDATE
         SET new_value = $4, edited_by = $5, created_at = NOW()`,
      [gara_id, field, old_value, new_value, edited_by]
    ),

  getGaraOverrides: (gara_id) =>
    all(`SELECT * FROM gara_overrides WHERE gara_id = $1`, [gara_id]),

  getAllGaraOverrides: () =>
    all(`SELECT * FROM gara_overrides ORDER BY created_at DESC`),

  // Risultato overrides
  setRisultatoOverride: ({ risultato_key, field, old_value, new_value, edited_by }) =>
    run(
      `INSERT INTO risultato_overrides (risultato_key, field, old_value, new_value, edited_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (risultato_key, field) DO UPDATE
         SET new_value = $4, edited_by = $5, created_at = NOW()`,
      [risultato_key, field, old_value, new_value, edited_by]
    ),

  getAllRisultatoOverrides: () =>
    all(`SELECT * FROM risultato_overrides ORDER BY created_at DESC`),

  // Race photos
  insertRacePhoto: ({ gara_id, user_id, display_name, filename, caption, photographer, status }) =>
    run(
      `INSERT INTO race_photos (gara_id, user_id, display_name, filename, caption, photographer, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [gara_id, user_id, display_name, filename, caption, photographer, status]
    ),

  getApprovedRacePhotos: (gara_id) =>
    all(`SELECT * FROM race_photos WHERE gara_id = $1 AND status = 'approved' ORDER BY created_at DESC`,
        [gara_id]),

  getAllApprovedRacePhotos: () =>
    all(`SELECT * FROM race_photos WHERE status = 'approved' ORDER BY created_at DESC`),

  getPendingRacePhotos: () =>
    all(`SELECT rp.*, u.email FROM race_photos rp
         JOIN users u ON rp.user_id = u.id
         WHERE rp.status = 'pending' ORDER BY rp.created_at DESC`),

  approveRacePhoto: (id) =>
    run(`UPDATE race_photos SET status = 'approved' WHERE id = $1`, [id]),

  rejectRacePhoto: (id) =>
    run(`UPDATE race_photos SET status = 'rejected' WHERE id = $1`, [id]),

  getRacePhotoById: (id) =>
    one(`SELECT * FROM race_photos WHERE id = $1`, [id]),

  updateRacePhoto: ({ id, caption, photographer }) =>
    run(`UPDATE race_photos SET caption = $1, photographer = $2 WHERE id = $3`,
        [caption, photographer, id]),

  deleteRacePhoto: (id) =>
    run(`DELETE FROM race_photos WHERE id = $1`, [id]),

  // ── Media profiles ────────────────────────────────────────────────────────────

  createMediaProfile: ({ user_id, display_name, bio, website, instagram }) =>
    one(
      `INSERT INTO media_profiles (user_id, display_name, bio, website, instagram)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [user_id, display_name, bio || '', website || '', instagram || '']
    ),

  getMediaProfileByUser: (user_id) =>
    one(`SELECT * FROM media_profiles WHERE user_id = $1`, [user_id]),

  getMediaProfileById: (id) =>
    one(`SELECT * FROM media_profiles WHERE id = $1`, [id]),

  getApprovedMediaProfiles: () =>
    all(`SELECT id, display_name, bio, website, instagram, cover_url, created_at
         FROM media_profiles WHERE status = 'active' ORDER BY display_name`),

  approveMediaProfile: (id) =>
    run(`UPDATE media_profiles SET status = 'active' WHERE id = $1`, [id]),

  rejectMediaProfile: (id) =>
    run(`UPDATE media_profiles SET status = 'rejected' WHERE id = $1`, [id]),

  updateMediaProfile: ({ id, display_name, bio, website, instagram }) =>
    run(`UPDATE media_profiles SET display_name=$2, bio=$3, website=$4, instagram=$5 WHERE id=$1`,
        [id, display_name, bio || '', website || '', instagram || '']),

  // ── Media albums ──────────────────────────────────────────────────────────────

  createMediaAlbum: ({ media_profile_id, gara_id, title, description }) =>
    one(
      `INSERT INTO media_albums (media_profile_id, gara_id, title, description)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [media_profile_id, gara_id || null, title, description || '']
    ),

  getMediaAlbumsByProfile: (media_profile_id) =>
    all(`
      SELECT ma.*,
             COUNT(mp.id)::int AS photo_count,
             (SELECT mp2.filename FROM media_photos mp2 WHERE mp2.album_id = ma.id ORDER BY mp2.ord, mp2.id LIMIT 1) AS first_filename,
             (SELECT mp2.ext_url  FROM media_photos mp2 WHERE mp2.album_id = ma.id ORDER BY mp2.ord, mp2.id LIMIT 1) AS first_ext_url
      FROM media_albums ma
      LEFT JOIN media_photos mp ON mp.album_id = ma.id
      WHERE ma.media_profile_id = $1
      GROUP BY ma.id ORDER BY ma.created_at DESC`,
      [media_profile_id]
    ),

  getMediaAlbumsByGara: (gara_id) =>
    all(`
      SELECT ma.*,
             pr.display_name AS photographer_name, pr.id AS profile_id,
             COUNT(mp.id)::int AS photo_count,
             (SELECT mp2.filename FROM media_photos mp2 WHERE mp2.album_id = ma.id ORDER BY mp2.ord, mp2.id LIMIT 1) AS first_filename,
             (SELECT mp2.ext_url  FROM media_photos mp2 WHERE mp2.album_id = ma.id ORDER BY mp2.ord, mp2.id LIMIT 1) AS first_ext_url
      FROM media_albums ma
      JOIN media_profiles pr ON pr.id = ma.media_profile_id
      LEFT JOIN media_photos mp ON mp.album_id = ma.id
      WHERE ma.gara_id = $1 AND pr.status = 'active'
      GROUP BY ma.id, pr.display_name, pr.id ORDER BY ma.created_at DESC`,
      [gara_id]
    ),

  getMediaAlbum: (id) =>
    one(`
      SELECT ma.*, pr.display_name AS photographer_name, pr.instagram, pr.website, pr.id AS profile_id, pr.status AS profile_status
      FROM media_albums ma
      JOIN media_profiles pr ON pr.id = ma.media_profile_id
      WHERE ma.id = $1`, [id]),

  updateMediaAlbum: ({ id, title, gara_id, description }) =>
    run(`UPDATE media_albums SET title=$2, gara_id=$3, description=$4 WHERE id=$1`,
        [id, title, gara_id || null, description || '']),

  deleteMediaAlbum: (id) =>
    run(`DELETE FROM media_albums WHERE id = $1`, [id]),

  // ── Media photos ──────────────────────────────────────────────────────────────

  addMediaPhoto: ({ album_id, filename, ext_url, caption, ord }) =>
    one(
      `INSERT INTO media_photos (album_id, filename, ext_url, caption, ord)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [album_id, filename || null, ext_url || null, caption || '', ord || 0]
    ),

  getMediaPhotosByAlbum: (album_id) =>
    all(`SELECT * FROM media_photos WHERE album_id = $1 ORDER BY ord, id`, [album_id]),

  getMediaPhotoById: (id) =>
    one(`SELECT * FROM media_photos WHERE id = $1`, [id]),

  deleteMediaPhoto: (id) =>
    one(`DELETE FROM media_photos WHERE id = $1 RETURNING filename, ext_url`, [id]),

  countMediaPhotosByProfile: (media_profile_id) =>
    one(`SELECT COUNT(mp.id)::int AS total FROM media_photos mp
         JOIN media_albums ma ON ma.id = mp.album_id
         WHERE ma.media_profile_id = $1`, [media_profile_id]),
};

module.exports = { queries, init, rawQuery: (sql, params) => pool.query(sql, params) };
