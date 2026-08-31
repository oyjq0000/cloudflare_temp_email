<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { api } from '../../api'
import { useGlobalState } from '../../store'
import ContactLogin from './ContactLogin.vue'
import DomainManager from '../../components/contact/DomainManager.vue'
import MailboxManager from '../../components/contact/MailboxManager.vue'
import ContactInbox from '../../components/contact/ContactInbox.vue'
import { contactApi } from '../../api/contact'

const { openSettings, userSettings } = useGlobalState()
const { locale } = useI18n({ useScope: 'global' })
const router = useRouter()
const status = ref(null)
const authorized = ref(false)
const loadingStatus = ref(false)
const migration = ref(null)
const migrating = ref(false)
const storage = ref(null)
const activeSection = ref('inbox')
const domains = ref([])
const counts = ref({ inbox: 0, unread: 0, spam: 0 })
const inboxView = ref({ folder: 'inbox', unreadOnly: false, domainId: null })

const copy = computed(() => locale.value === 'zh' ? {
  title: 'Private Contact Mail Hub',
  subtitle: '统一管理多个网站的固定联系邮箱',
  migrationTitle: 'Contact 数据库需要初始化',
  migrationBody: '迁移只创建独立的 contact_* 表，不修改上游 db_version。',
  migrate: '执行 Contact Migration',
  domains: 'Domains', mailboxes: 'Mailboxes', inbox: '收件箱', unread: '未读', spam: '垃圾邮件', sites: '站点', settings: '设置',
  storageOk: 'R2 私有存储正常', storageBad: 'R2 Binding 不可用，入站将使用 D1 兜底',
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
  domains: 'Domains', mailboxes: 'Mailboxes', inbox: 'Inbox', unread: 'Unread', spam: 'Spam', sites: 'Sites', settings: 'Settings',
  storageOk: 'Private R2 storage is available', storageBad: 'R2 binding is unavailable; inbound uses the D1 fallback',
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
    if (!migration.value.pending?.length) {
      const [storageResult, domainResult] = await Promise.all([
        contactApi.getStorageStatus(), contactApi.listDomains(),
      ])
      storage.value = storageResult
      domains.value = domainResult.results || []
    }
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
    storage.value = await contactApi.getStorageStatus()
    domains.value = (await contactApi.listDomains()).results || []
  } finally {
    migrating.value = false
  }
}

const refreshDomains = async () => {
  domains.value = (await contactApi.listDomains()).results || []
}

const openInbox = (folder = 'inbox', unreadOnly = false, domainId = null) => {
  activeSection.value = 'inbox'
  inboxView.value = { folder, unreadOnly, domainId }
}

const signOut = () => {
  const state = useGlobalState()
  state.adminAuth.value = ''
  state.userJwt.value = ''
  userSettings.value.is_admin = false
  authorized.value = false
  status.value = null
  migration.value = null
  storage.value = null
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
        <n-alert
          v-if="storage"
          :type="storage.bindingAvailable ? 'success' : 'warning'"
          :title="storage.bindingAvailable ? copy.storageOk : copy.storageBad"
        />
        <n-card v-if="migration?.pending?.length" class="migration-card">
          <n-result status="warning" :title="copy.migrationTitle" :description="copy.migrationBody">
            <template #footer><n-button type="primary" :loading="migrating" @click="migrate">{{ copy.migrate }}</n-button></template>
          </n-result>
        </n-card>
        <div v-else class="hub-workspace">
          <aside class="hub-sidebar">
            <nav>
              <button :class="{ active: activeSection === 'inbox' && inboxView.folder === 'inbox' && !inboxView.unreadOnly && !inboxView.domainId }" @click="openInbox('inbox')"><span>{{ copy.inbox }}</span><n-tag size="small" round>{{ counts.inbox }}</n-tag></button>
              <button :class="{ active: activeSection === 'inbox' && inboxView.unreadOnly }" @click="openInbox('inbox', true)"><span>{{ copy.unread }}</span><n-tag size="small" round type="info">{{ counts.unread }}</n-tag></button>
              <button :class="{ active: activeSection === 'inbox' && inboxView.folder === 'spam' }" @click="openInbox('spam')"><span>{{ copy.spam }}</span><n-tag size="small" round type="warning">{{ counts.spam }}</n-tag></button>
            </nav>
            <h3>{{ copy.sites }}</h3>
            <nav><button v-for="domain in domains" :key="domain.id" :class="{ active: activeSection === 'inbox' && inboxView.domainId === domain.id }" @click="openInbox('inbox', false, domain.id)"><span>{{ domain.name }}</span></button></nav>
            <h3>{{ copy.settings }}</h3>
            <nav>
              <button :class="{ active: activeSection === 'domains' }" @click="activeSection = 'domains'"><span>{{ copy.domains }}</span></button>
              <button :class="{ active: activeSection === 'mailboxes' }" @click="activeSection = 'mailboxes'"><span>{{ copy.mailboxes }}</span></button>
            </nav>
          </aside>
          <div class="hub-content">
            <ContactInbox
              v-if="activeSection === 'inbox'"
              :domain-id="inboxView.domainId"
              :folder="inboxView.folder"
              :unread-only="inboxView.unreadOnly"
              @counts="value => counts = value"
            />
            <DomainManager v-else-if="activeSection === 'domains'" @changed="refreshDomains" />
            <MailboxManager v-else />
          </div>
        </div>
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

.hub-workspace { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 18px; align-items: start; }
.hub-sidebar { position: sticky; top: 18px; display: grid; gap: 10px; padding: 12px; border: 1px solid rgba(23, 32, 51, .1); border-radius: 12px; background: rgba(255,255,255,.85); }
.hub-sidebar h3 { margin: 10px 8px 2px; color: #778095; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
.hub-sidebar nav { display: grid; gap: 4px; }
.hub-sidebar button { display: flex; justify-content: space-between; gap: 8px; width: 100%; padding: 9px 10px; border: 0; border-radius: 8px; background: transparent; color: inherit; cursor: pointer; text-align: left; }
.hub-sidebar button:hover, .hub-sidebar button.active { background: rgba(48, 103, 246, .1); color: #2457c5; }
.hub-content { min-width: 0; }

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
  .contact-main { padding: 14px; }
  .hub-workspace { grid-template-columns: 1fr; }
  .hub-sidebar { position: static; overflow-x: auto; }
  .hub-sidebar nav { display: flex; }
  .hub-sidebar button { min-width: max-content; }
  .hub-sidebar h3 { display: none; }
}
</style>
