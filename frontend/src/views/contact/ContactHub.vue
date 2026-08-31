<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { api } from '../../api'
import { useGlobalState } from '../../store'
import ContactLogin from './ContactLogin.vue'
import DomainManager from '../../components/contact/DomainManager.vue'
import MailboxManager from '../../components/contact/MailboxManager.vue'
import { contactApi } from '../../api/contact'

const { openSettings, userSettings } = useGlobalState()
const { locale } = useI18n({ useScope: 'global' })
const router = useRouter()
const status = ref(null)
const authorized = ref(false)
const loadingStatus = ref(false)
const migration = ref(null)
const migrating = ref(false)
const activeSection = ref('domains')

const copy = computed(() => locale.value === 'zh' ? {
  title: 'Private Contact Mail Hub',
  subtitle: '统一管理多个网站的固定联系邮箱',
  migrationTitle: 'Contact 数据库需要初始化',
  migrationBody: '迁移只创建独立的 contact_* 表，不修改上游 db_version。',
  migrate: '执行 Contact Migration',
  domains: 'Domains', mailboxes: 'Mailboxes', inbox: 'Inbox', inboxPending: 'Unified Inbox 将在 Phase 4 接入。',
  advanced: '高级管理',
  logout: '退出',
  securityOk: '管理员安全配置有效',
  securityBad: '管理员安全配置不安全',
} : {
  title: 'Private Contact Mail Hub',
  subtitle: 'One private inbox for fixed mailboxes across your sites',
  migrationTitle: 'Contact database initialization required',
  migrationBody: 'The migration only creates independent contact_* tables and does not modify the upstream db_version.',
  migrate: 'Run Contact Migration',
  domains: 'Domains', mailboxes: 'Mailboxes', inbox: 'Inbox', inboxPending: 'Unified Inbox is added in Phase 4.',
  advanced: 'Advanced admin',
  logout: 'Sign out',
  securityOk: 'Administrator security is configured',
  securityBad: 'Administrator security configuration is unsafe',
})

const securityType = computed(() => status.value?.adminSecurity?.secure ? 'success' : 'error')
const securityText = computed(() => status.value?.adminSecurity?.secure
  ? copy.value.securityOk
  : `${copy.value.securityBad}: ${status.value?.adminSecurity?.code || 'AUTHENTICATION_REQUIRED'}`
)

const loadStatus = async () => {
  loadingStatus.value = true
  try {
    status.value = await api.fetch('/admin/contact/status')
    migration.value = await contactApi.getMigrationStatus()
    authorized.value = true
  } catch {
    authorized.value = false
  } finally {
    loadingStatus.value = false
  }
}

const migrate = async () => {
  migrating.value = true
  try {
    migration.value = await contactApi.migrate()
  } finally {
    migrating.value = false
  }
}

const signOut = () => {
  const state = useGlobalState()
  state.adminAuth.value = ''
  state.userJwt.value = ''
  userSettings.value.is_admin = false
  authorized.value = false
  status.value = null
  migration.value = null
}

onMounted(async () => {
  if (!openSettings.value.fetched) await api.getOpenSettings()
  if (openSettings.value.mode !== 'contact') {
    await router.replace('/')
    return
  }
  await loadStatus()
})
</script>

<template>
  <div class="contact-hub" data-testid="contact-hub">
    <div v-if="loadingStatus" class="contact-loading">
      <n-spin size="large" />
    </div>
    <ContactLogin v-else-if="!authorized" @authenticated="loadStatus" />
    <template v-else>
      <header class="contact-header">
        <div>
          <h1>{{ copy.title }}</h1>
          <n-text depth="3">{{ copy.subtitle }}</n-text>
        </div>
        <n-space>
          <n-button @click="router.push('/admin')">{{ copy.advanced }}</n-button>
          <n-button tertiary type="warning" @click="signOut">{{ copy.logout }}</n-button>
        </n-space>
      </header>
      <main class="contact-main">
        <n-alert :type="securityType" :title="securityText" />
        <n-card v-if="migration?.pending?.length" class="migration-card">
          <n-result status="warning" :title="copy.migrationTitle" :description="copy.migrationBody">
            <template #footer><n-button type="primary" :loading="migrating" @click="migrate">{{ copy.migrate }}</n-button></template>
          </n-result>
        </n-card>
        <n-tabs v-else v-model:value="activeSection" type="segment" animated>
          <n-tab-pane name="domains" :tab="copy.domains"><DomainManager /></n-tab-pane>
          <n-tab-pane name="mailboxes" :tab="copy.mailboxes"><MailboxManager /></n-tab-pane>
          <n-tab-pane name="inbox" :tab="copy.inbox"><n-card><n-empty :description="copy.inboxPending" /></n-card></n-tab-pane>
        </n-tabs>
      </main>
    </template>
  </div>
</template>

<style scoped>
.contact-hub {
  min-height: 100vh;
  background: linear-gradient(145deg, #f4f7fb 0%, #eef3f9 100%);
  color: #172033;
}

.contact-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 22px clamp(20px, 4vw, 56px);
  border-bottom: 1px solid rgba(23, 32, 51, 0.1);
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(14px);
}

.contact-header h1 {
  margin: 0 0 4px;
  font-size: clamp(22px, 3vw, 30px);
}

.contact-main {
  display: grid;
  gap: 18px;
  padding: clamp(20px, 4vw, 56px);
}

.migration-card {
  min-height: 360px;
  display: grid;
  place-items: center;
}

.contact-loading {
  min-height: 100vh;
  display: grid;
  place-items: center;
}

@media (max-width: 640px) {
  .contact-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
