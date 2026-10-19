-- Visitante e sessão nos eventos (fase 9.2): jornadas, funis, perfis e gravações.
ALTER TABLE events ADD COLUMN visitor_id TEXT;
ALTER TABLE events ADD COLUMN session_id TEXT;
CREATE INDEX events_account_ts_idx ON events(account_id, ts);
CREATE INDEX events_session_idx ON events(account_id, session_id);
CREATE INDEX events_visitor_idx ON events(account_id, visitor_id);
