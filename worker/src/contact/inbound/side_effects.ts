import { safeErrorMetadata } from '../security/diagnostics'

export const CONTACT_SIDE_EFFECTS = [
    'forward',
    'ai_extract',
    'telegram',
    'webhook',
    'another_worker',
    'auto_reply',
] as const

export type ContactSideEffect = typeof CONTACT_SIDE_EFFECTS[number]

export const sideEffectInsertStatements = (
    db: D1Database,
    dedupeKey: string,
    skipped: boolean,
): D1PreparedStatement[] => CONTACT_SIDE_EFFECTS.map(effect => db.prepare(`
    INSERT INTO contact_message_side_effects(message_id, effect, status)
    SELECT id, ?, ? FROM contact_messages WHERE dedupe_key = ?
`).bind(effect, skipped ? 'skipped' : 'pending', dedupeKey))

export const markContactSideEffectRunning = async (
    db: D1Database,
    messageId: number,
    effect: ContactSideEffect,
): Promise<void> => {
    const result = await db.prepare(`
        UPDATE contact_message_side_effects
        SET status = 'running', attempt_count = attempt_count + 1,
            last_error_code = NULL, last_error_class = NULL,
            last_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE message_id = ? AND effect = ? AND status = 'pending'
    `).bind(messageId, effect).run()
    if (!result.success) throw new Error('Contact side effect status could not be started')
}

export const markContactSideEffectSucceeded = async (
    db: D1Database,
    messageId: number,
    effect: ContactSideEffect,
): Promise<void> => {
    const result = await db.prepare(`
        UPDATE contact_message_side_effects
        SET status = 'succeeded', updated_at = CURRENT_TIMESTAMP
        WHERE message_id = ? AND effect = ? AND status = 'running'
    `).bind(messageId, effect).run()
    if (!result.success) throw new Error('Contact side effect status could not be completed')
}

export const markContactSideEffectFailed = async (
    db: D1Database,
    messageId: number,
    effect: ContactSideEffect,
    error: unknown,
): Promise<void> => {
    const metadata = safeErrorMetadata(error)
    const result = await db.prepare(`
        UPDATE contact_message_side_effects
        SET status = 'failed', last_error_class = ?, last_error_code = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE message_id = ? AND effect = ? AND status = 'running'
    `).bind(metadata.name, metadata.code || null, messageId, effect).run()
    if (!result.success) throw new Error('Contact side effect failure status could not be stored')
}

export const runTrackedContactSideEffect = async (
    db: D1Database,
    messageId: number,
    effect: ContactSideEffect,
    operation: () => Promise<void>,
): Promise<boolean> => {
    try {
        await markContactSideEffectRunning(db, messageId, effect)
        await operation()
        await markContactSideEffectSucceeded(db, messageId, effect)
        return true
    } catch (error) {
        try {
            await markContactSideEffectFailed(db, messageId, effect, error)
        } catch (statusError) {
            console.error('Contact side effect status update failed', {
                messageId,
                effect,
                error: (statusError as Error).name || 'Error',
            })
        }
        console.error('Contact side effect failed', {
            messageId,
            effect,
            error: (error as Error).name || 'Error',
        })
        return false
    }
}

export const countFailedContactSideEffects = async (db: D1Database): Promise<number> => (
    await db.prepare(`
        SELECT COUNT(*) AS count FROM contact_message_side_effects WHERE status = 'failed'
    `).first<number>('count') || 0
)
