import type { ContactProviderConfig } from './config_service.ts'
import { BrevoProvider } from './brevo.ts'
import { resolveProviderHttpTimeoutMs } from './http.ts'
import { ResendProvider } from './resend.ts'
import { resolveProviderSecrets } from './secret_resolver.ts'
import { SmtpProvider } from './smtp.ts'
import {
    configurationFailure,
    type OutboundMessage,
    type OutboundProvider,
    type ProviderSendResult,
    type ProviderType,
} from './types.ts'

export type ProviderDependencies = {
    resend?: OutboundProvider
    brevo?: OutboundProvider
    smtp?: OutboundProvider
}

export class ContactProviderRegistry {
    private readonly providers: Record<ProviderType, OutboundProvider>

    constructor(dependencies: ProviderDependencies = {}) {
        this.providers = {
            resend: dependencies.resend || new ResendProvider(),
            brevo: dependencies.brevo || new BrevoProvider(),
            smtp: dependencies.smtp || new SmtpProvider(),
        }
    }

    get(type: ProviderType): OutboundProvider { return this.providers[type] }
}

export const sendWithContactProvider = async (
    env: Bindings,
    providerConfig: ContactProviderConfig,
    message: OutboundMessage,
    registry = new ContactProviderRegistry(),
): Promise<ProviderSendResult> => {
    if (!providerConfig.enabled) return configurationFailure('PROVIDER_DISABLED')
    const secrets = resolveProviderSecrets(env, providerConfig.secretRefs).values
    const requiredSecret = providerConfig.providerType === 'smtp'
        ? (providerConfig.config.username ? 'password' : null)
        : 'apiKey'
    if (requiredSecret && !secrets[requiredSecret]) {
        return configurationFailure(`${providerConfig.providerType.toUpperCase()}_${requiredSecret.toUpperCase()}_MISSING`)
    }
    return registry.get(providerConfig.providerType).send(message, {
        config: providerConfig.config,
        secrets,
        httpTimeoutMs: resolveProviderHttpTimeoutMs(env.CONTACT_PROVIDER_HTTP_TIMEOUT_MS),
    })
}
