import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveProviderSecrets, validateSecretReference } from './secret_resolver.ts'

test('secret resolver only accepts the CONTACT namespace', () => {
    assert.equal(validateSecretReference('CONTACT_SMTP_MAIN_PASSWORD'), 'CONTACT_SMTP_MAIN_PASSWORD')
    for (const value of ['RESEND_TOKEN', 'CONTACT_', 'contact_SECRET', 'CONTACT_SECRET-NAME']) {
        assert.throws(() => validateSecretReference(value), /CONTACT_\*/)
    }
})

test('secret status exposes booleans separately from runtime values', () => {
    const env = {
        CONTACT_REAL: 'local-test-only',
    } as unknown as Bindings
    const result = resolveProviderSecrets(env, { apiKey: 'CONTACT_REAL', optional: 'CONTACT_MISSING' })
    assert.deepEqual(result.configured, { apiKey: true, optional: false })
    assert.deepEqual(result.values, { apiKey: 'local-test-only' })
})
