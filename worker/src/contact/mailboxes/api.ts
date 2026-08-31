import { Context } from 'hono'

import { contactErrorResponse, requireContactId } from '../errors'
import {
    ContactMailboxInput,
    createMailbox,
    disableMailbox,
    getMailbox,
    listMailboxes,
    updateMailbox,
} from './service'

const respond = (c: Context<HonoCustomType>, error: unknown) => {
    const response = contactErrorResponse(error)
    return c.json(response.body, response.status)
}

export const list = async (c: Context<HonoCustomType>) => {
    try {
        const domainIdValue = c.req.query('domain_id')
        const domainId = domainIdValue === undefined ? undefined : requireContactId(domainIdValue)
        return c.json({ ok: true, results: await listMailboxes(c.env.DB, domainId) })
    } catch (error) { return respond(c, error) }
}

export const get = async (c: Context<HonoCustomType>) => {
    try {
        return c.json({ ok: true, result: await getMailbox(c.env.DB, requireContactId(c.req.param('id'))) })
    } catch (error) { return respond(c, error) }
}

export const create = async (c: Context<HonoCustomType>) => {
    try {
        const input = await c.req.json<ContactMailboxInput>()
        return c.json({ ok: true, result: await createMailbox(c.env.DB, input) }, 201)
    } catch (error) { return respond(c, error) }
}

export const update = async (c: Context<HonoCustomType>) => {
    try {
        const input = await c.req.json<ContactMailboxInput>()
        return c.json({
            ok: true,
            result: await updateMailbox(c.env.DB, requireContactId(c.req.param('id')), input),
        })
    } catch (error) { return respond(c, error) }
}

export const remove = async (c: Context<HonoCustomType>) => {
    try {
        return c.json({
            ok: true,
            result: await disableMailbox(c.env.DB, requireContactId(c.req.param('id'))),
        })
    } catch (error) { return respond(c, error) }
}
