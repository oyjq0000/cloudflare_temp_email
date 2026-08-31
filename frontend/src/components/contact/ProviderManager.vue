<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { contactApi } from '../../api/contact'

const { locale } = useI18n({ useScope: 'global' })
const notification = useMessage()
const loading = ref(false)
const providers = ref([])
const showCreate = ref(false)
const emptyForm = () => ({
  name: '', provider_type: 'smtp', enabled: true,
  host: 'mailpit', port: 1025, secure: false, starttls: false, username: '', secret_reference: '',
})
const form = ref(emptyForm())
const copy = computed(() => locale.value === 'zh' ? {
  title: 'Provider 配置', add: '新增 Provider', name: '名称', type: '类型', enabled: '启用',
  host: 'SMTP Host', port: '端口', secure: 'TLS', starttls: 'STARTTLS', username: '用户名',
  secretRef: 'Secret Reference', configured: 'Secret 已配置', missing: 'Secret 未配置',
  create: '创建', cancel: '取消', disable: '停用', empty: '还没有 Provider Config',
  created: 'Provider 已创建', updated: 'Provider 已更新', refHint: '只保存 CONTACT_* 引用，不保存 Secret 值',
} : {
  title: 'Provider configs', add: 'Add provider', name: 'Name', type: 'Type', enabled: 'Enabled',
  host: 'SMTP host', port: 'Port', secure: 'TLS', starttls: 'STARTTLS', username: 'Username',
  secretRef: 'Secret reference', configured: 'Secret configured', missing: 'Secret missing',
  create: 'Create', cancel: 'Cancel', disable: 'Disable', empty: 'No Provider Configs yet',
  created: 'Provider created', updated: 'Provider updated', refHint: 'Stores a CONTACT_* reference only, never a secret value',
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

const create = async () => {
  const smtp = form.value.provider_type === 'smtp'
  const secretKey = smtp ? 'password' : 'apiKey'
  try {
    await contactApi.createProvider({
      name: form.value.name,
      provider_type: form.value.provider_type,
      enabled: form.value.enabled,
      config: smtp ? {
        host: form.value.host, port: form.value.port, secure: form.value.secure,
        starttls: form.value.starttls, ...(form.value.username ? { username: form.value.username } : {}),
      } : {},
      secret_refs: form.value.secret_reference ? { [secretKey]: form.value.secret_reference } : {},
    })
    form.value = emptyForm()
    showCreate.value = false
    notification.success(copy.value.created)
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

onMounted(load)
</script>

<template>
  <n-card :title="copy.title" :segmented="{ content: true }">
    <template #header-extra><n-button type="primary" @click="showCreate = true">{{ copy.add }}</n-button></template>
    <n-spin :show="loading">
      <n-empty v-if="!providers.length" :description="copy.empty" />
      <div v-else class="provider-list">
        <div v-for="provider in providers" :key="provider.id" class="provider-row">
          <div><strong>{{ provider.name }}</strong><n-text depth="3">{{ provider.provider_type.toUpperCase() }}</n-text></div>
          <n-space align="center">
            <n-tag
              :type="Object.values(provider.secrets || {}).every(Boolean) ? 'success' : 'warning'"
            >{{ Object.values(provider.secrets || {}).every(Boolean) ? copy.configured : copy.missing }}</n-tag>
            <n-tag v-if="!provider.enabled">{{ copy.disable }}</n-tag>
            <n-button v-else size="small" tertiary type="warning" @click="disable(provider)">{{ copy.disable }}</n-button>
          </n-space>
        </div>
      </div>
    </n-spin>
  </n-card>

  <n-modal v-model:show="showCreate" preset="card" :title="copy.add" class="contact-modal">
    <n-form label-placement="top" @submit.prevent="create">
      <n-form-item :label="copy.name" required><n-input v-model:value="form.name" /></n-form-item>
      <n-form-item :label="copy.type" required><n-select v-model:value="form.provider_type" :options="typeOptions" /></n-form-item>
      <template v-if="form.provider_type === 'smtp'">
        <n-form-item :label="copy.host" required><n-input v-model:value="form.host" /></n-form-item>
        <n-form-item :label="copy.port" required><n-input-number v-model:value="form.port" :min="1" :max="65535" /></n-form-item>
        <n-space><label>{{ copy.secure }} <n-switch v-model:value="form.secure" /></label><label>{{ copy.starttls }} <n-switch v-model:value="form.starttls" /></label></n-space>
        <n-form-item :label="copy.username"><n-input v-model:value="form.username" /></n-form-item>
      </template>
      <n-form-item :label="copy.secretRef" :required="form.provider_type !== 'smtp' || Boolean(form.username)">
        <n-input v-model:value="form.secret_reference" placeholder="CONTACT_PROVIDER_MAIN_SECRET" />
        <n-text depth="3" class="hint">{{ copy.refHint }}</n-text>
      </n-form-item>
      <n-space justify="end"><n-button @click="showCreate = false">{{ copy.cancel }}</n-button><n-button type="primary" attr-type="submit">{{ copy.create }}</n-button></n-space>
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
</style>
