import { Jwt } from 'hono/utils/jwt'

export const CONTACT_ADMIN_SESSION_SCOPE = 'contact:admin' as const
export const CONTACT_ADMIN_SESSION_DEFAULT_TTL_SECONDS = 14_400
export const CONTACT_ADMIN_SESSION_MIN_TTL_SECONDS = 900
export const CONTACT_ADMIN_SESSION_MAX_TTL_SECONDS = 28_800

type ContactAdminSessionPayload = {
    scope: typeof CONTACT_ADMIN_SESSION_SCOPE
    iat: number
    exp: number
}

export const resolveContactAdminSessionTtl = (value: unknown): number => {
    if (value === undefined || value === null || value === '') {
        return CONTACT_ADMIN_SESSION_DEFAULT_TTL_SECONDS
    }
    const ttl = Number(value)
    if (
        !Number.isInteger(ttl)
        || ttl < CONTACT_ADMIN_SESSION_MIN_TTL_SECONDS
        || ttl > CONTACT_ADMIN_SESSION_MAX_TTL_SECONDS
    ) {
        return CONTACT_ADMIN_SESSION_DEFAULT_TTL_SECONDS
    }
    return ttl
}

export const signContactAdminSession = async (
    secret: string,
    ttlSeconds: number,
    nowSeconds = Math.floor(Date.now() / 1000),
) => {
    const payload: ContactAdminSessionPayload = {
        scope: CONTACT_ADMIN_SESSION_SCOPE,
        iat: nowSeconds,
        exp: nowSeconds + ttlSeconds,
    }
    return {
        token: await Jwt.sign(payload, secret, 'HS256'),
        payload,
    }
}

export const verifyContactAdminSession = async (
    token: string,
    secret: string,
    nowSeconds = Math.floor(Date.now() / 1000),
): Promise<ContactAdminSessionPayload | null> => {
    try {
        const payload = await Jwt.verify(token, secret, 'HS256')
        if (payload.scope !== CONTACT_ADMIN_SESSION_SCOPE) return null
        if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) return null
        if ((payload.exp as number) <= nowSeconds) return null
        if ((payload.iat as number) > (payload.exp as number)) return null
        return payload as ContactAdminSessionPayload
    } catch {
        return null
    }
}

export const parseContactAdminAuthorization = (
    value: string | null,
): { present: boolean, token: string | null } => {
    if (value === null) return { present: false, token: null }
    const normalized = value.trim()
    if (!/^Bearer /i.test(normalized)) return { present: true, token: null }
    const token = normalized.slice(7)
    const hasUnsafeCharacter = Array.from(token).some(character => {
        const code = character.charCodeAt(0)
        return code <= 32 || code === 127
    })
    return { present: true, token: token && !hasUnsafeCharacter ? token : null }
}
