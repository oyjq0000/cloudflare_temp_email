import { acceptedHttpResult, address, parseJsonResponse, rejectedHttpResult } from './http.ts'
import {
    configurationFailure,
    providerExceptionResult,
    type OutboundMessage,
    type OutboundProvider,
    type ProviderRuntimeConfig,
    type ProviderSendResult,
} from './types.ts'

export class ResendProvider implements OutboundProvider {
    readonly type = 'resend' as const
    private readonly fetcher: typeof fetch
    private readonly endpoint: string

    constructor(fetcher: typeof fetch = fetch, endpoint = 'https://api.resend.com/emails') {
        this.fetcher = fetcher
        this.endpoint = endpoint
    }

    async send(message: OutboundMessage, runtime: ProviderRuntimeConfig): Promise<ProviderSendResult> {
        if (!runtime.secrets.apiKey) return configurationFailure('RESEND_API_KEY_MISSING')
        try {
            const response = await this.fetcher(this.endpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${runtime.secrets.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    from: address(message.fromName, message.fromAddress),
                    to: address(message.toName, message.toAddress),
                    subject: message.subject,
                    ...(message.textBody ? { text: message.textBody } : {}),
                    ...(message.htmlBody ? { html: message.htmlBody } : {}),
                    ...(message.replyTo ? { reply_to: message.replyTo } : {}),
                    ...(
                        message.messageId || message.inReplyTo || message.references?.length
                            ? { headers: {
                                ...(message.messageId ? { 'Message-ID': message.messageId } : {}),
                                ...(message.inReplyTo ? { 'In-Reply-To': message.inReplyTo } : {}),
                                ...(message.references?.length ? { References: message.references.join(' ') } : {}),
                            } }
                            : {}
                    ),
                }),
            })
            if (!response.ok) return rejectedHttpResult(response.status)
            const json = await parseJsonResponse(response)
            return acceptedHttpResult(json.id || (json.data as Record<string, unknown> | undefined)?.id)
        } catch (error) { return providerExceptionResult(error) }
    }
}
