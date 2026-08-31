import type { OutboundMessage, ProviderSendResult } from './types.ts'
import { providerExceptionResult } from './types.ts'

type BindingSend = (message: Record<string, unknown>) => Promise<unknown>

export class CloudflareBindingProvider {
    private readonly sender: BindingSend

    constructor(sender: BindingSend) { this.sender = sender }

    async send(message: OutboundMessage): Promise<ProviderSendResult> {
        try {
            await this.sender({
                from: message.fromName
                    ? { email: message.fromAddress, name: message.fromName }
                    : message.fromAddress,
                to: [message.toName ? `${message.toName} <${message.toAddress}>` : message.toAddress],
                subject: message.subject,
                ...(message.htmlBody ? { html: message.htmlBody } : { text: message.textBody || '' }),
            })
            return { certainty: 'accepted', retryable: false }
        } catch (error) { return providerExceptionResult(error) }
    }
}
