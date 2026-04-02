<script setup>
import {computed, nextTick, onMounted, onUnmounted, reactive, ref} from 'vue'

/* global __AI_STREAM_URL__ */
const WORKER_BASE_URL = normalizeWorkerBaseUrl(__AI_STREAM_URL__)
const STREAM_URL = buildWorkerEndpoint(WORKER_BASE_URL, '/stream_run')
const AUTH_URL = buildWorkerEndpoint(WORKER_BASE_URL, '/auth/token')

const AUTH_QUESTION = '我是谁？'
const AUTH_REQUIRED_MESSAGE = '认证已失效，请重新回答验证问题。'
const greeting = '验证通过，你可以开始提问。'
const STREAM_REQUEST_TIMEOUT_MS = 90_000
const AI_SESSION_STORAGE_KEY = 'mora-ai-session-id'
const AI_CHAT_HISTORY_STORAGE_KEY = 'mora-ai-chat-history'
const AI_AUTH_TOKEN_STORAGE_KEY = 'mora-ai-token'
const AI_AUTH_EXPIRES_STORAGE_KEY = 'mora-ai-token-expires-at'
const AI_RUN_ID_HEADER = 'X-Run-Id'
const TERMINAL_STREAM_EVENT_TYPES = new Set([
  'done',
  'message_end',
  'message_stop',
])

const suggestions = [
  '介绍一下你的技术栈'
]

const messages = ref([
  createAuthChallengeMessage(),
])

const inputText = ref('')
const loading = ref(false)
const authVerifying = ref(false)
const authToken = ref('')
const authExpiresAt = ref(0)
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
let requestTimeoutId = null
let timedOutRequestId = null
let currentRequestId = 0
let chatSessionId = createSessionId()

const AI_CHAT_TOP_OFFSET_VAR = '--ai-chat-top-offset'

function createGreetingMessage() {
  return {
    role: 'assistant',
    content: greeting,
    id: 0,
  }
}

function createAuthChallengeMessage(reason = '') {
  const content = reason
    ? `${reason}\n\n${AUTH_QUESTION}`
    : AUTH_QUESTION

  return {
    role: 'assistant',
    content,
    id: 0,
  }
}

function hasValidAuthToken() {
  return Boolean(authToken.value) && authExpiresAt.value > Date.now()
}

const isAuthenticated = computed(() => hasValidAuthToken())

const statusLabel = computed(() => {
  if (authVerifying.value) return '验证中'
  if (loading.value) return '生成中'
  return isAuthenticated.value ? '在线' : '待验证'
})

const composerPlaceholder = computed(() => (
  isAuthenticated.value ? '提出你的问题' : '请输入答案'
))

const showSuggestions = computed(() => (
  isAuthenticated.value && messages.value.length === 1 && !loading.value && !authVerifying.value
))

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

function flushTypingBuffer() {
  if (typingMessage && typingBuffer) {
    typingMessage.content += typingBuffer
  }

  typingBuffer = ''
}

function clearRequestTimeout() {
  if (requestTimeoutId) {
    clearTimeout(requestTimeoutId)
    requestTimeoutId = null
  }
}

function normalizeStreamToken(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function createSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizeWorkerBaseUrl(url) {
  if (typeof url !== 'string') return ''
  return url.trim().replace(/\/+$/, '')
}

function buildWorkerEndpoint(baseUrl, path) {
  const normalizedPath = typeof path === 'string' && path.startsWith('/')
    ? path
    : `/${path || ''}`

  if (!baseUrl) {
    return normalizedPath
  }

  return `${baseUrl}${normalizedPath}`
}

function loadSessionId() {
  if (typeof window === 'undefined') {
    return createSessionId()
  }

  try {
    const stored = window.sessionStorage.getItem(AI_SESSION_STORAGE_KEY)
    return stored && stored.trim() ? stored : createSessionId()
  } catch {
    return createSessionId()
  }
}

function clearAuthSessionStorage() {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage.removeItem(AI_AUTH_TOKEN_STORAGE_KEY)
    window.sessionStorage.removeItem(AI_AUTH_EXPIRES_STORAGE_KEY)
  } catch {
    // sessionStorage 不可用时忽略
  }
}

function persistAuthSession() {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (!hasValidAuthToken()) {
      window.sessionStorage.removeItem(AI_AUTH_TOKEN_STORAGE_KEY)
      window.sessionStorage.removeItem(AI_AUTH_EXPIRES_STORAGE_KEY)
      return
    }

    window.sessionStorage.setItem(AI_AUTH_TOKEN_STORAGE_KEY, authToken.value)
    window.sessionStorage.setItem(AI_AUTH_EXPIRES_STORAGE_KEY, String(authExpiresAt.value))
  } catch {
    // sessionStorage 不可用时忽略
  }
}

function setAuthSession(token, expiresInSeconds) {
  authToken.value = token
  authExpiresAt.value = Date.now() + Math.floor(expiresInSeconds * 1000)
  persistAuthSession()
}

function clearAuthSession() {
  authToken.value = ''
  authExpiresAt.value = 0
  clearAuthSessionStorage()
}

function restoreAuthSession() {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    const storedToken = window.sessionStorage.getItem(AI_AUTH_TOKEN_STORAGE_KEY) || ''
    const storedExpiresAt = Number(window.sessionStorage.getItem(AI_AUTH_EXPIRES_STORAGE_KEY) || 0)

    if (!storedToken || !Number.isFinite(storedExpiresAt) || storedExpiresAt <= Date.now()) {
      clearAuthSession()
      return false
    }

    authToken.value = storedToken
    authExpiresAt.value = storedExpiresAt
    return true
  } catch {
    clearAuthSession()
    return false
  }
}

function clearChatHistoryStorage() {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage.removeItem(AI_CHAT_HISTORY_STORAGE_KEY)
  } catch {
    // sessionStorage 不可用时忽略
  }
}

function syncSessionId(nextSessionId) {
  chatSessionId = nextSessionId

  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage.setItem(AI_SESSION_STORAGE_KEY, nextSessionId)
  } catch {
    // sessionStorage 不可用时仅保留内存态会话 ID
  }
}

function resetChatSessionId() {
  syncSessionId(createSessionId())
}

function normalizeStoredMessage(message) {
  if (!message || typeof message !== 'object') {
    return null
  }

  const role = message.role === 'user' || message.role === 'assistant' ? message.role : ''
  const content = typeof message.content === 'string' ? message.content : ''
  const id = Number(message.id)

  if (!role || !Number.isFinite(id)) {
    return null
  }

  return {
    role,
    content,
    id,
  }
}

function getPersistableMessages() {
  const snapshot = messages.value.map((message) => ({
    role: message.role,
    content: message.content,
    id: message.id,
  }))

  if (typingMessage && typingBuffer) {
    const snapshotTypingMessage = snapshot.find((message) => message.id === typingMessage.id)
    if (snapshotTypingMessage) {
      snapshotTypingMessage.content += typingBuffer
    }
  }

  return snapshot
}

function persistChatHistory() {
  if (typeof window === 'undefined' || !hasValidAuthToken()) {
    return
  }

  try {
    window.sessionStorage.setItem(
      AI_CHAT_HISTORY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        messages: getPersistableMessages(),
      })
    )
  } catch {
    // sessionStorage 不可用或容量不足时忽略
  }
}

function loadChatHistory() {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const stored = window.sessionStorage.getItem(AI_CHAT_HISTORY_STORAGE_KEY)
    if (!stored) {
      return null
    }

    const parsed = JSON.parse(stored)
    const rawMessages = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.messages)
        ? parsed.messages
        : null

    if (!rawMessages) {
      return null
    }

    const restoredMessages = rawMessages
      .map(normalizeStoredMessage)
      .filter(Boolean)

    if (!restoredMessages.length) {
      return null
    }

    while (restoredMessages.length > 0) {
      const lastMessage = restoredMessages[restoredMessages.length - 1]
      if (lastMessage.role === 'assistant' && !lastMessage.content.trim()) {
        restoredMessages.pop()
        continue
      }
      break
    }

    return restoredMessages.length ? restoredMessages : null
  } catch {
    return null
  }
}

function restoreChatHistory() {
  const restoredMessages = loadChatHistory()

  if (restoredMessages) {
    messages.value = restoredMessages.map((message) => ({
      role: message.role,
      content: message.content,
      id: message.id,
    }))

    idCounter = restoredMessages.reduce((maxId, message) => Math.max(maxId, message.id), -1) + 1
  } else {
    messages.value = [
      createGreetingMessage(),
    ]
    idCounter = 1
  }

  loading.value = false
  persistChatHistory()
}

function resetToAuthChallenge(reason = '') {
  currentRequestId += 1
  timedOutRequestId = null
  clearRequestTimeout()

  if (activeController) {
    activeController.abort()
    activeController = null
  }

  resetTypingState()
  clearAuthSession()
  clearChatHistoryStorage()
  resetChatSessionId()
  loading.value = false
  authVerifying.value = false
  messages.value = [
    createAuthChallengeMessage(reason),
  ]
  idCounter = 1
  scrollToBottom()
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
  if (typingMessage) {
    typingMessage.streaming = false
  }
  typingMessage = null
  typingBuffer = ''
  typingStreamFinished = false
  lastIncomingText = ''
  loading.value = false
  activeController = null
  persistChatHistory()
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
  persistChatHistory()
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
  const normalizedBuffer = buffer.replace(/\r\n/g, '\n')
  const blocks = normalizedBuffer.split(/\n\n+/)

  for (const block of blocks) {
    if (!block.trim()) continue

    let event = ''
    let sawSseField = false
    const dataLines = []

    for (const line of block.split('\n')) {
      if (!line.trim()) continue

      if (line.startsWith(':')) {
        sawSseField = true
        continue
      }

      if (line.startsWith('event:')) {
        sawSseField = true
        event = line.slice(6).trim().toLowerCase()
        continue
      }

      if (line.startsWith('data:')) {
        sawSseField = true
        dataLines.push(line.slice(5).replace(/^ /, ''))
        continue
      }

      if (line.startsWith('id:') || line.startsWith('retry:')) {
        sawSseField = true
      }
    }

    results.push({
      event,
      payload: sawSseField ? dataLines.join('\n') : block.trim(),
    })
  }

  return results
}

function parseStreamPayload(payload) {
  if (!payload) return null

  const normalizedPayload = payload.trim()
  if (!normalizedPayload) return null

  if (normalizedPayload === '[DONE]' || normalizedPayload === '[done]') {
    return { type: 'done' }
  }

  try {
    return JSON.parse(normalizedPayload)
  } catch {
    return normalizedPayload
  }
}

function getStreamEventType(event, data) {
  if (data && typeof data === 'object' && typeof data.type === 'string') {
    return normalizeStreamToken(data.type)
  }

  const eventType = normalizeStreamToken(event?.event)
  if (eventType && eventType !== 'message') {
    return eventType
  }

  if (typeof data === 'string') {
    return 'content_chunk'
  }

  return ''
}

function extractStreamText(data) {
  if (typeof data === 'string') return data
  if (!data || typeof data !== 'object') return null

  if (typeof data.content === 'string') return data.content
  if (typeof data.delta === 'string') return data.delta
  if (typeof data.text === 'string') return data.text
  if (typeof data.message === 'string') return data.message

  if (data.content && typeof data.content === 'object') {
    if (typeof data.content.text === 'string') return data.content.text
    if (typeof data.content.content === 'string') return data.content.content
    if (typeof data.content.answer === 'string') return data.content.answer
    if (typeof data.content.delta === 'string') return data.content.delta
  }

  const firstChoice = Array.isArray(data.choices) ? data.choices[0] : null
  if (firstChoice?.delta) {
    if (typeof firstChoice.delta.content === 'string') return firstChoice.delta.content
    if (typeof firstChoice.delta.text === 'string') return firstChoice.delta.text
  }
  if (firstChoice?.message) {
    if (typeof firstChoice.message.content === 'string') return firstChoice.message.content
    if (typeof firstChoice.message.text === 'string') return firstChoice.message.text
  }

  if (typeof data.answer === 'string') return data.answer

  return null
}

function extractStreamErrorMessage(data) {
  if (typeof data === 'string') return data
  if (!data || typeof data !== 'object') return null

  if (typeof data.content === 'string') return data.content
  if (typeof data.message === 'string') return data.message
  if (typeof data.error === 'string') return data.error
  if (data.error && typeof data.error.message === 'string') return data.error.message

  return null
}

function armRequestTimeout(requestId, controller) {
  clearRequestTimeout()

  requestTimeoutId = window.setTimeout(() => {
    if (requestId !== currentRequestId) return

    timedOutRequestId = requestId
    controller.abort()
  }, STREAM_REQUEST_TIMEOUT_MS)
}

function createAssistantMessage() {
  return reactive({
    role: 'assistant',
    content: '',
    id: idCounter++,
    streaming: true,
  })
}

async function parseJsonResponse(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function extractApiErrorMessage(data) {
  if (!data || typeof data !== 'object') return null
  if (typeof data.error === 'string' && data.error.trim()) return data.error
  if (typeof data.message === 'string' && data.message.trim()) return data.message
  if (typeof data.code === 'string' && data.code.trim()) return data.code
  return null
}

async function submitAuthAnswer(answerText) {
  const answer = typeof answerText === 'string' ? answerText.trim() : ''
  if (!answer || authVerifying.value || loading.value) {
    return
  }

  const userMessage = { role: 'user', content: answer, id: idCounter++ }
  const assistantMsg = reactive({
    role: 'assistant',
    content: '验证中...',
    id: idCounter++,
    streaming: true,
  })

  messages.value.push(userMessage)
  messages.value.push(assistantMsg)
  inputText.value = ''
  authVerifying.value = true
  loading.value = true
  scrollToBottom()

  try {
    const response = await fetch(AUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ answer }),
    })

    const payload = await parseJsonResponse(response)

    if (!response.ok) {
      const reason = extractApiErrorMessage(payload) || `认证失败：${response.status}`
      const retryAfter = Number(payload?.retryAfter)
      assistantMsg.content = response.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0
        ? `${reason}，请 ${retryAfter} 秒后重试。`
        : reason
      assistantMsg.streaming = false
      return
    }

    const token = typeof payload?.token === 'string' ? payload.token.trim() : ''
    const expiresIn = Number(payload?.expiresIn)
    if (!token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      assistantMsg.content = '认证响应无效，请稍后重试。'
      assistantMsg.streaming = false
      return
    }

    setAuthSession(token, expiresIn)
    resetChatSessionId()
    messages.value = [
      createGreetingMessage(),
    ]
    idCounter = 1
    loading.value = false
    authVerifying.value = false
    persistChatHistory()
    scrollToBottom()
  } catch (err) {
    assistantMsg.content = `网络错误：${err?.message || '请求失败'}`
    assistantMsg.streaming = false
  } finally {
    authVerifying.value = false
    loading.value = false
    scrollToBottom()
  }
}

async function sendMessage(questionText) {
  const text = typeof questionText === 'string' ? questionText.trim() : ''
  if (!text) return

  if (!hasValidAuthToken()) {
    resetToAuthChallenge(AUTH_REQUIRED_MESSAGE)
    return
  }

  if (activeController) {
    currentRequestId += 1
    timedOutRequestId = null
    clearRequestTimeout()
    activeController.abort()
    activeController = null
  }

  currentRequestId += 1
  const requestId = currentRequestId
  timedOutRequestId = null
  clearRequestTimeout()
  resetTypingState()

  const userMessage = { role: 'user', content: text, id: idCounter++ }
  messages.value.push(userMessage)
  inputText.value = ''

  const assistantMsg = createAssistantMessage()
  messages.value.push(assistantMsg)
  loading.value = true
  persistChatHistory()
  scrollToBottom()

  startTypingSession(assistantMsg)

  const controller = new AbortController()
  activeController = controller
  armRequestTimeout(requestId, controller)

  const failRequest = (message) => {
    if (requestId !== currentRequestId) return

    clearRequestTimeout()
    if (!controller.signal.aborted) {
      controller.abort()
    }
    flushTypingBuffer()
    resetTypingState()
    assistantMsg.content = assistantMsg.content
      ? `${assistantMsg.content}\n\n${message}`
      : message
    assistantMsg.streaming = false
    loading.value = false
    activeController = null
    persistChatHistory()
    scrollToBottom()
  }

  try {
    const runId = createSessionId()
    const requestPayload = {
      type: 'query',
      session_id: chatSessionId,
      content: {
        query: {
          prompt: [
            {
              type: 'text',
              content: {
                text,
              },
            },
          ],
        },
      },
    }

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      [AI_RUN_ID_HEADER]: runId,
    }
    headers.Authorization = `Bearer ${authToken.value}`

    const response = await fetch(STREAM_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    })

    if (!response.ok) {
      if (response.status === 401) {
        resetToAuthChallenge(AUTH_REQUIRED_MESSAGE)
        return
      }
      failRequest(`请求失败：${response.status} ${response.statusText}`)
      return
    }

    if (!response.body) {
      failRequest('请求成功，但响应体为空。')
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let streamEndedBySignal = false

    const processStreamEvent = (event) => {
      const data = parseStreamPayload(event.payload)
      const eventType = getStreamEventType(event, data)

      if (eventType === 'error') {
        failRequest(extractStreamErrorMessage(data) || '请求失败。')
        return false
      }

      if (eventType === 'status') {
        const status = normalizeStreamToken(data?.status)
        if (status === 'cancelled') {
          failRequest(extractStreamErrorMessage(data) || '请求已取消。')
          return false
        }
        return true
      }

      if (TERMINAL_STREAM_EVENT_TYPES.has(eventType)) {
        streamEndedBySignal = true
        return true
      }

      if (eventType === 'tool_call' || eventType === 'tool_result') {
        return true
      }

      const textChunk = extractStreamText(data)
      if (textChunk) {
        appendIncomingText(textChunk)
      }

      return true
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        clearRequestTimeout()
        break
      }

      buffer += decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')

      const lastEventEnd = buffer.lastIndexOf('\n\n')
      if (lastEventEnd === -1) continue

      const processable = buffer.slice(0, lastEventEnd)
      buffer = buffer.slice(lastEventEnd + 2)

      for (const event of parseSSEEvents(processable)) {
        if (!processStreamEvent(event)) {
          return
        }
        if (streamEndedBySignal) {
          break
        }
      }

      if (streamEndedBySignal) {
        clearRequestTimeout()
        break
      }
    }

    buffer += decoder.decode()
    buffer = buffer.replace(/\r\n/g, '\n')

    if (!streamEndedBySignal && buffer.trim()) {
      for (const event of parseSSEEvents(buffer)) {
        if (!processStreamEvent(event)) {
          return
        }
        if (streamEndedBySignal) {
          break
        }
      }
    }

    finishTypingSession()

    if (streamEndedBySignal) {
      void reader.cancel().catch(() => {
        // 终止信号后的取消只用于尽快释放连接，忽略二次错误
      })
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      if (timedOutRequestId === requestId) {
        failRequest('请求超时，请稍后重试。')
      }
      return
    }

    failRequest(`网络错误：${err?.message || '请求失败'}`)
  } finally {
    if (requestId === currentRequestId) {
      clearRequestTimeout()
    }
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
  if (loading.value || authVerifying.value) return

  if (!hasValidAuthToken()) {
    submitAuthAnswer(inputText.value)
    return
  }

  sendMessage(inputText.value)
}

function useSuggestion(text) {
  if (!hasValidAuthToken()) return
  sendMessage(text)
}

function clearChat() {
  currentRequestId += 1
  timedOutRequestId = null
  clearRequestTimeout()

  if (activeController) {
    activeController.abort()
    activeController = null
  }

  resetTypingState()
  loading.value = false
  authVerifying.value = false

  if (hasValidAuthToken()) {
    resetChatSessionId()
    messages.value = [
      createGreetingMessage(),
    ]
    persistChatHistory()
  } else {
    clearAuthSession()
    clearChatHistoryStorage()
    messages.value = [
      createAuthChallengeMessage(),
    ]
    idCounter = 1
  }

  scrollToBottom()
}

onMounted(() => {
  syncSessionId(loadSessionId())
  setAiChatPageLocked(true)
  refreshAiChatTopOffset()
  const authed = restoreAuthSession()
  if (authed) {
    restoreChatHistory()
  } else {
    clearChatHistoryStorage()
    messages.value = [
      createAuthChallengeMessage(),
    ]
    idCounter = 1
  }
  resizeListener = () => refreshAiChatTopOffset()
  window.addEventListener('resize', resizeListener)
  inputRef.value?.focus()
  scrollToBottom()
})

onUnmounted(() => {
  setAiChatPageLocked(false)
  currentRequestId += 1
  timedOutRequestId = null
  clearRequestTimeout()

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
          <span class="chatgpt__status" :class="{ 'is-loading': loading || authVerifying }">
            <span class="chatgpt__status-dot"></span>
            {{ statusLabel }}
          </span>
          <button type="button" class="chatgpt__ghost-btn" @click="clearChat">清空</button>
        </div>
      </header>

      <main class="chatgpt__body">
        <div class="chatgpt__intro" v-if="showSuggestions">
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
              :placeholder="composerPlaceholder"
              rows="1"
              @input="handleInput"
              @keydown="handleKeydown"
            ></textarea>

            <button
              type="button"
              class="chatgpt__send-btn"
              :disabled="!inputText.trim() || loading || authVerifying"
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
