CREATE TABLE IF NOT EXISTS leaderboard_profiles (
  profile_hash TEXT PRIMARY KEY,
  participant_number INTEGER NOT NULL UNIQUE
    CHECK (participant_number BETWEEN 100000 AND 999999),
  created_at INTEGER NOT NULL
);

WITH profile_rows AS (
  SELECT profile_hash, nickname, issued_at AS created_at FROM run_sessions
  UNION ALL
  SELECT profile_hash, nickname, created_at FROM leaderboard_runs
),
valid_candidates AS (
  SELECT
    profile_hash,
    CAST(substr(nickname, 6) AS INTEGER) AS participant_number,
    MIN(created_at) AS created_at
  FROM profile_rows
  WHERE nickname GLOB '燃烧者 #[1-9][0-9][0-9][0-9][0-9][0-9]'
  GROUP BY profile_hash, nickname
),
profile_choices AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY profile_hash
      ORDER BY created_at ASC, participant_number ASC
    ) AS profile_choice
  FROM valid_candidates
),
number_choices AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY participant_number
      ORDER BY created_at ASC, profile_hash ASC
    ) AS number_choice
  FROM profile_choices
  WHERE profile_choice = 1
)
INSERT OR IGNORE INTO leaderboard_profiles (profile_hash, participant_number, created_at)
SELECT
  profile_hash,
  participant_number,
  created_at
FROM number_choices
WHERE number_choice = 1;
