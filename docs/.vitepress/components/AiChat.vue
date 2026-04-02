<script setup>
import {nextTick, onMounted, onUnmounted, reactive, ref} from 'vue'

/* global __AI_STREAM_URL__, __AI_BEARER_TOKEN__ */
const STREAM_URL = __AI_STREAM_URL__
const BEARER_TOKEN = __AI_BEARER_TOKEN__

const greeting = '你好！我是 mora 的 AI 分身，可以直接问我任何问题。'

const suggestions = [
  '介绍一下你的技术栈',
  'mora 这个项目最难的地方是什么？',
  '你是怎么处理 Cloudflare Workers 超时的？',
]

const messages = ref([
  {
    role: 'assistant',
    content: greeting,
    id: 0,
  },
])

const inputText = ref('')
const loading = ref(false)
const messagesContainer = ref(null)
const inputRef = ref(null)
let idCounter = 1

let activeController = null
let typingMessage = null
let typingBuffer = ''
let typingTimer = null
let typingStreamFinished = false
let lastIncomingText = ''

function scrollToBottom() {
  nextTick(() => {
    const el = messagesContainer.value
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  })
}

function resetTypingState() {
  if (typingTimer) {
    clearTimeout(typingTimer)
    typingTimer = null
  }
  typingMessage = null
  typingBuffer = ''
  typingStreamFinished = false
  lastIncomingText = ''
}

function finishTypingSession() {
  typingStreamFinished = true
  scheduleTypingTick()
}

function completeTypingSession() {
  if (typingTimer) {
    clearTimeout(typingTimer)
    typingTimer = null
  }
  typingMessage = null
  typingBuffer = ''
  typingStreamFinished = false
  lastIncomingText = ''
  loading.value = false
  activeController = null
}

function startTypingSession(msg) {
  if (typingTimer) {
    clearTimeout(typingTimer)
    typingTimer = null
  }
  typingMessage = msg
  typingBuffer = ''
  typingStreamFinished = false
  lastIncomingText = ''
  scheduleTypingTick()
}

function enqueueTypingText(text) {
  if (!text) return
  typingBuffer += text
  scheduleTypingTick()
}

function takeTypingFragment() {
  if (!typingBuffer) return ''

  const chars = Array.from(typingBuffer)
  const length = chars.length
  let count = 1

  if (length > 80) count = 8
  else if (length > 40) count = 6
  else if (length > 20) count = 4
  else if (length > 8) count = 2

  if (/[。！？!?；;，,:\n]$/.test(typingBuffer)) {
    count += 1
  }

  const fragment = chars.slice(0, count).join('')
  typingBuffer = chars.slice(count).join('')
  return fragment
}

function scheduleTypingTick() {
  if (typingTimer || !typingMessage) return

  typingTimer = window.setTimeout(() => {
    typingTimer = null

    if (!typingMessage) return

    if (typingBuffer) {
      typingMessage.content += takeTypingFragment()
      scrollToBottom()
    }

    if (typingBuffer || !typingStreamFinished) {
      scheduleTypingTick()
      return
    }

    completeTypingSession()
    scrollToBottom()
  }, 18)
}

function appendIncomingText(text) {
  if (!text) return

  if (lastIncomingText && text.startsWith(lastIncomingText)) {
    const delta = text.slice(lastIncomingText.length)
    enqueueTypingText(delta || text)
  } else {
    enqueueTypingText(text)
  }

  lastIncomingText = text
}

function parseSSEEvents(buffer) {
  const results = []
  const blocks = buffer.split(/\n\n+/)

  for (const block of blocks) {
    if (!block.trim()) continue

    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) {
        results.push(line.slice(5).trim())
      }
    }
  }

  return results
}

function extractTextFromPayload(payload) {
  if (!payload || payload === '[DONE]') return null

  try {
    const json = JSON.parse(payload)

    if (typeof json === 'string') return json
    if (typeof json.answer === 'string') return json.answer
    if (typeof json.delta === 'string') return json.delta
    if (typeof json.text === 'string') return json.text
    if (typeof json.content === 'string') return json.content
    if (typeof json.message === 'string') return json.message

    if (json.type === 'answer' && json.content) {
      if (typeof json.content.answer === 'string') return json.content.answer
      if (typeof json.content.delta === 'string') return json.content.delta
      if (typeof json.content.text === 'string') return json.content.text
    }

    if (json.type === 'message' && typeof json.content === 'string') {
      return json.content
    }

    return null
  } catch {
    return null
  }
}

function createAssistantMessage() {
  return reactive({
    role: 'assistant',
    content: '',
    id: idCounter++,
    streaming: true,
  })
}

async function sendMessage(textOverride = '') {
  const text = (textOverride || inputText.value).trim()
  if (!text || loading.value) return

  if (activeController) {
    activeController.abort()
    activeController = null
  }

  const userMessage = { role: 'user', content: text, id: idCounter++ }
  messages.value.push(userMessage)
  inputText.value = ''
  scrollToBottom()

  const assistantMsg = createAssistantMessage()
  messages.value.push(assistantMsg)
  loading.value = true
  scrollToBottom()

  startTypingSession(assistantMsg)

  const controller = new AbortController()
  activeController = controller

  try {
    const headers = { 'Content-Type': 'application/json' }
    if (BEARER_TOKEN) headers.Authorization = `Bearer ${BEARER_TOKEN}`

    const response = await fetch(STREAM_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: text }),
      signal: controller.signal,
    })

    if (!response.ok) {
      resetTypingState()
      assistantMsg.content = `请求失败：${response.status} ${response.statusText}`
      assistantMsg.streaming = false
      loading.value = false
      return
    }

    if (!response.body) {
      resetTypingState()
      assistantMsg.content = '请求成功，但响应体为空。'
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

      const lastEventEnd = buffer.lastIndexOf('\n\n')
      if (lastEventEnd === -1) continue

      const processable = buffer.slice(0, lastEventEnd)
      buffer = buffer.slice(lastEventEnd + 2)

      for (const payload of parseSSEEvents(processable)) {
        const textChunk = extractTextFromPayload(payload)
        if (textChunk) {
          appendIncomingText(textChunk)
        }
      }
    }

    if (buffer.trim()) {
      for (const payload of parseSSEEvents(buffer)) {
        const textChunk = extractTextFromPayload(payload)
        if (textChunk) {
          appendIncomingText(textChunk)
        }
      }
    }

    finishTypingSession()
  } catch (err) {
    if (err?.name === 'AbortError') return

    resetTypingState()
    assistantMsg.content = `网络错误：${err?.message || '请求失败'}`
    assistantMsg.streaming = false
    loading.value = false
  } finally {
    scrollToBottom()
  }
}

function handleKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessage()
  }
}

function useSuggestion(text) {
  inputText.value = text
  inputRef.value?.focus()
}

function clearChat() {
  if (activeController) {
    activeController.abort()
    activeController = null
  }

  resetTypingState()
  loading.value = false
  messages.value = [
    {
      role: 'assistant',
      content: greeting,
      id: idCounter++,
    },
  ]
  scrollToBottom()
}

onMounted(() => {
  inputRef.value?.focus()
})

onUnmounted(() => {
  if (activeController) {
    activeController.abort()
  }

  if (typingTimer) {
    clearTimeout(typingTimer)
  }
})
</script>

<template>
  <div class="chat-shell">
    <div class="chat-shell__glow chat-shell__glow--left"></div>
    <div class="chat-shell__glow chat-shell__glow--right"></div>

    <section class="chatgpt">
      <header class="chatgpt__topbar">
        <div class="chatgpt__brand">
          <div class="chatgpt__logo">M</div>
          <div class="chatgpt__brand-copy">
            <div class="chatgpt__title">mora AI</div>
            <div class="chatgpt__subtitle">模拟 ChatGPT 风格的流式对话页面</div>
          </div>
        </div>

        <div class="chatgpt__actions">
          <span class="chatgpt__status" :class="{ 'is-loading': loading }">
            <span class="chatgpt__status-dot"></span>
            {{ loading ? '生成中' : '在线' }}
          </span>
          <button class="chatgpt__ghost-btn" @click="clearChat">清空</button>
        </div>
      </header>

      <main class="chatgpt__body" ref="messagesContainer">
        <div class="chatgpt__intro" v-if="messages.length === 1 && !loading">
          <div class="chatgpt__intro-card">
            <h2>开始对话</h2>
            <p>输入一个问题，消息会以打字机效果逐步显示。</p>
          </div>

          <div class="chatgpt__chips">
            <button
              v-for="suggestion in suggestions"
              :key="suggestion"
              class="chatgpt__chip"
              @click="useSuggestion(suggestion)"
            >
              {{ suggestion }}
            </button>
          </div>
        </div>

        <article
          v-for="msg in messages"
          :key="msg.id"
          class="chatgpt__message"
          :class="msg.role === 'user' ? 'chatgpt__message--user' : 'chatgpt__message--assistant'"
        >
          <div v-if="msg.role === 'assistant'" class="chatgpt__avatar">M</div>

          <div class="chatgpt__bubble-wrap">
            <div class="chatgpt__meta">
              <span>{{ msg.role === 'user' ? '你' : 'mora' }}</span>
              <span v-if="msg.streaming" class="chatgpt__meta-live">streaming</span>
            </div>

            <div class="chatgpt__bubble">
              <span v-if="msg.content" class="chatgpt__text">{{ msg.content }}</span>
              <span v-if="msg.streaming && !msg.content" class="chatgpt__typing">
                <span></span><span></span><span></span>
              </span>
              <span v-if="msg.streaming && msg.content" class="chatgpt__cursor">▍</span>
            </div>
          </div>
        </article>
      </main>

      <footer class="chatgpt__composer">
        <div class="chatgpt__composer-inner">
          <textarea
            ref="inputRef"
            v-model="inputText"
            class="chatgpt__input"
            placeholder="给 mora 发消息，Enter 发送，Shift+Enter 换行"
            rows="1"
            :disabled="loading"
            @keydown="handleKeydown"
          ></textarea>

          <div class="chatgpt__composer-bar">
            <div class="chatgpt__hint">支持 SSE 流式输出和打字机展示</div>
            <button
              class="chatgpt__send-btn"
              :disabled="!inputText.trim() || loading"
              @click="sendMessage"
              title="发送"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </div>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.chat-shell {
  position: relative;
  min-height: calc(100vh - 120px);
  padding: 24px 0 12px;
  overflow: hidden;
  background:
    radial-gradient(circle at top left, rgba(16, 185, 129, 0.12), transparent 35%),
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.12), transparent 30%),
    linear-gradient(180deg, rgba(11, 15, 25, 0.02), rgba(11, 15, 25, 0));
}

.chat-shell__glow {
  position: absolute;
  inset: auto;
  width: 320px;
  height: 320px;
  border-radius: 50%;
  filter: blur(70px);
  opacity: 0.45;
  pointer-events: none;
}

.chat-shell__glow--left {
  left: -120px;
  top: 40px;
  background: rgba(16, 185, 129, 0.18);
}

.chat-shell__glow--right {
  right: -100px;
  top: 160px;
  background: rgba(59, 130, 246, 0.16);
}

.chatgpt {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  max-width: 980px;
  min-height: calc(100vh - 144px);
  margin: 0 auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 24px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(18px);
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.12);
}

:global(html.dark) .chatgpt {
  background: rgba(17, 24, 39, 0.86);
}

.chatgpt__topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.68));
}

:global(html.dark) .chatgpt__topbar {
  background: linear-gradient(180deg, rgba(17, 24, 39, 0.96), rgba(17, 24, 39, 0.76));
}

.chatgpt__brand {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.chatgpt__logo {
  width: 42px;
  height: 42px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 800;
  letter-spacing: 0.04em;
  background: linear-gradient(135deg, #10b981, #0ea5e9);
  box-shadow: 0 10px 30px rgba(14, 165, 233, 0.22);
  flex-shrink: 0;
}

.chatgpt__brand-copy {
  min-width: 0;
}

.chatgpt__title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.chatgpt__subtitle {
  margin-top: 3px;
  font-size: 0.82rem;
  color: var(--vp-c-text-2);
}

.chatgpt__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.chatgpt__status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 999px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  font-size: 0.82rem;
}

.chatgpt__status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #10b981;
  transition: transform 0.2s, opacity 0.2s;
}

.chatgpt__status.is-loading .chatgpt__status-dot {
  animation: pulse 1s infinite;
  background: #f59e0b;
}

.chatgpt__ghost-btn {
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  border-radius: 999px;
  padding: 8px 14px;
  cursor: pointer;
  transition: transform 0.15s, background 0.2s, border-color 0.2s;
}

.chatgpt__ghost-btn:hover {
  transform: translateY(-1px);
  background: var(--vp-c-default-soft);
}

.chatgpt__body {
  flex: 1;
  overflow-y: auto;
  padding: 28px 22px 30px;
  scroll-behavior: smooth;
}

.chatgpt__body::-webkit-scrollbar {
  width: 6px;
}

.chatgpt__body::-webkit-scrollbar-thumb {
  background: var(--vp-c-divider);
  border-radius: 999px;
}

.chatgpt__intro {
  max-width: 760px;
  margin: 0 auto 22px;
}

.chatgpt__intro-card {
  padding: 20px 22px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 20px;
  background: linear-gradient(180deg, var(--vp-c-bg), var(--vp-c-bg-soft));
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
}

.chatgpt__intro-card h2 {
  margin: 0 0 6px;
  font-size: 1.05rem;
}

.chatgpt__intro-card p {
  margin: 0;
  color: var(--vp-c-text-2);
  line-height: 1.6;
}

.chatgpt__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}

.chatgpt__chip {
  border: 1px solid var(--vp-c-divider);
  background: rgba(255, 255, 255, 0.76);
  color: var(--vp-c-text-1);
  border-radius: 999px;
  padding: 10px 14px;
  cursor: pointer;
  transition: transform 0.15s, border-color 0.2s, background 0.2s;
}

.chatgpt__chip:hover {
  transform: translateY(-1px);
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg-soft);
}

:global(html.dark) .chatgpt__chip {
  background: rgba(17, 24, 39, 0.72);
}

.chatgpt__message {
  display: flex;
  gap: 14px;
  max-width: 780px;
  margin: 0 auto 18px;
}

.chatgpt__message--user {
  justify-content: flex-end;
}

.chatgpt__message--assistant {
  justify-content: flex-start;
}

.chatgpt__avatar {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #10b981, #0ea5e9);
  color: #fff;
  font-weight: 800;
  flex-shrink: 0;
  box-shadow: 0 10px 22px rgba(14, 165, 233, 0.18);
}

.chatgpt__bubble-wrap {
  min-width: 0;
  flex: 1;
}

.chatgpt__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 0.76rem;
  color: var(--vp-c-text-2);
}

.chatgpt__meta-live {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.14);
  color: #d97706;
}

.chatgpt__bubble {
  display: inline-block;
  max-width: 100%;
  padding: 14px 16px;
  border-radius: 20px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  line-height: 1.72;
  word-break: break-word;
  white-space: pre-wrap;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
}

.chatgpt__message--user .chatgpt__bubble {
  background: linear-gradient(135deg, var(--vp-c-brand-1), var(--vp-c-brand-2));
  border-color: transparent;
  color: #fff;
  border-bottom-right-radius: 6px;
}

.chatgpt__message--assistant .chatgpt__bubble {
  border-bottom-left-radius: 6px;
}

.chatgpt__text {
  display: inline;
}

.chatgpt__cursor {
  display: inline-block;
  margin-left: 2px;
  opacity: 0.9;
  animation: blink 0.8s step-end infinite;
}

.chatgpt__typing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 22px;
}

.chatgpt__typing span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-text-3);
  animation: bounce 1.1s infinite;
}

.chatgpt__typing span:nth-child(2) {
  animation-delay: 0.16s;
}

.chatgpt__typing span:nth-child(3) {
  animation-delay: 0.32s;
}

.chatgpt__composer {
  padding: 18px 22px 22px;
  border-top: 1px solid var(--vp-c-divider);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.62), rgba(255, 255, 255, 0.88));
}

:global(html.dark) .chatgpt__composer {
  background: linear-gradient(180deg, rgba(17, 24, 39, 0.66), rgba(17, 24, 39, 0.94));
}

.chatgpt__composer-inner {
  max-width: 780px;
  margin: 0 auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 22px;
  background: var(--vp-c-bg);
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
  overflow: hidden;
}

.chatgpt__input {
  width: 100%;
  min-height: 68px;
  max-height: 180px;
  padding: 16px 18px 10px;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--vp-c-text-1);
  font: inherit;
  line-height: 1.6;
  field-sizing: content;
}

.chatgpt__input:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.chatgpt__composer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 12px 12px 16px;
}

.chatgpt__hint {
  color: var(--vp-c-text-2);
  font-size: 0.78rem;
}

.chatgpt__send-btn {
  width: 42px;
  height: 42px;
  border: none;
  border-radius: 14px;
  background: linear-gradient(135deg, #10b981, #0ea5e9);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.15s, opacity 0.2s, filter 0.2s;
  flex-shrink: 0;
}

.chatgpt__send-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.04);
}

.chatgpt__send-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(0.85);
    opacity: 0.7;
  }
}

@keyframes blink {
  0%,
  100% {
    opacity: 0.95;
  }
  50% {
    opacity: 0;
  }
}

@keyframes bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.45;
  }
  40% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

@media (max-width: 768px) {
  .chat-shell {
    padding: 12px 0 8px;
  }

  .chatgpt {
    min-height: calc(100vh - 96px);
    border-radius: 20px;
  }

  .chatgpt__topbar,
  .chatgpt__composer,
  .chatgpt__body {
    padding-left: 14px;
    padding-right: 14px;
  }

  .chatgpt__topbar {
    flex-direction: column;
    align-items: stretch;
  }

  .chatgpt__actions {
    justify-content: space-between;
  }

  .chatgpt__message {
    gap: 10px;
  }

  .chatgpt__composer-bar {
    flex-direction: column;
    align-items: flex-start;
  }

  .chatgpt__send-btn {
    align-self: flex-end;
  }
}
</style>
