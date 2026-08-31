import { Context } from 'hono'

import { getBooleanValue } from '../../utils'
import { contactErrorResponse, requireContactId } from '../errors'
import { ContactProviderRegistry } from '../providers/registry'
import type { OutboundProvider, ProviderSendResult, ProviderType } from '../providers/types'
import {
    createAndSendOutbound,
    createAndSendReply,
    forceResendOutbound,
    getOutbound,
    listOutbound,
    retryOutbound,
    type CreateOutboundInput,
} from './service'
import { idempotencyKey } from './validation'

const respond = (c: Context<HonoCustomType>, error: unknown) => {
    const response = contactErrorResponse(error)
    return c.json(response.body, response.status)
}

const testRegistry = (c: Context<HonoCustomType>): ContactProviderRegistry | undefined => {
    if (!getBooleanValue(c.env.E2E_TEST_MODE)) return undefined
    const resultType = c.req.header('x-contact-provider-mock-result')
    if (!resultType) return undefined
    const delay = Math.min(500, Math.max(0, Number(c.req.header('x-contact-provider-mock-delay')) || 0))
    const result = (): ProviderSendResult => resultType === 'accepted'
        ? { certainty: 'accepted', retryable: false, providerMessageId: 'mock-provider-message-id' }
        : resultType === 'rejected'
            ? {
                certainty: 'rejected', retryable: true, errorClass: 'provider_rejected',
                errorCode: 'MOCK_REJECTED', errorMessage: 'Mock provider explicitly rejected the message',
            }
            : {
                certainty: 'unknown', retryable: false, errorClass: 'network_timeout',
                errorCode: 'MOCK_TIMEOUT', errorMessage: 'Mock provider outcome is uncertain',
            }
    const provider = (type: ProviderType): OutboundProvider => ({
        type,
        async send() {
            if (delay) await new Promise(resolve => setTimeout(resolve, delay))
            return result()
        },
    })
    return new ContactProviderRegistry({
        resend: provider('resend'), brevo: provider('brevo'), smtp: provider('smtp'),
    })
}

export const list = async (c: Context<HonoCustomType>) => {
    try { return c.json({ ok: true, ...(await listOutbound(c.env.DB, c.req.query())) }) }
    catch (error) { return respond(c, error) }
}

export const get = async (c: Context<HonoCustomType>) => {
    try { return c.json({ ok: true, result: await getOutbound(c.env.DB, requireContactId(c.req.param('id'))) }) }
    catch (error) { return respond(c, error) }
}

export const send = async (c: Context<HonoCustomType>) => {
    try {
        return c.json({
            ok: true,
            ...(await createAndSendOutbound(
                c.env, idempotencyKey(c.req.header('Idempotency-Key')),
                await c.req.json<CreateOutboundInput>(), testRegistry(c),
            )),
        }, 201)
    } catch (error) { return respond(c, error) }
}

export const reply = async (c: Context<HonoCustomType>) => {
    try {
        return c.json({
            ok: true,
            ...(await createAndSendReply(
                c.env, requireContactId(c.req.param('id')),
                idempotencyKey(c.req.header('Idempotency-Key')),
                await c.req.json<CreateOutboundInput>(), testRegistry(c),
            )),
        }, 201)
    } catch (error) { return respond(c, error) }
}

export const retry = async (c: Context<HonoCustomType>) => {
    try {
        const input = await c.req.json<{ provider_config_id?: number }>().catch(() => ({}))
        return c.json({
            ok: true,
            ...(await retryOutbound(
                c.env, requireContactId(c.req.param('id')),
                input.provider_config_id ? requireContactId(input.provider_config_id) : undefined,
                testRegistry(c),
            )),
        })
    } catch (error) { return respond(c, error) }
}

export const forceResend = async (c: Context<HonoCustomType>) => {
    try {
        const input = await c.req.json<{ confirm?: boolean }>()
        return c.json({
            ok: true,
            ...(await forceResendOutbound(
                c.env, requireContactId(c.req.param('id')),
                idempotencyKey(c.req.header('Idempotency-Key')),
                input.confirm === true, testRegistry(c),
            )),
        }, 201)
    } catch (error) { return respond(c, error) }
}
