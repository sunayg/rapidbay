<script setup lang="ts">
import { useRouter } from "vue-router";
import { navigateBack } from "../lib/nav";

const props = defineProps<{ fallback?: string }>();
const router = useRouter();
</script>

<template>
  <button type="button" class="icon-btn back-btn" aria-label="Back" title="Back" @click="navigateBack(router, props.fallback)">
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
  </button>
</template>

<style>
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 42px;
  height: 42px;
  padding: 0 var(--space-3);
  color: var(--text);
  font: inherit;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}
.icon-btn svg { fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.icon-btn:hover, .icon-btn:focus-visible { border-color: var(--focus); outline: none; box-shadow: 0 0 0 3px var(--focus-ring); }
.icon-btn[aria-pressed="true"] svg { fill: currentColor; }
</style>
