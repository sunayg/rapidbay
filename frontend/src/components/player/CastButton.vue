<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { castVideo, loadCast, type CastLoader, type ChromecastLike } from "./useCast";

const props = withDefaults(
  defineProps<{ videoUrl: string; mediaTitle: string; video: HTMLVideoElement | null; loader?: CastLoader }>(),
  { loader: loadCast },
);

// null while the scripts load, false when they could not (no button then).
const available = ref<boolean | null>(null);
const error = ref("");
let cc: ChromecastLike | null = null;
let errorTimer: ReturnType<typeof setTimeout> | undefined;
let alive = true;

onMounted(async () => {
  cc = await props.loader().catch(() => null);
  if (alive) available.value = !!cc;
});
onBeforeUnmount(() => {
  alive = false;
  clearTimeout(errorTimer);
});

function showError(message: string): void {
  error.value = message;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => (error.value = ""), 6000);
}

async function cast(): Promise<void> {
  const problem = await castVideo({ videoUrl: props.videoUrl, title: props.mediaTitle, video: props.video, cc });
  if (problem && alive) showError(problem);
}
</script>

<template>
  <span v-if="available !== false" class="cast-wrap">
    <button type="button" class="icon-btn chromecast-btn" aria-label="Cast to TV" title="Cast to TV" @click="cast">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M3 8V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
        <path d="M3 12a8 8 0 0 1 8 8M3 16a4 4 0 0 1 4 4" />
        <circle cx="3.5" cy="19.5" r="0.8" />
      </svg>
    </button>
    <span v-if="error" class="cast-error" role="alert">{{ error }}</span>
  </span>
</template>
