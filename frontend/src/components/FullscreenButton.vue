<script setup lang="ts">
import { toggleFullscreen } from "../lib/fullscreen";
</script>

<template>
  <button type="button" class="icon-btn fullscreen-btn" aria-label="Full screen" title="Full screen" @click="toggleFullscreen">
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
  </button>
</template>
