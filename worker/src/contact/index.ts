import { Hono } from 'hono'

import { getContactAdminSecurityStatus, resolveAppMode } from '../app_mode'

export const api = new Hono<HonoCustomType>()

api.use('/admin/contact/*', async (c, next) => {
    if (resolveAppMode(c.env) !== 'contact') {
        return c.json({
            ok: false,
            error: {
                code: 'CONTACT_MODE_DISABLED',
                message: 'Contact Hub is not enabled',
            },
        }, 404)
    }
    await next()
})

api.get('/admin/contact/status', c => c.json({
    ok: true,
    mode: resolveAppMode(c.env),
    adminSecurity: getContactAdminSecurityStatus(c.env),
    phase: 1,
}))
