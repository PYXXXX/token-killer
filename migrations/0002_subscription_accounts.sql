CREATE TABLE IF NOT EXISTS provider_accounts (
  id TEXT PRIMARY KEY,
  vault_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  identity_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  plan_type TEXT NOT NULL DEFAULT '',
  credential_ciphertext TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  refresh_lock_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(vault_hash, provider, identity_hash)
);

CREATE INDEX IF NOT EXISTS idx_provider_accounts_vault
  ON provider_accounts(vault_hash, updated_at DESC);

CREATE TABLE IF NOT EXISTS oauth_device_sessions (
  id TEXT PRIMARY KEY,
  vault_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  payload_ciphertext TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_device_sessions_vault
  ON oauth_device_sessions(vault_hash, provider, expires_at);
