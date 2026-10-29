<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import BackButton from "../components/BackButton.vue";
import FavoriteButton from "../components/FavoriteButton.vue";
import FullscreenButton from "../components/FullscreenButton.vue";
import LoadingSpinner from "../components/LoadingSpinner.vue";
import { get, isAbortError, post, routeTimeout, subscribe } from "../lib/api";
import { getCompletedFiles } from "../lib/library";
import {
  clearEpisodeTarget,
  decodeMagnetParam,
  get_hash,
  isExecutableFilename,
  magnetPath,
  pickEpisodeFile,
  readEpisodeTarget,
} from "../lib/magnet";

interface FilesPayload {
  files?: string[] | null;
  file_statuses?: Record<string, string>;
  done?: boolean;
}

const route = useRoute();
const router = useRouter();

const magnet = computed(() => decodeMagnetParam(String(route.params.magnet_link ?? "")));
const hash = computed(() => get_hash(magnet.value));

const files = ref<string[] | null>(null);
const statuses = ref<Record<string, string>>({});
const completed = ref<string[]>([]);
const failed = ref(false);
const listEl = ref<HTMLElement | null>(null);

let alive = true;
let opened = false;
let polling = false;
let source: EventSource | null = null;

function closeSource(): void {
  if (source) source.close();
  source = null;
}

function mark(file: string): "done" | "downloaded" | "downloading" | "" {
  if (completed.value.indexOf(file) !== -1) return "done";
  const status = statuses.value[file];
  return status === "downloaded" || status === "downloading" ? status : "";
}

const MARK_TEXT = { done: "Watched", downloaded: "Downloaded", downloading: "Downloading", "": "" } as const;

function open(file: string): void {
  void router.push(magnetPath(magnet.value, file));
}

// The one file to play (single non-executable file, or the remembered episode)
// replaces this screen so Back returns past it.
function autoOpen(file: string): void {
  if (opened) return;
  opened = true;
  clearEpisodeTarget();
  closeSource();
  void router.replace(magnetPath(magnet.value, file));
}

function applyFiles(data: FilesPayload): void {
  if (!alive || opened) return;
  const list = data.files;
  if (list && list.length === 1 && !isExecutableFilename(list[0])) return autoOpen(list[0]);
  const target = readEpisodeTarget();
  if (target && list && list.length) {
    const chosen = pickEpisodeFile(list, target.season, target.episode);
    if (chosen) return autoOpen(chosen);
    clearEpisodeTarget();
  }
  files.value = list ?? [];
  statuses.value = data.file_statuses || {};
  void nextTick(focusFirstUnwatched);
}

function focusFirstUnwatched(): void {
  const rows = listEl.value?.querySelectorAll<HTMLElement>(".file-row");
  if (!rows || !rows.length) return;
  const list = files.value || [];
  let index = list.findIndex((file) => completed.value.indexOf(file) === -1);
  if (index < 0) index = 0;
  rows[index]?.focus();
}

function poll(): void {
  if (polling) return;
  polling = true;
  const tick = async (): Promise<void> => {
    try {
      const data = await get<FilesPayload>("/api/magnet/" + hash.value + "/");
      if (!alive) return;
      if (data.files == null) return routeTimeout(tick, 1000);
      applyFiles(data);
    } catch (error) {
      if (alive && !isAbortError(error)) failed.value = true;
    }
  };
  void tick();
}

async function start(): Promise<void> {
  failed.value = false;
  completed.value = getCompletedFiles(magnet.value);
  try {
    await post("/api/magnet_files/", { magnet_link: magnet.value });
  } catch (error) {
    if (alive && !isAbortError(error)) failed.value = true;
    return;
  }
  if (!alive) return;
  // The server pushes the file list the moment metadata resolves.
  source = subscribe<FilesPayload>(
    "/api/magnet_events/" + hash.value + "/",
    (data) => {
      if (data.files) applyFiles(data);
      if (data.done) source = null;
    },
    () => {
      source = null;
      poll();
    },
  );
}

function retry(): void {
  polling = false;
  closeSource();
  void start();
}

onMounted(start);
onBeforeUnmount(() => {
  alive = false;
  closeSource();
});
watch(magnet, () => {
  // Same screen, different torrent: start over.
  opened = false;
  files.value = null;
  retry();
});
</script>

<template>
  <main class="dl-root" data-screen="filelist-screen">
    <div class="topbar dl-topbar">
      <BackButton fallback="/" />
      <h1 class="dl-title">Files</h1>
      <div class="dl-actions">
        <FavoriteButton :magnet="magnet" filename="" />
        <FullscreenButton />
      </div>
    </div>
    <div class="dl-body">
      <div v-if="failed" class="dl-error" role="alert">
        <p>Couldn't load the file list.</p>
        <button type="button" class="dl-button" @click="retry">Try again</button>
      </div>
      <LoadingSpinner v-else-if="files === null" heading="Fetching file list" />
      <p v-else-if="files.length === 0" class="empty-state">No files found in this torrent.</p>
      <ul v-else ref="listEl" class="file-list">
        <li v-for="file in files" :key="file">
          <button type="button" class="file-row" @click="open(file)">
            <span class="file-mark" :class="'mark-' + mark(file)" aria-hidden="true">
              {{ mark(file) === "done" ? "✓" : mark(file) === "downloaded" ? "●" : mark(file) === "downloading" ? "○" : "" }}
            </span>
            <span class="file-name">{{ file }}</span>
            <span v-if="mark(file)" class="sr-only">{{ MARK_TEXT[mark(file)] }}</span>
          </button>
        </li>
      </ul>
    </div>
  </main>
</template>

<style>
.dl-root { position: relative; min-height: 100vh; min-height: 100dvh; text-align: left; }
.dl-topbar { position: sticky; top: 0; justify-content: flex-start; }
.dl-title { margin: 0; font-size: 1.1rem; flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dl-actions { display: flex; gap: var(--space-2); margin-left: auto; }
.dl-body { position: relative; max-width: 1040px; min-height: 60vh; margin: 0 auto; padding: var(--space-4) var(--gutter) 64px; }
.dl-error { margin: var(--space-6) 0; color: var(--danger-text); text-align: center; }
.dl-button {
  padding: var(--space-2) var(--space-4);
  color: var(--text);
  font: inherit;
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  cursor: pointer;
}
.dl-button:hover, .dl-button:focus-visible { border-color: var(--focus); outline: none; box-shadow: 0 0 0 3px var(--focus-ring); }
.dl-button:disabled { opacity: 0.55; cursor: default; }
.file-list { list-style: none; margin: 0; padding: 0; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
.file-list li + li { border-top: 1px solid var(--border); }
.file-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  color: var(--text);
  font: inherit;
  text-align: left;
  background: none;
  border: 0;
  cursor: pointer;
}
.file-row:hover { background: var(--surface-2); }
.file-row:focus-visible { outline: none; background: var(--surface-3); box-shadow: inset 3px 0 0 var(--focus); }
.file-mark { flex: 0 0 1.2em; color: var(--text-dim); text-align: center; }
.file-mark.mark-done { color: #4cc38a; }
.file-name { min-width: 0; overflow-wrap: anywhere; }
</style>
