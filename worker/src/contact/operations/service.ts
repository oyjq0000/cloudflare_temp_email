import { getContactAdminSecurityStatus } from '../../app_mode.ts'
import { getContactMigrationStatus } from '../db/migration_runner.ts'
import { ContactError } from '../errors.ts'
import { getContactStorageStatus } from '../storage/service.ts'

const count = async (db: D1Database, sql: string, ...values: Array<string | number>) => (
    await db.prepare(sql).bind(...values).first<number>('count') || 0
)

export const getContactHealth = async (env: Bindings) => {
    const databaseProbe = await env.DB.prepare(`SELECT 1 AS ok`).first<number>('ok')
    if (databaseProbe !== 1) throw new ContactError('CONTACT_DB_UNHEALTHY', 'Contact database probe failed', 503)
    const migration = await getContactMigrationStatus(env.DB)
    const adminSecurity = getContactAdminSecurityStatus(env)
    if (migration.pending.length > 0) {
        return {
            ready: false,
            database: { healthy: true },
            migration,
            adminSecurity,
            storage: null,
            counts: null,
            dns: null,
        }
    }
    const [storage, inbox, unread, spam, outbound, domains, mailboxes, providers, staleSending] = await Promise.all([
        getContactStorageStatus(env.DB, env.CONTACT_R2),
        count(env.DB, `SELECT COUNT(*) AS count FROM contact_messages WHERE folder = 'inbox'`),
        count(env.DB, `SELECT COUNT(*) AS count FROM contact_messages WHERE folder = 'inbox' AND is_read = 0`),
        count(env.DB, `SELECT COUNT(*) AS count FROM contact_messages WHERE folder = 'spam'`),
        env.DB.prepare(`SELECT status, COUNT(*) AS count FROM contact_outbound_messages GROUP BY status`)
            .all<{ status: string, count: number }>(),
        count(env.DB, `SELECT COUNT(*) AS count FROM contact_domains`),
        count(env.DB, `SELECT COUNT(*) AS count FROM contact_mailboxes`),
        count(env.DB, `SELECT COUNT(*) AS count FROM contact_provider_configs WHERE enabled = 1`),
        count(env.DB, `
            SELECT COUNT(*) AS count FROM contact_outbound_messages
            WHERE status = 'sending' AND sending_at < datetime('now', '-15 minutes')
        `),
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
    return {
        ready: adminSecurity.secure && migration.pending.length === 0,
        database: { healthy: true },
        migration,
        adminSecurity,
        storage,
        counts: {
            domains, mailboxes, enabledProviders: providers,
            inbox, unread, spam,
            outbound: Object.fromEntries((outbound.results || []).map(row => [row.status, row.count])),
            staleSending,
        },
        dns: Object.fromEntries((dnsRows.results || []).map(row => [row.status, row.count])),
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
