export type DnsPurpose = 'mx' | 'spf' | 'dkim' | 'dmarc'
export type DnsStatus = 'valid' | 'missing' | 'invalid' | 'unknown'

export type DnsObservation = {
    values: string[]
    failed?: boolean
}

export type DnsEvaluation = {
    status: DnsStatus
    observed: string[]
    code: string
}

const clean = (value: string): string => value
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/"\s+"/g, '')
    .replace(/\.$/, '')
    .toLowerCase()

const normalized = (values: string[]): string[] => [...new Set(values.map(clean).filter(Boolean))]

const expectedMatches = (observed: string[], expected: string[]): boolean => {
    const wanted = normalized(expected)
    if (wanted.length === 0) return true
    return wanted.every(item => observed.some(value => value === item || value.includes(item)))
}

export const evaluateMx = (
    observation: DnsObservation,
    expected: string[] = [],
): DnsEvaluation => {
    const values = normalized(observation.values)
    if (observation.failed) return { status: 'unknown', observed: values, code: 'DNS_QUERY_FAILED' }
    if (values.length === 0) return { status: 'missing', observed: values, code: 'MX_MISSING' }
    if (!expectedMatches(values, expected)) return { status: 'invalid', observed: values, code: 'MX_MISMATCH' }
    return { status: 'valid', observed: values, code: 'MX_VALID' }
}

export const evaluateSpf = (
    observation: DnsObservation,
    expected: string[] = [],
): DnsEvaluation => {
    const values = normalized(observation.values)
    if (observation.failed) return { status: 'unknown', observed: values, code: 'DNS_QUERY_FAILED' }
    const spf = values.filter(value => value.startsWith('v=spf1'))
    if (spf.length === 0) return { status: 'missing', observed: spf, code: 'SPF_MISSING' }
    if (spf.length > 1) return { status: 'invalid', observed: spf, code: 'SPF_MULTIPLE_RECORDS' }
    if (!expectedMatches(spf, expected)) return { status: 'invalid', observed: spf, code: 'SPF_REQUIREMENT_MISSING' }
    return { status: 'valid', observed: spf, code: 'SPF_VALID' }
}

export const evaluateDkim = (
    observation: DnsObservation,
    expected: string[] = [],
): DnsEvaluation => {
    const values = normalized(observation.values)
    if (observation.failed && values.length === 0) {
        return { status: 'unknown', observed: values, code: 'DNS_QUERY_FAILED' }
    }
    if (values.length === 0) return { status: 'missing', observed: values, code: 'DKIM_MISSING' }
    if (!expectedMatches(values, expected)) return { status: 'invalid', observed: values, code: 'DKIM_MISMATCH' }
    return { status: 'valid', observed: values, code: 'DKIM_VALID' }
}

export const evaluateDmarc = (observation: DnsObservation, expected: string[] = []): DnsEvaluation => {
    const values = normalized(observation.values)
    if (observation.failed) return { status: 'unknown', observed: values, code: 'DNS_QUERY_FAILED' }
    const dmarc = values.filter(value => value.startsWith('v=dmarc1'))
    if (dmarc.length === 0) return { status: 'missing', observed: values, code: 'DMARC_MISSING' }
    if (dmarc.length > 1) return { status: 'invalid', observed: dmarc, code: 'DMARC_MULTIPLE_RECORDS' }
    if (!expectedMatches(dmarc, expected)) return { status: 'invalid', observed: dmarc, code: 'DMARC_MISMATCH' }
    return { status: 'valid', observed: dmarc, code: 'DMARC_VALID' }
}
