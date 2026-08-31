import { acceptedHttpResult, parseJsonResponse, rejectedHttpResult } from './http.ts'
import {
    configurationFailure,
    providerExceptionResult,
    type OutboundMessage,
    type OutboundProvider,
    type ProviderRuntimeConfig,
    type ProviderSendResult,
} from './types.ts'

export class BrevoProvider implements OutboundProvider {
    readonly type = 'brevo' as const
    private readonly fetcher: typeof fetch
    private readonly endpoint: string

    constructor(fetcher: typeof fetch = fetch, endpoint = 'https://api.brevo.com/v3/smtp/email') {
        this.fetcher = fetcher
        this.endpoint = endpoint
    }

    async send(message: OutboundMessage, runtime: ProviderRuntimeConfig): Promise<ProviderSendResult> {
        if (!runtime.secrets.apiKey) return configurationFailure('BREVO_API_KEY_MISSING')
        try {
            const response = await this.fetcher(this.endpoint, {
                method: 'POST',
                headers: { 'api-key': runtime.secrets.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sender: { email: message.fromAddress, ...(message.fromName ? { name: message.fromName } : {}) },
                    to: [{ email: message.toAddress, ...(message.toName ? { name: message.toName } : {}) }],
                    subject: message.subject,
                    ...(message.textBody ? { textContent: message.textBody } : {}),
                    ...(message.htmlBody ? { htmlContent: message.htmlBody } : {}),
                    ...(message.replyTo ? { replyTo: { email: message.replyTo } } : {}),
                    ...(message.messageId ? { headers: { 'Message-ID': message.messageId } } : {}),
                }),
            })
            if (!response.ok) return rejectedHttpResult(response.status)
            return acceptedHttpResult((await parseJsonResponse(response)).messageId)
        } catch (error) { return providerExceptionResult(error) }
    }
}
