CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','answered','archived')),
  ip_hash TEXT NOT NULL,
  quota_day TEXT NOT NULL,
  receipt_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  answered_at TEXT,
  updated_at TEXT NOT NULL,
  request_id TEXT NOT NULL
);
CREATE INDEX questions_quota ON questions(ip_hash, quota_day);
CREATE INDEX questions_public ON questions(status, answered_at DESC, id);
CREATE INDEX questions_inbox ON questions(status, created_at DESC, id);

CREATE TABLE votes (
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(question_id, visitor_id)
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO settings VALUES ('daily_limit', '5');

CREATE TABLE admin_actions (
  id INTEGER PRIMARY KEY,
  question_id TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX admin_actions_question ON admin_actions(question_id, created_at DESC);

CREATE VIRTUAL TABLE question_search USING fts5(question_id UNINDEXED, tokens, tokenize='unicode61');
