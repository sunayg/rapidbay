<script setup lang="ts">
import { computed } from "vue";
import { formatAirDate, type HomeTitle } from "../lib/titles";
import RankMark from "./RankMark.vue";

const props = defineProps<{ title: HomeTitle; showNext?: boolean }>();
defineEmits<{ (e: "select", title: HomeTitle): void }>();
const image = computed(() => props.title.poster_url || props.title.backdrop_url || "");
</script>

<template>
  <div class="rank-item">
    <RankMark :rank="title.rank" />
    <button type="button" class="poster-card" :aria-label="title.title" @click="$emit('select', title)">
      <img v-if="image" :src="image" :alt="title.title" loading="lazy" />
      <span v-if="showNext && title.next_air_date" class="card-next-air"><small>Next</small>{{ formatAirDate(title.next_air_date) }}</span>
    </button>
  </div>
</template>

<style>
.rank-item {
  position: relative;
  flex: 0 0 calc(var(--poster-w) * 2);
  width: calc(var(--poster-w) * 2);
  height: var(--poster-h);
  scroll-snap-align: start;
}
.rank-svg {
  position: absolute;
  top: 0;
  left: 0;
  display: block;
  width: var(--poster-w);
  height: var(--poster-h);
  pointer-events: none;
}
.poster-card {
  position: absolute;
  top: 0;
  left: var(--poster-w);
  z-index: 1;
  width: var(--poster-w);
  height: var(--poster-h);
  padding: 0;
  overflow: hidden;
  background: var(--surface);
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}
.poster-card img { display: block; width: 100%; height: 100%; object-fit: cover; }
.poster-card .card-next-air {
  position: absolute;
  right: 6px;
  bottom: 6px;
  z-index: 2;
  padding: 4px 6px;
  color: var(--text);
  background: rgba(0, 0, 0, 0.72);
  border-radius: 3px;
  text-shadow: none;
}
.poster-card:hover, .poster-card:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
</style>
