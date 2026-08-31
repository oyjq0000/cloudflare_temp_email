import { Context } from 'hono'

import { contactErrorResponse, requireContactId } from '../errors'
import { getContactAttachmentDownload, getContactRawDownload } from './content'
import {
    getContactMessage,
    listContactMessages,
    parseMessageListFilters,
    setContactMessageRead,
    setContactMessageSpam,
} from './service'

const respond = (c: Context<HonoCustomType>, error: unknown) => {
    const response = contactErrorResponse(error)
    return c.json(response.body, response.status)
}

export const list = async (c: Context<HonoCustomType>) => {
    try {
        return c.json({ ok: true, ...(await listContactMessages(c.env.DB, parseMessageListFilters(c.req.query()))) })
    } catch (error) { return respond(c, error) }
}

export const get = async (c: Context<HonoCustomType>) => {
    try {
        return c.json({ ok: true, result: await getContactMessage(c.env.DB, requireContactId(c.req.param('id'))) })
    } catch (error) { return respond(c, error) }
}

const changeRead = (isRead: boolean) => async (c: Context<HonoCustomType>) => {
    try {
        return c.json({
            ok: true,
            result: await setContactMessageRead(c.env.DB, requireContactId(c.req.param('id')), isRead),
        })
    } catch (error) { return respond(c, error) }
}

const changeSpam = (isSpam: boolean) => async (c: Context<HonoCustomType>) => {
    try {
        return c.json({
            ok: true,
            result: await setContactMessageSpam(c.env.DB, requireContactId(c.req.param('id')), isSpam),
        })
    } catch (error) { return respond(c, error) }
}

export const read = changeRead(true)
export const unread = changeRead(false)
export const spam = changeSpam(true)
export const notSpam = changeSpam(false)

export const raw = async (c: Context<HonoCustomType>) => {
    try {
        return await getContactRawDownload(c.env.DB, c.env.CONTACT_R2, requireContactId(c.req.param('id')))
    } catch (error) { return respond(c, error) }
}

export const attachment = async (c: Context<HonoCustomType>) => {
    try {
        return await getContactAttachmentDownload(c.env.DB, c.env.CONTACT_R2, requireContactId(c.req.param('id')))
    } catch (error) { return respond(c, error) }
}
