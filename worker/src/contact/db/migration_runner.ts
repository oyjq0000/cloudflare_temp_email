import { CONTACT_MIGRATIONS, CONTACT_SCHEMA_VERSION } from './migrations.ts'

type AppliedMigrationRow = {
    version: number
    name: string
    applied_at: string
}

export type ContactMigrationStatus = {
    currentVersion: number
    targetVersion: number
    pending: Array<{ version: number, name: string }>
    applied: AppliedMigrationRow[]
}

const migrationTableExists = async (db: D1Database): Promise<boolean> => {
    const row = await db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'contact_schema_migrations'`
    ).first<{ name: string }>()
    return Boolean(row)
}

const ensureMigrationTable = async (db: D1Database): Promise<void> => {
    const result = await db.prepare(`CREATE TABLE IF NOT EXISTS contact_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`).run()
    if (!result.success) throw new Error('Contact migration table could not be created')
}

export const getContactMigrationStatus = async (db: D1Database): Promise<ContactMigrationStatus> => {
    if (!await migrationTableExists(db)) {
        return {
            currentVersion: 0,
            targetVersion: CONTACT_SCHEMA_VERSION,
            pending: CONTACT_MIGRATIONS.map(({ version, name }) => ({ version, name })),
            applied: [],
        }
    }

    const { results } = await db.prepare(
        `SELECT version, name, applied_at FROM contact_schema_migrations ORDER BY version`
    ).all<AppliedMigrationRow>()
    const applied = results || []
    const appliedVersions = new Set(applied.map(row => row.version))
    return {
        currentVersion: applied.at(-1)?.version || 0,
        targetVersion: CONTACT_SCHEMA_VERSION,
        pending: CONTACT_MIGRATIONS
            .filter(migration => !appliedVersions.has(migration.version))
            .map(({ version, name }) => ({ version, name })),
        applied,
    }
}

export const migrateContactDatabase = async (db: D1Database): Promise<ContactMigrationStatus> => {
    await ensureMigrationTable(db)
    const before = await getContactMigrationStatus(db)
    const pendingVersions = new Set(before.pending.map(migration => migration.version))

    for (const migration of CONTACT_MIGRATIONS) {
        if (!pendingVersions.has(migration.version)) continue
        const statements = migration.statements.map(sql => db.prepare(sql))
        statements.push(db.prepare(
            `INSERT INTO contact_schema_migrations(version, name) VALUES (?, ?)`
        ).bind(migration.version, migration.name))
        const results = await db.batch(statements)
        if (!results.every(result => result.success)) {
            throw new Error(`Contact migration ${migration.version} failed`)
        }
    }
    return getContactMigrationStatus(db)
}
