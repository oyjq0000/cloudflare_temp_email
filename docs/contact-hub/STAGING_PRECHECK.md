# Contact Hub Staging 发布前预检

预检日期：2026-08-31（Asia/Shanghai）

审计基线：`contact-hub` / `a4902cdd190ea1752de01370a9593562e0a45d58`

执行分支：`codex/contact-hub-staging-preflight`

本报告只覆盖离线预检。执行期间没有 fetch/push、部署、远程 D1/R2 操作、Secret 变更、Email Routing 变更或 DNS 变更。

## 1. 结论

| 范围 | 结论 | 说明 |
| --- | --- | --- |
| Git 基线 | PASS | `contact-hub`、HEAD 和本地 `origin/contact-hub` 跟踪引用均为预期 SHA；初始 working tree 干净 |
| Worker | PASS | 41/41、lint、Wrangler 4.124.0 dry-run 通过 |
| Frontend | PASS | 67/67、Pages 同源构建通过；仅有既有的大 chunk 建议 |
| Docker Compose | PASS | `docker compose config --quiet` 通过；完整 E2E 196/196，失败列表为空 |
| Contact 迁移 | PASS | v1→v5 顺序、上游版本隔离和重复迁移 no-op 已由代码审计与 E2E 验证 |
| D1 备份/恢复工具链 | PASS | 本地非空 SQL 导出后恢复到独立 `--persist-to` 目录，恢复记录数为 1 |
| 安全与 Provider 不变量 | PASS | 管理员认证、精确 CORS、Secret Reference、Domain 显式 Provider、Unknown 不自动重试均有实现与测试证据 |
| staging 远程资源 | NOT VERIFIED | 本任务禁止访问/修改远程 Cloudflare；资源身份、域名和 provider sandbox 必须人工提供并核对 |
| staging 上线 | **NO-GO** | 离线包已通过，但缺少第 5 节参数，且第 6 节 Cloudflare 人工步骤尚未执行 |

上线状态只有在所有人工输入已冻结、所有 staging 资源被证明与 production 不同、`STAGING_RUNBOOK.md` 的远程检查全部通过后，才能由发布负责人改为 Go。

## 2. Git 与远端引用

### 已自动验证

- 长期产品分支：`contact-hub`。
- 基线 HEAD：`a4902cdd190ea1752de01370a9593562e0a45d58`。
- 本地 `refs/remotes/origin/contact-hub`：`a4902cdd190ea1752de01370a9593562e0a45d58`。
- 初始状态：`## contact-hub...origin/contact-hub`，无 tracked/untracked 修改。
- `origin`：`https://github.com/oyjq0000/cloudflare_temp_email.git`。
- `upstream`：`https://github.com/dreamhunter2333/cloudflare_temp_email.git`。
- `main` 为上游镜像，当前位于 `70206c61efa723ef24143eca1d27449ce98a6e0c`；没有在 `main` 上开发。

本任务未执行 `git fetch`。因此对 `origin/contact-hub` 的结论是本地跟踪引用的离线核验，不宣称它是远端服务器的实时查询结果。

## 3. 已自动验证

### 3.1 Worker、Pages、D1、R2、管理员认证与 CORS

| 检查项 | 自动证据 | 预检结论 |
| --- | --- | --- |
| Worker 入口 | `worker/src/worker.ts` | Contact 路由、Contact CORS、管理员认证和 Email Worker 均挂载 |
| Contact 模式 | `worker/src/app_mode.ts` | 只有显式 `CONTACT_MAIL_MODE=true` 才启用；公共邮箱、注册、用户门户和公共发信被后端封锁 |
| 管理员认证 | `worker/src/app_mode.ts`、`worker/src/worker.ts` | 必须有 `ADMIN_PASSWORDS` 或 `ADMIN_USER_ROLE`；非 E2E 环境拒绝绕过管理员密码检查 |
| CORS | `worker/src/contact/cors.ts` | 同源或精确 allowlist；拒绝 `*`、路径、凭据、query/hash；preflight 只允许前端实际使用的 headers |
| D1 | `DB` binding | Contact 迁移独立记录，但依赖上游 `address`、`raw_mails` 等基础表先初始化 |
| R2 | `CONTACT_R2` binding | 原始 EML/附件使用服务端生成 key；无 binding 会报告不可用，Go 门槛必须检查 `bindingAvailable=true` |
| Pages | `frontend/.env.pages`、Pages middleware | 同源构建的 `VITE_API_BASE` 为空；`BACKEND` service binding 转发 API 路径 |
| Secret 存储 | Secret resolver | D1 只保存匹配 `^CONTACT_[A-Z0-9_]{1,96}$` 的引用名，API 只返回 configured 布尔值 |

### 3.2 staging 隔离审计

- 仓库没有 tracked `env.staging` Worker 配置，也没有可直接部署的 staging Pages 配置。
- 被忽略的本地 `worker/wrangler.toml` 使用 `local-*` D1/R2 名称、localhost Origin 和 `E2E_TEST_MODE=true`。它只适合本地测试，**不得部署到 staging**。
- tracked `pages/wrangler.toml` 的 service binding 明确写有 `environment = "production"`，**不得用于 staging**。
- tracked Worker template 仍包含通用 `xxx` 占位符，并非 staging 清单。
- 本次命令只使用本地 Miniflare/Docker/Mailpit 和 fake E2E 配置；未读取或调用真实 Provider Secret。
- 在没有 staging/production 资源清单可比较前，不能声称远程 staging 已与 production 隔离；该比较是 Go 的人工硬门槛。

### 3.3 Contact v1–v5 迁移

| 顺序 | 名称 | 主要对象 |
| --- | --- | --- |
| 1 | `contact_domain_mailbox_provider_core` | Provider Config、Domain、Mailbox |
| 2 | `contact_inbound_message_storage` | Message、Attachment、索引、去重与存储状态 |
| 3 | `contact_inbound_truncation_signal` | `content_truncated` |
| 4 | `contact_outbound_state_machine` | Outbound、Attempt、五态与幂等键 |
| 5 | `contact_dns_check_cache` | MX/SPF/DKIM/DMARC 检查缓存 |

验证结果：

- `CONTACT_MIGRATIONS` 按数字顺序执行，成功后才写入 `contact_schema_migrations`。
- runner 只执行未记录的版本；第二次 `POST /admin/contact/db/migrate` 返回 target 5、pending 空数组，不重复执行。
- Contact 版本表与上游 `settings.db_version` 独立；完整 E2E 同时检查上游版本不变。
- Contact 迁移是 additive；没有 downgrade、drop 或自动清理 R2。
- 新 D1 必须先完成上游 `/admin/db_initialize`/`/admin/db_migration`，再执行 Contact v1–v5。不能用 `wrangler d1 migrations apply` 代替 Contact API runner。

### 3.4 Provider 与出站状态机

- Resend：固定 endpoint；`secret_refs.apiKey` 必填。
- Brevo：固定 endpoint；`secret_refs.apiKey` 必填。
- SMTP：`host`、`port`、`secure`、`starttls`、可选 `username` 为非敏感配置；有 `username` 时 `secret_refs.password` 必填。
- 每个 Domain 只使用 `default_provider_config_id` 指向的 enabled Provider Config。Legacy `RESEND_TOKEN`、`SMTP_CONFIG`、`SEND_MAIL` 不能覆盖它。
- Provider 失败不会自动 fallback 到另一个 Provider。
- 显式 accepted→Sent；显式 rejected→Failed；超时/连接中断等不确定结果→Unknown。
- Failed 只能人工 Retry。Unknown 普通 Retry 返回冲突，绝不自动重试；Force Resend 必须显式确认、使用新 Idempotency-Key，并创建关联的新 intent/Message-ID。

### 3.5 Email Routing 与 DNS 顺序

代码只读 DNS，不修改 DNS。正确人工顺序为：

1. 确认使用专用非生产测试域名/zone。
2. 在 Contact Hub 先建立 Domain、enabled 固定 Mailbox，并显式绑定 enabled Provider Config。
3. 在 Provider 侧验证该 staging Domain，取得准确 SPF/DKIM 要求和显式 DKIM selector。
4. 在 Cloudflare 启用 Email Routing，使用 Dashboard 当前展示的 MX，不从文档复制过期目标。
5. 只把已存在的固定地址路由到 staging Email Worker。
6. 合并为唯一一条 SPF；不得新增第二条 `v=spf1`。
7. 发布 Provider 给出的 DKIM TXT/CNAME，并在 Contact Hub 明确输入 selector；V1 不猜 selector。
8. 发布唯一 `_dmarc.<domain>`，沿用经批准的策略和报告地址。
9. 在 Operations 录入预期片段并 Refresh；resolver 错误保持 Unknown，禁止自动改记录。
10. 每个 Domain 各做一次入站与出站 smoke。

## 4. 自动测试结果

```text
Worker:   41/41 passed
Lint:     passed
Wrangler: 4.124.0 deploy --dry-run passed
Bundle:   1265.96 KiB / gzip 348.22 KiB
Frontend: 5 files, 67/67 passed
Pages build: passed (existing large-chunk advisory only)
Compose config: passed
Docker Compose E2E: 196/196 passed in 2.5m
Playwright last run: status=passed, failedTests=[]
D1 local export/restore: passed, restored_rows=1
git diff --check: passed
```

E2E 完成后已执行 `docker compose down -v`，本任务创建的容器、网络和测试卷均已移除。

## 5. 需要发布负责人提供的非敏感参数

不得猜测以下值。填写后，将它们与 production 清单逐项比较；除 Cloudflare account/zone 在获批时可共享外，Worker、Pages、D1、R2、域名和 Provider 凭据必须是 staging 专用。

| 参数 | 要求 |
| --- | --- |
| Cloudflare account ID/名称 | 明确目标账户；非 Secret |
| staging zone ID/名称 | 专用非生产 zone 或经批准的隔离 zone |
| Worker name | 不得等于 production Worker；建议名称显式含 `staging` |
| Worker route/hostname | HTTPS staging hostname；不得覆盖 production route |
| Pages project name | 不得等于 production Pages project |
| Pages branch | 明确使用 staging/preview branch，不得使用现有 `production` 命令默认值 |
| Pages public origin | 精确 origin；不含路径、query、尾随应用路由或凭据 |
| D1 database name + ID | staging 专用；必须与 production name/ID 不同 |
| R2 bucket name | staging 专用 private bucket；不得有 public custom domain |
| 管理员认证方案 | `ADMIN_PASSWORDS` 或 `ADMIN_USER_ROLE`；只提供方案/role 名，不提供密码值 |
| Contact Domain 清单 | staging 专用域名；不得使用 production Domain |
| 固定 Mailbox local-part | 例如 `contact`、`support`、`privacy`、`security`、`hello`；逐个确认 |
| 每 Domain Provider 类型/配置名 | Resend、Brevo 或 SMTP，且每 Domain 只选一个 enabled config |
| SMTP 非敏感字段 | host、port、secure、starttls、username（若选 SMTP） |
| DKIM selector 与预期片段 | 每 Domain/Provider 明确提供；不猜测 |
| MX/SPF/DKIM/DMARC 预期片段 | 来自当前 Dashboard/Provider；DMARC policy 和报告地址需批准 |
| `CONTACT_DNS_CACHE_TTL_SECONDS` | 60–86400；默认建议 3600，需确认 |
| smoke 发件人/收件 sink | 受控测试地址，禁止真实客户收件人 |
| Failed/Unknown 故障夹具 | 可控 staging SMTP/provider sandbox，不得使用 production endpoint/credential |
| 维护窗口与观察期 | 包含 Email Routing smoke 和立即代码回滚时间 |
| 备份保管位置/保留期 | 访问受控，记录 timestamp 和校验信息 |
| 上一版 Worker/Pages revision | 回滚目标的不可变 revision/version ID |

## 6. Secret Reference 清单（仅名称）

以下是引用名，不含值：

- `JWT_SECRET`
- `ADMIN_PASSWORDS`（仅选择密码管理员认证时）
- `CONTACT_RESEND_MAIN_API_KEY`（选择 Resend 时）
- `CONTACT_BREVO_MAIN_API_KEY`（选择 Brevo 时）
- `CONTACT_SMTP_MAIN_PASSWORD`（SMTP 有 username 时）

多 Provider/多用途时可以采用同一 `CONTACT_*` 命名约束增加 staging 专用引用名，但引用与值的对应关系必须经人工审核。Provider API key/password 的值只能进入 staging Worker Secret；不得进入 Wrangler vars、D1、文档、日志、截图或仓库。Cloudflare 部署凭据同样不得写入仓库。

## 7. 需要人工在 Cloudflare 执行

- 创建或确认 staging 专用 D1、private R2、Worker 和 Pages project。
- 在部署前对 staging/production 的 account、name、ID、route、bucket、project、domain 做双人对照。
- 安装 `JWT_SECRET`、管理员认证 Secret 和所选 Provider 的 staging Secret。
- 部署 reviewed SHA 的 Worker/Pages；不得使用仓库现有 production Pages binding。
- 初始化/迁移上游 DB，再通过管理员 API 执行 Contact v1–v5 两次并确认第二次 no-op。
- 创建 Provider Config、Domain、Mailbox，并为每个 Domain 显式选择唯一 Provider。
- 在 Provider 控制台验证 staging Domain。
- 配置 Email Routing、固定地址规则和 MX/SPF/DKIM/DMARC。
- 运行 `STAGING_RUNBOOK.md` smoke、观察和回滚演练。

## 8. Go/No-Go 条件

### Go

只有同时满足以下条件才是 Go：

- 代码 SHA、Worker bundle 和 Pages artifact 均来自本报告基线或经重新完整验证的后续提交。
- staging Worker/Pages/D1/R2/route/domain 与 production 逐项不同并留有审核记录。
- `E2E_TEST_MODE` 缺省/false；`DISABLE_ADMIN_PASSWORD_CHECK=false`。
- 管理员认证有效，未授权请求为 401/403。
- 上游 DB 为代码要求版本，Contact current/target 都为 5，pending 为空；重复迁移 no-op。
- D1 备份非空且能恢复到 disposable 本地/恢复数据库。
- `CONTACT_R2` 存在、private、`bindingAvailable=true`，storage 无 unexplained degraded/fallback。
- CORS 只允许同源或已批准精确 Pages origin。
- Secret API 只显示 configured 布尔值，未发现值泄漏。
- 每个启用 Domain 有一个 enabled Provider Config；没有 Legacy fallback。
- Email Routing 只指向 staging Worker 的已启用固定 Mailbox。
- MX/SPF/DKIM/DMARC 人工核验通过；SPF 和 DMARC 各只有一条。
- 全部 smoke 通过，Unknown 没有被普通 Retry/自动重发。
- 回滚目标 revision、路由回退步骤和负责人已确认。

### No-Go

以下任一项立即 No-Go：

- 任一 staging name/ID/route/domain 与 production 相同或无法证明不同。
- 使用本地 E2E Wrangler 配置、tracked production Pages binding、production Provider Secret 或真实客户地址。
- 管理员安全 unhealthy、`E2E_TEST_MODE=true`、管理员 bypass、CORS wildcard/非法 origin。
- 迁移失败、版本不是 5、第二次迁移仍有 pending、上游版本被 Contact runner 改动。
- D1 备份/恢复失败，R2 binding 缺失/公开，或发生无法解释的数据丢失/重复。
- Provider 未显式绑定、Secret 未 configured、出现自动 fallback 或 Unknown 自动重试。
- HTML 消毒、远程图片阻止、附件下载安全头或鉴权任一失败。
- Email Routing/DNS 尚未人工确认，或 SPF/DMARC 重复、DKIM selector 未明确。
- Unknown 数量增长、stale Sending 未被人工处置，或有人计划在回滚期间重发 Unknown。
