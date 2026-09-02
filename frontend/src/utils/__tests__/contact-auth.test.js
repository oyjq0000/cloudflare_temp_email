import { describe, expect, it, vi } from 'vitest'

import { clearLegacyContactAdminPassword, isContactAdminApiPath } from '../contact-auth'

describe('Contact admin API isolation', () => {
  it('matches only the Contact admin namespace', () => {
    expect(isContactAdminApiPath('/admin/contact')).toBe(true)
    expect(isContactAdminApiPath('/admin/contact/messages')).toBe(true)
    expect(isContactAdminApiPath('/admin/contacted')).toBe(false)
    expect(isContactAdminApiPath('/admin/address')).toBe(false)
    expect(isContactAdminApiPath('/open_api/contact_admin_login')).toBe(false)
  })

  it('clears the historical localStorage admin password', () => {
    const adminAuth = { value: 'plain-text-admin-password' }
    const storage = { removeItem: vi.fn() }
    clearLegacyContactAdminPassword(adminAuth, storage)
    expect(adminAuth.value).toBe('')
    expect(storage.removeItem).toHaveBeenCalledWith('adminAuth')
  })
})
