export type Status = "pending" | "answered" | "archived";
export interface Question {
  id: string;
  question: string;
  answer: string | null;
  status: Status;
  created_at: string;
  answered_at: string | null;
  updated_at: string;
  votes: number;
}
export type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: { requestId: string };
};

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function dayInSingapore(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

const encoder = new TextEncoder();
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
function unbase64url(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
}
async function hmacKey(secret: string) {
  if (!secret)
    throw new AppError(
      503,
      "configuration_error",
      "服务尚未配置完成，请稍后再试。",
    );
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function digest(value: string): Promise<string> {
  return base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  );
}
export async function keyedDigest(
  secret: string,
  value: string,
): Promise<string> {
  return base64url(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await hmacKey(secret),
        encoder.encode(value),
      ),
    ),
  );
}
export async function signToken(secret: string, data: object): Promise<string> {
  const payload = base64url(encoder.encode(JSON.stringify(data)));
  return `${payload}.${await keyedDigest(secret, payload)}`;
}
export async function readToken(
  secret: string,
  token: string,
): Promise<Record<string, unknown>> {
  try {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) throw new Error("Invalid token");
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      unbase64url(signature),
      encoder.encode(payload),
    );
    const data: unknown = JSON.parse(
      new TextDecoder().decode(unbase64url(payload)),
    );
    if (
      !valid ||
      !data ||
      typeof data !== "object" ||
      !("exp" in data) ||
      typeof data.exp !== "number" ||
      data.exp <= Date.now()
    )
      throw new Error("Expired token");
    return data as Record<string, unknown>;
  } catch {
    throw new AppError(400, "invalid_token", "凭据已失效，请重新检查后提交。");
  }
}

// Segment CJK words and add character bigrams so common Chinese phrases can match.
export function searchTokens(text: string): string[] {
  const words = [
    ...new Intl.Segmenter("zh", { granularity: "word" }).segment(
      text.normalize("NFKC").toLowerCase(),
    ),
  ]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment);
  const grams = (
    text.normalize("NFKC").match(/[\p{Script=Han}]+/gu) ?? []
  ).flatMap((run) =>
    Array.from(run)
      .slice(0, -1)
      .map((char, i) => char + Array.from(run)[i + 1]),
  );
  return [...new Set([...words, ...grams])];
}
export function matchQuery(text: string): string {
  return searchTokens(text)
    .slice(0, 48)
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(" OR ");
}

export function validQuestion(value: unknown): string {
  if (typeof value !== "string")
    throw new AppError(400, "invalid_question", "请输入你的问题。");
  const text = value.trim();
  if (!text || Array.from(text).length > 1000)
    throw new AppError(400, "invalid_question", "问题需要在 1–1000 字之间。");
  return text;
}
export async function jsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("Expected object");
    return body as Record<string, unknown>;
  } catch {
    throw new AppError(400, "invalid_json", "请求内容无效，请刷新后重试。");
  }
}
export function log(
  event: string,
  fields: Record<string, unknown>,
  severity: "info" | "error" = "info",
) {
  const entry = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  });
  if (severity === "error") console.error(entry);
  else console.log(entry);
}
export async function dbRead<T>(
  db: D1Database,
  requestId: string,
  operation: string,
  sql: string,
  ...bindings: (string | number | null)[]
): Promise<T[]> {
  const start = performance.now();
  const result = await db
    .prepare(sql)
    .bind(...bindings)
    .all<T>();
  log("database", {
    request_id: requestId,
    operation,
    duration_ms: Math.round(performance.now() - start),
    rows_read: result.meta.rows_read,
    rows_written: result.meta.rows_written,
  });
  return result.results;
}
export const publicSelect = `SELECT q.id,q.question,q.answer,q.status,q.created_at,q.answered_at,q.updated_at,
  (SELECT count(*) FROM votes v WHERE v.question_id=q.id) AS votes FROM questions q`;
