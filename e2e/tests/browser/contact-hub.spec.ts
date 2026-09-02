import { getContactAdminHeaders } from '../../fixtures/test-helpers';

import { expect, test, type Page } from '@playwright/test';

import { FRONTEND_CONTACT_URL, WORKER_CONTACT_URL } from '../../fixtures/test-helpers';

const ADMIN_HEADERS = await getContactAdminHeaders();
const run = Date.now();
const subject = `Browser Contact Safety ${run}`;
const browserProviderName = `Browser Provider ${run}`;
const browserInUseProviderName = `Browser In Use ${run}`;
const browserSecretReference = 'CONTACT_BROWSER_E2E_SECRET_MISSING';

const signIn = async (page: Page) => {
  await page.goto(`${FRONTEND_CONTACT_URL}/en/hub`);
  await expect(page.getByTestId('contact-login')).toBeVisible();
  await page.locator('.contact-login input[type="password"]').fill('e2e-contact-admin');
  await page.getByRole('button', { name: 'Open Contact Hub' }).click();
  await expect(page.getByRole('heading', { name: 'Private Contact Mail Hub' })).toBeVisible();
  await expect(page.getByTestId('contact-login')).toBeHidden();
};

const filterSubject = async (page: Page) => {
  const messageRow = page.locator('.message-row', { hasText: subject });
  await page.getByPlaceholder('Subject').fill(subject);
  const filteredResponsePromise = page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.pathname === '/admin/contact/messages'
      && url.searchParams.get('subject') === subject;
  });
  await page.getByRole('button', { name: 'Filter' }).click();
  const filteredResponse = await filteredResponsePromise;
  const payload = await filteredResponse.json();
  expect(filteredResponse.ok(), JSON.stringify(payload)).toBe(true);
  expect(payload.results.some((item: { subject: string }) => item.subject === subject)).toBe(true);
  await expect(messageRow).toBeVisible();
};

test.describe.serial('Contact Hub browser safety', () => {
  test.beforeEach(() => {
    test.skip(
      !WORKER_CONTACT_URL || !FRONTEND_CONTACT_URL,
      'WORKER_CONTACT_URL and FRONTEND_CONTACT_URL are required',
    );
    test.setTimeout(60_000);
  });

  test.beforeAll(async ({ request }) => {
    if (!WORKER_CONTACT_URL) return;
    await request.post(`${WORKER_CONTACT_URL}/admin/contact/db/migrate`, { headers: ADMIN_HEADERS });
    const hiddenSecretProvider = await request.post(`${WORKER_CONTACT_URL}/admin/contact/providers`, {
      headers: ADMIN_HEADERS,
      data: { name: browserProviderName, provider_type: 'resend', config: {}, secret_refs: { apiKey: browserSecretReference } },
    });
    expect(hiddenSecretProvider.status(), await hiddenSecretProvider.text()).toBe(201);
    expect(JSON.stringify(await hiddenSecretProvider.json())).not.toContain(browserSecretReference);
    const inUseProvider = (await (await request.post(`${WORKER_CONTACT_URL}/admin/contact/providers`, {
      headers: ADMIN_HEADERS,
      data: { name: browserInUseProviderName, provider_type: 'smtp', config: { host: 'mailpit', port: 1025, secure: false, starttls: false }, secret_refs: {} },
    })).json()).result;
    const domain = (await (await request.post(`${WORKER_CONTACT_URL}/admin/contact/domains`, {
      headers: ADMIN_HEADERS,
      data: { domain: `browser-${run}.example.com`, name: 'Browser safety', default_provider_config_id: inUseProvider.id },
    })).json()).result;
    const mailbox = (await (await request.get(
      `${WORKER_CONTACT_URL}/admin/contact/mailboxes?domain_id=${domain.id}`,
      { headers: ADMIN_HEADERS },
    )).json()).results[0];
    const raw = [
      'From: Browser Sender <browser.sender@example.net>', `To: ${mailbox.address}`,
      `Subject: ${subject}`, `Message-ID: <browser-${run}@example.net>`, 'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="browser-boundary"', '',
      '--browser-boundary', 'Content-Type: text/html; charset=utf-8', '',
      '<p id="safe-copy" onclick="alert(1)">Safe browser body</p><script>alert(2)</script><img src="https://tracker.example/pixel.gif">',
      '--browser-boundary', 'Content-Type: image/svg+xml; name="../browser.svg"',
      'Content-Disposition: attachment; filename="../browser.svg"', 'Content-Transfer-Encoding: base64', '',
      'PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=', '--browser-boundary--',
    ].join('\r\n');
    const received = await request.post(`${WORKER_CONTACT_URL}/admin/test/receive_mail`, {
      headers: ADMIN_HEADERS, data: { from: 'browser.sender@example.net', to: mailbox.address, raw },
    });
    expect(received.ok(), await received.text()).toBe(true);
  });

  test('uses the mobile full-width message drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await filterSubject(page);
    await page.locator('.message-row', { hasText: subject }).click();
    await expect(page.locator('.n-drawer')).toBeVisible();
    await expect(page.locator('.n-drawer').getByText(subject)).toBeVisible();
  });

  test('signs in, renders safe HTML, opts into remote images, and downloads safely', async ({ page }) => {
    let remoteRequests = 0;
    await page.route('https://tracker.example/**', async route => {
      remoteRequests += 1;
      await route.fulfill({ status: 204, body: '' });
    });
    await signIn(page);
    await filterSubject(page);
    await page.locator('.message-row', { hasText: subject }).click();
    await expect(page.locator('.message-detail h2')).toHaveText(subject);
    await expect(page.getByText(/remote resources blocked/)).toBeVisible();
    expect(remoteRequests).toBe(0);

    const unsafeBefore = await page.locator('.contact-html').evaluate(element => {
      const host = [...element.querySelectorAll('div')].find(node => node.shadowRoot);
      return {
        scripts: host?.shadowRoot?.querySelectorAll('script').length || 0,
        handlers: host?.shadowRoot?.querySelectorAll('[onclick]').length || 0,
        remoteImages: host?.shadowRoot?.querySelectorAll('img[src^="http"]').length || 0,
      };
    });
    expect(unsafeBefore).toEqual({ scripts: 0, handlers: 0, remoteImages: 0 });

    await page.getByRole('button', { name: 'Load remote images' }).click();
    await expect.poll(() => remoteRequests).toBe(1);
    const attachmentButton = page.getByRole('button', { name: /browser\.svg/ });
    await expect(attachmentButton).toContainText('browser.svg');
    await expect(attachmentButton).not.toContainText('..');
    await attachmentButton.click({ noWaitAfter: true });

    await page.locator('.message-detail').getByRole('button', { name: 'Move to spam' }).click();
    await page.locator('.hub-sidebar').getByRole('button', { name: /Spam/ }).click();
    await filterSubject(page);
    await page.locator('.message-row', { hasText: subject }).click();
    await page.locator('.message-detail').getByRole('button', { name: 'Not spam' }).click();

    await page.locator('.hub-sidebar nav').last().getByRole('button', { name: 'Operations' }).click();
    await expect(page.getByText('Operations health & DNS')).toBeVisible();
    await expect(page.getByText('Healthy')).toBeVisible();
  });

  test('never persists the admin password and retains only the session token across refresh until logout', async ({ page }) => {
    const contactRequestHeaders: Record<string, string>[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/admin/contact/')) contactRequestHeaders.push(request.headers());
    });
    await page.addInitScript(() => localStorage.setItem('adminAuth', 'historical-plain-password'));
    await signIn(page);
    await expect.poll(() => contactRequestHeaders.length).toBeGreaterThan(0);
    expect(contactRequestHeaders.some(headers => 'x-admin-auth' in headers)).toBe(false);
    expect(contactRequestHeaders.some(headers => headers.authorization?.startsWith('Bearer '))).toBe(true);
    const storage = await page.evaluate(() => ({
      legacy: localStorage.getItem('adminAuth'),
      token: sessionStorage.getItem('contactAdminToken'),
      sessionDump: JSON.stringify(sessionStorage),
      localDump: JSON.stringify(localStorage),
    }));
    expect(storage.legacy).toBeNull();
    expect(storage.localDump).not.toContain('e2e-contact-admin');
    expect(storage.sessionDump).not.toContain('e2e-contact-admin');
    expect(storage.token).toBeTruthy();
    expect(storage.token).not.toContain('e2e-contact-admin');

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Private Contact Mail Hub' })).toBeVisible();
    await expect(page.getByTestId('contact-login')).toBeHidden();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByTestId('contact-login')).toBeVisible();
    const afterLogout = await page.evaluate(() => sessionStorage.getItem('contactAdminToken'));
    expect(afterLogout || '').toBe('');
  });

  test('edits, disables and re-enables Providers without exposing secret references, and blocks in-use disable in UI', async ({ page }) => {
    await signIn(page);
    await page.locator('.hub-sidebar nav').last().getByRole('button', { name: 'Providers' }).click();
    await expect(page.getByText('Provider configs')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(browserSecretReference);

    const hiddenRow = page.locator('.provider-row', { hasText: browserProviderName });
    await hiddenRow.getByRole('button', { name: 'Edit' }).click();
    const modal = page.locator('.contact-modal');
    await expect(modal.getByText(/leave blank while editing/i)).toBeVisible();
    const editedName = `${browserProviderName} Edited`;
    await modal.getByLabel('Name').fill(editedName);
    await modal.getByRole('button', { name: 'Save' }).click();
    const editedRow = page.locator('.provider-row', { hasText: editedName });
    await expect(editedRow).toBeVisible();
    await editedRow.getByRole('button', { name: 'Disable' }).click();
    await expect(editedRow.getByRole('button', { name: 'Re-enable' })).toBeVisible();
    await editedRow.getByRole('button', { name: 'Re-enable' }).click();
    await expect(editedRow.getByRole('button', { name: 'Disable' })).toBeVisible();

    const inUseRow = page.locator('.provider-row', { hasText: browserInUseProviderName });
    await expect(inUseRow.getByText(/Used by domains: 1/)).toBeVisible();
    await expect(inUseRow.getByRole('button', { name: 'Disable' })).toBeDisabled();
    await expect(page.locator('body')).not.toContainText(browserSecretReference);
  });

});
