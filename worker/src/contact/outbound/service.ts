import { ContactError } from '../errors.ts'
import { getProviderConfig } from '../providers/config_service.ts'
import { ContactProviderRegistry, sendWithContactProvider } from '../providers/registry.ts'
import type { ProviderSendResult } from '../providers/types.ts'
import {
    bodyText,
    localMessageId,
    optionalHeaderText,
    replySubject,
    requireBody,
    safeEmailAddress,
    safeHeaderText,
} from './validation.ts'

type OutboundStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'unknown'

type OutboundRow = {
    id: number
    domain_id: number
    mailbox_id: number
    reply_to_message_id: number | null
    force_resend_of_id: number | null
    from_name: string | null
    from_address: string
    to_name: string | null
    to_address: string
    subject: string
    text_body: string
    html_body: string
    message_id_header: string
    in_reply_to_header: string | null
    references_json: string
    provider_config_id: number
    provider_message_id: string | null
    status: OutboundStatus
    delivery_certainty: string | null
    idempotency_key: string
    last_error_class: string | null
    last_error_code: string | null
    last_error_message: string | null
    created_at: string
    sending_at: string | null
    sent_at: string | null
    updated_at: string
}

type MailboxContext = {
    id: number
    domain_id: number
    address: string
    display_name: string | null
    domain: string
    domain_name: string
    default_from_name: string | null
    default_provider_config_id: number | null
}

export type CreateOutboundInput = {
    mailbox_id?: unknown
    to_name?: unknown
    to_address?: unknown
    subject?: unknown
    text_body?: unknown
    html_body?: unknown
    from_name?: unknown
}

const jsonArray = (value: string): string[] => {
    try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []
    } catch { return [] }
}

const publicOutbound = (row: OutboundRow, includeBody = true) => ({
    ...row,
    references: jsonArray(row.references_json),
    references_json: undefined,
    idempotency_key: undefined,
    ...(includeBody ? {} : { text_body: undefined, html_body: undefined }),
})

const getOutboundRow = async (db: D1Database, id: number): Promise<OutboundRow> => {
    const row = await db.prepare(`SELECT * FROM contact_outbound_messages WHERE id = ?`)
        .bind(id).first<OutboundRow>()
    if (!row) throw new ContactError('CONTACT_OUTBOUND_NOT_FOUND', 'Outbound message was not found', 404)
    return row
}

export const getOutbound = async (db: D1Database, id: number) => {
    const row = await getOutboundRow(db, id)
    const { results } = await db.prepare(`
        SELECT id, attempt_no, provider_config_id, provider_type, config_snapshot_json,
            status, certainty, provider_message_id, retryable, error_class, error_code,
            error_message, started_at, finished_at
        FROM contact_outbound_attempts WHERE outbound_message_id = ? ORDER BY attempt_no
    `).bind(id).all<Record<string, unknown>>()
    return {
        ...publicOutbound(row),
        attempts: (results || []).map(attempt => ({ ...attempt, retryable: Boolean(attempt.retryable) })),
    }
}

export const listOutbound = async (db: D1Database, query: Record<string, string>) => {
    const limit = query.limit === undefined ? 20 : Number(query.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new ContactError('CONTACT_INVALID_LIMIT', 'Outbound limit must be between 1 and 100')
    }
    const values: Array<string | number> = []
    const conditions = ['1 = 1']
    if (query.status) {
        if (!['pending', 'sending', 'sent', 'failed', 'unknown'].includes(query.status)) {
            throw new ContactError('CONTACT_INVALID_OUTBOUND_STATUS', 'Outbound status is invalid')
        }
        conditions.push('status = ?'); values.push(query.status)
    }
    for (const [key, column] of [['domain_id', 'domain_id'], ['mailbox_id', 'mailbox_id']] as const) {
        if (query[key]) {
            const id = Number(query[key])
            if (!Number.isInteger(id) || id < 1) throw new ContactError('CONTACT_INVALID_ID', 'Filter id is invalid')
            conditions.push(`${column} = ?`); values.push(id)
        }
    }
    if (query.cursor) {
        const cursor = Number(query.cursor)
        if (!Number.isInteger(cursor) || cursor < 1) throw new ContactError('CONTACT_INVALID_CURSOR', 'Outbound cursor is invalid')
        conditions.push('id < ?'); values.push(cursor)
    }
    const { results } = await db.prepare(`
        SELECT * FROM contact_outbound_messages
        WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT ?
    `).bind(...values, limit + 1).all<OutboundRow>()
    const rows = results || []
    const page = rows.slice(0, limit)
    const counts = await db.prepare(`
        SELECT
            SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END) AS unknown
        FROM contact_outbound_messages
    `).first<{ sent: number | null, failed: number | null, unknown: number | null }>()
    return {
        results: page.map(row => publicOutbound(row, false)),
        nextCursor: rows.length > limit ? page.at(-1)?.id || null : null,
        counts: { sent: counts?.sent || 0, failed: counts?.failed || 0, unknown: counts?.unknown || 0 },
    }
}

const mailboxContext = async (db: D1Database, mailboxId: unknown, expectedDomainId?: number) => {
    const id = Number(mailboxId)
    if (!Number.isInteger(id) || id < 1) throw new ContactError('CONTACT_INVALID_MAILBOX_ID', 'Mailbox id is invalid')
    const mailbox = await db.prepare(`
        SELECT m.id, m.domain_id, m.address, m.display_name, d.domain, d.name AS domain_name,
            d.default_from_name, d.default_provider_config_id
        FROM contact_mailboxes m JOIN contact_domains d ON d.id = m.domain_id
        WHERE m.id = ? AND m.enabled = 1 AND m.outbound_enabled = 1 AND d.enabled = 1
    `).bind(id).first<MailboxContext>()
    if (!mailbox) throw new ContactError('CONTACT_OUTBOUND_MAILBOX_UNAVAILABLE', 'Mailbox is not available for outbound mail', 409)
    if (expectedDomainId && mailbox.domain_id !== expectedDomainId) {
        throw new ContactError('CONTACT_REPLY_CROSS_DOMAIN', 'Reply Mailbox must belong to the original Domain', 409)
    }
    if (!mailbox.default_provider_config_id) {
        throw new ContactError('CONTACT_PROVIDER_NOT_ASSIGNED', 'Contact Domain has no Provider Config', 409)
    }
    await getProviderConfig(db, mailbox.default_provider_config_id)
    return mailbox
}

type Intent = {
    mailbox: MailboxContext
    replyToMessageId?: number | null
    forceResendOfId?: number | null
    toName: string | null
    toAddress: string
    subject: string
    textBody: string
    htmlBody: string
    fromName: string | null
    inReplyTo?: string | null
    references?: string[]
}

const insertIntent = async (db: D1Database, key: string, intent: Intent) => {
    const messageId = localMessageId(intent.mailbox.domain)
    try {
        const result = await db.prepare(`
            INSERT INTO contact_outbound_messages(
                domain_id, mailbox_id, reply_to_message_id, force_resend_of_id,
                from_name, from_address, to_name, to_address, subject, text_body, html_body,
                message_id_header, in_reply_to_header, references_json,
                provider_config_id, status, idempotency_key
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `).bind(
            intent.mailbox.domain_id, intent.mailbox.id, intent.replyToMessageId || null,
            intent.forceResendOfId || null, intent.fromName, intent.mailbox.address,
            intent.toName, intent.toAddress, intent.subject, intent.textBody, intent.htmlBody,
            messageId, intent.inReplyTo || null, JSON.stringify(intent.references || []),
            intent.mailbox.default_provider_config_id, key,
        ).run()
        if (!result.success) throw new ContactError('CONTACT_OUTBOUND_CREATE_FAILED', 'Outbound intent could not be stored', 500)
        return { row: await getOutboundRow(db, Number(result.meta.last_row_id)), duplicate: false }
    } catch (error) {
        if (!(error as Error).message?.includes('UNIQUE')) throw error
        const existing = await db.prepare(`SELECT * FROM contact_outbound_messages WHERE idempotency_key = ?`)
            .bind(key).first<OutboundRow>()
        if (!existing) throw error
        const same = existing.mailbox_id === intent.mailbox.id
            && existing.to_address === intent.toAddress
            && existing.subject === intent.subject
            && existing.text_body === intent.textBody
            && existing.html_body === intent.htmlBody
            && existing.reply_to_message_id === (intent.replyToMessageId || null)
            && existing.force_resend_of_id === (intent.forceResendOfId || null)
        if (!same) throw new ContactError('CONTACT_IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used for different content', 409)
        return { row: existing, duplicate: true }
    }
}

const mapState = (result: ProviderSendResult): 'sent' | 'failed' | 'unknown' => (
    result.certainty === 'accepted' ? 'sent' : result.certainty === 'rejected' ? 'failed' : 'unknown'
)

export const dispatchOutbound = async (
    env: Bindings,
    id: number,
    expectedState: 'pending' | 'failed',
    providerConfigId?: number,
    registry = new ContactProviderRegistry(),
) => {
    const before = await getOutboundRow(env.DB, id)
    if (before.status === 'unknown') {
        throw new ContactError('CONTACT_UNKNOWN_RETRY_FORBIDDEN', 'Unknown delivery cannot use normal Retry', 409)
    }
    const selectedProviderId = providerConfigId || before.provider_config_id
    const provider = await getProviderConfig(env.DB, selectedProviderId)
    if (!provider.enabled) throw new ContactError('CONTACT_PROVIDER_UNAVAILABLE', 'Provider Config is disabled', 409)
    const claim = await env.DB.prepare(`
        UPDATE contact_outbound_messages
        SET status = 'sending', provider_config_id = ?, sending_at = CURRENT_TIMESTAMP,
            delivery_certainty = NULL, last_error_class = NULL, last_error_code = NULL,
            last_error_message = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = ?
    `).bind(selectedProviderId, id, expectedState).run()
    if (!claim.success || claim.meta.changes !== 1) {
        return { outbound: await getOutbound(env.DB, id), claimed: false }
    }

    const attemptNo = (await env.DB.prepare(`
        SELECT COALESCE(MAX(attempt_no), 0) + 1 AS next FROM contact_outbound_attempts
        WHERE outbound_message_id = ?
    `).bind(id).first<number>('next')) || 1
    let attemptId: number
    try {
        const attempt = await env.DB.prepare(`
            INSERT INTO contact_outbound_attempts(
                outbound_message_id, attempt_no, provider_config_id, provider_type,
                config_snapshot_json, status
            ) VALUES (?, ?, ?, ?, ?, 'sending')
        `).bind(id, attemptNo, provider.id, provider.providerType, JSON.stringify({
            provider_type: provider.providerType,
            config: provider.config,
        })).run()
        if (!attempt.success) throw new Error('attempt insert failed')
        attemptId = Number(attempt.meta.last_row_id)
    } catch {
        await env.DB.prepare(`
            UPDATE contact_outbound_messages
            SET status = 'failed', delivery_certainty = 'rejected', last_error_class = 'storage',
                last_error_code = 'ATTEMPT_PERSIST_FAILED', last_error_message = 'Outbound attempt could not be stored',
                updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'sending'
        `).bind(id).run()
        return { outbound: await getOutbound(env.DB, id), claimed: true }
    }

    const row = await getOutboundRow(env.DB, id)
    const result = await sendWithContactProvider(env, provider, {
        fromName: row.from_name, fromAddress: row.from_address,
        toName: row.to_name, toAddress: row.to_address, subject: row.subject,
        textBody: row.text_body, htmlBody: row.html_body,
        messageId: row.message_id_header, inReplyTo: row.in_reply_to_header,
        references: jsonArray(row.references_json),
    }, registry)
    const state = mapState(result)
    const updates = await env.DB.batch([
        env.DB.prepare(`
            UPDATE contact_outbound_attempts
            SET status = ?, certainty = ?, provider_message_id = ?, retryable = ?,
                error_class = ?, error_code = ?, error_message = ?, finished_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'sending'
        `).bind(
            state, result.certainty, result.providerMessageId || null, result.retryable ? 1 : 0,
            result.errorClass || null, result.errorCode || null, result.errorMessage || null, attemptId,
        ),
        env.DB.prepare(`
            UPDATE contact_outbound_messages
            SET status = ?, delivery_certainty = ?, provider_message_id = ?,
                last_error_class = ?, last_error_code = ?, last_error_message = ?,
                sent_at = CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'sending'
        `).bind(
            state, result.certainty, result.providerMessageId || null,
            result.errorClass || null, result.errorCode || null, result.errorMessage || null,
            state, id,
        ),
    ])
    if (!updates.every(update => update.success)) {
        throw new ContactError('CONTACT_OUTBOUND_RESULT_PERSIST_FAILED', 'Provider result could not be stored', 500)
    }
    return { outbound: await getOutbound(env.DB, id), claimed: true }
}

export const createAndSendOutbound = async (
    env: Bindings, key: string, input: CreateOutboundInput, registry?: ContactProviderRegistry,
) => {
    const mailbox = await mailboxContext(env.DB, input.mailbox_id)
    const text = bodyText(input.text_body)
    const html = bodyText(input.html_body)
    requireBody(text, html)
    const inserted = await insertIntent(env.DB, key, {
        mailbox,
        toName: optionalHeaderText(input.to_name, 'To name', 200),
        toAddress: safeEmailAddress(input.to_address, 'To'),
        subject: safeHeaderText(input.subject, 'Subject', 1_000),
        textBody: text, htmlBody: html,
        fromName: optionalHeaderText(input.from_name, 'From name', 200)
            || mailbox.display_name || mailbox.default_from_name || mailbox.domain_name,
    })
    if (inserted.duplicate) return { outbound: await getOutbound(env.DB, inserted.row.id), duplicate: true, claimed: false }
    return { ...(await dispatchOutbound(env, inserted.row.id, 'pending', undefined, registry)), duplicate: false }
}

export const createAndSendReply = async (
    env: Bindings,
    originalId: number,
    key: string,
    input: Pick<CreateOutboundInput, 'mailbox_id' | 'text_body' | 'html_body' | 'from_name'>,
    registry?: ContactProviderRegistry,
) => {
    const original = await env.DB.prepare(`
        SELECT id, domain_id, mailbox_id, reply_to_address, from_address, subject,
            message_id_header, references_json
        FROM contact_messages WHERE id = ?
    `).bind(originalId).first<{
        id: number, domain_id: number, mailbox_id: number, reply_to_address: string | null,
        from_address: string | null, subject: string, message_id_header: string | null,
        references_json: string,
    }>()
    if (!original) throw new ContactError('CONTACT_MESSAGE_NOT_FOUND', 'Contact message was not found', 404)
    const mailbox = await mailboxContext(env.DB, input.mailbox_id || original.mailbox_id, original.domain_id)
    const to = original.reply_to_address || original.from_address
    if (!to) throw new ContactError('CONTACT_REPLY_ADDRESS_MISSING', 'Original message has no reply address', 409)
    const text = bodyText(input.text_body); const html = bodyText(input.html_body); requireBody(text, html)
    const references = [...jsonArray(original.references_json), original.message_id_header]
        .filter((item): item is string => Boolean(item))
        .filter((item, index, all) => all.indexOf(item) === index)
        .slice(-100)
    const inserted = await insertIntent(env.DB, key, {
        mailbox, replyToMessageId: original.id, toName: null, toAddress: safeEmailAddress(to, 'Reply-To'),
        subject: replySubject(original.subject), textBody: text, htmlBody: html,
        fromName: optionalHeaderText(input.from_name, 'From name', 200)
            || mailbox.display_name || mailbox.default_from_name || mailbox.domain_name,
        inReplyTo: original.message_id_header, references,
    })
    if (inserted.duplicate) return { outbound: await getOutbound(env.DB, inserted.row.id), duplicate: true, claimed: false }
    return { ...(await dispatchOutbound(env, inserted.row.id, 'pending', undefined, registry)), duplicate: false }
}

export const retryOutbound = (
    env: Bindings, id: number, providerConfigId?: number, registry?: ContactProviderRegistry,
) => dispatchOutbound(env, id, 'failed', providerConfigId, registry)

export const forceResendOutbound = async (
    env: Bindings, id: number, key: string, confirmed: boolean, registry?: ContactProviderRegistry,
) => {
    if (!confirmed) throw new ContactError('CONTACT_FORCE_RESEND_CONFIRMATION_REQUIRED', 'Force Resend requires explicit confirmation', 409)
    const original = await getOutboundRow(env.DB, id)
    if (original.status !== 'unknown') {
        throw new ContactError('CONTACT_FORCE_RESEND_NOT_ALLOWED', 'Only Unknown delivery can be force resent', 409)
    }
    const mailbox = await mailboxContext(env.DB, original.mailbox_id, original.domain_id)
    const inserted = await insertIntent(env.DB, key, {
        mailbox, forceResendOfId: original.id, replyToMessageId: original.reply_to_message_id,
        toName: original.to_name, toAddress: original.to_address, subject: original.subject,
        textBody: original.text_body, htmlBody: original.html_body, fromName: original.from_name,
        inReplyTo: original.in_reply_to_header, references: jsonArray(original.references_json),
    })
    if (inserted.duplicate) return { outbound: await getOutbound(env.DB, inserted.row.id), duplicate: true, claimed: false }
    return { ...(await dispatchOutbound(env, inserted.row.id, 'pending', undefined, registry)), duplicate: false }
}
