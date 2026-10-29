<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { isTextEntry } from "../../lib/focus";
import {
  formatRating,
  formatRuntime,
  groupKey,
  movieResultRows,
  type Group,
  type ResultRow,
  type SearchResult,
} from "../../lib/results";
import ResultList from "./ResultList.vue";
import TvGroupBody from "./TvGroupBody.vue";

// A TMDB title with its releases. Collapsed it is one focusable card; opening it
// (click, Enter/Select) reveals the movie's releases or the TV seasons/episodes.
const props = defineProps<{
  group: Group;
  autoOpen?: boolean;
  watchedAt?: number | null;
  watchedEpisodes?: { season: number | string; episode: number | string }[];
}>();
const emit = defineEmits<{
  select: [result: SearchResult, season: number | null, episode: number | null];
}>();

const card = ref<HTMLElement | null>(null);
const open = ref(false);
const openRanks = reactive<Record<number, boolean>>({});

const key = computed(() => groupKey(props.group));
const isTv = computed(() => props.group.media_type === "tv");
const hasSide = computed(() => !!(props.group.poster_url || props.group.genres?.length || props.group.vote_average || props.group.runtime));
const movieRows = computed(() => movieResultRows(props.group, (rank) => !!openRanks[rank]));

// Moves the focus into the opened card, unless the user is typing elsewhere or
// already focused something inside it.
function focusContents(): void {
  void nextTick(() => {
    const root = card.value;
    if (!root) return;
    const active = document.activeElement;
    if (isTextEntry(active)) return;
    if (active !== root && root.contains(active) && active !== document.body) return;
    root.querySelector<HTMLElement>(".episode-card, .season-toggle, .result-row")?.focus();
  });
}

function openCard(): void {
  if (open.value) return;
  open.value = true;
  focusContents();
}

watch(
  () => props.autoOpen,
  (value) => {
    if (value) open.value = true;
  },
  { immediate: true },
);

function onMovieRow(row: ResultRow): void {
  if (row.type === "heading") return;
  if (row.type === "more") {
    openRanks[row.rank] = true;
    return;
  }
  emit("select", row.result, null, null);
}

const backdropStyle = computed(() => (props.group.backdrop_url ? { backgroundImage: `url(${JSON.stringify(props.group.backdrop_url)})` } : undefined));
</script>

<template>
  <section
    ref="card"
    class="group-card"
    :class="{ 'group-card-backed': group.backdrop_url, 'group-card-collapsed': !open }"
    :data-group-key="key"
    :tabindex="open ? -1 : 0"
    :role="open ? undefined : 'button'"
    :aria-label="open ? undefined : `${group.title}${group.year ? ' (' + group.year + ')' : ''}: show results`"
    @click="openCard"
  >
    <div v-if="group.backdrop_url" class="group-backdrop" :style="backdropStyle"></div>
    <div v-if="hasSide" class="group-side">
      <img v-if="group.poster_url" :src="group.poster_url" class="group-poster" :alt="group.title + ' poster'" loading="lazy" />
      <div v-if="group.genres?.length || group.vote_average || group.runtime" class="group-side-meta">
        <div v-if="group.genres?.length" class="group-genres">
          <span v-for="genre in group.genres" :key="genre" class="group-genre">{{ genre }}</span>
        </div>
        <div v-if="group.runtime" class="group-runtime">{{ formatRuntime(group.runtime) }}</div>
        <div v-if="group.vote_average" class="group-rating">{{ formatRating(group.vote_average) }}<span>/10</span></div>
      </div>
    </div>
    <div class="group-info">
      <h2 class="group-title">
        {{ group.title }}<span v-if="group.year" class="group-year"> ({{ group.year }})</span
        ><span v-if="!isTv && watchedAt" class="watched-mark" title="Watched" role="img" aria-label="Watched">&#x2713;</span>
      </h2>
      <p v-if="group.overview" class="group-plot">{{ group.overview }}</p>
      <p v-if="!open" class="group-open-hint">Show results</p>
      <TvGroupBody
        v-else-if="isTv"
        :group="group"
        :watched-episodes="watchedEpisodes"
        @select="(result, season, episode) => emit('select', result, season, episode)"
        @loaded="focusContents"
      />
      <ResultList v-else :rows="movieRows" :label="group.title + ' releases'" @select="onMovieRow" />
    </div>
  </section>
</template>

<style>
.group-card {
  position: relative;
  display: flex;
  gap: var(--space-4);
  padding: var(--space-4);
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}
.group-card-collapsed { cursor: pointer; }
.group-card-collapsed:hover { background: var(--surface-2); }
.group-card:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; box-shadow: 0 0 0 4px var(--focus-ring); }
.group-backdrop {
  position: absolute;
  inset: 0;
  background-position: center 20%;
  background-size: cover;
  opacity: 0.22;
  pointer-events: none;
}
.group-backdrop::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, var(--surface) 10%, transparent 90%); }
.group-side, .group-info { position: relative; }
.group-side { flex: 0 0 132px; display: flex; flex-direction: column; gap: var(--space-2); }
.group-poster { display: block; width: 100%; aspect-ratio: 2 / 3; object-fit: cover; border-radius: var(--radius); background: var(--surface-3); }
.group-side-meta { display: flex; flex-direction: column; gap: var(--space-1); color: var(--text-dim); font-size: 0.85rem; }
.group-genres { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.group-genre { padding: 1px 8px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; }
.group-rating { color: var(--text); font-weight: 600; }
.group-rating span { color: var(--text-dim); font-weight: 400; }
.group-info { flex: 1 1 auto; min-width: 0; }
.group-title { margin: 0; font-size: 1.35rem; line-height: 1.25; }
.group-year { color: var(--text-dim); font-weight: 400; }
.group-plot {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  margin: var(--space-2) 0 0;
  overflow: hidden;
  color: var(--text-dim);
}
.group-card:not(.group-card-collapsed) .group-plot { display: block; -webkit-line-clamp: unset; line-clamp: unset; }
.group-open-hint { margin: var(--space-3) 0 0; color: var(--link); font-size: 0.9rem; }
.group-info > .result-list { margin-top: var(--space-3); }
@media (max-width: 640px) {
  .group-card { padding: var(--space-3); gap: var(--space-3); }
  .group-side { flex-basis: 84px; }
  .group-card:not(.group-card-collapsed) .group-side { display: none; }
  .group-genres, .group-runtime { display: none; }
  .group-title { font-size: 1.15rem; }
}
</style>
