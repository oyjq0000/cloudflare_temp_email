import { ContactError } from '../errors.ts'

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const LOCAL_PART = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/

export const normalizeContactDomain = (value: unknown): string => {
    if (typeof value !== 'string') {
        throw new ContactError('CONTACT_INVALID_DOMAIN', 'Domain must be a string')
    }
    const domain = value.trim().toLowerCase().replace(/\.+$/, '')
    const labels = domain.split('.')
    if (
        domain.length < 3
        || domain.length > 253
        || labels.length < 2
        || labels.some(label => !DOMAIN_LABEL.test(label))
    ) {
        throw new ContactError('CONTACT_INVALID_DOMAIN', 'Domain is invalid')
    }
    return domain
}

export const normalizeContactLocalPart = (value: unknown): string => {
    if (typeof value !== 'string') {
        throw new ContactError('CONTACT_INVALID_LOCAL_PART', 'Mailbox local part must be a string')
    }
    const localPart = value.trim().toLowerCase()
    if (!LOCAL_PART.test(localPart)) {
        throw new ContactError('CONTACT_INVALID_LOCAL_PART', 'Mailbox local part is invalid')
    }
    return localPart
}

export const contactAddress = (localPart: string, domain: string) => `${localPart}@${domain}`
