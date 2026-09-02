import PostalMime from 'postal-mime'
import type { Address, Attachment, Email, Header, Mailbox } from 'postal-mime'

const MAX_BODY_CHARS = 512_000
const MAX_HEADERS = 200
const MAX_HEADER_CHARS = 8_192

export type ContactParsedAttachment = {
    filename: string
    mimeType: string
    disposition: 'attachment' | 'inline'
    contentId: string | null
    content: Uint8Array
}

export type ContactParsedMime = {
    fromName: string | null
    fromAddress: string | null
    replyToAddress: string | null
    cc: Array<{ name: string, address: string }>
    subject: string
    preview: string
    text: string
    html: string
    headers: Array<{ key: string, value: string }>
    messageId: string | null
    inReplyTo: string | null
    references: string[]
    senderDate: string | null
    attachments: ContactParsedAttachment[]
    contentTruncated: boolean
}

const mailbox = (address: Address | undefined): Mailbox | null => {
    if (!address || !('address' in address) || !address.address) return null
    return address
}

const mailboxes = (addresses: Address[] | undefined): Mailbox[] => (addresses || [])
    .flatMap(address => 'group' in address ? address.group : [address])
    .filter((address): address is Mailbox => Boolean(address.address))

const attachmentBytes = (attachment: Attachment): Uint8Array => {
    if (typeof attachment.content === 'string') return new TextEncoder().encode(attachment.content)
    if (attachment.content instanceof Uint8Array) return attachment.content
    return new Uint8Array(attachment.content)
}

const replaceControlCharacters = (value: string, replacement: string): string => Array.from(value)
    .map(character => {
        const code = character.charCodeAt(0)
        return code <= 31 || code === 127 ? replacement : character
    })
    .join('')

export const safeAttachmentFilename = (value: string | null | undefined): string => {
    const filename = replaceControlCharacters(value || 'attachment', '_')
        .trim()
        .slice(0, 255)
    return filename || 'attachment'
}

const safeMimeType = (value: string): string => (
    /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value)
        ? value.toLowerCase()
        : 'application/octet-stream'
)

const normalizedHeaders = (headers: Header[]): Array<{ key: string, value: string }> => headers
    .slice(0, MAX_HEADERS)
    .map(header => ({
        key: header.key.slice(0, 128),
        value: header.value.slice(0, MAX_HEADER_CHARS),
    }))

export const normalizeSenderDate = (value: string | undefined | null): string | null => {
    if (!value) return null
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const textPreview = (text: string, html: string): string => (text || html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280)

const capBody = (value: string | undefined) => (value || '').slice(0, MAX_BODY_CHARS)

export const parseContactMime = async (raw: ArrayBuffer): Promise<ContactParsedMime> => {
    const parsed: Email = await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer' })
    const from = mailbox(parsed.from)
    const replyTo = mailboxes(parsed.replyTo)[0] || null
    const text = capBody(parsed.text)
    const html = capBody(parsed.html)
    return {
        fromName: from?.name || null,
        fromAddress: from?.address?.toLowerCase() || null,
        replyToAddress: replyTo?.address?.toLowerCase() || null,
        cc: mailboxes(parsed.cc).map(item => ({ name: item.name || '', address: item.address.toLowerCase() })),
        subject: (parsed.subject || '').slice(0, 1_000),
        preview: textPreview(text, html),
        text,
        html,
        headers: normalizedHeaders(parsed.headers),
        messageId: parsed.messageId?.trim() || null,
        inReplyTo: parsed.inReplyTo?.trim() || null,
        references: (parsed.references || '').split(/\s+/).filter(Boolean).slice(-100),
        senderDate: normalizeSenderDate(parsed.date),
        attachments: parsed.attachments.map(attachment => ({
            filename: safeAttachmentFilename(attachment.filename),
            mimeType: safeMimeType(attachment.mimeType),
            disposition: attachment.disposition === 'inline' ? 'inline' : 'attachment',
            contentId: attachment.contentId
                ? replaceControlCharacters(attachment.contentId, '').slice(0, 255) || null
                : null,
            content: attachmentBytes(attachment),
        })),
        contentTruncated: (parsed.text?.length || 0) > MAX_BODY_CHARS
            || (parsed.html?.length || 0) > MAX_BODY_CHARS,
    }
}

export const toLegacyParsedEmailContext = (
    rawEmail: string,
    parsed: ContactParsedMime,
): ParsedEmailContext => ({
    rawEmail,
    parsedEmail: {
        sender: parsed.fromAddress
            ? `${parsed.fromName || ''} <${parsed.fromAddress}>`.trim()
            : '',
        subject: parsed.subject,
        text: parsed.text,
        html: parsed.html,
        headers: parsed.headers,
        attachments: parsed.attachments.map(attachment => ({
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            content: attachment.content,
            disposition: attachment.disposition,
        })),
    },
})
