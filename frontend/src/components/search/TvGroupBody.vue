<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, watch } from "vue";
import { get, isAbortError } from "../../lib/api";
import {
  episodeResultRows,
  isEpisodeNumberWatched,
  latestEpisodeResults,
  resolutionSummary,
  seasonEpisodes,
  type EpisodeInfo,
  type Group,
  type ResultRow,
  type SearchResult,
  type Season,
  type SeasonEpisode,
} from "../../lib/results";
import EpisodeCard from "./EpisodeCard.vue";
import ResultList from "./ResultList.vue";

const props = defineProps<{
  group: Group;
  watchedEpisodes?: { season: number | string; episode: number | string }[];
}>();
const emit = defineEmits<{
  select: [result: SearchResult, season: number | null, episode: number | null];
  loaded: [];
}>();

const openSeasons = reactive<Record<number, boolean>>({});
const openEpisodes = reactive<Record<string, boolean>>({});
const openRanks = reactive<Record<string, boolean>>({});
// TMDB's episode list per season: undefined while loading, [] when unavailable.
const details = reactive<Record<number, EpisodeInfo[] | undefined>>({});
const requested = new Set<number>();
let alive = true;
onBeforeUnmount(() => {
  alive = false;
});

const seasons = computed(() => props.group.seasons || []);
const multiple = computed(() => seasons.value.length > 1);
const isSeasonOpen = (season: Season) => !multiple.value || !!openSeasons[season.season];

async function ensureDetails(season: Season): Promise<void> {
  const id = props.group.tmdb_id;
  if (!id || props.group.media_type !== "tv" || requested.has(season.season)) return;
  requested.add(season.season);
  let episodes: EpisodeInfo[] = [];
  try {
    const data = await get<{ episodes?: EpisodeInfo[] }>(`/api/tv/${encodeURIComponent(id)}/season/${encodeURIComponent(season.season)}/`);
    episodes = (data && data.episodes) || [];
  } catch (error) {
    // A route change aborts the request; the screen is going away anyway.
    if (isAbortError(error) || !alive) return;
  }
  if (!alive) return;
  details[season.season] = episodes;
  emit("loaded");
}

// Open seasons (all of them when there is only one) load their episode details,
// including seasons that appear as the stream delivers more results.
watch(
  () => [seasons.value.map((s) => s.season).join(","), { ...openSeasons }],
  () => {
    for (const season of seasons.value) if (isSeasonOpen(season)) void ensureDetails(season);
  },
  { immediate: true },
);

function toggleSeason(season: Season): void {
  if (!multiple.value) return;
  openSeasons[season.season] = !openSeasons[season.season];
}

const isLoading = (season: Season) => !!props.group.tmdb_id && details[season.season] === undefined;
const episodesOf = (season: Season): SeasonEpisode[] => seasonEpisodes(season, details[season.season]);

const rankKey = (scope: string, rank: number) => scope + ":" + rank;
function rowsFor(season: number | null, episode: number | null, results: SearchResult[], scope: string): ResultRow[] {
  return episodeResultRows(props.group, season, episode, results, (rank) => !!openRanks[rankKey(scope, rank)]);
}

const latest = computed(() => props.group.latest_episode || null);
const latestKey = computed(() => (latest.value ? `latest:${latest.value.season_number}:${latest.value.episode_number}` : ""));
const latestRows = computed(() =>
  latest.value ? rowsFor(latest.value.season_number, latest.value.episode_number, latestEpisodeResults(props.group), "latest") : [],
);

function toggleEpisode(key: string): void {
  openEpisodes[key] = !openEpisodes[key];
}

function onRow(row: ResultRow, scope: string, season: number | null, episode: number | null): void {
  if (row.type === "heading") return;
  if (row.type === "more") {
    openRanks[rankKey(scope, row.rank)] = true;
    return;
  }
  emit("select", row.result, season, episode);
}

const watched = (season: number | null, episode: number | null) => isEpisodeNumberWatched(props.watchedEpisodes, season, episode);
</script>

<template>
  <div class="tv-body">
    <section v-if="latest" class="latest-episode">
      <h3 class="section-label">Latest</h3>
      <EpisodeCard
        :season="latest.season_number"
        :episode="latest.episode_number"
        label="Latest episode"
        :details="latest"
        :watched="watched(latest.season_number, latest.episode_number)"
        :expanded="!!openEpisodes[latestKey]"
        @toggle="toggleEpisode(latestKey)"
      />
      <ResultList
        v-if="openEpisodes[latestKey] && latestRows.length"
        :rows="latestRows"
        label="Latest episode releases"
        @select="onRow($event, 'latest', latest.season_number, latest.episode_number)"
      />
    </section>

    <div v-for="season in seasons" :key="season.season" class="season-block">
      <h3 class="season-header">
        <button v-if="multiple" type="button" class="season-toggle" :aria-expanded="isSeasonOpen(season)" @click="toggleSeason(season)">
          <span class="season-caret" aria-hidden="true">{{ isSeasonOpen(season) ? "&#x25BE;" : "&#x25B8;" }}</span>
          Season {{ season.season }}
        </button>
        <template v-else>Season {{ season.season }}</template>
      </h3>
      <div v-if="resolutionSummary(season.episodes).length" class="season-resolutions">
        <span v-for="res in resolutionSummary(season.episodes)" :key="res.rank" class="resolution-chip">{{ res.name }} <b>{{ res.count }}</b></span>
      </div>
      <div v-if="isSeasonOpen(season)" class="episode-list">
        <div v-if="isLoading(season)" class="episode-loading" role="status">Loading episodes</div>
        <template v-else>
          <div v-for="episode in episodesOf(season)" :key="episode.key" class="episode-block">
            <EpisodeCard
              :season="season.season"
              :episode="episode.episode"
              :label="episode.label"
              :details="episode.details"
              :watched="watched(season.season, episode.episode)"
              :expanded="!!openEpisodes[season.season + ':' + episode.key]"
              @toggle="toggleEpisode(season.season + ':' + episode.key)"
            />
            <ResultList
              v-if="openEpisodes[season.season + ':' + episode.key]"
              :rows="rowsFor(season.season, episode.episode, episode.results, season.season + ':' + episode.key)"
              :label="episode.label + ' releases'"
              @select="onRow($event, season.season + ':' + episode.key, season.season, episode.episode)"
            />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style>
.tv-body { margin-top: var(--space-3); }
.section-label, .season-header { margin: var(--space-4) 0 var(--space-2); font-size: 1rem; font-weight: 600; }
.season-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 4px var(--space-2);
  margin-left: calc(-1 * var(--space-2));
  color: inherit;
  font: inherit;
  background: none;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
.season-toggle:hover { background: var(--surface-2); }
.season-toggle:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.season-resolutions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-bottom: var(--space-2); }
.resolution-chip { padding: 2px 10px; color: var(--text-dim); font-size: 0.8rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; }
.resolution-chip b { color: var(--text); }
.episode-list { display: flex; flex-direction: column; gap: var(--space-2); }
.episode-loading { padding: var(--space-3); color: var(--text-dim); }
.episode-block > .result-list { margin: 0 0 var(--space-2) var(--space-3); border-left: 2px solid var(--border-strong); }
.latest-episode > .result-list { margin: 0 0 var(--space-2) var(--space-3); border-left: 2px solid var(--border-strong); }
</style>
