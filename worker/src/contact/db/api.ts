import { Context } from 'hono'

import { contactErrorResponse } from '../errors'
import { getContactMigrationStatus, migrateContactDatabase } from './migration_runner'

export const getVersion = async (c: Context<HonoCustomType>) => {
    try {
        return c.json({ ok: true, ...(await getContactMigrationStatus(c.env.DB)) })
    } catch (error) {
        const response = contactErrorResponse(error)
        return c.json(response.body, response.status)
    }
}

export const migrate = async (c: Context<HonoCustomType>) => {
    try {
        return c.json({ ok: true, ...(await migrateContactDatabase(c.env.DB)) })
    } catch (error) {
        const response = contactErrorResponse(error)
        return c.json(response.body, response.status)
    }
}
