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

async function migrate() {
  // Aggiunte colonne successive — idempotenti grazie a IF NOT EXISTS
  const migrations = [
    `ALTER TABLE media_profiles ADD COLUMN IF NOT EXISTS facebook TEXT DEFAULT ''`,
    `CREATE TABLE IF NOT EXISTS media_purchase_requests (
      id               SERIAL PRIMARY KEY,
      media_photo_id   INTEGER NOT NULL REFERENCES media_photos(id) ON DELETE CASCADE,
      requester_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message          TEXT DEFAULT '',
      status           TEXT NOT NULL DEFAULT 'pending',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS media_athlete_shares (
      id               SERIAL PRIMARY KEY,
      media_photo_id   INTEGER NOT NULL REFERENCES media_photos(id) ON DELETE CASCADE,
      athlete_profile_id INTEGER REFERENCES athlete_profiles(id) ON DELETE CASCADE,
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(media_photo_id, user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT NOT NULL DEFAULT 'info',
      title      TEXT NOT NULL,
      body       TEXT DEFAULT '',
      data       JSONB DEFAULT '{}',
      read       BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC)`,
    // ── Messaggistica diretta ─────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS conversations (
      id         SERIAL PRIMARY KEY,
      user_a     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_msg   TEXT DEFAULT '',
      last_at    TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT conv_order CHECK (user_a < user_b)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_unique ON conversations(user_a, user_b)`,
    `CREATE TABLE IF NOT EXISTS messages (
      id              SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body            TEXT NOT NULL,
      read            BOOLEAN NOT NULL DEFAULT FALSE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at)`,
    // ── Profilo personale dell'utente (tutti i ruoli) ─────────────────────────
    `CREATE TABLE IF NOT EXISTS user_details (
      user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      bio            TEXT DEFAULT '',
      location       TEXT DEFAULT '',
      instagram      TEXT DEFAULT '',
      facebook       TEXT DEFAULT '',
      strava         TEXT DEFAULT '',
      website        TEXT DEFAULT '',
      specialty      TEXT DEFAULT '',
      birth_year     TEXT DEFAULT '',
      favorite_team  TEXT DEFAULT '',
      staff_role     TEXT DEFAULT '',
      public_contact TEXT DEFAULT '',
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  ];
  for (const sql of migrations) {
    try { await run(sql); } catch (e) { console.warn('[migrate]', e.message); }
  }
}

async function init() {
  await createSchema();
  await migrate();
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

  updateUserRole: (id, role) =>
    one(
      `UPDATE users SET role = $2 WHERE id = $1
       RETURNING id, email, role, display_name, created_at, last_login`,
      [id, role]
    ),

  deleteUser: (id) =>
    run(`DELETE FROM users WHERE id = $1`, [id]),

  // Profilo personale (campi liberi dell'utente)
  getUserDetails: (user_id) =>
    one(`SELECT * FROM user_details WHERE user_id = $1`, [user_id]),

  upsertUserDetails: (d) =>
    one(
      `INSERT INTO user_details
         (user_id, bio, location, instagram, facebook, strava, website,
          specialty, birth_year, favorite_team, staff_role, public_contact, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         bio=$2, location=$3, instagram=$4, facebook=$5, strava=$6, website=$7,
         specialty=$8, birth_year=$9, favorite_team=$10, staff_role=$11,
         public_contact=$12, updated_at=NOW()
       RETURNING *`,
      [d.user_id, d.bio, d.location, d.instagram, d.facebook, d.strava, d.website,
       d.specialty, d.birth_year, d.favorite_team, d.staff_role, d.public_contact]
    ),

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

  createMediaProfile: ({ user_id, display_name, bio, website, instagram, facebook }) =>
    one(
      `INSERT INTO media_profiles (user_id, display_name, bio, website, instagram, facebook)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [user_id, display_name, bio || '', website || '', instagram || '', facebook || '']
    ),

  getMediaProfileByUser: (user_id) =>
    one(`SELECT * FROM media_profiles WHERE user_id = $1`, [user_id]),

  getMediaProfileById: (id) =>
    one(`SELECT * FROM media_profiles WHERE id = $1`, [id]),

  getApprovedMediaProfiles: () =>
    all(`SELECT id, display_name, bio, website, instagram, facebook, cover_url, created_at
         FROM media_profiles WHERE status = 'active' ORDER BY display_name`),

  // Profili media scrapati e non ancora rivendicati da un utente
  getUnclaimedMediaProfiles: () =>
    all(`SELECT id, display_name, bio, website, instagram, facebook, cover_url, status
         FROM media_profiles WHERE user_id IS NULL ORDER BY display_name`),

  // Rivendica un profilo libero collegandolo a un utente (va approvato dall'admin)
  claimMediaProfile: (id, user_id) =>
    one(`UPDATE media_profiles SET user_id = $2, status = 'pending'
         WHERE id = $1 AND user_id IS NULL RETURNING *`, [id, user_id]),

  approveMediaProfile: (id) =>
    run(`UPDATE media_profiles SET status = 'active' WHERE id = $1`, [id]),

  rejectMediaProfile: (id) =>
    run(`UPDATE media_profiles SET status = 'rejected' WHERE id = $1`, [id]),

  updateMediaProfile: ({ id, display_name, bio, website, instagram, facebook }) =>
    run(`UPDATE media_profiles SET display_name=$2, bio=$3, website=$4, instagram=$5, facebook=$6 WHERE id=$1`,
        [id, display_name, bio || '', website || '', instagram || '', facebook || '']),

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

  // ── Purchase requests ─────────────────────────────────────────────────────────
  createPurchaseRequest: ({ media_photo_id, requester_id, message }) =>
    one(
      `INSERT INTO media_purchase_requests (media_photo_id, requester_id, message)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING RETURNING *`,
      [media_photo_id, requester_id, message || '']
    ),

  getPurchaseRequestsForPhotographer: (media_profile_id) =>
    all(`
      SELECT mpr.*, mp.filename, mp.ext_url, u.display_name AS requester_name, u.email AS requester_email,
             ma.title AS album_title, ma.gara_id
      FROM media_purchase_requests mpr
      JOIN media_photos mp ON mp.id = mpr.media_photo_id
      JOIN media_albums ma ON ma.id = mp.album_id
      JOIN users u ON u.id = mpr.requester_id
      WHERE ma.media_profile_id = $1
      ORDER BY mpr.created_at DESC`, [media_profile_id]),

  // ── Athlete shares ────────────────────────────────────────────────────────────
  createAthleteShare: ({ media_photo_id, athlete_profile_id, user_id }) =>
    run(
      `INSERT INTO media_athlete_shares (media_photo_id, athlete_profile_id, user_id)
       VALUES ($1, $2, $3) ON CONFLICT (media_photo_id, user_id) DO NOTHING`,
      [media_photo_id, athlete_profile_id || null, user_id]
    ),

  getAthleteSharedPhotos: (athlete_profile_id) =>
    all(`
      SELECT mp.*, mp2.display_name AS photographer_name, mp2.id AS profile_id,
             mas.created_at AS shared_at
      FROM media_athlete_shares mas
      JOIN media_photos mp ON mp.id = mas.media_photo_id
      JOIN media_albums ma ON ma.id = mp.album_id
      JOIN media_profiles mp2 ON mp2.id = ma.media_profile_id
      WHERE mas.athlete_profile_id = $1
      ORDER BY mas.created_at DESC
      LIMIT 30`, [athlete_profile_id]),

  // ── Notifications ─────────────────────────────────────────────────────────────
  createNotification: ({ user_id, type = 'info', title, body = '', data = {} }) =>
    one(
      `INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [user_id, type, title, body, JSON.stringify(data)]
    ),

  getNotificationsForUser: (user_id, limit = 50) =>
    all(`SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, [user_id, limit]),

  countUnreadNotifications: (user_id) =>
    one(`SELECT COUNT(*)::int AS count FROM notifications WHERE user_id=$1 AND read=false`, [user_id]),

  markNotificationRead: (id, user_id) =>
    run(`UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2`, [id, user_id]),

  markAllNotificationsRead: (user_id) =>
    run(`UPDATE notifications SET read=true WHERE user_id=$1`, [user_id]),

  deleteNotification: (id, user_id) =>
    run(`DELETE FROM notifications WHERE id=$1 AND user_id=$2`, [id, user_id]),

  // ── Messaging ─────────────────────────────────────────────────────────────────
  // Crea o recupera una conversazione tra due utenti (user_a sempre < user_b)
  getOrCreateConversation: async (uid1, uid2) => {
    const a = Math.min(uid1, uid2);
    const b = Math.max(uid1, uid2);
    const existing = await one(`SELECT * FROM conversations WHERE user_a=$1 AND user_b=$2`, [a, b]);
    if (existing) return existing;
    return one(`INSERT INTO conversations (user_a, user_b) VALUES ($1,$2) RETURNING *`, [a, b]);
  },

  getConversationById: (id) =>
    one(`SELECT * FROM conversations WHERE id=$1`, [id]),

  // Lista conversazioni di un utente, con info sull'altro utente e conteggio non letti
  getConversationsForUser: (user_id) =>
    all(`
      SELECT c.*,
             CASE WHEN c.user_a=$1 THEN c.user_b ELSE c.user_a END AS other_user_id,
             u.display_name  AS other_display_name,
             u.role          AS other_role,
             (SELECT COUNT(*)::int FROM messages m
              WHERE m.conversation_id=c.id AND m.sender_id != $1 AND m.read=false) AS unread_count
      FROM conversations c
      JOIN users u ON u.id = CASE WHEN c.user_a=$1 THEN c.user_b ELSE c.user_a END
      WHERE c.user_a=$1 OR c.user_b=$1
      ORDER BY c.last_at DESC NULLS LAST`, [user_id]),

  // Messaggi di una conversazione (ultimi 100)
  getMessages: (conversation_id, limit = 100) =>
    all(`
      SELECT m.*, u.display_name AS sender_name, u.role AS sender_role
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id=$1
      ORDER BY m.created_at ASC
      LIMIT $2`, [conversation_id, limit]),

  sendMessage: async (conversation_id, sender_id, body) => {
    const msg = await one(
      `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1,$2,$3) RETURNING *`,
      [conversation_id, sender_id, body]
    );
    await run(
      `UPDATE conversations SET last_msg=$1, last_at=NOW() WHERE id=$2`,
      [body.slice(0, 120), conversation_id]
    );
    return msg;
  },

  markConversationRead: (conversation_id, reader_id) =>
    run(`UPDATE messages SET read=true WHERE conversation_id=$1 AND sender_id != $2`, [conversation_id, reader_id]),

  countUnreadMessages: (user_id) =>
    one(`
      SELECT COUNT(*)::int AS count
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE (c.user_a=$1 OR c.user_b=$1)
        AND m.sender_id != $1
        AND m.read = false`, [user_id]),

  // Lookup utente da atleta_id o team profile id (per il bottone "Scrivi")
  getUserByAtletaId: (atleta_id) =>
    one(`SELECT u.id, u.display_name, u.role FROM users u JOIN athlete_profiles ap ON ap.user_id=u.id WHERE ap.atleta_id=$1 AND ap.status='active' LIMIT 1`, [atleta_id]),

  getUserByTeamProfileId: (team_profile_id) =>
    one(`SELECT u.id, u.display_name, u.role FROM users u JOIN team_profiles tp ON tp.user_id=u.id WHERE tp.id=$1 AND tp.status='active' LIMIT 1`, [team_profile_id]),
};

module.exports = { queries, init, rawQuery: (sql, params) => pool.query(sql, params) };
