import { expect, test } from '@playwright/test';

import { WORKER_CONTACT_URL } from '../../fixtures/test-helpers';

const ADMIN_HEADERS = { 'x-admin-auth': 'e2e-contact-admin' };

test.describe.serial('Contact Domain and Mailbox management', () => {
  test.beforeEach(() => {
    test.skip(!WORKER_CONTACT_URL, 'WORKER_CONTACT_URL is not configured');
  });

  test('migration is independent and idempotent', async ({ request }) => {
    const legacyBeforeResponse = await request.get(`${WORKER_CONTACT_URL}/admin/db_version`, {
      headers: ADMIN_HEADERS,
    });
    expect(legacyBeforeResponse.ok()).toBe(true);
    const legacyBefore = await legacyBeforeResponse.json();

    const first = await request.post(`${WORKER_CONTACT_URL}/admin/contact/db/migrate`, {
      headers: ADMIN_HEADERS,
    });
    expect(first.ok()).toBe(true);
    expect(await first.json()).toMatchObject({
      ok: true,
      currentVersion: 5,
      targetVersion: 5,
      pending: [],
    });

    const second = await request.post(`${WORKER_CONTACT_URL}/admin/contact/db/migrate`, {
      headers: ADMIN_HEADERS,
    });
    expect(second.ok()).toBe(true);
    const secondBody = await second.json();
    expect(secondBody.currentVersion).toBe(5);
    expect(secondBody.pending).toEqual([]);
    expect(secondBody.applied).toHaveLength(5);

    const legacyAfter = await (await request.get(`${WORKER_CONTACT_URL}/admin/db_version`, {
      headers: ADMIN_HEADERS,
    })).json();
    expect(legacyAfter.current_db_version).toBe(legacyBefore.current_db_version);
    expect(legacyAfter.code_db_version).toBe(legacyBefore.code_db_version);
  });

  test('normalizes a Domain, syncs fixed Mailboxes, and rejects cross-Domain input', async ({ request }) => {
    const run = Date.now();
    const normalizedDomain = `phase2-${run}.example.com`;
    const createDomain = await request.post(`${WORKER_CONTACT_URL}/admin/contact/domains`, {
      headers: ADMIN_HEADERS,
      data: { domain: ` PHASE2-${run}.EXAMPLE.COM. `, name: 'Phase 2 Site' },
    });
    expect(createDomain.status()).toBe(201);
    const domain = (await createDomain.json()).result;
    expect(domain.domain).toBe(normalizedDomain);
    expect(domain.mailbox_count).toBe(1);

    const duplicate = await request.post(`${WORKER_CONTACT_URL}/admin/contact/domains`, {
      headers: ADMIN_HEADERS,
      data: { domain: normalizedDomain },
    });
    expect(duplicate.status()).toBe(409);

    const invalid = await request.post(`${WORKER_CONTACT_URL}/admin/contact/domains`, {
      headers: ADMIN_HEADERS,
      data: { domain: 'localhost' },
    });
    expect(invalid.status()).toBe(400);

    const defaultMailboxResponse = await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/mailboxes?domain_id=${domain.id}`,
      { headers: ADMIN_HEADERS },
    );
    const defaultMailbox = (await defaultMailboxResponse.json()).results[0];
    expect(defaultMailbox.address).toBe(`contact@${normalizedDomain}`);
    expect(defaultMailbox.is_default).toBe(true);

    const addressList = await request.get(
      `${WORKER_CONTACT_URL}/admin/address?limit=10&offset=0&query=${encodeURIComponent(defaultMailbox.address)}`,
      { headers: ADMIN_HEADERS },
    );
    const legacyAddress = (await addressList.json()).results[0];
    expect(legacyAddress.name).toBe(defaultMailbox.address);
    expect(legacyAddress.source_meta).toBe('contact-hub');
    expect(legacyAddress.id).toBe(defaultMailbox.address_id);

    const supportResponse = await request.post(`${WORKER_CONTACT_URL}/admin/contact/mailboxes`, {
      headers: ADMIN_HEADERS,
      data: { domain_id: domain.id, local_part: 'Support.Team', display_name: 'Support' },
    });
    expect(supportResponse.status()).toBe(201);
    const support = (await supportResponse.json()).result;
    expect(support.address).toBe(`support.team@${normalizedDomain}`);

    const duplicateMailbox = await request.post(`${WORKER_CONTACT_URL}/admin/contact/mailboxes`, {
      headers: ADMIN_HEADERS,
      data: { domain_id: domain.id, local_part: 'support.team' },
    });
    expect(duplicateMailbox.status()).toBe(409);

    const crossDomainInput = await request.post(`${WORKER_CONTACT_URL}/admin/contact/mailboxes`, {
      headers: ADMIN_HEADERS,
      data: { domain_id: domain.id, local_part: 'support@other.example.com' },
    });
    expect(crossDomainInput.status()).toBe(400);

    const moveMailbox = await request.patch(`${WORKER_CONTACT_URL}/admin/contact/mailboxes/${support.id}`, {
      headers: ADMIN_HEADERS,
      data: { domain_id: domain.id + 1 },
    });
    expect(moveMailbox.status()).toBe(409);
  });

  test('supports at least 50 private Domains without exposing them publicly', async ({ request }) => {
    const run = Date.now();
    for (let index = 0; index < 50; index += 1) {
      const response = await request.post(`${WORKER_CONTACT_URL}/admin/contact/domains`, {
        headers: ADMIN_HEADERS,
        data: {
          domain: `bulk-${run}-${index}.example.com`,
          name: `Bulk site ${index}`,
          create_default_mailbox: false,
        },
      });
      expect(response.status(), await response.text()).toBe(201);
    }

    const domains = await (await request.get(`${WORKER_CONTACT_URL}/admin/contact/domains`, {
      headers: ADMIN_HEADERS,
    })).json();
    expect(domains.results.filter((item: any) => item.domain.startsWith(`bulk-${run}-`))).toHaveLength(50);

    const publicSettings = await (await request.get(`${WORKER_CONTACT_URL}/open_api/settings`)).json();
    expect(publicSettings.domains).toEqual([]);
    expect(JSON.stringify(publicSettings)).not.toContain(`bulk-${run}-`);
  });

  test('Legacy delete and Cleanup cannot remove a Contact Mailbox', async ({ request }) => {
    const run = Date.now();
    const domainResponse = await request.post(`${WORKER_CONTACT_URL}/admin/contact/domains`, {
      headers: ADMIN_HEADERS,
      data: { domain: `protected-${run}.example.com` },
    });
    const domain = (await domainResponse.json()).result;
    const mailbox = (await (await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/mailboxes?domain_id=${domain.id}`,
      { headers: ADMIN_HEADERS },
    )).json()).results[0];

    const legacyDelete = await request.delete(
      `${WORKER_CONTACT_URL}/admin/delete_address/${mailbox.address_id}`,
      { headers: ADMIN_HEADERS },
    );
    expect(legacyDelete.status()).toBe(409);
    expect(await legacyDelete.json()).toMatchObject({
      error: { code: 'CONTACT_MAILBOX_PROTECTED' },
    });

    const legacyName = `legacy-${run}`;
    const legacyCreate = await request.post(`${WORKER_CONTACT_URL}/admin/new_address`, {
      headers: ADMIN_HEADERS,
      data: { name: legacyName, domain: 'private-contact.example.com' },
    });
    expect(legacyCreate.ok()).toBe(true);
    const legacyAddress = await legacyCreate.json();

    const createdSecond = new Date().getUTCSeconds();
    await expect.poll(() => new Date().getUTCSeconds(), { timeout: 2_500 }).not.toBe(createdSecond);
    const cleanup = await request.post(`${WORKER_CONTACT_URL}/admin/cleanup`, {
      headers: ADMIN_HEADERS,
      data: { cleanType: 'addressCreated', cleanDays: 0 },
    });
    expect(cleanup.ok()).toBe(true);

    const protectedLookup = await request.get(
      `${WORKER_CONTACT_URL}/admin/address?limit=10&offset=0&query=${encodeURIComponent(mailbox.address)}`,
      { headers: ADMIN_HEADERS },
    );
    expect((await protectedLookup.json()).results).toHaveLength(1);

    const legacyLookup = await request.get(
      `${WORKER_CONTACT_URL}/admin/address?limit=10&offset=0&query=${encodeURIComponent(legacyAddress.address)}`,
      { headers: ADMIN_HEADERS },
    );
    expect((await legacyLookup.json()).results).toHaveLength(0);
  });
});
