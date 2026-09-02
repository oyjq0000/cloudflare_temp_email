<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { contactApi } from '../../api/contact'

const { locale } = useI18n({ useScope: 'global' })
const notification = useMessage()
const loading = ref(false)
const providers = ref([])
const showEditor = ref(false)
const editingId = ref(null)
const emptyForm = () => ({
  name: '', provider_type: 'smtp', enabled: true,
  host: 'mailpit', port: 1025, secure: false, starttls: false, username: '', secret_reference: '',
})
const form = ref(emptyForm())
const editing = computed(() => editingId.value !== null)
const copy = computed(() => locale.value === 'zh' ? {
  title: 'Provider 配置', add: '新增 Provider', edit: '编辑', name: '名称', type: '类型', enabled: '启用',
  host: 'SMTP Host', port: '端口', secure: 'TLS', starttls: 'STARTTLS', username: '用户名',
  secretRef: 'Secret Reference', configured: 'Secret 已配置', missing: 'Secret 未配置',
  create: '创建', save: '保存', cancel: '取消', disable: '停用', enable: '重新启用', empty: '还没有 Provider Config',
  created: 'Provider 已创建', updated: 'Provider 已更新', refHint: '只保存 CONTACT_* 引用，不保存 Secret 值；编辑时留空表示保留现有引用',
  inUse: '已被 Domain 使用', inUseHint: '该 Provider 正被 Domain 使用，先解绑后才能停用',
} : {
  title: 'Provider configs', add: 'Add provider', edit: 'Edit', name: 'Name', type: 'Type', enabled: 'Enabled',
  host: 'SMTP host', port: 'Port', secure: 'TLS', starttls: 'STARTTLS', username: 'Username',
  secretRef: 'Secret reference', configured: 'Secret configured', missing: 'Secret missing',
  create: 'Create', save: 'Save', cancel: 'Cancel', disable: 'Disable', enable: 'Re-enable', empty: 'No Provider Configs yet',
  created: 'Provider created', updated: 'Provider updated', refHint: 'Stores a CONTACT_* reference only, never a secret value; leave blank while editing to keep the current reference',
  inUse: 'Used by domains', inUseHint: 'This provider is assigned to a Domain. Unassign it before disabling.',
})
const typeOptions = [
  { label: 'SMTP', value: 'smtp' }, { label: 'Resend', value: 'resend' }, { label: 'Brevo', value: 'brevo' },
]

const load = async () => {
  loading.value = true
  try { providers.value = (await contactApi.listProviders()).results || [] }
  catch (error) { notification.error(error.message) }
  finally { loading.value = false }
}

const openCreate = () => {
  editingId.value = null
  form.value = emptyForm()
  showEditor.value = true
}

const openEdit = (provider) => {
  editingId.value = provider.id
  form.value = {
    name: provider.name,
    provider_type: provider.provider_type,
    enabled: provider.enabled,
    host: provider.config?.host || '',
    port: provider.config?.port || 1025,
    secure: provider.config?.secure === true,
    starttls: provider.config?.starttls !== false,
    username: provider.config?.username || '',
    secret_reference: '',
  }
  showEditor.value = true
}

const payload = () => {
  const smtp = form.value.provider_type === 'smtp'
  const secretKey = smtp ? 'password' : 'apiKey'
  return {
    name: form.value.name,
    ...(editing.value ? {} : { provider_type: form.value.provider_type }),
    enabled: form.value.enabled,
    config: smtp ? {
      host: form.value.host, port: form.value.port, secure: form.value.secure,
      starttls: form.value.starttls, ...(form.value.username ? { username: form.value.username } : {}),
    } : {},
    ...(form.value.secret_reference ? { secret_refs: { [secretKey]: form.value.secret_reference } } : {}),
  }
}

const save = async () => {
  try {
    if (editing.value) await contactApi.updateProvider(editingId.value, payload())
    else await contactApi.createProvider(payload())
    showEditor.value = false
    notification.success(editing.value ? copy.value.updated : copy.value.created)
    await load()
  } catch (error) { notification.error(error.message) }
}

const disable = async (provider) => {
  try {
    await contactApi.disableProvider(provider.id)
    notification.success(copy.value.updated)
    await load()
  } catch (error) { notification.error(error.message) }
}
const enable = async (provider) => {
  try {
    await contactApi.updateProvider(provider.id, { enabled: true })
    notification.success(copy.value.updated)
    await load()
  } catch (error) { notification.error(error.message) }
}

onMounted(load)
</script>

<template>
  <n-card :title="copy.title" :segmented="{ content: true }">
    <template #header-extra><n-button type="primary" @click="openCreate">{{ copy.add }}</n-button></template>
    <n-spin :show="loading">
      <n-empty v-if="!providers.length" :description="copy.empty" />
      <div v-else class="provider-list">
        <div v-for="provider in providers" :key="provider.id" class="provider-row">
          <div><strong>{{ provider.name }}</strong><n-text depth="3">{{ provider.provider_type.toUpperCase() }}</n-text></div>
          <n-space align="center" wrap>
            <n-tag :type="Object.values(provider.secrets || {}).every(Boolean) ? 'success' : 'warning'">
              {{ Object.values(provider.secrets || {}).every(Boolean) ? copy.configured : copy.missing }}
            </n-tag>
            <n-tag v-if="provider.in_use" type="info">{{ copy.inUse }}: {{ provider.in_use_domain_count }}</n-tag>
            <n-button size="small" @click="openEdit(provider)">{{ copy.edit }}</n-button>
            <n-button v-if="!provider.enabled" size="small" type="primary" secondary @click="enable(provider)">{{ copy.enable }}</n-button>
            <n-button
              v-else size="small" tertiary type="warning" :disabled="provider.in_use"
              :title="provider.in_use ? copy.inUseHint : copy.disable" @click="disable(provider)"
            >{{ copy.disable }}</n-button>
          </n-space>
        </div>
      </div>
    </n-spin>
  </n-card>

  <n-modal v-model:show="showEditor" preset="card" :title="editing ? copy.edit : copy.add" class="contact-modal">
    <n-form label-placement="top" @submit.prevent="save">
      <n-form-item :label="copy.name" required><n-input v-model:value="form.name" /></n-form-item>
      <n-form-item :label="copy.type" required><n-select v-model:value="form.provider_type" :disabled="editing" :options="typeOptions" /></n-form-item>
      <template v-if="form.provider_type === 'smtp'">
        <n-form-item :label="copy.host" required><n-input v-model:value="form.host" /></n-form-item>
        <n-form-item :label="copy.port" required><n-input-number v-model:value="form.port" :min="1" :max="65535" /></n-form-item>
        <n-space><label>{{ copy.secure }} <n-switch v-model:value="form.secure" /></label><label>{{ copy.starttls }} <n-switch v-model:value="form.starttls" /></label></n-space>
        <n-form-item :label="copy.username"><n-input v-model:value="form.username" /></n-form-item>
      </template>
      <n-form-item :label="copy.secretRef" :required="!editing && (form.provider_type !== 'smtp' || Boolean(form.username))">
        <n-input v-model:value="form.secret_reference" placeholder="CONTACT_PROVIDER_MAIN_SECRET" />
        <n-text depth="3" class="hint">{{ copy.refHint }}</n-text>
      </n-form-item>
      <n-form-item :label="copy.enabled"><n-switch v-model:value="form.enabled" /></n-form-item>
      <n-space justify="end"><n-button @click="showEditor = false">{{ copy.cancel }}</n-button><n-button type="primary" attr-type="submit">{{ editing ? copy.save : copy.create }}</n-button></n-space>
    </n-form>
  </n-modal>
</template>

<style scoped>
.provider-list { display: grid; gap: 10px; }
.provider-row { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 14px 0; border-bottom: 1px solid rgba(128,128,128,.18); }
.provider-row > div:first-child { display: grid; gap: 3px; }
.hint { display: block; margin-top: 6px; }
label { display: inline-flex; align-items: center; gap: 8px; }
:global(.contact-modal) { width: min(560px, calc(100vw - 32px)); }
@media (max-width: 760px) { .provider-row { align-items: flex-start; flex-direction: column; } }
</style>
