<script setup lang="ts">
withDefaults(defineProps<{ heading?: string; subheading?: string; progress?: number | null; inline?: boolean }>(), {
  heading: "",
  subheading: "",
  progress: null,
  inline: false,
});
</script>

<template>
  <div class="spinner" :class="{ 'spinner-inline': inline }" role="status" aria-live="polite">
    <div v-if="heading" class="spinner-heading">{{ heading }}</div>
    <div v-if="subheading" class="spinner-sub">{{ subheading }}</div>
    <span class="spinner-ring" aria-hidden="true"></span>
    <span class="sr-only">Loading</span>
    <div
      v-if="progress !== null"
      class="spinner-progress"
      role="progressbar"
      :aria-valuenow="progress"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div class="spinner-progress-bar" :style="{ width: Math.min(100, Math.max(0, progress)) + '%' }"></div>
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
.spinner-progress { width: 100%; height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
.spinner-progress-bar { height: 100%; background: var(--text); transition: width 0.3s; }
@keyframes spinner-rotate { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner-ring { animation-duration: 3s; } }
</style>
