import "./style.css";
import type { Question } from "../src/domain";
import {
  dateLabel,
  escapeHtml as esc,
  icons,
  questionActions,
  renderQuestion,
} from "../src/views";

interface ListResult {
  items: Question[];
  page: number;
  has_more: boolean;
}
interface CheckResult {
  token: string;
  similar: Question[];
  remaining: number;
}
interface Submission {
  id: string;
  receipt: string;
  created_at: string;
}
const currentPage = document.body.dataset.page;
const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public requestId?: string,
  ) {
    super(message);
  }
}
async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
  } catch {
    throw new ApiError("网络连接失败，请检查连接后重试。", "network_error");
  }
  const data = (await response.json()) as T & {
    error?: { message: string; code: string };
    request_id?: string;
  };
  if (!response.ok)
    throw new ApiError(
      data.error?.message ?? `请求失败（${response.status}）。`,
      data.error?.code ?? "request_error",
      data.request_id ?? response.headers.get("X-Request-ID") ?? undefined,
    );
  return data;
}
function errorText(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "操作失败，请稍后重试。";
  return (
    message +
    (error instanceof ApiError && error.requestId
      ? `\n请求编号：${error.requestId}`
      : "")
  );
}
let toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string) {
  const element = $("#toast");
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element.hidden = true;
  }, 5000);
}
function showMessage(selector: string, error: unknown, success = false) {
  const element = $(selector);
  element.textContent = typeof error === "string" ? error : errorText(error);
  element.classList.toggle("success", success);
  element.hidden = false;
}
function readStored<T>(key: string, initial: T): T {
  const value = localStorage.getItem(`anome.v2026.${key}`);
  if (value === null) return initial;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error("浏览器中的保存记录无法读取，请检查本地存储。");
  }
}
function writeStored(key: string, value: unknown) {
  localStorage.setItem(`anome.v2026.${key}`, JSON.stringify(value));
}
function markIds() {
  return readStored<string[]>("marks", []);
}
function visitorId() {
  let id = readStored<string>("visitor", "");
  if (!id) {
    id = crypto.randomUUID();
    writeStored("visitor", id);
  }
  return id;
}
async function migrateMarks() {
  if (localStorage.getItem("anome.v2026.marks") !== null) return;
  const votes = readStored<string[]>("votes", []);
  const saved = readStored<string[]>("saved", []);
  for (const id of saved.filter(id => !votes.includes(id))) {
    try {
      await api(`/api/questions/${encodeURIComponent(id)}/mark`, "PUT", {
        visitor_id: visitorId(), active: true,
      });
    } catch (error) {
      if (!(error instanceof ApiError && error.code === "not_public")) throw error;
    }
  }
  writeStored("marks", [...new Set([...saved, ...votes])]);
}
function syncActions() {
  const marks = new Set(markIds());
  document.querySelectorAll<HTMLButtonElement>('[data-action="mark"]').forEach(button => {
    const active = marks.has(button.dataset.id!);
    button.setAttribute("aria-pressed", String(active));
    button.querySelector("[data-mark-label]")!.textContent = active ? "已 Mark" : "Mark";
  });
}
function empty(title: string, note = "") {
  return `<div class="empty-state"><strong>${esc(title)}</strong>${note}</div>`;
}
let listPage = 1;
let hasMore = false;
let sort = "latest";
let adminTab = "pending";
let generation = 0;
let reloadList: () => Promise<void>;

function updatePagination() {
  const pagination = $("#pagination");
  if (!pagination) return;
  pagination.hidden = listPage === 1 && !hasMore;
  $("#page-number").textContent = `第 ${listPage} 页`;
  $<HTMLButtonElement>('[data-page-direction="-1"]').disabled = listPage <= 1;
  $<HTMLButtonElement>('[data-page-direction="1"]').disabled = !hasMore;
}
async function publicList() {
  const run = ++generation;
  const search = $<HTMLInputElement>("#public-search").value.trim();
  const result = await api<ListResult>(
    `/api/questions?${new URLSearchParams({ page: String(listPage), sort, search })}`,
  );
  if (run !== generation) return;
  hasMore = result.has_more;
  $("#question-list").innerHTML = result.items.length
    ? result.items.map((q) => renderQuestion(q)).join("")
    : empty(
        search ? "还没有找到相关问答" : "这里还很安静",
        search ? "换个关键词试试。" : "问一个问题，让对话从这里开始。",
      );
  syncActions();
  updatePagination();
}
async function collections() {
  const run = ++generation;
  const ids =
    currentPage === "my"
      ? readStored<Submission[]>("submissions", [])
      : markIds();
  hasMore = ids.length > listPage * 12;
  const selected = ids.slice((listPage - 1) * 12, listPage * 12);
  const results = await Promise.all(
    selected.map(async (item) => {
      try {
        const row =
          typeof item === "string"
            ? await api<Question>(`/api/questions/${encodeURIComponent(item)}`)
            : await api<Question>("/api/submissions/status", "POST", {
                id: item.id,
                receipt: item.receipt,
              });
        if (row.status !== "archived") return renderQuestion(row);
        return `<article class="question-card"><h3 class="question-title">${esc(row.question)}</h3><div class="submission-status"><span class="status-tag archived">已隐藏</span><time>${dateLabel(row.created_at)}</time></div></article>`;
      } catch (error) {
        if (
          error instanceof ApiError &&
          ["not_public", "not_found"].includes(error.code)
        ) {
          const id = typeof item === "string" ? item : item.id;
          return `<article class="question-card"><h3 class="question-title">这个问题已不可用</h3><p class="help">问题已被隐藏或删除。</p>${currentPage === "saved" ? `<button type="button" class="text-button" data-action="remove-mark" data-id="${esc(id)}">移除 Mark</button>` : ""}</article>`;
        }
        throw error;
      }
    }),
  );
  if (run !== generation) return;
  $("#question-list").innerHTML = results.length
    ? results.join("")
    : empty(
        currentPage === "my" ? "还没有留下提问" : "还没有 Mark 的问题",
        currentPage === "my"
          ? '<a href="/">去问一个问题</a>'
          : '<a href="/">去看看公开问答</a>',
      );
  syncActions();
  updatePagination();
}

let draft: { token: string; question: string } | undefined;
let submitting = false;
async function saveQuestion() {
  if (!draft) throw new Error("请先检查你的问题。");
  const result = await api<{ id: string; receipt: string }>(
    "/api/questions",
    "POST",
    draft,
  );
  const submissions = readStored<Submission[]>("submissions", []);
  if (!submissions.some((item) => item.id === result.id))
    writeStored("submissions", [
      { ...result, created_at: new Date().toISOString() },
      ...submissions,
    ]);
  draft = undefined;
  $<HTMLTextAreaElement>("#question").value = "";
  $("#similar").hidden = true;
  $("#initial-submit").hidden = false;
  const message = $("#ask-message");
  message.innerHTML =
    `问题已公开，等待回复。<a href="/q/${encodeURIComponent(result.id)}">查看问题</a>`;
  message.classList.add("success");
  message.hidden = false;
  listPage = 1;
  void publicList().catch(error => toast(errorText(error)));
}
function showSimilar(items: Question[]) {
  $("#initial-submit").hidden = true;
  const element = $("#similar");
  element.innerHTML = `<section class="similar-box"><h2>这些问题，也许与你想问的相似</h2>${items.map((q) => `<article class="similar-item"><h3>${esc(q.question)}</h3><div class="similar-tools"><a class="similar-link" href="/q/${encodeURIComponent(q.id)}" target="_blank" rel="noopener">${q.status === 'pending' ? '查看问题' : '查看回答'} ${icons.arrow}</a>${questionActions(q)}</div></article>`).join("")}<div class="similar-footer"><p>仍然想提问？可以继续提交。</p><div class="submit-row"><button type="button" class="primary pill" data-action="continue">继续提交</button><button type="button" class="text-button" data-action="revise">返回修改</button></div></div></section>`;
  element.hidden = false;
  syncActions();
}
function resetCheck() {
  draft = undefined;
  $("#similar").hidden = true;
  $("#initial-submit").hidden = false;
}
async function submitQuestion(check: boolean) {
  if (submitting) return;
  const textarea = $<HTMLTextAreaElement>("#question");
  const button = $<HTMLButtonElement>("#submit-question");
  const continueButton = document.querySelector<HTMLButtonElement>(
    '[data-action="continue"]',
  );
  if (!textarea.value.trim()) {
    textarea.reportValidity();
    return;
  }
  if (Array.from(textarea.value.trim()).length > 1000) {
    showMessage("#ask-message", "问题需要在 1–1000 字之间。");
    return;
  }
  submitting = true;
  textarea.disabled = true;
  button.disabled = true;
  if (continueButton) {
    continueButton.disabled = true;
    continueButton.textContent = "正在提交…";
  }
  $("#ask-message").hidden = true;
  try {
    if (check && (!draft || draft.question !== textarea.value.trim())) {
      button.textContent = "正在检查…";
      const question = textarea.value.trim();
      const result = await api<CheckResult>("/api/questions/check", "POST", {
        question,
      });
      draft = { token: result.token, question };
      if (result.similar.length) {
        showSimilar(result.similar);
        return;
      }
    }
    button.textContent = "正在提交…";
    await saveQuestion();
  } catch (error) {
    showMessage("#ask-message", error);
    if (
      error instanceof ApiError &&
      ["invalid_token", "check_required", "hidden_policy_changed", "hidden_question"].includes(error.code)
    )
      resetCheck();
  } finally {
    submitting = false;
    textarea.disabled = false;
    button.disabled = false;
    button.textContent = "提交问题";
    if (continueButton?.isConnected) {
      continueButton.disabled = false;
      continueButton.textContent = "继续提交";
    }
  }
}

function adminQuestion(question: Question, open: boolean): string {
  const archived = question.status === "archived";
  return `<article class="admin-row"><label class="bulk-selection question-selection"><input type="checkbox" data-select-question="${esc(question.id)}">选择问题</label><details class="admin-card" ${open ? "open" : ""} data-admin-question="${esc(question.id)}"><summary><span class="admin-meta">匿名提问 · ${dateLabel(question.created_at, true)}</span><span class="admin-question">${esc(question.question)}</span><span class="chevron">${icons.chevron}</span></summary>
    <form class="reply-form" data-id="${esc(question.id)}"><label class="field-label" for="answer-${esc(question.id)}">你的回复</label><textarea id="answer-${esc(question.id)}" name="answer" rows="6" required>${esc(question.answer ?? "")}</textarea><p class="help">${archived ? '问题已隐藏。发布回复会恢复公开。' : '问题已公开，回复会直接显示在问题下方。'}</p><div class="form-message" role="status" hidden></div><div class="submit-row admin-actions"><button type="submit" class="primary pill">${archived ? "回复并公开" : question.status === "answered" ? "保存回复" : "发布回复"}</button><button type="button" class="text-button" data-action="${archived ? 'restore' : 'hide'}" data-id="${esc(question.id)}">${archived ? '恢复公开' : '隐藏问题'}</button></div></form></details></article>`;
}
async function adminList() {
  const run = ++generation;
  const settings = adminTab === "settings";
  $("#settings-panel").hidden = !settings;
  $("#admin-search-wrap").hidden = settings;
  $("#question-list").hidden = settings;
  $("#bulk-toolbar").hidden = settings;
  selectedQuestions.clear();
  syncSelection();
  $("#admin-message").hidden = true;
  document
    .querySelectorAll<HTMLButtonElement>("[data-admin-tab]")
    .forEach((button) => {
      const selected = button.dataset.adminTab === adminTab;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  $("#admin-title").textContent = (
    {
      pending: "收件箱",
      answered: "已回复",
      archived: "已隐藏",
      settings: "设置",
    } as Record<string, string>
  )[adminTab];
  $("#admin-subtitle").textContent = settings
    ? "让提问保持适合你的节奏。"
    : adminTab === "pending"
      ? "选择一个问题，写下你的回复。"
      : adminTab === "answered"
        ? "回看已经发生的对话。"
        : "隐藏的问题不会公开，相似提问也会被拦截。";
  if (settings) {
    $("#pagination").hidden = true;
    const result = await api<{ daily_limit: number }>("/api/admin/settings");
    if (run === generation)
      $<HTMLInputElement>("#daily-limit").value = String(result.daily_limit);
    return;
  }
  const search = $<HTMLInputElement>("#admin-search").value.trim();
  const result = await api<ListResult>(
    `/api/admin/questions?${new URLSearchParams({ status: adminTab, page: String(listPage), search })}`,
  );
  if (run !== generation) return;
  hasMore = result.has_more;
  $("#question-list").innerHTML = result.items.length
    ? result.items
        .map((question, i) => adminQuestion(question, i === 0))
        .join("")
    : empty(
        search
          ? "没有找到相关问题"
          : adminTab === "pending"
            ? "暂时没有新问题"
            : "这里还没有问题",
      );
  updatePagination();
  syncSelection();
}
const selectedQuestions = new Set<string>();
function syncSelection() {
  const inputs = [...document.querySelectorAll<HTMLInputElement>("[data-select-question]")];
  inputs.forEach(input => { input.checked = selectedQuestions.has(input.dataset.selectQuestion!); });
  const all = $<HTMLInputElement>("#select-all");
  all.checked = inputs.length > 0 && selectedQuestions.size === inputs.length;
  all.indeterminate = selectedQuestions.size > 0 && selectedQuestions.size < inputs.length;
  all.disabled = inputs.length === 0;
  $("#selection-count").textContent = `已选 ${selectedQuestions.size} 个`;
  $<HTMLButtonElement>('[data-action="bulk-delete"]').disabled = selectedQuestions.size === 0;
}
function debounceSearch(selector: string, load: () => Promise<void>) {
  let timeout: ReturnType<typeof setTimeout>;
  $(selector).addEventListener("input", () => {
    clearTimeout(timeout);
    // Invalidate the previous query immediately, before the debounce fires.
    generation++;
    timeout = setTimeout(() => {
      listPage = 1;
      void load().catch((error) => toast(errorText(error)));
    }, 300);
  });
}

async function init() {
  if (["home", "my", "saved", "question"].includes(currentPage ?? "")) await migrateMarks();
  if (currentPage === "home") {
    reloadList = publicList;
    $("#ask-form").addEventListener("submit", (event) => {
      event.preventDefault();
      void submitQuestion(true);
    });
    $("#question").addEventListener("input", () => {
      resetCheck();
      $("#ask-message").hidden = true;
    });
    debounceSearch("#public-search", publicList);
    await publicList();
  } else if (currentPage === "my" || currentPage === "saved") {
    reloadList = collections;
    await collections();
  } else if (currentPage === "admin") {
    reloadList = adminList;
    document.addEventListener("change", event => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      if (input.id === "select-all") {
        document.querySelectorAll<HTMLInputElement>("[data-select-question]").forEach(item => {
          if (input.checked) selectedQuestions.add(item.dataset.selectQuestion!);
          else selectedQuestions.delete(item.dataset.selectQuestion!);
        });
      } else if (input.dataset.selectQuestion) {
        if (input.checked) selectedQuestions.add(input.dataset.selectQuestion);
        else selectedQuestions.delete(input.dataset.selectQuestion);
      } else return;
      syncSelection();
    });
    debounceSearch("#admin-search", adminList);
    $("#settings-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const button = $<HTMLButtonElement>("#settings-form button");
      button.disabled = true;
      void api("/api/admin/settings", "PUT", {
        daily_limit: Number($<HTMLInputElement>("#daily-limit").value),
      })
        .then(() => toast("设置已保存。"))
        .catch((error) => showMessage("#admin-message", error))
        .finally(() => {
          button.disabled = false;
        });
    });
    document.addEventListener(
      "toggle",
      (event) => {
        const details = event.target;
        if (
          details instanceof HTMLDetailsElement &&
          details.open &&
          details.classList.contains("admin-card")
        ) {
          document
            .querySelectorAll<HTMLDetailsElement>(".admin-card[open]")
            .forEach((other) => {
              if (other !== details) other.open = false;
            });
        }
      },
      true,
    );
    document.addEventListener("submit", (event) => {
      const form = event.target;
      if (
        !(form instanceof HTMLFormElement) ||
        !form.classList.contains("reply-form")
      )
        return;
      event.preventDefault();
      const button = form.querySelector<HTMLButtonElement>(
        "button[type=submit]",
      )!;
      const textarea = form.querySelector<HTMLTextAreaElement>("textarea")!;
      const message = form.querySelector<HTMLElement>(".form-message")!;
      button.disabled = true;
      message.hidden = true;
      void api(
        `/api/admin/questions/${encodeURIComponent(form.dataset.id!)}`,
        "PATCH",
        { action: "publish", answer: textarea.value },
      )
        .then(async () => {
          toast("回复已发布。");
          await adminList();
        })
        .catch((error) => {
          message.textContent = errorText(error);
          message.hidden = false;
        })
        .finally(() => {
          button.disabled = false;
        });
    });
    await adminList();
  } else if (currentPage === "login") {
    $("#login-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const button = $<HTMLButtonElement>("#login-form button");
      button.disabled = true;
      $("#login-message").hidden = true;
      void api("/api/login", "POST", {
        password: $<HTMLInputElement>("#password").value,
      })
        .then(() => {
          location.href = "/admin";
        })
        .catch((error) => showMessage("#login-message", error))
        .finally(() => {
          button.disabled = false;
        });
    });
  }
  syncActions();
}

document.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button");
  if (!button || button.disabled) return;
  void (async () => {
    if (button.dataset.sort) {
      sort = button.dataset.sort;
      listPage = 1;
      document
        .querySelectorAll<HTMLButtonElement>("[data-sort]")
        .forEach((item) => {
          const active = item === button;
          item.classList.toggle("selected", active);
          item.setAttribute("aria-pressed", String(active));
        });
      await publicList();
      return;
    }
    if (button.dataset.adminTab) {
      adminTab = button.dataset.adminTab;
      listPage = 1;
      await adminList();
      return;
    }
    if (button.dataset.pageDirection) {
      listPage += Number(button.dataset.pageDirection);
      await reloadList();
      return;
    }
    const id = button.dataset.id!;
    const action = button.dataset.action;
    if (action === "remove-mark") {
      await api(`/api/questions/${encodeURIComponent(id)}/mark`, "PUT", {
        visitor_id: visitorId(), active: false,
      }).catch(error => {
        if (!(error instanceof ApiError && error.code === "not_public")) throw error;
      });
      writeStored("marks", markIds().filter(item => item !== id));
      listPage = Math.min(listPage, Math.max(1, Math.ceil(markIds().length / 12)));
      await collections();
    } else if (action === "mark") {
      const related = [...document.querySelectorAll<HTMLButtonElement>('[data-action="mark"]')]
        .filter(item => item.dataset.id === id);
      related.forEach(item => { item.disabled = true; });
      try {
        const active = !markIds().includes(id);
        const result = await api<{ votes: number }>(`/api/questions/${encodeURIComponent(id)}/mark`, "PUT", {
          visitor_id: visitorId(), active,
        });
        // Read again after the request so simultaneous marks of different questions are retained.
        const ids = markIds();
        writeStored("marks", active ? [id, ...ids.filter(item => item !== id)] : ids.filter(item => item !== id));
        document.querySelectorAll<HTMLElement>("[data-count]").forEach(item => {
          if (item.dataset.count === id) item.textContent = String(result.votes);
        });
        syncActions();
        toast(active ? "已 Mark，可在 Mark 列表中查看。" : "已取消 Mark。");
        if (currentPage === "saved") {
          listPage = Math.min(listPage, Math.max(1, Math.ceil(markIds().length / 12)));
          await collections();
        }
      } finally {
        related.forEach(item => { item.disabled = false; });
      }
    } else if (action === "copy") {
      await navigator.clipboard.writeText(
        `${location.origin}/q/${encodeURIComponent(id)}`,
      );
      toast("链接已复制。");
    } else if (action === "continue") {
      await submitQuestion(false);
    } else if (action === "revise") {
      resetCheck();
      $<HTMLTextAreaElement>("#question").focus();
    } else if (action === "bulk-delete") {
      const ids = [...selectedQuestions];
      if (!ids.length || !confirm(`确认删除选中的 ${ids.length} 个问题？问题内容和回复将被清除，无法恢复。`)) return;
      button.disabled = true;
      try {
        const result = await api<{ deleted: number }>("/api/admin/questions/bulk-delete", "POST", { ids });
        toast(`已删除 ${result.deleted} 个问题。`);
        await adminList();
      } finally {
        syncSelection();
      }
    } else if (action && ['hide', 'restore'].includes(action)) {
      button.disabled = true;
      try {
        await api(`/api/admin/questions/${encodeURIComponent(id)}`, "PATCH", {
          action,
        });
        toast(({hide:'问题已隐藏，相似提问将被拦截。',restore:'问题已恢复公开。'} as Record<string,string>)[action]);
        await adminList();
      } finally {
        button.disabled = false;
      }
    } else if (action === "logout") {
      await api("/api/logout", "POST");
      location.href = "/admin";
    }
  })().catch((error) => toast(errorText(error)));
});

void init().catch((error) => {
  if (
    currentPage === "admin" &&
    error instanceof ApiError &&
    error.code === "not_authenticated"
  ) {
    location.href = "/admin";
    return;
  }
  const list = document.querySelector("#question-list");
  if (list)
    list.innerHTML = empty(
      "暂时无法加载",
      esc(errorText(error)).replaceAll("\n", "<br>"),
    );
  else toast(errorText(error));
});
