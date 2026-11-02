ALTER TABLE questions ADD COLUMN search_tokens TEXT NOT NULL DEFAULT '';
ALTER TABLE questions ADD COLUMN deleted_at TEXT;
INSERT INTO settings(key,value) VALUES ('hidden_revision','0');

CREATE VIRTUAL TABLE hidden_question_search USING fts5(question_id UNINDEXED, tokens, tokenize='unicode61');

-- Keep existing segmentation where available. Older unanswered/hidden questions
-- receive original words and character bigrams so they become searchable too.
UPDATE questions SET search_tokens = COALESCE(
  (SELECT tokens FROM question_search WHERE question_id=questions.id LIMIT 1),
  question || ' ' || COALESCE((
    WITH RECURSIVE positions(n) AS (
      SELECT 1 UNION ALL SELECT n+1 FROM positions WHERE n<length(questions.question)-1
    )
    SELECT group_concat(substr(questions.question,n,2),' ') FROM positions
  ),'')
);

DELETE FROM question_search;
INSERT INTO question_search(question_id,tokens)
  SELECT id,search_tokens FROM questions WHERE status IN ('pending','answered') AND deleted_at IS NULL;
INSERT INTO hidden_question_search(question_id,tokens)
  SELECT id,search_tokens FROM questions WHERE status='archived' AND deleted_at IS NULL;

CREATE TRIGGER questions_search_insert AFTER INSERT ON questions BEGIN
  INSERT INTO question_search(question_id,tokens)
    SELECT NEW.id,NEW.search_tokens WHERE NEW.status IN ('pending','answered') AND NEW.deleted_at IS NULL;
  INSERT INTO hidden_question_search(question_id,tokens)
    SELECT NEW.id,NEW.search_tokens WHERE NEW.status='archived' AND NEW.deleted_at IS NULL;
  UPDATE settings SET value=CAST(value AS INTEGER)+1 WHERE key='hidden_revision'
    AND NEW.status='archived' AND NEW.deleted_at IS NULL;
END;

CREATE TRIGGER questions_search_update AFTER UPDATE OF status,deleted_at,search_tokens ON questions BEGIN
  DELETE FROM question_search WHERE question_id=OLD.id;
  DELETE FROM hidden_question_search WHERE question_id=OLD.id;
  INSERT INTO question_search(question_id,tokens)
    SELECT NEW.id,NEW.search_tokens WHERE NEW.status IN ('pending','answered') AND NEW.deleted_at IS NULL;
  INSERT INTO hidden_question_search(question_id,tokens)
    SELECT NEW.id,NEW.search_tokens WHERE NEW.status='archived' AND NEW.deleted_at IS NULL;
  UPDATE settings SET value=CAST(value AS INTEGER)+1 WHERE key='hidden_revision'
    AND (OLD.status='archived' AND OLD.deleted_at IS NULL)
      != (NEW.status='archived' AND NEW.deleted_at IS NULL);
END;
