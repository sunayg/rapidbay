<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import BackButton from "../components/BackButton.vue";
import FavoriteButton from "../components/FavoriteButton.vue";
import FullscreenButton from "../components/FullscreenButton.vue";
import LoadingSpinner from "../components/LoadingSpinner.vue";
import PlayerHost from "../components/PlayerHost.vue";
import { get, isAbortError, post, routeTimeout, subscribe } from "../lib/api";
import {
  canCancelStatus,
  headingFor,
  hlsLink,
  isAppleBrowser,
  isHlsLink,
  mp4Link,
  playLinkIdentity,
  STREAM_STARTING,
  streamDeclinedMessage,
  subheadingFor,
  subtitleTracks,
  type FileInfo,
  type SubtitleTrack,
} from "../lib/download";
import { getVideoPosition, reportLibraryEvents, saveToHistory } from "../lib/library";
import { navigateBack } from "../lib/nav";
import { decodeMagnetParam, get_hash, get_magnet_name, magnetPath } from "../lib/magnet";

const route = useRoute();
const router = useRouter();

const magnet = computed(() => decodeMagnetParam(String(route.params.magnet_link ?? "")));
const filename = computed(() => String(route.params.filename ?? ""));
const hash = computed(() => get_hash(magnet.value));
const backTarget = computed(() => magnetPath(magnet.value));

const status = ref<string | null>(null);
const progress = ref<number | null>(null); // percent, for the bar
const heading = ref("");
const subheading = ref<string | null>(null);
const playLink = ref<string | null>(null);
const subtitles = ref<SubtitleTrack[]>([]);
const supported = ref<boolean | null>(null);
const downloadProgress = ref<number | null>(null);
const canStream = ref(false);
const streamRequested = ref(false);
const hlsFailed = ref(false);
const streamMessage = ref<string | null>(null);
const cancelling = ref(false);
const failed = ref<string | null>(null);

const canCancel = computed(() => canCancelStatus(status.value));

let alive = true;
let source: EventSource | null = null;
let polling = false;

function closeSource(): void {
  if (source) source.close();
  source = null;
}

function goBack(): void {
  navigateBack(router, backTarget.value);
}

// ---- status -> view state (legacy applyFileInfo) ---------------------------------

function applyFileInfo(data: FileInfo): void {
  if (!alive || !data || !data.status) return;
  failed.value = null;
  status.value = data.status;
  progress.value = data.progress === 0 || data.progress ? data.progress * 100 : null;
  heading.value = headingFor(data);
  subheading.value = subheadingFor(data);

  // Play the adaptive HLS stream whenever there is one, even once the MP4 is ready:
  // switching to the MP4 would drop the quality levels and restart the player. The
  // MP4 is for files that were converted without a stream.
  if (data.hls_filename && !hlsFailed.value) {
    const link = hlsLink(hash.value, data.hls_filename, (data.hls_subtitles || []).length);
    // Never swap an encode session for an older stream of the same file.
    if (!playLink.value || (isHlsLink(playLink.value) && !playLink.value.startsWith("/api/hls/"))) {
      if (playLink.value !== link) playLink.value = link;
      supported.value = true;
    }
  } else if (data.status === "ready" && data.filename) {
    if (data.playback === "session") {
      // Nothing to link yet: ask the server for an encode session, resuming where the viewer left off.
      if (!playLink.value) void openSession();
    } else {
      const link = mp4Link(hash.value, data.filename);
      if (playLink.value !== link) playLink.value = link;
      supported.value = !!data.supported;
    }
  }
  downloadProgress.value = data.status !== "ready" ? data.progress || null : null;

  // <track> subtitles are for MP4 only; HLS declares them in the playlist.
  const playingHls = isHlsLink(playLink.value);
  if (!isAppleBrowser() && !playingHls) subtitles.value = subtitleTracks(hash.value, data.subtitles || []);
  else if (playingHls) subtitles.value = [];

  canStream.value = !!data.can_stream;
  // can_stream means no stream is running, so a requested one was reaped:
  // re-arm the button.
  if (canStream.value && streamRequested.value) streamRequested.value = false;
  if (data.hls_pending) streamMessage.value = STREAM_STARTING;
  else if (streamMessage.value === STREAM_STARTING) streamMessage.value = null;
}

function poll(): void {
  if (polling) return;
  polling = true;
  const tick = async (): Promise<void> => {
    try {
      const data = await get<FileInfo>("/api/magnet/" + hash.value + "/" + encodeURIComponent(filename.value));
      if (!alive) return;
      applyFileInfo(data);
      if (status.value !== "ready") routeTimeout(tick, 1000);
    } catch (error) {
      if (alive && !isAbortError(error)) failed.value = "Lost contact with the server.";
    }
  };
  void tick();
}

// ---- actions -----------------------------------------------------------------------

let sessionRequested = false;

async function openSession(): Promise<void> {
  if (sessionRequested) return;
  sessionRequested = true;
  try {
    const start = getVideoPosition(magnet.value, filename.value);
    const data = await post<{ url?: string | null; reason?: string }>(
      "/api/magnet/" + hash.value + "/" + encodeURIComponent(filename.value) + "/session?start=" + Math.floor(start),
    );
    if (!alive) return;
    if (data && data.url) {
      playLink.value = data.url;
      supported.value = true;
    } else {
      sessionRequested = false;
      failed.value = data && data.reason === "capacity" ? "Too many videos are playing. Try again in a minute." : "Could not start playback.";
    }
  } catch {
    sessionRequested = false;
    if (alive) failed.value = "Lost contact with the server.";
  }
}

async function startStream(): Promise<void> {
  streamRequested.value = true;
  streamMessage.value = null;
  try {
    const data = await post<{ started?: boolean; reason?: string }>(
      "/api/magnet/" + hash.value + "/" + encodeURIComponent(filename.value) + "/stream",
    );
    if (!alive || (data && data.started)) return;
    // The backend declined: re-show the play button and say why.
    streamRequested.value = false;
    streamMessage.value = streamDeclinedMessage(data && data.reason);
  } catch {
    if (!alive) return;
    streamRequested.value = false;
    streamMessage.value = streamDeclinedMessage(undefined);
  }
}

async function cancelDownload(): Promise<void> {
  if (cancelling.value) return;
  cancelling.value = true;
  try {
    await post("/api/magnet/" + hash.value + "/" + encodeURIComponent(filename.value) + "/cancel");
  } catch {
    // Leave anyway; the server drops the download when nobody watches it.
  }
  if (alive) goBack();
}

// HLS playback failed (e.g. unsupported codec): drop back to the progress view.
function onStreamError(): void {
  playLink.value = null;
  streamRequested.value = false;
  canStream.value = false;
  hlsFailed.value = true;
}

async function start(): Promise<void> {
  failed.value = null;
  try {
    await post("/api/magnet_download/", { magnet_link: magnet.value, filename: filename.value });
  } catch (error) {
    if (alive && !isAbortError(error)) failed.value = "Couldn't start the download.";
    return;
  }
  if (!alive) return;
  saveToHistory(magnet.value);
  void reportLibraryEvents([
    { event: "download", magnet: magnet.value, title: get_magnet_name(magnet.value), filename: filename.value, ts: Date.now() },
  ]);
  // The server pushes progress, peers and ready as they happen.
  source = subscribe<FileInfo>(
    "/api/magnet_events/" + hash.value + "/" + encodeURIComponent(filename.value),
    (data) => {
      applyFileInfo(data);
      if (data.done) source = null;
    },
    () => {
      source = null;
      if (status.value !== "ready") poll();
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
watch([magnet, filename], () => {
  // Same screen, different file: start over.
  closeSource();
  polling = false;
  status.value = null;
  progress.value = null;
  playLink.value = null;
  subtitles.value = [];
  canStream.value = false;
  streamRequested.value = false;
  hlsFailed.value = false;
  streamMessage.value = null;
  cancelling.value = false;
  heading.value = "";
  subheading.value = null;
  void start();
});
</script>

<template>
  <PlayerHost
    v-if="playLink"
    :key="playLinkIdentity(playLink)"
    :url="playLink"
    :supported="supported"
    :subtitles="subtitles"
    :magnet="magnet"
    :filename="filename"
    :download-progress="downloadProgress"
    :download-status="status"
    @back="goBack"
    @stream-error="onStreamError"
  />
  <main v-else class="dl-root" data-screen="download-screen">
    <div class="topbar dl-topbar">
      <BackButton :fallback="backTarget" />
      <h1 class="dl-title" :title="filename">{{ filename }}</h1>
      <div class="dl-actions">
        <button
          v-if="canStream && !streamRequested"
          type="button"
          class="icon-btn stream-btn"
          title="Stream while downloading"
          aria-label="Stream while downloading"
          @click="startStream"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>
        </button>
        <FavoriteButton :magnet="magnet" :filename="filename" />
        <FullscreenButton />
      </div>
    </div>
    <div class="dl-body dl-status">
      <div v-if="failed" class="dl-error" role="alert">
        <p>{{ failed }}</p>
        <button type="button" class="dl-button" @click="retry">Try again</button>
      </div>
      <template v-else>
        <LoadingSpinner
          v-if="status !== 'ready'"
          :heading="heading || 'Starting'"
          :subheading="subheading ?? ''"
          :progress="progress"
        />
        <p v-if="streamMessage" class="stream-message" role="status">{{ streamMessage }}</p>
        <button v-if="canCancel" type="button" class="dl-button cancel-download" :disabled="cancelling" @click="cancelDownload">
          Cancel download
        </button>
      </template>
    </div>
  </main>
</template>

<style>
.stream-btn svg { fill: currentColor; stroke: none; }
.dl-status { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: var(--space-4); }
.stream-message { margin: 0; color: var(--text-dim); text-align: center; }
.cancel-download { position: relative; margin-top: calc(var(--space-6) * 4); }
</style>
