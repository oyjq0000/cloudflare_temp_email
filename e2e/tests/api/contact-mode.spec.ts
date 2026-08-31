import { expect, test } from '@playwright/test';

import { WORKER_CONTACT_URL } from '../../fixtures/test-helpers';

test.describe('Contact Mode capability gates', () => {
  test.beforeEach(() => {
    test.skip(!WORKER_CONTACT_URL, 'WORKER_CONTACT_URL is not configured');
  });

  test('public settings expose capabilities without private domain configuration', async ({ request }) => {
    const response = await request.get(`${WORKER_CONTACT_URL}/open_api/settings`);
    expect(response.ok()).toBe(true);
    const settings = await response.json();
    expect(settings.mode).toBe('contact');
    expect(settings.capabilities).toEqual({
      contactHub: true,
      publicMailbox: false,
      publicAddressCreation: false,
      publicRegistration: false,
      publicSendMail: false,
      userPortal: false,
    });
    expect(settings.domains).toEqual([]);
    expect(settings.defaultDomains).toEqual([]);
    expect(settings.randomSubdomainDomains).toEqual([]);
    expect(settings.domainLabels).toEqual([]);
    expect(settings.prefix).toBe('');
    expect(JSON.stringify(settings)).not.toContain('private-contact.example.com');
  });

  test('Worker rejects public mailbox, registration, OAuth, and send APIs', async ({ request }) => {
    const probes = [
      request.post(`${WORKER_CONTACT_URL}/api/new_address`, { data: {} }),
      request.post(`${WORKER_CONTACT_URL}/api/send_mail`, { data: {} }),
      request.post(`${WORKER_CONTACT_URL}/external/api/send_mail`, { data: {} }),
      request.post(`${WORKER_CONTACT_URL}/user_api/register`, { data: {} }),
      request.post(`${WORKER_CONTACT_URL}/user_api/verify_code`, { data: {} }),
      request.get(`${WORKER_CONTACT_URL}/user_api/oauth2/login_url`),
      request.get(`${WORKER_CONTACT_URL}/user_api/mails`),
      request.post(`${WORKER_CONTACT_URL}/open_api/credential_login`, { data: {} }),
      request.post(`${WORKER_CONTACT_URL}/telegram/new_address`, { data: {} }),
    ];
    const responses = await Promise.all(probes);
    for (const response of responses) {
      expect(response.status()).toBe(403);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: 'CONTACT_MODE_PUBLIC_CAPABILITY_DISABLED' },
      });
    }
  });

  test('Contact API requires and verifies administrator identity', async ({ request }) => {
    const anonymous = await request.get(`${WORKER_CONTACT_URL}/admin/contact/status`);
    expect(anonymous.status()).toBe(401);

    const authenticated = await request.get(`${WORKER_CONTACT_URL}/admin/contact/status`, {
      headers: { 'x-admin-auth': 'e2e-contact-admin' },
    });
    expect(authenticated.ok()).toBe(true);
    expect(await authenticated.json()).toMatchObject({
      ok: true,
      mode: 'contact',
      adminSecurity: { secure: true, code: 'OK' },
      phase: 5,
    });
  });
});
