<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { contactApi } from '../../api/contact'

const { locale } = useI18n({ useScope: 'global' })
const message = useMessage()
const loading = ref(false)
const domains = ref([])
const mailboxes = ref([])
const showCreate = ref(false)
const form = ref({ domain_id: null, local_part: '', display_name: '', is_default: false })

const copy = computed(() => locale.value === 'zh' ? {
  title: 'Mailbox 管理', add: '新增 Mailbox', mailbox: '邮箱', domain: 'Domain',
  localPart: '邮箱前缀', displayName: '发件人名称', enabled: '启用', inbound: '入站',
  outbound: '出站', default: '默认', setDefault: '设为默认', disable: '停用',
  create: '创建', cancel: '取消', empty: '还没有固定 Mailbox', created: 'Mailbox 已创建',
  updated: 'Mailbox 已更新', required: '请选择 Domain 并输入邮箱前缀',
} : {
  title: 'Mailboxes', add: 'Add mailbox', mailbox: 'Mailbox', domain: 'Domain',
  localPart: 'Local part', displayName: 'From name', enabled: 'Enabled', inbound: 'Inbound',
  outbound: 'Outbound', default: 'Default', setDefault: 'Make default', disable: 'Disable',
  create: 'Create', cancel: 'Cancel', empty: 'No fixed Mailboxes yet', created: 'Mailbox created',
  updated: 'Mailbox updated', required: 'Choose a Domain and enter a local part',
})

const domainOptions = computed(() => domains.value.map(domain => ({
  label: `${domain.name} (${domain.domain})`, value: domain.id,
})))
const selectedDomain = computed(() => domains.value.find(domain => domain.id === form.value.domain_id))

const load = async () => {
  loading.value = true
  try {
    const [domainResult, mailboxResult] = await Promise.all([
      contactApi.listDomains(), contactApi.listMailboxes(),
    ])
    domains.value = domainResult.results || []
    mailboxes.value = mailboxResult.results || []
  } catch (error) {
    message.error(error.message)
  } finally {
    loading.value = false
  }
}

const openCreate = () => {
  form.value = {
    domain_id: domains.value.find(domain => domain.enabled)?.id || null,
    local_part: '', display_name: '', is_default: false,
  }
  showCreate.value = true
}

const create = async () => {
  if (!form.value.domain_id || !form.value.local_part.trim()) return message.warning(copy.value.required)
  loading.value = true
  try {
    await contactApi.createMailbox({
      ...form.value,
      display_name: form.value.display_name.trim() || undefined,
    })
    showCreate.value = false
    message.success(copy.value.created)
    await load()
  } catch (error) {
    message.error(error.message)
  } finally {
    loading.value = false
  }
}

const update = async (mailbox, patch) => {
  try {
    await contactApi.updateMailbox(mailbox.id, patch)
    message.success(copy.value.updated)
    await load()
  } catch (error) {
    message.error(error.message)
    await load()
  }
}

const disable = async (mailbox) => {
  try {
    await contactApi.disableMailbox(mailbox.id)
    message.success(copy.value.updated)
    await load()
  } catch (error) {
    message.error(error.message)
  }
}

onMounted(load)
defineExpose({ load })
</script>

<template>
  <n-card :title="copy.title" :segmented="{ content: true }">
    <template #header-extra><n-button type="primary" :disabled="!domains.length" @click="openCreate">{{ copy.add }}</n-button></template>
    <n-spin :show="loading">
      <n-empty v-if="!mailboxes.length" :description="copy.empty" />
      <div v-else class="mailbox-list">
        <div v-for="mailbox in mailboxes" :key="mailbox.id" class="mailbox-row">
          <div class="mailbox-identity">
            <strong>{{ mailbox.address }}</strong>
            <n-text depth="3">{{ mailbox.display_name || mailbox.domain_name }}</n-text>
          </div>
          <n-space align="center" wrap>
            <n-tag v-if="mailbox.is_default" type="success">{{ copy.default }}</n-tag>
            <label><span>{{ copy.enabled }}</span><n-switch :value="mailbox.enabled" :disabled="mailbox.is_default" @update:value="value => update(mailbox, { enabled: value })" /></label>
            <label><span>{{ copy.inbound }}</span><n-switch :value="mailbox.inbound_enabled" @update:value="value => update(mailbox, { inbound_enabled: value })" /></label>
            <label><span>{{ copy.outbound }}</span><n-switch :value="mailbox.outbound_enabled" :disabled="mailbox.is_default" @update:value="value => update(mailbox, { outbound_enabled: value })" /></label>
            <n-button v-if="!mailbox.is_default && mailbox.enabled && mailbox.outbound_enabled" size="small" @click="update(mailbox, { is_default: true })">{{ copy.setDefault }}</n-button>
            <n-button v-if="!mailbox.is_default" size="small" tertiary type="warning" @click="disable(mailbox)">{{ copy.disable }}</n-button>
          </n-space>
        </div>
      </div>
    </n-spin>
  </n-card>

  <n-modal v-model:show="showCreate" preset="card" :title="copy.add" class="contact-modal">
    <n-form label-placement="top" @submit.prevent="create">
      <n-form-item :label="copy.domain" required><n-select v-model:value="form.domain_id" :options="domainOptions" /></n-form-item>
      <n-form-item :label="copy.localPart" required>
        <n-input-group>
          <n-input v-model:value="form.local_part" placeholder="support" />
          <n-input-group-label>@{{ selectedDomain?.domain || 'domain' }}</n-input-group-label>
        </n-input-group>
      </n-form-item>
      <n-form-item :label="copy.displayName"><n-input v-model:value="form.display_name" /></n-form-item>
      <n-form-item :label="copy.default"><n-switch v-model:value="form.is_default" /></n-form-item>
      <n-space justify="end">
        <n-button @click="showCreate = false">{{ copy.cancel }}</n-button>
        <n-button type="primary" attr-type="submit" :loading="loading">{{ copy.create }}</n-button>
      </n-space>
    </n-form>
  </n-modal>
</template>

<style scoped>
.mailbox-list { display: grid; gap: 10px; }
.mailbox-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 14px 0; border-bottom: 1px solid rgba(128, 128, 128, .18); }
.mailbox-row:last-child { border-bottom: 0; }
.mailbox-identity { display: grid; min-width: 220px; }
label { display: inline-flex; align-items: center; gap: 8px; }
:global(.contact-modal) { width: min(560px, calc(100vw - 32px)); }
@media (max-width: 860px) { .mailbox-row { align-items: flex-start; flex-direction: column; } }
</style>
