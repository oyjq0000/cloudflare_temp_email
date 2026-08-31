# Contact Hub Staging 可执行上线 Runbook

本 Runbook 的目标是把已通过的离线构建转换为一次受控的 staging 发布。文中的 `<...>` 都是占位符；不得原样执行，也不得把 Secret 值写入本文、Git、Wrangler vars、D1、日志或工单。

当前状态：**远程执行 No-Go**。先完成第 1 节参数表和审批，再由人工执行 Cloudflare 步骤。本次预检没有执行本 Runbook 中的任何远程命令。

## 0. 角色与证据分类

### 已自动验证

- 基线 SHA、Worker 41/41、lint、Wrangler dry-run、Frontend 67/67、Pages build、Compose config、完整 E2E 196/196。
- Contact v1–v5 顺序、幂等、上游版本隔离、显式 Provider、Unknown no-retry、CORS/HTML/附件安全。
- Wrangler 4.124.0 的 `deploy --dry-run`、`d1 export`、`d1 execute` 参数和本地非空导出/恢复。

### 需要发布负责人提供的非敏感参数

完成第 1 节所有 `<...>`。不得猜测名称、ID、域名、selector、邮件地址或回滚 revision。

### 需要人工在 Cloudflare 执行

创建/确认资源、安装 Secret、部署、远程备份/迁移、Provider Domain 验证、Email Routing、DNS 和 staging smoke。

### Go/No-Go

每一阶段末尾都有 Stop 条件。任一 Stop 命中即 No-Go；不要“先上线再补验证”。

## 1. 冻结参数和资源身份

在发布记录中填写以下非敏感参数：

```text
REVIEWED_GIT_SHA=a4902cdd190ea1752de01370a9593562e0a45d58
CF_ACCOUNT_ID=<STAGING_ACCOUNT_ID>
CF_ZONE_ID=<STAGING_ZONE_ID>
CF_ZONE_NAME=<STAGING_ZONE_NAME>

WORKER_BASE_NAME=<WORKER_BASE_NAME>
WORKER_ENVIRONMENT=staging
WORKER_STAGING_NAME=<STAGING_WORKER_NAME>
WORKER_STAGING_ORIGIN=https://<STAGING_WORKER_HOST>

PAGES_PROJECT=<STAGING_PAGES_PROJECT>
PAGES_BRANCH=staging
PAGES_ORIGIN=https://<STAGING_PAGES_HOST>

D1_NAME=<STAGING_D1_NAME>
D1_ID=<STAGING_D1_ID>
R2_BUCKET=<STAGING_PRIVATE_R2_BUCKET>

ADMIN_AUTH_SCHEME=<ADMIN_PASSWORDS_OR_ADMIN_USER_ROLE>
ADMIN_USER_ROLE=<ROLE_NAME_IF_USED>
CONTACT_DNS_CACHE_TTL_SECONDS=3600

CONTACT_DOMAINS=<COMMA_SEPARATED_STAGING_DOMAINS>
FIXED_MAILBOXES=<CONTACT_SUPPORT_PRIVACY_SECURITY_HELLO_OR_REVIEWED_LIST>
SAFE_SMOKE_RECIPIENT=<NON_CUSTOMER_SINK>
SAFE_SMOKE_SENDER=<CONTROLLED_TEST_SENDER>
MAINTENANCE_WINDOW=<START_END_TIMEZONE>
OBSERVATION_WINDOW=<DURATION>

PREVIOUS_WORKER_VERSION=<IMMUTABLE_VERSION_ID>
PREVIOUS_PAGES_DEPLOYMENT=<IMMUTABLE_DEPLOYMENT_ID>
BACKUP_DESTINATION=<ACCESS_CONTROLLED_PATH>
```

另附一份 production 资源清单，只用于比对，不复制任何 Secret。逐项证明下列 staging 值与 production 不同：Worker name/route/version、Pages project/origin、D1 name/ID、R2 bucket、Contact Domain、Provider credential identity。

### Stop / No-Go

- 任一值缺失或仍是 `<...>`。
- 任一 staging 资源标识与 production 相同或无法比较。
- 计划使用 production Domain、production Provider credential 或真实客户收件人。
- 计划直接使用 `worker/wrangler.toml`（本地 E2E）或 `pages/wrangler.toml`（production service binding）。

## 2. Secret Reference 清单

仅批准引用名，不在发布记录中填写值：

```text
JWT_SECRET
ADMIN_PASSWORDS                    # 仅密码管理员方案
CONTACT_RESEND_MAIN_API_KEY        # 仅选择 Resend
CONTACT_BREVO_MAIN_API_KEY         # 仅选择 Brevo
CONTACT_SMTP_MAIN_PASSWORD         # SMTP 有 username 时
```

每个 Provider Config 在 D1 中只保存对应引用名：

```json
{"apiKey":"CONTACT_RESEND_MAIN_API_KEY"}
```

```json
{"apiKey":"CONTACT_BREVO_MAIN_API_KEY"}
```

```json
{"password":"CONTACT_SMTP_MAIN_PASSWORD"}
```

如果存在多个 staging Provider，可增加经过审核的 `CONTACT_*` 引用名。不要复用 production Secret 的值；名称相同也不代表允许复用值。

## 3. 准备 staging Worker 配置

在仓库外或被忽略的临时路径生成 reviewed staging config。以下模板不含 Secret 值：

```toml
name = "<WORKER_BASE_NAME>"
main = "src/worker.ts"
compatibility_date = "2025-04-01"
compatibility_flags = ["nodejs_compat"]
keep_vars = true

[env.staging]
name = "<STAGING_WORKER_NAME>"

[env.staging.vars]
CONTACT_MAIL_MODE = true
CONTACT_ALLOWED_ORIGINS = ["https://<STAGING_PAGES_HOST>"]
CONTACT_DNS_CACHE_TTL_SECONDS = 3600
DISABLE_ADMIN_PASSWORD_CHECK = false
# ADMIN_USER_ROLE = "<REVIEWED_ROLE>" # 只在选择 role 方案时启用
# E2E_TEST_MODE 不得出现
# JWT_SECRET、ADMIN_PASSWORDS、Provider 值不得出现在 vars

[[env.staging.d1_databases]]
binding = "DB"
database_name = "<STAGING_D1_NAME>"
database_id = "<STAGING_D1_ID>"

[[env.staging.r2_buckets]]
binding = "CONTACT_R2"
bucket_name = "<STAGING_PRIVATE_R2_BUCKET>"
```

说明：

- `compatibility_date` 保持与已测试代码配置一致；升级日期应作为独立变更重新回归。
- 同源 Pages→Worker service binding 时，`CONTACT_ALLOWED_ORIGINS` 可不填；保留时也只能是精确 Pages origin。
- 不要把 Legacy `DOMAINS`/`DEFAULT_DOMAINS` 当作 Contact Domain。Contact Domain 必须迁移后通过管理 API/UI 创建。
- `CONTACT_R2` 必须 private，不能绑定 public custom domain。
- `E2E_TEST_MODE` 必须缺省/false。

### 离线 dry-run（可重复执行）

在 `worker/` 目录：

```text
pnpm install --frozen-lockfile
pnpm test
pnpm run lint
pnpm exec wrangler deploy --dry-run --minify --config <STAGING_CONFIG> --env staging
```

记录 bundle 大小和 exit code。`--dry-run` 不上传 Worker。

### Stop / No-Go

- dry-run 失败或加载的 Worker name 不是 staging name。
- binding 输出包含 production D1/R2。
- `JWT_SECRET`、管理员密码或 Provider 值出现在 vars/binding 输出。
- `E2E_TEST_MODE=true`、管理员 bypass 或 wildcard CORS。

## 4. 人工创建/确认 Cloudflare staging 资源

由有权限的人员在 Cloudflare 执行，并把非敏感资源 identity 回填第 1 节：

1. 确认 staging account/zone。
2. 创建或确认 staging D1；不得复用 production D1。
3. 创建或确认 staging R2 bucket，保持 private；不得复用 production R2。
4. 创建或确认 staging Worker/environment 和专用 route。
5. 创建或确认 staging Pages project/branch。
6. Pages 的 `BACKEND` service binding 必须解析到 staging Worker environment。

仓库现有 `pages/wrangler.toml` 写死了 `environment = "production"`，只能作为风险提示，不能作为 staging 配置。若用 Wrangler 发布 Pages，应在仓库外准备包含相同 `functions/_middleware.js` 但指向 staging Worker 的临时 Pages 配置；若用 Dashboard/Git integration，则在 Dashboard 显式设置 staging `BACKEND` binding。

### Stop / No-Go

- Dashboard 中任一 ID/name/route 与 production 相同。
- R2 有 public access/custom domain。
- Pages `BACKEND` 实际解析到 production Worker。

## 5. 人工安装 staging Worker Secrets

以下命令仅表示交互式动作；值只能在 Secret prompt 中输入：

```text
pnpm exec wrangler secret put JWT_SECRET --config <STAGING_CONFIG> --env staging
pnpm exec wrangler secret put ADMIN_PASSWORDS --config <STAGING_CONFIG> --env staging
pnpm exec wrangler secret put CONTACT_RESEND_MAIN_API_KEY --config <STAGING_CONFIG> --env staging
pnpm exec wrangler secret put CONTACT_BREVO_MAIN_API_KEY --config <STAGING_CONFIG> --env staging
pnpm exec wrangler secret put CONTACT_SMTP_MAIN_PASSWORD --config <STAGING_CONFIG> --env staging
```

只执行所选管理员方案和 Provider 需要的行。`ADMIN_PASSWORDS` 的值是经过审核的 JSON string array；不要把值作为命令参数、pipe、文件或截图内容。若使用 `ADMIN_USER_ROLE`，仍需要安全的 `JWT_SECRET`，且必须验证该 role 的账户路径。

### Stop / No-Go

- Secret 来自 production credential。
- Provider Config API 返回 expected secret `configured=false`。
- Secret/reference/value 出现在 D1 查询、日志或 API response。

## 6. 人工部署 Worker 与 Pages

此阶段需要单独发布批准。本任务没有执行这些命令。

### Worker

```text
pnpm exec wrangler deploy --minify --config <STAGING_CONFIG> --env staging
```

部署后记录 Worker version ID、route、SHA 和 config hash。先不要启用 Email Routing。

### Frontend/Pages

在 `frontend/`：

```text
pnpm install --frozen-lockfile
pnpm run build:pages
```

从包含 staging Pages config 和 `pages/functions/_middleware.js` 的 reviewed 临时 Pages 目录，或通过已审核的 Dashboard/Git integration，把 `frontend/dist` 发布到 `<STAGING_PAGES_PROJECT>` 的 `staging` branch。若用 CLI，必须显式指定 staging project/branch 和 commit SHA：

```text
pnpm exec wrangler pages deploy <FRONTEND_DIST> --project-name <STAGING_PAGES_PROJECT> --branch staging --commit-hash a4902cdd190ea1752de01370a9593562e0a45d58
```

发布后验证 `/admin/*` 由 staging Pages middleware 转到 staging Worker。

### Stop / No-Go

- artifact SHA 不可追溯或 workspace 有未审核代码改动。
- Worker/Pages 实际 URL 是 production URL。
- Pages 请求到达 production Worker/D1/R2。

## 7. D1 备份、基础初始化与 Contact v1–v5

### 7.1 迁移前备份

即使是 staging，也先导出当前 D1：

```text
pnpm exec wrangler d1 export <STAGING_D1_NAME> --remote --output <TIMESTAMP>-before-contact.sql --config <STAGING_CONFIG> --env staging
```

检查文件存在且非空。把导出恢复到 disposable 本地目录，验证 SQL 可解析，不覆盖任何现有 D1：

```text
pnpm exec wrangler d1 execute <STAGING_D1_NAME> --local --persist-to <LOCAL_RECOVERY_DIR> --file <TIMESTAMP>-before-contact.sql --config <STAGING_CONFIG> --env staging --yes
pnpm exec wrangler d1 execute <STAGING_D1_NAME> --local --persist-to <LOCAL_RECOVERY_DIR> --command "SELECT COUNT(*) AS objects FROM sqlite_master;" --config <STAGING_CONFIG> --env staging --json
```

保存：导出时间、字节数、受控存储位置、恢复验证结果、Worker/Pages revision 和 R2 bucket identity。

### 7.2 上游基础 DB

使用管理员认证请求 staging Worker：

```text
GET  <STAGING_ORIGIN>/admin/db_version
POST <STAGING_ORIGIN>/admin/db_initialize   # 仅 need_initialization=true
POST <STAGING_ORIGIN>/admin/db_migration    # 仅 need_migration=true
GET  <STAGING_ORIGIN>/admin/db_version
```

期望最终 `current_db_version == code_db_version == v0.0.8`。不要在基础表不存在时执行 Contact migration。

### 7.3 Contact v1–v5

```text
GET  <STAGING_ORIGIN>/admin/contact/db/version
POST <STAGING_ORIGIN>/admin/contact/db/migrate
GET  <STAGING_ORIGIN>/admin/contact/db/version
POST <STAGING_ORIGIN>/admin/contact/db/migrate
GET  <STAGING_ORIGIN>/admin/contact/db/version
```

每次使用现有管理员 header（`x-admin-auth` 或验证过的 `x-user-access-token`）。期望：

- 第一次按 1、2、3、4、5 顺序完成。
- `currentVersion=5`、`targetVersion=5`、`pending=[]`。
- 第二次 POST 后仍为上述值，不新增迁移记录。
- `/admin/db_version` 在 Contact 迁移前后保持 `v0.0.8`。

Contact 迁移不是 Wrangler migration 文件；不要运行 `wrangler d1 migrations apply` 来代替上述 API。

### 7.4 健康与存储

```text
GET <STAGING_ORIGIN>/admin/contact/status
GET <STAGING_ORIGIN>/admin/contact/storage/status
GET <STAGING_ORIGIN>/admin/contact/health
```

必须同时满足：管理员 `secure=true`、migration pending 空、`storage.bindingAvailable=true`、D1 probe healthy、没有 unexplained degraded/fallback、`protections.unknownAutomaticRetry=false`。

### Stop / No-Go

- 备份为 0 字节、不能恢复或没有访问控制。
- 上游基础版本错误、Contact 不是 v5、重复迁移仍有 pending。
- `CONTACT_R2` 不可用/公开，或健康结果不满足上述条件。

## 8. Provider Config、Domain 与 Mailbox

先创建 Provider Config，再创建 Domain/Mailbox。API 示例只含引用名和非敏感配置。

### Resend

```json
{
  "name": "Staging Resend",
  "provider_type": "resend",
  "config": {},
  "secret_refs": {"apiKey": "CONTACT_RESEND_MAIN_API_KEY"}
}
```

### Brevo

```json
{
  "name": "Staging Brevo",
  "provider_type": "brevo",
  "config": {},
  "secret_refs": {"apiKey": "CONTACT_BREVO_MAIN_API_KEY"}
}
```

### SMTP

```json
{
  "name": "Staging SMTP",
  "provider_type": "smtp",
  "config": {
    "host": "<STAGING_SMTP_HOST>",
    "port": 587,
    "secure": false,
    "starttls": true,
    "username": "<STAGING_SMTP_USERNAME>"
  },
  "secret_refs": {"password": "CONTACT_SMTP_MAIN_PASSWORD"}
}
```

对每个 Contact Domain：

1. 确认它是 staging Domain。
2. 创建 Domain 和默认 `contact@` Mailbox，或按批准列表逐个创建固定 Mailbox。
3. 确认 Domain/Mailbox enabled、inbound enabled；需要出站的 Mailbox outbound enabled。
4. 把 Domain 的 `default_provider_config_id` 设置为唯一 enabled staging Provider。
5. 读取 Provider list，确认只显示 `configured` 布尔值，不返回引用或值。
6. 在 Provider 控制台验证 staging Domain；不要用 production credential/domain。

不要把 Domain 创建 POST 当作幂等命令；重跑前先 GET 并复用已有 ID。Provider 失败不会 fallback。

### Stop / No-Go

- Domain 未绑定 Provider、Provider disabled、Secret configured=false。
- Domain/Provider 属于 production。
- 发现 Legacy `RESEND_TOKEN`/`SMTP_CONFIG`/`SEND_MAIL` 影响 Contact 选择。

## 9. Email Routing 与 DNS（人工）

对每个 staging Domain，严格按顺序：

1. Contact Hub 中先存在 enabled 固定 Mailbox。
2. Provider Domain 验证给出 SPF/DKIM 要求和准确 selector。
3. 在 Cloudflare 启用 Email Routing，采用 Dashboard 当前显示的 MX。
4. 只把批准的固定地址路由到 staging Email Worker。
5. 保留唯一 SPF TXT，把 Cloudflare/provider mechanism 合并到现有 `v=spf1`。
6. 发布 Provider 给出的 DKIM TXT/CNAME，selector 原样录入 Contact Operations。
7. 发布唯一 `_dmarc.<domain>`，采用批准 policy/reporting addresses。
8. 在 Contact Operations 填写预期 MX/SPF/DKIM/DMARC 片段并 Refresh。
9. 对 Unknown 进行外部 DNS 查询复核；不要把 resolver 失败自动当成 Invalid，更不能自动改记录。

### Stop / No-Go

- Email Routing 指向 production Worker 或不存在的 Mailbox。
- 两条及以上 SPF、两条及以上 DMARC、DKIM selector 猜测/缺失。
- DNS 结果 Missing/Invalid；Unknown 未经外部复核。

## 10. Staging Smoke Test

所有出站只发到 `<SAFE_SMOKE_RECIPIENT>`。每个测试记录时间、Domain、Mailbox、message/outbound ID、期望和实际结果；不记录 Secret。

### 10.1 登录与权限

- 无 header 访问 `/admin/contact/status`：401。
- 错误管理员凭据：401。
- 正确密码或已验证 admin role：200，`mode=contact`、`adminSecurity.secure=true`。
- `/api/new_address`、public send、registration/user mailbox：403。
- 非 allowlist Origin：403；同源/精确 Pages Origin：成功；preflight 不反射任意 header。

### 10.2 收件、去重与 Inbox 筛选

- 通过 staging Email Routing 向每个固定 Mailbox 发一封带唯一 Subject/Message-ID 的测试邮件。
- 确认 D1 metadata、Raw EML 和附件进入 staging D1/R2，production 计数不变。
- 用同一 Message-ID/同一原始 MIME 重投一次，Inbox 只能增加一条；不得重复 side effect。
- 验证 Domain、Mailbox、unread、Spam、日期、From、To、Subject 筛选。
- 列表不得含 body、raw、附件 bytes、R2 key 或 idempotency key；detail 才加载 body。

### 10.3 HTML、远程图片与附件

- 收一封含 script、event handler、表单/iframe/active URL 和远程 tracking image 的 HTML。
- 默认渲染无可执行内容，远程图片被阻止。
- 逐邮件同意加载后，只恢复 sanitised image URL；script/event handler 仍不能执行。
- 未认证 Raw/附件下载：401。
- 已认证下载：`Cache-Control` private/no-store、`X-Content-Type-Options: nosniff`、安全 leaf filename。
- SVG/HTML 等 active attachment 强制 `application/octet-stream`/attachment，不在页面执行。

### 10.4 回复与正常出站

- 从原入站邮件 Reply 到安全 sink。
- 验证 From 属于同一 Domain/Mailbox，Reply-To 选择正确。
- 验证新的 Message-ID、正确 `In-Reply-To`/`References`，Provider 只调用 Domain 显式绑定的 config。
- 重复同一 Idempotency-Key 不产生第二次发送；不同内容复用 key 返回冲突。

### 10.5 Failed Retry

- 用 staging provider sandbox/受控 SMTP 产生一次明确 rejection，状态必须为 Failed，Attempt 只含脱敏分类。
- 修复受控失败或在人工 Retry 请求中显式选择另一个 approved staging Provider Config。
- 只人工 Retry 一次，确认新增 Attempt；禁止自动 fallback。

### 10.6 Unknown 与 Force Resend

- 使用可控 staging 故障夹具制造不确定结果；不得启用 `E2E_TEST_MODE`，不得使用真实客户收件人。
- 状态必须为 Unknown、`retryable=false`，普通 `/retry` 必须返回 409。
- 确认系统、队列和操作人员都没有自动重发。
- 在决定 Force Resend 前先查 Provider 日志，无法证明未投递时明确记录“可能重复投递”。
- 只有发布负责人确认风险后，使用新的 Idempotency-Key 和 `{"confirm":true}` Force Resend。
- 新 intent 必须通过 `force_resend_of_id` 关联原 Unknown，拥有新 Message-ID；原记录/Attempt 不变。

**Unknown 永远不得在回滚、重启、调和或批处理时自动/普通重发。**

### 10.7 DNS 与 Operations

- 对每 Domain 输入明确 DKIM selector 和 expected fragments，执行 Refresh。
- MX/SPF/DKIM/DMARC 全部 Valid，或 Unknown 已由独立外部查询解释并获批准。
- `/admin/contact/health` 无 stale Sending；如使用 reconcile，确认它只把 stale Sending 标记 Unknown，不调用 Provider。

## 11. 观察与 Go 决策

在 `<OBSERVATION_WINDOW>` 内监控：

- inbound 接收/去重、D1/R2 storage status；
- failed、unknown、stale sending；
- Provider acceptance 与 staging sink；
- DNS Missing/Invalid/Unknown；
- 401/403/CORS 异常和 HTML/附件安全；
- production 对应资源计数必须保持不变。

Go 需要两人确认：所有 smoke 通过、无 production 访问、迁移/备份/R2/管理员/CORS/Provider/DNS 均满足 `STAGING_PRECHECK.md`。否则保持 No-Go 并进入第 12 节。

## 12. 回滚条件与步骤

### 立即回滚条件

- staging 请求命中任一 production Worker/Pages/D1/R2/Domain/Provider credential。
- 管理员绕过、CORS 越权、Secret 泄漏、HTML 执行或附件 inline execution。
- 迁移错误、D1 corruption、R2 丢失、入站丢信/错误去重。
- Email Routing 到错误 Worker/Mailbox，MX/SPF/DKIM/DMARC 破坏现有邮件流。
- Unknown/stale Sending 增长且无法人工解释，或出现自动 retry/fallback。

### 回滚步骤

1. 停止新增 Domain/Provider/route，记录 health、outbound 状态和时间线。
2. **冻结所有 Unknown；禁止 Retry/Force Resend。**
3. 按已审核方式暂停/撤回新增 staging Email Routing 固定地址规则，确认回退目的地后再改。
4. 回滚 Pages 到 `<PREVIOUS_PAGES_DEPLOYMENT>`。
5. 回滚 Worker 到 `<PREVIOUS_WORKER_VERSION>`。
6. 不 drop、不 downgrade、不手改 Contact 表；保留 additive 表和 private R2 供审计/恢复。
7. 只有确认 D1 corruption 时才恢复：先把备份导入新的 recovery D1，验证 schema/data，再经审批 rebind/swap；不要在 populated D1 上盲目 import。
8. 保留匹配恢复点的 R2 bucket。D1 与 R2 时间点必须一致；orphan cleanup 是独立审批任务。
9. 如果关闭 Contact Mode，先确保 Contact Email Routing 不会落入公开 Temp pipeline。
10. 回滚后复验管理员安全、Temp 核心回归、入站路由和 production 资源未受影响。

## 13. 发布记录模板

```text
Decision: GO | NO-GO
Reviewed SHA:
Worker version / route:
Pages deployment / origin:
D1 name / ID / backup / restore evidence:
R2 bucket / private check:
Admin auth check:
CORS origins:
Provider configs and configured booleans:
Domain -> Provider mapping:
Email Routing fixed addresses:
MX/SPF/DKIM/DMARC evidence:
Smoke evidence:
Failed Retry evidence:
Unknown no-retry / Force Resend evidence:
Rollback targets:
Approvers:
Timestamp / timezone:
```
