import { api } from './index'

const jsonBody = (body) => JSON.stringify(body)
const queryString = (params = {}) => {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  })
  const encoded = query.toString()
  return encoded ? `?${encoded}` : ''
}

export const contactApi = {
  getMigrationStatus: () => api.fetch('/admin/contact/db/version'),
  migrate: () => api.fetch('/admin/contact/db/migrate', { method: 'POST' }),
  getStorageStatus: () => api.fetch('/admin/contact/storage/status'),
  repairStorage: (id) => api.fetch(`/admin/contact/storage/repair/${id}`, { method: 'POST' }),

  listDomains: () => api.fetch('/admin/contact/domains'),
  createDomain: (input) => api.fetch('/admin/contact/domains', {
    method: 'POST',
    body: jsonBody(input),
  }),
  updateDomain: (id, input) => api.fetch(`/admin/contact/domains/${id}`, {
    method: 'PATCH',
    body: jsonBody(input),
  }),
  disableDomain: (id) => api.fetch(`/admin/contact/domains/${id}`, { method: 'DELETE' }),

  listMailboxes: (domainId) => api.fetch(
    `/admin/contact/mailboxes${domainId ? `?domain_id=${domainId}` : ''}`
  ),
  createMailbox: (input) => api.fetch('/admin/contact/mailboxes', {
    method: 'POST',
    body: jsonBody(input),
  }),
  updateMailbox: (id, input) => api.fetch(`/admin/contact/mailboxes/${id}`, {
    method: 'PATCH',
    body: jsonBody(input),
  }),
  disableMailbox: (id) => api.fetch(`/admin/contact/mailboxes/${id}`, { method: 'DELETE' }),

  listProviders: () => api.fetch('/admin/contact/providers'),
  createProvider: (input) => api.fetch('/admin/contact/providers', { method: 'POST', body: jsonBody(input) }),
  updateProvider: (id, input) => api.fetch(`/admin/contact/providers/${id}`, { method: 'PATCH', body: jsonBody(input) }),
  disableProvider: (id) => api.fetch(`/admin/contact/providers/${id}`, { method: 'DELETE' }),

  getDnsChecks: (domainId) => api.fetch(`/admin/contact/domains/${domainId}/dns`),
  refreshDnsChecks: (domainId, input) => api.fetch(`/admin/contact/domains/${domainId}/dns/refresh`, {
    method: 'POST', body: jsonBody(input),
  }),
  getHealth: () => api.fetch('/admin/contact/health'),
  reconcileStaleSending: (olderThanMinutes = 15) => api.fetch('/admin/contact/operations/reconcile-stale', {
    method: 'POST', body: jsonBody({ older_than_minutes: olderThanMinutes }),
  }),

  getMessageCounts: () => api.fetch('/admin/contact/message-counts'),
  listMessages: (params) => api.fetch(`/admin/contact/messages${queryString(params)}`),
  getMessage: (id) => api.fetch(`/admin/contact/messages/${id}`),
  markRead: (id) => api.fetch(`/admin/contact/messages/${id}/read`, { method: 'POST' }),
  markUnread: (id) => api.fetch(`/admin/contact/messages/${id}/unread`, { method: 'POST' }),
  markSpam: (id) => api.fetch(`/admin/contact/messages/${id}/spam`, { method: 'POST' }),
  markNotSpam: (id) => api.fetch(`/admin/contact/messages/${id}/not-spam`, { method: 'POST' }),
  downloadRaw: (id) => api.fetch(`/admin/contact/messages/${id}/raw`, { responseType: 'blob' }),
  downloadAttachment: (id) => api.fetch(`/admin/contact/attachments/${id}`, { responseType: 'blob' }),

  listOutbound: (params) => api.fetch(`/admin/contact/outbound${queryString(params)}`),
  getOutbound: (id) => api.fetch(`/admin/contact/outbound/${id}`),
  sendOutbound: (input, idempotencyKey) => api.fetch('/admin/contact/outbound', {
    method: 'POST', body: jsonBody(input), idempotencyKey,
  }),
  replyToMessage: (id, input, idempotencyKey) => api.fetch(`/admin/contact/messages/${id}/reply`, {
    method: 'POST', body: jsonBody(input), idempotencyKey,
  }),
  retryOutbound: (id, input = {}) => api.fetch(`/admin/contact/outbound/${id}/retry`, {
    method: 'POST', body: jsonBody(input),
  }),
  forceResendOutbound: (id, idempotencyKey) => api.fetch(`/admin/contact/outbound/${id}/force-resend`, {
    method: 'POST', body: jsonBody({ confirm: true }), idempotencyKey,
  }),
}
