CREATE TABLE ai_messages (
  id TEXT,
  session_id TEXT,
  role TEXT,
  content TEXT,
  created_at TEXT,
  sequence INTEGER
);
INSERT INTO ai_messages VALUES
  ('cursor-user', 'cursor-fixture', 'user', 'Cursor complete question', '2026-07-26T08:00:00.000Z', 0),
  ('cursor-assistant', 'cursor-fixture', 'assistant', 'Cursor complete answer', '2026-07-26T08:00:01.000Z', 1);
