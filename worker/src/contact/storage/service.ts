import { ContactError } from '../errors'
import { parseContactMime } from '../inbound/mime'
import { persistContactObjects } from '../inbound/persistence'

type StorageCountRow = { storage_status: string, count: number }

export const getContactStorageStatus = async (
    db: D1Database,
    bucket: R2Bucket | undefined,
) => {
    const { results: messageRows } = await db.prepare(`
        SELECT storage_status, COUNT(*) AS count
        FROM contact_messages GROUP BY storage_status
    `).all<StorageCountRow>()
    const { results: attachmentRows } = await db.prepare(`
        SELECT storage_status, COUNT(*) AS count
        FROM contact_attachments GROUP BY storage_status
    `).all<StorageCountRow>()
    return {
        bindingAvailable: Boolean(bucket),
        messages: Object.fromEntries((messageRows || []).map(row => [row.storage_status, row.count])),
        attachments: Object.fromEntries((attachmentRows || []).map(row => [row.storage_status, row.count])),
    }
}

export const repairContactStorage = async (
    db: D1Database,
    bucket: R2Bucket | undefined,
    messageId: number,
) => {
    if (!bucket) {
        throw new ContactError('CONTACT_R2_UNAVAILABLE', 'CONTACT_R2 binding is not available', 503)
    }
    const message = await db.prepare(`
        SELECT m.id, m.raw_mail_id, m.raw_storage_key, r.raw
        FROM contact_messages m JOIN raw_mails r ON r.id = m.raw_mail_id
        WHERE m.id = ?
    `).bind(messageId).first<{
        id: number
        raw_mail_id: number
        raw_storage_key: string
        raw: string | null
    }>()
    if (!message) throw new ContactError('CONTACT_MESSAGE_NOT_FOUND', 'Contact message was not found', 404)
    if (!message.raw) {
        throw new ContactError(
            'CONTACT_RAW_FALLBACK_UNAVAILABLE',
            'The D1 raw fallback is unavailable for this message',
            409,
        )
    }
    const raw = new TextEncoder().encode(message.raw).buffer
    let parsed
    try {
        parsed = await parseContactMime(raw)
    } catch {
        throw new ContactError('CONTACT_MIME_REPAIR_FAILED', 'Stored raw MIME could not be parsed', 422)
    }
    const { results } = await db.prepare(`
        SELECT storage_key FROM contact_attachments WHERE message_id = ? ORDER BY id
    `).bind(messageId).all<{ storage_key: string }>()
    if ((results || []).length !== parsed.attachments.length) {
        throw new ContactError(
            'CONTACT_ATTACHMENT_REPAIR_MISMATCH',
            'Stored attachment metadata does not match the raw MIME',
            409,
        )
    }
    const status = await persistContactObjects(
        db,
        bucket,
        {
            id: message.id,
            rawMailId: message.raw_mail_id,
            duplicate: false,
            rawFallbackAvailable: true,
            keys: {
                raw: message.raw_storage_key,
                attachments: (results || []).map(row => row.storage_key),
            },
        },
        raw,
        parsed.attachments,
    )
    return { id: message.id, storageStatus: status }
}
