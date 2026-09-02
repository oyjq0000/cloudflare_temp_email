import { getContactAdminSecurityStatus } from '../../app_mode.ts'
import { getContactMigrationStatus } from '../db/migration_runner.ts'
import { ContactError } from '../errors.ts'
import { countFailedContactSideEffects } from '../inbound/side_effects.ts'
import { computeContactReadiness } from './readiness.ts'
import { listProviderConfigs } from '../providers/config_service.ts'
import { resolveProviderSecrets } from '../providers/secret_resolver.ts'
import { getContactStorageStatus } from '../storage/service.ts'

const count = async (db: D1Database, sql: string, ...values: Array<string | number>) => (
    await db.prepare(sql).bind(...values).first<number>('count') || 0
)

const providerHasRequiredRuntimeSecret = (env: Bindings, provider: Awaited<ReturnType<typeof listProviderConfigs>>[number]) => {
    const values = resolveProviderSecrets(env, provider.secretRefs).values
    if (provider.providerType === 'smtp') return !provider.config.username || Boolean(values.password)
    return Boolean(values.apiKey)
}

export const getContactHealth = async (env: Bindings) => {
    const databaseProbe = await env.DB.prepare(`SELECT 1 AS ok`).first<number>('ok')
    if (databaseProbe !== 1) throw new ContactError('CONTACT_DB_UNHEALTHY', 'Contact database probe failed', 503)
    const migration = await getContactMigrationStatus(env.DB)
    const adminSecurity = getContactAdminSecurityStatus(env)
    const codeReady = true
    const adminReady = adminSecurity.secure
    const migrationReady = migration.pending.length === 0

    if (!migrationReady) {
        const storageReady = Boolean(env.CONTACT_R2)
        const warnings = [
            'Contact database migrations are pending',
            ...(!storageReady ? ['CONTACT_R2 is missing; raw storage would be degraded to D1 fallback'] : []),
        ]
        return {
            ready: false,
            codeReady,
            adminReady,
            migrationReady,
            storageReady,
            inboundReady: false,
            outboundReady: false,
            productionReady: false,
            database: { healthy: true },
            migration,
            adminSecurity,
            storage: null,
            counts: null,
            dns: null,
            warnings,
        }
    }

    const providersList = await listProviderConfigs(env.DB)
    const usableProviderIds = providersList
        .filter(provider => provider.enabled && providerHasRequiredRuntimeSecret(env, provider))
        .map(provider => provider.id)
    const usableProviderDomainCount = usableProviderIds.length > 0
        ? await count(env.DB, `
            SELECT COUNT(*) AS count FROM contact_domains
            WHERE enabled = 1 AND default_provider_config_id IN (${usableProviderIds.map(() => '?').join(',')})
        `, ...usableProviderIds)
        : 0

    const [
        storage, inbox, unread, spam, outbound, domains, enabledDomains, mailboxes,
        inboundMailboxes, outboundMailboxes, enabledProviders, staleSending,
        invalidDefaultMailboxCount, multipleDefaultMailboxCount, danglingDefaultMailboxCount,
        sideEffectFailed,
    ] = await Promise.all([
        getContactStorageStatus(env.DB, env.CONTACT_R2),
        count(env.DB, `SELECT COUNT(*) AS count FROM contact_messages WHERE folder = 'inbox'`),
        count(env.DB, `SELECT COUNT(*) AS count FROM contact_messages WHERE folder = 'inbox' AND is_read = 0`),
        count(env.DB, `SELECT COUNT(*) AS count FROM contact_messages WHERE folder = 'spam'`),
        env.DB.prepare(`SELECT status, COUNT(*) AS count FROM contact_outbound_messages GROUP BY status`)
            .all<{ status: string, count: number }>(),
        count(env.DB, `SELECT COUNT(*) AS count FROM contact_domains`),
        count(env.DB, `SELECT COUNT(*) AS count FROM contact_domains WHERE enabled = 1`),
        count(env.DB, `SELECT COUNT(*) AS count FROM contact_mailboxes`),
        count(env.DB, `
            SELECT COUNT(*) AS count FROM contact_mailboxes m
            JOIN contact_domains d ON d.id = m.domain_id
            WHERE d.enabled = 1 AND d.inbound_enabled = 1
              AND m.enabled = 1 AND m.inbound_enabled = 1
        `),
        count(env.DB, `
            SELECT COUNT(*) AS count FROM contact_mailboxes m
            JOIN contact_domains d ON d.id = m.domain_id
            WHERE d.enabled = 1 AND m.enabled = 1 AND m.outbound_enabled = 1
        `),
        count(env.DB, `SELECT COUNT(*) AS count FROM contact_provider_configs WHERE enabled = 1`),
        count(env.DB, `
            SELECT COUNT(*) AS count FROM contact_outbound_messages
            WHERE status = 'sending' AND sending_at < datetime('now', '-15 minutes')
        `),
        count(env.DB, `
            SELECT COUNT(*) AS count FROM contact_mailboxes
            WHERE is_default = 1 AND (enabled = 0 OR outbound_enabled = 0)
        `),
        count(env.DB, `
            SELECT COUNT(*) AS count FROM (
                SELECT domain_id FROM contact_mailboxes
                WHERE is_default = 1 GROUP BY domain_id HAVING COUNT(*) > 1
            )
        `),
        count(env.DB, `
            SELECT COUNT(*) AS count FROM contact_domains d
            WHERE d.default_mailbox_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM contact_mailboxes m
                WHERE m.id = d.default_mailbox_id AND m.domain_id = d.id AND m.is_default = 1
            )
        `),
        countFailedContactSideEffects(env.DB),
    ])
    const dnsRows = await env.DB.prepare(`
        SELECT d.status, COUNT(*) AS count
        FROM contact_dns_checks d
        JOIN (
            SELECT domain_id, record_purpose, MAX(id) AS id
            FROM contact_dns_checks GROUP BY domain_id, record_purpose
        ) latest ON latest.id = d.id
        GROUP BY d.status
    `).all<{ status: string, count: number }>()

    const storageReady = storage.bindingAvailable === true
    const severeConsistencyErrors = invalidDefaultMailboxCount
        + multipleDefaultMailboxCount
        + danglingDefaultMailboxCount
    const readiness = computeContactReadiness({
        adminReady,
        migrationReady,
        storageReady,
        enabledDomains,
        inboundMailboxes,
        enabledProviders,
        usableProviderDomains: usableProviderDomainCount,
        outboundMailboxes,
        severeConsistencyErrors,
    })
    const { inboundReady, outboundReady, productionReady } = readiness
    const warnings: string[] = []
    if (!storageReady) warnings.push('CONTACT_R2 is missing; raw storage is using degraded D1 fallback')
    if (enabledDomains === 0) warnings.push('No enabled Contact Domain exists')
    if (inboundMailboxes === 0) warnings.push('No enabled inbound Contact Mailbox exists')
    if (outboundMailboxes === 0) warnings.push('No enabled outbound Contact Mailbox exists')
    if (enabledProviders === 0) warnings.push('No enabled outbound Provider exists')
    if (enabledProviders > 0 && usableProviderIds.length === 0) warnings.push('Enabled Providers do not have required runtime secrets')
    if (enabledProviders > 0 && usableProviderDomainCount === 0) warnings.push('No enabled Domain is bound to a Provider with its required runtime secret')
    if (severeConsistencyErrors > 0) warnings.push('Default Mailbox consistency errors require repair')
    if (sideEffectFailed > 0) warnings.push('One or more persisted-message side effects failed')

    return {
        ready: productionReady,
        codeReady,
        adminReady,
        migrationReady,
        storageReady,
        inboundReady,
        outboundReady,
        productionReady,
        database: { healthy: true },
        migration,
        adminSecurity,
        storage,
        counts: {
            domains,
            enabledDomains,
            mailboxes,
            inboundMailboxes,
            outboundMailboxes,
            enabledProviders,
            usableProviders: usableProviderIds.length,
            usableProviderDomains: usableProviderDomainCount,
            inbox,
            unread,
            spam,
            outbound: Object.fromEntries((outbound.results || []).map(row => [row.status, row.count])),
            staleSending,
            sideEffectFailed,
            invalidDefaultMailboxCount,
            multipleDefaultMailboxCount,
            danglingDefaultMailboxCount,
        },
        dns: Object.fromEntries((dnsRows.results || []).map(row => [row.status, row.count])),
        warnings,
        protections: {
            contactMailboxCleanupProtected: true,
            unknownAutomaticRetry: false,
        },
    }
}

export const reconcileStaleSending = async (db: D1Database, olderThanMinutes: unknown = 15) => {
    const minutes = Number(olderThanMinutes)
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1_440) {
        throw new ContactError(
            'CONTACT_STALE_WINDOW_INVALID',
            'Stale sending window must be between 5 and 1440 minutes',
        )
    }
    const threshold = `-${minutes} minutes`
    const results = await db.batch([
        db.prepare(`
            UPDATE contact_outbound_attempts
            SET status = 'unknown', certainty = 'unknown', retryable = 0,
                error_class = 'network_timeout', error_code = 'STALE_SENDING_RECONCILED',
                error_message = 'Provider outcome is uncertain; automatic retry is disabled',
                finished_at = CURRENT_TIMESTAMP
            WHERE status = 'sending' AND outbound_message_id IN (
                SELECT id FROM contact_outbound_messages
                WHERE status = 'sending' AND sending_at < datetime('now', ?)
            )
        `).bind(threshold),
        db.prepare(`
            UPDATE contact_outbound_messages
            SET status = 'unknown', delivery_certainty = 'unknown',
                last_error_class = 'network_timeout', last_error_code = 'STALE_SENDING_RECONCILED',
                last_error_message = 'Provider outcome is uncertain; automatic retry is disabled',
                updated_at = CURRENT_TIMESTAMP
            WHERE status = 'sending' AND sending_at < datetime('now', ?)
        `).bind(threshold),
    ])
    if (!results.every(result => result.success)) {
        throw new ContactError('CONTACT_STALE_RECONCILE_FAILED', 'Stale sending records could not be reconciled', 500)
    }
    return {
        reconciled: results[1].meta.changes || 0,
        attemptsMarkedUnknown: results[0].meta.changes || 0,
        automaticRetry: false,
    }
}
