import { Context } from 'hono'

import { contactErrorResponse, requireContactId } from '../errors'
import { getContactStorageStatus, repairContactStorage } from './service'

const respond = (c: Context<HonoCustomType>, error: unknown) => {
    const response = contactErrorResponse(error)
    return c.json(response.body, response.status)
}

export const status = async (c: Context<HonoCustomType>) => {
    try {
        return c.json({
            ok: true,
            ...(await getContactStorageStatus(c.env.DB, c.env.CONTACT_R2)),
        })
    } catch (error) { return respond(c, error) }
}

export const repair = async (c: Context<HonoCustomType>) => {
    try {
        return c.json({
            ok: true,
            result: await repairContactStorage(
                c.env.DB,
                c.env.CONTACT_R2,
                requireContactId(c.req.param('id')),
            ),
        })
    } catch (error) { return respond(c, error) }
}
