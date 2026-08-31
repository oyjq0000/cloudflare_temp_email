import { ContactError } from '../errors.ts'

export type ContactMessageCursor = { receivedAt: string, id: number }

const toBase64Url = (value: string): string => {
    const bytes = new TextEncoder().encode(value)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (value: string): string => {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
        .padEnd(Math.ceil(value.length / 4) * 4, '=')
    const binary = atob(base64)
    return new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)))
}

export const encodeContactMessageCursor = (cursor: ContactMessageCursor): string => toBase64Url(
    JSON.stringify({ receivedAt: cursor.receivedAt, id: cursor.id })
)

export const decodeContactMessageCursor = (value: string): ContactMessageCursor => {
    try {
        if (!/^[A-Za-z0-9_-]{1,500}$/.test(value)) throw new Error('format')
        const parsed = JSON.parse(fromBase64Url(value)) as Partial<ContactMessageCursor>
        if (
            typeof parsed.receivedAt !== 'string'
            || parsed.receivedAt.length > 64
            || Number.isNaN(new Date(parsed.receivedAt).getTime())
            || !Number.isInteger(parsed.id)
            || Number(parsed.id) < 1
        ) throw new Error('payload')
        return { receivedAt: parsed.receivedAt, id: Number(parsed.id) }
    } catch {
        throw new ContactError('CONTACT_INVALID_CURSOR', 'Message cursor is invalid')
    }
}
