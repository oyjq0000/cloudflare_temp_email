<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { contactApi } from '../../api/contact'
import { useIsMobile } from '../../utils/composables'
import ContactMailHtml from './ContactMailHtml.vue'

const props = defineProps({
  domainId: { type: Number, default: null },
  folder: { type: String, default: 'inbox' },
  unreadOnly: { type: Boolean, default: false },
})
const emit = defineEmits(['counts'])
const { locale } = useI18n({ useScope: 'global' })
const isMobile = useIsMobile()
const notification = useMessage()
const domains = ref([])
const mailboxes = ref([])
const items = ref([])
const nextCursor = ref(null)
const selected = ref(null)
const loading = ref(false)
const detailLoading = ref(false)
const filters = ref({ domain_id: null, mailbox_id: null, from: '', to: '', subject: '', date_from: '', date_to: '' })

const copy = computed(() => locale.value === 'zh' ? {
  search: '筛选', reset: '重置', from: '发件人', to: '收件人', subject: '主题',
  domain: '全部 Domain', mailbox: '全部 Mailbox', dateFrom: '起始时间（ISO）', dateTo: '结束时间（ISO）',
  empty: '没有符合条件的邮件', more: '加载更多', noSubject: '（无主题）', raw: '下载原始邮件',
  read: '标为已读', unread: '标为未读', spam: '移入垃圾邮件', notSpam: '移出垃圾邮件',
  attachments: '附件', bodyUnavailable: '这封邮件没有可显示的正文。', close: '关闭',
} : {
  search: 'Filter', reset: 'Reset', from: 'From', to: 'To', subject: 'Subject',
  domain: 'All domains', mailbox: 'All mailboxes', dateFrom: 'From date (ISO)', dateTo: 'To date (ISO)',
  empty: 'No messages match these filters', more: 'Load more', noSubject: '(no subject)', raw: 'Download raw message',
  read: 'Mark read', unread: 'Mark unread', spam: 'Move to spam', notSpam: 'Not spam',
  attachments: 'Attachments', bodyUnavailable: 'This message has no displayable body.', close: 'Close',
})

const domainOptions = computed(() => [
  { label: copy.value.domain, value: null },
  ...domains.value.map(item => ({ label: `${item.name} (${item.domain})`, value: item.id })),
])
const mailboxOptions = computed(() => [
  { label: copy.value.mailbox, value: null },
  ...mailboxes.value
    .filter(item => !filters.value.domain_id || item.domain_id === filters.value.domain_id)
    .map(item => ({ label: item.address, value: item.id })),
])

const requestFilters = () => ({
  ...filters.value,
  folder: props.folder,
  is_read: props.unreadOnly ? false : undefined,
  limit: 20,
})

const load = async (reset = true) => {
  if (loading.value) return
  loading.value = true
  try {
    const response = await contactApi.listMessages({
      ...requestFilters(),
      cursor: reset ? undefined : nextCursor.value,
    })
    items.value = reset ? (response.results || []) : [...items.value, ...(response.results || [])]
    nextCursor.value = response.nextCursor
    emit('counts', response.counts || { inbox: 0, unread: 0, spam: 0 })
  } catch (error) {
    notification.error(error.message)
  } finally {
    loading.value = false
  }
}

const reset = () => {
  filters.value = { domain_id: props.domainId, mailbox_id: null, from: '', to: '', subject: '', date_from: '', date_to: '' }
  load(true)
}

const selectMessage = async (item) => {
  detailLoading.value = true
  try {
    selected.value = (await contactApi.getMessage(item.id)).result
    if (!selected.value.is_read) {
      selected.value = (await contactApi.markRead(item.id)).result
      item.is_read = true
      await load(true)
    }
  } catch (error) {
    notification.error(error.message)
  } finally {
    detailLoading.value = false
  }
}

const updateSelected = async (action) => {
  if (!selected.value) return
  try {
    selected.value = (await action(selected.value.id)).result
    await load(true)
  } catch (error) { notification.error(error.message) }
}

const saveBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

const downloadRaw = async () => {
  try { saveBlob(await contactApi.downloadRaw(selected.value.id), `message-${selected.value.id}.eml`) }
  catch (error) { notification.error(error.message) }
}
const downloadAttachment = async (attachment) => {
  try { saveBlob(await contactApi.downloadAttachment(attachment.id), attachment.filename || 'attachment') }
  catch (error) { notification.error(error.message) }
}

watch(() => filters.value.domain_id, () => {
  if (!mailboxOptions.value.some(item => item.value === filters.value.mailbox_id)) filters.value.mailbox_id = null
})
watch(() => [props.domainId, props.folder, props.unreadOnly], () => reset())

onMounted(async () => {
  try {
    const [domainResponse, mailboxResponse] = await Promise.all([contactApi.listDomains(), contactApi.listMailboxes()])
    domains.value = domainResponse.results || []
    mailboxes.value = mailboxResponse.results || []
    filters.value.domain_id = props.domainId
    await load(true)
  } catch (error) { notification.error(error.message) }
})
</script>

<template>
  <section class="contact-inbox">
    <n-card size="small" class="filters-card">
      <div class="filters">
        <n-select v-model:value="filters.domain_id" :options="domainOptions" />
        <n-select v-model:value="filters.mailbox_id" :options="mailboxOptions" />
        <n-input v-model:value="filters.from" :placeholder="copy.from" clearable />
        <n-input v-model:value="filters.to" :placeholder="copy.to" clearable />
        <n-input v-model:value="filters.subject" :placeholder="copy.subject" clearable />
        <n-input v-model:value="filters.date_from" :placeholder="copy.dateFrom" clearable />
        <n-input v-model:value="filters.date_to" :placeholder="copy.dateTo" clearable />
        <n-space><n-button type="primary" @click="load(true)">{{ copy.search }}</n-button><n-button @click="reset">{{ copy.reset }}</n-button></n-space>
      </div>
    </n-card>

    <div class="mail-workspace">
      <n-card class="message-list" :content-style="{ padding: 0 }">
        <n-spin :show="loading">
          <n-empty v-if="!items.length && !loading" :description="copy.empty" class="empty" />
          <button
            v-for="item in items" :key="item.id" type="button"
            class="message-row" :class="{ unread: !item.is_read, active: selected?.id === item.id }"
            @click="selectMessage(item)"
          >
            <span class="message-from">{{ item.from_name || item.from_address || '—' }}</span>
            <strong>{{ item.subject || copy.noSubject }}</strong>
            <span class="preview">{{ item.preview }}</span>
            <time>{{ new Date(item.received_at).toLocaleString() }}</time>
          </button>
          <n-button v-if="nextCursor" block text class="more" :loading="loading" @click="load(false)">{{ copy.more }}</n-button>
        </n-spin>
      </n-card>

      <n-card v-if="!isMobile" class="message-detail" :content-style="{ padding: '22px' }">
        <n-spin :show="detailLoading">
          <n-empty v-if="!selected" :description="copy.empty" />
          <article v-else>
            <header class="detail-header">
              <div><h2>{{ selected.subject || copy.noSubject }}</h2><p>{{ selected.from_name }} &lt;{{ selected.from_address }}&gt; → {{ selected.to_address }}</p></div>
              <n-space wrap>
                <n-button size="small" @click="updateSelected(selected.is_read ? contactApi.markUnread : contactApi.markRead)">{{ selected.is_read ? copy.unread : copy.read }}</n-button>
                <n-button size="small" @click="updateSelected(selected.folder === 'spam' ? contactApi.markNotSpam : contactApi.markSpam)">{{ selected.folder === 'spam' ? copy.notSpam : copy.spam }}</n-button>
                <n-button size="small" @click="downloadRaw">{{ copy.raw }}</n-button>
              </n-space>
            </header>
            <div v-if="selected.attachments?.length" class="attachments"><strong>{{ copy.attachments }}</strong><n-button v-for="attachment in selected.attachments" :key="attachment.id" size="tiny" @click="downloadAttachment(attachment)">{{ attachment.filename }} · {{ attachment.size }} B</n-button></div>
            <ContactMailHtml v-if="selected.html_body" :message-id="selected.id" :html="selected.html_body" />
            <pre v-else-if="selected.text_body" class="text-body">{{ selected.text_body }}</pre>
            <n-empty v-else :description="copy.bodyUnavailable" />
          </article>
        </n-spin>
      </n-card>
    </div>

    <n-drawer v-if="isMobile" :show="Boolean(selected)" width="100%" placement="right" @update:show="value => { if (!value) selected = null }">
      <n-drawer-content :title="selected?.subject || copy.noSubject" closable>
        <template v-if="selected">
          <p>{{ selected.from_name }} &lt;{{ selected.from_address }}&gt; → {{ selected.to_address }}</p>
          <n-space wrap class="mobile-actions">
            <n-button size="small" @click="updateSelected(selected.is_read ? contactApi.markUnread : contactApi.markRead)">{{ selected.is_read ? copy.unread : copy.read }}</n-button>
            <n-button size="small" @click="updateSelected(selected.folder === 'spam' ? contactApi.markNotSpam : contactApi.markSpam)">{{ selected.folder === 'spam' ? copy.notSpam : copy.spam }}</n-button>
            <n-button size="small" @click="downloadRaw">{{ copy.raw }}</n-button>
          </n-space>
          <div v-if="selected.attachments?.length" class="attachments"><strong>{{ copy.attachments }}</strong><n-button v-for="attachment in selected.attachments" :key="attachment.id" size="tiny" @click="downloadAttachment(attachment)">{{ attachment.filename }}</n-button></div>
          <ContactMailHtml v-if="selected.html_body" :message-id="selected.id" :html="selected.html_body" />
          <pre v-else class="text-body">{{ selected.text_body || copy.bodyUnavailable }}</pre>
        </template>
      </n-drawer-content>
    </n-drawer>
  </section>
</template>

<style scoped>
.contact-inbox { display: grid; gap: 14px; min-width: 0; }
.filters { display: grid; grid-template-columns: repeat(4, minmax(130px, 1fr)); gap: 10px; }
.mail-workspace { display: grid; grid-template-columns: minmax(280px, 36%) minmax(0, 1fr); gap: 14px; min-height: 600px; }
.message-list { overflow: hidden; }
.message-row { width: 100%; display: grid; grid-template-columns: minmax(90px, .7fr) minmax(140px, 1fr) minmax(120px, 1.2fr) auto; gap: 10px; padding: 13px 16px; border: 0; border-bottom: 1px solid rgba(128,128,128,.18); background: transparent; color: inherit; text-align: left; cursor: pointer; }
.message-row:hover, .message-row.active { background: rgba(48, 103, 246, .08); }
.message-row.unread strong, .message-row.unread .message-from { font-weight: 750; }
.message-row:not(.unread) { opacity: .76; }
.message-row span, .message-row strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.message-row time { font-size: 12px; color: #778095; }
.empty { padding: 100px 20px; }
.more { margin: 12px 0; }
.message-detail { min-width: 0; }
.detail-header { display: flex; justify-content: space-between; gap: 18px; border-bottom: 1px solid rgba(128,128,128,.2); margin-bottom: 20px; padding-bottom: 16px; }
.detail-header h2 { margin: 0 0 8px; overflow-wrap: anywhere; }
.detail-header p { color: #778095; overflow-wrap: anywhere; }
.attachments { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 16px; }
.text-body { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
.mobile-actions { margin-bottom: 16px; }
@media (max-width: 1100px) { .filters { grid-template-columns: repeat(2, minmax(130px, 1fr)); } .message-row { grid-template-columns: minmax(90px, 1fr) minmax(120px, 1fr); } .message-row .preview { display: none; } }
@media (max-width: 760px) { .filters { grid-template-columns: 1fr; } .mail-workspace { grid-template-columns: 1fr; min-height: auto; } .message-row { grid-template-columns: minmax(90px, 1fr) auto; } .message-row strong { grid-column: 1 / -1; } }
</style>
