// A submission is one atomic SQL statement. Keep the quota predicate here, not
// in a preceding SELECT: concurrent requests may both pass a separate check.
export const insertSubmission = `
  INSERT INTO questions (id,question,ip_hash,quota_day,receipt_hash,created_at,updated_at,request_id)
  SELECT ?1,?2,?3,?4,?5,?6,?6,?7
  WHERE (SELECT count(*) FROM questions WHERE ip_hash=?3 AND quota_day=?4)
    < CAST((SELECT value FROM settings WHERE key='daily_limit') AS INTEGER)
  ON CONFLICT(id) DO NOTHING
  RETURNING id
`;

export const publishQuestion = `UPDATE questions SET answer=?1,status='answered',answered_at=?2,updated_at=?2 WHERE id=?3`;
export const archiveQuestion = `UPDATE questions SET status='archived',updated_at=?1 WHERE id=?2`;
