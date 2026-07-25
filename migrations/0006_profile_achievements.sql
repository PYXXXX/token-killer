CREATE TABLE IF NOT EXISTS profile_achievements (
  profile_hash TEXT NOT NULL REFERENCES leaderboard_profiles(profile_hash),
  achievement_id TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (profile_hash, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_achievements_profile_unlocked
  ON profile_achievements(profile_hash, unlocked_at DESC);
