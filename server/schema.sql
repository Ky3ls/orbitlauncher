-- OrbitLauncher cloud: Orbit accounts and synced launcher data
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pw TEXT NOT NULL,          -- PBKDF2(client hash, salt)
  salt TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  tok TEXT PRIMARY KEY,      -- SHA-256 of the session token
  uid INTEGER NOT NULL,
  device TEXT,
  created INTEGER NOT NULL,
  last INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_uid ON sessions(uid);
CREATE TABLE IF NOT EXISTS items (
  uid INTEGER NOT NULL,
  k TEXT NOT NULL,
  v TEXT NOT NULL,
  updated INTEGER NOT NULL,  -- client timestamp (ms) of the change, last write wins
  size INTEGER NOT NULL,
  PRIMARY KEY (uid, k)
);
CREATE TABLE IF NOT EXISTS attempts (
  key TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  t INTEGER NOT NULL
);
