import { Context } from 'hono'

import { contactErrorResponse, requireContactId } from '../errors'
import {
    createProviderConfig,
    disableProviderConfig,
    getProviderConfig,
    listProviderConfigs,
    publicProviderConfig,
    updateProviderConfig,
    type ProviderConfigInput,
} from './config_service'

const respond = (c: Context<HonoCustomType>, error: unknown) => {
    const response = contactErrorResponse(error)
    return c.json(response.body, response.status)
}

export const list = async (c: Context<HonoCustomType>) => {
    try {
        return c.json({ ok: true, results: (await listProviderConfigs(c.env.DB)).map(config => publicProviderConfig(c.env, config)) })
    } catch (error) { return respond(c, error) }
}

export const get = async (c: Context<HonoCustomType>) => {
    try {
        return c.json({ ok: true, result: publicProviderConfig(
            c.env, await getProviderConfig(c.env.DB, requireContactId(c.req.param('id')))
        ) })
    } catch (error) { return respond(c, error) }
}

export const create = async (c: Context<HonoCustomType>) => {
    try {
        const config = await createProviderConfig(c.env.DB, await c.req.json<ProviderConfigInput>())
        return c.json({ ok: true, result: publicProviderConfig(c.env, config) }, 201)
    } catch (error) { return respond(c, error) }
}

export const update = async (c: Context<HonoCustomType>) => {
    try {
        const config = await updateProviderConfig(
            c.env.DB, requireContactId(c.req.param('id')), await c.req.json<ProviderConfigInput>(),
        )
        return c.json({ ok: true, result: publicProviderConfig(c.env, config) })
    } catch (error) { return respond(c, error) }
}

export const remove = async (c: Context<HonoCustomType>) => {
    try {
        const config = await disableProviderConfig(c.env.DB, requireContactId(c.req.param('id')))
        return c.json({ ok: true, result: publicProviderConfig(c.env, config) })
    } catch (error) { return respond(c, error) }
}
