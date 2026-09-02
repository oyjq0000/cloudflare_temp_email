<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { contactApi } from '../../api/contact'

const props = defineProps({ domains: { type: Array, default: () => [] } })
const { locale } = useI18n({ useScope: 'global' })
const health = ref(null)
const selectedDomainId = ref(null)
const selector = ref('default')
const dns = ref(null)
const loading = ref(false)
const reconciling = ref(false)

const copy = computed(() => locale.value === 'zh' ? {
  title: '运行健康与 DNS', refresh: '刷新 DNS', selector: 'DKIM Selector（必填）',
  reconcile: '调和超时发送', noChecks: '尚未检查。选择域名并填写明确的 DKIM selector。',
  db: '数据库', storage: '私有存储', security: '管理员安全', stale: '超时 Sending', readiness: '生产就绪', effects: '副作用失败', defaults: '默认 Mailbox 异常',
  confirm: '把 15 分钟前仍处于 sending 的记录标记为 unknown？系统不会自动重发。',
} : {
  title: 'Operations health & DNS', refresh: 'Refresh DNS', selector: 'DKIM selector (required)',
  reconcile: 'Reconcile stale sends', noChecks: 'No checks yet. Select a Domain and provide an explicit DKIM selector.',
  db: 'Database', storage: 'Private storage', security: 'Admin security', stale: 'Stale sending', readiness: 'Production ready', effects: 'Side-effect failures', defaults: 'Default mailbox errors',
  confirm: 'Mark sends still running after 15 minutes as unknown? They will not be retried automatically.',
})

const statusType = (status) => ({ valid: 'success', missing: 'warning', invalid: 'error', unknown: 'default' }[status] || 'default')

const loadHealth = async () => { health.value = await contactApi.getHealth() }
const loadDns = async () => {
  if (!selectedDomainId.value) return
  dns.value = await contactApi.getDnsChecks(selectedDomainId.value)
}
const refreshDns = async () => {
  if (!selectedDomainId.value || !selector.value.trim()) return
  loading.value = true
  try {
    dns.value = await contactApi.refreshDnsChecks(selectedDomainId.value, {
      dkim_selector: selector.value.trim(), expected: { mx: [], spf: [], dkim: [], dmarc: [] },
    })
    await loadHealth()
  } finally { loading.value = false }
}
const reconcile = async () => {
  if (!window.confirm(copy.value.confirm)) return
  reconciling.value = true
  try { await contactApi.reconcileStaleSending(15); await loadHealth() }
  finally { reconciling.value = false }
}

watch(() => props.domains, (domains) => {
  if (!selectedDomainId.value && domains.length) selectedDomainId.value = domains[0].id
}, { immediate: true })
watch(selectedDomainId, loadDns)
onMounted(async () => { await Promise.all([loadHealth(), loadDns()]) })
</script>

<template>
  <div class="operations">
    <n-card :title="copy.title">
      <div v-if="health" class="health-grid">
        <n-statistic :label="copy.db" :value="health.database?.healthy ? 'Healthy' : 'Unavailable'" />
        <n-statistic :label="copy.storage" :value="health.storage?.bindingAvailable ? 'R2' : 'D1 fallback'" />
        <n-statistic :label="copy.security" :value="health.adminSecurity?.code || 'Unknown'" />
        <n-statistic :label="copy.stale" :value="health.counts?.staleSending || 0" />
        <n-statistic :label="copy.readiness" :value="health.productionReady ? 'Ready' : 'Not ready'" />
        <n-statistic :label="copy.effects" :value="health.counts?.sideEffectFailed || 0" />
        <n-statistic :label="copy.defaults" :value="(health.counts?.invalidDefaultMailboxCount || 0) + (health.counts?.multipleDefaultMailboxCount || 0) + (health.counts?.danglingDefaultMailboxCount || 0)" />
      </div>
      <template #footer>
        <n-button type="warning" secondary :loading="reconciling" @click="reconcile">{{ copy.reconcile }}</n-button>
      </template>
    </n-card>

    <n-card title="MX / SPF / DKIM / DMARC">
      <n-space vertical>
        <n-select
          v-model:value="selectedDomainId"
          :options="domains.map(domain => ({ label: `${domain.name} — ${domain.domain}`, value: domain.id }))"
        />
        <n-input v-model:value="selector" :placeholder="copy.selector" />
        <n-button type="primary" :loading="loading" :disabled="!selectedDomainId || !selector.trim()" @click="refreshDns">
          {{ copy.refresh }}
        </n-button>
      </n-space>
      <n-empty v-if="!dns?.checks?.length" :description="copy.noChecks" class="empty" />
      <n-list v-else bordered class="dns-list">
        <n-list-item v-for="check in dns.checks" :key="check.purpose">
          <template #prefix><n-tag :type="statusType(check.status)">{{ check.status }}</n-tag></template>
          <n-thing :title="check.purpose.toUpperCase()" :description="`${check.recordType} ${check.recordName}`">
            <n-text depth="3">{{ check.code }} · {{ check.observed.join(' · ') || '—' }}</n-text>
          </n-thing>
          <template #suffix><n-tag v-if="check.stale" type="warning">stale</n-tag></template>
        </n-list-item>
      </n-list>
    </n-card>
  </div>
</template>

<style scoped>
.operations { display: grid; gap: 16px; }
.health-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.dns-list, .empty { margin-top: 18px; }
@media (max-width: 760px) { .health-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
