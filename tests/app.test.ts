import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  reset,
  createExecutionContext,
} from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-plugin";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import {
  dayInSingapore,
  searchTokens,
  signToken,
  digest,
  keyedDigest,
} from "../src/domain";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
type Payload = {
  token: string;
  similar: { id: string }[];
  id: string;
  receipt: string;
  error: { code: string };
  items: { id: string }[];
  votes: number;
};

const request = (
  path: string,
  method = "GET",
  body?: unknown,
  cookie?: string,
  ip = "192.0.2.1",
) =>
  app.fetch(
    new Request(`https://anome.test${path}`, {
      method,
      headers: {
        "CF-Connecting-IP": ip,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    env,
    createExecutionContext(),
  );
async function json(response: Response): Promise<Payload> {
  return response.json() as Promise<Payload>;
}
function modelResponse(data: unknown) {
  return Response.json({
    id: "model-test",
    choices: [
      { message: { content: JSON.stringify(data) }, finish_reason: "stop" },
    ],
    usage: { total_tokens: 20 },
  });
}
function normalModel(blockHidden = false) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      const input = JSON.parse(body.messages[1].content);
      return modelResponse(
        input.candidates
          ? {
              ids: (input.scope === 'hidden' && !blockHidden ? [] : input.candidates)
                .slice(0, 3)
                .map((item: { id: string }) => item.id),
            }
          : {
              spam: false,
              reason: "普通提问",
              search_terms: ["读书", "书籍", "推荐"],
            },
      );
    });
}
async function check(question = "有什么值得反复读的书？", ip?: string) {
  const response = await request(
    "/api/questions/check",
    "POST",
    { question },
    undefined,
    ip,
  );
  expect(response.status).toBe(200);
  return { ...(await json(response)), question };
}
async function submit(question = "有什么值得反复读的书？", ip?: string) {
  const checked = await check(question, ip);
  const response = await request(
    "/api/questions",
    "POST",
    { token: checked.token, question },
    undefined,
    ip,
  );
  expect(response.status).toBe(201);
  return json(response);
}
async function login() {
  const response = await request("/api/login", "POST", {
    password: "test-password",
  });
  expect(response.status).toBe(200);
  return response.headers.get("Set-Cookie")!.split(";")[0];
}
async function count() {
  return Number(
    await env.DB.prepare("SELECT count(*) FROM questions").first("count(*)"),
  );
}
async function publish(
  id: string,
  cookie: string,
  answer = "最近在重读《悉达多》。",
) {
  const response = await request(
    `/api/admin/questions/${id}`,
    "PATCH",
    { action: "publish", answer },
    cookie,
  );
  expect(response.status).toBe(200);
}

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

describe("submission and public lifecycle", () => {
  it("checks without saving, publishes pending questions immediately, and tracks with receipt", async () => {
    normalModel();
    const checked = await check();
    expect(await count()).toBe(0);
    const response = await request("/api/questions", "POST", checked);
    const item = await json(response);
    expect(response.status).toBe(201);
    expect((await request(`/api/questions/${item.id}`)).status).toBe(200);
    expect(await (await request(`/q/${item.id}`)).text()).toContain('待回复');
    expect((await json(await request("/api/questions"))).items[0].id).toBe(item.id);
    expect((await json(await request('/api/questions?search=反复读'))).items[0].id).toBe(item.id);
    expect(
      (
        await request("/api/submissions/status", "POST", {
          id: item.id,
          receipt: "wrong",
        })
      ).status,
    ).toBe(404);
    expect(
      (await request("/api/submissions/status", "POST", item)).status,
    ).toBe(200);
    const cookie = await login();
    await publish(item.id, cookie);
    expect((await request(`/api/questions/${item.id}`)).status).toBe(200);
    expect((await request(`/q/${item.id}`)).status).toBe(200);
    expect(
      (await json(await request("/api/questions?search=读书"))).items,
    ).toHaveLength(0);
    expect(
      (await json(await request("/api/questions?search=反复读"))).items[0].id,
    ).toBe(item.id);
    await publish(item.id, cookie, "更新后的回答");
    expect(await (await request(`/api/questions/${item.id}`)).text()).toContain(
      "更新后的回答",
    );
    await request(
      `/api/admin/questions/${item.id}`,
      "PATCH",
      { action: "archive" },
      cookie,
    );
    expect((await request(`/api/questions/${item.id}`)).status).toBe(404);
    expect(
      (await json(await request("/api/questions?search=反复读"))).items,
    ).toHaveLength(0);
    expect(
      await env.DB.prepare("SELECT count(*) FROM question_search").first(
        "count(*)",
      ),
    ).toBe(0);
    const tracking = await request("/api/submissions/status", "POST", item);
    expect(await tracking.text()).toContain("archived");
    expect(
      await env.DB.prepare("SELECT count(*) FROM admin_actions").first(
        "count(*)",
      ),
    ).toBe(3);
  });

  it("handles concurrent retries idempotently", async () => {
    normalModel();
    const checked = await check();
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request("/api/questions", "POST", checked),
      ),
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);
    const items = await Promise.all(responses.map(json));
    expect(new Set(items.map((item) => item.id)).size).toBe(1);
    expect(new Set(items.map((item) => item.receipt)).size).toBe(1);
    expect(await count()).toBe(1);
  });

  it("does not accept changed content, different IPs, or expired checks", async () => {
    normalModel();
    const checked = await check();
    expect(
      (
        await request("/api/questions", "POST", {
          ...checked,
          question: "修改后的问题",
        })
      ).status,
    ).toBe(400);
    expect(
      (await request("/api/questions", "POST", checked, undefined, "192.0.2.2"))
        .status,
    ).toBe(400);
    const expired = await signToken(env.APP_SECRET, {
      purpose: "submission",
      exp: Date.now() - 1,
    });
    expect(
      (
        await request("/api/questions", "POST", {
          question: "普通问题",
          token: expired,
        })
      ).status,
    ).toBe(400);
    expect(await count()).toBe(0);
  });

  it("uses Unicode character length and escapes submitted HTML", async () => {
    normalModel();
    const long = await request("/api/questions/check", "POST", {
      question: "字".repeat(1001),
    });
    expect(long.status).toBe(400);
    const item = await submit("<script>alert(1)</script>");
    await publish(item.id, await login(), "<img src=x onerror=alert(1)>");
    const html = await (await request(`/q/${item.id}`)).text();
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<img src=x");
  });
});

describe("public pagination and ordering", () => {
  it("paginates without duplicates and puts the most-voted answer first", async () => {
    const ids = Array.from({ length: 13 }, () => crypto.randomUUID());
    await env.DB.batch(
      ids.map((id, index) => {
        const time = new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString();
        return env.DB.prepare(
          `INSERT INTO questions(id,question,answer,status,ip_hash,quota_day,receipt_hash,created_at,answered_at,updated_at,request_id)
        VALUES(?,?,'回答','answered','fixture','2026-11-01','receipt',?,?,?,'test')`,
        ).bind(
          id,
          `分页问题-${String(index).padStart(2, "0")}`,
          time,
          time,
          time,
        );
      }),
    );
    const first = await json(await request("/api/questions"));
    const second = await json(await request("/api/questions?page=2"));
    expect(first.items).toHaveLength(12);
    expect(second.items).toHaveLength(1);
    expect(first.items[0].id).toBe(ids[12]);
    expect(second.items[0].id).toBe(ids[0]);
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(13);
    await env.DB.prepare(
      "INSERT INTO votes(question_id,visitor_id,created_at) VALUES (?,?,?)",
    )
      .bind(ids[0], crypto.randomUUID(), new Date().toISOString())
      .run();
    expect(
      (await json(await request("/api/questions?sort=popular"))).items[0].id,
    ).toBe(ids[0]);
    const admin = await json(
      await request(
        "/api/admin/questions?status=answered&search=问题-00",
        "GET",
        undefined,
        await login(),
      ),
    );
    expect(admin.items.map((item) => item.id)).toEqual([ids[0]]);
  });
});

describe("IP quota", () => {
  it("accepts exactly five of six concurrent new questions and isolates different IPs", async () => {
    normalModel();
    const checked = await Promise.all(
      Array.from({ length: 6 }, (_, i) => check(`第${i}个普通问题`)),
    );
    const responses = await Promise.all(
      checked.map((body) => request("/api/questions", "POST", body)),
    );
    expect(
      responses.filter((response) => response.status === 201),
    ).toHaveLength(5);
    expect(
      responses.filter((response) => response.status === 429),
    ).toHaveLength(1);
    expect(await count()).toBe(5);
    expect(
      (await request("/api/questions/check", "POST", { question: "还想提问" }))
        .status,
    ).toBe(429);
    await submit("另一个网络的问题", "192.0.2.2");
    expect(await count()).toBe(6);
  });

  it("does not return quota after archive and permits questions on a new day", async () => {
    normalModel();
    await env.DB.prepare(
      "UPDATE settings SET value='1' WHERE key='daily_limit'",
    ).run();
    const item = await submit();
    await request(
      `/api/admin/questions/${item.id}`,
      "PATCH",
      { action: "archive" },
      await login(),
    );
    expect(
      (
        await request("/api/questions/check", "POST", {
          question: "另一个问题",
        })
      ).status,
    ).toBe(429);
    await env.DB.prepare("UPDATE questions SET quota_day=?")
      .bind(dayInSingapore(new Date(Date.now() - 86400_000)))
      .run();
    await submit("新一天的问题");
    expect(await count()).toBe(2);
    expect(dayInSingapore(new Date("2026-11-02T15:59:59Z"))).toBe("2026-11-02");
    expect(dayInSingapore(new Date("2026-11-02T16:00:00Z"))).toBe("2026-11-03");
  });
});

describe("AI moderation and similarity", () => {
  it.each([
    [
      "spam",
      () => modelResponse({ spam: true, reason: "广告", search_terms: [] }),
      422,
    ],
    ["upstream error", () => new Response("unavailable", { status: 503 }), 502],
    [
      "empty content",
      () =>
        Response.json({
          choices: [{ message: { content: "  " }, finish_reason: "stop" }],
        }),
      502,
    ],
    [
      "bad JSON",
      () =>
        Response.json({
          choices: [{ message: { content: "{broken" }, finish_reason: "stop" }],
        }),
      502,
    ],
    ["invalid fields", () => modelResponse({ spam: "false" }), 502],
  ])(
    "rejects %s without saving or charging quota",
    async (_label, response, status) => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => response());
      const result = await request("/api/questions/check", "POST", {
        question: "一个问题",
      });
      expect(result.status).toBe(status);
      expect(result.headers.get("X-Request-ID")).toBeTruthy();
      expect(await count()).toBe(0);
    },
  );

  it("requests a 15 second timeout and propagates an abort without saving", async () => {
    const timer = vi.spyOn(AbortSignal, "timeout");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new DOMException("Timed out", "TimeoutError"),
    );
    const response = await request("/api/questions/check", "POST", {
      question: "一个问题",
    });
    expect(response.status).toBe(504);
    expect(timer).toHaveBeenCalledWith(15000);
    expect(await count()).toBe(0);
  });

  it("recommends pending and answered questions without exposing hidden questions", async () => {
    const mock = normalModel();
    const publicItem = await submit("最近有什么适合反复读的书？");
    const pendingItem = await submit("你能推荐几本书吗？");
    const archivedItem = await submit("有什么值得读的书？");
    const cookie = await login();
    await publish(publicItem.id, cookie);
    await publish(archivedItem.id, cookie);
    await request(
      `/api/admin/questions/${archivedItem.id}`,
      "PATCH",
      { action: "archive" },
      cookie,
    );
    const result = await check("能推荐一些值得慢慢阅读的书籍吗？");
    expect(new Set(result.similar.map((item) => item.id))).toEqual(new Set([publicItem.id, pendingItem.id]));
    expect(
      result.similar.some(
        (item) => item.id === archivedItem.id,
      ),
    ).toBe(false);
    const lastCall = JSON.parse(String(mock.mock.calls.at(-1)![1]!.body));
    expect(lastCall.thinking.type).toBe("disabled");
    expect(lastCall.response_format.type).toBe("json_object");
    expect(searchTokens("反复阅读这本书")).toContain("阅读");
  });

  it("rejects invented model IDs and does not create a question", async () => {
    normalModel();
    const item = await submit();
    await publish(item.id, await login());
    vi.restoreAllMocks();
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      ++calls === 1
        ? modelResponse({
            spam: false,
            reason: "正常",
            search_terms: ["反复", "读书"],
          })
        : modelResponse({ ids: ["invented"] }),
    );
    const response = await request("/api/questions/check", "POST", {
      question: "推荐反复读的书",
    });
    expect(response.status).toBe(502);
    expect(await count()).toBe(1);
  });
});

describe("administrator and marks", () => {
  it("requires administrator login and validates settings", async () => {
    expect((await request("/api/admin/questions")).status).toBe(401);
    expect(
      (await request("/api/admin/settings", "PUT", { daily_limit: 3 })).status,
    ).toBe(401);
    expect(
      (await request("/api/login", "POST", { password: "incorrect" })).status,
    ).toBe(401);
    const cookie = await login();
    expect(
      (await request("/api/admin/settings", "PUT", { daily_limit: 0 }, cookie))
        .status,
    ).toBe(400);
    expect(
      (await request("/api/admin/settings", "PUT", { daily_limit: 3 }, cookie))
        .status,
    ).toBe(200);
    expect(
      await (
        await request("/api/admin/settings", "GET", undefined, cookie)
      ).json(),
    ).toEqual({ daily_limit: 3 });
    expect(
      await (await request("/admin", "GET", undefined, cookie)).text(),
    ).toContain("收件箱");
    expect(
      (await request("/api/logout", "POST")).headers.get("Set-Cookie"),
    ).toContain("Max-Age=0");
  });

  it("keeps repeated Mark operations idempotent and allows cancellation", async () => {
    normalModel();
    const item = await submit();
    const visitor = crypto.randomUUID();
    const body = { visitor_id: visitor, active: true };
    expect(
      (await request(`/api/questions/${item.id}/mark`, "PUT", body)).status,
    ).toBe(200);
    await Promise.all(
      Array.from({ length: 4 }, () =>
        request(`/api/questions/${item.id}/mark`, "PUT", body),
      ),
    );
    expect(
      (await json(await request(`/api/questions/${item.id}/mark`, "PUT", body)))
        .votes,
    ).toBe(1);
    expect(
      (
        await json(
          await request(`/api/questions/${item.id}/mark`, "PUT", {
            ...body,
            active: false,
          }),
        )
      ).votes,
    ).toBe(0);
    expect(
      (
        await json(
          await request(`/api/questions/${item.id}/mark`, "PUT", {
            ...body,
            active: false,
          }),
        )
      ).votes,
    ).toBe(0);
  });

  it("allows removing a hidden Mark but refuses adding one", async () => {
    normalModel();
    const item = await submit();
    const visitor = { visitor_id: crypto.randomUUID(), active: true };
    await request(`/api/questions/${item.id}/mark`, "PUT", visitor);
    await request(`/api/admin/questions/${item.id}`, "PATCH", { action: "hide" }, await login());
    expect((await request(`/api/questions/${item.id}/mark`, "PUT", visitor)).status).toBe(404);
    const removed = await request(`/api/questions/${item.id}/mark`, "PUT", { ...visitor, active: false });
    expect(removed.status).toBe(200);
    expect((await json(removed)).votes).toBe(0);
  });

  it("keeps publication and search state consistent when publish and archive race", async () => {
    normalModel();
    const item = await submit();
    const cookie = await login();
    await Promise.all([
      request(
        `/api/admin/questions/${item.id}`,
        "PATCH",
        { action: "publish", answer: "一个回答" },
        cookie,
      ),
      request(
        `/api/admin/questions/${item.id}`,
        "PATCH",
        { action: "archive" },
        cookie,
      ),
    ]);
    const status = await env.DB.prepare(
      "SELECT status FROM questions WHERE id=?",
    )
      .bind(item.id)
      .first("status");
    const indexed = await env.DB.prepare(
      "SELECT count(*) FROM question_search WHERE question_id=?",
    )
      .bind(item.id)
      .first("count(*)");
    expect(indexed).toBe(status === "answered" ? 1 : 0);
    expect(await env.DB.prepare('SELECT count(*) FROM hidden_question_search WHERE question_id=?').bind(item.id).first('count(*)')).toBe(status === 'archived' ? 1 : 0);
  });
});

describe('hidden-question policy and deletion', () => {
  it('blocks hidden duplicates and semantic matches without exposing their text or consuming quota', async () => {
    normalModel(true);
    const item = await submit('最近有什么值得反复读的书？');
    const cookie = await login();
    expect((await request(`/api/admin/questions/${item.id}`, 'PATCH', {action:'hide'}, cookie)).status).toBe(200);
    expect((await request(`/api/questions/${item.id}`)).status).toBe(404);
    for (const question of ['最近有什么值得反复读的书？', '能推荐适合多次阅读的书籍吗？']) {
      const response = await request('/api/questions/check', 'POST', {question});
      expect(response.status).toBe(422);
      const text = await response.text();
      expect(text).toContain('hidden_question');
      expect(text).not.toContain(item.id);
      expect(text).not.toContain('最近有什么值得反复读的书');
    }
    expect(await count()).toBe(1);
    expect((await request(`/api/admin/questions/${item.id}`, 'PATCH', {action:'restore'}, cookie)).status).toBe(200);
    expect((await request(`/api/questions/${item.id}`)).status).toBe(200);
    await check('能推荐适合多次阅读的书籍吗？');
  });

  it('rechecks a previously approved submission after the administrator hides a similar question', async () => {
    normalModel(true);
    const item = await submit('最近有什么值得反复读的书？');
    const checked = await check('推荐一些值得反复阅读的书籍');
    await request(`/api/admin/questions/${item.id}`, 'PATCH', {action:'hide'}, await login());
    const response = await request('/api/questions', 'POST', checked);
    expect(response.status).toBe(422);
    expect((await json(response)).error.code).toBe('hidden_question');
    expect(await count()).toBe(1);
  });

  it('rejects a submission when hidden policy changes during its final AI check', async () => {
    const model = normalModel();
    const music = await submit('你会推荐什么音乐？');
    const reading = await submit('怎样安排读书的时间？');
    const checked = await check('有什么值得反复读的书？');
    const cookie = await login();
    await request(`/api/admin/questions/${music.id}`, 'PATCH', {action:'hide'}, cookie);
    let entered!: () => void;
    let release!: () => void;
    const matching = new Promise<void>(resolve => { entered = resolve; });
    const paused = new Promise<void>(resolve => { release = resolve; });
    model.mockImplementation(async (_url, options) => {
      const input = JSON.parse(JSON.parse(String(options?.body)).messages[1].content);
      expect(input.scope).toBe('hidden');
      entered(); await paused;
      return modelResponse({ids:[]});
    });
    const saving = request('/api/questions', 'POST', checked);
    await matching;
    await request(`/api/admin/questions/${reading.id}`, 'PATCH', {action:'hide'}, cookie);
    release();
    const response = await saving;
    expect(response.status).toBe(409);
    expect((await json(response)).error.code).toBe('hidden_policy_changed');
    expect(await count()).toBe(2);
  });

  it('clears deleted content and indexes, removes it from management, and keeps its quota charge', async () => {
    normalModel(true);
    const item = await submit('最近有什么值得反复读的书？');
    const cookie = await login();
    await request(`/api/admin/questions/${item.id}`, 'PATCH', {action:'hide'}, cookie);
    expect((await request('/api/admin/questions/bulk-delete', 'POST', {ids:[item.id]}, cookie)).status).toBe(200);
    const stored = await env.DB.prepare('SELECT question,answer,search_tokens,deleted_at FROM questions WHERE id=?').bind(item.id).first();
    expect(stored?.question).toBe(''); expect(stored?.answer).toBeNull(); expect(stored?.search_tokens).toBe(''); expect(stored?.deleted_at).toBeTruthy();
    expect((await request(`/api/questions/${item.id}`)).status).toBe(404);
    expect((await request('/api/submissions/status', 'POST', item)).status).toBe(404);
    expect((await json(await request('/api/admin/questions?status=archived', 'GET', undefined, cookie))).items).toHaveLength(0);
    expect((await request(`/api/admin/questions/${item.id}`, 'PATCH', {action:'restore'}, cookie)).status).toBe(404);
    expect((await request(`/api/admin/questions/${item.id}`, 'PATCH', {action:'publish',answer:'不能恢复'}, cookie)).status).toBe(404);
    expect(await env.DB.prepare('SELECT count(*) FROM hidden_question_search').first('count(*)')).toBe(0);
    await check('最近有什么值得反复读的书？');
    await env.DB.prepare("UPDATE settings SET value='1' WHERE key='daily_limit'").run();
    expect((await request('/api/questions/check', 'POST', {question:'新的问题'})).status).toBe(429);
    expect(await count()).toBe(1);
  });

  it('deletes a selection atomically, clears marks and records each administrator action', async () => {
    normalModel();
    const first = await submit('最近有什么值得反复读的书？');
    const second = await submit('周末可以读什么书？');
    const kept = await submit('你喜欢什么音乐？');
    const cookie = await login();
    await request(`/api/questions/${first.id}/mark`, 'PUT', {visitor_id:crypto.randomUUID(), active:true});
    await request(`/api/admin/questions/${second.id}`, 'PATCH', {action:'hide'}, cookie);
    expect((await request('/api/admin/questions/bulk-delete', 'POST', {ids:[first.id, second.id]})).status).toBe(401);
    for (const ids of [[], [null], Array(101).fill(first.id)]) {
      expect((await request('/api/admin/questions/bulk-delete', 'POST', {ids}, cookie)).status).toBe(400);
    }
    expect((await request('/api/admin/questions/bulk-delete', 'POST', {ids:[first.id, 'missing']}, cookie)).status).toBe(404);
    expect((await request(`/api/questions/${first.id}`)).status).toBe(200);
    expect((await request(`/api/admin/questions/${first.id}`, 'PATCH', {action:'delete'}, cookie)).status).toBe(400);
    const response = await request('/api/admin/questions/bulk-delete', 'POST', {ids:[first.id, second.id, first.id]}, cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ok:true, deleted:2});
    for (const id of [first.id, second.id]) {
      expect((await request(`/api/questions/${id}`)).status).toBe(404);
      expect(await env.DB.prepare("SELECT count(*) FROM admin_actions WHERE question_id=? AND action='delete'").bind(id).first('count(*)')).toBe(1);
    }
    expect(await env.DB.prepare('SELECT count(*) FROM votes').first('count(*)')).toBe(0);
    expect((await request(`/api/questions/${kept.id}`)).status).toBe(200);
    expect(await count()).toBe(3);
  });

  it('does not resurrect deleted questions when a reply races deletion', async () => {
    normalModel(); const item = await submit(); const cookie = await login();
    await Promise.all([
      request(`/api/admin/questions/${item.id}`, 'PATCH', {action:'publish',answer:'回复'}, cookie),
      request('/api/admin/questions/bulk-delete', 'POST', {ids:[item.id]}, cookie),
    ]);
    expect((await request(`/api/questions/${item.id}`)).status).toBe(404);
    expect(await env.DB.prepare('SELECT question FROM questions WHERE id=?').bind(item.id).first('question')).toBe('');
    expect(await env.DB.prepare('SELECT count(*) FROM question_search').first('count(*)')).toBe(0);
    expect(await env.DB.prepare('SELECT count(*) FROM hidden_question_search').first('count(*)')).toBe(0);
  });

  it('indexes pre-existing unanswered and hidden questions during migration', async () => {
    await reset();
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0,1));
    for (const [id,status] of [['legacy-pending','pending'],['legacy-hidden','archived']]) {
      await env.DB.prepare(`INSERT INTO questions(id,question,status,ip_hash,quota_day,receipt_hash,created_at,updated_at,request_id)
        VALUES(?,'如何安排读书时间？',?,'ip','2026-11-02','receipt','now','now','test')`).bind(id,status).run();
    }
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    expect((await json(await request('/api/questions?search=读书'))).items.map(item=>item.id)).toEqual(['legacy-pending']);
    expect(await env.DB.prepare("SELECT count(*) FROM hidden_question_search WHERE hidden_question_search MATCH '读书'").first('count(*)')).toBe(1);
  });
});
