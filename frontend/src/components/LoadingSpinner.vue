<script setup lang="ts">
withDefaults(
  defineProps<{
    heading?: string;
    subheading?: string;
    progress?: number | null;
    // Where on the bar (0 to 100) something happens, with a caption saying what: here, where playback can begin.
    marker?: number | null;
    markerLabel?: string;
    inline?: boolean;
  }>(),
  { heading: "", subheading: "", progress: null, marker: null, markerLabel: "", inline: false },
);
</script>

<template>
  <div class="spinner" :class="{ 'spinner-inline': inline }" role="status" aria-live="polite">
    <div v-if="heading" class="spinner-heading">{{ heading }}</div>
    <div v-if="subheading" class="spinner-sub">{{ subheading }}</div>
    <span class="spinner-ring" aria-hidden="true"></span>
    <span class="sr-only">Loading</span>
    <div v-if="progress !== null" class="spinner-bar">
      <div
        class="spinner-progress"
        role="progressbar"
        :aria-valuenow="progress"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="marker !== null && markerLabel ? markerLabel + ' at ' + Math.round(marker) + '%' : undefined"
      >
        <div class="spinner-progress-bar" :style="{ width: Math.min(100, Math.max(0, progress)) + '%' }"></div>
      </div>
      <div v-if="marker !== null" class="spinner-marker" :class="{ reached: progress >= marker }" :style="{ left: Math.min(100, Math.max(0, marker)) + '%' }"></div>
      <div v-if="marker !== null && markerLabel" class="spinner-marker-label" :class="{ reached: progress >= marker }">
        {{ markerLabel }}
      </div>
    </div>
  </div>
</template>

<style>
.spinner {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  width: min(300px, 90vw);
  text-align: center;
}
.spinner-inline {
  position: static;
  transform: none;
  width: auto;
  padding: var(--space-6) 0;
}
.spinner-heading { font-size: 1.1rem; text-transform: capitalize; }
.spinner-sub { color: var(--text-dim); font-size: 0.9rem; }
.spinner-ring {
  width: 48px;
  height: 48px;
  border: 4px solid var(--border);
  border-top-color: var(--text);
  border-radius: 50%;
  animation: spinner-rotate 0.9s linear infinite;
}
.spinner-bar { position: relative; width: 100%; padding-bottom: var(--space-4); }
.spinner-marker { position: absolute; top: -4px; width: 3px; height: 14px; margin-left: -1.5px; border-radius: 2px; background: var(--warn, #f5b942); }
.spinner-marker.reached { background: var(--accent, #4ade80); }
.spinner-marker-label { margin-top: var(--space-2); font-size: 0.8rem; color: var(--text-dim); }
.spinner-marker-label.reached { color: var(--text); }
.spinner-progress { width: 100%; height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
.spinner-progress-bar { height: 100%; background: var(--text); transition: width 0.3s; }
@keyframes spinner-rotate { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner-ring { animation-duration: 3s; } }
</style>
