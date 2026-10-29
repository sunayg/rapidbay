<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, onUpdated, ref } from "vue";

defineProps<{ heading: string; scrollerClass?: string }>();

const scroller = ref<HTMLElement | null>(null);
const showPrev = ref(false);
const showNext = ref(false);

function refresh(): void {
  const el = scroller.value;
  if (!el) return;
  const max = el.scrollWidth - el.clientWidth;
  showPrev.value = el.scrollLeft > 2;
  showNext.value = max > 2 && el.scrollLeft < max - 2;
}

function nudge(direction: -1 | 1): void {
  const el = scroller.value;
  if (!el) return;
  const amount = Math.max(220, Math.round(el.clientWidth * 0.8));
  el.scrollBy({ left: direction * amount, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

onMounted(() => {
  window.addEventListener("resize", refresh);
  void nextTick(refresh);
});
onUpdated(refresh);
onBeforeUnmount(() => window.removeEventListener("resize", refresh));
defineExpose({ refresh });
</script>

<template>
  <section class="home-row">
    <h2 class="home-row-heading">{{ heading }}</h2>
    <div class="home-row-rail">
      <button type="button" class="row-nudge row-nudge-prev" aria-label="See previous titles" :hidden="!showPrev" @click="nudge(-1)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <div ref="scroller" class="billboard-scroller" :class="scrollerClass" @scroll.passive="refresh">
        <slot />
      </div>
      <button type="button" class="row-nudge row-nudge-next" aria-label="See more titles" :hidden="!showNext" @click="nudge(1)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
      </button>
    </div>
    <slot name="footer" />
  </section>
</template>

<style>
.home-row { margin: 0 0 var(--space-6); }
.home-row-heading {
  margin: 0 0 var(--space-3);
  padding-left: var(--gutter);
  font-size: 1.2rem;
  font-weight: 700;
}
.home-row-rail { position: relative; }
.billboard-scroller {
  display: flex;
  align-items: flex-end;
  gap: var(--space-3);
  overflow-x: auto;
  overflow-y: hidden;
  padding: 6px 0 6px var(--gutter);
  scroll-padding-left: var(--gutter);
  scroll-snap-type: x proximity;
  scrollbar-width: none;
}
.billboard-scroller::-webkit-scrollbar { display: none; }
.billboard-scroller::after { content: ""; flex: 0 0 var(--space-4); }
.poster-scroller { align-items: center; gap: var(--space-2); }
.row-nudge {
  position: absolute;
  top: 0;
  bottom: 4px;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  padding: 0;
  color: var(--text);
  background: rgba(0, 0, 0, 0.55);
  border: 0;
  cursor: pointer;
}
.row-nudge[hidden] { display: none; }
.row-nudge-prev { left: 0; }
.row-nudge-next { right: 0; }
.row-nudge svg { width: 22px; height: 22px; }
.row-nudge svg path { fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.row-nudge:hover, .row-nudge:focus-visible { background: rgba(0, 0, 0, 0.8); }
@media (pointer: coarse) { .row-nudge { display: none; } }
</style>
