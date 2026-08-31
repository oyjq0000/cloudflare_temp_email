import assert from 'node:assert/strict'
import test from 'node:test'

import { contactCorsDecision, parseContactAllowedOrigins } from './cors.ts'

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
