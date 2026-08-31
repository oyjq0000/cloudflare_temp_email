<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { contactApi } from '../../api/contact'

const props = defineProps({
  show: { type: Boolean, default: false },
  replyMessage: { type: Object, default: null },
})
const emit = defineEmits(['update:show', 'sent'])
const { locale } = useI18n({ useScope: 'global' })
const notification = useMessage()
const mailboxes = ref([])
const sending = ref(false)
const sendKey = ref(null)
const form = ref({ mailbox_id: null, to_address: '', to_name: '', subject: '', text_body: '' })
const copy = computed(() => locale.value === 'zh' ? {
  compose: props.replyMessage ? '回复邮件' : '撰写邮件', from: 'From', to: 'To', toName: '收件人名称',
  subject: '主题', body: '正文', send: '发送', cancel: '取消', sent: '已提交发送且结果已记录',
  noMailbox: '没有可用的出站 Mailbox',
} : {
  compose: props.replyMessage ? 'Reply' : 'Compose', from: 'From', to: 'To', toName: 'Recipient name',
  subject: 'Subject', body: 'Body', send: 'Send', cancel: 'Cancel', sent: 'Delivery submitted and recorded',
  noMailbox: 'No outbound Mailbox is available',
})
const options = computed(() => mailboxes.value
  .filter(item => item.enabled && item.outbound_enabled && (
    !props.replyMessage || item.domain_id === props.replyMessage.domain_id
  ))
  .map(item => ({ label: item.address, value: item.id })))

const reset = async () => {
  sendKey.value = null
  mailboxes.value = (await contactApi.listMailboxes()).results || []
  const preferred = props.replyMessage?.mailbox_id
  form.value = {
    mailbox_id: options.value.some(item => item.value === preferred) ? preferred : options.value[0]?.value || null,
    to_address: props.replyMessage?.reply_to_address || props.replyMessage?.from_address || '',
    to_name: '',
    subject: props.replyMessage
      ? (/^\s*re\s*:/i.test(props.replyMessage.subject) ? props.replyMessage.subject : `Re: ${props.replyMessage.subject}`)
      : '',
    text_body: '',
  }
}

const send = async () => {
  if (sending.value || !form.value.mailbox_id) return
  sending.value = true
  sendKey.value ||= crypto.randomUUID()
  try {
    const input = props.replyMessage
      ? { mailbox_id: form.value.mailbox_id, text_body: form.value.text_body }
      : form.value
    const response = props.replyMessage
      ? await contactApi.replyToMessage(props.replyMessage.id, input, sendKey.value)
      : await contactApi.sendOutbound(input, sendKey.value)
    notification.success(`${copy.value.sent}: ${response.outbound.status}`)
    emit('sent', response.outbound)
    emit('update:show', false)
  } catch (error) { notification.error(error.message) }
  finally { sending.value = false }
}

watch(() => props.show, value => { if (value) reset().catch(error => notification.error(error.message)) })
</script>

<template>
  <n-modal :show="show" preset="card" :title="copy.compose" class="compose-modal" @update:show="value => emit('update:show', value)">
    <n-form label-placement="top" @submit.prevent="send">
      <n-alert v-if="!options.length" type="warning" :title="copy.noMailbox" />
      <n-form-item :label="copy.from" required><n-select v-model:value="form.mailbox_id" :options="options" /></n-form-item>
      <n-form-item v-if="!replyMessage" :label="copy.to" required><n-input v-model:value="form.to_address" /></n-form-item>
      <n-form-item v-if="!replyMessage" :label="copy.toName"><n-input v-model:value="form.to_name" /></n-form-item>
      <n-form-item v-if="!replyMessage" :label="copy.subject" required><n-input v-model:value="form.subject" /></n-form-item>
      <n-form-item :label="copy.body" required><n-input v-model:value="form.text_body" type="textarea" :autosize="{ minRows: 8, maxRows: 18 }" /></n-form-item>
      <n-space justify="end"><n-button @click="emit('update:show', false)">{{ copy.cancel }}</n-button><n-button type="primary" attr-type="submit" :loading="sending" :disabled="!options.length">{{ copy.send }}</n-button></n-space>
    </n-form>
  </n-modal>
</template>

<style scoped>
:global(.compose-modal) { width: min(720px, calc(100vw - 28px)); }
</style>
