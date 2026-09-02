import { Context, Hono } from 'hono'
import { Jwt } from 'hono/utils/jwt'

import { resolveAppMode } from '../app_mode'
import {
    resolveContactAdminSessionTtl,
    signContactAdminSession,
} from '../contact/security/admin_session'
import utils, { checkCfTurnstile, getPasswords, getAdminPasswords, hashPassword } from '../utils'
import i18n from '../i18n'

const api = new Hono<HonoCustomType>()

const checkLoginTurnstile = async (
    c: Context<HonoCustomType>,
    cfToken: string | undefined,
): Promise<Response | null> => {
    if (!utils.isGlobalTurnstileEnabled(c)) return null
    try {
        await checkCfTurnstile(c, cfToken)
        return null
    } catch {
        return c.text(i18n.getMessagesbyContext(c).TurnstileCheckFailedMsg, 400)
    }
}

const validateHashedAdminPassword = async (
    c: Context<HonoCustomType>,
    password: string | undefined,
): Promise<Response | null> => {
    const adminPasswords = getAdminPasswords(c)
    const hashedPasswords = await Promise.all(adminPasswords.map(p => hashPassword(p)))
    if (!hashedPasswords.length || !password || !hashedPasswords.includes(password)) {
        return c.text(i18n.getMessagesbyContext(c).NeedAdminPasswordMsg, 401)
    }
    return null
}

const validateContactSiteAccess = (
    c: Context<HonoCustomType>,
): Response | null => {
    const passwords = getPasswords(c)
    if (!passwords.length) return null
    const supplied = c.req.header('x-custom-auth')
    if (!supplied || !passwords.includes(supplied)) {
        return c.text(i18n.getMessagesbyContext(c).CustomAuthPasswordMsg, 401)
    }
    return null
}

api.post('/open_api/site_login', async (c) => {
    const { password, cf_token } = await c.req.json()
    const turnstileError = await checkLoginTurnstile(c, cf_token)
    if (turnstileError) return turnstileError
    const passwords = getPasswords(c)
    const hashedPasswords = await Promise.all(passwords.map(p => hashPassword(p)))
    if (!hashedPasswords.length || !password || !hashedPasswords.includes(password)) {
        return c.text(i18n.getMessagesbyContext(c).CustomAuthPasswordMsg, 401)
    }
    return c.json({ success: true })
})

api.post('/open_api/admin_login', async (c) => {
    const { password, cf_token } = await c.req.json()
    const turnstileError = await checkLoginTurnstile(c, cf_token)
    if (turnstileError) return turnstileError
    const passwordError = await validateHashedAdminPassword(c, password)
    if (passwordError) return passwordError
    return c.json({ success: true })
})

api.post('/open_api/contact_admin_login', async (c) => {
    if (resolveAppMode(c.env) !== 'contact') return c.text('Contact Mail Mode is disabled', 404)
    const { password, cf_token } = await c.req.json()
    const siteAccessError = validateContactSiteAccess(c)
    if (siteAccessError) return siteAccessError
    const turnstileError = await checkLoginTurnstile(c, cf_token)
    if (turnstileError) return turnstileError
    const passwordError = await validateHashedAdminPassword(c, password)
    if (passwordError) return passwordError

    const ttl = resolveContactAdminSessionTtl(c.env.CONTACT_ADMIN_SESSION_TTL_SECONDS)
    const { token, payload } = await signContactAdminSession(c.env.JWT_SECRET, ttl)
    return c.json({
        success: true,
        token,
        expires_in: ttl,
        expires_at: new Date(payload.exp * 1000).toISOString(),
    })
})

api.post('/open_api/credential_login', async (c) => {
    const { credential, cf_token } = await c.req.json()
    const msgs = i18n.getMessagesbyContext(c)
    const turnstileError = await checkLoginTurnstile(c, cf_token)
    if (turnstileError) return turnstileError
    if (!credential) {
        return c.text(msgs.InvalidAddressCredentialMsg, 401)
    }
    try {
        const payload = await Jwt.verify(credential, c.env.JWT_SECRET, 'HS256')
        if (!payload.address) {
            return c.text(msgs.InvalidAddressCredentialMsg, 401)
        }
    } catch {
        return c.text(msgs.InvalidAddressCredentialMsg, 401)
    }
    return c.json({ success: true })
})

export { api }
