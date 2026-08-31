import { api } from './index'

const jsonBody = (body) => JSON.stringify(body)

export const contactApi = {
  getMigrationStatus: () => api.fetch('/admin/contact/db/version'),
  migrate: () => api.fetch('/admin/contact/db/migrate', { method: 'POST' }),

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
}
