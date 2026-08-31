import { ContactError } from '../errors.ts'
import { resolveProviderSecrets, validateSecretReference } from './secret_resolver.ts'
import type { ProviderType } from './types.ts'

type ProviderConfigRow = {
    id: number
    name: string
    provider_type: ProviderType
    enabled: number
    config_json: string
    secret_refs_json: string
    created_at: string
    updated_at: string
}

export type ContactProviderConfig = {
    id: number
    name: string
    providerType: ProviderType
    enabled: boolean
    config: Record<string, unknown>
    secretRefs: Record<string, string>
    createdAt: string
    updatedAt: string
}

export type ProviderConfigInput = {
    name?: unknown
    provider_type?: unknown
    enabled?: unknown
    config?: unknown
    secret_refs?: unknown
}

const parseObject = (value: string): Record<string, unknown> => {
    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch { return {} }
}

const toConfig = (row: ProviderConfigRow): ContactProviderConfig => ({
    id: row.id,
    name: row.name,
    providerType: row.provider_type,
    enabled: Boolean(row.enabled),
    config: parseObject(row.config_json),
    secretRefs: Object.fromEntries(
        Object.entries(parseObject(row.secret_refs_json)).filter((entry): entry is [string, string] => (
            typeof entry[1] === 'string'
        )),
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
})

export const publicProviderConfig = (env: Bindings, config: ContactProviderConfig) => ({
    id: config.id,
    name: config.name,
    provider_type: config.providerType,
    enabled: config.enabled,
    config: config.config,
    secrets: resolveProviderSecrets(env, config.secretRefs).configured,
    created_at: config.createdAt,
    updated_at: config.updatedAt,
})

const providerType = (value: unknown): ProviderType => {
    if (value === 'resend' || value === 'brevo' || value === 'smtp') return value
    throw new ContactError('CONTACT_INVALID_PROVIDER_TYPE', 'Provider type is invalid')
}

const name = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) {
        throw new ContactError('CONTACT_INVALID_PROVIDER_NAME', 'Provider name is invalid')
    }
    return value.trim()
}

const enabled = (value: unknown, fallback: boolean): boolean => {
    if (value === undefined) return fallback
    if (value === true || value === 1 || value === 'true') return true
    if (value === false || value === 0 || value === 'false') return false
    throw new ContactError('CONTACT_INVALID_BOOLEAN', 'Boolean field is invalid')
}

const objectInput = (value: unknown, code: string): Record<string, unknown> => {
    if (value === undefined) return {}
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ContactError(code, 'Provider configuration must be an object')
    }
    return value as Record<string, unknown>
}

const rejectUnknownKeys = (value: Record<string, unknown>, keys: string[]) => {
    if (Object.keys(value).some(key => !keys.includes(key))) {
        throw new ContactError('CONTACT_INVALID_PROVIDER_CONFIG', 'Provider configuration contains unsupported fields')
    }
}

const normalizeConfig = (type: ProviderType, value: unknown): Record<string, unknown> => {
    const config = objectInput(value, 'CONTACT_INVALID_PROVIDER_CONFIG')
    if (type !== 'smtp') {
        rejectUnknownKeys(config, [])
        return {}
    }
    rejectUnknownKeys(config, [
        'host', 'port', 'secure', 'starttls', 'username',
        'socket_timeout_ms', 'response_timeout_ms',
    ])
    const host = typeof config.host === 'string' ? config.host.trim() : ''
    const port = Number(config.port)
    if (!host || host.length > 255 || /[\s\r\n]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new ContactError('CONTACT_INVALID_SMTP_ENDPOINT', 'SMTP host or port is invalid')
    }
    const username = config.username === undefined || config.username === ''
        ? undefined
        : typeof config.username === 'string' && config.username.length <= 255 && !/[\r\n]/.test(config.username)
            ? config.username
            : (() => { throw new ContactError('CONTACT_INVALID_SMTP_USERNAME', 'SMTP username is invalid') })()
    const timeout = (key: 'socket_timeout_ms' | 'response_timeout_ms') => {
        if (config[key] === undefined) return undefined
        const number = Number(config[key])
        if (!Number.isInteger(number) || number < 1_000 || number > 60_000) {
            throw new ContactError('CONTACT_INVALID_SMTP_TIMEOUT', 'SMTP timeout is invalid')
        }
        return number
    }
    return {
        host,
        port,
        secure: config.secure === true,
        starttls: config.starttls !== false,
        ...(username ? { username } : {}),
        ...(timeout('socket_timeout_ms') ? { socket_timeout_ms: timeout('socket_timeout_ms') } : {}),
        ...(timeout('response_timeout_ms') ? { response_timeout_ms: timeout('response_timeout_ms') } : {}),
    }
}

const normalizeSecretRefs = (type: ProviderType, value: unknown, config: Record<string, unknown>) => {
    const refs = objectInput(value, 'CONTACT_INVALID_SECRET_REFERENCES')
    const allowed = type === 'smtp' ? ['password'] : ['apiKey']
    rejectUnknownKeys(refs, allowed)
    const result: Record<string, string> = {}
    for (const [key, reference] of Object.entries(refs)) result[key] = validateSecretReference(reference)
    if (type !== 'smtp' && !result.apiKey) {
        throw new ContactError('CONTACT_PROVIDER_SECRET_REFERENCE_REQUIRED', 'Provider API key reference is required')
    }
    if (type === 'smtp' && config.username && !result.password) {
        throw new ContactError('CONTACT_PROVIDER_SECRET_REFERENCE_REQUIRED', 'SMTP password reference is required')
    }
    return result
}

export const getProviderConfig = async (db: D1Database, id: number): Promise<ContactProviderConfig> => {
    const row = await db.prepare(`SELECT * FROM contact_provider_configs WHERE id = ?`)
        .bind(id).first<ProviderConfigRow>()
    if (!row) throw new ContactError('CONTACT_PROVIDER_NOT_FOUND', 'Provider Config was not found', 404)
    return toConfig(row)
}

export const listProviderConfigs = async (db: D1Database): Promise<ContactProviderConfig[]> => {
    const { results } = await db.prepare(`
        SELECT * FROM contact_provider_configs ORDER BY enabled DESC, name COLLATE NOCASE, id
    `).all<ProviderConfigRow>()
    return (results || []).map(toConfig)
}

export const createProviderConfig = async (db: D1Database, input: ProviderConfigInput) => {
    const type = providerType(input.provider_type)
    const config = normalizeConfig(type, input.config)
    const refs = normalizeSecretRefs(type, input.secret_refs, config)
    const result = await db.prepare(`
        INSERT INTO contact_provider_configs(name, provider_type, enabled, config_json, secret_refs_json)
        VALUES (?, ?, ?, ?, ?)
    `).bind(name(input.name), type, enabled(input.enabled, true) ? 1 : 0, JSON.stringify(config), JSON.stringify(refs)).run()
    if (!result.success) throw new ContactError('CONTACT_PROVIDER_CREATE_FAILED', 'Provider Config could not be created', 500)
    const id = Number(result.meta.last_row_id)
    return getProviderConfig(db, id)
}

export const updateProviderConfig = async (db: D1Database, id: number, input: ProviderConfigInput) => {
    const current = await getProviderConfig(db, id)
    if (input.provider_type !== undefined && input.provider_type !== current.providerType) {
        throw new ContactError('CONTACT_PROVIDER_TYPE_IMMUTABLE', 'Provider type cannot be changed', 409)
    }
    const nextConfig = input.config === undefined ? current.config : normalizeConfig(current.providerType, input.config)
    const nextRefs = input.secret_refs === undefined
        ? current.secretRefs
        : normalizeSecretRefs(current.providerType, input.secret_refs, nextConfig)
    const nextEnabled = enabled(input.enabled, current.enabled)
    if (!nextEnabled && current.enabled) {
        const count = await db.prepare(`
            SELECT COUNT(*) AS count FROM contact_domains WHERE default_provider_config_id = ?
        `).bind(id).first<number>('count') || 0
        if (count > 0) throw new ContactError('CONTACT_PROVIDER_IN_USE', 'Provider Config is assigned to a Domain', 409)
    }
    const result = await db.prepare(`
        UPDATE contact_provider_configs
        SET name = ?, enabled = ?, config_json = ?, secret_refs_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).bind(
        input.name === undefined ? current.name : name(input.name),
        nextEnabled ? 1 : 0,
        JSON.stringify(nextConfig), JSON.stringify(nextRefs), id,
    ).run()
    if (!result.success) throw new ContactError('CONTACT_PROVIDER_UPDATE_FAILED', 'Provider Config could not be updated', 500)
    return getProviderConfig(db, id)
}

export const disableProviderConfig = (db: D1Database, id: number) => updateProviderConfig(db, id, { enabled: false })
