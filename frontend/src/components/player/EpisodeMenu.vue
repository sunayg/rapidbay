<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { EpisodeChoice } from "./media";

const props = defineProps<{
  groups: { season: number; episodes: EpisodeChoice[] }[];
  loading: boolean;
  empty: boolean;
  showTitle: string;
  focusedKey: string;
}>();
const emit = defineEmits<{ play: [episode: EpisodeChoice]; focus: [episode: EpisodeChoice] }>();

const root = ref<HTMLElement | null>(null);
const keyOf = (e: EpisodeChoice) => e.season + "-" + e.episode;

function buttons(): HTMLElement[] {
  return root.value ? Array.from(root.value.querySelectorAll<HTMLElement>(".player-episode")) : [];
}

// Keep a button inside the scrolling list.
function reveal(button: HTMLElement | null): void {
  const scroller = root.value && root.value.querySelector<HTMLElement>(".player-episode-scroll");
  if (!scroller || !button) return;
  const box = scroller.getBoundingClientRect();
  const rect = button.getBoundingClientRect();
  if (rect.height >= scroller.clientHeight) scroller.scrollTop += rect.top - box.top;
  else if (rect.top < box.top) scroller.scrollTop -= box.top - rect.top;
  else if (rect.bottom > box.bottom) scroller.scrollTop += rect.bottom - box.bottom;
}

function focusPlaying(): void {
  void nextTick(() => {
    const all = buttons();
    const button = root.value?.querySelector<HTMLElement>(".player-episode.current") || all[0];
    if (!button) return;
    button.focus({ preventScroll: true });
    void nextTick(() => reveal(button));
  });
}

// Up/down walk the list. Taken on window in the capture phase, ahead of the
// shared spatial-focus handler that would otherwise jump out of the menu.
onMounted(() => {
  window.addEventListener("keydown", onKeydown, true);
  if (props.groups.length) focusedList = true;
  focusPlaying();
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown, true));
// Focus the playing episode once, when the list first appears. Details that
// arrive later replace the list again; that must not pull focus back.
let focusedList = false;
watch(
  () => props.groups,
  (groups) => {
    if (focusedList || !groups.length) return;
    focusedList = true;
    focusPlaying();
  },
);

function onKeydown(event: KeyboardEvent): void {
  const key = event.key.toLowerCase();
  if (key !== "arrowdown" && key !== "arrowup") return;
  const all = buttons();
  if (!all.length || !root.value || !root.value.contains(document.activeElement)) return;
  event.preventDefault();
  event.stopPropagation();
  const index = Math.max(0, all.indexOf(document.activeElement as HTMLElement));
  const button = all[key === "arrowdown" ? Math.min(all.length - 1, index + 1) : Math.max(0, index - 1)];
  const season = Number(button.dataset.season);
  const number = Number(button.dataset.episode);
  for (const group of props.groups) {
    const found = group.episodes.find((e) => e.season === season && e.episode === number);
    if (found) emit("focus", found);
  }
  button.focus({ preventScroll: true });
  reveal(button);
}

function hover(episode: EpisodeChoice, event: Event): void {
  emit("focus", episode);
  const button = event.currentTarget as HTMLElement;
  if (document.activeElement !== button) button.focus({ preventScroll: true });
  reveal(button);
}
</script>

<template>
  <div ref="root" class="player-menu player-episodes">
    <p v-if="showTitle" class="player-episode-show">{{ showTitle }}</p>
    <div class="player-episode-scroll">
      <p v-if="loading" class="player-menu-empty">Loading episodes</p>
      <div v-for="group in groups" :key="'season-' + group.season">
        <p v-if="groups.length > 1" class="player-episode-season">Season {{ group.season }}</p>
        <button
          v-for="episode in group.episodes"
          :key="keyOf(episode)"
          type="button"
          class="player-episode"
          :data-season="episode.season"
          :data-episode="episode.episode"
          :class="{ current: episode.current, focused: focusedKey === keyOf(episode) }"
          @mouseenter="hover(episode, $event)"
          @focus="emit('focus', episode)"
          @click="emit('play', episode)"
        >
          <span class="player-episode-line">
            <span class="player-episode-num">{{ episode.episode }}</span>
            <span class="player-episode-name">{{ episode.name || "Episode " + episode.episode }}</span>
            <span v-if="episode.current" class="player-episode-now">Now playing</span>
          </span>
          <span v-if="(episode.current || focusedKey === keyOf(episode)) && (episode.stillUrl || episode.overview)" class="player-episode-detail">
            <span v-if="episode.stillUrl" class="player-episode-still" :style="{ backgroundImage: 'url(' + episode.stillUrl + ')' }"></span>
            <span v-if="episode.overview" class="player-episode-plot">{{ episode.overview }}</span>
          </span>
        </button>
      </div>
      <p v-if="!loading && empty" class="player-menu-empty">No other episodes</p>
    </div>
  </div>
</template>
