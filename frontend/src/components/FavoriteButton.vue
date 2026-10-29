<script setup lang="ts">
import { computed } from "vue";
import { library, refreshLibrary, removeFavorite, saveFavorite } from "../lib/library";
import { get_hash } from "../lib/magnet";

// A torrent is favourited with an empty filename, a single file with its name.
const props = withDefaults(defineProps<{ magnet: string; filename?: string }>(), { filename: "" });

refreshLibrary();

const favorited = computed(() => {
  const hash = get_hash(props.magnet);
  return library.favorites.some((f) => get_hash(f.magnet) === hash && (f.filename || "") === props.filename);
});

function toggle(): void {
  if (favorited.value) removeFavorite(props.magnet, props.filename);
  else saveFavorite(props.magnet, props.filename);
}
</script>

<template>
  <button
    type="button"
    class="icon-btn favorite-btn"
    :aria-label="favorited ? 'Remove from favorites' : 'Add to favorites'"
    :aria-pressed="favorited ? 'true' : 'false'"
    @click="toggle"
  >
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M12 3.5l2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.9 6.7 19.8l1.1-5.9L3.4 9.8l6-.8z" />
    </svg>
  </button>
</template>
