<script setup lang="ts">
import type { TrackChoice } from "./useTextTracks";

defineProps<{
  audioChoices: TrackChoice[];
  activeAudio: number | null;
  captionChoices: TrackChoice[];
  activeCaption: number | null;
}>();
const emit = defineEmits<{ audio: [index: number]; caption: [index: number | null] }>();
</script>

<template>
  <div class="player-menu player-tracks" role="menu">
    <p class="player-menu-label">Audio</p>
    <button
      v-for="track in audioChoices"
      :key="'aud-' + track.index"
      type="button"
      role="menuitemradio"
      :aria-checked="activeAudio === track.index"
      :class="{ selected: activeAudio === track.index }"
      @click="emit('audio', track.index)"
    >{{ track.label }}</button>
    <button v-if="!audioChoices.length" type="button" class="selected" role="menuitemradio" aria-checked="true">Original</button>
    <p class="player-menu-label">Subtitles</p>
    <button type="button" role="menuitemradio" :aria-checked="activeCaption === null" :class="{ selected: activeCaption === null }" @click="emit('caption', null)">Off</button>
    <button
      v-for="track in captionChoices"
      :key="'cap-' + track.index"
      type="button"
      role="menuitemradio"
      :aria-checked="activeCaption === track.index"
      :class="{ selected: activeCaption === track.index }"
      @click="emit('caption', track.index)"
    >{{ track.label }}</button>
    <p v-if="!captionChoices.length" class="player-menu-empty">No subtitles</p>
  </div>
</template>
