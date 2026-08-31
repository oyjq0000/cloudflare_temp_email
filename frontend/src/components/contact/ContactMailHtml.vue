<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ShadowHtmlComponent from '../ShadowHtmlComponent.vue'
import { sanitizeMailHtml } from '../../utils/remote-content-policy'

const props = defineProps({
  messageId: { type: Number, required: true },
  html: { type: String, default: '' },
})
const { locale } = useI18n({ useScope: 'global' })
const allowRemote = ref(false)
const blocked = computed(() => sanitizeMailHtml(props.html, {
  allowRemoteContent: allowRemote.value,
}))
const copy = computed(() => locale.value === 'zh' ? {
  blocked: `已阻止 ${blocked.value.blocked} 个远程资源，以保护阅读隐私。`,
  load: '加载远程图片',
} : {
  blocked: `${blocked.value.blocked} remote resources blocked to protect reading privacy.`,
  load: 'Load remote images',
})

watch(() => props.messageId, () => { allowRemote.value = false })
</script>

<template>
  <div class="contact-html">
    <n-alert v-if="!allowRemote && blocked.blocked" type="info" :show-icon="false">
      <div class="remote-consent">
        <span>{{ copy.blocked }}</span>
        <n-button text type="primary" @click="allowRemote = true">{{ copy.load }}</n-button>
      </div>
    </n-alert>
    <ShadowHtmlComponent
      :html-content="html"
      :allow-remote-content="allowRemote"
    />
  </div>
</template>

<style scoped>
.contact-html { display: grid; gap: 14px; overflow-wrap: anywhere; }
.remote-consent { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
</style>
