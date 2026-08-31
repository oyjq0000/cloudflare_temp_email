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
