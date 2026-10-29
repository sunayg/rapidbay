<script setup lang="ts">
import { computed, useId } from "vue";
import { RANK_MARKS } from "../lib/rankMarks";

const props = defineProps<{ rank?: number | null }>();
const uid = useId();
const art = computed(() => RANK_MARKS[props.rank || 1] || RANK_MARKS[1]);
const fadeId = computed(() => `rank-fade-${uid}`);
const clipId = computed(() => `rank-clip-${uid}`);
</script>

<template>
  <svg
    class="rank-svg"
    :viewBox="`0 0 ${art.w} ${art.h}`"
    fill="none"
    :opacity="art.opacity"
    preserveAspectRatio="xMaxYMid meet"
    aria-hidden="true"
  >
    <g :clip-path="`url(#${clipId})`">
      <path
        v-for="(mark, index) in art.paths"
        :key="index"
        :d="mark.d"
        :transform="mark.translate ? `translate(${mark.translate})` : undefined"
        fill-rule="evenodd"
        clip-rule="evenodd"
        :fill="mark.fill ? `url(#${fadeId})` : 'none'"
        :stroke="mark.fill ? 'none' : `url(#${fadeId})`"
        :stroke-width="mark.fill ? 0 : 2.5"
        stroke-linejoin="miter"
        stroke-linecap="butt"
      />
    </g>
    <defs>
      <linearGradient :id="fadeId" :x1="art.x1" :y1="art.y1" :x2="art.x2" :y2="art.y2" gradientUnits="userSpaceOnUse">
        <stop stop-color="white" />
        <stop offset="1" stop-color="white" stop-opacity="0" />
      </linearGradient>
      <clipPath :id="clipId"><rect :width="art.w" :height="art.h" fill="white" /></clipPath>
    </defs>
  </svg>
</template>
