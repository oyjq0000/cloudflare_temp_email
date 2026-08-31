import assert from 'node:assert/strict'
import test from 'node:test'

import { BrevoProvider } from './brevo.ts'
import { ResendProvider } from './resend.ts'
import { SmtpProvider } from './smtp.ts'

const message = {
    fromName: 'Contact Desk', fromAddress: 'contact@example.com',
    toName: 'Customer', toAddress: 'customer@example.net',
    subject: 'Hello', textBody: 'Safe local test',
}

test('Resend HTTP adapter captures provider id without exposing the key', async () => {
    let authorization = ''
    const provider = new ResendProvider(async (_url, init) => {
        authorization = new Headers(init?.headers).get('Authorization') || ''
        return Response.json({ id: 'resend-message-1' })
    })
    const result = await provider.send(message, { config: {}, secrets: { apiKey: 'local-resend-mock' } })
    assert.equal(authorization, 'Bearer local-resend-mock')
    assert.deepEqual(result, { certainty: 'accepted', retryable: false, providerMessageId: 'resend-message-1' })
    assert.equal(JSON.stringify(result).includes('local-resend-mock'), false)
})

test('Brevo HTTP adapter classifies explicit rejection and uncertain network loss', async () => {
    const rejected = new BrevoProvider(async () => new Response('{}', { status: 429 }))
    assert.deepEqual(
        await rejected.send(message, { config: {}, secrets: { apiKey: 'local-brevo-mock' } }),
        {
            certainty: 'rejected', retryable: true, errorClass: 'rate_limit',
            errorCode: 'HTTP_429', errorMessage: 'Provider explicitly rejected the request with HTTP 429',
        },
    )
    const uncertain = new BrevoProvider(async () => { throw new Error('connection reset') })
    assert.match((await uncertain.send(message, { config: {}, secrets: { apiKey: 'x' } })).errorClass || '', /network/)
    const timeout = new BrevoProvider(async () => { throw new DOMException('timed out', 'TimeoutError') })
    assert.deepEqual(
        await timeout.send(message, { config: {}, secrets: { apiKey: 'local-only' } }),
        {
            certainty: 'unknown', retryable: false, errorClass: 'network_timeout',
            errorCode: 'PROVIDER_TIMEOUT',
            errorMessage: 'Provider request timed out with an uncertain delivery result',
        },
    )
})

test('SMTP adapter validates secrets before calling the transport and classifies results', async () => {
    let calls = 0
    const accepted = new SmtpProvider(async () => { calls += 1 })
    const missing = await accepted.send(message, {
        config: { host: 'localhost', port: 1025, username: 'contact' }, secrets: {},
    })
    assert.equal(missing.errorClass, 'configuration')
    assert.equal(calls, 0)
    assert.equal((await accepted.send(message, {
        config: { host: 'localhost', port: 1025 }, secrets: {},
    })).certainty, 'accepted')
    assert.equal(calls, 1)

    const rejected = new SmtpProvider(async () => { throw Object.assign(new Error('rejected'), { responseCode: 550 }) })
    assert.deepEqual(await rejected.send(message, {
        config: { host: 'localhost', port: 1025 }, secrets: {},
    }), {
        certainty: 'rejected', retryable: false, errorClass: 'provider_rejected',
        errorCode: 'SMTP_550', errorMessage: 'SMTP server explicitly rejected the request with 550',
    })
})
