import { Context } from 'hono'

import { commonParseMail, triggerAnotherWorker, triggerWebhook } from '../../common'
import { extractEmailInfo } from '../../email/ai_extract'
import { auto_reply } from '../../email/auto_reply'
import { check_if_junk_mail } from '../../email/check_junk'
import { forwardEmail } from '../../email/forward'
import { sendMailToTelegram } from '../../telegram_api'
import { normalizeAddressDomain } from '../../utils'
import type { ContactParsedMime } from './mime'
import { parseContactMime, toLegacyParsedEmailContext } from './mime'
import {
    findContactInboundMailbox,
    persistContactMessage,
    persistContactObjects,
} from './persistence'

const fallbackParsedMime = (
    message: ForwardableEmailMessage,
    receivedAt: string,
): ContactParsedMime => ({
    fromName: null,
    fromAddress: message.from.trim().toLowerCase() || null,
    replyToAddress: null,
    cc: [],
    subject: (message.headers.get('Subject') || '').slice(0, 1_000),
    preview: '',
    text: '',
    html: '',
    headers: Array.from(message.headers.entries()).slice(0, 200).map(([key, value]) => ({
        key: key.slice(0, 128),
        value: value.slice(0, 8_192),
    })),
    messageId: message.headers.get('Message-ID')?.trim() || null,
    inReplyTo: message.headers.get('In-Reply-To')?.trim() || null,
    references: (message.headers.get('References') || '').split(/\s+/).filter(Boolean).slice(-100),
    receivedAt,
    attachments: [],
    contentTruncated: false,
})

const runPersistedSideEffects = async (
    message: ForwardableEmailMessage,
    env: Bindings,
    toAddress: string,
    rawEmail: string,
    parsedEmailContext: ParsedEmailContext,
    messageId: string | null,
) => {
    await forwardEmail(message, env)

    const aiExtractResult = await extractEmailInfo(parsedEmailContext, env, messageId, toAddress)
    try {
        await sendMailToTelegram(
            { env } as Context<HonoCustomType>,
            toAddress,
            parsedEmailContext,
            messageId,
            aiExtractResult,
        )
    } catch (error) {
        console.error('Contact Telegram side effect failed', { error: (error as Error).name || 'Error' })
    }
    try {
        await triggerWebhook(
            { env } as Context<HonoCustomType>,
            toAddress,
            parsedEmailContext,
            messageId,
            aiExtractResult,
        )
    } catch (error) {
        console.error('Contact webhook side effect failed', { error: (error as Error).name || 'Error' })
    }
    try {
        const parsedEmail = await commonParseMail(parsedEmailContext)
        await triggerAnotherWorker(
            { env } as Context<HonoCustomType>,
            { from: message.from, to: toAddress, rawEmail, headers: message.headers },
            parsedEmail?.text || '',
        )
    } catch (error) {
        console.error('Contact Worker side effect failed', { error: (error as Error).name || 'Error' })
    }
    await auto_reply(message, env, toAddress)
}

export const receiveContactEmail = async (
    message: ForwardableEmailMessage,
    env: Bindings,
    _ctx: ExecutionContext,
): Promise<void> => {
    const toAddress = normalizeAddressDomain(message.to)
    const mailbox = await findContactInboundMailbox(env.DB, toAddress)
    if (!mailbox) {
        message.setReject('Unknown or disabled Contact Mailbox')
        return
    }

    const raw = await new Response(message.raw).arrayBuffer()
    const rawEmail = new TextDecoder().decode(raw)
    let parsed: ContactParsedMime
    let parseStatus: 'parsed' | 'failed' = 'parsed'
    let parseError: string | null = null
    try {
        parsed = await parseContactMime(raw)
    } catch (error) {
        parseStatus = 'failed'
        parseError = (error as Error).name?.slice(0, 100) || 'ParseError'
        parsed = fallbackParsedMime(message, new Date().toISOString())
    }
    const parsedEmailContext = toLegacyParsedEmailContext(rawEmail, parsed)

    let isJunk = false
    try {
        isJunk = await check_if_junk_mail(env, toAddress, parsedEmailContext, parsed.messageId)
    } catch (error) {
        console.error('Contact junk classification failed', { error: (error as Error).name || 'Error' })
    }

    let persisted
    try {
        persisted = await persistContactMessage(env.DB, mailbox, {
            envelopeFrom: message.from,
            toAddress,
            raw,
            rawEmail,
            parsed,
            folder: isJunk ? 'spam' : 'inbox',
            spamReason: isJunk ? 'authentication-policy' : null,
            parseStatus,
            parseError,
        })
    } catch (error) {
        message.setReject('Contact message persistence failed')
        console.error('Contact inbound rejected after D1 failure', { error: (error as Error).name || 'Error' })
        return
    }

    if (persisted.duplicate) return

    try {
        await persistContactObjects(env.DB, env.CONTACT_R2, persisted, raw, parsed.attachments)
    } catch (error) {
        console.error('Contact storage status persistence failed', {
            messageId: persisted.id,
            error: (error as Error).name || 'Error',
        })
    }

    if (isJunk || parseStatus === 'failed') return
    await runPersistedSideEffects(
        message,
        env,
        toAddress,
        rawEmail,
        parsedEmailContext,
        parsed.messageId,
    )
}
