import assert from 'node:assert/strict'
import test from 'node:test'

import {
    contactAddress,
    normalizeContactDomain,
    normalizeContactLocalPart,
} from './normalization.ts'

test('normalizes contact domains and trailing dots', () => {
    assert.equal(normalizeContactDomain(' EXAMPLE.COM. '), 'example.com')
    assert.equal(normalizeContactDomain('xn--fsqu00a.xn--0zwm56d'), 'xn--fsqu00a.xn--0zwm56d')
})

test('rejects unsafe or malformed domains', () => {
    for (const value of ['localhost', '-bad.example', 'bad-.example', 'bad domain.example', 'a..example']) {
        assert.throws(() => normalizeContactDomain(value), /Domain is invalid/)
    }
})

test('normalizes local parts and composes owned addresses', () => {
    assert.equal(normalizeContactLocalPart(' Support.Team '), 'support.team')
    assert.equal(contactAddress('support', 'example.com'), 'support@example.com')
    assert.throws(() => normalizeContactLocalPart('../support'), /local part is invalid/)
    assert.throws(() => normalizeContactLocalPart('bad@name'), /local part is invalid/)
})
