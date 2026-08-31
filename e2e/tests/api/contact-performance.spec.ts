import { expect, test, type APIRequestContext } from '@playwright/test';

import { WORKER_CONTACT_URL } from '../../fixtures/test-helpers';

const ADMIN_HEADERS = { 'x-admin-auth': 'e2e-contact-admin' };
const run = Date.now();
const domains: Array<{ id: number, mailboxId: number, address: string }> = [];

const receive = async (request: APIRequestContext, address: string, raw: string) => {
  const response = await request.post(`${WORKER_CONTACT_URL}/admin/test/receive_mail`, {
    headers: ADMIN_HEADERS, data: { from: 'size@example.net', to: address, raw },
  });
  expect(response.ok(), await response.text()).toBe(true);
};

const attachmentMail = (address: string, label: string, content: Buffer) => [
  'From: Size Test <size@example.net>', `To: ${address}`,
  'Subject: Attachment footprint', `Message-ID: <size-${label}-${run}@example.net>`,
  'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="size-${label}"`, '',
  `--size-${label}`, 'Content-Type: text/plain', '', 'Same indexed body',
  `--size-${label}`, `Content-Type: application/octet-stream; name="${label}.bin"`,
  `Content-Disposition: attachment; filename="${label}.bin"`, 'Content-Transfer-Encoding: base64', '',
  content.toString('base64'), `--size-${label}--`,
].join('\r\n');

test.describe.serial('Contact V1 seed performance', () => {
  test.beforeEach(() => {
    test.skip(!WORKER_CONTACT_URL, 'WORKER_CONTACT_URL is not configured');
    test.setTimeout(180_000);
  });

  test('seeds 50 Domains and 1000 indexed messages', async ({ request }) => {
    await request.post(`${WORKER_CONTACT_URL}/admin/contact/db/migrate`, { headers: ADMIN_HEADERS });
    for (let index = 0; index < 50; index += 1) {
      const response = await request.post(`${WORKER_CONTACT_URL}/admin/contact/domains`, {
        headers: ADMIN_HEADERS,
        data: { domain: `perf-${run}-${index}.example.com`, name: `Performance ${index}` },
      });
      expect(response.status(), await response.text()).toBe(201);
      const domain = (await response.json()).result;
      const mailboxes = await (await request.get(
        `${WORKER_CONTACT_URL}/admin/contact/mailboxes?domain_id=${domain.id}`,
        { headers: ADMIN_HEADERS },
      )).json();
      domains.push({ id: domain.id, mailboxId: mailboxes.results[0].id, address: mailboxes.results[0].address });
    }
    const seed = await request.post(`${WORKER_CONTACT_URL}/admin/test/contact_performance_seed`, {
      headers: ADMIN_HEADERS,
      data: { mailbox_ids: domains.map(domain => domain.mailboxId), messages_per_mailbox: 20 },
      timeout: 180_000,
    });
    expect(seed.status(), await seed.text()).toBe(200);
    expect(await seed.json()).toMatchObject({ ok: true, domains: 50, messages: 1000 });

    const started = Date.now();
    const list = await request.get(`${WORKER_CONTACT_URL}/admin/contact/messages?limit=100`, {
      headers: ADMIN_HEADERS,
    });
    const elapsed = Date.now() - started;
    expect(list.status()).toBe(200);
    const text = await list.text();
    const body = JSON.parse(text);
    expect(body.results).toHaveLength(100);
    expect(text.length).toBeLessThan(150_000);
    expect(elapsed).toBeLessThan(15_000);
    expect(body.results.every((message: any) => message.text_body === undefined && message.html_body === undefined)).toBe(true);
  });

  test('metadata list size is independent of attachment bytes', async ({ request }) => {
    await receive(request, domains[0].address, attachmentMail(domains[0].address, 'small', Buffer.alloc(32, 97)));
    await receive(request, domains[0].address, attachmentMail(domains[0].address, 'large', Buffer.alloc(512 * 1024, 98)));
    const response = await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/messages?domain_id=${domains[0].id}&subject=Attachment%20footprint`,
      { headers: ADMIN_HEADERS },
    );
    const text = await response.text();
    const body = JSON.parse(text);
    expect(body.results).toHaveLength(2);
    expect(text.length).toBeLessThan(5_000);
    expect(text).not.toContain(Buffer.alloc(64, 98).toString('base64'));
    expect(body.results.every((message: any) => message.has_attachments === true)).toBe(true);
  });
});
