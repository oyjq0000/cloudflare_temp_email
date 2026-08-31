import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateDkim, evaluateDmarc, evaluateMx, evaluateSpf } from './evaluation.ts'

test('DNS query failures are unknown rather than invalid', () => {
    assert.equal(evaluateMx({ values: [], failed: true }).status, 'unknown')
    assert.equal(evaluateSpf({ values: ['v=spf1 -all'], failed: true }).status, 'unknown')
    assert.equal(evaluateDkim({ values: [], failed: true }).status, 'unknown')
    assert.equal(evaluateDmarc({ values: [], failed: true }).status, 'unknown')
})

test('SPF requires exactly one record and never proposes a second record', () => {
    const result = evaluateSpf({ values: ['v=spf1 include:a.test -all', 'v=spf1 include:b.test -all'] })
    assert.deepEqual(result, {
        status: 'invalid',
        observed: ['v=spf1 include:a.test -all', 'v=spf1 include:b.test -all'],
        code: 'SPF_MULTIPLE_RECORDS',
    })
    assert.equal('suggestion' in result, false)
})

test('MX and DKIM compare explicit requirements', () => {
    assert.equal(evaluateMx({ values: ['10 mx.example.net.'] }, ['mx.example.net']).status, 'valid')
    assert.equal(evaluateDkim({ values: ['provider-key'] }, ['other-key']).status, 'invalid')
})

test('DMARC requires one v=DMARC1 record', () => {
    assert.equal(evaluateDmarc({ values: ['google-site-verification=x'] }).status, 'missing')
    assert.equal(evaluateDmarc({ values: ['v=DMARC1; p=none'] }).status, 'valid')
})
