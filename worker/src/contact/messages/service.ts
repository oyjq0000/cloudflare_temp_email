import { ContactError } from '../errors'
import { decodeContactMessageCursor, encodeContactMessageCursor } from './cursor'

type MessageListRow = {
    id: number
    domain_id: number
    domain: string
    domain_name: string
    mailbox_id: number
    mailbox_address: string
    from_name: string | null
    from_address: string | null
    to_address: string
    subject: string
    preview: string
    folder: 'inbox' | 'spam'
    is_read: number
    spam_reason: string | null
    has_attachments: number
    storage_status: string
    received_at: string
}

export type MessageListFilters = {
    limit: number
    cursor?: { receivedAt: string, id: number }
    domainId?: number
    mailboxId?: number
    folder?: 'inbox' | 'spam'
    isRead?: boolean
    from?: string
    to?: string
    subject?: string
    dateFrom?: string
    dateTo?: string
}

const positiveId = (value: string | undefined, code: string): number | undefined => {
    if (value === undefined || value === '') return undefined
    const id = Number(value)
    if (!Number.isInteger(id) || id < 1) throw new ContactError(code, 'Filter id must be a positive integer')
    return id
}

const searchText = (value: string | undefined): string | undefined => {
    const normalized = value?.trim()
    if (!normalized) return undefined
    if (normalized.length > 200) throw new ContactError('CONTACT_FILTER_TOO_LONG', 'Message filter is too long')
    return normalized
}

const dateFilter = (value: string | undefined): string | undefined => {
    if (!value) return undefined
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) throw new ContactError('CONTACT_INVALID_DATE', 'Message date filter is invalid')
    return date.toISOString()
}

export const parseMessageListFilters = (query: Record<string, string>): MessageListFilters => {
    const limit = query.limit === undefined ? 20 : Number(query.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new ContactError('CONTACT_INVALID_LIMIT', 'Message limit must be between 1 and 100')
    }
    let folder: 'inbox' | 'spam' | undefined
    if (query.folder && query.folder !== 'all') {
        if (query.folder !== 'inbox' && query.folder !== 'spam') {
            throw new ContactError('CONTACT_INVALID_FOLDER', 'Message folder is invalid')
        }
        folder = query.folder
    }
    let isRead: boolean | undefined
    if (query.is_read !== undefined && query.is_read !== '') {
        if (!['true', 'false', '1', '0'].includes(query.is_read)) {
            throw new ContactError('CONTACT_INVALID_READ_FILTER', 'Read filter is invalid')
        }
        isRead = query.is_read === 'true' || query.is_read === '1'
    }
    const dateFrom = dateFilter(query.date_from)
    const dateTo = dateFilter(query.date_to)
    if (dateFrom && dateTo && dateFrom > dateTo) {
        throw new ContactError('CONTACT_INVALID_DATE_RANGE', 'date_from must not be after date_to')
    }
    return {
        limit,
        cursor: query.cursor ? decodeContactMessageCursor(query.cursor) : undefined,
        domainId: positiveId(query.domain_id, 'CONTACT_INVALID_DOMAIN_ID'),
        mailboxId: positiveId(query.mailbox_id, 'CONTACT_INVALID_MAILBOX_ID'),
        folder,
        isRead,
        from: searchText(query.from),
        to: searchText(query.to),
        subject: searchText(query.subject),
        dateFrom,
        dateTo,
    }
}

const buildWhere = (
    filters: MessageListFilters,
    options: { includeFolderRead: boolean, includeCursor: boolean },
) => {
    const conditions: string[] = ['1 = 1']
    const values: Array<string | number> = []
    if (filters.domainId) { conditions.push('m.domain_id = ?'); values.push(filters.domainId) }
    if (filters.mailboxId) { conditions.push('m.mailbox_id = ?'); values.push(filters.mailboxId) }
    if (options.includeFolderRead && filters.folder) { conditions.push('m.folder = ?'); values.push(filters.folder) }
    if (options.includeFolderRead && filters.isRead !== undefined) {
        conditions.push('m.is_read = ?'); values.push(filters.isRead ? 1 : 0)
    }
    if (filters.from) { conditions.push(`instr(lower(COALESCE(m.from_address, '')), lower(?)) > 0`); values.push(filters.from) }
    if (filters.to) { conditions.push(`instr(lower(m.to_address), lower(?)) > 0`); values.push(filters.to) }
    if (filters.subject) { conditions.push(`instr(lower(m.subject), lower(?)) > 0`); values.push(filters.subject) }
    if (filters.dateFrom) { conditions.push('m.received_at >= ?'); values.push(filters.dateFrom) }
    if (filters.dateTo) { conditions.push('m.received_at <= ?'); values.push(filters.dateTo) }
    if (options.includeCursor && filters.cursor) {
        conditions.push('(m.received_at < ? OR (m.received_at = ? AND m.id < ?))')
        values.push(filters.cursor.receivedAt, filters.cursor.receivedAt, filters.cursor.id)
    }
    return { sql: conditions.join(' AND '), values }
}

const serializeListRow = (row: MessageListRow) => ({
    ...row,
    is_read: Boolean(row.is_read),
    has_attachments: Boolean(row.has_attachments),
})

export const listContactMessages = async (db: D1Database, filters: MessageListFilters) => {
    const where = buildWhere(filters, { includeFolderRead: true, includeCursor: true })
    const { results } = await db.prepare(`
        SELECT m.id, m.domain_id, d.domain, d.name AS domain_name,
            m.mailbox_id, mb.address AS mailbox_address,
            m.from_name, m.from_address, m.to_address, m.subject, m.preview,
            m.folder, m.is_read, m.spam_reason, m.has_attachments,
            m.storage_status, m.received_at
        FROM contact_messages m
        JOIN contact_domains d ON d.id = m.domain_id
        JOIN contact_mailboxes mb ON mb.id = m.mailbox_id
        WHERE ${where.sql}
        ORDER BY m.received_at DESC, m.id DESC
        LIMIT ?
    `).bind(...where.values, filters.limit + 1).all<MessageListRow>()
    const rows = results || []
    const hasMore = rows.length > filters.limit
    const page = rows.slice(0, filters.limit)
    const last = page.at(-1)

    const countsWhere = buildWhere(filters, { includeFolderRead: false, includeCursor: false })
    const counts = await db.prepare(`
        SELECT
            SUM(CASE WHEN m.folder = 'inbox' THEN 1 ELSE 0 END) AS inbox,
            SUM(CASE WHEN m.folder = 'inbox' AND m.is_read = 0 THEN 1 ELSE 0 END) AS unread,
            SUM(CASE WHEN m.folder = 'spam' THEN 1 ELSE 0 END) AS spam
        FROM contact_messages m WHERE ${countsWhere.sql}
    `).bind(...countsWhere.values).first<{ inbox: number | null, unread: number | null, spam: number | null }>()

    return {
        results: page.map(serializeListRow),
        nextCursor: hasMore && last
            ? encodeContactMessageCursor({ receivedAt: last.received_at, id: last.id })
            : null,
        counts: {
            inbox: counts?.inbox || 0,
            unread: counts?.unread || 0,
            spam: counts?.spam || 0,
        },
    }
}

const parseJson = <T>(value: string, fallback: T): T => {
    try { return JSON.parse(value) as T } catch { return fallback }
}

export const getContactMessage = async (db: D1Database, id: number) => {
    const row = await db.prepare(`
        SELECT m.*, d.domain, d.name AS domain_name, mb.address AS mailbox_address
        FROM contact_messages m
        JOIN contact_domains d ON d.id = m.domain_id
        JOIN contact_mailboxes mb ON mb.id = m.mailbox_id
        WHERE m.id = ?
    `).bind(id).first<Record<string, unknown>>()
    if (!row) throw new ContactError('CONTACT_MESSAGE_NOT_FOUND', 'Contact message was not found', 404)
    const { results } = await db.prepare(`
        SELECT id, filename, mime_type, disposition, content_id, size, sha256, storage_status
        FROM contact_attachments WHERE message_id = ? ORDER BY id
    `).bind(id).all<Record<string, unknown>>()
    const {
        cc_json: ccJson,
        headers_json: headersJson,
        references_json: referencesJson,
        dedupe_key: _dedupeKey,
        raw_storage_key: _rawStorageKey,
        ...publicRow
    } = row
    return {
        ...publicRow,
        is_read: Boolean(row.is_read),
        has_attachments: Boolean(row.has_attachments),
        content_truncated: Boolean(row.content_truncated),
        cc: parseJson(String(ccJson || '[]'), []),
        headers: parseJson(String(headersJson || '[]'), []),
        references: parseJson(String(referencesJson || '[]'), []),
        attachments: results || [],
    }
}

export const setContactMessageRead = async (db: D1Database, id: number, isRead: boolean) => {
    const result = await db.prepare(`
        UPDATE contact_messages SET is_read = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(isRead ? 1 : 0, id).run()
    if (!result.success || result.meta.changes !== 1) {
        throw new ContactError('CONTACT_MESSAGE_NOT_FOUND', 'Contact message was not found', 404)
    }
    return getContactMessage(db, id)
}

export const setContactMessageSpam = async (db: D1Database, id: number, isSpam: boolean) => {
    const result = await db.prepare(`
        UPDATE contact_messages
        SET folder = ?, spam_reason = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).bind(isSpam ? 'spam' : 'inbox', isSpam ? 'manual' : null, id).run()
    if (!result.success || result.meta.changes !== 1) {
        throw new ContactError('CONTACT_MESSAGE_NOT_FOUND', 'Contact message was not found', 404)
    }
    return getContactMessage(db, id)
}
