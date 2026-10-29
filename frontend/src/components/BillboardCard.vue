<script setup lang="ts">
import { computed } from "vue";
import { cardSubtitle, formatAirDate, type HomeTitle } from "../lib/titles";

const props = defineProps<{ title: HomeTitle; showRemaining?: boolean; showNext?: boolean }>();
defineEmits<{ (e: "select", title: HomeTitle): void }>();
const image = computed(() => props.title.backdrop_url || props.title.poster_url || "");
const subtitle = computed(() => cardSubtitle(props.title));
</script>

<template>
  <button type="button" class="billboard-card" @click="$emit('select', title)">
    <img v-if="image" :src="image" :alt="title.title" loading="lazy" />
    <span class="billboard-card-shade">
      <span class="billboard-card-copy">
        <span class="billboard-card-title">{{ title.title }}</span>
        <span v-if="subtitle" class="billboard-card-sub">{{ subtitle }}</span>
      </span>
      <span v-if="showRemaining && title.minutes_left" class="card-remaining">{{ title.minutes_left }} min left</span>
      <span v-if="showNext && title.next_air_date" class="card-next-air"><small>Next</small>{{ formatAirDate(title.next_air_date) }}</span>
    </span>
  </button>
</template>

<style>
.billboard-card {
  position: relative;
  flex: 0 0 var(--billboard-w);
  width: var(--billboard-w);
  height: var(--billboard-h);
  padding: 0;
  overflow: hidden;
  color: var(--text);
  background: var(--surface);
  border: 0;
  border-radius: var(--radius);
  cursor: pointer;
  scroll-snap-align: start;
}
.billboard-card img { display: block; width: 100%; height: 100%; object-fit: cover; }
.billboard-card-shade {
  position: absolute;
  inset: auto 0 0 0;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-2);
  padding: 28px var(--space-3) var(--space-2);
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.88));
  text-align: left;
}
.billboard-card-copy { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; }
.billboard-card-title { font-size: 0.95rem; font-weight: 700; line-height: 1.25; }
.billboard-card-sub { margin-top: 2px; color: var(--text-dim); font-size: 0.75rem; }
.card-remaining, .card-next-air {
  flex: 0 0 auto;
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1.15;
  text-align: right;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
}
.card-next-air small {
  display: block;
  margin-bottom: 1px;
  color: var(--text-dim);
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1;
  text-transform: uppercase;
}
.billboard-card:hover, .billboard-card:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
</style>
