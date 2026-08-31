export class ContactError extends Error {
    readonly code: string
    readonly status: 400 | 404 | 409 | 422 | 500 | 503

    constructor(
        code: string,
        message: string,
        status: 400 | 404 | 409 | 422 | 500 | 503 = 400,
    ) {
        super(message)
        this.code = code
        this.status = status
        this.name = 'ContactError'
    }
}

export const contactErrorResponse = (error: unknown) => {
    if (error instanceof ContactError) {
        return {
            status: error.status,
            body: {
                ok: false as const,
                error: { code: error.code, message: error.message },
            },
        }
    }
    console.error('Contact API error', error)
    return {
        status: 500 as const,
        body: {
            ok: false as const,
            error: {
                code: 'CONTACT_INTERNAL_ERROR',
                message: 'Contact Hub operation failed',
            },
        },
    }
}

export const requireContactId = (value: string | number): number => {
    const id = Number(value)
    if (!Number.isInteger(id) || id < 1) {
        throw new ContactError('CONTACT_INVALID_ID', 'A positive integer id is required')
    }
    return id
}
