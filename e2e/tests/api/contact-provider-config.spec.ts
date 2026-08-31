import { expect, test } from '@playwright/test';

import {
  MAILPIT_API,
  MAILPIT_SMTP_HOST,
  WORKER_CONTACT_URL,
  deleteAllMailpitMessages,
  onMailpitMessage,
} from '../../fixtures/test-helpers';

const ADMIN_HEADERS = { 'x-admin-auth': 'e2e-contact-admin' };
const run = Date.now();
let smtpProviderId: number;
let missingResendId: number;
let smtpDomain: any;
let missingDomain: any;

test.describe.serial('Contact Provider Config', () => {
  test.beforeEach(() => test.skip(!WORKER_CONTACT_URL, 'WORKER_CONTACT_URL is not configured'));

  test.beforeAll(async ({ request }) => {
    if (!WORKER_CONTACT_URL) return;
    await request.post(`${WORKER_CONTACT_URL}/admin/contact/db/migrate`, { headers: ADMIN_HEADERS });

    const resend = await request.post(`${WORKER_CONTACT_URL}/admin/contact/providers`, {
      headers: ADMIN_HEADERS,
      data: {
        name: `Missing Resend ${run}`, provider_type: 'resend', config: {},
        secret_refs: { apiKey: 'CONTACT_RESEND_E2E_MISSING' },
      },
    });
    expect(resend.status(), await resend.text()).toBe(201);
    const resendBody = (await resend.json()).result;
    missingResendId = resendBody.id;
    expect(resendBody.secrets).toEqual({ apiKey: false });
    expect(JSON.stringify(resendBody)).not.toContain('CONTACT_RESEND_E2E_MISSING');

    const smtp = await request.post(`${WORKER_CONTACT_URL}/admin/contact/providers`, {
      headers: ADMIN_HEADERS,
      data: {
        name: `Mailpit SMTP ${run}`, provider_type: 'smtp',
        config: { host: MAILPIT_SMTP_HOST, port: 1025, secure: false, starttls: false },
        secret_refs: {},
      },
    });
    expect(smtp.status(), await smtp.text()).toBe(201);
    smtpProviderId = (await smtp.json()).result.id;

    smtpDomain = (await (await request.post(`${WORKER_CONTACT_URL}/admin/contact/domains`, {
      headers: ADMIN_HEADERS,
      data: {
        domain: `provider-smtp-${run}.example.com`, name: 'SMTP explicit',
        default_provider_config_id: smtpProviderId,
      },
    })).json()).result;
    missingDomain = (await (await request.post(`${WORKER_CONTACT_URL}/admin/contact/domains`, {
      headers: ADMIN_HEADERS,
      data: {
        domain: `provider-missing-${run}.example.com`, name: 'Missing explicit',
        default_provider_config_id: missingResendId,
      },
    })).json()).result;
  });

  test('keeps references private and requires valid CONTACT names', async ({ request }) => {
    const list = await (await request.get(`${WORKER_CONTACT_URL}/admin/contact/providers`, { headers: ADMIN_HEADERS })).json();
    const serialized = JSON.stringify(list);
    expect(serialized).not.toContain('CONTACT_RESEND_E2E_MISSING');
    expect(serialized).not.toContain('e2e-global-must-not-win');
    expect(list.results.find((item: any) => item.id === missingResendId).secrets.apiKey).toBe(false);

    const invalid = await request.post(`${WORKER_CONTACT_URL}/admin/contact/providers`, {
      headers: ADMIN_HEADERS,
      data: { name: 'unsafe', provider_type: 'brevo', config: {}, secret_refs: { apiKey: 'RESEND_TOKEN' } },
    });
    expect(invalid.status()).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: 'CONTACT_INVALID_SECRET_REFERENCE' } });
  });

  test('binds exactly one explicit provider and blocks disabling it while in use', async ({ request }) => {
    expect(smtpDomain.default_provider_config_id).toBe(smtpProviderId);
    const disable = await request.delete(`${WORKER_CONTACT_URL}/admin/contact/providers/${smtpProviderId}`, { headers: ADMIN_HEADERS });
    expect(disable.status()).toBe(409);
    expect(await disable.json()).toMatchObject({ error: { code: 'CONTACT_PROVIDER_IN_USE' } });

    const missing = await request.post(`${WORKER_CONTACT_URL}/admin/test/contact_provider_send`, {
      headers: ADMIN_HEADERS,
      data: {
        domain_id: missingDomain.id,
        from_address: `contact@${missingDomain.domain}`,
        to_address: 'customer@example.net', subject: 'Missing secret must not call HTTP', text_body: 'local',
      },
    });
    expect(missing.ok(), await missing.text()).toBe(true);
    expect(await missing.json()).toMatchObject({
      provider_type: 'resend',
      result: { certainty: 'rejected', retryable: false, errorClass: 'configuration' },
    });
  });

  test('sends explicit SMTP through Mailpit even when a global Resend token exists', async ({ request }) => {
    test.skip(!MAILPIT_API, 'Mailpit is not configured outside the Docker E2E environment');
    await deleteAllMailpitMessages(request);
    const subject = `Explicit SMTP ${run}`;
    const event = onMailpitMessage((item: any) => item.Subject === subject);
    await event.ready;
    const response = await request.post(`${WORKER_CONTACT_URL}/admin/test/contact_provider_send`, {
      headers: ADMIN_HEADERS,
      data: {
        domain_id: smtpDomain.id,
        from_address: `contact@${smtpDomain.domain}`,
        to_address: 'smtp-customer@example.net', subject, text_body: 'Mailpit Contact Provider test',
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    expect(await response.json()).toMatchObject({
      provider_type: 'smtp', result: { certainty: 'accepted', retryable: false },
    });
    expect((await event.message).Subject).toBe(subject);
  });
});
