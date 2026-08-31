import { Context } from 'hono'

import { getBooleanValue } from '../../utils.ts'
import { contactErrorResponse, requireContactId } from '../errors.ts'
import {
    getDnsChecks,
    refreshDnsChecks,
    type DnsRefreshInput,
    type DnsResolver,
    type DnsResolverResult,
} from './service.ts'

const respond = (c: Context<HonoCustomType>, error: unknown) => {
    const response = contactErrorResponse(error)
    return c.json(response.body, response.status)
}

const ttl = (value: unknown): number => {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed >= 60 && parsed <= 86_400 ? parsed : 3_600
}

type MockAnswers = Record<string, { values?: string[], failed?: boolean }>

class MockDnsResolver implements DnsResolver {
    constructor(private readonly answers: MockAnswers) {}

    async resolve(name: string, type: 'MX' | 'TXT' | 'CNAME'): Promise<DnsResolverResult> {
        const answer = this.answers[`${name.toLowerCase()}|${type}`]
        return { values: answer?.values || [], failed: answer?.failed === true }
    }
}

const testResolver = (env: Bindings, input: DnsRefreshInput & { mock_answers?: unknown }): DnsResolver | undefined => {
    if (!getBooleanValue(env.E2E_TEST_MODE) || !input.mock_answers || typeof input.mock_answers !== 'object') {
        return undefined
    }
    return new MockDnsResolver(input.mock_answers as MockAnswers)
}

export const list = async (c: Context<HonoCustomType>) => {
    try {
        return c.json({
            ok: true,
            ...(await getDnsChecks(
                c.env.DB,
                requireContactId(c.req.param('id')),
                ttl(c.env.CONTACT_DNS_CACHE_TTL_SECONDS),
            )),
        })
    } catch (error) { return respond(c, error) }
}

export const refresh = async (c: Context<HonoCustomType>) => {
    try {
        const input = await c.req.json<DnsRefreshInput & { mock_answers?: unknown }>()
        return c.json({
            ok: true,
            ...(await refreshDnsChecks(
                c.env.DB,
                requireContactId(c.req.param('id')),
                input,
                testResolver(c.env, input),
                ttl(c.env.CONTACT_DNS_CACHE_TTL_SECONDS),
            )),
        })
    } catch (error) { return respond(c, error) }
}
