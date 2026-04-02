<script setup>
import {nextTick, onMounted, ref} from 'vue'

/* global __AI_STREAM_URL__, __AI_BEARER_TOKEN__ */
const STREAM_URL = __AI_STREAM_URL__
const BEARER_TOKEN = __AI_BEARER_TOKEN__

const messages = ref([
  {
    role: 'assistant',
    content: '你好！我是 mora 的 AI 分身，有什么想聊的？',
    id: 0,
  },
])
const inputText = ref('')
const loading = ref(false)
const messagesContainer = ref(null)
const inputRef = ref(null)
let idCounter = 1

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

async function sendMessage() {
  const text = inputText.value.trim()
  if (!text || loading.value) return

  messages.value.push({ role: 'user', content: text, id: idCounter++ })
  inputText.value = ''
  scrollToBottom()

  const assistantMsg = { role: 'assistant', content: '', id: idCounter++, streaming: true }
  messages.value.push(assistantMsg)
  loading.value = true
  scrollToBottom()

  try {
    const headers = { 'Content-Type': 'application/json' }
    if (BEARER_TOKEN) headers['Authorization'] = `Bearer ${BEARER_TOKEN}`

    const response = await fetch(STREAM_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: text }),
    })

    if (!response.ok) {
      assistantMsg.content = `请求失败：${response.status} ${response.statusText}`
      assistantMsg.streaming = false
      loading.value = false
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        if (trimmed.startsWith('data:')) {
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') continue
          try {
            const json = JSON.parse(data)
            const delta =
              json.choices?.[0]?.delta?.content ??
              json.delta?.text ??
              json.content ??
              json.text ??
              json.message ??
              (typeof json === 'string' ? json : null)
            if (delta) {
              assistantMsg.content += delta
              scrollToBottom()
            }
          } catch {
            // 非 JSON 的 data，直接拼接
            if (data && data !== '[DONE]') {
              assistantMsg.content += data
              scrollToBottom()
            }
          }
        } else if (trimmed.startsWith('{') || trimmed.startsWith('"')) {
          // 纯 JSON 行（无 SSE 前缀）
          try {
            const json = JSON.parse(trimmed)
            const delta =
              json.choices?.[0]?.delta?.content ??
              json.delta?.text ??
              json.content ??
              json.text ??
              json.message ??
              (typeof json === 'string' ? json : null)
            if (delta) {
              assistantMsg.content += delta
              scrollToBottom()
            }
          } catch {
            assistantMsg.content += trimmed
            scrollToBottom()
          }
        } else {
          // 纯文本行
          assistantMsg.content += trimmed
          scrollToBottom()
        }
      }
    }

    // 处理 buffer 中剩余内容
    if (buffer.trim()) {
      assistantMsg.content += buffer.trim()
    }
  } catch (err) {
    assistantMsg.content = `网络错误：${err.message}`
  } finally {
    assistantMsg.streaming = false
    loading.value = false
    scrollToBottom()
  }
}

function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

function clearChat() {
  messages.value = [
    {
      role: 'assistant',
      content: '你好！我是 mora 的 AI 分身，有什么想聊的？',
      id: idCounter++,
    },
  ]
}

onMounted(() => {
  inputRef.value?.focus()
})
</script>

<template>
  <div class="ai-chat">
    <div class="ai-chat__header">
      <div class="ai-chat__avatar">M</div>
      <div class="ai-chat__header-info">
        <span class="ai-chat__name">mora · AI 分身</span>
        <span class="ai-chat__status">
          <span class="ai-chat__status-dot" :class="{ 'is-typing': loading }"></span>
          {{ loading ? '正在思考…' : '在线' }}
        </span>
      </div>
      <button class="ai-chat__clear-btn" @click="clearChat" title="清空对话">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="1 4 1 10 7 10"></polyline>
          <path d="M3.51 15a9 9 0 1 0 .49-3.51"></path>
        </svg>
      </button>
    </div>

    <div class="ai-chat__messages" ref="messagesContainer">
      <div
        v-for="msg in messages"
        :key="msg.id"
        class="ai-chat__message"
        :class="msg.role === 'user' ? 'ai-chat__message--user' : 'ai-chat__message--assistant'"
      >
        <div v-if="msg.role === 'assistant'" class="ai-chat__bubble-avatar">M</div>
        <div class="ai-chat__bubble">
          <span v-if="msg.content" class="ai-chat__bubble-text">{{ msg.content }}</span>
          <span v-if="msg.streaming && !msg.content" class="ai-chat__typing">
            <span></span><span></span><span></span>
          </span>
          <span v-if="msg.streaming && msg.content" class="ai-chat__cursor">▍</span>
        </div>
      </div>
    </div>

    <div class="ai-chat__input-area">
      <textarea
        ref="inputRef"
        v-model="inputText"
        class="ai-chat__input"
        placeholder="输入消息，Enter 发送，Shift+Enter 换行…"
        rows="1"
        :disabled="loading"
        @keydown="handleKeydown"
      ></textarea>
      <button
        class="ai-chat__send-btn"
        :disabled="!inputText.trim() || loading"
        @click="sendMessage"
        title="发送"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.ai-chat {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 180px);
  min-height: 500px;
  max-width: 760px;
  margin: 0 auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  overflow: hidden;
  background: var(--vp-c-bg);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
}

/* ── Header ── */
.ai-chat__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}

.ai-chat__avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 1rem;
  flex-shrink: 0;
}

.ai-chat__header-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ai-chat__name {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.ai-chat__status {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.78rem;
  color: var(--vp-c-text-2);
}

.ai-chat__status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
  transition: background 0.3s;
}

.ai-chat__status-dot.is-typing {
  background: #f59e0b;
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.ai-chat__clear-btn {
  padding: 6px;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--vp-c-text-3);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s, background 0.2s;
}

.ai-chat__clear-btn:hover {
  color: var(--vp-c-text-1);
  background: var(--vp-c-default-soft);
}

/* ── Messages ── */
.ai-chat__messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  scroll-behavior: smooth;
}

.ai-chat__messages::-webkit-scrollbar {
  width: 4px;
}
.ai-chat__messages::-webkit-scrollbar-thumb {
  background: var(--vp-c-divider);
  border-radius: 4px;
}

.ai-chat__message {
  display: flex;
  gap: 10px;
  max-width: 88%;
}

.ai-chat__message--user {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.ai-chat__message--assistant {
  align-self: flex-start;
}

.ai-chat__bubble-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.85rem;
  flex-shrink: 0;
  margin-top: 2px;
}

.ai-chat__bubble {
  padding: 10px 14px;
  border-radius: 16px;
  font-size: 0.92rem;
  line-height: 1.65;
  word-break: break-word;
  white-space: pre-wrap;
}

.ai-chat__message--user .ai-chat__bubble {
  background: var(--vp-c-brand-1);
  color: #fff;
  border-bottom-right-radius: 4px;
}

.ai-chat__message--assistant .ai-chat__bubble {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  border-bottom-left-radius: 4px;
  border: 1px solid var(--vp-c-divider);
}

.ai-chat__cursor {
  display: inline-block;
  animation: blink 0.7s step-end infinite;
  opacity: 0.8;
  margin-left: 1px;
}

@keyframes blink {
  0%, 100% { opacity: 0.8; }
  50% { opacity: 0; }
}

/* 打点 loading */
.ai-chat__typing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
}

.ai-chat__typing span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-text-3);
  animation: bounce 1.2s infinite;
}

.ai-chat__typing span:nth-child(2) { animation-delay: 0.2s; }
.ai-chat__typing span:nth-child(3) { animation-delay: 0.4s; }

@keyframes bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.5; }
  40% { transform: translateY(-5px); opacity: 1; }
}

/* ── Input ── */
.ai-chat__input-area {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}

.ai-chat__input {
  flex: 1;
  resize: none;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 0.92rem;
  line-height: 1.5;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  outline: none;
  max-height: 140px;
  overflow-y: auto;
  font-family: inherit;
  transition: border-color 0.2s;
  field-sizing: content;
}

.ai-chat__input:focus {
  border-color: var(--vp-c-brand-1);
}

.ai-chat__input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ai-chat__send-btn {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: none;
  background: var(--vp-c-brand-1);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.2s, opacity 0.2s, transform 0.1s;
}

.ai-chat__send-btn:hover:not(:disabled) {
  background: var(--vp-c-brand-2);
  transform: scale(1.05);
}

.ai-chat__send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
