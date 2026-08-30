import { describe, expect, it } from 'vitest'

import { getModeRedirect, normalizeAppMode } from '../app-mode'

describe('app mode routing', () => {
    it('defaults unknown values to temp mode', () => {
        expect(normalizeAppMode()).toBe('temp')
        expect(normalizeAppMode('CONTACT')).toBe('temp')
        expect(normalizeAppMode('contact')).toBe('contact')
    })

    it('moves public entry points into the private hub in contact mode', () => {
        expect(getModeRedirect('/', 'contact')).toBe('/hub')
        expect(getModeRedirect('/user', 'contact')).toBe('/hub')
        expect(getModeRedirect('/user/oauth2/callback', 'contact')).toBe('/hub')
        expect(getModeRedirect('/admin', 'contact')).toBeNull()
        expect(getModeRedirect('/hub', 'contact')).toBeNull()
    })

    it('keeps the hub unavailable in temp mode', () => {
        expect(getModeRedirect('/hub', 'temp')).toBe('/')
        expect(getModeRedirect('/', 'temp')).toBeNull()
    })
})
