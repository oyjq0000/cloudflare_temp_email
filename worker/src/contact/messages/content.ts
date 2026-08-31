import { decompressBlob } from '../../gzip'
import { ContactError } from '../errors'
import { parseContactMime } from '../inbound/mime'
import { safeDownloadHeaders } from './download'

type StoredRaw = {
    raw_storage_key: string | null
    raw: string | null
    raw_blob: ArrayBuffer | ArrayLike<number> | null
}

const rawFallback = async (row: StoredRaw): Promise<ArrayBuffer | null> => {
    if (row.raw_blob) {
        const buffer = row.raw_blob instanceof ArrayBuffer
            ? row.raw_blob
            : new Uint8Array(row.raw_blob).buffer
        return new TextEncoder().encode(await decompressBlob(buffer)).buffer
    }
    return row.raw === null ? null : new TextEncoder().encode(row.raw).buffer
}

const objectBody = async (bucket: R2Bucket | undefined, key: string | null) => {
    if (!bucket || !key) return null
    try {
        return await bucket.get(key)
    } catch (error) {
        console.error('Contact R2 read failed', { error: (error as Error).name || 'Error' })
        return null
    }
}

export const getContactRawDownload = async (
    db: D1Database,
    bucket: R2Bucket | undefined,
    messageId: number,
): Promise<Response> => {
    const row = await db.prepare(`
        SELECT m.raw_storage_key, r.raw, r.raw_blob
        FROM contact_messages m JOIN raw_mails r ON r.id = m.raw_mail_id
        WHERE m.id = ?
    `).bind(messageId).first<StoredRaw>()
    if (!row) throw new ContactError('CONTACT_MESSAGE_NOT_FOUND', 'Contact message was not found', 404)

    const stored = await objectBody(bucket, row.raw_storage_key)
    const fallback = stored ? null : await rawFallback(row)
    if (!stored && !fallback) {
        throw new ContactError('CONTACT_RAW_UNAVAILABLE', 'Raw message content is unavailable', 409)
    }
    return new Response(stored?.body || fallback, {
        headers: safeDownloadHeaders(`message-${messageId}.eml`, 'message/rfc822'),
    })
}

type StoredAttachment = StoredRaw & {
    filename: string
    mime_type: string
    storage_key: string
    attachment_index: number
}

export const getContactAttachmentDownload = async (
    db: D1Database,
    bucket: R2Bucket | undefined,
    attachmentId: number,
): Promise<Response> => {
    const row = await db.prepare(`
        SELECT a.filename, a.mime_type, a.storage_key, m.raw_storage_key, r.raw, r.raw_blob,
            (SELECT COUNT(*) FROM contact_attachments before
                WHERE before.message_id = a.message_id AND before.id < a.id) AS attachment_index
        FROM contact_attachments a
        JOIN contact_messages m ON m.id = a.message_id
        JOIN raw_mails r ON r.id = m.raw_mail_id
        WHERE a.id = ?
    `).bind(attachmentId).first<StoredAttachment>()
    if (!row) throw new ContactError('CONTACT_ATTACHMENT_NOT_FOUND', 'Contact attachment was not found', 404)

    const stored = await objectBody(bucket, row.storage_key)
    let fallback: Uint8Array | null = null
    if (!stored) {
        const raw = await rawFallback(row)
        if (raw) {
            try {
                fallback = (await parseContactMime(raw)).attachments[row.attachment_index]?.content || null
            } catch {
                throw new ContactError('CONTACT_ATTACHMENT_PARSE_FAILED', 'Stored attachment could not be parsed', 422)
            }
        }
    }
    if (!stored && !fallback) {
        throw new ContactError('CONTACT_ATTACHMENT_UNAVAILABLE', 'Attachment content is unavailable', 409)
    }
    return new Response(stored?.body || fallback, {
        headers: safeDownloadHeaders(row.filename, row.mime_type),
    })
}
