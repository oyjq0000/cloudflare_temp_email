import { expect, test, type APIRequestContext } from '@playwright/test';

import { WORKER_CONTACT_URL } from '../../fixtures/test-helpers';

const ADMIN_HEADERS = { 'x-admin-auth': 'e2e-contact-admin' };
const run = Date.now();
let domain: any;
let mailbox: any;

const post = (request: APIRequestContext, path: string, data: unknown, headers = ADMIN_HEADERS) => (
  request.post(`${WORKER_CONTACT_URL}${path}`, { headers, data })
);

test.describe.serial('Contact DNS and operational safety', () => {
  test.beforeEach(() => test.skip(!WORKER_CONTACT_URL, 'WORKER_CONTACT_URL is not configured'));

  test.beforeAll(async ({ request }) => {
    if (!WORKER_CONTACT_URL) return;
    await post(request, '/admin/contact/db/migrate', {});
    const provider = (await (await post(request, '/admin/contact/providers', {
      name: `Operations mock ${run}`, provider_type: 'smtp',
      config: { host: 'mock.invalid', port: 1025, secure: false, starttls: false }, secret_refs: {},
    })).json()).result;
    domain = (await (await post(request, '/admin/contact/domains', {
      domain: `ops-${run}.example.com`, name: 'Operations', default_provider_config_id: provider.id,
    })).json()).result;
    mailbox = (await (await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/mailboxes?domain_id=${domain.id}`, { headers: ADMIN_HEADERS },
    )).json()).results[0];
  });

  test('requires an explicit DKIM selector and caches evaluated DNS records', async ({ request }) => {
    const missingSelector = await post(request, `/admin/contact/domains/${domain.id}/dns/refresh`, {});
    expect(missingSelector.status()).toBe(400);
    expect(await missingSelector.json()).toMatchObject({ error: { code: 'CONTACT_DKIM_SELECTOR_REQUIRED' } });

    const dkimName = `mail._domainkey.${domain.domain}`;
    const refresh = await post(request, `/admin/contact/domains/${domain.id}/dns/refresh`, {
      dkim_selector: 'mail',
      expected: { mx: ['mx.route.test'], spf: ['include:sender.test'], dkim: ['dkim-key'], dmarc: [] },
      mock_answers: {
        [`${domain.domain}|MX`]: { values: ['10 mx.route.test.'] },
        [`${domain.domain}|TXT`]: {
          values: ['v=spf1 include:sender.test -all', 'v=spf1 include:legacy.test ~all'],
        },
        [`${dkimName}|TXT`]: { values: ['dkim-key'] },
        [`${dkimName}|CNAME`]: { values: [] },
        [`_dmarc.${domain.domain}|TXT`]: { values: ['v=DMARC1; p=none'] },
      },
    });
    expect(refresh.status(), await refresh.text()).toBe(200);
    const body = await refresh.json();
    expect(body.checks.map((check: any) => [check.purpose, check.status])).toEqual([
      ['mx', 'valid'], ['spf', 'invalid'], ['dkim', 'valid'], ['dmarc', 'valid'],
    ]);
    expect(body.checks.find((check: any) => check.purpose === 'spf').code).toBe('SPF_MULTIPLE_RECORDS');
    expect(JSON.stringify(body)).not.toContain('suggestion');

    const cached = await (await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/domains/${domain.id}/dns`, { headers: ADMIN_HEADERS },
    )).json();
    expect(cached.checks.map((check: any) => check.id)).toEqual(body.checks.map((check: any) => check.id));

    const failedRefresh = await post(request, `/admin/contact/domains/${domain.id}/dns/refresh`, {
      dkim_selector: 'mail',
      mock_answers: {
        [`${domain.domain}|MX`]: { failed: true },
        [`${domain.domain}|TXT`]: { failed: true },
        [`${dkimName}|TXT`]: { failed: true },
        [`${dkimName}|CNAME`]: { failed: true },
        [`_dmarc.${domain.domain}|TXT`]: { failed: true },
      },
    });
    expect((await failedRefresh.json()).checks.every((check: any) => check.status === 'unknown')).toBe(true);
  });

  test('rejects untrusted Contact API origins without changing Legacy CORS', async ({ request }) => {
    const forbidden = await request.get(`${WORKER_CONTACT_URL}/admin/contact/status`, {
      headers: { ...ADMIN_HEADERS, Origin: 'https://untrusted.example' },
    });
    expect(forbidden.status()).toBe(403);
    expect(await forbidden.json()).toMatchObject({ error: { code: 'CONTACT_ORIGIN_FORBIDDEN' } });
    expect(forbidden.headers()['access-control-allow-origin']).toBeUndefined();

    const origin = new URL(WORKER_CONTACT_URL).origin;
    const allowed = await request.get(`${WORKER_CONTACT_URL}/admin/contact/status`, {
      headers: { ...ADMIN_HEADERS, Origin: origin },
    });
    expect(allowed.status()).toBe(200);
    expect(allowed.headers()['access-control-allow-origin']).toBe(origin);

    const preflight = await request.fetch(`${WORKER_CONTACT_URL}/admin/contact/status`, {
      method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
    });
    expect(preflight.status()).toBe(204);
  });

  test('reconciles stale sending to unknown without a second provider attempt', async ({ request }) => {
    const sent = await post(request, '/admin/contact/outbound', {
      mailbox_id: mailbox.id, to_address: 'customer@example.net',
      subject: 'Stale reconciliation', text_body: 'One provider call only',
    }, {
      ...ADMIN_HEADERS, 'Idempotency-Key': `stale-${run}`, 'x-contact-provider-mock-result': 'accepted',
    });
    const outbound = (await sent.json()).outbound;
    const result = await post(request, '/admin/contact/operations/reconcile-stale', {
      older_than_minutes: 15, test_stale_outbound_id: outbound.id,
    });
    expect(await result.json()).toMatchObject({ reconciled: 1, attemptsMarkedUnknown: 1, automaticRetry: false });
    const detail = await (await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/outbound/${outbound.id}`, { headers: ADMIN_HEADERS },
    )).json();
    expect(detail.result.status).toBe('unknown');
    expect(detail.result.last_error_code).toBe('STALE_SENDING_RECONCILED');
    expect(detail.result.attempts).toHaveLength(1);
  });

  test('reports redacted health and legacy cleanup preserves Contact data', async ({ request }) => {
    const messageId = `<cleanup-${run}@example.net>`;
    const raw = [
      'From: sender@example.net', `To: ${mailbox.address}`, 'Subject: Cleanup protected',
      `Message-ID: ${messageId}`, '', 'Keep this Contact message',
    ].join('\r\n');
    await post(request, '/admin/test/receive_mail', { from: 'sender@example.net', to: mailbox.address, raw });
    await new Promise(resolve => setTimeout(resolve, 1_100));
    expect((await post(request, '/admin/cleanup', { cleanType: 'mails', cleanDays: 0 })).ok()).toBe(true);
    const lookup = await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/messages?domain_id=${domain.id}&subject=Cleanup%20protected`,
      { headers: ADMIN_HEADERS },
    );
    expect((await lookup.json()).results).toHaveLength(1);

    const health = await (await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/health`, { headers: ADMIN_HEADERS },
    )).json();
    expect(health).toMatchObject({
      ok: true, ready: true, database: { healthy: true },
      protections: { contactMailboxCleanupProtected: true, unknownAutomaticRetry: false },
    });
    expect(JSON.stringify(health)).not.toMatch(/secret_refs|CONTACT_[A-Z0-9_]{3,}/);
  });
});
