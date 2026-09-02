import assert from 'node:assert/strict'
import test from 'node:test'
import { Jwt } from 'hono/utils/jwt'

import {
    CONTACT_ADMIN_SESSION_DEFAULT_TTL_SECONDS,
    parseContactAdminAuthorization,
    resolveContactAdminSessionTtl,
    signContactAdminSession,
    verifyContactAdminSession,
} from './admin_session.ts'

const secret = 'contact-admin-test-secret'

test('Contact Admin Session TTL defaults safely and accepts only 15 minutes to 8 hours', () => {
    assert.equal(resolveContactAdminSessionTtl(undefined), CONTACT_ADMIN_SESSION_DEFAULT_TTL_SECONDS)
    assert.equal(resolveContactAdminSessionTtl('900'), 900)
    assert.equal(resolveContactAdminSessionTtl(28_800), 28_800)
    assert.equal(resolveContactAdminSessionTtl('899'), CONTACT_ADMIN_SESSION_DEFAULT_TTL_SECONDS)
    assert.equal(resolveContactAdminSessionTtl('28801'), CONTACT_ADMIN_SESSION_DEFAULT_TTL_SECONDS)
    assert.equal(resolveContactAdminSessionTtl('not-a-number'), CONTACT_ADMIN_SESSION_DEFAULT_TTL_SECONDS)
})

test('Contact Admin Session requires scope, iat, exp, and rejects expiry', async () => {
    const now = Math.floor(Date.now() / 1000) - 10
    const { token, payload } = await signContactAdminSession(secret, 900, now)
    assert.deepEqual(await verifyContactAdminSession(token, secret, now), payload)
    assert.equal(await verifyContactAdminSession(token, secret, now + 900), null)

    const wrongScope = await Jwt.sign({ scope: 'address', iat: now, exp: now + 900 }, secret, 'HS256')
    assert.equal(await verifyContactAdminSession(wrongScope, secret, now), null)

    const addressJwt = await Jwt.sign({ address: 'contact@example.com', address_id: 1 }, secret, 'HS256')
    assert.equal(await verifyContactAdminSession(addressJwt, secret, now), null)

    const noIat = await Jwt.sign({ scope: 'contact:admin', exp: now + 900 }, secret, 'HS256')
    assert.equal(await verifyContactAdminSession(noIat, secret, now), null)
})

test('Contact Admin Authorization parser distinguishes absent from malformed bearer credentials', () => {
    assert.deepEqual(parseContactAdminAuthorization(null), { present: false, token: null })
    assert.deepEqual(parseContactAdminAuthorization('Bearer abc.def.ghi'), { present: true, token: 'abc.def.ghi' })
    assert.deepEqual(parseContactAdminAuthorization('Basic abc'), { present: true, token: null })
    assert.deepEqual(parseContactAdminAuthorization('Bearer '), { present: true, token: null })
    assert.deepEqual(parseContactAdminAuthorization('Bearer abc\ndef'), { present: true, token: null })
})
