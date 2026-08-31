import { Hono } from 'hono'

import { getContactAdminSecurityStatus, resolveAppMode } from '../app_mode'
import * as dbApi from './db/api'
import * as domainApi from './domains/api'
import * as mailboxApi from './mailboxes/api'
import * as messageApi from './messages/api'
import * as providerApi from './providers/config_api'
import * as storageApi from './storage/api'

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
    phase: 5,
}))

api.get('/admin/contact/db/version', dbApi.getVersion)
api.post('/admin/contact/db/migrate', dbApi.migrate)

api.get('/admin/contact/storage/status', storageApi.status)
api.post('/admin/contact/storage/repair/:id', storageApi.repair)

api.get('/admin/contact/domains', domainApi.list)
api.post('/admin/contact/domains', domainApi.create)
api.get('/admin/contact/domains/:id', domainApi.get)
api.patch('/admin/contact/domains/:id', domainApi.update)
api.delete('/admin/contact/domains/:id', domainApi.remove)

api.get('/admin/contact/mailboxes', mailboxApi.list)
api.post('/admin/contact/mailboxes', mailboxApi.create)
api.get('/admin/contact/mailboxes/:id', mailboxApi.get)
api.patch('/admin/contact/mailboxes/:id', mailboxApi.update)
api.delete('/admin/contact/mailboxes/:id', mailboxApi.remove)

api.get('/admin/contact/providers', providerApi.list)
api.post('/admin/contact/providers', providerApi.create)
api.get('/admin/contact/providers/:id', providerApi.get)
api.patch('/admin/contact/providers/:id', providerApi.update)
api.delete('/admin/contact/providers/:id', providerApi.remove)

api.get('/admin/contact/messages', messageApi.list)
api.get('/admin/contact/messages/:id', messageApi.get)
api.post('/admin/contact/messages/:id/read', messageApi.read)
api.post('/admin/contact/messages/:id/unread', messageApi.unread)
api.post('/admin/contact/messages/:id/spam', messageApi.spam)
api.post('/admin/contact/messages/:id/not-spam', messageApi.notSpam)
api.get('/admin/contact/messages/:id/raw', messageApi.raw)
api.get('/admin/contact/attachments/:id', messageApi.attachment)
