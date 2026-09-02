import type { ProviderSendResult } from './types.ts'

const providerId = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined
    const normalized = value.replace(/[\r\n]/g, '').slice(0, 255)
    return normalized || undefined
}

export const parseJsonResponse = async (response: Response): Promise<Record<string, unknown>> => {
    try {
        const value = await response.json()
        return value && typeof value === 'object' ? value as Record<string, unknown> : {}
    } catch { return {} }
}

export const acceptedHttpResult = (id: unknown): ProviderSendResult => ({
    certainty: 'accepted',
    retryable: false,
    ...(providerId(id) ? { providerMessageId: providerId(id) } : {}),
})

export const rejectedHttpResult = (status: number): ProviderSendResult => {
    const authentication = status === 401 || status === 403
    const rateLimited = status === 429
    const server = status >= 500
    return {
        certainty: 'rejected',
        retryable: rateLimited || server,
        errorClass: authentication
            ? 'authentication'
            : rateLimited ? 'rate_limit' : server ? 'provider_server_error' : 'provider_rejected',
        errorCode: `HTTP_${status}`,
        errorMessage: `Provider explicitly rejected the request with HTTP ${status}`,
    }
}

export const address = (name: string | null | undefined, email: string) => (
    name ? `${name.replace(/[\r\n]/g, ' ')} <${email}>` : email
)

export const CONTACT_PROVIDER_HTTP_TIMEOUT_DEFAULT_MS = 15_000
export const CONTACT_PROVIDER_HTTP_TIMEOUT_MIN_MS = 1_000
export const CONTACT_PROVIDER_HTTP_TIMEOUT_MAX_MS = 60_000

export const resolveProviderHttpTimeoutMs = (value: unknown): number => {
    if (value === undefined || value === null || value === '') return CONTACT_PROVIDER_HTTP_TIMEOUT_DEFAULT_MS
    const timeout = Number(value)
    if (
        !Number.isInteger(timeout)
        || timeout < CONTACT_PROVIDER_HTTP_TIMEOUT_MIN_MS
        || timeout > CONTACT_PROVIDER_HTTP_TIMEOUT_MAX_MS
    ) return CONTACT_PROVIDER_HTTP_TIMEOUT_DEFAULT_MS
    return timeout
}

export const providerHttpFetch = async (
    fetcher: typeof fetch,
    input: RequestInfo | URL,
    init: RequestInit,
    timeoutMs: number,
): Promise<Response> => {
    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            controller.abort()
            reject(new DOMException('Provider request timed out', 'TimeoutError'))
        }, timeoutMs)
    })
    try {
        return await Promise.race([
            fetcher(input, { ...init, signal: controller.signal }),
            timeout,
        ])
    } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
}
