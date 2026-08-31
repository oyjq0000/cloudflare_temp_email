<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { contactApi } from '../../api/contact'

const emit = defineEmits(['changed'])
const { locale } = useI18n({ useScope: 'global' })
const message = useMessage()
const loading = ref(false)
const domains = ref([])
const providers = ref([])
const showCreate = ref(false)
const form = ref({ domain: '', name: '', create_default_mailbox: true })

const copy = computed(() => locale.value === 'zh' ? {
  title: 'Domain 管理', add: '新增 Domain', domain: '域名', name: '显示名称',
  enabled: '启用', inbound: '入站', defaultMailbox: '默认 Mailbox', mailboxes: '邮箱数',
  create: '创建', cancel: '取消', disable: '停用', empty: '还没有 Contact Domain',
  provider: '默认出站 Provider', noProvider: '未绑定（禁止出站）',
  created: 'Domain 已创建', updated: 'Domain 已更新', required: '请输入域名',
} : {
  title: 'Domains', add: 'Add domain', domain: 'Domain', name: 'Display name',
  enabled: 'Enabled', inbound: 'Inbound', defaultMailbox: 'Default mailbox', mailboxes: 'Mailboxes',
  create: 'Create', cancel: 'Cancel', disable: 'Disable', empty: 'No Contact Domains yet',
  provider: 'Default outbound provider', noProvider: 'Unassigned (outbound disabled)',
  created: 'Domain created', updated: 'Domain updated', required: 'Enter a domain',
})

const providerOptions = computed(() => [
  { label: copy.value.noProvider, value: null },
  ...providers.value.filter(item => item.enabled).map(item => ({
    label: `${item.name} · ${item.provider_type.toUpperCase()}`, value: item.id,
  })),
])

const load = async () => {
  loading.value = true
  try {
    const [domainResult, providerResult] = await Promise.all([
      contactApi.listDomains(), contactApi.listProviders(),
    ])
    domains.value = domainResult.results || []
    providers.value = providerResult.results || []
  } catch (error) {
    message.error(error.message)
  } finally {
    loading.value = false
  }
}

const create = async () => {
  if (!form.value.domain.trim()) return message.warning(copy.value.required)
  loading.value = true
  try {
    await contactApi.createDomain({
      ...form.value,
      name: form.value.name.trim() || undefined,
    })
    form.value = { domain: '', name: '', create_default_mailbox: true }
    showCreate.value = false
    message.success(copy.value.created)
    await load()
    emit('changed')
  } catch (error) {
    message.error(error.message)
  } finally {
    loading.value = false
  }
}

const update = async (domain, patch) => {
  try {
    await contactApi.updateDomain(domain.id, patch)
    message.success(copy.value.updated)
    await load()
    emit('changed')
  } catch (error) {
    message.error(error.message)
    await load()
  }
}

const disable = async (domain) => update(domain, { enabled: false, inbound_enabled: false })

onMounted(load)
</script>

<template>
  <n-card :title="copy.title" :segmented="{ content: true }">
    <template #header-extra>
      <n-button type="primary" @click="showCreate = true">{{ copy.add }}</n-button>
    </template>
    <n-spin :show="loading">
      <n-empty v-if="!domains.length" :description="copy.empty" />
      <div v-else class="domain-list">
        <div v-for="domain in domains" :key="domain.id" class="domain-row">
          <div class="domain-identity">
            <strong>{{ domain.name }}</strong>
            <n-text depth="3">{{ domain.domain }}</n-text>
          </div>
          <n-space align="center" wrap>
            <n-tag>{{ copy.mailboxes }}: {{ domain.mailbox_count }}</n-tag>
            <n-select
              class="provider-select" :value="domain.default_provider_config_id"
              :options="providerOptions" :placeholder="copy.provider"
              @update:value="value => update(domain, { default_provider_config_id: value })"
            />
            <label><span>{{ copy.enabled }}</span><n-switch :value="domain.enabled" @update:value="value => update(domain, { enabled: value })" /></label>
            <label><span>{{ copy.inbound }}</span><n-switch :value="domain.inbound_enabled" @update:value="value => update(domain, { inbound_enabled: value })" /></label>
            <n-button size="small" tertiary type="warning" :disabled="!domain.enabled" @click="disable(domain)">{{ copy.disable }}</n-button>
          </n-space>
        </div>
      </div>
    </n-spin>
  </n-card>

  <n-modal v-model:show="showCreate" preset="card" :title="copy.add" class="contact-modal">
    <n-form label-placement="top" @submit.prevent="create">
      <n-form-item :label="copy.domain" required><n-input v-model:value="form.domain" placeholder="example.com" /></n-form-item>
      <n-form-item :label="copy.name"><n-input v-model:value="form.name" /></n-form-item>
      <n-form-item :label="copy.defaultMailbox">
        <n-switch v-model:value="form.create_default_mailbox" />
        <n-text depth="3" class="mailbox-hint">contact@{{ form.domain || 'example.com' }}</n-text>
      </n-form-item>
      <n-space justify="end">
        <n-button @click="showCreate = false">{{ copy.cancel }}</n-button>
        <n-button type="primary" attr-type="submit" :loading="loading">{{ copy.create }}</n-button>
      </n-space>
    </n-form>
  </n-modal>
</template>

<style scoped>
.domain-list { display: grid; gap: 10px; }
.domain-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 14px 0; border-bottom: 1px solid rgba(128, 128, 128, .18); }
.domain-row:last-child { border-bottom: 0; }
.domain-identity { display: grid; min-width: 180px; }
label { display: inline-flex; align-items: center; gap: 8px; }
.mailbox-hint { margin-left: 10px; }
.provider-select { width: min(260px, 75vw); }
:global(.contact-modal) { width: min(560px, calc(100vw - 32px)); }
@media (max-width: 760px) { .domain-row { align-items: flex-start; flex-direction: column; } }
</style>
