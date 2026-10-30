<script setup lang="ts">
import type { TrackChoice } from "./useTextTracks";
import type { QualityLevel } from "./useHls";

defineProps<{
  qualityLevels?: QualityLevel[];
  // -1 is automatic.
  selectedQuality?: number;
  playingQuality?: number;
  audioChoices: TrackChoice[];
  activeAudio: number | null;
  captionChoices: TrackChoice[];
  activeCaption: number | null;
}>();
const emit = defineEmits<{ audio: [index: number]; caption: [index: number | null]; quality: [index: number] }>();
</script>

<template>
  <div class="player-menu player-tracks" role="menu">
    <template v-if="qualityLevels && qualityLevels.length > 1">
      <p class="player-menu-label">Quality</p>
      <button type="button" role="menuitemradio" :aria-checked="selectedQuality === -1" :class="{ selected: selectedQuality === -1 }" @click="emit('quality', -1)">
        Auto<span v-if="selectedQuality === -1 && playingQuality !== undefined && playingQuality >= 0"> ({{ qualityLevels.find((l) => l.index === playingQuality)?.height }}p)</span>
      </button>
      <button
        v-for="level in qualityLevels"
        :key="'q-' + level.index"
        type="button"
        role="menuitemradio"
        :aria-checked="selectedQuality === level.index"
        :class="{ selected: selectedQuality === level.index }"
        @click="emit('quality', level.index)"
      >{{ level.height }}p</button>
    </template>
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
