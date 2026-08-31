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
]

export const CONTACT_SCHEMA_VERSION = CONTACT_MIGRATIONS.at(-1)?.version || 0
