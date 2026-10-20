-- Multi-conta (fase 16.2): papel por conta em memberships; users vira a pessoa (login).
CREATE TABLE memberships (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner','editor','viewer')),
  can_publish_js INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id);
INSERT INTO memberships (account_id, user_id, role, can_publish_js, created_at)
  SELECT account_id, id, role, can_publish_js, created_at FROM users;
ALTER TABLE users DROP COLUMN role;
ALTER TABLE users DROP COLUMN can_publish_js;
