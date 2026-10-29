<script setup lang="ts">
import { episodeCode, formatFullAirDate, formatRating, formatRuntime, type EpisodeInfo } from "../../lib/results";

// One episode (or the "latest episode" teaser): still, code and name, air date,
// runtime, rating and plot. Clicking toggles its variations.
defineProps<{
  season: number | null;
  episode: number | null;
  label: string;
  details: EpisodeInfo | null;
  watched: boolean;
  expanded: boolean;
}>();
const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
  <div class="episode-card" tabindex="0" role="button" :aria-expanded="expanded" @click="emit('toggle')">
    <img v-if="details && details.still_url" class="episode-still" :src="details.still_url" :alt="details.name || label" loading="lazy" />
    <div v-else class="episode-still episode-still-empty" aria-hidden="true"></div>
    <div class="episode-copy">
      <div class="episode-title">
        <template v-if="episode !== null && season !== null">
          {{ episodeCode(season, episode) }}<template v-if="details && details.name"> &middot; {{ details.name }}</template>
        </template>
        <template v-else>{{ label }}</template>
        <span v-if="watched" class="watched-mark" title="Watched" role="img" aria-label="Watched">&#x2713;</span>
      </div>
      <div v-if="details && (details.air_date || details.runtime || details.vote_average)" class="episode-meta">
        <span v-if="details.air_date">{{ formatFullAirDate(details.air_date) }}</span>
        <span v-if="details.runtime">{{ formatRuntime(details.runtime) }}</span>
        <span v-if="details.vote_average">{{ formatRating(details.vote_average) }}/10</span>
      </div>
      <p v-if="details && details.overview" class="episode-plot">{{ details.overview }}</p>
    </div>
  </div>
</template>

<style>
.episode-card {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-2);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}
.episode-card:hover { background: var(--surface-3); }
.episode-card:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.episode-still { flex: 0 0 auto; width: 128px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 6px; background: var(--surface-3); }
.episode-copy { min-width: 0; }
.episode-title { font-weight: 600; }
.episode-meta { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); margin-top: 2px; color: var(--text-dim); font-size: 0.85rem; }
.episode-plot {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  margin: var(--space-1) 0 0;
  overflow: hidden;
  color: var(--text-dim);
  font-size: 0.875rem;
}
.watched-mark { margin-left: var(--space-2); color: #3ecf8e; }
@media (max-width: 480px) {
  .episode-still { display: none; }
}
</style>
