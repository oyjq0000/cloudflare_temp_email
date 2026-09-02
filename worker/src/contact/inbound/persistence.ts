import { ContactError } from '../errors'
import { contactDedupeKey, contactRawMailId, contactStorageId, sha256Hex } from './identity'
import type { ContactParsedMime } from './mime'
import { contactObjectKeys, storeContactObjects } from '../storage/object_store'
import { sideEffectInsertStatements } from './side_effects'

const MAX_D1_RAW_BYTES = 1_500_000

type ContactInboundMailbox = {
    id: number
    domain_id: number
    address_id: number
    address: string
    domain: string
}

export type PersistContactMessageInput = {
    envelopeFrom: string
    toAddress: string
    raw: ArrayBuffer
    rawEmail: string
    parsed: ContactParsedMime
    folder: 'inbox' | 'spam'
    spamReason: string | null
    parseStatus?: 'parsed' | 'failed'
    parseError?: string | null
    receivedAt: string
}

export type PersistedContactMessage = {
    id: number
    rawMailId: number
    duplicate: boolean
    rawFallbackAvailable: boolean
    keys: { raw: string, attachments: string[] }
}

export const findContactInboundMailbox = async (
    db: D1Database,
    toAddress: string,
): Promise<ContactInboundMailbox | null> => db.prepare(`
    SELECT m.id, m.domain_id, m.address_id, m.address, d.domain
    FROM contact_mailboxes m
    JOIN contact_domains d ON d.id = m.domain_id
    WHERE m.address = ? COLLATE NOCASE
      AND m.enabled = 1 AND m.inbound_enabled = 1
      AND d.enabled = 1 AND d.inbound_enabled = 1
    LIMIT 1
`).bind(toAddress).first<ContactInboundMailbox>()

const serializeError = (error: unknown): string => (error as Error)?.name?.slice(0, 100) || 'ParseError'

export const persistContactMessage = async (
    db: D1Database,
    mailbox: ContactInboundMailbox,
    input: PersistContactMessageInput,
): Promise<PersistedContactMessage> => {
    const dedupeKey = await contactDedupeKey(
        input.toAddress,
        input.envelopeFrom,
        input.parsed.messageId,
        input.raw,
    )
    const storageId = contactStorageId()
    const keys = contactObjectKeys(storageId, input.parsed.attachments.length)
    const rawMailId = contactRawMailId()
    const rawFallbackAvailable = input.raw.byteLength <= MAX_D1_RAW_BYTES
    const statements: D1PreparedStatement[] = [
        db.prepare(`
            INSERT INTO raw_mails(id, message_id, source, address, raw, created_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).bind(
            rawMailId,
            input.parsed.messageId || dedupeKey,
            input.envelopeFrom,
            input.toAddress,
            rawFallbackAvailable ? input.rawEmail : null,
        ),
        db.prepare(`
            INSERT INTO contact_messages(
                raw_mail_id, domain_id, mailbox_id, envelope_from,
                from_name, from_address, reply_to_address, to_address,
                cc_json, headers_json, subject, preview, text_body, html_body,
                message_id_header, in_reply_to_header, references_json,
                dedupe_key, folder, spam_reason, has_attachments,
                raw_storage_key, storage_status, parse_status, parse_error,
                content_truncated, sender_date, received_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
        `).bind(
            rawMailId, mailbox.domain_id, mailbox.id, input.envelopeFrom,
            input.parsed.fromName, input.parsed.fromAddress, input.parsed.replyToAddress,
            input.toAddress, JSON.stringify(input.parsed.cc), JSON.stringify(input.parsed.headers),
            input.parsed.subject, input.parsed.preview, input.parsed.text, input.parsed.html,
            input.parsed.messageId, input.parsed.inReplyTo, JSON.stringify(input.parsed.references),
            dedupeKey, input.folder, input.spamReason, input.parsed.attachments.length > 0 ? 1 : 0,
            keys.raw, input.parseStatus || 'parsed', input.parseError || null,
            input.parsed.contentTruncated ? 1 : 0, input.parsed.senderDate, input.receivedAt,
        ),
    ]
    statements.push(...sideEffectInsertStatements(
        db,
        dedupeKey,
        input.folder === 'spam' || input.parseStatus === 'failed',
    ))

    for (let index = 0; index < input.parsed.attachments.length; index += 1) {
        const attachment = input.parsed.attachments[index]
        statements.push(db.prepare(`
            INSERT INTO contact_attachments(
                message_id, filename, mime_type, disposition, content_id,
                size, sha256, storage_key, storage_status
            )
            SELECT id, ?, ?, ?, ?, ?, ?, ?, 'pending'
            FROM contact_messages WHERE dedupe_key = ?
        `).bind(
            attachment.filename, attachment.mimeType, attachment.disposition,
            attachment.contentId, attachment.content.byteLength,
            await sha256Hex(attachment.content), keys.attachments[index], dedupeKey,
        ))
    }

    try {
        const results = await db.batch(statements)
        if (!results.every(result => result.success)) {
            throw new ContactError('CONTACT_MESSAGE_PERSIST_FAILED', 'Contact message could not be persisted', 500)
        }
    } catch (error) {
        if ((error as Error).message?.includes('UNIQUE')) {
            const existing = await db.prepare(`
                SELECT id, raw_mail_id, raw_storage_key
                FROM contact_messages WHERE dedupe_key = ?
            `).bind(dedupeKey).first<{ id: number, raw_mail_id: number, raw_storage_key: string }>()
            if (existing) {
                return {
                    id: existing.id,
                    rawMailId: existing.raw_mail_id,
                    duplicate: true,
                    rawFallbackAvailable: true,
                    keys: { raw: existing.raw_storage_key, attachments: [] },
                }
            }
        }
        console.error('Contact D1 persistence failed', { error: serializeError(error) })
        throw error
    }

    const row = await db.prepare(`SELECT id FROM contact_messages WHERE dedupe_key = ?`)
        .bind(dedupeKey).first<{ id: number }>()
    if (!row) throw new ContactError('CONTACT_MESSAGE_PERSIST_FAILED', 'Contact message could not be loaded', 500)
    return { id: row.id, rawMailId, duplicate: false, rawFallbackAvailable, keys }
}

export const persistContactObjects = async (
    db: D1Database,
    bucket: R2Bucket | undefined,
    message: PersistedContactMessage,
    raw: ArrayBuffer,
    attachments: ContactParsedMime['attachments'],
): Promise<'stored' | 'fallback' | 'degraded'> => {
    if (message.duplicate) return 'stored'
    if (!bucket) {
        const status = message.rawFallbackAvailable ? 'fallback' : 'degraded'
        await db.batch([
            db.prepare(`UPDATE contact_messages SET storage_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
                .bind(status, message.id),
            db.prepare(`UPDATE contact_attachments SET storage_status = ? WHERE message_id = ?`)
                .bind(status, message.id),
        ])
        return status
    }

    const result = await storeContactObjects(bucket, raw, attachments, message.keys)
    const allStored = result.raw.stored && result.attachments.every(item => item.stored)
    const messageStatus = allStored ? 'stored' : 'degraded'
    const statements: D1PreparedStatement[] = [
        db.prepare(`UPDATE contact_messages SET storage_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .bind(messageStatus, message.id),
    ]
    for (const attachment of result.attachments) {
        statements.push(db.prepare(`
            UPDATE contact_attachments SET storage_status = ?
            WHERE message_id = ? AND storage_key = ?
        `).bind(attachment.stored ? 'stored' : 'degraded', message.id, attachment.storageKey))
    }
    const updates = await db.batch(statements)
    if (!updates.every(update => update.success)) {
        console.error('Contact storage status update failed', { messageId: message.id })
    }
    return messageStatus
}
