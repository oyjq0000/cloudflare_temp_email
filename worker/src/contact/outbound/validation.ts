import { ContactError } from '../errors.ts'

const EMAIL = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/

export const safeHeaderText = (value: unknown, field: string, maxLength: number): string => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength || /[\r\n]/.test(value)) {
        throw new ContactError('CONTACT_INVALID_OUTBOUND_HEADER', `${field} is invalid`)
    }
    return value.trim()
}

export const optionalHeaderText = (value: unknown, field: string, maxLength: number): string | null => {
    if (value === undefined || value === null || value === '') return null
    return safeHeaderText(value, field, maxLength)
}

export const safeEmailAddress = (value: unknown, field: string): string => {
    const address = safeHeaderText(value, field, 320).toLowerCase()
    if (!EMAIL.test(address)) throw new ContactError('CONTACT_INVALID_OUTBOUND_ADDRESS', `${field} is invalid`)
    return address
}

export const bodyText = (value: unknown): string => {
    if (value === undefined || value === null) return ''
    if (typeof value !== 'string' || value.length > 512_000) {
        throw new ContactError('CONTACT_INVALID_OUTBOUND_BODY', 'Outbound body is invalid')
    }
    return value
}

export const requireBody = (text: string, html: string) => {
    if (!text.trim() && !html.trim()) {
        throw new ContactError('CONTACT_OUTBOUND_BODY_REQUIRED', 'A text or HTML body is required')
    }
}

export const idempotencyKey = (value: string | undefined): string => {
    const key = value?.trim() || ''
    if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(key)) {
        throw new ContactError('CONTACT_INVALID_IDEMPOTENCY_KEY', 'A valid Idempotency-Key header is required')
    }
    return key
}

export const replySubject = (subject: string): string => /^\s*re\s*:/i.test(subject)
    ? subject
    : `Re: ${subject}`.slice(0, 1_000)

export const localMessageId = (domain: string): string => `<${crypto.randomUUID()}@${domain}>`
