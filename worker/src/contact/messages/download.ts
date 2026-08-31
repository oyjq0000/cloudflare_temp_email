const SAFE_MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i
const ACTIVE_MIME = /^(?:text\/(?:html|xml)|image\/svg\+xml|application\/(?:xhtml\+xml|xml|javascript|ecmascript))$/i

export const safeDownloadMime = (value: string | null | undefined): string => {
    const mime = value?.trim().toLowerCase() || ''
    return SAFE_MIME.test(mime) && !ACTIVE_MIME.test(mime)
        ? mime
        : 'application/octet-stream'
}

export const safeDownloadFilename = (value: string | null | undefined): string => {
    const leaf = (value || 'attachment').split(/[\\/]/).at(-1) || 'attachment'
    const normalized = Array.from(leaf).map(character => {
        const code = character.charCodeAt(0)
        return code <= 31 || code === 127 || character === '"' ? '_' : character
    }).join('').trim().slice(0, 180)
    return normalized || 'attachment'
}

const asciiFilename = (value: string): string => value
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')

const encodedFilename = (value: string): string => encodeURIComponent(value)
    .replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)

export const safeDownloadHeaders = (
    filename: string | null | undefined,
    mimeType: string | null | undefined,
): Headers => {
    const safeName = safeDownloadFilename(filename)
    return new Headers({
        'Content-Type': safeDownloadMime(mimeType),
        'Content-Disposition': `attachment; filename="${asciiFilename(safeName)}"; filename*=UTF-8''${encodedFilename(safeName)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
    })
}
