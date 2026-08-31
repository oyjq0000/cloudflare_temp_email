import { expect, test, type APIRequestContext } from '@playwright/test';

import {
  MAILPIT_API,
  MAILPIT_SMTP_HOST,
  WORKER_CONTACT_URL,
  deleteAllMailpitMessages,
  onMailpitMessage,
} from '../../fixtures/test-helpers';

const ADMIN_HEADERS = { 'x-admin-auth': 'e2e-contact-admin' };
const MOCK_ACCEPTED = { ...ADMIN_HEADERS, 'x-contact-provider-mock-result': 'accepted' };
const run = Date.now();
let providerId: number;
let domain: any;
let mailbox: any;
let otherMailbox: any;
let inboundId: number;

const post = (request: APIRequestContext, path: string, headers: Record<string, string>, data: unknown) => (
  request.post(`${WORKER_CONTACT_URL}${path}`, { headers, data })
);

test.describe.serial('Contact outbound state machine', () => {
  test.beforeEach(() => test.skip(!WORKER_CONTACT_URL, 'WORKER_CONTACT_URL is not configured'));

  test.beforeAll(async ({ request }) => {
    if (!WORKER_CONTACT_URL) return;
    await post(request, '/admin/contact/db/migrate', ADMIN_HEADERS, {});
    providerId = (await (await post(request, '/admin/contact/providers', ADMIN_HEADERS, {
      name: `Outbound mock ${run}`, provider_type: 'smtp',
      config: { host: 'mock.invalid', port: 1025, secure: false, starttls: false }, secret_refs: {},
    })).json()).result.id;
    domain = (await (await post(request, '/admin/contact/domains', ADMIN_HEADERS, {
      domain: `outbound-${run}.example.com`, name: 'Outbound', default_provider_config_id: providerId,
    })).json()).result;
    mailbox = (await (await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/mailboxes?domain_id=${domain.id}`, { headers: ADMIN_HEADERS },
    )).json()).results[0];

    const otherDomain = (await (await post(request, '/admin/contact/domains', ADMIN_HEADERS, {
      domain: `outbound-other-${run}.example.com`, name: 'Other', default_provider_config_id: providerId,
    })).json()).result;
    otherMailbox = (await (await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/mailboxes?domain_id=${otherDomain.id}`, { headers: ADMIN_HEADERS },
    )).json()).results[0];

    const messageId = `<reply-source-${run}@example.net>`;
    const raw = [
      'From: Customer <customer@example.net>', `To: ${mailbox.address}`,
      'Reply-To: Reply Desk <reply-desk@example.net>', 'Subject: Need help',
      `Message-ID: ${messageId}`, 'References: <older@example.net>',
      'Date: Tue, 01 Sep 2026 10:00:00 +0000', 'Content-Type: text/plain; charset=utf-8', '', 'Please reply',
    ].join('\r\n');
    await post(request, '/admin/test/receive_mail', ADMIN_HEADERS, {
      from: 'customer@example.net', to: mailbox.address, raw,
    });
    const lookup = await (await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/messages?domain_id=${domain.id}&subject=Need%20help`,
      { headers: ADMIN_HEADERS },
    )).json();
    inboundId = lookup.results[0].id;
  });

  test('deduplicates double send and permits only one atomic claim', async ({ request }) => {
    const key = `double-${run}`;
    const headers = {
      ...MOCK_ACCEPTED, 'Idempotency-Key': key, 'x-contact-provider-mock-delay': '120',
    };
    const body = {
      mailbox_id: mailbox.id, to_address: 'recipient@example.net',
      subject: 'Double click', text_body: 'Only once',
    };
    const [firstResponse, secondResponse] = await Promise.all([
      post(request, '/admin/contact/outbound', headers, body),
      post(request, '/admin/contact/outbound', headers, body),
    ]);
    expect(firstResponse.status(), await firstResponse.text()).toBe(201);
    expect(secondResponse.status(), await secondResponse.text()).toBe(201);
    const first = await firstResponse.json();
    const second = await secondResponse.json();
    expect(first.outbound.id).toBe(second.outbound.id);
    expect([first.duplicate, second.duplicate].sort()).toEqual([false, true]);

    const detail = await (await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/outbound/${first.outbound.id}`, { headers: ADMIN_HEADERS },
    )).json();
    expect(detail.result).toMatchObject({
      status: 'sent', delivery_certainty: 'accepted', provider_message_id: 'mock-provider-message-id',
    });
    expect(detail.result.attempts).toHaveLength(1);
    expect(detail.result.attempts[0].config_snapshot_json).not.toContain('secret');

    const conflict = await post(request, '/admin/contact/outbound', headers, { ...body, subject: 'Changed' });
    expect(conflict.status()).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: 'CONTACT_IDEMPOTENCY_CONFLICT' } });
  });

  test('maps explicit rejection to Failed and manually retries the same intent', async ({ request }) => {
    const failed = await post(request, '/admin/contact/outbound', {
      ...ADMIN_HEADERS, 'Idempotency-Key': `failed-${run}`, 'x-contact-provider-mock-result': 'rejected',
    }, {
      mailbox_id: mailbox.id, to_address: 'failed@example.net', subject: 'Retry me', text_body: 'Retry body',
    });
    const failedBody = await failed.json();
    expect(failedBody.outbound).toMatchObject({ status: 'failed', delivery_certainty: 'rejected' });

    const retried = await post(request, `/admin/contact/outbound/${failedBody.outbound.id}/retry`, MOCK_ACCEPTED, {});
    expect((await retried.json()).outbound).toMatchObject({ status: 'sent', delivery_certainty: 'accepted' });
    const detail = await (await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/outbound/${failedBody.outbound.id}`, { headers: ADMIN_HEADERS },
    )).json();
    expect(detail.result.attempts).toHaveLength(2);
    expect(detail.result.attempts.map((item: any) => item.status)).toEqual(['failed', 'sent']);
  });

  test('never retries Unknown and Force Resend creates a linked intent', async ({ request }) => {
    const unknown = await post(request, '/admin/contact/outbound', {
      ...ADMIN_HEADERS, 'Idempotency-Key': `unknown-${run}`, 'x-contact-provider-mock-result': 'unknown',
    }, {
      mailbox_id: mailbox.id, to_address: 'unknown@example.net', subject: 'Unknown result', text_body: 'Uncertain',
    });
    const original = (await unknown.json()).outbound;
    expect(original).toMatchObject({ status: 'unknown', delivery_certainty: 'unknown' });

    const retry = await post(request, `/admin/contact/outbound/${original.id}/retry`, MOCK_ACCEPTED, {});
    expect(retry.status()).toBe(409);
    expect(await retry.json()).toMatchObject({ error: { code: 'CONTACT_UNKNOWN_RETRY_FORBIDDEN' } });

    const noConfirm = await post(request, `/admin/contact/outbound/${original.id}/force-resend`, {
      ...MOCK_ACCEPTED, 'Idempotency-Key': `force-${run}`,
    }, { confirm: false });
    expect(noConfirm.status()).toBe(409);

    const forced = await post(request, `/admin/contact/outbound/${original.id}/force-resend`, {
      ...MOCK_ACCEPTED, 'Idempotency-Key': `force-${run}`,
    }, { confirm: true });
    const copy = (await forced.json()).outbound;
    expect(copy.id).not.toBe(original.id);
    expect(copy.force_resend_of_id).toBe(original.id);
    expect(copy.message_id_header).not.toBe(original.message_id_header);
    expect(copy.status).toBe('sent');
    const unchanged = await (await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/outbound/${original.id}`, { headers: ADMIN_HEADERS },
    )).json();
    expect(unchanged.result.status).toBe('unknown');
  });

  test('builds Reply-To/thread headers and rejects cross-Domain From selection', async ({ request }) => {
    const reply = await post(request, `/admin/contact/messages/${inboundId}/reply`, {
      ...MOCK_ACCEPTED, 'Idempotency-Key': `reply-${run}`,
    }, { mailbox_id: mailbox.id, text_body: 'We can help.' });
    expect(reply.status(), await reply.text()).toBe(201);
    const outbound = (await reply.json()).outbound;
    expect(outbound).toMatchObject({
      reply_to_message_id: inboundId,
      from_address: mailbox.address,
      to_address: 'reply-desk@example.net',
      subject: 'Re: Need help',
      in_reply_to_header: `<reply-source-${run}@example.net>`,
      status: 'sent',
    });
    expect(outbound.references).toEqual(['<older@example.net>', `<reply-source-${run}@example.net>`]);

    const crossDomain = await post(request, `/admin/contact/messages/${inboundId}/reply`, {
      ...MOCK_ACCEPTED, 'Idempotency-Key': `reply-cross-${run}`,
    }, { mailbox_id: otherMailbox.id, text_body: 'Wrong from' });
    expect(crossDomain.status()).toBe(409);
    expect(await crossDomain.json()).toMatchObject({ error: { code: 'CONTACT_REPLY_CROSS_DOMAIN' } });

    const injection = await post(request, '/admin/contact/outbound', {
      ...MOCK_ACCEPTED, 'Idempotency-Key': `inject-${run}`,
    }, {
      mailbox_id: mailbox.id, to_address: 'recipient@example.net',
      subject: 'Hello\r\nBcc: victim@example.net', text_body: 'Blocked',
    });
    expect(injection.status()).toBe(400);
  });

  test('outbound list stays metadata-only', async ({ request }) => {
    const response = await request.get(`${WORKER_CONTACT_URL}/admin/contact/outbound?limit=10`, { headers: ADMIN_HEADERS });
    expect(response.ok(), await response.text()).toBe(true);
    const body = await response.json();
    expect(body.results.length).toBeGreaterThan(0);
    for (const row of body.results) {
      expect(row).not.toHaveProperty('text_body');
      expect(row).not.toHaveProperty('html_body');
      expect(row).not.toHaveProperty('idempotency_key');
    }
    expect(body.counts.sent).toBeGreaterThan(0);
    expect(body.counts.unknown).toBeGreaterThan(0);
  });

  test('delivers Reply thread headers through SMTP to Mailpit', async ({ request }) => {
    test.skip(!MAILPIT_API, 'Mailpit is not configured outside the Docker E2E environment');
    const smtpProvider = (await (await post(request, '/admin/contact/providers', ADMIN_HEADERS, {
      name: `Reply Mailpit ${run}`, provider_type: 'smtp',
      config: { host: MAILPIT_SMTP_HOST, port: 1025, secure: false, starttls: false }, secret_refs: {},
    })).json()).result;
    const mailpitDomain = (await (await post(request, '/admin/contact/domains', ADMIN_HEADERS, {
      domain: `reply-mailpit-${run}.example.com`, name: 'Reply Mailpit',
      default_provider_config_id: smtpProvider.id,
    })).json()).result;
    const mailpitMailbox = (await (await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/mailboxes?domain_id=${mailpitDomain.id}`, { headers: ADMIN_HEADERS },
    )).json()).results[0];
    const originalMessageId = `<mailpit-thread-${run}@example.net>`;
    await post(request, '/admin/test/receive_mail', ADMIN_HEADERS, {
      from: 'customer@example.net', to: mailpitMailbox.address,
      raw: [
        'From: Customer <customer@example.net>', `To: ${mailpitMailbox.address}`,
        'Subject: Mailpit thread source', `Message-ID: ${originalMessageId}`,
        'References: <mailpit-older@example.net>', 'Content-Type: text/plain; charset=utf-8', '', 'Thread me',
      ].join('\r\n'),
    });
    const source = await (await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/messages?domain_id=${mailpitDomain.id}&subject=Mailpit%20thread%20source`,
      { headers: ADMIN_HEADERS },
    )).json();
    await deleteAllMailpitMessages(request);
    const event = onMailpitMessage((item: any) => item.Subject === 'Re: Mailpit thread source');
    await event.ready;
    const reply = await post(request, `/admin/contact/messages/${source.results[0].id}/reply`, {
      ...ADMIN_HEADERS, 'Idempotency-Key': `reply-mailpit-${run}`,
    }, { mailbox_id: mailpitMailbox.id, text_body: 'Mailpit threaded reply' });
    expect(reply.status(), await reply.text()).toBe(201);
    expect((await reply.json()).outbound.status).toBe('sent');
    await event.message;
    const raw = await request.get(`${MAILPIT_API}/v1/message/latest/raw`);
    expect(raw.ok(), await raw.text()).toBe(true);
    const sourceText = await raw.text();
    expect(sourceText).toContain(`In-Reply-To: ${originalMessageId}`);
    expect(sourceText).toContain(`References: <mailpit-older@example.net> ${originalMessageId}`);
    expect(sourceText).toMatch(new RegExp(`Message-ID: <[^>]+@${mailpitDomain.domain.replace(/\./g, '\\.')}>`));
  });
});
