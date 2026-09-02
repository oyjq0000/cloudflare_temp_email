export type ProviderType = 'resend' | 'brevo' | 'smtp'
export type DeliveryCertainty = 'accepted' | 'rejected' | 'unknown'

export type OutboundMessage = {
    fromName?: string | null
    fromAddress: string
    toName?: string | null
    toAddress: string
    subject: string
    textBody?: string | null
    htmlBody?: string | null
    replyTo?: string | null
    messageId?: string | null
    inReplyTo?: string | null
    references?: string[]
}

export type ProviderRuntimeConfig = {
    config: Record<string, unknown>
    secrets: Record<string, string>
    httpTimeoutMs?: number
}

export type ProviderSendResult = {
    certainty: DeliveryCertainty
    providerMessageId?: string
    retryable: boolean
    errorClass?: string
    errorCode?: string
    errorMessage?: string
}

export interface OutboundProvider {
    readonly type: ProviderType
    send(message: OutboundMessage, config: ProviderRuntimeConfig): Promise<ProviderSendResult>
}

export const configurationFailure = (code: string): ProviderSendResult => ({
    certainty: 'rejected',
    retryable: false,
    errorClass: 'configuration',
    errorCode: code,
    errorMessage: 'Provider configuration is incomplete',
})

export const providerExceptionResult = (error: unknown): ProviderSendResult => {
    const name = (error as Error)?.name || ''
    const timeout = /timeout/i.test(name) || /timeout/i.test((error as Error)?.message || '')
    return {
        certainty: 'unknown',
        retryable: false,
        errorClass: timeout ? 'network_timeout' : 'network',
        errorCode: timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK_ERROR',
        errorMessage: timeout
            ? 'Provider request timed out with an uncertain delivery result'
            : 'Provider connection ended with an uncertain delivery result',
    }
}
