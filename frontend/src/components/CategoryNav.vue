<script setup lang="ts">
defineProps<{ categories: { id: string; label: string }[]; selected: string }>();
defineEmits<{ select: [id: string] }>();
</script>

<template>
  <nav class="categories" aria-label="Settings categories">
    <button
      v-for="c in categories"
      :key="c.id"
      type="button"
      :class="{ active: c.id === selected }"
      :aria-current="c.id === selected ? 'page' : undefined"
      @click="$emit('select', c.id)"
    >
      {{ c.label }}
    </button>
  </nav>
</template>
