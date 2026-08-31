import assert from 'node:assert/strict'
import test from 'node:test'

import { safeErrorMetadata, sanitizeProviderResult } from './diagnostics.ts'

test('operational error metadata never returns arbitrary messages or secrets', () => {
    const metadata = safeErrorMetadata(Object.assign(new Error('Bearer secret-token CONTACT_API_KEY'), {
        code: 'CONTACT_INTERNAL_ERROR',
    }))
    assert.deepEqual(metadata, { name: 'Error', code: 'CONTACT_INTERNAL_ERROR' })
    assert.doesNotMatch(JSON.stringify(metadata), /secret|token|api_key/i)
})

test('provider diagnostics persist only classified values', () => {
    const result = sanitizeProviderResult({
        certainty: 'unknown', retryable: true,
        errorClass: 'Bearer secret', errorCode: 'CONTACT_REAL_SECRET',
        errorMessage: 'password=hunter2',
    })
    assert.deepEqual(result, {
        certainty: 'unknown', retryable: false, errorClass: 'network',
        errorCode: 'PROVIDER_OUTCOME_UNKNOWN',
        errorMessage: 'Provider outcome is uncertain; automatic retry is disabled',
    })
    assert.doesNotMatch(JSON.stringify(result), /hunter2|bearer|password|contact_real_secret/i)
})
