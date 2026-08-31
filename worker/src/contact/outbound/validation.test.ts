import assert from 'node:assert/strict'
import test from 'node:test'

import { idempotencyKey, replySubject, safeEmailAddress, safeHeaderText } from './validation.ts'

test('outbound headers reject CRLF and malformed addresses', () => {
    assert.throws(() => safeHeaderText('hello\r\nBcc: victim@example.net', 'Subject', 100), /invalid/)
    assert.throws(() => safeEmailAddress('invalid', 'To'), /invalid/)
    assert.equal(safeEmailAddress('Customer@Example.NET', 'To'), 'customer@example.net')
})

test('idempotency and reply subjects are stable', () => {
    assert.equal(idempotencyKey('request-1234'), 'request-1234')
    assert.throws(() => idempotencyKey('short'), /Idempotency-Key/)
    assert.equal(replySubject('Question'), 'Re: Question')
    assert.equal(replySubject('RE: Question'), 'RE: Question')
})
