import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { timingSafeEqual } from "node:crypto";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  AppError,
  type AppEnv,
  type Question,
  dbRead,
  dayInSingapore,
  digest,
  jsonBody,
  keyedDigest,
  log,
  matchQuery,
  publicSelect,
  readToken,
  searchTokens,
  signToken,
  validQuestion,
} from "./domain";
import { moderate, similarIds } from "./deepseek";
import { insertSubmission, publishQuestion, archiveQuestion, restoreQuestion, deleteQuestion } from "./sql";
import {
  page,
  home,
  collection,
  questionPage,
  loginPage,
  adminPage,
  messagePage,
} from "./views";

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("X-Request-ID", requestId);
  if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/admin"))
    c.header("Cache-Control", "no-store");
  const start = performance.now();
  await next();
  log("request", {
    request_id: requestId,
    cf_ray: c.req.header("cf-ray"),
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration_ms: Math.round(performance.now() - start),
  });
});

app.onError((error, c) => {
  const known = error instanceof AppError;
  const status = known ? error.status : 500;
  log(
    "request_error",
    {
      request_id: c.get("requestId"),
      code: known ? error.code : "internal_error",
      error: error.message,
      stack: known ? undefined : error.stack,
    },
    "error",
  );
  const message = known ? error.message : "服务暂时出错，请稍后重试。";
  if (c.req.path.startsWith("/api/"))
    return c.json(
      {
        error: { code: known ? error.code : "internal_error", message },
        request_id: c.get("requestId"),
      },
      status as ContentfulStatusCode,
    );
  return c.html(
    page("暂时无法打开", messagePage(message, c.get("requestId"))),
    status as ContentfulStatusCode,
  );
});

async function isAdmin(request: Request, secret: string): Promise<boolean> {
  const token = request.headers
    .get("Cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("anome_session="))
    ?.slice("anome_session=".length);
  if (!token) return false;
  try {
    return (await readToken(secret, token)).purpose === "admin";
  } catch (error) {
    if (error instanceof AppError && error.code === "invalid_token")
      return false;
    throw error;
  }
}
app.use("/api/admin/*", async (c, next) => {
  if (!(await isAdmin(c.req.raw, c.env.APP_SECRET)))
    throw new AppError(401, "not_authenticated", "请先登录管理页。");
  await next();
});

async function ipHash(request: Request, secret: string) {
  let ip = request.headers.get("CF-Connecting-IP");
  const host = new URL(request.url).hostname;
  if (!ip && ["localhost", "127.0.0.1", "[::1]"].includes(host))
    ip = "127.0.0.1";
  if (!ip)
    throw new AppError(400, "missing_ip", "无法识别当前网络，请刷新后重试。");
  return keyedDigest(secret, `ip:${ip.toLowerCase()}`);
}
async function quota(env: CloudflareBindings, requestId: string, hash: string) {
  const [row] = await dbRead<{ daily_limit: number; used: number }>(
    env.DB,
    requestId,
    "quota",
    `SELECT CAST(value AS INTEGER) AS daily_limit,
      (SELECT count(*) FROM questions WHERE ip_hash=? AND quota_day=?) AS used FROM settings WHERE key='daily_limit'`,
    hash,
    dayInSingapore(),
  );
  return row;
}
function quotaError() {
  return new AppError(
    429,
    "daily_limit",
    "这个 IP 今天的提问次数已用完，明天再来吧。",
  );
}
async function batch(
  db: D1Database,
  requestId: string,
  operation: string,
  statements: D1PreparedStatement[],
) {
  const start = performance.now();
  const results = await db.batch(statements);
  log("database", {
    request_id: requestId,
    operation,
    duration_ms: Math.round(performance.now() - start),
    rows_read: results.reduce((sum, row) => sum + row.meta.rows_read, 0),
    rows_written: results.reduce((sum, row) => sum + row.meta.rows_written, 0),
  });
  return results;
}

async function hiddenRevision(env: CloudflareBindings, requestId: string) {
  const [row] = await dbRead<{ revision: number }>(env.DB, requestId, 'hidden_revision',
    "SELECT CAST(value AS INTEGER) AS revision FROM settings WHERE key='hidden_revision'");
  return row.revision;
}

async function assertNotHidden(env: CloudflareBindings, requestId: string, question: string, query: string) {
  const candidates = await dbRead<{ id: string; question: string }>(env.DB, requestId, 'hidden_candidates',
    `SELECT q.id,q.question FROM questions q WHERE q.status='archived' AND q.deleted_at IS NULL AND
      (q.question=? OR q.id IN (SELECT question_id FROM hidden_question_search WHERE hidden_question_search MATCH ? ORDER BY rank LIMIT 30))`,
    question, query || '""');
  const exact = candidates.filter(candidate => candidate.question.trim() === question);
  const matches = exact.length ? exact.map(candidate => candidate.id)
    : await similarIds(env, requestId, question, candidates, 'hidden');
  if (matches.length) {
    log('hidden_question_blocked', { request_id: requestId, matched_ids: matches });
    throw new AppError(422, 'hidden_question', '这个问题与已隐藏的问题相似，暂不接受重复提问。');
  }
}

app.get("/", async (c) => {
  const [settings] = await dbRead<{ value: string }>(
    c.env.DB,
    c.get("requestId"),
    "public_settings",
    `SELECT value FROM settings WHERE key='daily_limit'`,
  );
  return c.html(page("匿名提问", home(Number(settings.value)), "home"));
});
app.get("/my", (c) => c.html(page("我的提问", collection("my"), "my")));
app.get("/saved", (c) => c.html(page("Mark", collection("saved"), "saved")));
app.get("/q/:id", async (c) => {
  const [question] = await dbRead<Question>(
    c.env.DB,
    c.get("requestId"),
    "public_detail",
    `${publicSelect} WHERE q.id=? AND q.status IN ('pending','answered')`,
    c.req.param("id"),
  );
  if (!question)
    return c.html(
      page("问题不可用", messagePage("这个问题不存在，或已经被隐藏或删除。")),
      404,
    );
  return c.html(page(question.question, questionPage(question), "question"));
});
app.get("/admin", async (c) => {
  if (!(await isAdmin(c.req.raw, c.env.APP_SECRET)))
    return c.html(page("管理登录", loginPage(), "login"));
  return c.html(page("管理", adminPage(), "admin", true));
});

app.get("/api/health", async (c) => {
  await dbRead(c.env.DB, c.get("requestId"), "health", "SELECT 1");
  return c.json({
    ok: true,
    version: "2026.1.0",
    request_id: c.get("requestId"),
  });
});
app.get("/api/questions", async (c) => {
  const query = (c.req.query("search") ?? "").trim().slice(0, 200);
  const sort =
    c.req.query("sort") === "popular"
      ? "votes DESC, q.created_at DESC, q.id"
      : "q.created_at DESC, q.id";
  const pageNumber = Math.max(
    1,
    Math.min(10000, Number.parseInt(c.req.query("page") ?? "1", 10) || 1),
  );
  const filter = matchQuery(query);
  const search = query
    ? filter
      ? " AND q.id IN (SELECT question_id FROM question_search WHERE question_search MATCH ?)"
      : " AND 0"
    : "";
  const params: (string | number)[] = query && filter ? [filter] : [];
  const rows = await dbRead<Question>(
    c.env.DB,
    c.get("requestId"),
    "public_list",
    `${publicSelect} WHERE q.status IN ('pending','answered')${search} ORDER BY ${sort} LIMIT 13 OFFSET ?`,
    ...params,
    (pageNumber - 1) * 12,
  );
  return c.json({
    items: rows.slice(0, 12),
    page: pageNumber,
    has_more: rows.length > 12,
  });
});
app.get("/api/questions/:id", async (c) => {
  const [row] = await dbRead<Question>(
    c.env.DB,
    c.get("requestId"),
    "public_detail",
    `${publicSelect} WHERE q.id=? AND q.status IN ('pending','answered')`,
    c.req.param("id"),
  );
  if (!row)
    throw new AppError(404, "not_public", "这个问题不存在，或已经被隐藏或删除。");
  return c.json(row);
});

app.post("/api/questions/check", async (c) => {
  const body = await jsonBody(c.req.raw);
  const question = validQuestion(body.question);
  const hash = await ipHash(c.req.raw, c.env.APP_SECRET);
  const current = await quota(c.env, c.get("requestId"), hash);
  if (current.used >= current.daily_limit) throw quotaError();
  const terms = await moderate(c.env, c.get("requestId"), question);
  const query = matchQuery([...terms, question].join(" "));
  const revision = await hiddenRevision(c.env, c.get('requestId'));
  await assertNotHidden(c.env, c.get('requestId'), question, query);
  const candidates = query
    ? await dbRead<Question>(
        c.env.DB,
        c.get("requestId"),
        "similar_candidates",
        `${publicSelect} WHERE q.status IN ('pending','answered') AND q.id IN
      (SELECT question_id FROM question_search WHERE question_search MATCH ? ORDER BY rank LIMIT 30)`,
        query,
      )
    : [];
  const ids = await similarIds(
    c.env,
    c.get("requestId"),
    question,
    candidates.map(({ id, question }) => ({ id, question })),
  );
  const similar = ids.map((id) =>
    candidates.find((candidate) => candidate.id === id)!,
  );
  const checkId = crypto.randomUUID();
  const token = await signToken(c.env.APP_SECRET, {
    purpose: "submission",
    id: checkId,
    question_hash: await digest(question),
    ip_hash: hash,
    hidden_revision: revision,
    search_query: query,
    exp: Date.now() + 600_000,
  });
  log("precheck_complete", {
    request_id: c.get("requestId"),
    check_id: checkId,
    candidate_ids: candidates.map((x) => x.id),
    similar_ids: ids,
  });
  return c.json({
    token,
    similar,
    remaining: current.daily_limit - current.used,
  });
});
app.post("/api/questions", async (c) => {
  const body = await jsonBody(c.req.raw);
  const question = validQuestion(body.question);
  const token = await readToken(
    c.env.APP_SECRET,
    typeof body.token === "string" ? body.token : "",
  );
  const hash = await ipHash(c.req.raw, c.env.APP_SECRET);
  if (
    token.purpose !== "submission" ||
    token.question_hash !== (await digest(question)) ||
    token.ip_hash !== hash ||
    typeof token.id !== "string" ||
    typeof token.hidden_revision !== 'number' ||
    typeof token.search_query !== 'string'
  ) {
    throw new AppError(
      400,
      "check_required",
      "问题内容已改变，请重新检查后提交。",
    );
  }
  const id = token.id;
  const receipt = await keyedDigest(c.env.APP_SECRET, `receipt:${id}`);
  const existing = await dbRead<{ id: string }>(
    c.env.DB,
    c.get("requestId"),
    "submission_retry",
    "SELECT id FROM questions WHERE id=?",
    id,
  );
  if (!existing.length) {
    const revision = await hiddenRevision(c.env, c.get('requestId'));
    if (token.hidden_revision !== revision) {
      await assertNotHidden(c.env, c.get('requestId'), question, token.search_query);
    }
    const now = new Date().toISOString();
    const inserted = await dbRead<{ id: string }>(
      c.env.DB,
      c.get("requestId"),
      "insert_submission",
      insertSubmission,
      id,
      question,
      hash,
      dayInSingapore(),
      await digest(receipt),
      now,
      c.get("requestId"),
      searchTokens(question).join(' '),
      revision,
    );
    if (!inserted.length) {
      const retry = await dbRead<{ id: string }>(
        c.env.DB,
        c.get("requestId"),
        "submission_race",
        "SELECT id FROM questions WHERE id=?",
        id,
      );
      if (!retry.length) {
        const current = await quota(c.env, c.get('requestId'), hash);
        if (current.used >= current.daily_limit) throw quotaError();
        throw new AppError(409, 'hidden_policy_changed', '提问规则刚刚更新，请重新检查后提交。');
      }
    }
  }
  log("submission", {
    request_id: c.get("requestId"),
    question_id: id,
    replay: existing.length > 0,
  });
  return c.json({ id, receipt }, 201);
});
app.post("/api/submissions/status", async (c) => {
  const body = await jsonBody(c.req.raw);
  if (typeof body.id !== "string" || typeof body.receipt !== "string")
    throw new AppError(400, "invalid_receipt", "查询凭据无效。");
  const [row] = await dbRead<Question>(
    c.env.DB,
    c.get("requestId"),
    "submission_status",
    `${publicSelect} WHERE q.id=? AND q.receipt_hash=? AND q.deleted_at IS NULL`,
    body.id,
    await digest(body.receipt),
  );
  if (!row) throw new AppError(404, "not_found", "没有找到这条提问。");
  return c.json(row);
});
app.on("PUT", ["/api/questions/:id/mark", "/api/questions/:id/vote"], async (c) => {
  const body = await jsonBody(c.req.raw);
  if (
    typeof body.visitor_id !== "string" ||
    !/^[a-zA-Z0-9-]{16,80}$/.test(body.visitor_id) ||
    typeof body.active !== "boolean"
  ) {
    throw new AppError(400, "invalid_mark", "Mark 请求无效，请刷新后重试。");
  }
  const id = c.req.param("id");
  const [row] = await dbRead<{ id: string }>(
    c.env.DB,
    c.get("requestId"),
    "mark_question",
    `SELECT id FROM questions WHERE id=? AND deleted_at IS NULL ${body.active ? "AND status IN ('pending','answered')" : ""}`,
    id,
  );
  if (!row)
    throw new AppError(404, "not_public", "这个问题不存在，或已经被隐藏或删除。");
  await batch(c.env.DB, c.get("requestId"), "mark", [
    body.active
      ? c.env.DB.prepare(
          `INSERT INTO votes(question_id,visitor_id,created_at) SELECT ?,?,? WHERE EXISTS
        (SELECT 1 FROM questions WHERE id=? AND status IN ('pending','answered')) ON CONFLICT DO NOTHING`,
        ).bind(id, body.visitor_id, new Date().toISOString(), id)
      : c.env.DB.prepare(
          "DELETE FROM votes WHERE question_id=? AND visitor_id=?",
        ).bind(id, body.visitor_id),
  ]);
  const [count] = await dbRead<{ votes: number }>(
    c.env.DB,
    c.get("requestId"),
    "mark_count",
    "SELECT count(*) AS votes FROM votes WHERE question_id=?",
    id,
  );
  log("mark", { request_id: c.get("requestId"), question_id: id, active: body.active, count: count.votes });
  return c.json({ votes: count.votes, active: body.active });
});

app.post("/api/login", async (c) => {
  const body = await jsonBody(c.req.raw);
  if (!c.env.ADMIN_PASSWORD)
    throw new AppError(503, "configuration_error", "管理密码尚未配置。");
  const submitted = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      typeof body.password === "string" ? body.password : "",
    ),
  );
  const expected = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(c.env.ADMIN_PASSWORD),
  );
  if (!timingSafeEqual(new Uint8Array(submitted), new Uint8Array(expected)))
    throw new AppError(401, "wrong_password", "密码不正确。");
  const token = await signToken(c.env.APP_SECRET, {
    purpose: "admin",
    exp: Date.now() + 7 * 86400_000,
  });
  setCookie(c, "anome_session", token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    path: "/",
    maxAge: 7 * 86400,
  });
  log("admin_login", { request_id: c.get("requestId") });
  return c.json({ ok: true });
});
app.post("/api/logout", (c) => {
  deleteCookie(c, "anome_session", { path: "/" });
  return c.json({ ok: true });
});
app.get("/api/admin/questions", async (c) => {
  const status = c.req.query("status") ?? "pending";
  if (!["pending", "answered", "archived"].includes(status))
    throw new AppError(400, "invalid_status", "问题状态无效。");
  const query = (c.req.query("search") ?? "").trim().slice(0, 200);
  const number = Math.max(
    1,
    Number.parseInt(c.req.query("page") ?? "1", 10) || 1,
  );
  const rows = await dbRead<Question>(
    c.env.DB,
    c.get("requestId"),
    "admin_list",
    `${publicSelect} WHERE q.status=? AND q.deleted_at IS NULL AND (q.question LIKE ? OR COALESCE(q.answer,'') LIKE ?)
      ORDER BY q.created_at DESC,q.id LIMIT 13 OFFSET ?`,
    status,
    `%${query}%`,
    `%${query}%`,
    (number - 1) * 12,
  );
  return c.json({
    items: rows.slice(0, 12),
    page: number,
    has_more: rows.length > 12,
  });
});
app.post("/api/admin/questions/bulk-delete", async (c) => {
  const body = await jsonBody(c.req.raw);
  if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 100 ||
      !body.ids.every((id) => typeof id === "string" && id.length > 0))
    throw new AppError(400, "invalid_selection", "请选择 1–100 个问题。");
  const ids = [...new Set(body.ids as string[])];
  const rows = await dbRead<Question>(c.env.DB, c.get("requestId"), "bulk_delete_selection",
    `${publicSelect} WHERE q.deleted_at IS NULL AND q.id IN (SELECT value FROM json_each(?))`, JSON.stringify(ids));
  if (rows.length !== ids.length)
    throw new AppError(404, "not_found", "部分问题已不可用，请刷新后重新选择。");
  const now = new Date().toISOString();
  await batch(c.env.DB, c.get("requestId"), "admin_bulk_delete", rows.flatMap((row) => [
    c.env.DB.prepare(deleteQuestion).bind(now, row.id),
    c.env.DB.prepare("DELETE FROM votes WHERE question_id=?").bind(row.id),
    c.env.DB.prepare("INSERT INTO admin_actions(question_id,action,detail,request_id,created_at) VALUES (?,?,?,?,?)")
      .bind(row.id, "delete", JSON.stringify({ previous_status: row.status, bulk: true }), c.get("requestId"), now),
  ]));
  log("admin_bulk_delete", { request_id: c.get("requestId"), question_ids: ids, count: ids.length });
  return c.json({ ok: true, deleted: ids.length });
});
app.patch("/api/admin/questions/:id", async (c) => {
  const body = await jsonBody(c.req.raw);
  const id = c.req.param("id");
  const [old] = await dbRead<Question>(
    c.env.DB,
    c.get("requestId"),
    "admin_question",
    `${publicSelect} WHERE q.id=? AND q.deleted_at IS NULL`,
    id,
  );
  if (!old) throw new AppError(404, "not_found", "没有找到这个问题。");
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  if (body.action === "publish") {
    if (
      typeof body.answer !== "string" ||
      !body.answer.trim() ||
      Array.from(body.answer.trim()).length > 10000
    )
      throw new AppError(400, "invalid_answer", "回复需要在 1–10000 字之间。");
    statements.push(
      c.env.DB.prepare(publishQuestion).bind(body.answer.trim(), now, id),
    );
  } else if (body.action === "hide" || body.action === "archive") {
    statements.push(c.env.DB.prepare(archiveQuestion).bind(now, id));
  } else if (body.action === 'restore') {
    statements.push(c.env.DB.prepare(restoreQuestion).bind(now, id));
  } else throw new AppError(400, "invalid_action", "操作无效。");
  statements.push(
    c.env.DB.prepare(
      "INSERT INTO admin_actions(question_id,action,detail,request_id,created_at) VALUES (?,?,?,?,?)",
    ).bind(
      id,
      body.action,
      JSON.stringify({ previous_status: old.status }),
      c.get("requestId"),
      now,
    ),
  );
  await batch(
    c.env.DB,
    c.get("requestId"),
    "admin_question_update",
    statements,
  );
  log("admin_action", {
    request_id: c.get("requestId"),
    question_id: id,
    action: body.action,
    previous_status: old.status,
  });
  return c.json({ ok: true });
});
app.get("/api/admin/settings", async (c) => {
  const [row] = await dbRead<{ value: string }>(
    c.env.DB,
    c.get("requestId"),
    "settings",
    `SELECT value FROM settings WHERE key='daily_limit'`,
  );
  return c.json({ daily_limit: Number(row.value) });
});
app.put("/api/admin/settings", async (c) => {
  const body = await jsonBody(c.req.raw);
  if (
    typeof body.daily_limit !== "number" ||
    !Number.isInteger(body.daily_limit) ||
    body.daily_limit < 1 ||
    body.daily_limit > 100
  )
    throw new AppError(
      400,
      "invalid_limit",
      "每日限额需要是 1–100 之间的整数。",
    );
  await batch(c.env.DB, c.get("requestId"), "settings_update", [
    c.env.DB.prepare(
      `UPDATE settings SET value=? WHERE key='daily_limit'`,
    ).bind(String(body.daily_limit)),
    c.env.DB.prepare(
      "INSERT INTO admin_actions(action,detail,request_id,created_at) VALUES (?,?,?,?)",
    ).bind(
      "settings",
      JSON.stringify({ daily_limit: body.daily_limit }),
      c.get("requestId"),
      new Date().toISOString(),
    ),
  ]);
  return c.json({ ok: true });
});

app.notFound((c) =>
  c.req.path.startsWith("/api/")
    ? c.json(
        {
          error: { code: "not_found", message: "没有找到这个地址。" },
          request_id: c.get("requestId"),
        },
        404,
      )
    : c.html(page("没有找到页面", messagePage("没有找到这个页面。")), 404),
);

export default app;
