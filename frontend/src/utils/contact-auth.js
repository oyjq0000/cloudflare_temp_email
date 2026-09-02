export const isContactAdminApiPath = (path) => (
  path === '/admin/contact' || path.startsWith('/admin/contact/')
)

export const clearLegacyContactAdminPassword = (adminAuth, storage = globalThis.localStorage) => {
  if (adminAuth) adminAuth.value = ''
  storage?.removeItem?.('adminAuth')
}
