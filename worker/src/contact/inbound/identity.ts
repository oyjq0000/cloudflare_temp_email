export const sha256Hex = async (value: ArrayBuffer | Uint8Array | string): Promise<string> => {
    const bytes = typeof value === 'string'
        ? new TextEncoder().encode(value)
        : value instanceof Uint8Array ? value : new Uint8Array(value)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export const contactDedupeKey = async (
    toAddress: string,
    envelopeFrom: string,
    messageId: string | null,
    raw: ArrayBuffer,
): Promise<string> => {
    const recipient = toAddress.trim().toLowerCase()
    if (messageId?.trim()) {
        return `message-id:${recipient}:${messageId.trim().toLowerCase()}`
    }
    const rawHash = await sha256Hex(raw)
    return `raw-sha256:${recipient}:${envelopeFrom.trim().toLowerCase()}:${rawHash}`
}

export const contactStorageId = (): string => crypto.randomUUID()

export const contactRawMailId = (): number => Number.parseInt(
    crypto.randomUUID().replace(/-/g, '').slice(0, 12),
    16,
)
