import { ContactError } from '../errors.ts'
import {
    evaluateDkim,
    evaluateDmarc,
    evaluateMx,
    evaluateSpf,
    type DnsEvaluation,
    type DnsPurpose,
} from './evaluation.ts'

type DnsType = 'MX' | 'TXT' | 'CNAME'

export type DnsResolverResult = { values: string[], failed: boolean }
export type DnsResolver = {
    resolve(name: string, type: DnsType): Promise<DnsResolverResult>
}

type DnsExpected = Partial<Record<DnsPurpose, unknown>>
export type DnsRefreshInput = {
    dkim_selector?: unknown
    expected?: DnsExpected
}

type DomainRow = {
    id: number
    domain: string
    default_provider_config_id: number | null
}

type DnsCheckRow = {
    id: number
    domain_id: number
    provider_config_id: number | null
    record_purpose: DnsPurpose
    record_type: string
    record_name: string
    expected_json: string
    observed_json: string
    status: string
    checked_at: string
}

const parseJson = <T>(value: string, fallback: T): T => {
    try { return JSON.parse(value) as T } catch { return fallback }
}

const publicCheck = (row: DnsCheckRow, ttlSeconds: number) => {
    const observed = parseJson<{ values?: string[], code?: string }>(row.observed_json, {})
    const checkedAt = Date.parse(`${row.checked_at.replace(' ', 'T')}Z`)
    return {
        id: row.id,
        domainId: row.domain_id,
        providerConfigId: row.provider_config_id,
        purpose: row.record_purpose,
        recordType: row.record_type,
        recordName: row.record_name,
        expected: parseJson<string[]>(row.expected_json, []),
        observed: observed.values || [],
        status: row.status,
        code: observed.code || null,
        checkedAt: row.checked_at,
        stale: !Number.isFinite(checkedAt) || Date.now() - checkedAt >= ttlSeconds * 1_000,
    }
}

const domainRow = async (db: D1Database, domainId: number): Promise<DomainRow> => {
    const row = await db.prepare(`
        SELECT id, domain, default_provider_config_id FROM contact_domains WHERE id = ?
    `).bind(domainId).first<DomainRow>()
    if (!row) throw new ContactError('CONTACT_DOMAIN_NOT_FOUND', 'Contact Domain was not found', 404)
    return row
}

const expectedValues = (value: unknown, purpose: DnsPurpose): string[] => {
    if (value === undefined) return []
    if (!Array.isArray(value) || value.length > 20) {
        throw new ContactError('CONTACT_DNS_EXPECTED_INVALID', `${purpose.toUpperCase()} expected records must be an array`)
    }
    return value.map(item => {
        if (typeof item !== 'string' || !item.trim() || item.length > 512 || /[\r\n]/.test(item)) {
            throw new ContactError('CONTACT_DNS_EXPECTED_INVALID', `${purpose.toUpperCase()} expected record is invalid`)
        }
        return item.trim()
    })
}

const selectorValue = (value: unknown): string => {
    if (typeof value !== 'string') {
        throw new ContactError('CONTACT_DKIM_SELECTOR_REQUIRED', 'An explicit DKIM selector is required')
    }
    const selector = value.trim().toLowerCase()
    if (!/^[a-z0-9_](?:[a-z0-9_.-]{0,61}[a-z0-9_])?$/.test(selector) || selector.includes('..')) {
        throw new ContactError('CONTACT_DKIM_SELECTOR_INVALID', 'DKIM selector is invalid')
    }
    return selector
}

const query = async (resolver: DnsResolver, name: string, type: DnsType) => {
    try { return await resolver.resolve(name, type) } catch { return { values: [], failed: true } }
}

export class CloudflareDohResolver implements DnsResolver {
    constructor(private readonly fetcher: typeof fetch = fetch) {}

    async resolve(name: string, type: DnsType): Promise<DnsResolverResult> {
        const url = new URL('https://cloudflare-dns.com/dns-query')
        url.searchParams.set('name', name)
        url.searchParams.set('type', type)
        const response = await this.fetcher(url, {
            headers: { Accept: 'application/dns-json' },
        })
        if (!response.ok) return { values: [], failed: true }
        const body = await response.json<{
            Status?: number
            Answer?: Array<{ data?: unknown }>
        }>()
        const failed = body.Status !== undefined && ![0, 3].includes(body.Status)
        const values = (body.Answer || [])
            .map(answer => typeof answer.data === 'string' ? answer.data : '')
            .filter(Boolean)
        return { values, failed }
    }
}

type CheckDefinition = {
    purpose: DnsPurpose
    type: string
    name: string
    expected: string[]
    evaluation: DnsEvaluation
}

export const refreshDnsChecks = async (
    db: D1Database,
    domainId: number,
    input: DnsRefreshInput,
    resolver: DnsResolver = new CloudflareDohResolver(),
    ttlSeconds = 3600,
) => {
    const domain = await domainRow(db, domainId)
    const selector = selectorValue(input.dkim_selector)
    const expected = {
        mx: expectedValues(input.expected?.mx, 'mx'),
        spf: expectedValues(input.expected?.spf, 'spf'),
        dkim: expectedValues(input.expected?.dkim, 'dkim'),
        dmarc: expectedValues(input.expected?.dmarc, 'dmarc'),
    }
    const dkimName = `${selector}._domainkey.${domain.domain}`
    const dmarcName = `_dmarc.${domain.domain}`
    const [mx, rootTxt, dkimTxt, dkimCname, dmarcTxt] = await Promise.all([
        query(resolver, domain.domain, 'MX'),
        query(resolver, domain.domain, 'TXT'),
        query(resolver, dkimName, 'TXT'),
        query(resolver, dkimName, 'CNAME'),
        query(resolver, dmarcName, 'TXT'),
    ])
    const definitions: CheckDefinition[] = [
        { purpose: 'mx', type: 'MX', name: domain.domain, expected: expected.mx, evaluation: evaluateMx(mx, expected.mx) },
        { purpose: 'spf', type: 'TXT', name: domain.domain, expected: expected.spf, evaluation: evaluateSpf(rootTxt, expected.spf) },
        {
            purpose: 'dkim', type: 'TXT/CNAME', name: dkimName, expected: expected.dkim,
            evaluation: evaluateDkim({
                values: [...dkimTxt.values, ...dkimCname.values],
                failed: dkimTxt.failed || dkimCname.failed,
            }, expected.dkim),
        },
        { purpose: 'dmarc', type: 'TXT', name: dmarcName, expected: expected.dmarc, evaluation: evaluateDmarc(dmarcTxt, expected.dmarc) },
    ]
    const inserted = await db.batch(definitions.map(definition => db.prepare(`
        INSERT INTO contact_dns_checks(
            domain_id, provider_config_id, record_purpose, record_type, record_name,
            expected_json, observed_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        domain.id, domain.default_provider_config_id, definition.purpose, definition.type,
        definition.name, JSON.stringify(definition.expected), JSON.stringify({
            values: definition.evaluation.observed,
            code: definition.evaluation.code,
        }), definition.evaluation.status,
    )))
    if (!inserted.every(result => result.success)) {
        throw new ContactError('CONTACT_DNS_CACHE_FAILED', 'DNS results could not be cached', 500)
    }
    return getDnsChecks(db, domainId, ttlSeconds)
}

export const getDnsChecks = async (db: D1Database, domainId: number, ttlSeconds = 3600) => {
    const domain = await domainRow(db, domainId)
    const { results } = await db.prepare(`
        SELECT id, domain_id, provider_config_id, record_purpose, record_type, record_name,
            expected_json, observed_json, status, checked_at
        FROM contact_dns_checks WHERE domain_id = ? ORDER BY id DESC
    `).bind(domainId).all<DnsCheckRow>()
    const latest = new Map<DnsPurpose, DnsCheckRow>()
    for (const row of results || []) {
        if (!latest.has(row.record_purpose)) latest.set(row.record_purpose, row)
    }
    return {
        domain: { id: domain.id, domain: domain.domain },
        ttlSeconds,
        checks: (['mx', 'spf', 'dkim', 'dmarc'] as DnsPurpose[])
            .map(purpose => latest.get(purpose))
            .filter((row): row is DnsCheckRow => Boolean(row))
            .map(row => publicCheck(row, ttlSeconds)),
    }
}
