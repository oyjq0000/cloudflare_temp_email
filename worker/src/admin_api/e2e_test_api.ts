import { Context } from 'hono'
import { getBooleanValue } from '../utils'
import { ContactError, contactErrorResponse, requireContactId } from '../contact/errors'
import { getProviderConfig } from '../contact/providers/config_service'
import { sendWithContactProvider } from '../contact/providers/registry'

// Direct DB insert — bypasses the email() handler.
const seedMail = async (c: Context<HonoCustomType>) => {
    if (!getBooleanValue(c.env.E2E_TEST_MODE)) {
        return c.text("Not available", 404);
    }
    const { address, source, raw, message_id } = await c.req.json();
    if (!address || !raw) {
        return c.text("address and raw are required", 400);
    }
    if (raw.length > 1_000_000) {
        return c.text("raw content too large", 400);
    }
    if (message_id && message_id.length > 255) {
        return c.text("message_id too long", 400);
    }
    const msgId = message_id || `<e2e-${Date.now()}@test>`;
    const { success } = await c.env.DB.prepare(
        `INSERT INTO raw_mails (message_id, source, address, raw, created_at)`
        + ` VALUES (?, ?, ?, ?, datetime('now'))`
    ).bind(msgId, source || address, address, raw).run();
    return c.json({ success });
};

// Exercises the real email() handler with a mock ForwardableEmailMessage.
const receiveMail = async (c: Context<HonoCustomType>) => {
    if (!getBooleanValue(c.env.E2E_TEST_MODE)) {
        return c.text("Not available", 404);
    }
    const {
        from,
        to,
        raw,
        ai_extract_result,
        omit_generated_message_id,
        force_r2_failure,
        force_d1_failure,
        force_junk_check,
        force_forward,
    } = await c.req.json();
    if (!from || !to || !raw) {
        return c.text("from, to and raw are required", 400);
    }

    // Parse MIME headers (unfold continuation lines, extract key:value pairs)
    const headerSection = raw.substring(0, Math.max(0, raw.indexOf('\r\n\r\n')));
    const headers = new Headers();
    for (const line of headerSection.replace(/\r\n(?=[ \t])/g, ' ').split('\r\n')) {
        const idx = line.indexOf(':');
        if (idx > 0) headers.append(line.substring(0, idx).trim(), line.substring(idx + 1).trim());
    }
    if (!headers.has('Message-ID') && !omit_generated_message_id) {
        headers.set('Message-ID', `<e2e-${Date.now()}@test>`);
    }

    const rawBytes = new TextEncoder().encode(raw);
    const state = { rejected: undefined as string | undefined, replyCalled: false, forwardedTo: [] as string[] };
    const mockMessage: ForwardableEmailMessage = {
        from, to, headers,
        rawSize: rawBytes.byteLength,
        raw: new ReadableStream({ start(ctrl) { ctrl.enqueue(rawBytes); ctrl.close(); } }),
        setReject(reason: string) { state.rejected = reason; },
        forward: async (recipient: string) => { state.forwardedTo.push(recipient); return { messageId: '' }; },
        reply: async () => { state.replyCalled = true; return { messageId: '' }; },
    };
    const { email: emailHandler } = await import('../email');
    const aiExtractEnvOverrides: Partial<Bindings> = {
        ENABLE_AI_EMAIL_EXTRACT: true,
        AI: {
            run: async () => ({ response: ai_extract_result })
        } as unknown as Ai,
    };
    let env = ai_extract_result
        ? { ...c.env, ...aiExtractEnvOverrides }
        : c.env;
    if (force_r2_failure) {
        env = {
            ...env,
            CONTACT_R2: {
                put: async () => { throw new Error('mock R2 failure') },
            } as unknown as R2Bucket,
        }
    }
    if (force_d1_failure) {
        const database = env.DB
        env = {
            ...env,
            DB: new Proxy(database, {
                get(target, property) {
                    if (property === 'batch') return async () => { throw new Error('mock D1 failure') }
                    const value = Reflect.get(target, property)
                    return typeof value === 'function' ? value.bind(target) : value
                },
            }),
        }
    }
    if (force_junk_check) {
        env = {
            ...env,
            ENABLE_CHECK_JUNK_MAIL: true,
            JUNK_MAIL_CHECK_LIST: ['dmarc'],
        }
    }
    if (force_forward) env = { ...env, FORWARD_ADDRESS_LIST: ['side-effect@example.test'] }
    const executionContext: ExecutionContext = {
        waitUntil: () => {},
        passThroughOnException: () => {},
        props: {}
    };
    await emailHandler(mockMessage, env, executionContext);

    return c.json({
        success: !state.rejected,
        replyCalled: state.replyCalled,
        forwardedTo: state.forwardedTo,
        ...(state.rejected ? { rejected: state.rejected } : {})
    });
};

const contactMessage = async (c: Context<HonoCustomType>) => {
    if (!getBooleanValue(c.env.E2E_TEST_MODE)) return c.text('Not available', 404)
    const address = c.req.query('address')
    const messageId = c.req.query('message_id')
    if (!address) return c.text('address is required', 400)
    const conditions = ['m.to_address = ?']
    const values = [address]
    if (messageId) {
        conditions.push('m.message_id_header = ?')
        values.push(messageId)
    }
    const message = await c.env.DB.prepare(`
        SELECT m.*, r.raw IS NOT NULL AS raw_fallback_available
        FROM contact_messages m JOIN raw_mails r ON r.id = m.raw_mail_id
        WHERE ${conditions.join(' AND ')} ORDER BY m.id DESC LIMIT 1
    `).bind(...values).first<Record<string, unknown>>()
    const count = await c.env.DB.prepare(`
        SELECT COUNT(*) AS count FROM contact_messages m WHERE ${conditions.join(' AND ')}
    `).bind(...values).first<number>('count') || 0
    if (!message) return c.json({ message: null, count, attachments: [] })
    const { results } = await c.env.DB.prepare(`
        SELECT id, filename, mime_type, disposition, content_id, size, sha256,
            storage_key, storage_status
        FROM contact_attachments WHERE message_id = ? ORDER BY id
    `).bind(message.id).all<Record<string, unknown>>()
    let rawObjectStored = false
    const attachmentObjectsStored: boolean[] = []
    if (c.env.CONTACT_R2) {
        rawObjectStored = Boolean(await c.env.CONTACT_R2.head(String(message.raw_storage_key)))
        for (const attachment of results || []) {
            attachmentObjectsStored.push(Boolean(
                await c.env.CONTACT_R2.head(String(attachment.storage_key))
            ))
        }
    }
    return c.json({ message, count, attachments: results || [], rawObjectStored, attachmentObjectsStored })
}

const contactProviderSend = async (c: Context<HonoCustomType>) => {
    if (!getBooleanValue(c.env.E2E_TEST_MODE)) return c.text('Not available', 404)
    try {
        const input = await c.req.json<Record<string, unknown>>()
        const domainId = requireContactId(String(input.domain_id || ''))
        const domain = await c.env.DB.prepare(`
            SELECT default_provider_config_id FROM contact_domains WHERE id = ?
        `).bind(domainId).first<{ default_provider_config_id: number | null }>()
        if (!domain) throw new ContactError('CONTACT_DOMAIN_NOT_FOUND', 'Contact Domain was not found', 404)
        if (!domain.default_provider_config_id) {
            throw new ContactError('CONTACT_PROVIDER_NOT_ASSIGNED', 'Contact Domain has no Provider Config', 409)
        }
        const config = await getProviderConfig(c.env.DB, domain.default_provider_config_id)
        const result = await sendWithContactProvider(c.env, config, {
            fromName: typeof input.from_name === 'string' ? input.from_name : '',
            fromAddress: String(input.from_address || ''),
            toName: typeof input.to_name === 'string' ? input.to_name : '',
            toAddress: String(input.to_address || ''),
            subject: String(input.subject || ''),
            textBody: typeof input.text_body === 'string' ? input.text_body : undefined,
            htmlBody: typeof input.html_body === 'string' ? input.html_body : undefined,
        })
        return c.json({ ok: true, provider_type: config.providerType, result })
    } catch (error) {
        const response = contactErrorResponse(error)
        return c.json(response.body, response.status)
    }
}

export default { seedMail, receiveMail, contactMessage, contactProviderSend };
