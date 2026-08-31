import { ContactError } from '../errors.ts'

export const CONTACT_SECRET_REFERENCE = /^CONTACT_[A-Z0-9_]{1,96}$/

export const validateSecretReference = (reference: unknown): string => {
    if (typeof reference !== 'string' || !CONTACT_SECRET_REFERENCE.test(reference)) {
        throw new ContactError(
            'CONTACT_INVALID_SECRET_REFERENCE',
            'Secret references must use the CONTACT_* namespace',
        )
    }
    return reference
}

export const resolveSecret = (env: Bindings, reference: string): string | undefined => {
    validateSecretReference(reference)
    const value = (env as unknown as Record<string, unknown>)[reference]
    return typeof value === 'string' && value.length > 0 ? value : undefined
}

export const resolveProviderSecrets = (
    env: Bindings,
    references: Record<string, string>,
): { values: Record<string, string>, configured: Record<string, boolean> } => {
    const values: Record<string, string> = {}
    const configured: Record<string, boolean> = {}
    for (const [name, reference] of Object.entries(references)) {
        const value = resolveSecret(env, reference)
        configured[name] = Boolean(value)
        if (value) values[name] = value
    }
    return { values, configured }
}
