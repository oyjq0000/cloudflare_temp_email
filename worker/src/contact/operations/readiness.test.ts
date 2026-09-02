import assert from 'node:assert/strict'
import test from 'node:test'

import { computeContactReadiness } from './readiness.ts'

const ready = {
    adminReady: true, migrationReady: true, storageReady: true,
    enabledDomains: 1, inboundMailboxes: 1, enabledProviders: 1,
    usableProviderDomains: 1, outboundMailboxes: 1, severeConsistencyErrors: 0,
}

test('Contact readiness requires admin, migration, R2, inbound resources and clean defaults for production', () => {
    assert.deepEqual(computeContactReadiness(ready), {
        codeReady: true, inboundReady: true, outboundReady: true, productionReady: true,
    })
    assert.equal(computeContactReadiness({ ...ready, adminReady: false }).productionReady, false)
    assert.equal(computeContactReadiness({ ...ready, migrationReady: false }).productionReady, false)
    assert.equal(computeContactReadiness({ ...ready, storageReady: false }).productionReady, false)
    assert.equal(computeContactReadiness({ ...ready, enabledDomains: 0 }).productionReady, false)
    assert.equal(computeContactReadiness({ ...ready, inboundMailboxes: 0 }).productionReady, false)
    assert.equal(computeContactReadiness({ ...ready, severeConsistencyErrors: 1 }).productionReady, false)
})

test('outbound readiness is reported separately and needs provider binding, secret and outbound Mailbox', () => {
    assert.equal(computeContactReadiness({ ...ready, enabledProviders: 0 }).outboundReady, false)
    assert.equal(computeContactReadiness({ ...ready, usableProviderDomains: 0 }).outboundReady, false)
    assert.equal(computeContactReadiness({ ...ready, outboundMailboxes: 0 }).outboundReady, false)
    assert.equal(computeContactReadiness({ ...ready, enabledProviders: 0 }).productionReady, true)
})
