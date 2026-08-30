export type AppMode = 'temp' | 'contact'

export type AppCapabilities = {
    contactHub: boolean
    publicMailbox: boolean
    publicAddressCreation: boolean
    publicRegistration: boolean
    publicSendMail: boolean
    userPortal: boolean
}

type AppModeEnv = Partial<Pick<
    Bindings,
    | 'CONTACT_MAIL_MODE'
    | 'ADMIN_PASSWORDS'
    | 'ADMIN_USER_ROLE'
    | 'DISABLE_ADMIN_PASSWORD_CHECK'
    | 'E2E_TEST_MODE'
>>

export type ContactAdminSecurityStatus = {
    secure: boolean
    code: 'OK' | 'CONTACT_ADMIN_AUTH_REQUIRED' | 'CONTACT_ADMIN_PASSWORD_BYPASS_FORBIDDEN'
}

const isTrue = (value: unknown): boolean => {
    if (value === true) return true
    return typeof value === 'string' && value.trim().toLowerCase() === 'true'
}

const hasConfiguredAdminPassword = (value: string | string[] | undefined): boolean => {
    if (Array.isArray(value)) {
        return value.some(item => typeof item === 'string' && item.trim().length > 0)
    }
    if (typeof value !== 'string' || value.trim().length === 0) return false
    try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed)
            && parsed.some(item => typeof item === 'string' && item.trim().length > 0)
    } catch {
        return false
    }
}

export const resolveAppMode = (env: Partial<Pick<Bindings, 'CONTACT_MAIL_MODE'>>): AppMode => (
    isTrue(env.CONTACT_MAIL_MODE) ? 'contact' : 'temp'
)

export const getAppCapabilities = (mode: AppMode): AppCapabilities => {
    const contactMode = mode === 'contact'
    return {
        contactHub: contactMode,
        publicMailbox: !contactMode,
        publicAddressCreation: !contactMode,
        publicRegistration: !contactMode,
        publicSendMail: !contactMode,
        userPortal: !contactMode,
    }
}

export const getContactAdminSecurityStatus = (env: AppModeEnv): ContactAdminSecurityStatus => {
    if (resolveAppMode(env) !== 'contact') return { secure: true, code: 'OK' }

    const passwordBypass = isTrue(env.DISABLE_ADMIN_PASSWORD_CHECK)
    const e2eMode = isTrue(env.E2E_TEST_MODE)
    if (passwordBypass && !e2eMode) {
        return { secure: false, code: 'CONTACT_ADMIN_PASSWORD_BYPASS_FORBIDDEN' }
    }
    if (passwordBypass && e2eMode) return { secure: true, code: 'OK' }

    const hasPassword = hasConfiguredAdminPassword(env.ADMIN_PASSWORDS)
    const hasAdminRole = typeof env.ADMIN_USER_ROLE === 'string'
        && env.ADMIN_USER_ROLE.trim().length > 0
    if (!hasPassword && !hasAdminRole) {
        return { secure: false, code: 'CONTACT_ADMIN_AUTH_REQUIRED' }
    }
    return { secure: true, code: 'OK' }
}

const isAllowedContactUserAuthPath = (path: string): boolean => (
    path === '/user_api/login'
    || path === '/user_api/settings'
    || path === '/user_api/passkey/authenticate_request'
    || path === '/user_api/passkey/authenticate_response'
)

export const isContactModePublicPathBlocked = (path: string): boolean => {
    if (path.startsWith('/api/')) return true
    if (path.startsWith('/external/')) return true
    if (path.startsWith('/telegram/')) return true
    if (path === '/open_api/credential_login') return true
    if (path.startsWith('/user_api/')) return !isAllowedContactUserAuthPath(path)
    return false
}

export const contactModeDisabledResponse = () => ({
    ok: false as const,
    error: {
        code: 'CONTACT_MODE_PUBLIC_CAPABILITY_DISABLED',
        message: 'This public capability is disabled in Contact Mode',
    },
})
