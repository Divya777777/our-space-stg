-- Push notification tokens (Expo push tokens), one row per phone.
-- Reference only: the backend now creates this table itself on first use (services/push.js).
-- Safe to run twice: IF NOT EXISTS everywhere. Does not touch existing tables.
BEGIN;
CREATE TABLE IF NOT EXISTS push_tokens (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  platform    TEXT NOT NULL DEFAULT 'android',
  updated_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS push_tokens_user_id_idx ON push_tokens(user_id);
COMMIT;
