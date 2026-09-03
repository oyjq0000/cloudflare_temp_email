# Contact Hub Staging 可执行上线 Runbook

Reviewed code baseline: `3ed8d828a8e157ef354a3c6e0d7019ec7a18b5d1`.

本 Runbook 使用 Wrangler Named Environments，并采用 Single Worker + Static Assets。所有远程命令必须显式 `--env staging`。不要把 Secret 值复制到本文、聊天、Git、PR、日志或截图。

## Phase 1 — 确认 Cloudflare Account

```text
cd worker
pnpm exec wrangler whoami
```

只回填非敏感 account 名称/ID。若账户不对，停止。

## Phase 2 — 创建 staging D1

```text
pnpm exec wrangler d1 create contact-mail-hub-staging
```

记录真实返回的：

```text
database_name
database_id
```

不要猜测 `database_id`，也不要把 production D1 ID 复制过来。

## Phase 3 — 创建 private staging R2

```text
pnpm exec wrangler r2 bucket create contact-mail-hub-staging
```

确认没有启用 `r2.dev`，也没有绑定 public custom domain。

## Phase 4 — 生成本地 staging Wrangler 配置

```text
cp wrangler.toml.template wrangler.toml
```

只在 gitignored `worker/wrangler.toml` 中把 `<STAGING_D1_ID>` 替换成 Phase 2 的真实 ID。production placeholder 可以继续保留，因为本轮不执行 production 命令。

检查：

```text
git status --short
```

`worker/wrangler.toml` 不应出现在 tracked changes 中。

## Phase 5 — 配置 staging Secrets

首次只配置：

```text
pnpm exec wrangler secret put JWT_SECRET --env staging
pnpm exec wrangler secret put ADMIN_PASSWORDS --env staging
```

两者都必须是 staging 专用值。不要先配置 Provider Secret。

## Phase 6 — 构建 frontend

```text
cd ../frontend
pnpm install --frozen-lockfile
pnpm test -- --run
pnpm run build:pages
cd ../worker
```

`frontend/.env.pages` 保持 `VITE_API_BASE=`，所以浏览器调用同源 Worker API。

## Phase 7 — staging dry-run

```text
pnpm run dry-run:staging
```

人工确认输出：

- Worker = `contact-mail-hub-staging`；
- D1 = `contact-mail-hub-staging`；
- R2 = `contact-mail-hub-staging`；
- Static Assets 绑定为 `ASSETS`；
- vars 中 `APP_ENV=staging`、`CONTACT_MAIL_MODE=true`；
- 不含 production 资源；
- 不含 `E2E_TEST_MODE`；
- 不含任何 Secret 值。

任一不符即停止。

## Phase 8 — 部署 Worker staging

```text
pnpm run deploy:staging
```

记录非敏感 Worker version 与 `workers.dev` URL。不要绑定 production route/custom domain。

## Phase 9 — 验证公开设置

检查：

```text
GET /health_check
GET /open_api/settings
```

Contact Mode 必须确认：`mode=contact`，且 `publicMailbox`、`publicAddressCreation`、`publicRegistration`、`publicSendMail`、`userPortal` 均为 false。

## Phase 10 — 初始化/迁移上游 D1

先检查：

```text
GET /admin/db_version
```

仅在响应提示需要时执行：

```text
POST /admin/db_initialize
POST /admin/db_migration
```

再次检查 `/admin/db_version`。本 reviewed baseline 的 code DB version 是 `v0.0.8`；若后续代码基线改变，以接口返回的 code version 为准，不硬猜版本。

### Phase 10.5 — 创建 staging D1 checkpoint

在 Contact migration 前导出一次已经完成上游初始化/迁移的 staging D1：

```text
pnpm exec wrangler d1 export contact-mail-hub-staging --remote --env staging --output <timestamp>-before-contact.sql
```

确认导出文件存在且非 0 字节，并保存到受控位置。若 staging D1 已有有价值数据，发布负责人还应在 disposable recovery DB 验证该 SQL 可恢复；验证失败则停止。

## Phase 11 — Contact schema v7

```text
GET  /admin/contact/db/version
POST /admin/contact/db/migrate
GET  /admin/contact/db/version
POST /admin/contact/db/migrate
GET  /admin/contact/db/version
```

最终必须满足：

```text
currentVersion=7
targetVersion=7
pending=[]
```

迁移 6 保留 sender-declared MIME Date 到 `sender_date`，并让 `received_at` 代表 trusted Worker receive time；迁移 7 增加 `contact_message_side_effects`。不要 downgrade/drop 这些字段或表。

## Phase 12 — Readiness

检查：

```text
GET /admin/contact/storage/status
GET /admin/contact/health
```

此时至少要求 `adminReady=true`、`migrationReady=true`、`storageReady=true`。尚未配置 Provider 时 `outboundReady=false` 可以接受。

## Phase 13 — 创建 Contact Domain / Mailbox

选择一个 approved staging 子域名，例如：

```text
mail-staging.<your-domain>
```

Web hostname 不得与邮件域名相同。先在 Contact Hub 创建 Domain，再创建固定 Mailbox，例如 `contact@mail-staging.<your-domain>`。

完成后重新检查 Health；此阶段仍不要改 MX/Email Routing。

## Phase 14 — 开启 Email Routing

只有 Worker、D1、R2、migration、admin、Domain、Mailbox 都确认后才进入 Cloudflare Email Routing。

规则：

- 使用 Dashboard 当下给出的 MX；
- 第一轮只创建固定地址规则，不启用 Catch-all；
- 目标必须是 `contact-mail-hub-staging` Email Worker；
- SPF 同一 hostname 只能有一个 `v=spf1`；
- DKIM selector 只能使用 Provider 实际给出的值；
- `_dmarc` 只保留一条，production policy 不由本 Runbook 自动决定。

## Phase 15 — 首个 Provider：Resend

先在 Resend 验证 staging 邮件域名并取得实际 SPF/DKIM 要求，然后设置：

```text
pnpm exec wrangler secret put CONTACT_RESEND_MAIN_API_KEY --env staging
```

在 Contact Hub 创建 `Staging Resend` Provider Config，secret reference 仅填写 `CONTACT_RESEND_MAIN_API_KEY`，再把 staging Domain 显式绑定到该 Provider。不要配置自动 fallback。

## Phase 16 — 第一次真实 Smoke Test

至少测试：

1. Gmail/Outlook -> staging fixed Mailbox；
2. Unified Inbox 可见，`received_at` 为服务器接收时间；
3. HTML script 不执行，Remote Images 默认阻止；
4. Attachment 同时有 D1 metadata、R2 object，且下载正常；
5. Reply 的 From、Message-ID、In-Reply-To、References 正确；
6. Resend 收件人实际收到回复，Provider Attempt 为 `sent`；
7. Spam 行为；
8. Failed Retry；
9. Unknown 的普通 Retry 被拒绝；
10. Force Resend 需要明确确认并创建新 Intent。

Resend smoke 全部通过后，才按需要继续 Brevo；Generic SMTP 最后测试。

## Phase 17 — 观察与 staging 报告

Smoke 完成后再次检查 `/admin/contact/health`、storage、failed/unknown/stale-sending 与 side-effect failures。只有没有未解释的 degraded/fallback、默认 Mailbox 一致性错误或未知重复发送风险时，才把 staging 标记为通过。

发布记录只保存非 Secret 信息，并使用下列结构：

```text
# Contact Hub Staging Deployment Report
Git: contact-hub SHA
Cloudflare: Account / Worker / workers.dev URL / D1 name+id / R2 bucket
Schema: Upstream DB Version / Contact Schema Version
Readiness: adminReady / migrationReady / storageReady / inboundReady / outboundReady / productionReady
Domain: staging Contact Domain / Mailbox
Provider: Provider Type / Secret configured true|false
DNS: MX / SPF / DKIM / DMARC status
Smoke: Inbound / HTML / Attachment / Reply / Outbound / Failed / Unknown
Rollback: Worker Version / D1 backup / R2
Production: NOT DEPLOYED
```

任何 Secret 值都不得进入报告。

## Rollback

记录当前 Worker version、Contact migration 前 D1 checkpoint 与 staging R2 identity。以下情况应停止并回滚：Worker/Assets 请求进入错误环境、D1/R2 指向 production、管理员安全门槛失效、migration/storage readiness 失败、入站重复/丢失、Unknown 被自动重发，或实际 Email Routing 指向非 staging Worker。

回滚优先顺序：暂停新增流量/Email Routing -> 回滚 Worker 到记录的上一版本 -> 保留 D1/R2 -> 复核 Health。不要删除 Contact schema v6/v7 数据，也不删除 R2 对象；只有确认数据损坏时才在维护窗口使用已验证 checkpoint 恢复 D1。

## Production stop

staging 全部验证完成后停止。最终报告必须明确：

```text
Production: NOT DEPLOYED
```

后续 production 发布需要新的明确授权，不能由 staging 成功自动触发。
