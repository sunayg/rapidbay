<script setup lang="ts">
type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitCancelFullScreen?: () => void };
type FsElement = HTMLElement & { webkitRequestFullscreen?: (flags?: number) => void };

function toggle(): void {
  const doc = document as FsDocument;
  const root = document.documentElement as FsElement;
  if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
    if (root.requestFullscreen) void root.requestFullscreen().catch(() => {});
    else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
  } else if (doc.exitFullscreen) {
    void doc.exitFullscreen().catch(() => {});
  } else if (doc.webkitCancelFullScreen) {
    doc.webkitCancelFullScreen();
  }
}
</script>

<template>
  <button type="button" class="icon-btn fullscreen-btn" aria-label="Full screen" title="Full screen" @click="toggle">
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
  </button>
</template>
