import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import { CONTACT_MIGRATIONS } from './migrations.ts'

test('v5 Contact data backfills sender_date without losing legacy raw/message data', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`
        CREATE TABLE address(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, source_meta TEXT);
        CREATE TABLE raw_mails(id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT, source TEXT, address TEXT, raw TEXT, created_at DATETIME);
    `)
    for (const migration of CONTACT_MIGRATIONS.filter(item => item.version <= 5)) {
        for (const sql of migration.statements) db.exec(sql)
    }
    db.exec(`
        INSERT INTO address(id, name, source_meta) VALUES (1, 'contact@legacy.example.com', 'contact-hub');
        INSERT INTO contact_domains(id, domain, name, default_mailbox_id) VALUES (1, 'legacy.example.com', 'Legacy', 1);
        INSERT INTO contact_mailboxes(id, domain_id, address_id, local_part, address, is_default) VALUES (1, 1, 1, 'contact', 'contact@legacy.example.com', 1);
        INSERT INTO raw_mails(id, message_id, source, address, raw, created_at)
          VALUES (1, '<legacy@test>', 'sender@example.net', 'contact@legacy.example.com', 'RAW-LEGACY', '2026-08-31T10:00:00.000Z');
        INSERT INTO contact_messages(
          id, raw_mail_id, domain_id, mailbox_id, envelope_from, from_address, to_address,
          subject, dedupe_key, received_at, created_at
        ) VALUES (
          1, 1, 1, 1, 'sender@example.net', 'sender@example.net', 'contact@legacy.example.com',
          'Legacy message', 'legacy-dedupe', '2099-01-01T00:00:00.000Z', '2026-08-31T10:00:00.000Z'
        );
    `)
    for (const sql of CONTACT_MIGRATIONS.find(item => item.version === 6)!.statements) db.exec(sql)
    for (const sql of CONTACT_MIGRATIONS.find(item => item.version === 7)!.statements) db.exec(sql)

    const message = db.prepare(`SELECT sender_date, received_at, subject FROM contact_messages WHERE id = 1`).get() as Record<string, unknown>
    assert.equal(message.sender_date, '2099-01-01T00:00:00.000Z')
    assert.equal(message.received_at, '2026-08-31T10:00:00.000Z')
    assert.equal(message.subject, 'Legacy message')
    assert.equal((db.prepare(`SELECT raw FROM raw_mails WHERE id = 1`).get() as Record<string, unknown>).raw, 'RAW-LEGACY')
    assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='contact_message_side_effects'`).get())
    db.close()
})
