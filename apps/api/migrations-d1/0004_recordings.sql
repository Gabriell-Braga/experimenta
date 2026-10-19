-- Gravação de sessão (fase 10.3): metadados por sessão + blocos de eventos rrweb.
CREATE TABLE recordings (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  pages TEXT NOT NULL,
  device TEXT NOT NULL,
  vw INTEGER NOT NULL,
  vh INTEGER NOT NULL,
  events INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX recordings_session_uq ON recordings(account_id, session_id);
CREATE INDEX recordings_started_idx ON recordings(account_id, started_at);
CREATE TABLE recording_chunks (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  first_ts INTEGER NOT NULL,
  data TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX recording_chunks_session_idx ON recording_chunks(account_id, session_id, first_ts);
