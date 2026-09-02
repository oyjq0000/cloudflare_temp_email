import assert from 'node:assert/strict'
import test from 'node:test'

import { migrateContactDatabase } from './migration_runner.ts'

test('failed Contact migration is not recorded as applied', async () => {
    const applied: Array<{ version: number, name: string, applied_at: string }> = []
    let migrationTable = false
    let batchNo = 0
    const statement = (sql: string, bound: unknown[] = []): any => ({
        bind: (...values: unknown[]) => statement(sql, values),
        run: async () => {
            if (sql.includes('CREATE TABLE IF NOT EXISTS contact_schema_migrations')) migrationTable = true
            return { success: true }
        },
        first: async () => {
            if (sql.includes('sqlite_master')) return migrationTable ? { name: 'contact_schema_migrations' } : null
            return null
        },
        all: async () => ({ results: sql.includes('contact_schema_migrations') ? [...applied] : [] }),
        sql,
        bound,
    })
    const db: any = {
        prepare: (sql: string) => statement(sql),
        batch: async (statements: any[]) => {
            batchNo += 1
            if (batchNo === 6) return statements.map((_: unknown, index: number) => ({ success: index !== 0 }))
            const marker = statements.at(-1)
            if (marker?.sql?.includes('INSERT INTO contact_schema_migrations')) {
                applied.push({ version: Number(marker.bound[0]), name: String(marker.bound[1]), applied_at: 'now' })
            }
            return statements.map(() => ({ success: true }))
        },
    }

    await assert.rejects(() => migrateContactDatabase(db), /Contact migration 6 failed/)
    assert.deepEqual(applied.map(item => item.version), [1, 2, 3, 4, 5])
})
