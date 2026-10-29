<script setup lang="ts">
import type { SubtitleTrack } from "../lib/download";
import PlayerView from "./player/PlayerView.vue";

// THE PLAYER HAND-OFF SEAM.
//
// The legacy download screen did not navigate to a player route: once a play
// link existed (MP4 when ready, HLS while still downloading) it mounted the
// player in place, keyed by the link without its query string so a changed
// ?subs= count swaps the source instead of remounting the video. DownloadScreen
// keeps that contract; this component keeps the legacy player props and events
// so it needs no change. HLS -> MP4 is a different key, hence a remount: the
// outgoing player saves its position and the incoming one resumes from it.
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
  <PlayerView
    :url="url"
    :supported="supported"
    :subtitles="subtitles"
    :magnet="magnet"
    :filename="filename"
    :download-progress="downloadProgress"
    :download-status="downloadStatus"
    @back="emit('back')"
    @stream-error="emit('stream-error')"
  />
</template>
