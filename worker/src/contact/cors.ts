import type { MiddlewareHandler } from 'hono'

export type ContactCorsDecision = {
    allowed: boolean
    origin?: string
}

export const CONTACT_CORS_ALLOWED_HEADERS = [
    'Content-Type',
    'Authorization',
    'X-Admin-Auth',
    'X-User-Token',
    'X-User-Access-Token',
    'X-Custom-Auth',
    'X-Fingerprint',
    'Idempotency-Key',
    'X-Lang',
].join(', ')

const normalizedOrigin = (value: string): string | null => {
    try {
        const url = new URL(value)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
        if (url.pathname !== '/' || url.search || url.hash) return null
        return url.origin
    } catch { return null }
}

export const parseContactAllowedOrigins = (value: unknown): string[] => {
    let entries: unknown[] = []
    if (Array.isArray(value)) entries = value
    else if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value)
            entries = Array.isArray(parsed) ? parsed : [value]
        } catch { entries = value.split(',') }
    }
    return [...new Set(entries
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '*')
        .map(entry => normalizedOrigin(entry.trim()))
        .filter((entry): entry is string => Boolean(entry)))]
}

export const contactCorsDecision = (
    requestOrigin: string | null,
    workerOrigin: string,
    configured: unknown,
): ContactCorsDecision => {
    if (!requestOrigin) return { allowed: true }
    const origin = normalizedOrigin(requestOrigin)
    if (!origin) return { allowed: false }
    const allowlist = new Set([workerOrigin, ...parseContactAllowedOrigins(configured)])
    return allowlist.has(origin) ? { allowed: true, origin } : { allowed: false }
}

const isContactApiPath = (path: string) => path === '/admin/contact' || path.startsWith('/admin/contact/')

export const contactCors = (): MiddlewareHandler<HonoCustomType> => async (c, next) => {
    if (!isContactApiPath(c.req.path)) return next()
    const decision = contactCorsDecision(
        c.req.header('Origin') || null,
        new URL(c.req.raw.url).origin,
        c.env.CONTACT_ALLOWED_ORIGINS,
    )
    if (!decision.allowed) {
        return c.json({
            ok: false,
            error: { code: 'CONTACT_ORIGIN_FORBIDDEN', message: 'Origin is not allowed for Contact Hub' },
        }, 403)
    }
    if (decision.origin) {
        c.header('Access-Control-Allow-Origin', decision.origin)
        c.header('Vary', 'Origin')
        c.header('Access-Control-Allow-Credentials', 'true')
    }
    if (c.req.method === 'OPTIONS') {
        c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
        c.header(
            'Access-Control-Allow-Headers',
            CONTACT_CORS_ALLOWED_HEADERS,
        )
        c.header('Access-Control-Max-Age', '600')
        return c.body(null, 204)
    }
    await next()
}
