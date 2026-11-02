// A submission is one atomic SQL statement. Keep the quota predicate here, not
// in a preceding SELECT: concurrent requests may both pass a separate check.
export const insertSubmission = `
  INSERT INTO questions (id,question,ip_hash,quota_day,receipt_hash,created_at,updated_at,request_id,search_tokens)
  SELECT ?1,?2,?3,?4,?5,?6,?6,?7,?8
  WHERE (SELECT count(*) FROM questions WHERE ip_hash=?3 AND quota_day=?4)
    < CAST((SELECT value FROM settings WHERE key='daily_limit') AS INTEGER)
    AND CAST((SELECT value FROM settings WHERE key='hidden_revision') AS INTEGER)=?9
  ON CONFLICT(id) DO NOTHING
  RETURNING id
`;

export const publishQuestion = `UPDATE questions SET answer=?1,status='answered',answered_at=?2,updated_at=?2 WHERE id=?3 AND deleted_at IS NULL`;
export const archiveQuestion = `UPDATE questions SET status='archived',updated_at=?1 WHERE id=?2 AND deleted_at IS NULL`;
export const restoreQuestion = `UPDATE questions SET status=CASE WHEN answer IS NULL THEN 'pending' ELSE 'answered' END,updated_at=?1 WHERE id=?2 AND status='archived' AND deleted_at IS NULL`;
export const deleteQuestion = `UPDATE questions SET question='',answer=NULL,search_tokens='',status='archived',answered_at=NULL,deleted_at=?1,updated_at=?1 WHERE id=?2 AND deleted_at IS NULL`;
