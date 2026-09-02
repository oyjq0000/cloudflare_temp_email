import assert from 'node:assert/strict'
import test from 'node:test'

import { CONTACT_MIGRATIONS, CONTACT_SCHEMA_VERSION } from './migrations.ts'

test('Contact migrations remain monotonic and append receive-time and side-effect changes after v5', () => {
    assert.deepEqual(CONTACT_MIGRATIONS.map(item => item.version), [1, 2, 3, 4, 5, 6, 7])
    assert.equal(CONTACT_SCHEMA_VERSION, 7)
    assert.match(CONTACT_MIGRATIONS[5].statements.join('\n'), /ADD COLUMN sender_date/i)
    assert.match(CONTACT_MIGRATIONS[5].statements.join('\n'), /sender_date = received_at/i)
    assert.match(CONTACT_MIGRATIONS[5].statements.join('\n'), /received_at = COALESCE\(created_at, received_at\)/i)
    assert.match(CONTACT_MIGRATIONS[6].statements.join('\n'), /contact_message_side_effects/i)
})
