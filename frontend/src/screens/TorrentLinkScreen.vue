<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import BackButton from "../components/BackButton.vue";
import LoadingSpinner from "../components/LoadingSpinner.vue";
import { isAbortError, post } from "../lib/api";
import { magnetPath } from "../lib/magnet";

// A torrent file URL is turned into a magnet link, then this screen is
// replaced by the file list for it (so Back skips over this one).
const route = useRoute();
const router = useRouter();
const failed = ref(false);
let alive = true;

async function convert(): Promise<void> {
  failed.value = false;
  try {
    const data = await post<{ magnet_link?: string }>("/api/torrent_url_to_magnet/", {
      url: String(route.params.torrent_link ?? ""),
    });
    if (!alive) return;
    if (!data || !data.magnet_link) throw new Error("No magnet link returned");
    await router.replace(magnetPath(data.magnet_link));
  } catch (error) {
    if (alive && !isAbortError(error)) failed.value = true;
  }
}

onMounted(convert);
onBeforeUnmount(() => {
  alive = false;
});
</script>

<template>
  <main class="dl-root" data-screen="torrent-link-screen">
    <div class="topbar dl-topbar"><BackButton fallback="/" /></div>
    <div class="dl-body">
      <div v-if="failed" class="dl-error" role="alert">
        <p>Couldn't read that torrent link.</p>
        <button type="button" class="dl-button" @click="convert">Try again</button>
      </div>
      <LoadingSpinner v-else />
    </div>
  </main>
</template>
