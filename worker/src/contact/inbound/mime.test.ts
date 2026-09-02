import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeSenderDate, parseContactMime } from './mime.ts'

const raw = (dateLine?: string) => new TextEncoder().encode([
    'From: Sender <sender@example.net>',
    'To: contact@example.com',
    'Subject: Date isolation',
    ...(dateLine ? [`Date: ${dateLine}`] : []),
    '',
    'body',
].join('\r\n')).buffer

test('sender Date normalization preserves only valid declared dates', () => {
    assert.equal(normalizeSenderDate('Thu, 01 Jan 2099 00:00:00 +0000'), '2099-01-01T00:00:00.000Z')
    assert.equal(normalizeSenderDate('Thu, 01 Jan 1970 00:00:00 +0000'), '1970-01-01T00:00:00.000Z')
    assert.equal(normalizeSenderDate('definitely-not-a-date'), null)
    assert.equal(normalizeSenderDate(undefined), null)
})

test('MIME parser exposes senderDate and never invents a receive timestamp', async () => {
    const future = await parseContactMime(raw('Thu, 01 Jan 2099 00:00:00 +0000'))
    assert.equal(future.senderDate, '2099-01-01T00:00:00.000Z')
    assert.equal('receivedAt' in future, false)

    const invalid = await parseContactMime(raw('not-a-date'))
    assert.equal(invalid.senderDate, null)
    const missing = await parseContactMime(raw())
    assert.equal(missing.senderDate, null)
})
