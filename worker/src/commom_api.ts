import { Hono } from 'hono'

import utils from './utils';
import { CONSTANTS } from './constants';
import { isS3Enabled } from './mails_api/s3_attachment';
import { isAnySendMailEnabled } from './common';
import { getAppCapabilities, resolveAppMode } from './app_mode';

const api = new Hono<HonoCustomType>

api.get('/open_api/settings', async (c) => {
    const mode = resolveAppMode(c.env);
    const capabilities = getAppCapabilities(mode);
    const isContactMode = mode === 'contact';
    // check header x-custom-auth
    let needAuth = false;
    const passwords = utils.getPasswords(c);
    if (passwords && passwords.length > 0) {
        const auth = c.req.raw.headers.get("x-custom-auth");
        needAuth = !auth || !passwords.includes(auth);
    }
    const smtpImapProxyConfig = utils.getJsonObjectValue<SmtpImapProxyConfig>(
        c.env.SMTP_IMAP_PROXY_CONFIG
    ) || {};
    const smtpProxyConfig = smtpImapProxyConfig.smtp || {};
    const imapProxyConfig = smtpImapProxyConfig.imap || {};

    return c.json({
        "mode": mode,
        "capabilities": capabilities,
        "title": c.env.TITLE,
        "announcement": utils.getStringValue(c.env.ANNOUNCEMENT),
        "alwaysShowAnnouncement": utils.getBooleanValue(c.env.ALWAYS_SHOW_ANNOUNCEMENT),
        "prefix": isContactMode ? "" : utils.trimLower(c.env.PREFIX),
        "addressRegex": utils.getStringValue(c.env.ADDRESS_REGEX),
        "minAddressLen": utils.getIntValue(c.env.MIN_ADDRESS_LEN, 1),
        "maxAddressLen": utils.getIntValue(c.env.MAX_ADDRESS_LEN, 30),
        "defaultDomains": isContactMode ? [] : utils.getDefaultDomains(c),
        "domains": isContactMode ? [] : utils.getDomains(c),
        "randomSubdomainDomains": isContactMode ? [] : utils.getRandomSubdomainDomains(c),
        "domainLabels": isContactMode ? [] : utils.getStringArray(c.env.DOMAIN_LABELS),
        "needAuth": needAuth,
        "adminContact": c.env.ADMIN_CONTACT,
        "enableUserCreateEmail": capabilities.publicAddressCreation
            && utils.getBooleanValue(c.env.ENABLE_USER_CREATE_EMAIL),
        "disableAnonymousUserCreateEmail": isContactMode
            || utils.getBooleanValue(c.env.DISABLE_ANONYMOUS_USER_CREATE_EMAIL),
        "disableCustomAddressName": utils.getBooleanValue(c.env.DISABLE_CUSTOM_ADDRESS_NAME),
        "enableUserDeleteEmail": capabilities.publicMailbox
            && utils.getBooleanValue(c.env.ENABLE_USER_DELETE_EMAIL),
        "enableMailReadStatus": capabilities.publicMailbox
            && utils.getBooleanValue(c.env.ENABLE_MAIL_READ_STATUS),
        "enableAutoReply": utils.getBooleanValue(c.env.ENABLE_AUTO_REPLY),
        "enableIndexAbout": utils.getBooleanValue(c.env.ENABLE_INDEX_ABOUT),
        "copyright": c.env.COPYRIGHT,
        "cfTurnstileSiteKey": c.env.CF_TURNSTILE_SITE_KEY,
        "enableWebhook": utils.getBooleanValue(c.env.ENABLE_WEBHOOK),
        "isS3Enabled": isS3Enabled(c),
        "enableSendMail": capabilities.publicSendMail && isAnySendMailEnabled(c),
        "version": CONSTANTS.VERSION,
        "showGithub": !utils.getBooleanValue(c.env.DISABLE_SHOW_GITHUB),
        "showGithubForUser": !utils.getBooleanValue(c.env.DISABLE_SHOW_GITHUB_FOR_USER),
        "disableAdminPasswordCheck": utils.getBooleanValue(c.env.DISABLE_ADMIN_PASSWORD_CHECK),
        "enableAddressPassword": utils.getBooleanValue(c.env.ENABLE_ADDRESS_PASSWORD),
        "enableAgentEmailInfo": utils.getBooleanValue(c.env.ENABLE_AGENT_EMAIL_INFO),
        "smtpImapProxyConfig": {
            "smtp": {
                "host": utils.getStringValue(smtpProxyConfig.host),
                "port": utils.getIntValue(smtpProxyConfig.port, 8025),
                "starttls": utils.getBooleanValue(smtpProxyConfig.starttls),
            },
            "imap": {
                "host": utils.getStringValue(imapProxyConfig.host),
                "port": utils.getIntValue(imapProxyConfig.port, 11143),
                "starttls": utils.getBooleanValue(imapProxyConfig.starttls),
            },
        },
        "statusUrl": utils.getStringValue(c.env.STATUS_URL),
        "enableGlobalTurnstileCheck": utils.isGlobalTurnstileEnabled(c)
    });
})

export { api }
