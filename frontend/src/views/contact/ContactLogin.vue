<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '../../api'
import Turnstile from '../../components/Turnstile.vue'
import { useGlobalState } from '../../store'
import { hashPassword } from '../../utils'

const emit = defineEmits(['authenticated'])
const {
  adminAuth,
  auth,
  openSettings,
  userJwt,
  userSettings,
} = useGlobalState()
const { locale } = useI18n({ useScope: 'global' })
const message = useMessage()

const method = ref('password')
const accessPassword = ref('')
const adminPassword = ref('')
const email = ref('')
const accountPassword = ref('')
const accessCfToken = ref('')
const cfToken = ref('')
const accessTurnstileRef = ref(null)
const turnstileRef = ref(null)
const submitting = ref(false)

const copy = computed(() => locale.value === 'zh' ? {
  title: '管理员登录',
  intro: 'Contact Hub 仅向已验证管理员开放。',
  passwordTab: '管理员密码',
  accountTab: '管理员账户',
  sitePassword: '站点访问密码',
  adminPassword: '管理员密码',
  email: '邮箱',
  accountPassword: '账户密码',
  submit: '进入 Contact Hub',
  required: '请填写所有必填字段',
  roleRequired: '该账户不具备管理员角色',
} : {
  title: 'Administrator sign in',
  intro: 'Contact Hub is available only to a verified administrator.',
  passwordTab: 'Admin password',
  accountTab: 'Admin account',
  sitePassword: 'Site access password',
  adminPassword: 'Admin password',
  email: 'Email',
  accountPassword: 'Account password',
  submit: 'Open Contact Hub',
  required: 'Complete all required fields',
  roleRequired: 'This account does not have the administrator role',
})

const unlockSite = async () => {
  if (!openSettings.value.needAuth) return
  if (!accessPassword.value) throw new Error(copy.value.required)
  await api.fetch('/open_api/site_login', {
    method: 'POST',
    body: JSON.stringify({
      password: await hashPassword(accessPassword.value),
      cf_token: accessCfToken.value,
    }),
  })
  auth.value = accessPassword.value
}

const signIn = async () => {
  submitting.value = true
  try {
    await unlockSite()
    if (method.value === 'password') {
      if (!adminPassword.value) throw new Error(copy.value.required)
      await api.fetch('/open_api/admin_login', {
        method: 'POST',
        body: JSON.stringify({
          password: await hashPassword(adminPassword.value),
          cf_token: cfToken.value,
        }),
      })
      adminAuth.value = adminPassword.value
    } else {
      if (!email.value || !accountPassword.value) throw new Error(copy.value.required)
      const result = await api.fetch('/user_api/login', {
        method: 'POST',
        body: JSON.stringify({
          email: email.value,
          password: await hashPassword(accountPassword.value),
          cf_token: cfToken.value,
        }),
      })
      userJwt.value = result.jwt
      await api.getUserSettings(message)
      if (!userSettings.value.is_admin) {
        userJwt.value = ''
        throw new Error(copy.value.roleRequired)
      }
    }
    emit('authenticated')
  } catch (error) {
    message.error(error.message || 'Authentication failed')
    accessTurnstileRef.value?.refresh?.()
    turnstileRef.value?.refresh?.()
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <n-card class="contact-login" :title="copy.title" data-testid="contact-login">
    <n-text depth="3">{{ copy.intro }}</n-text>
    <n-form label-placement="top" @submit.prevent="signIn">
      <n-form-item v-if="openSettings.needAuth" :label="copy.sitePassword" required>
        <n-input v-model:value="accessPassword" type="password" show-password-on="click" />
      </n-form-item>
      <Turnstile
        ref="accessTurnstileRef"
        v-if="openSettings.needAuth && openSettings.enableGlobalTurnstileCheck"
        v-model:value="accessCfToken"
      />
      <n-tabs v-model:value="method" type="segment" animated>
        <n-tab-pane name="password" :tab="copy.passwordTab">
          <n-form-item :label="copy.adminPassword" required>
            <n-input v-model:value="adminPassword" type="password" show-password-on="click" @keyup.enter="signIn" />
          </n-form-item>
        </n-tab-pane>
        <n-tab-pane name="account" :tab="copy.accountTab">
          <n-form-item :label="copy.email" required>
            <n-input v-model:value="email" />
          </n-form-item>
          <n-form-item :label="copy.accountPassword" required>
            <n-input v-model:value="accountPassword" type="password" show-password-on="click" @keyup.enter="signIn" />
          </n-form-item>
        </n-tab-pane>
      </n-tabs>
      <Turnstile
        ref="turnstileRef"
        v-if="openSettings.enableGlobalTurnstileCheck"
        v-model:value="cfToken"
      />
      <n-button type="primary" block attr-type="submit" :loading="submitting">
        {{ copy.submit }}
      </n-button>
    </n-form>
  </n-card>
</template>

<style scoped>
.contact-login {
  width: min(460px, calc(100vw - 32px));
  margin: 8vh auto 0;
}
</style>
