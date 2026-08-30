# Private Multi-domain Contact Mail Hub
## Codex Goal Mode 总任务文档

> Repository: `https://github.com/oyjq0000/cloudflare_temp_email`
>
> Upstream: `https://github.com/dreamhunter2333/cloudflare_temp_email`
>
> 审计基线：`f92b059aac0d89e2c106601b6857dce9dcae07d3`
>
> 审计时版本：应用 `1.12.0`，上游数据库版本 `v0.0.7`
>
> 执行模式：**Codex Goal mode**
>
> 产品长期分支：`contact-hub`

---

# 0. 给 Codex 的启动指令

将本文件放到仓库：

```text
docs/contact-hub/CODEX_GOAL.md
```

然后在仓库根目录打开 Codex，切换到 Goal mode，发送：

```text
读取仓库根目录的 AGENTS.md、CLAUDE.md，以及 docs/contact-hub/CODEX_GOAL.md。

以该文档定义的“Private Multi-domain Contact Mail Hub V1”作为唯一长期 Goal，按 Phase 0 → Phase 8 顺序持续执行。不要只输出计划，也不要在每个阶段等待确认；完成一个阶段后运行对应测试、修复失败、更新进度文档、创建本地提交，然后继续下一阶段。

开始前先核对当前 HEAD、remote、工作区状态和现有测试基线。审计基线 SHA 仅用于比对，不要强制 reset。不得直接在 main 上开发，不得 force push，不得推送远端，不得部署或修改生产 Cloudflare 资源，不得写入真实 API Key。需要第三方凭据或生产权限时使用 mock 完成全部可完成工作，并把人工步骤记录到最终报告。

优先保证：上游可同步、Temp Mode 不回归、Contact Mode 后端真正私有、邮件 HTML 安全、发件不重复、未知发送结果不自动重试。
```

---

# 1. Goal

在现有 `cloudflare_temp_email` fork 基础上，实现一个以 Cloudflare 为基础设施的：

# Private Multi-domain Contact Mail Hub V1

最终系统需要支持：

```text
多个网站域名
    ↓
Cloudflare Email Routing
    ↓
Email Worker
    ↓
统一私有 Inbox
    ↓
按 Domain / Mailbox 查看、搜索和回复
    ↓
每个 Domain 独立选择 Resend / Brevo / Generic SMTP
```

目标用户是仓库所有者本人，不是面向公众的多租户临时邮箱服务。

系统需要低维护、低成本、可扩展到几十个低流量网站，并继续吸收上游的 MIME、Cloudflare、SMTP 和安全修复。

---

# 2. Definition of Done

只有同时满足以下条件，才算 Goal 完成：

1. `CONTACT_MAIL_MODE=false` 时，现有临时邮箱模式的核心 API、UI 和 E2E 测试保持兼容。
2. `CONTACT_MAIL_MODE=true` 时，公共随机邮箱、匿名地址创建、公共注册、公共发件和用户门户在前端隐藏，并在后端实际拒绝访问。
3. Contact Mode 必须要求有效管理员身份；生产配置不得允许无密码 Admin。
4. Domain 和固定 Mailbox 存入 D1，可在后台动态新增，不需要修改代码。
5. 支持一个 Domain 下的 `contact@`、`support@`、`privacy@`、`security@`、`hello@` 等固定地址。
6. 支持统一 Inbox、按 Domain/Mailbox 过滤、未读、Spam、日期、From、To、Subject 搜索。
7. Inbox 列表接口不得返回完整原始 EML、完整正文或附件字节；点击详情后才加载正文和附件信息。
8. 收件 MIME 只解析一次，并保存可查询的索引字段。
9. 原始 EML 和附件可保存到 R2；D1 保存业务索引、正文、状态和对象键。
10. 同一入站邮件重投时有稳定去重机制，不生成重复 Contact Message。
11. 支持直接回复，正确处理 `Reply-To`、`Message-ID`、`In-Reply-To`、`References`。
12. 发件 Provider 使用统一接口，Contact Hub 可显式选择 `resend`、`brevo`、`smtp`。
13. 每个 Domain 可独立绑定 Provider Config；全局 Resend Token 不得覆盖 Domain 的明确选择。
14. Provider Secret 只存在于 Worker Secrets，不得以明文进入 D1、前端响应、日志或测试快照。
15. Outbound 至少支持 `pending`、`sending`、`sent`、`failed`、`unknown`。
16. 网络超时或结果不确定必须进入 `unknown`，不得自动 fallback 或自动重发。
17. `failed` 可以人工 Retry；`unknown` 只能人工 Force Resend，并明确提示可能重复。
18. 每次发送尝试都有独立 Attempt 记录，包含 Provider、确定性、错误分类和 Provider Message ID。
19. 支持 Sent、Failed、Unknown 的查看和筛选。
20. 支持基础 MX/SPF/DKIM/DMARC 状态检查；V1 只读检查，不自动修改 DNS。
21. Contact Mode 邮件 HTML 始终经过安全净化；允许远程图片不能绕过 HTML Sanitization。
22. Contact Mode 默认阻止远程图片和 Tracking Pixel。
23. HTML 邮件和 Sent HTML 均不得通过未净化的 `v-html`、Shadow DOM `innerHTML` 或无 sandbox iframe 直接渲染。
24. 附件下载需要权限检查、安全响应头和安全的 `Content-Disposition`。
25. 现有临时地址清理任务不得删除 Contact Mailbox 或其业务数据。
26. 新数据库迁移与上游 `DB_VERSION` 完全分离、可重复执行、可增量升级。
27. 新代码主要位于 `contact_*`、`worker/src/contact/`、`worker/src/mail_providers/`、`frontend/src/.../contact/`，减少上游合并冲突。
28. Worker lint/build、Frontend test/build、现有 E2E、新增 Contact E2E 全部通过。
29. 提供安装、迁移、配置、测试、备份、恢复、回滚和上游同步文档。
30. 不执行生产部署，不推送远端；只创建本地、可审查的阶段性提交。

---

# 3. 已确认的仓库现状

开始工作前重新核对；如果当前代码已变化，记录差异并以当前代码为准，不要强制回退到审计 SHA。

## 3.1 现有可复用能力

- Cloudflare Email Routing / Email Worker
- Hono Worker API
- D1
- Pages / Vue 3 / Naive UI
- MIME 解析：前端 WASM + PostalMime，Worker 使用 PostalMime
- 多域名字符串配置和域名标准化工具
- 固定地址 `address` 表
- Admin 认证
- Admin Inbox / SendBox / SendMail 基础 UI
- Resend
- Generic SMTP：`worker-mailer`
- Cloudflare `SEND_MAIL` binding
- S3 兼容客户端
- Spam Header 检查
- 黑名单、Webhook、Telegram
- Docker Compose + Mailpit + Playwright E2E

## 3.2 当前多域名机制

当前 `DOMAINS`、`DEFAULT_DOMAINS` 只是环境变量字符串列表，不是可管理的 Domain Entity。

可复用：

- `normalizeDomain`
- `normalizeDomains`
- `getMailDomain`
- `includesDomain`
- `getDomainMapValue`

不能直接复用为最终 Domain 管理：

- 无 CRUD
- 无 enabled / inbound_enabled
- 无默认 Mailbox
- 无 Provider 绑定
- 无 DNS 状态
- 无业务名称和更新时间

## 3.3 当前收件存储

`raw_mails`：

```text
id
message_id
source
address
raw
raw_blob
metadata
created_at
```

目前适合原始邮件兼容和兜底，不适合作为完整 Contact Hub 业务模型。

## 3.4 当前发件逻辑

当前 `worker/src/mails_api/send_mail_api.ts` 的隐式优先级：

```text
verified recipient + SEND_MAIL
→ Resend
→ SMTP_CONFIG
→ SEND_MAIL binding
→ failed
```

现有实现没有真正的 Provider Interface，只是多个 `Promise<void>` 函数。

发送后才尝试写 `sendbox`；Provider Message ID 没有持久化；错误没有统一分类；没有 `unknown` 状态。

## 3.5 当前 Inbox 性能问题

Admin `/admin/mails` 会返回完整 `raw_mails`，前端对当前页每封邮件重新解析 MIME 和附件。

Contact Hub 不得继续使用这条列表数据链路。

## 3.6 当前安全问题

必须在 Contact Hub 上线前解决：

- `autoLoadRemoteImages` 当前默认开启。
- 某些路径允许原始 HTML 直接进入 Shadow DOM 或 iframe。
- Sent HTML 使用未统一净化的渲染路径。
- Worker 当前全局 CORS 较宽。
- 收件 D1 保存失败后，现有流程仍可能继续转发、通知和自动回复。
- Junk 当前直接 Reject，不是 Spam Folder。
- Legacy Cleanup 可能删除长期固定地址。

## 3.7 当前测试基础

现有 E2E 使用：

```text
Docker Compose
Mailpit
Wrangler Dev
Vite
Playwright
```

必须扩展现有测试体系，不另起一套平行测试框架。

---

# 4. 不可违反的工程原则

## 4.1 上游可同步

- `main` 视为上游镜像，不在 `main` 上开发。
- 长期产品分支使用 `contact-hub`。
- 不重命名上游文件，即使文件名存在拼写问题，例如 `commom_api.ts`。
- 不大规模移动或重写上游目录。
- 对上游热点文件只做挂载、路由、模式判断和薄适配。
- 通用安全修复与 Contact 业务提交分开，便于以后向上游提交 PR。

## 4.2 模式而不是删除

使用唯一开关：

```env
CONTACT_MAIL_MODE=true
```

不要同时引入 `PRIVATE_MODE`、`CONTACT_MODE` 等多个含义重叠的开关。

Temp Mode 原功能保留；Contact Mode 通过能力控制和后端权限关闭公共行为。

## 4.3 Inbound 与 Outbound 解耦

```text
Inbound ingestion
≠
Outbound delivery
```

不得让收件 Domain 的配置隐式决定旧临时邮箱发件行为。

## 4.4 Provider 显式选择

Contact Hub 必须严格读取 Domain 的 `provider_config_id`。

不得使用“哪个 Token 存在就优先走哪个”的隐式逻辑。

## 4.5 不自动 fallback

Provider 失败时：

```text
明确接受 → sent
明确拒绝 → failed
结果不确定 → unknown
```

不得自动切换 Provider 重发。

## 4.6 密钥与业务数据分离

D1 只保存 Secret Reference，例如：

```text
CONTACT_BREVO_MAIN_API_KEY
CONTACT_RESEND_IMPORTANT_API_KEY
CONTACT_SMTP_FREE_PASSWORD
```

不得保存真实 Secret。

## 4.7 不扩大 V1

不要在 V1 加入：

- AI Summary
- AI Reply
- AI 分类
- AI Priority
- Tags
- Star
- Archive
- Snooze
- 工单系统
- 多成员协作
- Agent API
- SES/Postmark/Mailgun/SMTP2GO
- 自动 Provider fallback
- 自动修改 Cloudflare DNS
- 自建互联网 SMTP Server
- IMAP Mail Server
- Outbound Attachment
- 完整会话线程 UI

现有 Webhook、Telegram、AI 能力可以保留，但不为 Contact Hub 新增复杂集成。

---

# 5. 分支与提交策略

## 5.1 开始前

Codex 必须先执行并记录：

```bash
git status --short
git branch --show-current
git remote -v
git rev-parse HEAD
git log -1 --oneline
```

要求：

- 工作区不干净时，不丢弃用户修改。
- 不执行 `git reset --hard`。
- 不执行 `git clean -fd`。
- 不执行 force push。
- 不自动 push。

如果 `contact-hub` 不存在，从当前已核对的 `main` 创建。

如果已存在，切换到该分支，先检查它与 `main` 的差异，再继续。

## 5.2 提交原则

每个 Phase 至少一个独立本地提交。

推荐提交序列：

```text
docs(contact-hub): add architecture and execution baseline
feat(contact-mode): add private mode capability gates
feat(contact-db): add independent contact schema migrations
feat(contact-domain): add domain and mailbox management
feat(contact-inbound): add indexed inbound ingestion and R2 storage
feat(contact-ui): add unified private inbox
refactor(mail-provider): extract reusable provider adapters
feat(contact-outbound): add provider routing and delivery state machine
feat(contact-reply): preserve reply threading headers
feat(contact-dns): add read-only DNS status checks
fix(mail-security): harden HTML, attachment and CORS handling
test(contact-hub): complete mode, provider and browser coverage
docs(contact-hub): add deployment, rollback and upstream sync guide
```

不要把全部功能压成一个巨大提交。

---

# 6. 目标架构

```text
                    Internet
                        │
                        ▼
          contact@site-a.com
          support@site-b.com
          privacy@site-c.com
                        │
                        ▼
            Cloudflare Email Routing
                        │
                        ▼
                 Email Worker
                        │
                App Mode Router
                  /           \
                 /             \
          Temp Mode          Contact Mode
          现有流程       ContactInboundService
                                  │
                         MIME Parse Once
                                  │
                ┌─────────────────┴─────────────────┐
                ▼                                   ▼
               D1                                  R2
       Domain/Mailbox/Index                 Raw EML/Attachments
       Body/State/Outbound
                │
                ▼
         Private Contact Hub
                │
                ▼
         ContactOutboundRouter
           /          |          \
          ▼           ▼           ▼
       Brevo       Resend        SMTP
```

---

# 7. 推荐目录边界

允许根据仓库实际情况微调，但必须保持业务命名空间清晰。

```text
worker/src/app_mode.ts

worker/src/contact/
├── index.ts
├── api/
├── db/
│   ├── migration_runner.ts
│   └── migrations/
├── domains/
├── mailboxes/
├── inbound/
├── inbox/
├── outbound/
├── dns/
└── storage/

worker/src/mail_providers/
├── types.ts
├── registry.ts
├── secret_resolver.ts
├── resend_provider.ts
├── brevo_provider.ts
├── smtp_provider.ts
└── cloudflare_binding_provider.ts

frontend/src/views/contact/
├── ContactHub.vue
├── ContactLogin.vue
└── ContactSettings.vue

frontend/src/components/contact/
├── ContactSidebar.vue
├── MessageList.vue
├── MessageDetail.vue
├── ReplyComposer.vue
├── DomainManager.vue
├── MailboxManager.vue
├── ProviderManager.vue
├── OutboundList.vue
└── DnsStatus.vue

frontend/src/api/contact.js
frontend/src/store/contact.js

docs/contact-hub/
├── CODEX_GOAL.md
├── ARCHITECTURE.md
├── SCHEMA.md
├── OUTBOUND_STATE_MACHINE.md
├── SECURITY.md
├── DEPLOYMENT.md
├── UPSTREAM_SYNC.md
├── PROGRESS.md
└── FINAL_REPORT.md
```

所有新数据库表使用 `contact_` 前缀。

所有新 API 使用：

```text
/admin/contact/*
```

不要污染现有 `/api/*` 和 `/user_api/*` 的语义。

---

# 8. Contact Mode 行为

## 8.1 后端模式解析

新增统一函数：

```ts
resolveAppMode(env): 'temp' | 'contact'
```

所有位置调用该函数，不要分散解析环境变量。

`/open_api/settings` 增加：

```json
{
  "mode": "contact",
  "capabilities": {
    "contactHub": true,
    "publicMailbox": false,
    "publicAddressCreation": false,
    "publicRegistration": false,
    "publicSendMail": false,
    "userPortal": false
  }
}
```

Contact Mode 的公开设置接口不得暴露内部 Domain、Mailbox、Provider 和 Secret Reference。

## 8.2 Contact Mode 后端必须拒绝

至少包括：

```text
/api/new_address
/api/send_mail
/external/api/send_mail
/user_api/register
/user_api/verify_code
/user_api/oauth2/*
公共地址登录和公共地址管理入口
```

不能只依靠前端隐藏。

## 8.3 管理员安全

Contact Mode 必须满足以下之一：

```text
ADMIN_PASSWORDS 已配置
或
ADMIN_USER_ROLE 已配置并成功验证
```

生产 Contact Mode 下：

```text
DISABLE_ADMIN_PASSWORD_CHECK=true
```

必须被视为不安全配置并在健康检查或管理界面明确报错。

E2E 测试可以例外，但必须由 `E2E_TEST_MODE` 限定。

## 8.4 前端路由

新增：

```text
/hub
```

Contact Mode：

```text
/      → /hub
/user  → /hub 或 404
/admin → 保留 Advanced Admin
```

Contact Hub 使用独立 Layout，不显示临时邮箱首页、广告、公共用户入口或临时邮箱宣传 Footer。

---

# 9. 数据模型

不得修改上游 `DB_VERSION` 作为 Contact Hub 的迁移版本。

## 9.1 独立迁移轨道

```text
contact_schema_migrations
```

字段：

```text
version INTEGER PRIMARY KEY
name TEXT NOT NULL
applied_at DATETIME NOT NULL
```

迁移必须：

- 增量执行
- 可重复调用
- 已执行版本不重复执行
- 失败时不写入已完成版本
- 不破坏已有 `raw_mails`、`address`、`sendbox`
- 不依赖字符串版本大小比较

提供：

```text
GET  /admin/contact/db/version
POST /admin/contact/db/migrate
```

## 9.2 `contact_domains`

至少包含：

```text
id
domain UNIQUE
name
enabled
inbound_enabled
importance

default_from_name
default_mailbox_id
default_provider_config_id

created_at
updated_at
```

规则：

- Domain 统一小写、去尾部点。
- 已有邮件的 Domain 不允许直接物理删除。
- 默认只做 soft disable。
- `importance` 仅是元数据；V1 不自动改变 Provider 或通知策略。

## 9.3 `contact_mailboxes`

至少包含：

```text
id
domain_id
address_id
local_part
address UNIQUE
display_name
enabled
inbound_enabled
outbound_enabled
is_default
created_at
updated_at
```

规则：

- 地址必须属于对应 Domain。
- 创建 Contact Mailbox 时，保证现有 `address` 表存在对应固定地址，以保持兼容。
- Contact 管理的 `address` 不允许被 Legacy Address 页面直接删除。
- Contact Mailbox 不参与临时地址自动清理。
- 一个 Domain 只能有一个默认 Mailbox。

## 9.4 `contact_provider_configs`

至少包含：

```text
id
name
provider_type
enabled
config_json
secret_refs_json
created_at
updated_at
```

`provider_type` V1：

```text
resend
brevo
smtp
```

Cloudflare Binding 可作为 Legacy 兼容 Adapter，不要求在 Contact V1 UI 中可选。

`config_json` 只保存非敏感字段。

`secret_refs_json` 只保存 Secret 名称，不保存 Secret 值。

## 9.5 `contact_messages`

至少包含：

```text
id
raw_mail_id UNIQUE
domain_id
mailbox_id

envelope_from
from_name
from_address
reply_to_address
to_address
cc_json

subject
preview
text_body
html_body

message_id_header
in_reply_to_header
references_json
dedupe_key UNIQUE

folder
is_read
spam_reason
has_attachments

raw_storage_key
storage_status
received_at
created_at
updated_at
```

V1 `folder`：

```text
inbox
spam
```

不要在 V1 增加 Archive、Star、Snooze。

建议索引：

```text
(domain_id, folder, received_at DESC, id DESC)
(mailbox_id, folder, received_at DESC, id DESC)
(folder, is_read, received_at DESC, id DESC)
from_address
subject
dedupe_key UNIQUE
raw_mail_id UNIQUE
```

## 9.6 `contact_attachments`

至少包含：

```text
id
message_id
filename
mime_type
disposition
content_id
size
sha256
storage_key
created_at
```

不得将用户提供的原始文件名直接作为 R2 完整对象路径。

## 9.7 `contact_outbound_messages`

至少包含：

```text
id
domain_id
mailbox_id
reply_to_message_id
force_resend_of_id

from_name
from_address
to_name
to_address
subject
text_body
html_body

message_id_header
in_reply_to_header
references_json

provider_config_id
provider_message_id
status
delivery_certainty
idempotency_key UNIQUE

last_error_class
last_error_code
last_error_message

created_at
sending_at
sent_at
updated_at
```

V1 Status：

```text
pending
sending
sent
failed
unknown
```

## 9.8 `contact_outbound_attempts`

至少包含：

```text
id
outbound_message_id
attempt_no
provider_config_id
provider_type
config_snapshot_json

status
certainty
provider_message_id
retryable
error_class
error_code
error_message

started_at
finished_at
```

`config_snapshot_json` 不得包含 Secret 值。

## 9.9 `contact_dns_checks`

至少包含：

```text
id
domain_id
provider_config_id
record_purpose
record_type
record_name
expected_json
observed_json
status
checked_at
```

Status：

```text
valid
missing
invalid
unknown
```

---

# 10. 入站邮件设计

## 10.1 Contact Inbound 流程

```text
Normalize recipient
→ Load contact_domain
→ Load contact_mailbox
→ Check enabled/inbound_enabled
→ Hard blacklist
→ Read raw EML
→ Parse MIME once
→ Compute dedupe key
→ Persist reliable base record
→ Save Contact index/body
→ Save raw EML and attachments to R2
→ Classify Inbox/Spam
→ Trigger optional existing side effects
```

## 10.2 未知地址

Contact Mode 默认只接收已登记的固定 Mailbox。

```text
Domain 不存在
或 Domain disabled
或 Mailbox 不存在
或 Mailbox inbound disabled
→ Reject
```

不做公共 Catch-all 临时地址行为。

## 10.3 Spam 策略

- 硬黑名单：可以 Reject。
- SPF/DKIM/DMARC 可疑：默认保存到 `spam`，不要直接丢弃。
- Spam 邮件不触发自动回复。
- Spam 邮件默认不触发高优先通知。
- 管理员可以 Mark as Not Spam。

## 10.4 去重

有 `Message-ID` 时，建议：

```text
sha256(normalized_to + "\n" + normalized_message_id)
```

无 `Message-ID` 时，使用稳定组合：

```text
recipient
sender
date header
subject
raw size
raw sha256
```

最终依靠 `dedupe_key UNIQUE` 保证并发安全。

## 10.5 持久化顺序

当前上游可能在 D1 保存失败后继续执行副作用。Contact Mode 必须修正：

```text
可靠持久化失败
→ 不执行 Forward / Telegram / Webhook / Auto Reply
```

不要通过 `(address, message_id)` 重新查询刚插入的邮件 ID。

优先使用：

```sql
INSERT ... RETURNING id
```

或等价的可靠方式直接获得 ID。

## 10.6 MIME Parse Once

Contact Mode 在 Worker 中解析 MIME，并保存：

- From
- Reply-To
- To
- Cc
- Subject
- Text
- HTML
- Message-ID
- In-Reply-To
- References
- Date
- Attachment metadata

Inbox 列表前端不再逐封解析 MIME。

## 10.7 R2

新增 Worker R2 Binding，例如：

```text
CONTACT_R2
```

对象键由服务端生成：

```text
contact/messages/<message-uuid>/raw.eml
contact/messages/<message-uuid>/attachments/<attachment-uuid>
```

要求：

- 原始 EML 保存为对象。
- 附件单独保存。
- D1 只保存对象键和 metadata。
- R2 写入失败时保留 D1/legacy raw 兜底，并记录 `storage_status=failed`。
- 提供可重复的 storage repair 任务；不要因未知结果自动重复写出站邮件。

V1 可以继续把邮件写入 `raw_mails` 作为上游兼容和故障兜底，但 Contact Inbox 不直接依赖其列表 API。

---

# 11. Unified Inbox API

新增接口建议：

```text
GET  /admin/contact/messages
GET  /admin/contact/messages/:id
POST /admin/contact/messages/:id/read
POST /admin/contact/messages/:id/unread
POST /admin/contact/messages/:id/spam
POST /admin/contact/messages/:id/not-spam
GET  /admin/contact/messages/:id/raw
GET  /admin/contact/attachments/:id
```

列表过滤：

```text
domain_id
mailbox_id
folder
is_read
from
to
subject
date_from
date_to
limit
cursor
```

要求：

- 使用服务端过滤。
- 默认 `limit=20`，最大 `100`。
- 优先 cursor pagination，排序键为 `received_at DESC, id DESC`。
- 列表只返回 preview 和 metadata。
- 详情接口才返回 text/html body。
- Raw 和附件接口必须验证 Admin 权限及记录归属。

建议新 Contact API 使用结构化 JSON 错误：

```json
{
  "ok": false,
  "error": {
    "code": "CONTACT_MAILBOX_DISABLED",
    "message": "Mailbox is disabled"
  }
}
```

不要改变 Legacy API 的响应格式。

---

# 12. Unified Inbox UI

Contact Hub 左侧：

```text
Inbox
├── All
├── Unread
├── Spam
└── Sent

Delivery
├── Failed
└── Unknown

Sites
├── Warhounds
├── Sandustry
├── OpenClawNav
├── Binary Code Translator
└── Other

Settings
├── Domains
├── Mailboxes
├── Providers
└── DNS Status
```

邮件列表：

```text
Site        From             Subject             Time
-----------------------------------------------------
Sandustry   john@gmail.com   Multiplayer issue   10:31
Warhounds   mike@gmail.com   Bug report           09:15
OpenClaw    abc@company.com  Partnership          Aug 29
```

要求：

- 桌面端左右分栏。
- 移动端列表 + Drawer。
- 可复用现有 MailBox 的交互，但不要继续复用完整 raw 列表数据链路。
- 未读有明确视觉状态。
- Site/Domain 显示名称来自 `contact_domains.name`。
- Reply Composer 的 From 只能从当前 Domain 的可发件 Mailbox 中选择，不能输入任意 From。
- Provider 未配置时禁用发送并说明原因。
- V1 不显示 Star、Archive、Snooze。

---

# 13. HTML 与附件安全

## 13.1 邮件 HTML

建立统一函数，例如：

```text
sanitizeMailHtml(html, remoteContentPolicy)
```

必须满足：

1. HTML 永远先 DOMPurify sanitize。
2. 默认移除 script、iframe、object、embed、meta、base、事件属性和危险 URL。
3. Contact Mode 默认阻止远程图片、CSS URL、Tracking Pixel。
4. 用户点击“加载远程图片”时，只改变远程资源策略，不能跳过 Sanitization。
5. iframe 渲染必须设置严格 `sandbox`；能用安全 Shadow DOM 时优先使用安全 Shadow DOM。
6. Sent HTML 使用同一安全渲染器。
7. 纯文本使用 `<pre>` 或 text binding，不进入 `v-html`。

Temp Mode 可以保留原有远程图片偏好，但 Sanitization 不得被绕过。

## 13.2 附件

附件下载响应至少包含：

```text
Content-Disposition: attachment
X-Content-Type-Options: nosniff
Cache-Control: private
```

要求：

- 文件名做安全编码。
- 禁止路径穿越。
- SVG/HTML 等可执行内容默认下载，不内联。
- 不暴露 R2 公共 URL。
- 使用短期签名或 Worker 鉴权代理。

## 13.3 CORS

不要继续让新的 Contact API 接受任意 Origin。

新增明确配置，例如：

```env
CONTACT_ALLOWED_ORIGINS=["https://mail.example.com"]
```

同源部署可直接只允许当前 Origin。

Legacy API 的 CORS 兼容行为不要在同一提交中大规模改变。

---

# 14. Provider 抽象

## 14.1 接口

```ts
type ProviderType = 'resend' | 'brevo' | 'smtp'

type DeliveryCertainty =
  | 'accepted'
  | 'rejected'
  | 'unknown'

interface OutboundProvider {
  readonly type: ProviderType

  send(
    message: OutboundMessage,
    config: ProviderRuntimeConfig
  ): Promise<ProviderSendResult>
}

interface ProviderSendResult {
  certainty: DeliveryCertainty
  providerMessageId?: string
  retryable: boolean
  errorClass?: string
  errorCode?: string
  errorMessage?: string
}
```

## 14.2 Provider 实现

V1：

```text
ResendProvider
BrevoProvider
SmtpProvider
```

兼容提取：

```text
CloudflareBindingProvider
```

可以用于 Legacy 发送，不要求进入 Contact V1 Provider 下拉框。

## 14.3 Legacy 兼容

从当前 `send_mail_api.ts` 抽取 Provider 实现后：

- 旧 `sendMail()` 的选择顺序保持不变。
- 旧 API 和发送余额行为保持不变。
- Contact Hub 使用新的显式 `ContactOutboundRouter`。
- 不让 Contact Provider Config 改变 Temp Mode 行为。

## 14.4 Secret Resolver

实现统一 Secret Resolver：

```ts
resolveSecret(env, reference)
```

规则：

- Secret Reference 必须匹配：`^CONTACT_[A-Z0-9_]{1,96}$`
- API 只能返回 `configured: true/false`。
- 不返回 Secret 值。
- 不在日志中输出完整 Provider Request Headers。
- 错误信息必须脱敏。

## 14.5 Provider Config 示例

Resend：

```json
{
  "config_json": {},
  "secret_refs_json": {
    "apiKey": "CONTACT_RESEND_MAIN_API_KEY"
  }
}
```

Brevo：

```json
{
  "config_json": {},
  "secret_refs_json": {
    "apiKey": "CONTACT_BREVO_MAIN_API_KEY"
  }
}
```

SMTP：

```json
{
  "config_json": {
    "host": "smtp.example.com",
    "port": 587,
    "starttls": true,
    "username": "contact@example.com"
  },
  "secret_refs_json": {
    "password": "CONTACT_SMTP_MAIN_PASSWORD"
  }
}
```

---

# 15. Outbound 状态机与幂等

## 15.1 状态机

```text
pending
   │
   │ atomic claim
   ▼
sending
   ├── Provider 明确接受 ───────→ sent
   ├── Provider 明确拒绝 ───────→ failed
   └── timeout / connection lost → unknown
```

## 15.2 原子领取

发送前必须使用 compare-and-set：

```text
只有成功从 pending/failed 转成 sending 的 Worker 才能调用 Provider
```

不得出现两个 Worker 同时发送同一 Outbound Message。

## 15.3 Idempotency

Contact Send API 必须支持 `Idempotency-Key`。

- UI 每次用户发送动作生成一个 UUID。
- D1 对 `idempotency_key` 加唯一约束。
- 双击发送返回已存在的 Outbound Message，不创建第二封。

## 15.4 Retry

`failed`：

- 可以人工 Retry。
- 在同一 Outbound Message 下创建新的 Attempt。
- 可以人工选择其他 Provider，但要记录实际 Attempt Provider。

`unknown`：

- 普通 Retry 按钮禁用。
- 不自动重发。
- Force Resend 必须二次确认。
- Force Resend 创建新的 Outbound Message、新的 Message-ID 和新的 idempotency key。
- 新记录通过 `force_resend_of_id` 指向原 Unknown 记录。
- 原记录继续保持 Unknown，避免伪装成已解决。

## 15.5 错误分类

至少区分：

```text
validation
configuration
authentication
rate_limit
provider_rejected
provider_server_error
network
network_timeout
unknown_response
storage
```

HTTP Provider：

- 明确 2xx：accepted
- 明确 4xx：通常 rejected；429 可 retryable
- 明确 5xx：rejected + retryable，除非连接状态不确定
- 请求发出后超时/连接中断：unknown

SMTP：

- DATA 后明确 2xx：accepted
- 明确 4xx/5xx：rejected
- DATA 提交期间连接断开或 timeout：unknown

## 15.6 Sent Log

Provider 接受成功后保存：

- Provider Type
- Provider Config ID
- Provider Message ID
- Attempt 时间
- 本地 Message-ID
- From/To/Subject
- sent_at

不要只保存当前 `sendbox.raw` JSON。

---

# 16. Reply 设计

Reply：

```text
To
→ 原邮件 Reply-To
→ 否则原邮件 From

From
→ 原邮件实际收件 Mailbox
→ 允许管理员切换到同 Domain 的其他 outbound_enabled Mailbox

Subject
→ 使用 Re:
→ 已有 Re: 时不重复添加

Headers
→ 新 Message-ID
→ In-Reply-To = 原 Message-ID
→ References = 原 References + 原 Message-ID
```

本地 Message-ID 建议：

```text
<uuid@domain>
```

要求：

- 防止 Header CRLF 注入。
- From 必须属于已启用 Contact Mailbox。
- Provider 必须属于该 Domain 的明确配置。
- 原 Mailbox 被禁用时，不静默换地址；提示管理员选择可用 Mailbox。
- V1 不支持 Outbound Attachment。

---

# 17. DNS 状态检查

V1 只读检查，不调用 Cloudflare API 修改 DNS。

至少显示：

```text
Inbound MX
SPF
DKIM
DMARC
```

## 17.1 MX

- 检查 Domain 是否存在 MX。
- 如果配置了期望 Cloudflare Email Routing MX，比较期望与观察值。
- 不在代码中把可能变化的 Provider 记录散落硬编码；使用可维护的 requirement 定义。

## 17.2 SPF

- 检查根域 TXT 是否存在单一有效 `v=spf1`。
- 多条 SPF 记录标记 Invalid。
- Provider 所需 include 从 Provider DNS Requirement 或管理员保存的预期记录读取。
- 不建议用户新建第二条 SPF，应提示合并。

## 17.3 DKIM

- DKIM selector 无法自动猜测。
- Provider Config 或 Domain DNS Requirement 必须保存 selector/record name。
- 根据预期 selector 检查 TXT/CNAME。

## 17.4 DMARC

检查：

```text
_dmarc.<domain>
```

是否存在以 `v=DMARC1` 开头的 TXT。

## 17.5 缓存

- DNS 结果缓存到 `contact_dns_checks`。
- 支持手动 Refresh。
- 默认缓存时间可配置，例如 1 小时。
- DNS 查询失败标记 Unknown，不标记 Invalid。

---

# 18. 分阶段执行计划

Codex 在每个 Phase 完成后必须：

1. 运行对应测试。
2. 修复失败，不带失败进入下一阶段。
3. 更新 `docs/contact-hub/PROGRESS.md`。
4. 创建本地提交。
5. 继续下一阶段，不等待用户确认。

只有以下情况可以中断 Goal：

- 需要真实第三方 Secret 才能继续，而 mock 无法覆盖。
- 需要生产 Cloudflare 权限才可完成。
- 当前工作区存在无法安全合并的用户未提交修改。
- 发现会导致数据损坏的架构冲突。

即便中断，也必须先完成所有不依赖该阻塞项的工作，并写清阻塞证据和下一条可执行命令。

---

## Phase 0 — 基线、分支与执行文档

### 任务

- 阅读 `AGENTS.md`、`CLAUDE.md`、现有测试说明。
- 核对 HEAD、remote、branch、dirty files。
- 核对当前代码与审计基线差异。
- 创建或切换 `contact-hub`。
- 不覆盖用户修改。
- 运行现有 Worker、Frontend、E2E 基线。
- 创建：
  - `docs/contact-hub/ARCHITECTURE.md`
  - `docs/contact-hub/PROGRESS.md`
  - `docs/contact-hub/SCHEMA.md`
  - `docs/contact-hub/OUTBOUND_STATE_MACHINE.md`
- 记录现有测试成功/失败和环境问题。

### 验收

- 未修改业务代码。
- 有明确基线测试结果。
- 当前实际 SHA 被写入 PROGRESS。
- 所有后续工作都在 `contact-hub`。

---

## Phase 1 — App Mode、后端封锁和私有入口

### 任务

- 新增统一 `resolveAppMode()`。
- `types.d.ts` 增加 Contact 环境配置。
- `/open_api/settings` 返回 `mode` 和 `capabilities`。
- Contact Mode 后端拒绝公共创建、注册、用户门户和公共发件 API。
- Contact Mode 检查管理员安全配置。
- 新增 `/hub` 和 Contact 独立 Layout。
- `/` 在 Contact Mode 进入 `/hub`。
- 隐藏广告、公共 Header 项、用户注册、临时邮箱首页。
- 暂不实现 Inbox 业务，仅提供受保护的空壳和设置状态。
- 新增 Temp/Contact 双模式测试。

### 验收

- Contact Mode 下直接请求公共 API 得到明确 403/404。
- 未认证不能访问 `/admin/contact/*`。
- Temp Mode 原路由和测试不回归。
- Contact Mode 不公开内部 Domain 列表。

---

## Phase 2 — 独立迁移、Domain 和 Mailbox

### 任务

- 实现 Contact Migration Runner。
- 创建：
  - `contact_schema_migrations`
  - `contact_domains`
  - `contact_mailboxes`
  - `contact_provider_configs`
- 实现 Domain CRUD。
- 实现 Mailbox CRUD。
- 新 Domain 默认可创建 `contact@domain`。
- 固定 Mailbox 同步到现有 `address` 表。
- 在 Legacy 删除和 Cleanup 中保护 Contact Mailbox。
- Domain 删除改为 soft disable 或 restricted delete。
- 新增 Domain/Mailbox 管理 UI。
- 增加 50 Domain 的 API 测试。

### 验收

- 新增 Domain 不修改 Worker `DOMAINS` 也能进入 Contact 业务配置。
- 不能创建跨 Domain Mailbox。
- Contact Mailbox 不会被 Legacy Cleanup 删除。
- Migration 重复执行不报错、不重复数据。
- Temp Mode 不读取 Contact Domain 作为公共创建域名。

---

## Phase 3 — Contact Inbound、MIME 索引与 R2

### 任务

- 创建：
  - `contact_messages`
  - `contact_attachments`
- 增加 `CONTACT_R2` Binding。
- 实现 R2 Object Store。
- Contact Mode 接管入站分支。
- 验证 Domain/Mailbox。
- MIME Parse Once。
- 保存 Header、Text、HTML、Preview、Attachment metadata。
- 保存 Raw EML 和附件到 R2。
- 保留 `raw_mails` 兼容/兜底引用。
- 实现 dedupe key 和唯一约束。
- Junk 进入 Spam Folder。
- 可靠持久化前不执行副作用。
- 增加 storage status 和 repair 基础能力。

### 验收

- Plain/HTML/Multipart/CID/Attachment 邮件都能正确收取。
- 重投相同 Message-ID 不产生重复 Contact Message。
- 无 Message-ID 也有稳定 fallback 去重。
- R2 失败时邮件不会完全丢失，状态可见。
- D1 基础保存失败时不触发 Auto Reply/Webhook/Telegram。
- Spam 邮件可查看，不直接消失。

---

## Phase 4 — Unified Inbox 和安全渲染

### 任务

- 实现 Message List/Detail/Read/Spam/Raw/Attachment API。
- 实现 cursor pagination。
- 实现 From/To/Subject/Domain/Mailbox/Date server-side filtering。
- 实现 Contact Sidebar、Message List、Message Detail。
- Contact Mode 默认 remote images off。
- 建立统一 Mail HTML Sanitization。
- 修复 Shadow DOM、iframe 和 Sent HTML 的不安全渲染路径。
- 附件鉴权下载和安全响应头。
- 不再让 Contact 列表前端逐封解析 MIME。

### 验收

- 列表响应不含 `raw`、`raw_blob`、完整 HTML、附件字节。
- 点击详情后才加载正文。
- 搜索跨页、跨 Domain 生效。
- 未读计数和状态正确。
- HTML 安全测试全部通过。
- Tracking Pixel 默认不请求。
- 附件不能越权访问。

---

## Phase 5 — Provider 抽象与配置

### 任务

- 抽取现有 Resend、SMTP、SEND_MAIL 实现为 Provider Adapter。
- 保持 Legacy `sendMail()` 原选择顺序和余额行为。
- 新增 `OutboundProvider` contract。
- 新增 Registry 和 Secret Resolver。
- 实现 ResendProvider。
- 实现 BrevoProvider。
- 实现 SmtpProvider。
- 实现 Contact Provider Config CRUD/UI。
- Domain 绑定默认 Provider Config。
- Provider 缺 Secret 时返回配置错误，不尝试发送。
- 使用 HTTP Mock 测试 Resend/Brevo，Mailpit 测试 SMTP。

### 验收

- Legacy E2E 发送行为不变。
- Contact Domain 只使用明确绑定的 Provider。
- 全局 Resend Token 不会覆盖 Contact Domain 的 SMTP 选择。
- Provider Message ID 和错误分类可获得。
- API、日志和测试输出中没有真实 Secret。

---

## Phase 6 — Outbound 状态机、Sent 与 Reply

### 任务

- 创建：
  - `contact_outbound_messages`
  - `contact_outbound_attempts`
- 实现 Send/Retry/Force Resend API。
- 实现 atomic claim。
- 实现 Idempotency-Key。
- 实现 `pending/sending/sent/failed/unknown`。
- 实现 Failed 人工 Retry。
- 实现 Unknown Force Resend 新记录。
- 实现 Sent/Failed/Unknown UI。
- Reply 使用 Reply-To、In-Reply-To、References。
- From 只能选择当前 Domain 的可用 Mailbox。
- 本地生成 Message-ID。
- 双击发送保护。

### 验收

- 同一 Idempotency-Key 只调用一次 Provider。
- 两个并发 Worker 只有一个能领取发送任务。
- 明确成功为 Sent。
- 明确失败为 Failed。
- Timeout 为 Unknown。
- Unknown 不自动重试。
- Force Resend 新建记录并关联原 Unknown。
- Mailpit 中 Reply Header 正确，可进入同一邮件线程。

---

## Phase 7 — DNS、CORS 和生产安全加固

### 任务

- 创建 `contact_dns_checks`。
- 实现 MX/SPF/DKIM/DMARC 查询、缓存和手动刷新。
- DKIM 使用明确 selector，不猜测。
- SPF 多记录标记 Invalid。
- 新 Contact API 使用同源/允许列表 CORS。
- Secret 和 Provider Error 日志脱敏。
- Contact Mode 生产 Admin 安全检查。
- 完整检查 Legacy Cleanup 对 Contact 数据的影响。
- 增加 Header CRLF、恶意文件名、HTML/SVG 附件测试。
- 增加 Provider 超时和网络断开测试。

### 验收

- DNS 失败为 Unknown，不误报 Invalid。
- 不产生第二条 SPF 建议。
- Contact API 不接受未允许 Origin。
- Secret 不进入响应、D1 或日志。
- Contact Mailbox 不被任何现有 Cleanup 删除。

---

## Phase 8 — 全量回归、文档与最终报告

### 任务

- 跑全量 Worker lint/build。
- 跑全量 Frontend test/build。
- 跑 Temp Mode E2E。
- 跑 Contact Mode E2E。
- 增加至少 50 Domain、1000 Message 的种子性能测试。
- 确认列表响应不随附件大小线性膨胀。
- 更新全部 Contact 文档。
- 写 `docs/contact-hub/FINAL_REPORT.md`。
- 输出环境变量、R2 Binding、Secret Reference 和手工 DNS 步骤。
- 输出生产迁移和回滚步骤，但不执行。
- 输出上游同步冲突热点。
- 确认工作区干净或只包含明确未提交文件。

### 验收

- 所有自动测试通过。
- 所有 V1 Definition of Done 有对应证据。
- 没有真实 Secret。
- 没有执行生产部署。
- 每个 Phase 有独立本地提交。

---

# 19. 测试计划

## 19.1 每阶段基础命令

Codex 必须根据实际 package manager 和仓库状态调整，但优先运行：

```bash
cd worker
pnpm install --frozen-lockfile
pnpm lint
pnpm build

cd ../frontend
pnpm install --frozen-lockfile
pnpm test
pnpm build

cd ../e2e
npm ci
npm test
```

不要因为 E2E 较慢而跳过最终全量测试。

## 19.2 Unit Tests

至少覆盖：

- App Mode 解析
- Contact capability gate
- Domain normalization
- Mailbox ownership
- Dedupe key
- Cursor pagination
- Secret Reference validation
- Provider Registry
- Provider error classification
- Outbound state transitions
- Atomic claim helper
- Idempotency behavior
- Reply Header generation
- HTML sanitization
- Remote content policy
- Safe attachment filename
- DNS record evaluation

## 19.3 Migration Tests

覆盖：

- 空数据库
- 现有上游 `v0.0.7` 数据库
- 重复 migrate
- 中途失败后重试
- 版本按顺序执行
- 不修改上游版本
- 不删除已有表/数据
- 旧 Contact 版本升级

## 19.4 Domain/Mailbox Tests

覆盖：

- 50 个 Domain
- 大小写标准化
- 重复 Domain
- 非法 Domain
- 跨 Domain Mailbox
- 重复地址
- 默认 Mailbox 唯一
- disabled Domain
- disabled Mailbox
- Legacy delete protection
- Legacy cleanup protection

## 19.5 Inbound Tests

邮件类型：

- Plain Text
- HTML
- Multipart Alternative
- 多语言 Charset
- 无 Subject
- 无 Message-ID
- 重复 Message-ID
- Reply-To
- In-Reply-To
- References
- 单附件
- 多附件
- CID Inline Image
- 恶意 MIME
- 大附件

故障注入：

- D1 raw insert failure
- Contact index insert failure
- R2 raw failure
- R2 attachment partial failure
- MIME parse failure
- Webhook failure
- Telegram failure
- Duplicate concurrent delivery

## 19.6 Provider Contract Tests

每个 Provider 使用同一契约：

- accepted
- validation failure
- auth failure
- rate limit
- provider 4xx
- provider 5xx
- malformed response
- timeout
- connection reset
- missing provider message id

测试环境：

- SMTP：Mailpit
- Resend：本地 HTTP Mock
- Brevo：本地 HTTP Mock
- 不调用真实 Provider

## 19.7 Concurrency / Idempotency

覆盖：

- 双击 Send
- 同 Idempotency-Key 并发请求
- 两个 Worker 并发 claim
- Failed Retry
- Failed Change Provider
- Unknown 普通 Retry 被拒绝
- Unknown Force Resend
- stale sending recovery → unknown

## 19.8 Browser E2E

覆盖：

- Contact login
- All Inbox
- Unread
- Spam
- Domain Filter
- Mailbox Filter
- From/To/Subject Search
- Date Range
- Message Detail
- HTML/Text
- Remote Image opt-in
- Attachment Download
- Reply
- Sent
- Failed
- Unknown
- Retry
- Force Resend
- Domain Settings
- Mailbox Settings
- Provider Settings
- DNS Status

## 19.9 Security Tests

覆盖：

- `<script>`
- event handler attributes
- `javascript:` URL
- SVG event
- iframe/srcdoc
- meta refresh
- base tag
- CSS `url()`
- CSS escaped remote URL
- Tracking Pixel
- CRLF Header injection
- path traversal filename
- HTML/SVG attachment
- cross-domain attachment access
- CORS untrusted Origin
- Secret exposure in API/log/D1

---

# 20. PROGRESS.md 格式

Codex 每个 Phase 更新：

```markdown
# Contact Hub Progress

## Baseline
- Branch:
- HEAD:
- Upstream HEAD:
- Working tree at start:
- Existing tests:

## Phase 0
- Status: completed / blocked / in_progress
- Commit:
- Files:
- Tests:
- Decisions:
- Remaining risks:

## Phase 1
...

## Manual production actions
- [ ] Create R2 bucket
- [ ] Add R2 binding
- [ ] Configure Worker Secrets
- [ ] Configure Cloudflare Email Routing
- [ ] Add DNS records
- [ ] Run production migration
```

不得把“代码写完”当作完成证据。测试结果、迁移结果和安全断言必须写入。

---

# 21. FINAL_REPORT.md 必须包含

1. 最终架构摘要
2. 当前分支和最终 HEAD
3. Phase 提交列表
4. 新增/修改的关键文件
5. 数据库表和迁移版本
6. API 列表
7. 环境变量和 R2 Binding
8. 所需 Worker Secret Reference
9. Provider 配置示例
10. Cloudflare Email Routing 手工配置步骤
11. DNS 手工配置步骤
12. 全量测试命令和实际结果
13. 安全修复清单
14. 已知限制
15. 不在 V1 的功能
16. 生产部署前 Checklist
17. 回滚方案
18. 上游同步策略和冲突热点
19. 未执行的生产操作
20. 下一步 V2 建议，但不得提前实现

---

# 22. 生产部署前 Checklist

Codex 只生成，不执行：

```text
[ ] contact-hub 分支已人工 Review
[ ] Temp Mode 回归通过
[ ] Contact Mode E2E 通过
[ ] D1 已备份
[ ] R2 Bucket 已创建
[ ] CONTACT_R2 Binding 已配置
[ ] ADMIN_PASSWORDS 或 ADMIN_USER_ROLE 已配置
[ ] DISABLE_ADMIN_PASSWORD_CHECK 未在生产开启
[ ] CONTACT_ALLOWED_ORIGINS 已配置
[ ] Provider Secrets 已通过 wrangler secret 设置
[ ] Provider Domain 已在第三方验证
[ ] Cloudflare Email Routing 已指向 Worker
[ ] 固定 Mailbox 已在 Contact Hub 创建
[ ] MX/SPF/DKIM/DMARC 状态已核对
[ ] Contact migration 已在预发布环境执行
[ ] Smoke Test 已通过
[ ] 回滚步骤已演练
```

---

# 23. 上游同步策略

目标结构：

```text
dreamhunter2333/main
        ↓
oyjq0000/main
上游镜像，不放产品代码
        ↓ reviewed merge
oyjq0000/contact-hub
长期产品分支
```

要求：

- 不修改现有上游同步语义，除非有独立、可审查理由。
- 上游同步到 `main` 后，通过人工审查合并到 `contact-hub`。
- 不自动把上游变更直接合并进生产分支。
- 记录以下热点文件：
  - `worker/src/worker.ts`
  - `worker/src/email/index.ts`
  - `worker/src/commom_api.ts`
  - `worker/src/types.d.ts`
  - `worker/src/common.ts`
  - `worker/src/scheduled.ts`
  - `worker/src/mails_api/send_mail_api.ts`
  - `frontend/src/App.vue`
  - `frontend/src/router/index.js`
  - `frontend/src/store/index.js`
  - `frontend/src/views/Header.vue`
  - `frontend/src/views/Admin.vue`
- 产品逻辑不得大量直接进入这些文件。
- 可独立向上游提交的通用改动应使用独立提交：
  - HTML Sanitization
  - Sent HTML 安全渲染
  - 列表不返回完整 raw
  - 插入后可靠获取 ID
  - Provider Adapter 抽取
  - 保存失败后停止副作用

---

# 24. Codex 执行纪律

- 不要只生成设计文档后停止。
- 不要在每个 Phase 询问“是否继续”。
- 不要跳过失败测试。
- 不要用临时 hack 伪造测试通过。
- 不要删除现有测试来消除失败。
- 不要修改测试断言以掩盖真实回归。
- 不要在 D1 写 Secret。
- 不要调用真实 Brevo/Resend。
- 不要部署生产。
- 不要 push。
- 不要在 `main` 开发。
- 不要自动 fallback Provider。
- 不要把 Timeout 当成 Failed。
- 不要在 Contact 列表返回完整 raw。
- 不要让 Contact 地址参加临时邮箱 Cleanup。
- 不要为了“代码整洁”重写整个上游项目。
- 发现不确定行为时，先写测试复现，再修改。
- 发现与文档冲突时，以安全、数据完整性和可上游同步为优先，并记录 ADR。

---

# 25. Goal 完成后的最终输出

Codex 最终回复必须简洁列出：

```text
Goal status: completed / partially blocked
Branch:
Final HEAD:
Phase commits:
Worker tests:
Frontend tests:
Temp E2E:
Contact E2E:
Security tests:
Migrations:
Production actions not executed:
Known limitations:
Final report path:
```

如果存在阻塞，不得只说“无法完成”。必须说明：

- 已完成内容
- 阻塞的准确文件/命令/错误
- 为什么 mock 不能继续覆盖
- 用户下一条需要执行的命令
- 阻塞解除后 Codex 应从哪个 Phase/Checklist 继续

---

# 26. 最终产品边界

完成后的 V1 应当是：

> 一个基于 Cloudflare Email Routing、Workers、D1、R2 和 Pages 的私有多域名网站联系邮箱中心；支持几十个网站统一收件、固定地址、服务端搜索、安全邮件查看、直接回复、按 Domain 显式选择 Brevo/Resend/SMTP、可审计发送状态，以及不会因未知结果自动重发的可靠 Outbound 模型。

它不是：

- 临时邮箱首页换皮
- 完整 IMAP 邮箱服务器
- 工单系统
- 客服 SaaS
- 自建 SMTP Server
- AI 自动回复系统

保持这个边界，完成 V1，再讨论 V2。
