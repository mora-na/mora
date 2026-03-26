<script setup>
import {computed} from 'vue'
import {useData} from 'vitepress'

const { frontmatter, page } = useData()

const title = computed(() => frontmatter.value.title || page.value.title)
const description = computed(() => frontmatter.value.description || page.value.description)
const showHeader = computed(() => {
  if (frontmatter.value.docHeader === false) {
    return false
  }

  return Boolean(title.value || description.value)
})
</script>

<template>
  <header v-if="showHeader" class="doc-header">
    <h1 v-if="title" class="doc-header__title">{{ title }}</h1>
    <p v-if="description" class="doc-header__description">{{ description }}</p>
  </header>
</template>
