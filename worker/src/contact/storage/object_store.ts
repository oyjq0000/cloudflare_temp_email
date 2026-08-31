import { sha256Hex } from '../inbound/identity'
import type { ContactParsedAttachment } from '../inbound/mime'

export type ContactObjectWrite = {
    storageKey: string
    stored: boolean
    errorCode?: string
}

export type ContactObjectWriteResult = {
    raw: ContactObjectWrite
    attachments: ContactObjectWrite[]
}

export const contactObjectKeys = (
    storageId: string,
    attachmentCount: number,
): { raw: string, attachments: string[] } => {
    const prefix = `contact/messages/${storageId}`
    return {
        raw: `${prefix}/raw.eml`,
        attachments: Array.from(
            { length: attachmentCount },
            () => `${prefix}/attachments/${crypto.randomUUID()}`,
        ),
    }
}

const put = async (
    bucket: R2Bucket,
    storageKey: string,
    content: ArrayBuffer | Uint8Array,
    contentType: string,
): Promise<ContactObjectWrite> => {
    try {
        const object = await bucket.put(storageKey, content, {
            httpMetadata: { contentType },
            sha256: await sha256Hex(content),
        })
        return object
            ? { storageKey, stored: true }
            : { storageKey, stored: false, errorCode: 'R2_PUT_EMPTY_RESULT' }
    } catch (error) {
        console.error('Contact R2 write failed', {
            storageKey,
            error: (error as Error).name || 'Error',
        })
        return { storageKey, stored: false, errorCode: 'R2_PUT_FAILED' }
    }
}

export const storeContactObjects = async (
    bucket: R2Bucket,
    raw: ArrayBuffer,
    attachments: ContactParsedAttachment[],
    keys: { raw: string, attachments: string[] },
): Promise<ContactObjectWriteResult> => {
    const rawResult = await put(bucket, keys.raw, raw, 'message/rfc822')
    const attachmentResults = await Promise.all(attachments.map((attachment, index) => put(
        bucket,
        keys.attachments[index],
        attachment.content,
        attachment.mimeType,
    )))
    return { raw: rawResult, attachments: attachmentResults }
}
