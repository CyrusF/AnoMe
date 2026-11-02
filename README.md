# AnoMe v2026

只由站长回复的匿名提问盒子，运行在 Cloudflare Workers，使用 D1 保存数据。

线上地址：<https://ask.excited.cloud> · 管理入口：<https://ask.excited.cloud/admin>

## 功能

- 匿名提问，DeepSeek 过滤 spam；提交成功后立即公开，显示待回复；管理员可回复或隐藏。
- 提交前推荐最多 3 条相似公开问答，可查看、Mark 或继续提交。与已隐藏问题重复或近义的提问会被拒绝。
- 每个 IP 默认每天可成功提问 5 次，按新加坡时间零点重置，管理员可修改限额。
- “我的提问”和 Mark 列表保存在当前浏览器的 localStorage。Mark 同时计入服务器人数，可取消；原有同问和收藏在首次访问时合并去重。清理浏览器数据会删除本地记录。
- 独立问答链接、搜索、最新提问／最多 Mark排序、每页 12 条分页。
- 单栏管理收件箱、编辑回复、隐藏、恢复公开、勾选批量删除与限额设置。不提供逐条删除按钮或接口。

## 本地开发

使用 Node.js 24 和 Python 3。

```sh
npm ci
cp .dev.vars.example .dev.vars
```

在 `.dev.vars` 填写 DeepSeek API Key 和管理员密码。下面的命令会生成应用密钥并直接追加到文件中：

```sh
node --input-type=module -e "import{appendFileSync}from'node:fs';import{randomBytes}from'node:crypto';appendFileSync('.dev.vars','\nAPP_SECRET='+randomBytes(32).toString('hex')+'\n')"
npm run types -- --env-interface CloudflareBindings
npm run db:local
npm run dev
```

打开 <http://localhost:8787>。本地数据库在 `.wrangler/`，与生产数据库独立。修改前端后运行 `npm run build` 并刷新浏览器；Worker 由 Wrangler 自动重载。

## 部署与配置

`wrangler.jsonc` 保存账户、Worker、D1、域名、模型名和日志配置。

| 配置               | 用途                                        |
| ------------------ | ------------------------------------------- |
| `DEEPSEEK_MODEL`   | 默认 `deepseek-flash`，非敏感配置           |
| `DEEPSEEK_API_KEY` | Worker Secret，DeepSeek 官方 API 密钥       |
| `ADMIN_PASSWORD`   | Worker Secret，管理员密码                   |
| `APP_SECRET`       | Worker Secret，签名和 IP 摘要密钥，保持稳定 |
| `daily_limit`      | D1 设置，默认 5；管理页可改为 1–100         |

```sh
npx wrangler whoami
npm run db:remote
npm run deploy
npm run secrets
```

`npm run secrets` 从 `.dev.vars` 读取三项密钥，经标准输入上传到当前 Worker，不在参数或日志中输出密钥。单独修改密码可使用交互命令 `npx wrangler secret put ADMIN_PASSWORD`。

后续代码发布运行 `npm run deploy`；有新迁移时先运行 `npm run db:remote`。发布后检查 `/api/health`、首页和日志。代码回退使用 `npx wrangler rollback`；数据库迁移单独管理。

## 核心规则与数据

预检查不保存问题。DeepSeek 先判断 spam 并提取搜索词，D1 FTS5 分别召回最多 30 个隐藏候选和 30 个公开候选；隐藏候选命中相同核心问题时拒绝提问，公开候选由模型选择最多 3 个推荐。完全相同的隐藏问题直接拒绝；隐藏内容不会返回给访客。模型只能返回候选中的 ID，真实链接由服务端生成。中文词语和相邻汉字组合写入检索索引。

每次模型调用最多 15 秒，关闭思考模式并要求 JSON。上游错误、超时、空白、不完整或无效输出均明确报错，不保存问题，不自动切换模型或重试。广告引流、乱码、明显灌水属于 spam；普通批评和重复提问不会仅因此被拒绝。

预检查通过后返回 10 分钟有效的签名凭据，绑定问题内容和 IP。正式提交以单条条件 INSERT 再次检查额度并入库；同一检查 ID 重试返回原问题和相同查询凭据，不重复扣额度。IP 仅保存带密钥摘要。

状态为 `pending`（公开待回复）、`answered`（公开已回复）、`archived`（隐藏）。前两者可进入公开列表、详情、搜索和相似推荐。数据库触发器同步公开与隐藏检索索引，隐藏集合变化时递增 `hidden_revision`；正式提交重新核对检查凭据的版本，必要时重新检查隐藏相似项，条件 INSERT 防止检查期间的隐藏变动被绕过。

发布、隐藏、恢复和批量删除在 D1 batch 事务中记录管理员操作。批量删除清空问题、回复与检索内容并移除 Mark 计数；只保留不可恢复的额度记账记录，不退回当天次数，也不会因延迟回复而恢复。删除隐藏问题后，该问题不再用于拦截。

| 表                | 内容与索引                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `questions`       | 问答、状态、时间、IP／查询凭据摘要和请求编号；`(ip_hash,quota_day)` 用于额度，`(status,answered_at,id)` 用于列表 |
| `votes`           | 浏览器 Mark（沿用原表名）；主键 `(question_id,visitor_id)` 保证幂等                                                             |
| `settings`        | 每日提问限额、隐藏策略版本                                                                                       |
| `admin_actions`   | 管理操作、原状态、请求编号和时间                                                                                 |
| `question_search` | 公开的待回复与已回复问题 FTS5 索引 |
| `hidden_question_search` | 隐藏且未删除问题的 FTS5 索引 |

提问限长 1000 个 Unicode 字符，回复限长 10000；均按纯文本显示。AI 异常、拦截、预检查、Mark 不消耗提问额度。

## 接口

| 接口                                     | 输入／用途                                          |
| ---------------------------------------- | --------------------------------------------------- |
| `GET /api/questions?search=&sort=latest\|popular&page=1`                                     | 公开列表                 |
| `GET /api/questions/:id`                 | 公开详情                                            |
| `POST /api/questions/check`              | `{question}` → `{token,similar,remaining}`          |
| `POST /api/questions`                    | `{question,token}` → `{id,receipt}`                 |
| `POST /api/submissions/status`           | `{id,receipt}` 查询自己的状态                       |
| `PUT /api/questions/:id/mark`            | `{visitor_id,active}` 设置 Mark 状态（旧 `/vote` 路径保留兼容）                  |
| `POST /api/login` / `POST /api/logout`   | `{password}` 登录／退出                             |
| `GET /api/admin/questions?status=pending\|answered\|archived&search=&page=1` | 管理列表 |
| `PATCH /api/admin/questions/:id`         | `{action:"publish",answer}`、`{action:"hide"}` 或 `{action:"restore"}` |
| `POST /api/admin/questions/bulk-delete` | `{ids:[...]}`，一次 1–100 个，清除内容及 Mark |
| `GET/PUT /api/admin/settings`            | 读取／修改 `{daily_limit}`                          |
| `GET /api/health`                        | Worker 与 D1 健康检查                               |

## 验证与排查

```sh
npm run check
npm test
npm run verify:state
npm run verify:mutations
npm run build
```

接口测试在本地 Workers 运行时和独立 D1 中模拟 DeepSeek，不调用真实模型或生产数据。覆盖并发限额、重试、跨日、隐藏、批量删除、Mark、公开隔离、中文检索、模型异常和管理员操作。

状态检查直接执行 `src/sql.ts` 的生产 SQL，穷举 1 个 IP、3 个提交 ID、2 天、每天限额 2 的所有可达写入顺序：986 个状态、12,805 次转换。验证隐藏策略变化、删除后内容清除、延迟回复不恢复、额度及检索一致性；8 种故意破坏的 SQL／索引都能产生反例。该结果只覆盖设定范围和 SQLite 原子写入假设，不是整个系统或任意规模的证明。覆盖与同步记录见 `.agents/skills/verify-submission-state/SKILL.md`。

响应包含 `X-Request-ID`；错误正文包含 `request_id`。Workers Logs 全量采样，可按请求编号追踪请求、数据库、模型调用、候选 ID 和管理员操作。

```sh
npx wrangler tail anome-v2026 --format json
```

排查 `request_error`、`model_error`、`moderation`、`database`、`admin_action`、`admin_bulk_delete`、`mark`、`hidden_question_blocked` 事件。模型日志记录阶段、耗时、模型请求编号和 token 用量，不输出密钥、原始 IP 或完整请求头。

旧版 Flask 代码和历史示例数据库保留在 `main` 分支；`v2026` 从空 D1 开始。沿用原项目 GPL-3.0，见 [LICENSE](LICENSE)。
