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

const providerUsageCount = async (db: D1Database, id: number) => (
    await db.prepare(`SELECT COUNT(*) AS count FROM contact_domains WHERE default_provider_config_id = ?`)
        .bind(id).first<number>('count') || 0
)

const publicConfigWithUsage = async (c: Context<HonoCustomType>, config: Awaited<ReturnType<typeof getProviderConfig>>) => {
    const inUseDomainCount = await providerUsageCount(c.env.DB, config.id)
    return {
        ...publicProviderConfig(c.env, config),
        in_use: inUseDomainCount > 0,
        in_use_domain_count: inUseDomainCount,
    }
}

export const list = async (c: Context<HonoCustomType>) => {
    try {
        const configs = await listProviderConfigs(c.env.DB)
        return c.json({ ok: true, results: await Promise.all(configs.map(config => publicConfigWithUsage(c, config))) })
    } catch (error) { return respond(c, error) }
}

export const get = async (c: Context<HonoCustomType>) => {
    try {
        return c.json({ ok: true, result: await publicConfigWithUsage(
            c, await getProviderConfig(c.env.DB, requireContactId(c.req.param('id')))
        ) })
    } catch (error) { return respond(c, error) }
}

export const create = async (c: Context<HonoCustomType>) => {
    try {
        const config = await createProviderConfig(c.env.DB, await c.req.json<ProviderConfigInput>())
        return c.json({ ok: true, result: await publicConfigWithUsage(c, config) }, 201)
    } catch (error) { return respond(c, error) }
}

export const update = async (c: Context<HonoCustomType>) => {
    try {
        const config = await updateProviderConfig(
            c.env.DB, requireContactId(c.req.param('id')), await c.req.json<ProviderConfigInput>(),
        )
        return c.json({ ok: true, result: await publicConfigWithUsage(c, config) })
    } catch (error) { return respond(c, error) }
}

export const remove = async (c: Context<HonoCustomType>) => {
    try {
        const config = await disableProviderConfig(c.env.DB, requireContactId(c.req.param('id')))
        return c.json({ ok: true, result: await publicConfigWithUsage(c, config) })
    } catch (error) { return respond(c, error) }
}
