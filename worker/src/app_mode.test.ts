import assert from 'node:assert/strict'
import test from 'node:test'

import {
    getAppCapabilities,
    getContactAdminSecurityStatus,
    isContactModePublicPathBlocked,
    resolveAppMode,
} from './app_mode.ts'

test('resolveAppMode defaults safely to temp and only accepts explicit true', () => {
    assert.equal(resolveAppMode({ CONTACT_MAIL_MODE: undefined }), 'temp')
    assert.equal(resolveAppMode({ CONTACT_MAIL_MODE: false }), 'temp')
    assert.equal(resolveAppMode({ CONTACT_MAIL_MODE: '1' }), 'temp')
    assert.equal(resolveAppMode({ CONTACT_MAIL_MODE: 'TRUE' }), 'contact')
})

test('contact capabilities close every public mailbox surface', () => {
    assert.deepEqual(getAppCapabilities('contact'), {
        contactHub: true,
        publicMailbox: false,
        publicAddressCreation: false,
        publicRegistration: false,
        publicSendMail: false,
        userPortal: false,
    })
    assert.equal(getAppCapabilities('temp').publicMailbox, true)
})

test('contact public path gate blocks mailbox, registration, OAuth, and Telegram paths', () => {
    const blocked = [
        '/api/new_address',
        '/api/send_mail',
        '/api/address_login',
        '/api/mails',
        '/external/api/send_mail',
        '/user_api/register',
        '/user_api/verify_code',
        '/user_api/oauth2/login_url',
        '/user_api/mails',
        '/open_api/credential_login',
        '/telegram/new_address',
    ]
    for (const path of blocked) assert.equal(isContactModePublicPathBlocked(path), true, path)

    const allowed = [
        '/open_api/settings',
        '/open_api/admin_login',
        '/user_api/login',
        '/user_api/settings',
        '/user_api/passkey/authenticate_request',
        '/admin/contact/status',
    ]
    for (const path of allowed) assert.equal(isContactModePublicPathBlocked(path), false, path)
})

test('contact admin configuration requires credentials and forbids production bypass', () => {
    const base = { CONTACT_MAIL_MODE: true }
    assert.equal(getContactAdminSecurityStatus(base).code, 'CONTACT_ADMIN_AUTH_REQUIRED')
    assert.equal(getContactAdminSecurityStatus({
        ...base,
        ADMIN_PASSWORDS: '["secret"]',
    }).secure, true)
    assert.equal(getContactAdminSecurityStatus({
        ...base,
        ADMIN_USER_ROLE: 'admin',
    }).secure, true)
    assert.equal(getContactAdminSecurityStatus({
        ...base,
        ADMIN_PASSWORDS: '["secret"]',
        DISABLE_ADMIN_PASSWORD_CHECK: true,
    }).code, 'CONTACT_ADMIN_PASSWORD_BYPASS_FORBIDDEN')
    assert.equal(getContactAdminSecurityStatus({
        ...base,
        DISABLE_ADMIN_PASSWORD_CHECK: true,
        E2E_TEST_MODE: true,
    }).secure, true)
})
