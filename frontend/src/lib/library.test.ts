import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearHistory,
  fetchWatchRows,
  getCompletedFiles,
  getFavorites,
  getHistory,
  getSearchHistory,
  getVideoPosition,
  isFavorite,
  library,
  markFileCompleted,
  progressCountsAsWatched,
  readStoredProgress,
  readWatchLog,
  removeFavorite,
  reportPlaybackProgress,
  resetProgressThrottle,
  saveFavorite,
  saveLocalTitles,
  saveSearchTerm,
  saveToHistory,
  saveVideoPosition,
  syncLibraryFromLocalHistory,
  collectInProgressEvents,
  readLocalTitles,
  getVideoPositionKey,
} from "./library";

const M1 = "magnet:?xt=urn:btih:AAA&dn=First";
const M2 = "magnet:?xt=urn:btih:BBB&dn=Second";

function mockFetch() {
  const fn = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
function sentEvents(fn: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(fn.mock.calls[call][1].body).events;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetProgressThrottle();
  mockFetch();
});
afterEach(() => vi.unstubAllGlobals());

describe("history", () => {
  it("keeps newest first, dedupes and caps at 50", () => {
    saveToHistory(M1);
    saveToHistory(M2);
    saveToHistory(M1);
    expect(getHistory().map((h) => h.magnet)).toEqual([M1, M2]);
    expect(getHistory()[0].title).toBe("First");
    for (let i = 0; i < 60; i++) saveToHistory(`magnet:?xt=urn:btih:h${i}`);
    expect(getHistory()).toHaveLength(50);
  });
  it("updates the reactive state", () => {
    saveToHistory(M1);
    expect(library.history).toHaveLength(1);
    clearHistory();
    expect(library.history).toHaveLength(0);
  });
  it("clearHistory removes every related key", () => {
    saveToHistory(M1);
    saveSearchTerm("x");
    markFileCompleted(M1, "a.mkv");
    clearHistory();
    expect(localStorage.length).toBe(0);
  });
});

describe("search history", () => {
  it("dedupes case-insensitively, caps at 8, ignores blanks and reports to the server", () => {
    const fn = mockFetch();
    saveSearchTerm("  ");
    expect(fn).not.toHaveBeenCalled();
    saveSearchTerm("Dune");
    saveSearchTerm("dune");
    expect(getSearchHistory()).toEqual(["dune"]);
    for (let i = 0; i < 10; i++) saveSearchTerm("t" + i);
    expect(getSearchHistory()).toHaveLength(8);
    expect(sentEvents(fn)[0]).toMatchObject({ event: "search", title: "Dune" });
    expect(fn.mock.calls[0][0]).toBe("/api/library/observe/");
  });
});

describe("completed files and the watch log", () => {
  it("records, dedupes and reports", () => {
    const fn = mockFetch();
    markFileCompleted(M1, "a.mkv");
    markFileCompleted(M1, "a.mkv");
    expect(getCompletedFiles(M1)).toEqual(["a.mkv"]);
    expect(sentEvents(fn)[0]).toMatchObject({ event: "watched", filename: "a.mkv" });
    const log = readWatchLog();
    expect(log).toHaveLength(1);
    expect(log[0].event).toBe("watched");
  });
  it("a watched entry replaces progress for the same file", () => {
    saveVideoPosition(M1, "a.mkv", 500, 3000);
    expect(readWatchLog()[0].event).toBe("progress");
    markFileCompleted(M1, "a.mkv");
    const log = readWatchLog();
    expect(log).toHaveLength(1);
    expect(log[0].event).toBe("watched");
  });
});

describe("favorites", () => {
  it("adds, sorts by title, removes", () => {
    saveFavorite(M1, "zeta.mkv");
    saveFavorite(M2, "alpha.mkv");
    expect(getFavorites().map((f) => f.title)).toEqual(["alpha.mkv", "zeta.mkv"]);
    expect(isFavorite(M2, "alpha.mkv")).toBe(true);
    removeFavorite(M2, "alpha.mkv");
    expect(isFavorite(M2, "alpha.mkv")).toBe(false);
    expect(library.favorites).toHaveLength(1);
  });
  it("replaces the same file and falls back to the magnet name", () => {
    saveFavorite(M1, "");
    saveFavorite(M1, "");
    expect(getFavorites()).toHaveLength(1);
    expect(getFavorites()[0].title).toBe("First");
  });
});

describe("video position", () => {
  it("stores position and keeps a known duration", () => {
    saveVideoPosition(M1, "a.mkv", 100, 2000);
    saveVideoPosition(M1, "a.mkv", 200);
    expect(getVideoPosition(M1, "a.mkv")).toBe(200);
    expect(readStoredProgress(getVideoPositionKey(M1, "a.mkv")).duration).toBe(2000);
  });
  it("reads the old bare-number format and missing keys", () => {
    localStorage.setItem(getVideoPositionKey(M1, "old.mkv"), "321.5");
    expect(getVideoPosition(M1, "old.mkv")).toBe(321.5);
    expect(getVideoPosition(M1, "none.mkv")).toBe(0);
  });
  it("decides when something counts as watched", () => {
    expect(progressCountsAsWatched(99, 100)).toBe(true);
    expect(progressCountsAsWatched(1000, 1100)).toBe(true); // under 120s left
    expect(progressCountsAsWatched(500, 3000)).toBe(false);
    expect(progressCountsAsWatched(10, 0)).toBe(false);
    expect(progressCountsAsWatched(0, 100)).toBe(false);
  });
  it("only logs progress past 120s", () => {
    saveVideoPosition(M1, "a.mkv", 60, 3000);
    expect(readWatchLog()).toHaveLength(0);
    saveVideoPosition(M1, "a.mkv", 600, 3000);
    expect(readWatchLog()).toHaveLength(1);
  });
});

describe("playback progress reporting", () => {
  it("throttles to once per 30 seconds unless forced", () => {
    const fn = mockFetch();
    reportPlaybackProgress(M1, "a.mkv", 500, 3000);
    reportPlaybackProgress(M1, "a.mkv", 510, 3000);
    expect(fn).toHaveBeenCalledTimes(1);
    reportPlaybackProgress(M1, "a.mkv", 520, 3000, true);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sentEvents(fn, 1)[0]).toMatchObject({ event: "progress", position: 520, duration: 3000 });
  });
  it("skips short or finished playback", () => {
    const fn = mockFetch();
    reportPlaybackProgress(M1, "a.mkv", 100, 3000);
    reportPlaybackProgress(M1, "a.mkv", 2990, 3000);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("collecting in-progress events", () => {
  it("collects recent unfinished playback and drops leftovers of finished files", () => {
    saveToHistory(M1);
    saveVideoPosition(M1, "a.mkv", 500, 3000);
    saveVideoPosition(M2, "b.mkv", 500, 3000);
    markFileCompleted(M2, "b.mkv");
    // b.mkv's position predates its completion
    const key = getVideoPositionKey(M2, "b.mkv");
    localStorage.setItem(key, JSON.stringify({ position: 500, duration: 3000, ts: 1 }));
    const events = collectInProgressEvents();
    expect(events.map((e) => e.filename)).toEqual(["a.mkv"]);
    expect(events[0].magnet).toBe(M1);
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("ignores positions older than two weeks", () => {
    localStorage.setItem(getVideoPositionKey(M1, "old.mkv"), JSON.stringify({ position: 500, duration: 3000, ts: 5 }));
    expect(collectInProgressEvents()).toEqual([]);
  });
  it("seeds the watch log from older storage when none exists", () => {
    localStorage.setItem("completedFiles", JSON.stringify({ aaa: ["x.mkv"] }));
    const log = readWatchLog();
    expect(log[0]).toMatchObject({ event: "watched", filename: "x.mkv", magnet: "magnet:?xt=urn:btih:aaa" });
    expect(localStorage.getItem("watchLog")).not.toBeNull();
  });
});

describe("local titles", () => {
  it("merges episodes without duplicates and caps at 300 newest", () => {
    saveLocalTitles([{ tmdb_id: 1, media_type: "tv", title: "S", watched_episodes: [{ season: 1, episode: 1 }] }]);
    saveLocalTitles([{ tmdb_id: 1, media_type: "tv", watched_at: 9, watched_episodes: [{ season: "1", episode: "1" }, { season: 1, episode: 2 }] }]);
    const [title] = readLocalTitles();
    expect(title.watched_episodes).toHaveLength(2);
    expect(title.watched_at).toBe(9);
    const many = Array.from({ length: 310 }, (_, i) => ({ tmdb_id: i + 2, media_type: "movie", title: "m", watched_at: i }));
    saveLocalTitles(many);
    expect(readLocalTitles()).toHaveLength(300);
  });
});

describe("server calls", () => {
  it("fetchWatchRows returns empty without events and posts the log otherwise", async () => {
    const fn = mockFetch();
    expect(await fetchWatchRows()).toEqual({ keep_watching: [], recent: [] });
    expect(fn).not.toHaveBeenCalled();
    markFileCompleted(M1, "a.mkv");
    fn.mockClear();
    fn.mockResolvedValue(new Response(JSON.stringify({ recent: [{ tmdb_id: 3, media_type: "movie", title: "T" }], keep_watching: [] })));
    const rows = await fetchWatchRows();
    expect(fn.mock.calls[0][0]).toBe("/api/watch_rows/");
    expect(rows.recent).toHaveLength(1);
    expect(readLocalTitles()[0].tmdb_id).toBe(3);
  });
  it("fetchWatchRows falls back to empty on failure", async () => {
    markFileCompleted(M1, "a.mkv");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    expect(await fetchWatchRows()).toEqual({ keep_watching: [], recent: [] });
  });
  it("syncs local history once the server accepted it", async () => {
    saveToHistory(M1);
    saveFavorite(M2, "f.mkv");
    markFileCompleted(M1, "a.mkv");
    const fn = mockFetch();
    await syncLibraryFromLocalHistory();
    const events = sentEvents(fn);
    expect(events.filter((e: { event: string }) => e.event === "download")).toHaveLength(2);
    expect(events.find((e: { event: string }) => e.event === "watched")).toMatchObject({ magnet: M1, filename: "a.mkv" });
    expect(sessionStorage.getItem("rapidbayLibrarySync")).toBe("1");
    await syncLibraryFromLocalHistory();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("does not mark the sync done after a failure", async () => {
    saveToHistory(M1);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    await syncLibraryFromLocalHistory();
    expect(sessionStorage.getItem("rapidbayLibrarySync")).toBeNull();
  });
});
