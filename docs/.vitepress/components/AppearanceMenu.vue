<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

type AppearanceMode = 'auto' | 'light' | 'dark'

const props = withDefaults(defineProps<{
  variant?: 'bar' | 'screen'
}>(), {
  variant: 'bar',
})

const storageKey = 'vitepress-theme-appearance'
const root = ref<HTMLElement | null>(null)
const open = ref(false)
const hovering = ref(false)
const focused = ref(false)
const mode = ref<AppearanceMode>('auto')
const systemDark = ref(false)

let mediaQuery: MediaQueryList | null = null

const items: Array<{ value: AppearanceMode; label: string; hint: string }> = [
  { value: 'auto', label: '自动', hint: '跟随系统设置' },
  { value: 'light', label: '日间', hint: '始终使用浅色模式' },
  { value: 'dark', label: '黑夜', hint: '始终使用深色模式' },
]

const activeLabel = computed(() => {
  return items.find(item => item.value === mode.value)?.label ?? '自动'
})

const effectiveDark = computed(() => {
  return mode.value === 'auto' ? systemDark.value : mode.value === 'dark'
})

const statusLabel = computed(() => {
  if (mode.value !== 'auto') {
    return activeLabel.value
  }

  return systemDark.value ? '自动 · 黑夜' : '自动 · 日间'
})

const isPanelVisible = computed(() => {
  return open.value || hovering.value || focused.value
})

function readStoredMode(): AppearanceMode {
  if (typeof window === 'undefined') {
    return 'auto'
  }

  const stored = window.localStorage.getItem(storageKey)
  if (stored === 'light' || stored === 'dark' || stored === 'auto') {
    return stored
  }

  return 'auto'
}

function applyTheme(nextMode: AppearanceMode) {
  mode.value = nextMode

  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(storageKey, nextMode)

  const shouldUseDark = nextMode === 'auto' ? systemDark.value : nextMode === 'dark'
  document.documentElement.classList.toggle('dark', shouldUseDark)
}

function syncSystemPreference() {
  if (!mediaQuery) {
    return
  }

  systemDark.value = mediaQuery.matches

  if (mode.value === 'auto') {
    document.documentElement.classList.toggle('dark', systemDark.value)
  }
}

function closePanel() {
  open.value = false
}

function onPointerEnter() {
  hovering.value = true
}

function onPointerLeave() {
  hovering.value = false

  if (!focused.value) {
    open.value = false
  }
}

function onFocusIn() {
  focused.value = true
}

function onFocusOut(event: FocusEvent) {
  const nextTarget = event.relatedTarget
  if (nextTarget instanceof Node && root.value?.contains(nextTarget)) {
    return
  }

  focused.value = false

  if (!hovering.value) {
    open.value = false
  }
}

function onWindowClick(event: MouseEvent) {
  if (!open.value || props.variant !== 'bar') {
    return
  }

  const target = event.target
  if (target instanceof Node && root.value?.contains(target)) {
    return
  }

  closePanel()
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    closePanel()
  }
}

onMounted(() => {
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  systemDark.value = mediaQuery.matches
  mode.value = readStoredMode()
  document.documentElement.classList.toggle('dark', mode.value === 'auto' ? systemDark.value : mode.value === 'dark')

  mediaQuery.addEventListener('change', syncSystemPreference)
  window.addEventListener('click', onWindowClick, true)
  window.addEventListener('keydown', onWindowKeydown)
})

onBeforeUnmount(() => {
  mediaQuery?.removeEventListener('change', syncSystemPreference)
  window.removeEventListener('click', onWindowClick, true)
  window.removeEventListener('keydown', onWindowKeydown)
})
</script>

<template>
  <div
    ref="root"
    class="AppearanceMenu"
    :class="[
      `AppearanceMenu--${variant}`,
      {
        'is-open': open,
        'is-hovered': hovering,
        'is-focused': focused,
        'is-dark': effectiveDark,
        'is-auto': mode === 'auto',
      },
    ]"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
    <template v-if="variant === 'bar'">
      <button
        class="AppearanceMenu__trigger AppearanceMenu__trigger--icon"
        type="button"
        :aria-expanded="isPanelVisible"
        aria-haspopup="menu"
        :title="`外观：${statusLabel}`"
        @click="open = !open"
      >
        <span class="AppearanceMenu__icon">
          <span class="vpi-sun AppearanceMenu__sun" />
          <span class="vpi-moon AppearanceMenu__moon" />
        </span>
      </button>

      <transition name="appearance-menu">
        <div
          v-show="isPanelVisible"
          class="AppearanceMenu__panel"
          role="menu"
          aria-label="外观设置"
        >
          <button
            v-for="item in items"
            :key="item.value"
            class="AppearanceMenu__option"
            :class="{ 'is-active': mode === item.value }"
            type="button"
            role="menuitemradio"
            :aria-checked="mode === item.value"
            @click="applyTheme(item.value)"
          >
            <span class="AppearanceMenu__optionLabel">{{ item.label }}</span>
            <span class="AppearanceMenu__optionHint">{{ item.hint }}</span>
          </button>
        </div>
      </transition>
    </template>

    <template v-else>
      <div class="AppearanceMenu__screen">
        <div class="AppearanceMenu__screenHeader">
          <div class="AppearanceMenu__screenTitle">外观</div>
          <div class="AppearanceMenu__screenSubtitle">当前：{{ statusLabel }}</div>
        </div>

        <div class="AppearanceMenu__grid">
          <button
            v-for="item in items"
            :key="item.value"
            class="AppearanceMenu__option AppearanceMenu__option--screen"
            :class="{ 'is-active': mode === item.value }"
            type="button"
            role="menuitemradio"
            :aria-checked="mode === item.value"
            @click="applyTheme(item.value)"
          >
            <span class="AppearanceMenu__optionLabel">{{ item.label }}</span>
            <span class="AppearanceMenu__optionHint">{{ item.hint }}</span>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
