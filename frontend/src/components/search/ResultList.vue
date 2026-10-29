<script setup lang="ts">
import { formatSize, type ResultRow } from "../../lib/results";

defineProps<{ rows: ResultRow[]; label?: string }>();
const emit = defineEmits<{ select: [row: ResultRow] }>();

const STATUS_TEXT: Record<string, string> = { downloaded: "Downloaded", downloading: "Downloading" };
</script>

<template>
  <ul class="result-list" :aria-label="label || 'Results'">
    <template v-for="row in rows" :key="row.key">
      <li v-if="row.type === 'heading'" class="result-heading">{{ row.label }}</li>
      <li v-else-if="row.type === 'more'">
        <button type="button" class="result-row result-more" @click="emit('select', row)">{{ row.label }}</button>
      </li>
      <li v-else>
        <button type="button" class="result-row" :title="row.result.title" @click="emit('select', row)">
          <span
            v-if="row.result.status && STATUS_TEXT[row.result.status]"
            class="result-status"
            :class="'result-status-' + row.result.status"
            :title="STATUS_TEXT[row.result.status]"
            role="img"
            :aria-label="STATUS_TEXT[row.result.status]"
          ></span>
          <span class="result-label">{{ row.label }}</span>
          <span v-if="row.result.seeds" class="result-seeds">{{ row.result.seeds }} {{ row.result.seeds === 1 ? "seed" : "seeds" }}</span>
          <span v-if="row.result.size" class="result-size">{{ formatSize(row.result.size) }}</span>
        </button>
      </li>
    </template>
  </ul>
</template>

<style>
.result-list { margin: 0; padding: 0; list-style: none; }
.result-heading {
  padding: var(--space-3) var(--space-3) var(--space-1);
  color: var(--text-dim);
  font-size: 0.8rem;
  font-weight: 600;
}
.result-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  width: 100%;
  padding: 10px var(--space-3);
  color: var(--text);
  font: inherit;
  text-align: left;
  background: none;
  border: 0;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  cursor: pointer;
}
.result-list li:last-child > .result-row { border-bottom-color: transparent; }
.result-row:hover { background: var(--surface-2); }
.result-row:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; background: var(--surface-3); }
.result-label { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.result-seeds, .result-size { flex: 0 0 auto; color: var(--text-dim); font-size: 0.85rem; white-space: nowrap; }
.result-more { color: var(--link); }
.result-status {
  flex: 0 0 auto;
  align-self: center;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-sizing: border-box;
}
.result-status-downloaded { background: #3ecf8e; }
.result-status-downloading { border: 2px solid #f5a524; }
@media (max-width: 480px) {
  .result-row { flex-wrap: wrap; row-gap: 2px; }
  .result-label { flex: 1 1 calc(100% - 28px); }
}
</style>
