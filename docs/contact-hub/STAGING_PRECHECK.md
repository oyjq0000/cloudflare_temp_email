# Contact Hub Staging 发布前预检

预检基线：`contact-hub` / `3ed8d828a8e157ef354a3c6e0d7019ec7a18b5d1`

目标：验证 **Wrangler Named Environments + Single Worker Static Assets** 的 staging 发布准备度。本文不授权 production，也不包含任何 Secret 值。

## 1. 当前真实基线

- `origin/main`: `70206c61efa723ef24143eca1d27449ce98a6e0c`
- `origin/contact-hub`: `3ed8d828a8e157ef354a3c6e0d7019ec7a18b5d1`
- 旧 staging 文档分支: `codex/contact-hub-staging-preflight` / `32ec3f6edda0d7e8682856df26e68e124bddfce3`
- 当前 Contact schema target: **7**
- 上游 DB code version at this baseline: **v0.0.8**
- Contact Hub RC GitHub Actions: green at the reviewed baseline

旧 staging 分支基于 schema v5、Pages + Worker，并使用旧管理员认证描述，因此不能原样合并；本分支只吸收其中仍有效的隔离、DNS、备份和 smoke 原则。

## 2. 部署架构检查

V1 staging 必须满足：

- 一个 Worker：`contact-mail-hub-staging`；
- Worker 同时提供 Vue static assets、HTTP API 和 Email Worker handler；
- 前端 `VITE_API_BASE=`，保持同源；
- D1 和 R2 均为 staging 专用资源；
- `pages/wrangler.toml` 不参与 Contact Hub staging；
- Web hostname 和邮件域名分离。

## 3. Wrangler 配置硬门槛

`worker/wrangler.toml.template` 只作为生成模板。执行部署前必须复制为 gitignored `worker/wrangler.toml` 并替换真实 staging D1 ID。

必须确认：

- `[assets]` 指向 `../frontend/dist/`，binding 为 `ASSETS`，`run_worker_first=true`；
- `[env.staging]` / `[env.production]` 都存在；
- staging Worker 名称为 `contact-mail-hub-staging`；
- staging `workers_dev=true`；
- production `workers_dev=false`；
- staging/production 分别定义 vars、D1、R2；
- `E2E_TEST_MODE` 不存在；
- `DISABLE_ADMIN_PASSWORD_CHECK=false`；
- `JWT_SECRET`、`ADMIN_PASSWORDS`、Provider key/password、Cloudflare token 不出现在 vars；
- `.dev.vars.staging` / `.dev.vars.production` 等本地 Secret 文件被 gitignore。

## 4. Secret 隔离

首次 staging 只要求：

```text
JWT_SECRET
ADMIN_PASSWORDS
```

Provider Secret 暂不配置。后续先验证 Resend，再按需加入 `CONTACT_RESEND_MAIN_API_KEY`。staging 与 production Secret 必须使用不同值。

不要把 Secret 值粘贴到聊天、PR、日志、截图或发布报告。

## 5. 代码与 schema 预检

必须重新执行：

```text
worker:   install -> test -> lint -> build
frontend: install -> test -> build:pages
git diff --check
wrangler deploy --env staging --dry-run --minify
```

Contact migration 必须以 API runner 为准，而不是 `wrangler d1 migrations apply`：

- `/admin/contact/db/version`
- `/admin/contact/db/migrate`
- target version = 7
- 第二次 migrate 后 `pending=[]`

本轮 deployment-readiness 分支的本地验证证据：

- Worker: 54/54 tests，lint，CI dry-run build 全通过；
- Frontend: 69/69 tests，`build:pages` 通过（仅既有大 chunk advisory）；
- Wrangler 4.124.0: staging/production Named Environment dry-run 均通过并只显示各自 D1/R2/vars + shared `ASSETS`；
- `git diff --check` 与 GitHub Actions workflow YAML syntax 通过。

RC Hardening 后必须保留的语义：

- 管理员密码换取 scoped Contact Admin Session；浏览器不持久化明文密码；
- `received_at` 是 Worker trusted receive time，MIME Date 保存为 `sender_date`；
- 六类 post-persist side effects 独立持久化状态；
- Health 包含 `adminReady`、`migrationReady`、`storageReady`、`inboundReady`、`outboundReady`、`productionReady`；
- Resend/Brevo HTTP timeout 为有界 Unknown，不自动 retry/fallback。

## 6. 远程资源 No-Go 条件

以下任何一项未确认都不能部署 staging：

- Cloudflare account 未核对；
- staging D1 ID 未由 `wrangler d1 create` 真实返回；
- staging R2 未创建或存在 public access；
- dry-run 显示 production D1/R2/Worker；
- 计划复用 production Secret；
- 计划使用 `pages/wrangler.toml`；
- 计划提前开启 MX、Email Routing、Catch-all；
- 计划使用正式网站或真实客户收件人做第一轮 smoke。

## 7. Go 条件

部署 Worker 前至少满足：

- 当前 PR/commit CI green；
- staging D1/R2 与 production 隔离；
- local `worker/wrangler.toml` 使用真实 staging D1 ID；
- staging Secret 已独立配置；
- frontend asset build 成功；
- staging dry-run 无 production 资源和 Secret 泄漏。

部署并完成基础迁移后，至少要求：

```text
adminReady=true
migrationReady=true
storageReady=true
```

Domain/Mailbox 与 Email Routing 完成后再要求 `inboundReady=true` 和目标拓扑下的 `productionReady=true`。Provider 配好后再验证 `outboundReady=true`。

最终 staging smoke 全绿后停止；production 仍为 **NOT DEPLOYED**。
