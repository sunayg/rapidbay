<script setup lang="ts">
import type { SubtitleTrack } from "../lib/download";

// THE PLAYER HAND-OFF SEAM (Task 5 replaces this component's body).
//
// The legacy download screen did not navigate to a player route: once a play
// link existed (MP4 when ready, HLS while still downloading) it mounted the
// player in place, keyed by the link without its query string so a changed
// ?subs= count swaps the source instead of remounting the video. DownloadScreen
// keeps that contract and renders this component with the legacy player props.
// Until the real player lands this shows the link and a back button.
defineProps<{
  url: string;
  supported: boolean | null;
  subtitles: SubtitleTrack[];
  magnet: string;
  filename: string;
  downloadProgress: number | null;
  downloadStatus: string | null;
}>();

const emit = defineEmits<{ back: []; "stream-error": [] }>();
</script>

<template>
  <main class="player-host" data-screen="player-screen">
    <h1>Player</h1>
    <p class="player-host-url" data-testid="play-url">{{ url }}</p>
    <p>The player has not been ported yet.</p>
    <button type="button" class="icon-btn" @click="emit('back')">Back</button>
    <button type="button" class="icon-btn" @click="emit('stream-error')">Simulate stream error</button>
  </main>
</template>

<style>
.player-host { padding: var(--space-5) var(--gutter); }
.player-host-url { word-break: break-all; color: var(--text-dim); }
</style>
