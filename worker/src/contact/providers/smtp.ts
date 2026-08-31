import type { EmailOptions, WorkerMailerOptions } from 'worker-mailer'

import {
    configurationFailure,
    providerExceptionResult,
    type OutboundMessage,
    type OutboundProvider,
    type ProviderRuntimeConfig,
    type ProviderSendResult,
} from './types.ts'

type SmtpSend = (options: WorkerMailerOptions, email: EmailOptions) => Promise<void>
const workerMailerSend: SmtpSend = async (options, email) => {
    const { WorkerMailer } = await import('worker-mailer')
    return WorkerMailer.send(options, email)
}

const smtpErrorResult = (error: unknown): ProviderSendResult => {
    const explicitCode = Number((error as { responseCode?: unknown })?.responseCode)
        || Number((error as Error)?.message?.match(/\b([45]\d\d)\b/)?.[1])
    if (explicitCode >= 400 && explicitCode <= 599) {
        return {
            certainty: 'rejected',
            retryable: explicitCode < 500,
            errorClass: explicitCode < 500 ? 'provider_server_error' : 'provider_rejected',
            errorCode: `SMTP_${explicitCode}`,
            errorMessage: `SMTP server explicitly rejected the request with ${explicitCode}`,
        }
    }
    return providerExceptionResult(error)
}

export class SmtpProvider implements OutboundProvider {
    readonly type = 'smtp' as const
    private readonly sender: SmtpSend

    constructor(sender: SmtpSend = workerMailerSend) { this.sender = sender }

    async send(message: OutboundMessage, runtime: ProviderRuntimeConfig): Promise<ProviderSendResult> {
        const host = typeof runtime.config.host === 'string' ? runtime.config.host : ''
        const port = Number(runtime.config.port)
        const username = typeof runtime.config.username === 'string' ? runtime.config.username : ''
        if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
            return configurationFailure('SMTP_ENDPOINT_MISSING')
        }
        if (username && !runtime.secrets.password) return configurationFailure('SMTP_PASSWORD_MISSING')
        const options: WorkerMailerOptions = {
            host,
            port,
            secure: runtime.config.secure === true,
            startTls: runtime.config.starttls !== false,
            ...(username ? { credentials: { username, password: runtime.secrets.password } } : {}),
            socketTimeoutMs: Number(runtime.config.socket_timeout_ms) || 15_000,
            responseTimeoutMs: Number(runtime.config.response_timeout_ms) || 15_000,
        }
        try {
            await this.sender(options, {
                from: { name: message.fromName || '', email: message.fromAddress },
                to: { name: message.toName || '', email: message.toAddress },
                subject: message.subject,
                text: message.textBody || undefined,
                html: message.htmlBody || undefined,
                reply: message.replyTo ? { email: message.replyTo } : undefined,
                headers: {
                    ...(message.messageId ? { 'Message-ID': message.messageId } : {}),
                    ...(message.inReplyTo ? { 'In-Reply-To': message.inReplyTo } : {}),
                    ...(message.references?.length ? { References: message.references.join(' ') } : {}),
                },
            })
            return { certainty: 'accepted', retryable: false }
        } catch (error) { return smtpErrorResult(error) }
    }
}
