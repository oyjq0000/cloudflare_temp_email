import { expect, test, type APIRequestContext } from '@playwright/test';

import { getContactAdminHeaders, WORKER_CONTACT_URL } from '../../fixtures/test-helpers';

const ADMIN_HEADERS = await getContactAdminHeaders();
const run = Date.now();
let sequence = 0;

const createMailbox = async (request: APIRequestContext, label: string) => {
  sequence += 1;
  const domainName = `${label}-${run}-${sequence}.example.com`;
  const response = await request.post(`${WORKER_CONTACT_URL}/admin/contact/domains`, {
    headers: ADMIN_HEADERS,
    data: { domain: domainName, name: label },
  });
  expect(response.status(), await response.text()).toBe(201);
  return `contact@${domainName}`;
};

const receive = async (
  request: APIRequestContext,
  to: string,
  raw: string,
  options: Record<string, unknown> = {},
) => request.post(`${WORKER_CONTACT_URL}/admin/test/receive_mail`, {
  headers: ADMIN_HEADERS,
  data: { from: 'sender@example.net', to, raw, ...options },
});

const inspect = async (request: APIRequestContext, address: string, messageId?: string) => {
  const query = new URLSearchParams({ address });
  if (messageId) query.set('message_id', messageId);
  const response = await request.get(
    `${WORKER_CONTACT_URL}/admin/test/contact_message?${query}`,
    { headers: ADMIN_HEADERS },
  );
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
};

const plainMail = (to: string, messageId: string | null, body = 'Plain Contact body') => [
  'From: Sender <sender@example.net>',
  `To: ${to}`,
  'Subject: Plain Contact',
  ...(messageId ? [`Message-ID: ${messageId}`] : []),
  'Date: Tue, 01 Sep 2026 08:00:00 +0000',
  'Content-Type: text/plain; charset=utf-8',
  '',
  body,
].join('\r\n');

const richMail = (to: string, messageId: string) => [
  'From: Rich Sender <rich@example.net>',
  `To: ${to}`,
  'Cc: Audit <audit@example.net>',
  'Reply-To: Reply Desk <reply@example.net>',
  'Subject: Rich Contact',
  `Message-ID: ${messageId}`,
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="outer-boundary"',
  '',
  '--outer-boundary',
  'Content-Type: multipart/related; boundary="related-boundary"',
  '',
  '--related-boundary',
  'Content-Type: multipart/alternative; boundary="alternative-boundary"',
  '',
  '--alternative-boundary',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Readable rich body',
  '--alternative-boundary',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Readable <strong>rich</strong> body<img src="cid:logo@example"></p>',
  '--alternative-boundary--',
  '--related-boundary',
  'Content-Type: image/png',
  'Content-Disposition: inline; filename="logo.png"',
  'Content-ID: <logo@example>',
  'Content-Transfer-Encoding: base64',
  '',
  'iVBORw0KGgo=',
  '--related-boundary--',
  '--outer-boundary',
  'Content-Type: text/plain; name="notes.txt"',
  'Content-Disposition: attachment; filename="notes.txt"',
  'Content-Transfer-Encoding: base64',
  '',
  'YXR0YWNobWVudCBib2R5',
  '--outer-boundary--',
].join('\r\n');

test.describe.serial('Contact inbound persistence', () => {
  test.beforeEach(() => {
    test.skip(!WORKER_CONTACT_URL, 'WORKER_CONTACT_URL is not configured');
  });

  test.beforeAll(async ({ request }) => {
    if (!WORKER_CONTACT_URL) return;
    const migration = await request.post(`${WORKER_CONTACT_URL}/admin/contact/db/migrate`, {
      headers: ADMIN_HEADERS,
    });
    expect(migration.ok(), await migration.text()).toBe(true);
  });

  test('stores plain MIME in D1 and raw R2 with one parse result', async ({ request }) => {
    const address = await createMailbox(request, 'plain');
    const messageId = `<plain-${run}@example.net>`;
    const response = await receive(request, address, plainMail(address, messageId));
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({ success: true });

    const stored = await inspect(request, address, messageId);
    expect(stored.count).toBe(1);
    expect(stored.message).toMatchObject({
      subject: 'Plain Contact',
      folder: 'inbox',
      storage_status: 'stored',
      parse_status: 'parsed',
      raw_fallback_available: 1,
    });
    expect(stored.message.text_body).toContain('Plain Contact body');
    expect(stored.rawObjectStored).toBe(true);
    expect(stored.attachments).toEqual([]);
  });

  test('indexes HTML, multipart, CID, and attachment metadata without D1 bytes', async ({ request }) => {
    const address = await createMailbox(request, 'rich');
    const messageId = `<rich-${run}@example.net>`;
    expect((await receive(request, address, richMail(address, messageId))).ok()).toBe(true);

    const stored = await inspect(request, address, messageId);
    expect(stored.message.text_body).toContain('Readable rich body');
    expect(stored.message.html_body).toContain('cid:logo@example');
    expect(JSON.parse(stored.message.cc_json)).toEqual([
      { name: 'Audit', address: 'audit@example.net' },
    ]);
    expect(stored.message.reply_to_address).toBe('reply@example.net');
    expect(stored.message.has_attachments).toBe(1);
    expect(stored.attachments).toHaveLength(2);
    expect(stored.attachments.map((item: any) => item.filename)).toEqual(['logo.png', 'notes.txt']);
    expect(stored.attachments[0]).not.toHaveProperty('content');
    expect(stored.attachmentObjectsStored).toEqual([true, true]);
  });

  test('deduplicates Message-ID and stable raw-hash fallback deliveries', async ({ request }) => {
    const address = await createMailbox(request, 'dedupe');
    const messageId = `<dedupe-${run}@example.net>`;
    const raw = plainMail(address, messageId, 'same message');
    const first = await receive(request, address, raw, { force_forward: true });
    const second = await receive(request, address, raw, { force_forward: true });
    expect((await first.json()).forwardedTo).toEqual(['side-effect@example.test']);
    expect((await second.json()).forwardedTo).toEqual([]);
    expect((await inspect(request, address, messageId)).count).toBe(1);

    const fallbackAddress = await createMailbox(request, 'fallback-dedupe');
    const noIdRaw = plainMail(fallbackAddress, null, 'stable raw fallback');
    await receive(request, fallbackAddress, noIdRaw, { omit_generated_message_id: true });
    await receive(request, fallbackAddress, noIdRaw, { omit_generated_message_id: true });
    expect((await inspect(request, fallbackAddress)).count).toBe(1);
  });


  test('uses trusted server receive time and preserves only the sender-declared Date separately', async ({ request }) => {
    for (const [label, declared, expectedSenderDate] of [
      ['future-date', 'Fri, 01 Jan 2099 00:00:00 +0000', '2099-01-01T00:00:00.000Z'],
      ['past-date', 'Thu, 01 Jan 1970 00:00:00 +0000', '1970-01-01T00:00:00.000Z'],
      ['invalid-date', 'not-a-real-date', null],
    ] as const) {
      const address = await createMailbox(request, label);
      const messageId = `<${label}-${run}@example.net>`;
      const raw = plainMail(address, messageId).replace(
        'Date: Tue, 01 Sep 2026 08:00:00 +0000',
        `Date: ${declared}`,
      );
      const before = Date.now() - 2_000;
      expect((await receive(request, address, raw)).ok()).toBe(true);
      const after = Date.now() + 2_000;
      const stored = await inspect(request, address, messageId);
      expect(stored.message.sender_date).toBe(expectedSenderDate);
      const received = new Date(stored.message.received_at).getTime();
      expect(received).toBeGreaterThanOrEqual(before);
      expect(received).toBeLessThanOrEqual(after);
    }

    const address = await createMailbox(request, 'missing-date');
    const messageId = `<missing-date-${run}@example.net>`;
    const withoutDate = plainMail(address, messageId).replace('Date: Tue, 01 Sep 2026 08:00:00 +0000\r\n', '');
    expect((await receive(request, address, withoutDate)).ok()).toBe(true);
    expect((await inspect(request, address, messageId)).message.sender_date).toBeNull();
  });

  test('isolates every post-persist side effect and records durable status without re-running dedupe', async ({ request }) => {
    const effects = ['forward', 'ai_extract', 'telegram', 'webhook', 'another_worker', 'auto_reply'];
    for (const effect of effects) {
      const fixtureLabel = effect.replaceAll('_', '-');
      const address = await createMailbox(request, `effect-${fixtureLabel}`);
      const messageId = `<effect-${fixtureLabel}-${run}@example.net>`;
      const raw = plainMail(address, messageId, `failure injection ${effect}`);
      const first = await receive(request, address, raw, { fail_side_effects: [effect], force_forward: true });
      expect((await first.json()).success).toBe(true);
      const stored = await inspect(request, address, messageId);
      expect(stored.count).toBe(1);
      const byEffect = Object.fromEntries(stored.sideEffects.map((item: any) => [item.effect, item]));
      expect(byEffect[effect].status).toBe('failed');
      expect(byEffect[effect].attempt_count).toBe(1);
      for (const later of effects.slice(effects.indexOf(effect) + 1)) {
        expect(byEffect[later].status).toBe('succeeded');
      }

      const duplicate = await receive(request, address, raw, { force_forward: true });
      expect((await duplicate.json()).success).toBe(true);
      const afterDuplicate = await inspect(request, address, messageId);
      const afterByEffect = Object.fromEntries(afterDuplicate.sideEffects.map((item: any) => [item.effect, item]));
      expect(afterByEffect[effect].attempt_count).toBe(1);
    }
  });


  test('marks all post-persist side effects skipped when MIME parsing fails', async ({ request }) => {
    const address = await createMailbox(request, 'parse-failed');
    const messageId = `<parse-failed-${run}@example.net>`;
    const response = await receive(request, address, plainMail(address, messageId), { force_parse_failure: true });
    expect((await response.json()).success).toBe(true);
    const stored = await inspect(request, address, messageId);
    expect(stored.message.parse_status).toBe('failed');
    expect(stored.sideEffects).toHaveLength(6);
    expect(stored.sideEffects.every((item: any) => item.status === 'skipped')).toBe(true);
  });

  test('keeps D1 fallback visible on R2 failure and repairs it later', async ({ request }) => {
    const address = await createMailbox(request, 'repair');
    const messageId = `<repair-${run}@example.net>`;
    const response = await receive(request, address, plainMail(address, messageId), {
      force_r2_failure: true,
    });
    expect((await response.json()).success).toBe(true);
    const degraded = await inspect(request, address, messageId);
    expect(degraded.message.storage_status).toBe('degraded');
    expect(degraded.message.raw_fallback_available).toBe(1);
    expect(degraded.rawObjectStored).toBe(false);

    const repair = await request.post(
      `${WORKER_CONTACT_URL}/admin/contact/storage/repair/${degraded.message.id}`,
      { headers: ADMIN_HEADERS },
    );
    expect(repair.ok(), await repair.text()).toBe(true);
    expect((await repair.json()).result.storageStatus).toBe('stored');
    expect((await inspect(request, address, messageId)).rawObjectStored).toBe(true);
  });

  test('does not run side effects after D1 failure and stores Junk in Spam', async ({ request }) => {
    const failedAddress = await createMailbox(request, 'd1-failure');
    const failedId = `<d1-failure-${run}@example.net>`;
    const failed = await receive(request, failedAddress, plainMail(failedAddress, failedId), {
      force_d1_failure: true,
      force_forward: true,
    });
    expect(await failed.json()).toMatchObject({
      success: false,
      forwardedTo: [],
      replyCalled: false,
      rejected: 'Contact message persistence failed',
    });
    expect((await inspect(request, failedAddress, failedId)).count).toBe(0);

    const spamAddress = await createMailbox(request, 'spam');
    const spamId = `<spam-${run}@example.net>`;
    const spamRaw = plainMail(spamAddress, spamId).replace(
      'Content-Type:',
      'Authentication-Results: mx.example; dmarc=fail header.from=example.net\r\nContent-Type:',
    );
    const spam = await receive(request, spamAddress, spamRaw, {
      force_junk_check: true,
      force_forward: true,
    });
    expect((await spam.json()).forwardedTo).toEqual([]);
    const spamStored = await inspect(request, spamAddress, spamId);
    expect(spamStored.message).toMatchObject({ folder: 'spam', spam_reason: 'authentication-policy' });
    expect(spamStored.sideEffects).toHaveLength(6);
    expect(spamStored.sideEffects.every((item: any) => item.status === 'skipped')).toBe(true);
  });

  test('rejects unknown recipients and reports storage health', async ({ request }) => {
    const unknownAddress = `missing-${run}@example.com`;
    const unknown = await receive(request, unknownAddress, plainMail(unknownAddress, `<missing-${run}@test>`));
    expect(await unknown.json()).toMatchObject({
      success: false,
      rejected: 'Unknown or disabled Contact Mailbox',
    });

    const status = await request.get(`${WORKER_CONTACT_URL}/admin/contact/storage/status`, {
      headers: ADMIN_HEADERS,
    });
    expect(status.ok()).toBe(true);
    expect(await status.json()).toMatchObject({ ok: true, bindingAvailable: true });
  });
});
