<script setup lang="ts">
// Quick subtitle cycle: off -> first track -> next ... -> off. Shows the
// language of the track on screen; absent while the video has no tracks.
defineProps<{ trackCount: number; current: string | null }>();
const emit = defineEmits<{ cycle: [] }>();
</script>

<template>
  <button
    v-if="trackCount > 0"
    type="button"
    class="player-btn caption-btn"
    :class="{ on: !!current }"
    aria-label="Change subtitles"
    title="Change subtitles"
    @click="emit('cycle')"
  >
    <span v-if="current" class="caption-lang">{{ current.slice(0, 3) }}</span>
    <svg v-else viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M8 11.5a2 2 0 1 0 0 1M15 11.5a2 2 0 1 0 0 1" />
    </svg>
  </button>
</template>
