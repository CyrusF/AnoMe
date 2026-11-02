import type { Question } from "./domain";

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
const svg = (paths: string) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
export const icons = {
  search: svg(
    '<circle cx="10.8" cy="10.8" r="7.3"/><path d="m16.1 16.1 4.5 4.5"/>',
  ),
  vote: svg(
    '<path d="M21 11.4a8.5 8.5 0 0 1-8.6 8.3 9.6 9.6 0 0 1-4-.9L3 21l1.7-5a8 8 0 0 1-1.3-4.4A8.6 8.6 0 0 1 12 3a8.5 8.5 0 0 1 9 8.4Z"/>',
  ),
  bookmark: svg(
    '<path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4Z"/>',
  ),
  link: svg(
    '<path d="m10 13 4-4m-6.4 6.4-1.2 1.2a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0m3.2 1 1.2-1.2a3.5 3.5 0 1 1 5 5l-4 4a3.5 3.5 0 0 1-5 0" transform="translate(1 0)"/>',
  ),
  chevron: svg('<path d="m6 9 6 6 6-6"/>'),
  arrow: svg('<path d="m9 5 7 7-7 7"/>'),
  back: svg('<path d="m14 6-6 6 6 6"/>'),
  external: svg('<path d="M14 3h7v7m0-7L10 14m10 0v6H4V4h6"/>'),
  logout: svg('<path d="M9 3H4v18h5m6-14 5 5-5 5m-7-5h12"/>'),
};
export function dateLabel(value: string, time = false): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Singapore",
    month: "long",
    day: "numeric",
    ...(time
      ? ({ hour: "2-digit", minute: "2-digit", hour12: false } as const)
      : {}),
  }).format(new Date(value));
}
export function questionActions(
  question: Pick<Question, "id" | "votes">,
): string {
  const id = escapeHtml(question.id);
  return `<div class="question-actions">
    <button type="button" class="pill small" data-action="vote" data-id="${id}" aria-pressed="false">${icons.vote}<span>同问 <span data-count="${id}">${question.votes}</span></span></button>
    <button type="button" class="pill small" data-action="save" data-id="${id}" aria-pressed="false">${icons.bookmark}<span data-save-label>收藏</span></button>
    <button type="button" class="pill small" data-action="copy" data-id="${id}">${icons.link}<span>复制链接</span></button>
  </div>`;
}
export function renderQuestion(question: Question, detail = false): string {
  const title = escapeHtml(question.question);
  return `<article class="question-card" data-question="${escapeHtml(question.id)}">
    <${detail ? "h1" : "h3"} class="question-title">${detail ? title : `<a href="/q/${encodeURIComponent(question.id)}">${title}</a>`}</${detail ? "h1" : "h3"}>
    <p class="answer">${escapeHtml(question.answer ?? "")}</p>
    <footer class="question-footer"><time datetime="${escapeHtml(question.answered_at ?? question.created_at)}">${dateLabel(question.answered_at ?? question.created_at)}</time>${questionActions(question)}</footer>
  </article>`;
}
export function page(
  title: string,
  content: string,
  current = "",
  admin = false,
): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} · AnoMe</title><meta name="description" content="匿名提问，由我回复。"><meta name="theme-color" content="#ecf2f7">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='12' fill='%23ecf2f7'/%3E%3Ctext x='10' y='29' font-family='sans-serif' font-size='28' fill='%2327384a'%3EA%3C/text%3E%3C/svg%3E">
  <link rel="stylesheet" href="/assets/app.css"><script type="module" src="/assets/app.js"></script></head>
  <body data-page="${current}"><a class="skip-link" href="#main">跳到内容</a><header class="site-header">
    <a class="brand" href="/">AnoMe</a>${admin ? `<span class="header-divider"></span><span class="admin-label">管理</span><nav class="admin-header-nav"><a href="/" aria-label="返回前台">${icons.external}<span>返回前台</span></a><button type="button" class="text-button" data-action="logout" aria-label="退出登录">${icons.logout}<span>退出登录</span></button></nav>` : `<nav class="public-nav" aria-label="主导航"><a href="/" ${current === "home" || current === "question" ? 'aria-current="page"' : ""}>公开问答</a><a href="/my" ${current === "my" ? 'aria-current="page"' : ""}>我的提问</a><a href="/saved" ${current === "saved" ? 'aria-current="page"' : ""}>收藏</a></nav><a class="manage-link" href="/admin">管理</a>`}
  </header><main class="shell" id="main">${content}</main><footer class="site-footer">AnoMe</footer><div id="toast" class="toast" role="status" hidden></div></body></html>`;
}
export function home(limit: number): string {
  return `<section class="hero"><h1>想问什么，尽管说。</h1><p>匿名提问，由我回复。</p></section>
    <section class="surface ask-surface"><form id="ask-form"><label class="field-label" for="question">你的问题</label>
      <textarea id="question" name="question" rows="4" maxlength="2000" placeholder="有什么想问我的？" required></textarea>
      <div class="quota-note">每个 IP 每天最多提交 ${limit} 个问题。</div>
      <div id="ask-message" class="form-message" role="status" hidden></div><div id="similar" hidden></div>
      <div id="initial-submit" class="submit-row"><button type="submit" id="submit-question" class="primary pill">提交问题</button></div>
    </form></section>
    <section class="public-section" aria-labelledby="public-title"><h2 id="public-title">公开问答</h2>
      ${searchInput("public-search", "搜索问答")}<div class="tabs sort-tabs" role="group" aria-label="问答排序"><button type="button" class="pill selected" data-sort="latest" aria-pressed="true">最新回复</button><button type="button" class="pill" data-sort="popular" aria-pressed="false">最多同问</button></div>
      <div id="question-list" aria-live="polite"><p class="empty-state">正在加载问答…</p></div>${pagination()}
    </section>`;
}
export function searchInput(id: string, placeholder: string): string {
  return `<div class="search-field">${icons.search}<input id="${id}" type="search" placeholder="${placeholder}" aria-label="${placeholder}" autocomplete="off"></div>`;
}
export function pagination(): string {
  return `<nav id="pagination" class="pagination" aria-label="分页" hidden><button type="button" class="pill" data-page-direction="-1">上一页</button><span id="page-number"></span><button type="button" class="pill" data-page-direction="1">下一页</button></nav>`;
}
export function collection(kind: "my" | "saved"): string {
  return `<section class="hero compact"><h1>${kind === "my" ? "我的提问" : "收藏"}</h1><p>${kind === "my" ? "留在这里，等一个回答。" : "把想再读一遍的回答，留在这里。"}</p></section>
    <p class="collection-note">仅保存在当前浏览器中。</p><div id="question-list" aria-live="polite"></div>${pagination()}`;
}
export function questionPage(question: Question): string {
  return `<a href="/" class="back-link">${icons.back}所有公开问答</a>${renderQuestion(question, true)}`;
}
export function loginPage(): string {
  return `<section class="hero compact"><h1>管理登录</h1><p>把问题打开，认真回答。</p></section><section class="surface login-surface"><form id="login-form"><label class="field-label" for="password">管理员密码</label><input id="password" type="password" autocomplete="current-password" required><div id="login-message" class="form-message" role="status" hidden></div><div class="submit-row"><button type="submit" class="primary pill">登录</button></div></form></section>`;
}
export function adminPage(): string {
  return `<section class="hero admin-hero"><h1 id="admin-title">收件箱</h1><p id="admin-subtitle">选择一个问题，写下你的回复。</p></section>
  <nav class="tabs admin-tabs" aria-label="管理导航"><button class="pill selected" type="button" data-admin-tab="pending" aria-pressed="true">收件箱</button><button class="pill" type="button" data-admin-tab="answered" aria-pressed="false">已回复</button><button class="pill" type="button" data-admin-tab="archived" aria-pressed="false">已归档</button><button class="pill" type="button" data-admin-tab="settings" aria-pressed="false">设置</button></nav>
  <div id="admin-search-wrap">${searchInput("admin-search", "搜索问题")}</div><div id="admin-message" class="form-message" role="status" hidden></div>
  <div id="question-list" class="admin-list" aria-live="polite"></div>${pagination()}
  <section id="settings-panel" class="surface" hidden><form id="settings-form"><label class="field-label" for="daily-limit">每个 IP 每天的提问限额</label><input type="number" id="daily-limit" min="1" max="100" required><p class="help">每天按新加坡时间零点重置。已提交的问题不会因归档而退回额度。</p><div class="submit-row"><button type="submit" class="primary pill">保存设置</button></div></form></section>`;
}
export function messagePage(message: string, requestId?: string): string {
  return `<section class="surface message-surface"><h1>${escapeHtml(message)}</h1>${requestId ? `<p class="help">请求编号：${escapeHtml(requestId)}</p>` : ""}<a class="pill" href="/">返回首页</a></section>`;
}
