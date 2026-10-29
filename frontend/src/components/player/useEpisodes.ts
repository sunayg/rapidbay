// The episode menu's data: the other episodes of the show being watched, from
// the same torrent when it is a pack, otherwise from a search for the same
// release. Ported from the legacy player's loadEpisodes.
import { computed, ref } from "vue";
import { get, post, subscribe } from "../../lib/api";
import {
  addReleaseEpisode,
  cleanMediaTitle,
  episodeCode,
  episodesFromNames,
  groupBySeason,
  releaseSearchTerm,
  releaseSignature,
  showNameFromDisplay,
  type EpisodeChoice,
} from "./media";

interface SeasonPayload {
  episodes?: { episode_number: number; name?: string; overview?: string; still_url?: string }[];
}
interface LibraryPayload {
  titles?: { media_type?: string; title?: string; tmdb_id: number }[];
}
interface SearchPayload {
  results?: { title?: string; magnet?: string; torrent_link?: string }[];
}

const PACK_WAIT_MS = 8000;

async function safe<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch {
    return null;
  }
}

export function useEpisodes(source: { hash: () => string; magnet: () => string; filename: () => string }) {
  const choices = ref<EpisodeChoice[]>([]);
  const loading = ref(false);
  const loaded = ref(false);
  const showTitle = ref("");
  const focusedKey = ref("");
  const groups = computed(() => groupBySeason(choices.value));
  let alive = true;
  const packSources: EventSource[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];

  const keyOf = (episode: EpisodeChoice) => episode.season + "-" + episode.episode;

  async function loadDetails(list: EpisodeChoice[], showName: string): Promise<void> {
    const library = await safe(get<LibraryPayload>("/api/library/"));
    if (!alive) return;
    const folded = showName.toLowerCase();
    let match = (library?.titles || []).find((t) => t.media_type === "tv" && String(t.title || "").toLowerCase() === folded);
    let tmdbId = match?.tmdb_id;
    let title = match?.title;
    if (!match) {
      const found = await safe(get<{ tmdb_id?: number; title?: string }>("/api/tv/lookup/?q=" + encodeURIComponent(showName)));
      if (!alive || !found || !found.tmdb_id) return;
      tmdbId = found.tmdb_id;
      title = found.title;
    }
    showTitle.value = title || showName;
    const seasons = [...new Set(list.map((e) => e.season))];
    await Promise.all(
      seasons.map(async (season) => {
        const payload = await safe(get<SeasonPayload>(`/api/tv/${tmdbId}/season/${season}/`));
        for (const details of payload?.episodes || []) {
          for (const item of list) {
            if (item.season === season && item.episode === details.episode_number) {
              item.name = details.name || item.name;
              item.overview = details.overview || "";
              item.stillUrl = details.still_url || "";
            }
          }
        }
      }),
    );
    if (alive) choices.value = list.slice();
  }

  function packFiles(packHash: string): Promise<string[]> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (files: string[] | undefined) => {
        if (settled) return;
        settled = true;
        resolve(files || []);
      };
      const stream = subscribe<{ files?: string[]; done?: boolean }>(
        "/api/magnet_events/" + packHash + "/",
        (payload) => {
          if (payload && payload.files) settle(payload.files);
        },
        () => {
          void safe(get<{ files?: string[] }>("/api/magnet/" + packHash + "/")).then((payload) => settle(payload?.files));
        },
      );
      if (stream) packSources.push(stream);
      timers.push(
        setTimeout(() => {
          if (stream) stream.close();
          settle([]);
        }, PACK_WAIT_MS),
      );
    });
  }

  async function load(): Promise<void> {
    if (loading.value || loaded.value) return;
    loading.value = true;
    let currentFile = source.filename();
    try {
      currentFile = decodeURIComponent(currentFile);
    } catch {
      // keep the raw name
    }
    const currentDisplay = cleanMediaTitle(currentFile);
    const signature = releaseSignature(currentDisplay);
    const currentCode = episodeCode(currentFile) || episodeCode(currentDisplay);
    const magnet = source.magnet();

    const finish = (list: EpisodeChoice[]) => {
      if (!alive) return;
      if (currentCode && !list.some((e) => e.current)) {
        addReleaseEpisode(list, {
          label: currentDisplay,
          name: "",
          overview: "",
          stillUrl: "",
          season: currentCode.season,
          episode: currentCode.episode,
          magnet,
          filename: currentFile,
          torrentLink: "",
          current: true,
        });
      }
      list.sort((a, b) => (a.season !== b.season ? a.season - b.season : a.episode - b.episode));
      choices.value = list;
      loading.value = false;
      loaded.value = true;
      const focused = [...list].reverse().find((e) => e.current) || list[0];
      focusedKey.value = focused ? keyOf(focused) : "";
      void loadDetails(list, showNameFromDisplay(currentDisplay));
    };

    const files = await safe(get<{ files?: string[] }>("/api/magnet/" + source.hash() + "/"));
    if (!alive) return;
    const found = episodesFromNames(files?.files, signature, magnet, currentFile);
    if (!currentCode || found.length > 1) {
      finish(found);
      return;
    }
    // A lone episode: look for the same release of the other episodes.
    const payload = await safe(get<SearchPayload>("/api/search/" + encodeURIComponent(releaseSearchTerm(currentDisplay))));
    if (!alive) return;
    const packs: string[] = [];
    for (const result of payload?.results || []) {
      const title = result.title || "";
      const display = cleanMediaTitle(title);
      if (releaseSignature(display) !== signature) continue;
      const code = episodeCode(title) || episodeCode(display);
      if (code) {
        addReleaseEpisode(found, {
          label: display,
          name: "",
          overview: "",
          stillUrl: "",
          season: code.season,
          episode: code.episode,
          magnet: result.magnet || "",
          filename: "",
          torrentLink: result.magnet ? "" : result.torrent_link || "",
          current: false,
        });
      } else if (result.magnet && packs.length < 3) {
        packs.push(result.magnet);
      }
    }
    await Promise.all(
      packs.map(async (packMagnet) => {
        const info = await safe(post<{ magnet_hash?: string }>("/api/magnet_files/", { magnet_link: packMagnet }));
        if (!info || !info.magnet_hash) return;
        const names = await packFiles(info.magnet_hash);
        for (const episode of episodesFromNames(names, signature, packMagnet, currentFile)) addReleaseEpisode(found, episode);
      }),
    );
    finish(found);
  }

  function dispose(): void {
    alive = false;
    for (const stream of packSources) stream.close();
    for (const timer of timers) clearTimeout(timer);
  }

  return { choices, groups, loading, loaded, showTitle, focusedKey, load, dispose, keyOf };
}
