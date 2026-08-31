import { expect, test, type APIRequestContext } from '@playwright/test';

import { WORKER_CONTACT_URL } from '../../fixtures/test-helpers';

const ADMIN_HEADERS = { 'x-admin-auth': 'e2e-contact-admin' };
const run = Date.now();
let primary: { id: number, mailboxId: number, address: string };
let secondary: { id: number, mailboxId: number, address: string };
let attachmentMessageId: number;
let attachmentId: number;

const createDomain = async (request: APIRequestContext, label: string) => {
  const response = await request.post(`${WORKER_CONTACT_URL}/admin/contact/domains`, {
    headers: ADMIN_HEADERS,
    data: { domain: `${label}-${run}.example.com`, name: label },
  });
  expect(response.status(), await response.text()).toBe(201);
  const domain = (await response.json()).result;
  const mailboxes = await (await request.get(
    `${WORKER_CONTACT_URL}/admin/contact/mailboxes?domain_id=${domain.id}`,
    { headers: ADMIN_HEADERS },
  )).json();
  return { id: domain.id, mailboxId: mailboxes.results[0].id, address: mailboxes.results[0].address };
};

const receive = async (request: APIRequestContext, to: string, raw: string) => {
  const response = await request.post(`${WORKER_CONTACT_URL}/admin/test/receive_mail`, {
    headers: ADMIN_HEADERS,
    data: { from: 'phase4.sender@example.net', to, raw },
  });
  expect(response.ok(), await response.text()).toBe(true);
  expect((await response.json()).success).toBe(true);
};

const plainMail = (to: string, index: number) => [
  'From: Phase Four Sender <phase4.sender@example.net>',
  `To: ${to}`,
  `Subject: Cursor message ${String(index).padStart(2, '0')}`,
  `Message-ID: <phase4-${run}-${index}@example.net>`,
  `Date: Tue, 01 Sep 2026 08:${String(index).padStart(2, '0')}:00 +0000`,
  'Content-Type: text/plain; charset=utf-8',
  '',
  `Private body ${index}`,
].join('\r\n');

const attachmentMail = (to: string) => [
  'From: Tracker <tracker@example.net>',
  `To: ${to}`,
  'Subject: Tracker and unsafe attachment',
  `Message-ID: <phase4-attachment-${run}@example.net>`,
  'Date: Tue, 01 Sep 2026 09:00:00 +0000',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="phase4-boundary"',
  '',
  '--phase4-boundary',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p onclick="alert(1)">Hello<img src="https://tracker.example/pixel.gif"></p><script>alert(2)</script>',
  '--phase4-boundary',
  'Content-Type: text/html; name="../folder/evil.html"',
  'Content-Disposition: attachment; filename="../folder/evil.html"',
  'Content-Transfer-Encoding: base64',
  '',
  'PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  '--phase4-boundary--',
].join('\r\n');

test.describe.serial('Contact message API', () => {
  test.beforeEach(() => test.skip(!WORKER_CONTACT_URL, 'WORKER_CONTACT_URL is not configured'));

  test.beforeAll(async ({ request }) => {
    if (!WORKER_CONTACT_URL) return;
    const migration = await request.post(`${WORKER_CONTACT_URL}/admin/contact/db/migrate`, { headers: ADMIN_HEADERS });
    expect(migration.ok(), await migration.text()).toBe(true);
    primary = await createDomain(request, 'message-primary');
    secondary = await createDomain(request, 'message-secondary');
    for (let index = 0; index < 24; index += 1) await receive(request, primary.address, plainMail(primary.address, index));
    await receive(request, secondary.address, plainMail(secondary.address, 40));
    await receive(request, primary.address, attachmentMail(primary.address));

    const lookup = await (await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/messages?domain_id=${primary.id}&subject=${encodeURIComponent('Tracker and unsafe attachment')}`,
      { headers: ADMIN_HEADERS },
    )).json();
    attachmentMessageId = lookup.results[0].id;
    const detail = await (await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/messages/${attachmentMessageId}`,
      { headers: ADMIN_HEADERS },
    )).json();
    attachmentId = detail.result.attachments[0].id;
  });

  test('paginates metadata only and applies server filters across pages', async ({ request }) => {
    const firstResponse = await request.get(`${WORKER_CONTACT_URL}/admin/contact/messages?limit=10&domain_id=${primary.id}`, { headers: ADMIN_HEADERS });
    expect(firstResponse.ok(), await firstResponse.text()).toBe(true);
    const first = await firstResponse.json();
    expect(first.results).toHaveLength(10);
    expect(first.nextCursor).toBeTruthy();
    for (const row of first.results) {
      expect(row).not.toHaveProperty('text_body');
      expect(row).not.toHaveProperty('html_body');
      expect(row).not.toHaveProperty('raw');
      expect(row).not.toHaveProperty('raw_blob');
      expect(row).not.toHaveProperty('attachments');
      expect(row).not.toHaveProperty('raw_storage_key');
    }

    const secondPage = await (await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/messages?limit=10&domain_id=${primary.id}&cursor=${encodeURIComponent(first.nextCursor)}`,
      { headers: ADMIN_HEADERS },
    )).json();
    expect(secondPage.results).toHaveLength(10);
    expect(new Set([...first.results, ...secondPage.results].map((row: any) => row.id)).size).toBe(20);

    const subject = await (await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/messages?limit=5&domain_id=${primary.id}&subject=${encodeURIComponent('Cursor message 02')}`,
      { headers: ADMIN_HEADERS },
    )).json();
    expect(subject.results.map((row: any) => row.subject)).toEqual(['Cursor message 02']);

    const combined = await (await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/messages?domain_id=${secondary.id}&mailbox_id=${secondary.mailboxId}&from=phase4.sender&to=${encodeURIComponent(secondary.address)}&date_from=2026-09-01T08:39:00Z&date_to=2026-09-01T08:41:00Z`,
      { headers: ADMIN_HEADERS },
    )).json();
    expect(combined.results).toHaveLength(1);
    expect(combined.results[0].subject).toBe('Cursor message 40');

    const invalidCursor = await request.get(`${WORKER_CONTACT_URL}/admin/contact/messages?cursor=not-a-cursor`, { headers: ADMIN_HEADERS });
    expect(invalidCursor.status()).toBe(400);
    expect(await invalidCursor.json()).toMatchObject({ error: { code: 'CONTACT_INVALID_CURSOR' } });
  });

  test('loads body only in detail and keeps storage internals private', async ({ request }) => {
    const response = await request.get(`${WORKER_CONTACT_URL}/admin/contact/messages/${attachmentMessageId}`, { headers: ADMIN_HEADERS });
    expect(response.ok(), await response.text()).toBe(true);
    const detail = (await response.json()).result;
    expect(detail.html_body).toContain('tracker.example');
    expect(detail.attachments).toHaveLength(1);
    expect(detail.attachments[0]).toMatchObject({ mime_type: 'text/html', size: 25 });
    expect(detail).not.toHaveProperty('raw_storage_key');
    expect(detail).not.toHaveProperty('dedupe_key');
    expect(detail.attachments[0]).not.toHaveProperty('storage_key');
    expect(detail.attachments[0]).not.toHaveProperty('content');
  });

  test('updates unread and spam state with accurate counts', async ({ request }) => {
    const before = await (await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/messages?domain_id=${secondary.id}`,
      { headers: ADMIN_HEADERS },
    )).json();
    const id = before.results[0].id;
    expect(before.counts).toMatchObject({ inbox: 1, unread: 1, spam: 0 });

    await request.post(`${WORKER_CONTACT_URL}/admin/contact/messages/${id}/read`, { headers: ADMIN_HEADERS });
    expect((await (await request.get(`${WORKER_CONTACT_URL}/admin/contact/messages?domain_id=${secondary.id}`, { headers: ADMIN_HEADERS })).json()).counts.unread).toBe(0);
    await request.post(`${WORKER_CONTACT_URL}/admin/contact/messages/${id}/unread`, { headers: ADMIN_HEADERS });
    await request.post(`${WORKER_CONTACT_URL}/admin/contact/messages/${id}/spam`, { headers: ADMIN_HEADERS });
    const spam = await (await request.get(`${WORKER_CONTACT_URL}/admin/contact/messages?domain_id=${secondary.id}&folder=inbox`, { headers: ADMIN_HEADERS })).json();
    expect(spam.counts).toMatchObject({ inbox: 0, unread: 0, spam: 1 });
    expect(spam.results).toHaveLength(0);
    await request.post(`${WORKER_CONTACT_URL}/admin/contact/messages/${id}/not-spam`, { headers: ADMIN_HEADERS });
  });

  test('requires admin auth for raw and attachment downloads and forces safe headers', async ({ request }) => {
    expect((await request.get(`${WORKER_CONTACT_URL}/admin/contact/messages/${attachmentMessageId}/raw`)).status()).toBe(401);
    expect((await request.get(`${WORKER_CONTACT_URL}/admin/contact/attachments/${attachmentId}`)).status()).toBe(401);

    const raw = await request.get(`${WORKER_CONTACT_URL}/admin/contact/messages/${attachmentMessageId}/raw`, { headers: ADMIN_HEADERS });
    expect(raw.ok(), await raw.text()).toBe(true);
    expect(raw.headers()['content-type']).toContain('message/rfc822');
    expect(raw.headers()['cache-control']).toBe('private, no-store');
    expect(raw.headers()['x-content-type-options']).toBe('nosniff');
    expect(await raw.text()).toContain('Tracker and unsafe attachment');

    const attachment = await request.get(`${WORKER_CONTACT_URL}/admin/contact/attachments/${attachmentId}`, { headers: ADMIN_HEADERS });
    expect(attachment.ok(), await attachment.text()).toBe(true);
    expect(attachment.headers()['content-type']).toBe('application/octet-stream');
    expect(attachment.headers()['content-disposition']).toContain('filename="evil.html"');
    expect(attachment.headers()['content-disposition']).not.toContain('folder');
    expect(attachment.headers()['cache-control']).toBe('private, no-store');
    expect(attachment.headers()['x-content-type-options']).toBe('nosniff');
    expect(await attachment.text()).toContain('<script>alert(1)</script>');
  });
});
