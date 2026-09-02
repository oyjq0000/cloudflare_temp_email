export type ContactReadinessInput = {
    adminReady: boolean
    migrationReady: boolean
    storageReady: boolean
    enabledDomains: number
    inboundMailboxes: number
    enabledProviders: number
    usableProviderDomains: number
    outboundMailboxes: number
    severeConsistencyErrors: number
}

export const computeContactReadiness = (input: ContactReadinessInput) => {
    const codeReady = true
    const inboundReady = input.migrationReady
        && input.enabledDomains > 0
        && input.inboundMailboxes > 0
    const outboundReady = input.migrationReady
        && input.enabledProviders > 0
        && input.usableProviderDomains > 0
        && input.outboundMailboxes > 0
    const productionReady = codeReady
        && input.adminReady
        && input.migrationReady
        && input.storageReady
        && inboundReady
        && input.severeConsistencyErrors === 0
    return { codeReady, inboundReady, outboundReady, productionReady }
}
