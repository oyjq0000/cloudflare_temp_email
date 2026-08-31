import assert from 'node:assert/strict'
import test from 'node:test'

import { CONTACT_CORS_ALLOWED_HEADERS, contactCorsDecision, parseContactAllowedOrigins } from './cors.ts'

test('Contact CORS allows same-origin and explicit allowlist origins only', () => {
    const configured = '["https://mail.example.com","https://admin.example.com"]'
    assert.equal(contactCorsDecision('https://worker.example.com', 'https://worker.example.com', configured).allowed, true)
    assert.equal(contactCorsDecision('https://mail.example.com', 'https://worker.example.com', configured).allowed, true)
    assert.equal(contactCorsDecision('https://evil.example', 'https://worker.example.com', configured).allowed, false)
})

test('Contact CORS permits non-browser clients without Origin and rejects wildcard config', () => {
    assert.equal(contactCorsDecision(null, 'https://worker.example.com', '*').allowed, true)
    assert.deepEqual(parseContactAllowedOrigins('*'), [])
    assert.deepEqual(parseContactAllowedOrigins('https://one.example, https://two.example'), [
        'https://one.example', 'https://two.example',
    ])
})

test('Contact CORS rejects configured paths and credential-bearing origins', () => {
    assert.deepEqual(parseContactAllowedOrigins('["https://mail.example/path","https://u:p@mail.example"]'), [])
})

test('Contact CORS permits every authentication and telemetry header sent by the frontend', () => {
    const allowed = new Set(CONTACT_CORS_ALLOWED_HEADERS.toLowerCase().split(', '))
    for (const header of [
        'content-type', 'authorization', 'x-admin-auth', 'x-user-token',
        'x-user-access-token', 'x-custom-auth', 'x-fingerprint', 'idempotency-key', 'x-lang',
    ]) assert.equal(allowed.has(header), true, header)
})
