export type ContactMigration = {
    version: number
    name: string
    statements: string[]
}

export const CONTACT_MIGRATIONS: ContactMigration[] = [
    {
        version: 1,
        name: 'contact_domain_mailbox_provider_core',
        statements: [
            `CREATE TABLE IF NOT EXISTS contact_provider_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                provider_type TEXT NOT NULL CHECK(provider_type IN ('resend', 'brevo', 'smtp')),
                enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
                config_json TEXT NOT NULL DEFAULT '{}',
                secret_refs_json TEXT NOT NULL DEFAULT '{}',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE INDEX IF NOT EXISTS idx_contact_provider_configs_type_enabled
                ON contact_provider_configs(provider_type, enabled)`,
            `CREATE TABLE IF NOT EXISTS contact_domains (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                domain TEXT NOT NULL UNIQUE COLLATE NOCASE,
                name TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
                inbound_enabled INTEGER NOT NULL DEFAULT 1 CHECK(inbound_enabled IN (0, 1)),
                importance TEXT NOT NULL DEFAULT 'normal',
                default_from_name TEXT,
                default_mailbox_id INTEGER,
                default_provider_config_id INTEGER,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(default_provider_config_id) REFERENCES contact_provider_configs(id)
            )`,
            `CREATE INDEX IF NOT EXISTS idx_contact_domains_enabled
                ON contact_domains(enabled, inbound_enabled, domain)`,
            `CREATE TABLE IF NOT EXISTS contact_mailboxes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                domain_id INTEGER NOT NULL,
                address_id INTEGER NOT NULL UNIQUE,
                local_part TEXT NOT NULL,
                address TEXT NOT NULL UNIQUE COLLATE NOCASE,
                display_name TEXT,
                enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
                inbound_enabled INTEGER NOT NULL DEFAULT 1 CHECK(inbound_enabled IN (0, 1)),
                outbound_enabled INTEGER NOT NULL DEFAULT 1 CHECK(outbound_enabled IN (0, 1)),
                is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(domain_id, local_part),
                FOREIGN KEY(domain_id) REFERENCES contact_domains(id),
                FOREIGN KEY(address_id) REFERENCES address(id)
            )`,
            `CREATE INDEX IF NOT EXISTS idx_contact_mailboxes_domain_enabled
                ON contact_mailboxes(domain_id, enabled, inbound_enabled)`,
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_mailboxes_one_default
                ON contact_mailboxes(domain_id) WHERE is_default = 1`,
        ],
    },
    {
        version: 2,
        name: 'contact_inbound_message_storage',
        statements: [
            `CREATE TABLE IF NOT EXISTS contact_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                raw_mail_id INTEGER NOT NULL UNIQUE,
                domain_id INTEGER NOT NULL,
                mailbox_id INTEGER NOT NULL,
                envelope_from TEXT NOT NULL,
                from_name TEXT,
                from_address TEXT,
                reply_to_address TEXT,
                to_address TEXT NOT NULL,
                cc_json TEXT NOT NULL DEFAULT '[]',
                headers_json TEXT NOT NULL DEFAULT '[]',
                subject TEXT NOT NULL DEFAULT '',
                preview TEXT NOT NULL DEFAULT '',
                text_body TEXT NOT NULL DEFAULT '',
                html_body TEXT NOT NULL DEFAULT '',
                message_id_header TEXT,
                in_reply_to_header TEXT,
                references_json TEXT NOT NULL DEFAULT '[]',
                dedupe_key TEXT NOT NULL UNIQUE,
                folder TEXT NOT NULL DEFAULT 'inbox' CHECK(folder IN ('inbox', 'spam')),
                is_read INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0, 1)),
                spam_reason TEXT,
                has_attachments INTEGER NOT NULL DEFAULT 0 CHECK(has_attachments IN (0, 1)),
                raw_storage_key TEXT,
                storage_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK(storage_status IN ('pending', 'stored', 'fallback', 'degraded')),
                parse_status TEXT NOT NULL DEFAULT 'parsed' CHECK(parse_status IN ('parsed', 'failed')),
                parse_error TEXT,
                received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(raw_mail_id) REFERENCES raw_mails(id),
                FOREIGN KEY(domain_id) REFERENCES contact_domains(id),
                FOREIGN KEY(mailbox_id) REFERENCES contact_mailboxes(id)
            )`,
            `CREATE INDEX IF NOT EXISTS idx_contact_messages_domain_folder_received
                ON contact_messages(domain_id, folder, received_at DESC, id DESC)`,
            `CREATE INDEX IF NOT EXISTS idx_contact_messages_mailbox_folder_received
                ON contact_messages(mailbox_id, folder, received_at DESC, id DESC)`,
            `CREATE INDEX IF NOT EXISTS idx_contact_messages_folder_read_received
                ON contact_messages(folder, is_read, received_at DESC, id DESC)`,
            `CREATE INDEX IF NOT EXISTS idx_contact_messages_from_address
                ON contact_messages(from_address)`,
            `CREATE INDEX IF NOT EXISTS idx_contact_messages_to_address
                ON contact_messages(to_address)`,
            `CREATE TABLE IF NOT EXISTS contact_attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id INTEGER NOT NULL,
                filename TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                disposition TEXT NOT NULL DEFAULT 'attachment',
                content_id TEXT,
                size INTEGER NOT NULL,
                sha256 TEXT NOT NULL,
                storage_key TEXT NOT NULL UNIQUE,
                storage_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK(storage_status IN ('pending', 'stored', 'fallback', 'degraded')),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(message_id) REFERENCES contact_messages(id)
            )`,
            `CREATE INDEX IF NOT EXISTS idx_contact_attachments_message
                ON contact_attachments(message_id, id)`,
        ],
    },
    {
        version: 3,
        name: 'contact_inbound_truncation_signal',
        statements: [
            `ALTER TABLE contact_messages ADD COLUMN content_truncated INTEGER NOT NULL DEFAULT 0
                CHECK(content_truncated IN (0, 1))`,
        ],
    },
]

export const CONTACT_SCHEMA_VERSION = CONTACT_MIGRATIONS.at(-1)?.version || 0
