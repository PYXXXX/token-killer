ALTER TABLE run_sessions ADD COLUMN country_code TEXT;
ALTER TABLE run_sessions ADD COLUMN province_code TEXT;
ALTER TABLE run_sessions ADD COLUMN province_name TEXT;
ALTER TABLE run_sessions ADD COLUMN city_name TEXT;

ALTER TABLE leaderboard_runs ADD COLUMN country_code TEXT;
ALTER TABLE leaderboard_runs ADD COLUMN province_code TEXT;
ALTER TABLE leaderboard_runs ADD COLUMN province_name TEXT;
ALTER TABLE leaderboard_runs ADD COLUMN city_name TEXT;

CREATE INDEX IF NOT EXISTS idx_leaderboard_runs_country_tokens
  ON leaderboard_runs(country_code, tokens DESC);

CREATE INDEX IF NOT EXISTS idx_leaderboard_runs_province_tokens
  ON leaderboard_runs(country_code, province_code, tokens DESC);

CREATE INDEX IF NOT EXISTS idx_leaderboard_runs_city_tokens
  ON leaderboard_runs(country_code, province_code, city_name, tokens DESC);
