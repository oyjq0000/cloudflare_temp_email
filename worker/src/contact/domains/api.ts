import { Context } from 'hono'

import { contactErrorResponse, requireContactId } from '../errors'
import {
    ContactDomainInput,
    createDomain,
    disableDomain,
    getDomain,
    listDomains,
    updateDomain,
} from './service'

const respond = (c: Context<HonoCustomType>, error: unknown) => {
    const response = contactErrorResponse(error)
    return c.json(response.body, response.status)
}

export const list = async (c: Context<HonoCustomType>) => {
    try {
        return c.json({ ok: true, results: await listDomains(c.env.DB) })
    } catch (error) { return respond(c, error) }
}

export const get = async (c: Context<HonoCustomType>) => {
    try {
        return c.json({ ok: true, result: await getDomain(c.env.DB, requireContactId(c.req.param('id'))) })
    } catch (error) { return respond(c, error) }
}

export const create = async (c: Context<HonoCustomType>) => {
    try {
        const input = await c.req.json<ContactDomainInput>()
        return c.json({ ok: true, result: await createDomain(c.env.DB, input) }, 201)
    } catch (error) { return respond(c, error) }
}

export const update = async (c: Context<HonoCustomType>) => {
    try {
        const input = await c.req.json<ContactDomainInput>()
        return c.json({
            ok: true,
            result: await updateDomain(c.env.DB, requireContactId(c.req.param('id')), input),
        })
    } catch (error) { return respond(c, error) }
}

export const remove = async (c: Context<HonoCustomType>) => {
    try {
        return c.json({
            ok: true,
            result: await disableDomain(c.env.DB, requireContactId(c.req.param('id'))),
        })
    } catch (error) { return respond(c, error) }
}
