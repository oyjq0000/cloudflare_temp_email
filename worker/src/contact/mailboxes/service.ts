import { ContactError } from '../errors'
import { contactAddress, normalizeContactLocalPart } from '../domains/normalization'

type ContactMailboxRow = {
    id: number
    domain_id: number
    address_id: number
    local_part: string
    address: string
    display_name: string | null
    enabled: number
    inbound_enabled: number
    outbound_enabled: number
    is_default: number
    domain: string
    domain_name: string
    created_at: string
    updated_at: string
}

export type ContactMailboxInput = {
    domain_id?: unknown
    local_part?: unknown
    display_name?: unknown
    enabled?: unknown
    inbound_enabled?: unknown
    outbound_enabled?: unknown
    is_default?: unknown
}

const toBooleanInt = (value: unknown, fallback: boolean): number => {
    if (value === undefined) return fallback ? 1 : 0
    if (value === true || value === 1 || value === 'true') return 1
    if (value === false || value === 0 || value === 'false') return 0
    throw new ContactError('CONTACT_INVALID_BOOLEAN', 'Boolean field is invalid')
}

const displayName = (value: unknown): string | null => {
    if (value === undefined || value === null || value === '') return null
    if (typeof value !== 'string' || value.trim().length > 100) {
        throw new ContactError('CONTACT_INVALID_DISPLAY_NAME', 'Mailbox display name is invalid')
    }
    return value.trim()
}

const serializeMailbox = (row: ContactMailboxRow) => ({
    ...row,
    enabled: Boolean(row.enabled),
    inbound_enabled: Boolean(row.inbound_enabled),
    outbound_enabled: Boolean(row.outbound_enabled),
    is_default: Boolean(row.is_default),
})

const getMailboxRow = async (db: D1Database, id: number): Promise<ContactMailboxRow> => {
    const row = await db.prepare(`
        SELECT m.*, d.domain, d.name AS domain_name
        FROM contact_mailboxes m
        JOIN contact_domains d ON d.id = m.domain_id
        WHERE m.id = ?
    `).bind(id).first<ContactMailboxRow>()
    if (!row) throw new ContactError('CONTACT_MAILBOX_NOT_FOUND', 'Contact Mailbox was not found', 404)
    return row
}

const requireDomain = async (db: D1Database, id: number) => {
    const row = await db.prepare(`SELECT id, domain, name FROM contact_domains WHERE id = ?`)
        .bind(id).first<{ id: number, domain: string, name: string }>()
    if (!row) throw new ContactError('CONTACT_DOMAIN_NOT_FOUND', 'Contact Domain was not found', 404)
    return row
}

export const listMailboxes = async (db: D1Database, domainId?: number) => {
    const statement = domainId
        ? db.prepare(`
            SELECT m.*, d.domain, d.name AS domain_name
            FROM contact_mailboxes m JOIN contact_domains d ON d.id = m.domain_id
            WHERE m.domain_id = ? ORDER BY m.is_default DESC, m.local_part, m.id
        `).bind(domainId)
        : db.prepare(`
            SELECT m.*, d.domain, d.name AS domain_name
            FROM contact_mailboxes m JOIN contact_domains d ON d.id = m.domain_id
            ORDER BY d.name COLLATE NOCASE, m.is_default DESC, m.local_part, m.id
        `)
    const { results } = await statement.all<ContactMailboxRow>()
    return (results || []).map(serializeMailbox)
}

export const getMailbox = async (db: D1Database, id: number) => serializeMailbox(
    await getMailboxRow(db, id)
)

export const createMailbox = async (db: D1Database, input: ContactMailboxInput) => {
    const domainId = Number(input.domain_id)
    if (!Number.isInteger(domainId) || domainId < 1) {
        throw new ContactError('CONTACT_INVALID_DOMAIN_ID', 'A valid Domain id is required')
    }
    const domain = await requireDomain(db, domainId)
    const localPart = normalizeContactLocalPart(input.local_part)
    const address = contactAddress(localPart, domain.domain)
    const name = displayName(input.display_name)
    const enabled = toBooleanInt(input.enabled, true)
    const inboundEnabled = toBooleanInt(input.inbound_enabled, true)
    const outboundEnabled = toBooleanInt(input.outbound_enabled, true)
    const currentCount = await db.prepare(`SELECT COUNT(*) AS count FROM contact_mailboxes WHERE domain_id = ?`)
        .bind(domainId).first<number>('count') || 0
    const makeDefault = currentCount === 0 || toBooleanInt(input.is_default, false) === 1
    if (makeDefault && (enabled !== 1 || outboundEnabled !== 1)) {
        throw new ContactError(
            'CONTACT_DEFAULT_MAILBOX_MUST_BE_USABLE',
            'A default Mailbox must be enabled with outbound enabled',
            409,
        )
    }

    const statements: D1PreparedStatement[] = [
        db.prepare(`
            INSERT INTO address(name, source_meta) VALUES (?, 'contact-hub')
            ON CONFLICT(name) DO NOTHING
        `).bind(address),
    ]
    if (makeDefault) {
        statements.push(db.prepare(`
            UPDATE contact_mailboxes
            SET is_default = 0, updated_at = CURRENT_TIMESTAMP
            WHERE domain_id = ?
        `).bind(domainId))
    }
    statements.push(db.prepare(`
        INSERT INTO contact_mailboxes(
            domain_id, address_id, local_part, address, display_name,
            enabled, inbound_enabled, outbound_enabled, is_default
        )
        SELECT ?, a.id, ?, ?, ?, ?, ?, ?, ?
        FROM address a WHERE a.name = ?
    `).bind(
        domainId, localPart, address, name,
        enabled, inboundEnabled, outboundEnabled, makeDefault ? 1 : 0,
        address,
    ))
    if (makeDefault) {
        statements.push(db.prepare(`
            UPDATE contact_domains
            SET default_mailbox_id = (
                SELECT id FROM contact_mailboxes
                WHERE domain_id = ? AND is_default = 1
            ), updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).bind(domainId, domainId))
    }

    try {
        const results = await db.batch(statements)
        if (!results.every(result => result.success)) {
            throw new ContactError('CONTACT_MAILBOX_CREATE_FAILED', 'Contact Mailbox could not be created', 500)
        }
    } catch (error) {
        if ((error as Error).message?.includes('UNIQUE')) {
            throw new ContactError('CONTACT_MAILBOX_EXISTS', 'Contact Mailbox already exists', 409)
        }
        throw error
    }
    const row = await db.prepare(`SELECT id FROM contact_mailboxes WHERE address = ?`)
        .bind(address).first<{ id: number }>()
    if (!row) throw new ContactError('CONTACT_MAILBOX_CREATE_FAILED', 'Contact Mailbox could not be loaded', 500)
    return getMailbox(db, row.id)
}

export const updateMailbox = async (db: D1Database, id: number, input: ContactMailboxInput) => {
    const current = await getMailboxRow(db, id)
    if (input.domain_id !== undefined || input.local_part !== undefined) {
        throw new ContactError('CONTACT_MAILBOX_ADDRESS_IMMUTABLE', 'Mailbox Domain and local part cannot be changed', 409)
    }
    const enabled = input.enabled === undefined ? undefined : toBooleanInt(input.enabled, true)
    const inboundEnabled = input.inbound_enabled === undefined
        ? undefined : toBooleanInt(input.inbound_enabled, true)
    const outboundEnabled = input.outbound_enabled === undefined
        ? undefined : toBooleanInt(input.outbound_enabled, true)
    const requestedDefault = input.is_default === undefined
        ? undefined : toBooleanInt(input.is_default, false)

    const finalEnabled = enabled ?? current.enabled
    const finalOutboundEnabled = outboundEnabled ?? current.outbound_enabled
    if (requestedDefault === 1 && current.is_default !== 1) {
        if (current.enabled !== 1 || current.outbound_enabled !== 1) {
            throw new ContactError(
                'CONTACT_DEFAULT_MAILBOX_MUST_BE_USABLE',
                'Enable the Mailbox and outbound delivery before making it default',
                409,
            )
        }
        if (finalEnabled !== 1 || finalOutboundEnabled !== 1) {
            throw new ContactError(
                'CONTACT_DEFAULT_MAILBOX_MUST_BE_USABLE',
                'A default Mailbox must be enabled with outbound enabled',
                409,
            )
        }
    }

    if (
        current.is_default === 1
        && (enabled === 0 || outboundEnabled === 0 || requestedDefault === 0)
    ) {
        throw new ContactError(
            'CONTACT_DEFAULT_MAILBOX_CHANGE_REQUIRED',
            'Select another default Mailbox before disabling the current default',
            409,
        )
    }

    const assignments: string[] = []
    const values: Array<string | number | null> = []
    if (input.display_name !== undefined) {
        assignments.push('display_name = ?')
        values.push(displayName(input.display_name))
    }
    if (enabled !== undefined) { assignments.push('enabled = ?'); values.push(enabled) }
    if (inboundEnabled !== undefined) { assignments.push('inbound_enabled = ?'); values.push(inboundEnabled) }
    if (outboundEnabled !== undefined) { assignments.push('outbound_enabled = ?'); values.push(outboundEnabled) }

    const statements: D1PreparedStatement[] = []
    if (assignments.length > 0) {
        assignments.push('updated_at = CURRENT_TIMESTAMP')
        statements.push(db.prepare(
            `UPDATE contact_mailboxes SET ${assignments.join(', ')} WHERE id = ?`
        ).bind(...values, id))
    }
    if (requestedDefault === 1 && current.is_default !== 1) {
        statements.push(
            db.prepare(`
                UPDATE contact_mailboxes SET is_default = 0, updated_at = CURRENT_TIMESTAMP
                WHERE domain_id = ?
            `).bind(current.domain_id),
            db.prepare(`
                UPDATE contact_mailboxes SET is_default = 1, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).bind(id),
            db.prepare(`
                UPDATE contact_domains
                SET default_mailbox_id = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).bind(id, current.domain_id),
        )
    }
    if (statements.length === 0) return getMailbox(db, id)

    const results = await db.batch(statements)
    if (!results.every(result => result.success)) {
        throw new ContactError('CONTACT_MAILBOX_UPDATE_FAILED', 'Contact Mailbox could not be updated', 500)
    }
    return getMailbox(db, id)
}

export const disableMailbox = async (db: D1Database, id: number) => {
    const current = await getMailboxRow(db, id)
    if (current.is_default === 1) {
        throw new ContactError(
            'CONTACT_DEFAULT_MAILBOX_CHANGE_REQUIRED',
            'Select another default Mailbox before disabling the current default',
            409,
        )
    }
    const result = await db.prepare(`
        UPDATE contact_mailboxes
        SET enabled = 0, inbound_enabled = 0, outbound_enabled = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).bind(id).run()
    if (!result.success) throw new ContactError('CONTACT_MAILBOX_DISABLE_FAILED', 'Contact Mailbox could not be disabled', 500)
    return getMailbox(db, id)
}
