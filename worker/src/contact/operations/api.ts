import { Context } from 'hono'

import { getBooleanValue } from '../../utils.ts'
import { contactErrorResponse, requireContactId } from '../errors.ts'
import { getContactHealth, reconcileStaleSending } from './service.ts'

const respond = (c: Context<HonoCustomType>, error: unknown) => {
    const response = contactErrorResponse(error)
    return c.json(response.body, response.status)
}

export const health = async (c: Context<HonoCustomType>) => {
    try { return c.json({ ok: true, ...(await getContactHealth(c.env)) }) }
    catch (error) { return respond(c, error) }
}

export const reconcile = async (c: Context<HonoCustomType>) => {
    try {
        const input = await c.req.json<{
            older_than_minutes?: unknown
            test_stale_outbound_id?: unknown
        }>().catch(() => ({}))
        if (getBooleanValue(c.env.E2E_TEST_MODE) && input.test_stale_outbound_id !== undefined) {
            const id = requireContactId(String(input.test_stale_outbound_id))
            await c.env.DB.batch([
                c.env.DB.prepare(`
                    UPDATE contact_outbound_messages
                    SET status = 'sending', delivery_certainty = NULL,
                        sending_at = datetime('now', '-2 hours'), updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).bind(id),
                c.env.DB.prepare(`
                    UPDATE contact_outbound_attempts SET status = 'sending', certainty = NULL,
                        finished_at = NULL WHERE id = (
                            SELECT id FROM contact_outbound_attempts
                            WHERE outbound_message_id = ? ORDER BY attempt_no DESC LIMIT 1
                        )
                `).bind(id),
            ])
        }
        return c.json({
            ok: true,
            ...(await reconcileStaleSending(c.env.DB, input.older_than_minutes)),
        })
    } catch (error) { return respond(c, error) }
}
