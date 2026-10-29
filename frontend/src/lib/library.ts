// Local watch state (history, favorites, progress, watch log) with the server
// library sync, ported from the legacy app. The lists the UI shows live in a
// module-level reactive object that every mutation refreshes.
import { reactive } from "vue";
import { get, postJSON } from "./api";
import { get_hash, get_magnet_name } from "./magnet";
import { readJSON, sessionGet, sessionSet, storageGet, storageKeys, storageRemove, writeJSON } from "./storage";

export interface HistoryEntry {
  magnet: string;
  title: string;
  ts: number;
}
export interface Favorite extends HistoryEntry {
  filename: string;
}
export interface LibraryEvent {
  event: "download" | "watched" | "progress" | "search";
  magnet?: string;
  title: string;
  filename: string;
  ts: number;
  position?: number;
  duration?: number;
}
export interface Progress {
  position: number;
  duration: number;
  ts: number;
}
export interface LocalTitle {
  tmdb_id: number;
  media_type: string;
  title: string;
  watched_at: number | null;
  watched_episodes: { season: number | string; episode: number | string }[];
}
export interface WatchRows {
  keep_watching: Record<string, unknown>[];
  recent: Record<string, unknown>[];
}

const HISTORY_LIMIT = 50;
const SEARCH_HISTORY_LIMIT = 8;
const FAVORITES_LIMIT = 100;
const WATCH_LOG_LIMIT = 200;
const MAX_LOCAL_TITLES = 300;
const POSITION_PREFIX = "videoPosition_";
const DAY_MS = 24 * 60 * 60 * 1000;

// ---- reactive state -------------------------------------------------------

export const library = reactive({
  history: [] as HistoryEntry[],
  searchHistory: [] as string[],
  favorites: [] as Favorite[],
});

export function refreshLibrary(): void {
  library.history = getHistory();
  library.searchHistory = getSearchHistory();
  library.favorites = getFavorites();
}

// ---- server sync ------------------------------------------------------------

export async function reportLibraryEvents(events: LibraryEvent[]): Promise<boolean> {
  if (!events || !events.length) return false;
  try {
    await postJSON("/api/library/observe/", { events });
    return true;
  } catch {
    return false;
  }
}

// One-time import of what this browser already knows into the server library.
export async function syncLibraryFromLocalHistory(): Promise<void> {
  if (sessionGet("rapidbayLibrarySync")) return;
  const events: LibraryEvent[] = [];
  const magnetsByHash: Record<string, string> = {};
  for (const entry of getHistory()) {
    if (!entry || !entry.magnet) continue;
    magnetsByHash[get_hash(entry.magnet)] = entry.magnet;
    events.push({ event: "download", magnet: entry.magnet, title: entry.title || "", filename: "", ts: entry.ts || 0 });
  }
  for (const entry of getFavorites()) {
    if (!entry || !entry.magnet) continue;
    magnetsByHash[get_hash(entry.magnet)] = entry.magnet;
    events.push({ event: "download", magnet: entry.magnet, title: entry.title || "", filename: entry.filename || "", ts: entry.ts || 0 });
  }
  const completed = readJSON<Record<string, string[]>>("completedFiles", {});
  for (const hash of Object.keys(completed)) {
    const magnet = magnetsByHash[hash] || "magnet:?xt=urn:btih:" + hash;
    for (const filename of completed[hash] || []) {
      events.push({ event: "watched", magnet, title: filename, filename, ts: 0 });
    }
  }
  // Mark the import done only once the server has it, so a failed request is
  // tried again on the next visit.
  if (await reportLibraryEvents(events)) sessionSet("rapidbayLibrarySync", "1");
}

export interface LibraryTitle {
  tmdb_id: number;
  media_type: string;
  title: string;
  [key: string]: unknown;
}

export function fetchLibrary(): Promise<{ titles: LibraryTitle[] }> {
  return get<{ titles: LibraryTitle[] }>("/api/library/");
}

export interface HomeData {
  series: Record<string, unknown>[];
  movies: Record<string, unknown>[];
}

export async function fetchHome(): Promise<HomeData> {
  const data = await get<Partial<HomeData> | null>("/api/home/");
  return { series: data?.series ?? [], movies: data?.movies ?? [] };
}

// ---- download and search history ---------------------------------------------

export function saveToHistory(magnet: string): void {
  let history = readJSON<HistoryEntry[]>("downloadHistory", []).filter((h) => h.magnet !== magnet);
  history.unshift({ magnet, title: get_magnet_name(magnet), ts: Date.now() });
  if (history.length > HISTORY_LIMIT) history = history.slice(0, HISTORY_LIMIT);
  writeJSON("downloadHistory", history);
  refreshLibrary();
}

export function getHistory(): HistoryEntry[] {
  return readJSON<HistoryEntry[]>("downloadHistory", []);
}

export function clearHistory(): void {
  for (const key of ["downloadHistory", "completedFiles", "completedAt", "searchHistory", "watchLog", "localTitles"]) {
    storageRemove(key);
  }
  refreshLibrary();
}

export function saveSearchTerm(term: string): void {
  if (!term || term.trim() === "") return;
  let history = readJSON<string[]>("searchHistory", []).filter((t) => t.toLowerCase() !== term.toLowerCase());
  history.unshift(term);
  if (history.length > SEARCH_HISTORY_LIMIT) history = history.slice(0, SEARCH_HISTORY_LIMIT);
  writeJSON("searchHistory", history);
  refreshLibrary();
  void reportLibraryEvents([{ event: "search", title: term.trim(), filename: "", ts: Date.now() }]);
}

export function getSearchHistory(): string[] {
  return readJSON<string[]>("searchHistory", []).slice(0, SEARCH_HISTORY_LIMIT);
}

export function clearSearchHistory(): void {
  storageRemove("searchHistory");
  refreshLibrary();
}

// ---- completed files ---------------------------------------------------------

export function markFileCompleted(magnet: string, filename: string): void {
  const hash = get_hash(magnet);
  const completed = readJSON<Record<string, string[]>>("completedFiles", {});
  if (!completed[hash]) completed[hash] = [];
  if (completed[hash].indexOf(filename) === -1) completed[hash].push(filename);
  writeJSON("completedFiles", completed);
  const completedAt = readJSON<Record<string, number>>("completedAt", {});
  completedAt[hash + "\n" + filename] = Date.now();
  writeJSON("completedAt", completedAt);
  rememberWatched(magnet, filename);
  void reportLibraryEvents([{ event: "watched", magnet, title: filename, filename, ts: Date.now() }]);
}

export function getCompletedFiles(magnet: string): string[] {
  return readJSON<Record<string, string[]>>("completedFiles", {})[get_hash(magnet)] || [];
}

// ---- favorites -----------------------------------------------------------------

export function getFavorites(): Favorite[] {
  return readJSON<Favorite[]>("favorites", []).sort((a, b) => (a.title || "").localeCompare(b.title || ""));
}

function withoutFavorite(magnet: string, filename: string): Favorite[] {
  const hash = get_hash(magnet);
  return readJSON<Favorite[]>("favorites", []).filter((f) => get_hash(f.magnet) !== hash || f.filename !== filename);
}

export function isFavorite(magnet: string, filename: string): boolean {
  const hash = get_hash(magnet);
  return readJSON<Favorite[]>("favorites", []).some((f) => get_hash(f.magnet) === hash && f.filename === filename);
}

export function saveFavorite(magnet: string, filename: string): void {
  let favorites = withoutFavorite(magnet, filename);
  favorites.unshift({ magnet, filename, title: filename || get_magnet_name(magnet), ts: Date.now() });
  if (favorites.length > FAVORITES_LIMIT) favorites = favorites.slice(0, FAVORITES_LIMIT);
  writeJSON("favorites", favorites);
  refreshLibrary();
}

export function removeFavorite(magnet: string, filename: string): void {
  writeJSON("favorites", withoutFavorite(magnet, filename));
  refreshLibrary();
}

// ---- video position and progress ---------------------------------------------------

export function getVideoPositionKey(magnet: string, filename: string): string {
  return POSITION_PREFIX + get_hash(magnet) + "_" + filename;
}

export function readStoredProgress(key: string): Progress {
  const raw = storageGet(key);
  if (!raw) return { position: 0, duration: 0, ts: 0 };
  if (raw.charAt(0) === "{") {
    try {
      const data = JSON.parse(raw);
      return {
        position: parseFloat(data.position) || 0,
        duration: parseFloat(data.duration) || 0,
        ts: parseInt(data.ts, 10) || 0,
      };
    } catch {
      return { position: 0, duration: 0, ts: 0 };
    }
  }
  // Older versions stored the bare position.
  return { position: parseFloat(raw) || 0, duration: 0, ts: 0 };
}

export function saveVideoPosition(magnet: string, filename: string, position: number, duration?: number): void {
  const previous = readStoredProgress(getVideoPositionKey(magnet, filename));
  const storedDuration = duration || previous.duration || 0;
  writeJSON(getVideoPositionKey(magnet, filename), { position, duration: storedDuration, ts: Date.now() });
  rememberProgress(magnet, filename, position, storedDuration);
}

export function getVideoPosition(magnet: string, filename: string): number {
  return readStoredProgress(getVideoPositionKey(magnet, filename)).position;
}

export function clearVideoPosition(magnet: string, filename: string): void {
  storageRemove(getVideoPositionKey(magnet, filename));
}

export function progressCountsAsWatched(position: number, duration: number): boolean {
  if (!isFinite(duration) || duration <= 0 || !(position > 0)) return false;
  if (position / duration >= 0.98) return true;
  return duration >= 120 && duration - position < 120;
}

const progressReportAt: Record<string, number> = {};

export function resetProgressThrottle(): void {
  for (const key of Object.keys(progressReportAt)) delete progressReportAt[key];
}

export function reportPlaybackProgress(magnet: string, filename: string, position: number, duration: number, force = false): void {
  if (!magnet || !filename || !(position > 120) || progressCountsAsWatched(position, duration)) return;
  const key = get_hash(magnet) + ":" + filename;
  const now = Date.now();
  if (!force && progressReportAt[key] && now - progressReportAt[key] < 30000) return;
  progressReportAt[key] = now;
  void reportLibraryEvents([
    { event: "progress", magnet, title: filename, filename, ts: now, position: Math.round(position), duration: Math.round(duration || 0) },
  ]);
}

// ---- watch log -------------------------------------------------------------------------

export function magnetForHash(hash: string): string {
  const lists: { magnet?: string }[] = [...getHistory(), ...getFavorites()];
  for (const item of lists) {
    if (item && item.magnet && get_hash(item.magnet) === hash) return item.magnet;
  }
  return "magnet:?xt=urn:btih:" + hash;
}

export function collectInProgressEvents(): LibraryEvent[] {
  const events: LibraryEvent[] = [];
  const cutoff = Date.now() - 14 * DAY_MS;
  for (const key of storageKeys()) {
    if (key.indexOf(POSITION_PREFIX) !== 0) continue;
    const rest = key.slice(POSITION_PREFIX.length);
    const splitAt = rest.indexOf("_");
    if (splitAt < 1) continue;
    const hash = rest.slice(0, splitAt);
    const filename = rest.slice(splitAt + 1);
    const stored = readStoredProgress(key);
    if (!(stored.position > 120) || progressCountsAsWatched(stored.position, stored.duration)) continue;
    const finishedNames = readJSON<Record<string, string[]>>("completedFiles", {})[hash] || [];
    if (finishedNames.indexOf(filename) !== -1) {
      const completedAt = readJSON<Record<string, number>>("completedAt", {});
      const finishedAt = parseInt(String(completedAt[hash + "\n" + filename]), 10) || 0;
      // Position left over from a playthrough that was already finished.
      const leftover = !stored.duration || (finishedAt && stored.ts && stored.ts <= finishedAt);
      if (leftover) {
        storageRemove(key);
        continue;
      }
    }
    if (!stored.ts) {
      stored.ts = Date.now();
      writeJSON(key, { position: stored.position, duration: stored.duration, ts: stored.ts });
    }
    if (stored.ts < cutoff) continue;
    events.push({
      event: "progress",
      magnet: magnetForHash(hash),
      title: filename,
      filename,
      ts: stored.ts || Date.now(),
      position: Math.round(stored.position),
      duration: Math.round(stored.duration || 0),
    });
  }
  return events;
}

export function readWatchLog(): LibraryEvent[] {
  const raw = storageGet("watchLog");
  if (raw === null) return seedWatchLog();
  try {
    const log = JSON.parse(raw);
    return Array.isArray(log) ? log : [];
  } catch {
    return [];
  }
}

function writeWatchLog(log: LibraryEvent[]): void {
  writeJSON("watchLog", log.length > WATCH_LOG_LIMIT ? log.slice(0, WATCH_LOG_LIMIT) : log);
}

function watchFileKey(magnet: string | undefined, filename: string | undefined): string {
  return get_hash(magnet || "") + "\n" + (filename || "");
}

export function rememberProgress(magnet: string, filename: string, position: number, duration: number): void {
  if (!magnet || !filename || !(position > 120) || progressCountsAsWatched(position, duration)) return;
  const key = watchFileKey(magnet, filename);
  const log = readWatchLog().filter((item) => !(item && item.event === "progress" && watchFileKey(item.magnet, item.filename) === key));
  log.unshift({ event: "progress", magnet, title: filename, filename, ts: Date.now(), position: Math.round(position), duration: Math.round(duration || 0) });
  writeWatchLog(log);
}

export function rememberWatched(magnet: string, filename: string): void {
  if (!magnet || !filename) return;
  const key = watchFileKey(magnet, filename);
  const log = readWatchLog().filter((item) => {
    if (!item) return false;
    const same = watchFileKey(item.magnet, item.filename) === key;
    return !(same && (item.event === "progress" || item.event === "watched"));
  });
  log.unshift({ event: "watched", magnet, title: filename, filename, ts: Date.now() });
  writeWatchLog(log);
}

function seedWatchLog(): LibraryEvent[] {
  const events = collectInProgressEvents();
  const completed = readJSON<Record<string, string[]>>("completedFiles", {});
  const completedAt = readJSON<Record<string, number>>("completedAt", {});
  for (const hash of Object.keys(completed)) {
    const magnet = magnetForHash(hash);
    for (const filename of completed[hash] || []) {
      events.push({ event: "watched", magnet, title: filename, filename, ts: parseInt(String(completedAt[hash + "\n" + filename]), 10) || 0 });
    }
  }
  writeWatchLog(events);
  return events;
}

// ---- local titles cache (for the home rows) ----------------------------------------------

export function readLocalTitles(): LocalTitle[] {
  return readJSON<LocalTitle[]>("localTitles", []);
}

interface TitleCard {
  tmdb_id?: number;
  media_type?: string;
  title?: string;
  watched_at?: number | null;
  watched_episodes?: { season: number | string; episode: number | string }[];
}

export function saveLocalTitles(cards: TitleCard[]): void {
  const byKey: Record<string, LocalTitle> = {};
  for (const title of readLocalTitles()) {
    if (title && title.tmdb_id && title.media_type) byKey[title.media_type + ":" + title.tmdb_id] = title;
  }
  for (const card of cards || []) {
    if (!card || !card.tmdb_id || !card.media_type) continue;
    const key = card.media_type + ":" + card.tmdb_id;
    const current: LocalTitle = byKey[key] || {
      tmdb_id: card.tmdb_id,
      media_type: card.media_type,
      title: card.title || "",
      watched_at: null,
      watched_episodes: [],
    };
    if (card.title) current.title = card.title;
    if (card.watched_at) current.watched_at = card.watched_at;
    for (const episode of card.watched_episodes || []) {
      if (!episode) continue;
      const known = (current.watched_episodes || []).some(
        (item) => Number(item.season) === Number(episode.season) && Number(item.episode) === Number(episode.episode),
      );
      if (!known) current.watched_episodes.push(episode);
    }
    byKey[key] = current;
  }
  let kept = Object.values(byKey);
  if (kept.length > MAX_LOCAL_TITLES) {
    kept.sort((a, b) => (Number(b.watched_at) || 0) - (Number(a.watched_at) || 0));
    kept = kept.slice(0, MAX_LOCAL_TITLES);
  }
  writeJSON("localTitles", kept);
}

export async function fetchWatchRows(): Promise<WatchRows> {
  const empty: WatchRows = { keep_watching: [], recent: [] };
  const events = readWatchLog();
  if (!events.length) return empty;
  try {
    const data = await postJSON<Partial<WatchRows> | null>("/api/watch_rows/", { events });
    saveLocalTitles([...(data?.recent ?? []), ...(data?.keep_watching ?? [])] as TitleCard[]);
    return { keep_watching: data?.keep_watching ?? [], recent: data?.recent ?? [] };
  } catch {
    return empty;
  }
}

refreshLibrary();
