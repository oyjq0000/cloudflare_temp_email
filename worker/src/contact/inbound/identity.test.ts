import assert from 'node:assert/strict'
import test from 'node:test'

import { contactDedupeKey } from './identity.ts'

test('Message-ID dedupe is normalized and scoped to the receiving Mailbox', async () => {
    const raw = new TextEncoder().encode('raw').buffer
    assert.equal(
        await contactDedupeKey('Contact@Example.com', 'Sender@Example.net', ' <ABC@Sender> ', raw),
        'message-id:contact@example.com:<abc@sender>',
    )
})

test('fallback dedupe is stable for identical raw mail and changes with recipient', async () => {
    const raw = new TextEncoder().encode('Subject: Test\r\n\r\nBody').buffer
    const first = await contactDedupeKey('a@example.com', 'sender@example.net', null, raw)
    assert.equal(first, await contactDedupeKey('a@example.com', 'sender@example.net', null, raw))
    assert.notEqual(first, await contactDedupeKey('b@example.com', 'sender@example.net', null, raw))
})
