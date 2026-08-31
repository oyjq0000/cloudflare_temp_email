<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { contactApi } from '../../api/contact'
import ContactMailHtml from './ContactMailHtml.vue'

const props = defineProps({ status: { type: String, default: 'sent' } })
const emit = defineEmits(['counts'])
const { locale } = useI18n({ useScope: 'global' })
const notification = useMessage()
const rows = ref([])
const selected = ref(null)
const nextCursor = ref(null)
const loading = ref(false)
const copy = computed(() => locale.value === 'zh' ? {
  empty: '没有出站记录', more: '加载更多', retry: '人工 Retry', force: 'Force Resend',
  confirm: '结果未知，强制重发可能造成重复邮件。确认创建新的发送记录？', attempts: '发送 Attempts',
} : {
  empty: 'No outbound records', more: 'Load more', retry: 'Manual retry', force: 'Force resend',
  confirm: 'The result is unknown. Force resend may duplicate delivery. Create a new send intent?', attempts: 'Delivery attempts',
})

const load = async (reset = true) => {
  loading.value = true
  try {
    const response = await contactApi.listOutbound({
      status: props.status, limit: 20, cursor: reset ? undefined : nextCursor.value,
    })
    rows.value = reset ? response.results || [] : [...rows.value, ...(response.results || [])]
    nextCursor.value = response.nextCursor
    emit('counts', response.counts)
  } catch (error) { notification.error(error.message) }
  finally { loading.value = false }
}
const open = async (row) => {
  try { selected.value = (await contactApi.getOutbound(row.id)).result }
  catch (error) { notification.error(error.message) }
}
const retry = async () => {
  try { selected.value = (await contactApi.retryOutbound(selected.value.id)).outbound; await load(true) }
  catch (error) { notification.error(error.message) }
}
const force = async () => {
  if (!window.confirm(copy.value.confirm)) return
  try {
    selected.value = (await contactApi.forceResendOutbound(selected.value.id, crypto.randomUUID())).outbound
    await load(true)
  } catch (error) { notification.error(error.message) }
}

watch(() => props.status, () => { selected.value = null; load(true) })
onMounted(() => load(true))
</script>

<template>
  <div class="sent-workspace">
    <n-card :content-style="{ padding: 0 }">
      <n-spin :show="loading">
        <n-empty v-if="!rows.length && !loading" :description="copy.empty" class="empty" />
        <button v-for="row in rows" :key="row.id" class="sent-row" :class="{ active: selected?.id === row.id }" @click="open(row)">
          <strong>{{ row.subject }}</strong><span>{{ row.to_address }}</span><n-tag size="small" :type="row.status === 'sent' ? 'success' : row.status === 'failed' ? 'error' : 'warning'">{{ row.status }}</n-tag><time>{{ new Date(row.created_at).toLocaleString() }}</time>
        </button>
        <n-button v-if="nextCursor" block text @click="load(false)">{{ copy.more }}</n-button>
      </n-spin>
    </n-card>
    <n-card v-if="selected">
      <h2>{{ selected.subject }}</h2>
      <p>{{ selected.from_address }} → {{ selected.to_address }}</p>
      <n-space v-if="selected.status === 'failed' || selected.status === 'unknown'">
        <n-button v-if="selected.status === 'failed'" type="warning" @click="retry">{{ copy.retry }}</n-button>
        <n-button v-if="selected.status === 'unknown'" type="error" @click="force">{{ copy.force }}</n-button>
      </n-space>
      <ContactMailHtml v-if="selected.html_body" :message-id="selected.id" :html="selected.html_body" />
      <pre v-else>{{ selected.text_body }}</pre>
      <h3>{{ copy.attempts }}</h3>
      <n-timeline><n-timeline-item v-for="attempt in selected.attempts" :key="attempt.id" :type="attempt.status === 'sent' ? 'success' : attempt.status === 'failed' ? 'error' : 'warning'" :title="`${attempt.provider_type} · ${attempt.status}`" :content="attempt.error_message || attempt.provider_message_id || ''" :time="attempt.finished_at || attempt.started_at" /></n-timeline>
    </n-card>
  </div>
</template>

<style scoped>
.sent-workspace { display: grid; grid-template-columns: minmax(300px, 40%) minmax(0, 1fr); gap: 14px; }
.sent-row { width: 100%; display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; padding: 14px; border: 0; border-bottom: 1px solid rgba(128,128,128,.18); background: transparent; color: inherit; text-align: left; cursor: pointer; }
.sent-row:hover, .sent-row.active { background: rgba(48,103,246,.08); }
.sent-row time { grid-column: 1 / -1; color: #778095; font-size: 12px; }
.empty { padding: 80px 20px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 760px) { .sent-workspace { grid-template-columns: 1fr; } }
</style>
