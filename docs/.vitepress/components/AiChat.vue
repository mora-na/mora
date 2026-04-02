<script setup>
import {nextTick, onMounted, onUnmounted, reactive, ref} from 'vue'

/* global __AI_STREAM_URL__, __AI_BEARER_TOKEN__ */
const STREAM_URL = __AI_STREAM_URL__
const BEARER_TOKEN = __AI_BEARER_TOKEN__

const greeting = '你好！我是 mora 的 AI 分身，可以直接问我任何问题。'

const suggestions = [
  '介绍一下你的技术栈'
]

const messages = ref([
  createGreetingMessage(),
])

const inputText = ref('')
const loading = ref(false)
const messagesContainer = ref(null)
const inputRef = ref(null)
let idCounter = 1
let resizeListener = null

let activeController = null
let typingMessage = null
let typingBuffer = ''
let typingTimer = null
let typingStreamFinished = false
let lastIncomingText = ''

const AI_CHAT_TOP_OFFSET_VAR = '--ai-chat-top-offset'

function createGreetingMessage() {
  return {
    role: 'assistant',
    content: greeting,
    id: 0,
  }
}

function setAiChatPageLocked(locked) {
  if (typeof document === 'undefined') return

  document.body.classList.toggle('ai-chat-page', locked)
  document.documentElement.classList.toggle('ai-chat-page', locked)
  if (!locked) {
    document.documentElement.style.removeProperty(AI_CHAT_TOP_OFFSET_VAR)
  }
}

function syncAiChatTopOffset() {
  if (typeof document === 'undefined') return

  const root = document.documentElement
  const nav = document.querySelector('.VPNav')
  const localNav = document.querySelector('.VPLocalNav')
  const layoutTop = Number.parseFloat(
    getComputedStyle(root).getPropertyValue('--vp-layout-top-height')
  ) || 0
  const navHeight = nav ? Math.round(nav.getBoundingClientRect().height) : 0
  const localNavHeight = localNav ? Math.round(localNav.getBoundingClientRect().height) : 0

  root.style.setProperty(AI_CHAT_TOP_OFFSET_VAR, `${navHeight + localNavHeight + layoutTop}px`)
}

function refreshAiChatTopOffset() {
  nextTick(() => {
    syncAiChatTopOffset()
  })
}

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

async function sendMessage(questionText) {
  const text = typeof questionText === 'string' ? questionText.trim() : ''
  if (!text) return

  if (activeController) {
    activeController.abort()
    activeController = null
  }

  resetTypingState()

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
  if (event.isComposing) return

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    submitComposerMessage()
  }
}

function handleInput(event) {
  inputText.value = event.target.value
}

function submitComposerMessage() {
  sendMessage(inputText.value)
}

function useSuggestion(text) {
  sendMessage(text)
}

function clearChat() {
  if (activeController) {
    activeController.abort()
    activeController = null
  }

  resetTypingState()
  loading.value = false
  messages.value = [
    createGreetingMessage(),
  ]
  scrollToBottom()
}

onMounted(() => {
  setAiChatPageLocked(true)
  refreshAiChatTopOffset()
  resizeListener = () => refreshAiChatTopOffset()
  window.addEventListener('resize', resizeListener)
  inputRef.value?.focus()
})

onUnmounted(() => {
  setAiChatPageLocked(false)

  if (resizeListener) {
    window.removeEventListener('resize', resizeListener)
    resizeListener = null
  }

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
    <section class="chatgpt">
      <header class="chatgpt__topbar">
        <div class="chatgpt__brand">
          <div class="chatgpt__logo">M</div>
          <div class="chatgpt__brand-copy">
            <div class="chatgpt__title">mora AI 对话面板</div>
          </div>
        </div>

        <div class="chatgpt__actions">
          <span class="chatgpt__status" :class="{ 'is-loading': loading }">
            <span class="chatgpt__status-dot"></span>
            {{ loading ? '生成中' : '在线' }}
          </span>
          <button type="button" class="chatgpt__ghost-btn" @click="clearChat">清空</button>
        </div>
      </header>

      <main class="chatgpt__body">
        <div class="chatgpt__intro" v-if="messages.length === 1 && !loading">
          <div class="chatgpt__chips">
            <button
              v-for="suggestion in suggestions"
              :key="suggestion"
              type="button"
              class="chatgpt__chip"
              @click="useSuggestion(suggestion)"
            >
              {{ suggestion }}
            </button>
          </div>
        </div>

        <div class="chatgpt__message-list" ref="messagesContainer">
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
        </div>
      </main>

      <footer class="chatgpt__composer">
        <div class="chatgpt__composer-inner">
          <div class="chatgpt__composer-row">
            <textarea
              ref="inputRef"
              :value="inputText"
              class="chatgpt__input"
              placeholder="提出你的问题"
              rows="1"
              @input="handleInput"
              @keydown="handleKeydown"
            ></textarea>

            <button
              type="button"
              class="chatgpt__send-btn"
              :disabled="!inputText.trim()"
              @click="submitComposerMessage"
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
:global(html.ai-chat-page),
:global(body.ai-chat-page) {
  overflow: hidden;
  overscroll-behavior: none;
  height: 100%;
}

:global(html.ai-chat-page .VPContent),
:global(body.ai-chat-page .VPContent),
:global(html.ai-chat-page .VPDoc),
:global(body.ai-chat-page .VPDoc),
:global(body.ai-chat-page .VPDoc .container),
:global(body.ai-chat-page .VPDoc .content),
:global(body.ai-chat-page .VPDoc .content-container),
:global(body.ai-chat-page .VPDoc .main),
:global(body.ai-chat-page .VPDoc .vp-doc) {
  min-height: 0;
  overflow: hidden;
}

:global(html.ai-chat-page .VPContent),
:global(body.ai-chat-page .VPContent) {
  height: calc(100dvh - var(--vp-nav-height) - var(--vp-layout-top-height, 0px));
  overflow: hidden;
}

:global(html.ai-chat-page .VPDoc),
:global(body.ai-chat-page .VPDoc) {
  height: 100%;
  padding: 0 !important;
}

:global(body.ai-chat-page .VPDoc .container),
:global(body.ai-chat-page .VPDoc .content),
:global(body.ai-chat-page .VPDoc .content-container),
:global(body.ai-chat-page .VPDoc .main),
:global(body.ai-chat-page .VPDoc .vp-doc) {
  height: 100%;
}

.chat-shell {
  position: fixed;
  top: var(--ai-chat-top-offset, calc(var(--vp-nav-height) + var(--vp-layout-top-height, 0px)));
  right: 0;
  bottom: 0;
  left: 0;
  min-height: 0;
  padding: 0;
  overflow: hidden;
  box-sizing: border-box;
  z-index: 1;
}

@media (min-width: 960px) {
  .chat-shell {
    left: var(--vp-sidebar-width);
  }
}

.chatgpt {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  max-width: 960px;
  height: 100%;
  min-height: 0;
  margin: 0 auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  overflow: hidden;
  background: var(--vp-c-bg);
  box-sizing: border-box;
}

.chatgpt__topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  flex: 0 0 auto;
}

.chatgpt__brand {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.chatgpt__logo {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 800;
  letter-spacing: 0.04em;
  background: var(--vp-c-brand-1);
  flex-shrink: 0;
}

.chatgpt__brand-copy {
  min-width: 0;
}

.chatgpt__title {
  font-size: 0.98rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.chatgpt__subtitle {
  margin-top: 4px;
  font-size: 0.84rem;
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
  border: 1px solid var(--vp-c-divider);
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
  background: var(--vp-c-brand-1);
}

.chatgpt__ghost-btn {
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border-radius: 999px;
  padding: 8px 14px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s, color 0.2s;
}

.chatgpt__ghost-btn:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg-soft);
}

.chatgpt__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow: hidden;
  padding: 20px 20px 18px;
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
  margin: 0 auto;
  flex-shrink: 0;
}

.chatgpt__intro-card {
  padding: 18px 20px;
  border: 1px solid var(--vp-c-divider);
  border-left: 4px solid var(--vp-c-brand-1);
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
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

.chatgpt__message-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding-right: 4px;
}

.chatgpt__message-list::-webkit-scrollbar {
  width: 6px;
}

.chatgpt__message-list::-webkit-scrollbar-thumb {
  background: var(--vp-c-divider);
  border-radius: 999px;
}

.chatgpt__chip {
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border-radius: 999px;
  padding: 10px 14px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s, color 0.2s;
}

.chatgpt__chip:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg-soft);
}

.chatgpt__message {
  display: flex;
  gap: 14px;
  max-width: 780px;
  margin: 0 auto 18px;
}

.chatgpt__message--user {
  justify-content: flex-end;
  flex-direction: row-reverse;
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
  background: var(--vp-c-brand-1);
  color: #fff;
  font-weight: 800;
  flex-shrink: 0;
}

.chatgpt__bubble-wrap {
  min-width: 0;
  flex: 1;
}

.chatgpt__message--user .chatgpt__bubble-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.chatgpt__message--user .chatgpt__meta {
  justify-content: flex-end;
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
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  border: 1px solid var(--vp-c-divider);
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
}

.chatgpt__message--user .chatgpt__bubble {
  background: var(--vp-c-brand-soft);
  border-color: transparent;
  color: var(--vp-c-brand-1);
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
  padding: 16px 20px 20px;
  border-top: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  flex: 0 0 auto;
}

.chatgpt__composer-inner {
  max-width: 780px;
  margin: 0 auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  background: var(--vp-c-bg);
  overflow: hidden;
}

.chatgpt__composer-row {
  display: flex;
  align-items: stretch;
  gap: 10px;
  padding: 10px;
}

.chatgpt__input {
  flex: 1;
  min-width: 0;
  height: 42px;
  min-height: 42px;
  max-height: 42px;
  padding: 10px 14px;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--vp-c-text-1);
  font: inherit;
  line-height: 1.4;
}

.chatgpt__input::placeholder {
  color: var(--vp-c-text-3);
}

.chatgpt__input:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.chatgpt__send-btn {
  width: 42px;
  height: 42px;
  border: none;
  border-radius: 14px;
  background: var(--vp-c-brand-1);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.15s, opacity 0.2s, background 0.2s;
  flex-shrink: 0;
}

.chatgpt__send-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  background: var(--vp-c-brand-2);
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
    padding: 0;
  }

  .chatgpt {
    height: 100%;
    border-radius: 0;
    border-left: 0;
    border-right: 0;
  }

  .chatgpt__topbar,
  .chatgpt__composer,
  .chatgpt__body {
    padding-left: 12px;
    padding-right: 12px;
  }

  .chatgpt__topbar {
    padding-top: 10px;
    padding-bottom: 10px;
    gap: 8px;
  }

  .chatgpt__actions {
    gap: 8px;
    justify-content: space-between;
  }

  .chatgpt__subtitle,
  .chatgpt__status,
  .chatgpt__hint {
    display: none;
  }

  .chatgpt__logo {
    width: 32px;
    height: 32px;
    border-radius: 10px;
  }

  .chatgpt__title {
    font-size: 0.9rem;
  }

  .chatgpt__body {
    padding: 12px;
    gap: 10px;
  }

  .chatgpt__composer-row {
    padding: 8px;
    gap: 8px;
  }

  .chatgpt__intro {
    margin-bottom: 0;
  }

  .chatgpt__chips {
    gap: 8px;
    margin-top: 10px;
  }

  .chatgpt__chip {
    padding: 8px 12px;
    font-size: 0.84rem;
  }

  .chatgpt__message {
    gap: 10px;
    margin-bottom: 14px;
  }

  .chatgpt__avatar {
    width: 32px;
    height: 32px;
    border-radius: 10px;
  }

  .chatgpt__meta {
    margin-bottom: 6px;
    font-size: 0.72rem;
  }

  .chatgpt__bubble {
    padding: 11px 12px;
    border-radius: 16px;
    line-height: 1.6;
  }

  .chatgpt__composer {
    padding: 10px 12px 12px;
  }

  .chatgpt__composer-inner {
    border-radius: 14px;
  }

  .chatgpt__input {
    height: 38px;
    min-height: 38px;
    max-height: 38px;
    padding: 9px 12px;
    font-size: 0.92rem;
  }

  .chatgpt__send-btn {
    width: 38px;
    height: 38px;
    border-radius: 12px;
  }
}
</style>
