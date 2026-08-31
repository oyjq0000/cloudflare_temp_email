import { ContactError } from '../errors'
import { contactAddress, normalizeContactDomain } from './normalization'

type ContactDomainRow = {
    id: number
    domain: string
    name: string
    enabled: number
    inbound_enabled: number
    importance: string
    default_from_name: string | null
    default_mailbox_id: number | null
    default_provider_config_id: number | null
    mailbox_count?: number
    created_at: string
    updated_at: string
}

export type ContactDomainInput = {
    domain?: unknown
    name?: unknown
    enabled?: unknown
    inbound_enabled?: unknown
    importance?: unknown
    default_from_name?: unknown
    default_provider_config_id?: unknown
    create_default_mailbox?: unknown
}

const toBooleanInt = (value: unknown, fallback: boolean): number => {
    if (value === undefined) return fallback ? 1 : 0
    if (value === true || value === 1 || value === 'true') return 1
    if (value === false || value === 0 || value === 'false') return 0
    throw new ContactError('CONTACT_INVALID_BOOLEAN', 'Boolean field is invalid')
}

const optionalText = (value: unknown, maxLength: number): string | null => {
    if (value === undefined || value === null || value === '') return null
    if (typeof value !== 'string' || value.trim().length > maxLength) {
        throw new ContactError('CONTACT_INVALID_TEXT', 'Text field is invalid')
    }
    return value.trim()
}

const serializeDomain = (row: ContactDomainRow) => ({
    ...row,
    enabled: Boolean(row.enabled),
    inbound_enabled: Boolean(row.inbound_enabled),
})

const requireDomainName = (value: unknown, domain: string): string => {
    if (value === undefined || value === null || value === '') {
        if (domain) return domain
        throw new ContactError('CONTACT_INVALID_DOMAIN_NAME', 'Domain name is invalid')
    }
    if (typeof value !== 'string' || value.trim().length > 100) {
        throw new ContactError('CONTACT_INVALID_DOMAIN_NAME', 'Domain name is invalid')
    }
    return value.trim()
}

const normalizeImportance = (value: unknown): string => {
    if (value === undefined || value === null || value === '') return 'normal'
    if (typeof value !== 'string' || !/^[a-z0-9_-]{1,32}$/i.test(value.trim())) {
        throw new ContactError('CONTACT_INVALID_IMPORTANCE', 'Domain importance is invalid')
    }
    return value.trim().toLowerCase()
}

const normalizeProviderId = async (db: D1Database, value: unknown): Promise<number | null> => {
    if (value === undefined || value === null || value === '') return null
    const id = Number(value)
    if (!Number.isInteger(id) || id < 1) {
        throw new ContactError('CONTACT_INVALID_PROVIDER_ID', 'Provider Config id is invalid')
    }
    const provider = await db.prepare(`
        SELECT id FROM contact_provider_configs WHERE id = ? AND enabled = 1
    `).bind(id).first<{ id: number }>()
    if (!provider) throw new ContactError('CONTACT_PROVIDER_UNAVAILABLE', 'Provider Config is not enabled', 409)
    return id
}

const getDomainRow = async (db: D1Database, id: number): Promise<ContactDomainRow> => {
    const row = await db.prepare(`
        SELECT d.*,
            (SELECT COUNT(*) FROM contact_mailboxes m WHERE m.domain_id = d.id) AS mailbox_count
        FROM contact_domains d WHERE d.id = ?
    `).bind(id).first<ContactDomainRow>()
    if (!row) throw new ContactError('CONTACT_DOMAIN_NOT_FOUND', 'Contact Domain was not found', 404)
    return row
}

export const listDomains = async (db: D1Database) => {
    const { results } = await db.prepare(`
        SELECT d.*,
            (SELECT COUNT(*) FROM contact_mailboxes m WHERE m.domain_id = d.id) AS mailbox_count
        FROM contact_domains d
        ORDER BY d.enabled DESC, d.name COLLATE NOCASE, d.id
    `).all<ContactDomainRow>()
    return (results || []).map(serializeDomain)
}

export const getDomain = async (db: D1Database, id: number) => serializeDomain(
    await getDomainRow(db, id)
)

export const createDomain = async (db: D1Database, input: ContactDomainInput) => {
    const domain = normalizeContactDomain(input.domain)
    const name = requireDomainName(input.name, domain)
    const enabled = toBooleanInt(input.enabled, true)
    const inboundEnabled = toBooleanInt(input.inbound_enabled, true)
    const importance = normalizeImportance(input.importance)
    const defaultFromName = optionalText(input.default_from_name, 100)
    const defaultProviderConfigId = await normalizeProviderId(db, input.default_provider_config_id)
    const createDefaultMailbox = toBooleanInt(input.create_default_mailbox, true) === 1
    const defaultAddress = contactAddress('contact', domain)

    const statements: D1PreparedStatement[] = [
        db.prepare(`
            INSERT INTO contact_domains(
                domain, name, enabled, inbound_enabled, importance, default_from_name,
                default_provider_config_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(domain, name, enabled, inboundEnabled, importance, defaultFromName, defaultProviderConfigId),
    ]
    if (createDefaultMailbox) {
        statements.push(
            db.prepare(`
                INSERT INTO address(name, source_meta) VALUES (?, 'contact-hub')
                ON CONFLICT(name) DO NOTHING
            `).bind(defaultAddress),
            db.prepare(`
                INSERT INTO contact_mailboxes(
                    domain_id, address_id, local_part, address, display_name,
                    enabled, inbound_enabled, outbound_enabled, is_default
                )
                SELECT d.id, a.id, 'contact', ?, ?, 1, 1, 1, 1
                FROM contact_domains d JOIN address a ON a.name = ?
                WHERE d.domain = ?
            `).bind(defaultAddress, defaultFromName || name, defaultAddress, domain),
            db.prepare(`
                UPDATE contact_domains
                SET default_mailbox_id = (
                    SELECT m.id FROM contact_mailboxes m
                    WHERE m.domain_id = contact_domains.id AND m.is_default = 1
                ), updated_at = CURRENT_TIMESTAMP
                WHERE domain = ?
            `).bind(domain),
        )
    }

    try {
        const results = await db.batch(statements)
        if (!results.every(result => result.success)) {
            throw new ContactError('CONTACT_DOMAIN_CREATE_FAILED', 'Contact Domain could not be created', 500)
        }
    } catch (error) {
        if ((error as Error).message?.includes('UNIQUE')) {
            throw new ContactError('CONTACT_DOMAIN_EXISTS', 'Contact Domain already exists', 409)
        }
        throw error
    }
    const row = await db.prepare(`SELECT id FROM contact_domains WHERE domain = ?`)
        .bind(domain).first<{ id: number }>()
    if (!row) throw new ContactError('CONTACT_DOMAIN_CREATE_FAILED', 'Contact Domain could not be loaded', 500)
    return getDomain(db, row.id)
}

export const updateDomain = async (db: D1Database, id: number, input: ContactDomainInput) => {
    await getDomainRow(db, id)
    if (input.domain !== undefined) {
        throw new ContactError('CONTACT_DOMAIN_IMMUTABLE', 'A Contact Domain name cannot be changed', 409)
    }
    const assignments: string[] = []
    const values: Array<string | number | null> = []
    if (input.name !== undefined) {
        assignments.push('name = ?')
        values.push(requireDomainName(input.name, ''))
    }
    if (input.enabled !== undefined) {
        assignments.push('enabled = ?')
        values.push(toBooleanInt(input.enabled, true))
    }
    if (input.inbound_enabled !== undefined) {
        assignments.push('inbound_enabled = ?')
        values.push(toBooleanInt(input.inbound_enabled, true))
    }
    if (input.importance !== undefined) {
        assignments.push('importance = ?')
        values.push(normalizeImportance(input.importance))
    }
    if (input.default_from_name !== undefined) {
        assignments.push('default_from_name = ?')
        values.push(optionalText(input.default_from_name, 100))
    }
    if (input.default_provider_config_id !== undefined) {
        assignments.push('default_provider_config_id = ?')
        values.push(await normalizeProviderId(db, input.default_provider_config_id))
    }
    if (assignments.length === 0) return getDomain(db, id)

    assignments.push('updated_at = CURRENT_TIMESTAMP')
    const result = await db.prepare(
        `UPDATE contact_domains SET ${assignments.join(', ')} WHERE id = ?`
    ).bind(...values, id).run()
    if (!result.success) throw new ContactError('CONTACT_DOMAIN_UPDATE_FAILED', 'Contact Domain could not be updated', 500)
    return getDomain(db, id)
}

export const disableDomain = async (db: D1Database, id: number) => {
    await getDomainRow(db, id)
    const result = await db.prepare(`
        UPDATE contact_domains
        SET enabled = 0, inbound_enabled = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).bind(id).run()
    if (!result.success) throw new ContactError('CONTACT_DOMAIN_DISABLE_FAILED', 'Contact Domain could not be disabled', 500)
    return getDomain(db, id)
}
