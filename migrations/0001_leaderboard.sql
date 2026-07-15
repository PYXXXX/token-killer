PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS run_sessions (
  id TEXT PRIMARY KEY,
  profile_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  target_mode TEXT NOT NULL CHECK (target_mode IN ('tokens', 'money')),
  target_value REAL NOT NULL CHECK (target_value > 0),
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  submitted_at INTEGER,
  ip_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_sessions_profile_issued
  ON run_sessions(profile_hash, issued_at);

CREATE INDEX IF NOT EXISTS idx_run_sessions_ip_issued
  ON run_sessions(ip_hash, issued_at);

CREATE TABLE IF NOT EXISTS leaderboard_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES run_sessions(id),
  profile_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  date_utc TEXT NOT NULL,
  tokens INTEGER NOT NULL CHECK (tokens > 0),
  cost_micros INTEGER NOT NULL CHECK (cost_micros >= 0),
  rounds INTEGER NOT NULL CHECK (rounds > 0),
  verified_rounds INTEGER NOT NULL CHECK (verified_rounds = rounds),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 250),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  verification_level TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_runs_date_tokens
  ON leaderboard_runs(date_utc, tokens DESC);

CREATE INDEX IF NOT EXISTS idx_leaderboard_runs_profile
  ON leaderboard_runs(profile_hash, created_at DESC);
