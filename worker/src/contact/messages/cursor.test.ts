import assert from 'node:assert/strict'
import test from 'node:test'

import { decodeContactMessageCursor, encodeContactMessageCursor } from './cursor.ts'

test('cursor round-trips a stable received_at and id tuple', () => {
    const cursor = { receivedAt: '2026-09-01T08:00:00.000Z', id: 42 }
    assert.deepEqual(decodeContactMessageCursor(encodeContactMessageCursor(cursor)), cursor)
})

test('cursor rejects malformed or invalid payloads', () => {
    for (const cursor of ['!!!', 'e30', 'eyJyZWNlaXZlZEF0IjoieCIsImlkIjowfQ']) {
        assert.throws(() => decodeContactMessageCursor(cursor), /cursor is invalid/)
    }
})
