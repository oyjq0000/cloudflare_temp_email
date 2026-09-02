import { createHmac } from 'crypto';
import { expect, test } from '@playwright/test';

import { getContactAdminHeaders, hashPassword, WORKER_CONTACT_NO_BYPASS_URL, WORKER_CONTACT_URL } from '../../fixtures/test-helpers';

const TEST_JWT_SECRET = 'e2e-contact-test-secret-key';

const signJwt = (payload: Record<string, unknown>) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}`;
  const signature = createHmac('sha256', TEST_JWT_SECRET).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
};

const bearerOnly = (headers: Record<string, string>) => ({ Authorization: headers.Authorization });

test.describe('Contact Mode capability and authentication gates', () => {
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
    expect(settings.enableUserDeleteEmail).toBe(false);
    expect(settings.enableMailReadStatus).toBe(false);
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

  test('exchanges the admin password for a scoped expiring session and never accepts x-admin-auth on Contact APIs', async ({ request }) => {
    const anonymous = await request.get(`${WORKER_CONTACT_URL}/admin/contact/status`);
    expect(anonymous.status()).toBe(401);

    const legacyPassword = await request.get(`${WORKER_CONTACT_URL}/admin/contact/status`, {
      headers: { 'x-admin-auth': 'e2e-contact-admin' },
    });
    expect(legacyPassword.status()).toBe(401);

    const wrongPassword = await request.post(`${WORKER_CONTACT_URL}/open_api/contact_admin_login`, {
      data: { password: hashPassword('wrong-contact-admin') },
    });
    expect(wrongPassword.status()).toBe(401);

    const login = await request.post(`${WORKER_CONTACT_URL}/open_api/contact_admin_login`, {
      data: { password: hashPassword('e2e-contact-admin') },
    });
    expect(login.ok(), await login.text()).toBe(true);
    const loginBody = await login.json();
    expect(loginBody.expires_in).toBe(14_400);
    const claims = JSON.parse(Buffer.from(loginBody.token.split('.')[1], 'base64url').toString());
    expect(claims.scope).toBe('contact:admin');
    expect(Number.isInteger(claims.iat)).toBe(true);
    expect(claims.exp - claims.iat).toBe(14_400);

    const authenticated = await request.get(`${WORKER_CONTACT_URL}/admin/contact/status`, {
      headers: { Authorization: `Bearer ${loginBody.token}` },
    });
    expect(authenticated.ok()).toBe(true);
    expect(await authenticated.json()).toMatchObject({
      ok: true,
      mode: 'contact',
      adminSecurity: { secure: true, code: 'OK' },
      release: 'v1-rc',
      schemaVersion: 7,
    });
  });

  test('rejects wrong scope, expired and address-shaped JWTs, and keeps Contact token out of ordinary Admin APIs', async ({ request }) => {
    const now = Math.floor(Date.now() / 1000);
    for (const token of [
      signJwt({ scope: 'contact:wrong', iat: now, exp: now + 900 }),
      signJwt({ scope: 'contact:admin', iat: now - 1800, exp: now - 900 }),
      signJwt({ address: 'contact@example.com', address_id: 1, iat: now, exp: now + 900 }),
    ]) {
      const response = await request.get(`${WORKER_CONTACT_URL}/admin/contact/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status()).toBe(401);
    }

    const contactHeaders = await getContactAdminHeaders();
    const ordinaryAdmin = await request.get(`${WORKER_CONTACT_URL}/admin/db_version`, {
      headers: bearerOnly(contactHeaders),
    });
    expect(ordinaryAdmin.status()).toBe(401);
  });

  test('DISABLE_ADMIN_PASSWORD_CHECK cannot bypass Contact Admin outside E2E mode', async ({ request }) => {
    test.skip(!WORKER_CONTACT_NO_BYPASS_URL, 'WORKER_CONTACT_NO_BYPASS_URL is not configured');
    const response = await request.get(`${WORKER_CONTACT_NO_BYPASS_URL}/admin/contact/status`);
    expect(response.status()).toBe(401);
  });

});
