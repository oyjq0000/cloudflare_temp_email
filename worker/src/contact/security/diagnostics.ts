import type { ProviderSendResult } from '../providers/types.ts'

const ERROR_CLASSES = new Set([
    'authentication', 'configuration', 'network', 'network_timeout',
    'provider_rejected', 'provider_server_error', 'rate_limit', 'storage',
])

export const safeErrorMetadata = (error: unknown): Record<string, string> => {
    const name = typeof (error as Error)?.name === 'string'
        && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test((error as Error).name)
        ? (error as Error).name
        : 'Error'
    const code = typeof (error as { code?: unknown })?.code === 'string'
        && /^[A-Z][A-Z0-9_]{1,95}$/.test((error as { code: string }).code)
        ? (error as { code: string }).code
        : undefined
    return { name, ...(code ? { code } : {}) }
}

const providerMessage = (errorClass: string, certainty: ProviderSendResult['certainty']): string => {
    if (certainty === 'unknown') return 'Provider outcome is uncertain; automatic retry is disabled'
    if (errorClass === 'authentication') return 'Provider authentication was rejected'
    if (errorClass === 'configuration') return 'Provider configuration is incomplete'
    if (errorClass === 'rate_limit') return 'Provider rate limit rejected the request'
    if (errorClass === 'provider_server_error') return 'Provider server rejected the request'
    return 'Provider explicitly rejected the request'
}

export const sanitizeProviderResult = (result: ProviderSendResult): ProviderSendResult => {
    if (result.certainty === 'accepted') {
        return {
            certainty: 'accepted',
            retryable: false,
            ...(typeof result.providerMessageId === 'string'
                ? { providerMessageId: result.providerMessageId.replace(/[\r\n]/g, '').slice(0, 255) }
                : {}),
        }
    }
    const errorClass = typeof result.errorClass === 'string' && ERROR_CLASSES.has(result.errorClass)
        ? result.errorClass
        : result.certainty === 'unknown' ? 'network' : 'provider_rejected'
    const errorCode = typeof result.errorCode === 'string'
        && /^[A-Z0-9_:-]{2,96}$/.test(result.errorCode)
        && !result.errorCode.startsWith('CONTACT_')
        ? result.errorCode
        : result.certainty === 'unknown' ? 'PROVIDER_OUTCOME_UNKNOWN' : 'PROVIDER_REJECTED'
    return {
        certainty: result.certainty,
        retryable: result.certainty === 'rejected' && result.retryable === true,
        errorClass,
        errorCode,
        errorMessage: providerMessage(errorClass, result.certainty),
    }
}
