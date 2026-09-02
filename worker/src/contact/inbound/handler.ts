import { Context } from 'hono'

import { commonParseMail, triggerAnotherWorker, triggerWebhook } from '../../common'
import { extractEmailInfo } from '../../email/ai_extract'
import { auto_reply } from '../../email/auto_reply'
import { check_if_junk_mail } from '../../email/check_junk'
import { forwardEmail } from '../../email/forward'
import { sendMailToTelegram } from '../../telegram_api'
import { getBooleanValue, getStringArray, normalizeAddressDomain } from '../../utils'
import type { ContactParsedMime } from './mime'
import { normalizeSenderDate, parseContactMime, toLegacyParsedEmailContext } from './mime'
import {
    findContactInboundMailbox,
    persistContactMessage,
    persistContactObjects,
} from './persistence'
import {
    type ContactSideEffect,
    runTrackedContactSideEffect,
} from './side_effects'

const fallbackParsedMime = (
    message: ForwardableEmailMessage,
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
    senderDate: normalizeSenderDate(message.headers.get('Date')),
    attachments: [],
    contentTruncated: false,
})

const maybeInjectSideEffectFailure = (env: Bindings, effect: ContactSideEffect): void => {
    if (!getBooleanValue(env.E2E_TEST_MODE)) return
    if (!getStringArray(env.CONTACT_E2E_FAIL_SIDE_EFFECTS).includes(effect)) return
    const error = new Error('Injected Contact side effect failure') as Error & { code?: string }
    error.name = 'ContactSideEffectInjectedError'
    error.code = 'E2E_SIDE_EFFECT_FAILURE'
    throw error
}

export const runPersistedSideEffects = async (
    message: ForwardableEmailMessage,
    env: Bindings,
    persistedMessageId: number,
    toAddress: string,
    rawEmail: string,
    parsedEmailContext: ParsedEmailContext,
    messageId: string | null,
): Promise<void> => {
    let aiExtractResult: Awaited<ReturnType<typeof extractEmailInfo>> = null

    await runTrackedContactSideEffect(env.DB, persistedMessageId, 'forward', async () => {
        maybeInjectSideEffectFailure(env, 'forward')
        await forwardEmail(message, env, true)
    })

    await runTrackedContactSideEffect(env.DB, persistedMessageId, 'ai_extract', async () => {
        maybeInjectSideEffectFailure(env, 'ai_extract')
        aiExtractResult = await extractEmailInfo(parsedEmailContext, env, messageId, toAddress, true)
    })

    await runTrackedContactSideEffect(env.DB, persistedMessageId, 'telegram', async () => {
        maybeInjectSideEffectFailure(env, 'telegram')
        await sendMailToTelegram(
            { env } as Context<HonoCustomType>,
            toAddress,
            parsedEmailContext,
            messageId,
            aiExtractResult,
        )
    })

    await runTrackedContactSideEffect(env.DB, persistedMessageId, 'webhook', async () => {
        maybeInjectSideEffectFailure(env, 'webhook')
        await triggerWebhook(
            { env } as Context<HonoCustomType>,
            toAddress,
            parsedEmailContext,
            messageId,
            aiExtractResult,
            true,
        )
    })

    await runTrackedContactSideEffect(env.DB, persistedMessageId, 'another_worker', async () => {
        maybeInjectSideEffectFailure(env, 'another_worker')
        const parsedEmail = await commonParseMail(parsedEmailContext)
        await triggerAnotherWorker(
            { env } as Context<HonoCustomType>,
            { from: message.from, to: toAddress, rawEmail, headers: message.headers },
            parsedEmail?.text || '',
            true,
        )
    })

    await runTrackedContactSideEffect(env.DB, persistedMessageId, 'auto_reply', async () => {
        maybeInjectSideEffectFailure(env, 'auto_reply')
        await auto_reply(message, env, toAddress, true)
    })
}

export const receiveContactEmail = async (
    message: ForwardableEmailMessage,
    env: Bindings,
    ctx: ExecutionContext,
): Promise<void> => {
    const receivedAt = new Date().toISOString()
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
        parsed = fallbackParsedMime(message)
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
            receivedAt,
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
    ctx.waitUntil(runPersistedSideEffects(
        message,
        env,
        persisted.id,
        toAddress,
        rawEmail,
        parsedEmailContext,
        parsed.messageId,
    ))
}
