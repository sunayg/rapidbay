import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App.vue";
import { uninstallFocus } from "../lib/focus";
import * as libraryModule from "../lib/library";
import { refreshLibrary } from "../lib/library";
import { encodeMagnetParam, readEpisodeTarget } from "../lib/magnet";
import { createAppRouter } from "../router";

// ---- fakes -------------------------------------------------------------------------

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close(): void {
    this.closed = true;
  }
  emit(payload: unknown): void {
    this.onmessage?.({ data: typeof payload === "string" ? payload : JSON.stringify(payload) });
  }
  fail(): void {
    this.onerror?.();
  }
  static last(prefix: string): FakeEventSource {
    const found = [...FakeEventSource.instances].reverse().find((s) => s.url.startsWith(prefix));
    if (!found) throw new Error("no EventSource for " + prefix);
    return found;
  }
}

type Handler = (url: string, init?: RequestInit) => unknown;
let handlers: Record<string, Handler> = {};
let fetched: { url: string; init?: RequestInit }[] = [];

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      fetched.push({ url, init });
      const key = Object.keys(handlers)
        .sort((a, b) => b.length - a.length)
        .find((prefix) => url.startsWith(prefix));
      if (!key) return new Response("{}", { status: 404 });
      const body = handlers[key](url, init);
      if (body instanceof Response) return body;
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}

const MAGNET = "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Dune";
const magnetRes = (title: string, seeds = 10, extra: Record<string, unknown> = {}) => ({ title, seeds, size: 2 * 1024 ** 3, magnet: MAGNET + "&n=" + encodeURIComponent(title), ...extra });

const dune = {
  tmdb_id: 438631,
  media_type: "movie",
  title: "Dune",
  year: 2021,
  overview: "A noble family...",
  poster_url: "http://img/dune.jpg",
  genres: ["Sci-Fi"],
  vote_average: 7.84,
  runtime: 155,
  seasons: [],
  results: [magnetRes("Dune.2021.720p.WEB", 5), magnetRes("Dune.2021.1080p.BluRay", 50, { status: "downloaded" })],
};

const severance = {
  tmdb_id: 95396,
  media_type: "tv",
  title: "Severance",
  year: 2022,
  overview: "Mark leads a team.",
  latest_episode: { season_number: 2, episode_number: 2, name: "Goodbye, Mrs. Selvig", air_date: "2025-01-24", runtime: 50, vote_average: 8.4 },
  seasons: [
    { season: 1, episodes: [magnetRes("Severance.S01E01.1080p.WEB", 40), magnetRes("Severance.S01E01.720p.WEB", 10), magnetRes("Severance.S01E02.1080p.WEB", 30)] },
    { season: 2, episodes: [magnetRes("Severance.S02E02.1080p.WEB", 20), { title: "Severance S02 Complete 1080p", seeds: 7, torrent_link: "http://t/pack.torrent" }] },
  ],
  results: [],
};

let mounted: VueWrapper | null = null;

async function visit(path: string) {
  const router = createAppRouter(createMemoryHistory("/"));
  await router.push(path);
  await router.isReady();
  const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } });
  mounted = wrapper;
  await flushPromises();
  return { router, wrapper };
}

const text = (wrapper: VueWrapper) => wrapper.text().replace(/\s+/g, " ");

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  refreshLibrary();
  FakeEventSource.instances = [];
  fetched = [];
  handlers = { "/api/magnet_status/": () => ({ statuses: {} }) };
  vi.stubGlobal("EventSource", FakeEventSource);
  Object.defineProperty(window, "EventSource", { value: FakeEventSource, configurable: true, writable: true });
  stubFetch();
  vi.spyOn(libraryModule, "syncLibraryFromLocalHistory").mockResolvedValue();
  vi.spyOn(libraryModule, "reportLibraryEvents").mockResolvedValue(true);
  vi.spyOn(libraryModule, "fetchWatchRows").mockResolvedValue({ keep_watching: [], recent: [] });
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  uninstallFocus();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- rich streaming --------------------------------------------------------------------

describe("rich search streaming", () => {
  it("shows a spinner, renders groups as they stream in and settles on done", async () => {
    const { wrapper } = await visit("/search/dune");
    expect(wrapper.find('[data-screen="search-results-screen"]').exists()).toBe(true);
    expect(wrapper.find(".spinner").exists()).toBe(true);
    const source = FakeEventSource.last("/api/rich_search_events/");
    expect(source.url).toBe("/api/rich_search_events/dune");

    source.emit({ groups: [dune, { ...dune, tmdb_id: 2, title: "Dune: Part Two", year: 2024 }], other: [], done: false });
    await flushPromises();
    expect(wrapper.find(".spinner").exists()).toBe(false);
    expect(wrapper.findAll(".group-card")).toHaveLength(2);
    expect(wrapper.findAll(".group-card-collapsed")).toHaveLength(2);
    expect(text(wrapper)).toContain("Loading more results");
    expect(text(wrapper)).toContain("Dune (2021)");

    source.emit({ groups: [dune, { ...dune, tmdb_id: 2, title: "Dune: Part Two", year: 2024 }], other: [magnetRes("Dune documentary")], done: true });
    await flushPromises();
    expect(text(wrapper)).not.toContain("Loading more results");
    expect(source.closed).toBe(true);
    expect(text(wrapper)).toContain("Other results");
    expect(text(wrapper)).toContain("Dune documentary");
  });

  it("opens a movie card on click and lists releases by resolution with status marks", async () => {
    const { wrapper } = await visit("/search/dune");
    FakeEventSource.last("/api/rich_search_events/").emit({ groups: [dune, { ...dune, tmdb_id: 2, title: "Other" }], other: [], done: true });
    await flushPromises();
    await wrapper.findAll(".group-card")[0].trigger("click");
    const rows = wrapper.findAll(".group-card")[0].findAll(".result-row");
    expect(rows.map((row) => row.find(".result-label").text())).toEqual(["1080p BluRay", "720p WEB"]);
    expect(wrapper.findAll(".result-heading").map((h) => h.text())).toEqual(["1080p (1)", "720p (1)"]);
    expect(rows[0].find(".result-status-downloaded").exists()).toBe(true);
    expect(rows[0].text()).toContain("50 seeds");
    expect(rows[0].text()).toContain("2.00 GB");
    expect(wrapper.find(".group-card-collapsed").exists()).toBe(true);
  });

  it("opens a lone group automatically once the stream is done", async () => {
    const { wrapper } = await visit("/search/dune");
    const source = FakeEventSource.last("/api/rich_search_events/");
    source.emit({ groups: [dune], other: [], done: false });
    await flushPromises();
    expect(wrapper.find(".group-card-collapsed").exists()).toBe(true);
    source.emit({ groups: [dune], other: [], done: true });
    await flushPromises();
    expect(wrapper.find(".group-card-collapsed").exists()).toBe(false);
    expect(wrapper.findAll(".result-row")).toHaveLength(2);
  });

  it("ignores malformed events", async () => {
    const { wrapper } = await visit("/search/dune");
    const source = FakeEventSource.last("/api/rich_search_events/");
    source.emit("not json");
    source.emit({ groups: [dune], other: [], done: true });
    await flushPromises();
    expect(wrapper.findAll(".group-card")).toHaveLength(1);
  });

  it("opens a magnet result on the file list route and a torrent link on the torrent route", async () => {
    const { wrapper, router } = await visit("/search/dune");
    const torrent = { title: "Dune from torrent", seeds: 3, torrent_link: "http://t/dune.torrent" };
    FakeEventSource.last("/api/rich_search_events/").emit({ groups: [dune], other: [torrent], done: true });
    await flushPromises();
    await wrapper.findAll(".group-card .result-row")[0].trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("filelist");
    expect(router.currentRoute.value.fullPath).toBe("/magnet/" + encodeMagnetParam(dune.results[1].magnet));
  });

  it("sends a torrent link to the torrent screen", async () => {
    const { wrapper, router } = await visit("/search/dune");
    FakeEventSource.last("/api/rich_search_events/").emit({ groups: [], other: [{ title: "Dune from torrent", seeds: 3, torrent_link: "http://t/dune.torrent" }], done: true });
    await flushPromises();
    await wrapper.find(".results-body .result-row").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("torrent");
    expect(decodeURIComponent(router.currentRoute.value.path.split("/")[2])).toBe("http://t/dune.torrent");
  });

  it("falls back to the blocking rich search when the stream fails before any result", async () => {
    handlers["/api/rich_search/"] = () => ({ groups: [dune], other: [] });
    const { wrapper } = await visit("/search/dune");
    FakeEventSource.last("/api/rich_search_events/").fail();
    await flushPromises();
    expect(fetched.some((f) => f.url === "/api/rich_search/dune")).toBe(true);
    expect(wrapper.findAll(".group-card")).toHaveLength(1);
  });

  it("uses the blocking rich search when EventSource does not exist", async () => {
    Object.defineProperty(window, "EventSource", { value: undefined, configurable: true, writable: true });
    handlers["/api/rich_search/"] = () => ({ groups: [dune], other: [] });
    const { wrapper } = await visit("/search/dune");
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(wrapper.findAll(".group-card")).toHaveLength(1);
  });

  it("keeps what it has when the stream breaks after results arrived", async () => {
    const { wrapper } = await visit("/search/dune");
    const source = FakeEventSource.last("/api/rich_search_events/");
    source.emit({ groups: [dune], other: [], done: false });
    await flushPromises();
    source.fail();
    await flushPromises();
    expect(fetched.some((f) => f.url.startsWith("/api/rich_search/"))).toBe(false);
    expect(wrapper.findAll(".group-card")).toHaveLength(1);
    expect(text(wrapper)).not.toContain("Loading more results");
  });
});

// ---- plain search -------------------------------------------------------------------------

describe("plain search", () => {
  async function toFlat(term = "linux") {
    const view = await visit("/search/" + term);
    FakeEventSource.last("/api/rich_search_events/").emit({ groups: [], other: [], done: true });
    await flushPromises();
    return view;
  }

  it("falls to the plain stream when the rich search finds nothing", async () => {
    const { wrapper } = await toFlat();
    const source = FakeEventSource.last("/api/search_events/");
    expect(source.url).toBe("/api/search_events/linux");
    source.emit({ results: [{ title: "Ubuntu 24.04", seeds: 99, magnet: MAGNET }], done: false });
    await flushPromises();
    expect(wrapper.findAll(".result-row")).toHaveLength(1);
    expect(text(wrapper)).toContain("Ubuntu 24.04");
    source.emit({ results: [{ title: "Ubuntu 24.04", seeds: 99, magnet: MAGNET }, { title: "Debian", seeds: 5, magnet: MAGNET + "2" }], done: false });
    source.emit({ results: null, done: true });
    await flushPromises();
    expect(wrapper.findAll(".result-row")).toHaveLength(2);
    expect(text(wrapper)).not.toContain("Loading more results");
  });

  it("shows the empty message when nothing is found", async () => {
    const { wrapper } = await toFlat("zzzz");
    FakeEventSource.last("/api/search_events/").emit({ results: null, done: true });
    await flushPromises();
    expect(wrapper.find(".empty-state").text()).toBe("No results for “zzzz”.");
  });

  it("falls back to /api/search/ when the plain stream fails", async () => {
    handlers["/api/search/"] = () => ({ results: [{ title: "From fallback", seeds: 1, magnet: MAGNET }] });
    const { wrapper } = await toFlat();
    FakeEventSource.last("/api/search_events/").fail();
    await flushPromises();
    expect(fetched.some((f) => f.url === "/api/search/linux")).toBe(true);
    expect(text(wrapper)).toContain("From fallback");
  });

  it("shows an error with a retry when every route fails", async () => {
    handlers["/api/search/"] = () => new Response("nope", { status: 500 });
    const { wrapper } = await toFlat();
    FakeEventSource.last("/api/search_events/").fail();
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain("The search failed");
    expect(wrapper.find(".spinner").exists()).toBe(false);
    const before = FakeEventSource.instances.length;
    await wrapper.find(".results-retry").trigger("click");
    await flushPromises();
    expect(FakeEventSource.instances.length).toBe(before + 1);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it("shows community searches for an empty term", async () => {
    const { wrapper } = await visit("/search/");
    expect(FakeEventSource.last("/api/rich_search_events/").url).toBe("/api/rich_search_events/");
    expect(wrapper.find(".results-heading").text()).toBe("Community Searches");
    FakeEventSource.last("/api/rich_search_events/").emit({ groups: [], other: [magnetRes("Trending thing")], done: true });
    await flushPromises();
    expect(text(wrapper)).toContain("Trending thing");
  });
});

// ---- TV -----------------------------------------------------------------------------------------

describe("TV shows", () => {
  const seasonOne = { episodes: [{ episode_number: 1, name: "Good News About Hell", air_date: "2022-02-18", runtime: 55, vote_average: 8.1, overview: "Mark.", still_url: "http://img/s1e1.jpg" }, { episode_number: 2, name: "Half Loop", air_date: "2022-02-18" }, { episode_number: 3, name: "Not yet", air_date: "2999-01-01" }] };

  it("loads a pinned title with the blocking endpoint, hides the search box and opens the match", async () => {
    handlers["/api/rich_search/"] = () => ({ groups: [severance, dune], other: [] });
    handlers["/api/tv/95396/season/"] = () => seasonOne;
    const { wrapper } = await visit("/search/severance?media=tv&tmdb=95396");
    expect(fetched.map((f) => f.url)).toContain("/api/rich_search/severance?media=tv&tmdb=95396");
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(wrapper.find(".home-search").exists()).toBe(false);
    const cards = wrapper.findAll(".group-card");
    expect(cards[0].classes()).not.toContain("group-card-collapsed");
    expect(cards[1].classes()).toContain("group-card-collapsed");
  });

  it("picks a season, then an episode, then a release, and remembers the episode target", async () => {
    handlers["/api/rich_search/"] = () => ({ groups: [severance], other: [] });
    handlers["/api/tv/95396/season/"] = (url) => (url.includes("/season/1/") ? seasonOne : { episodes: [{ episode_number: 2, name: "Goodbye, Mrs. Selvig", air_date: "2025-01-24" }] });
    const { wrapper, router } = await visit("/search/severance?media=tv&tmdb=95396");

    // two seasons: both closed, with resolution chips
    expect(wrapper.findAll(".season-toggle").map((b) => b.text().replace(/[^A-Za-z0-9 ]/g, "").trim())).toEqual(["Season 1", "Season 2"]);
    expect(wrapper.findAll(".season-toggle").every((b) => b.attributes("aria-expanded") === "false")).toBe(true);
    expect(wrapper.find(".season-resolutions").text()).toContain("1080p 2");
    expect(wrapper.find(".latest-episode").text()).toContain("S02E02");
    expect(wrapper.find(".latest-episode").text()).toContain("Goodbye, Mrs. Selvig");

    await wrapper.findAll(".season-toggle")[0].trigger("click");
    await flushPromises();
    expect(fetched.map((f) => f.url)).toContain("/api/tv/95396/season/1/");
    const titles = wrapper.findAll(".season-block")[0].findAll(".episode-title").map((t) => t.text().replace(/\s+/g, " "));
    // episode 3 is unreleased and has no torrents: hidden
    expect(titles).toEqual(["S01E01 · Good News About Hell", "S01E02 · Half Loop"]);
    expect(wrapper.findAll(".season-block")[0].text()).toContain("18 Feb 2022");

    await wrapper.findAll(".season-block")[0].findAll(".episode-card")[0].trigger("click");
    const rows = wrapper.findAll(".season-block")[0].findAll(".result-row");
    expect(rows.map((r) => r.find(".result-label").text())).toEqual(["1080p WEB", "720p WEB"]);
    await rows[0].trigger("click");
    await flushPromises();
    expect(readEpisodeTarget()).toEqual({ season: 1, episode: 1 });
    expect(router.currentRoute.value.name).toBe("filelist");
  });

  it("opens the latest episode's releases and remembers its episode", async () => {
    handlers["/api/rich_search/"] = () => ({ groups: [severance], other: [] });
    handlers["/api/tv/95396/season/"] = () => ({ episodes: [{ episode_number: 2, name: "Goodbye", air_date: "2025-01-24" }] });
    const { wrapper } = await visit("/search/severance?media=tv&tmdb=95396");
    await wrapper.find(".latest-episode .episode-card").trigger("click");
    await wrapper.find(".latest-episode .result-row").trigger("click");
    await flushPromises();
    expect(readEpisodeTarget()).toEqual({ season: 2, episode: 2 });
  });

  it("offers a season pack under an episode and opens its torrent link", async () => {
    handlers["/api/rich_search/"] = () => ({ groups: [severance], other: [] });
    handlers["/api/tv/95396/season/"] = () => ({ episodes: [{ episode_number: 2, name: "Goodbye", air_date: "2025-01-24" }] });
    const { wrapper, router } = await visit("/search/severance?media=tv&tmdb=95396");
    await wrapper.findAll(".season-toggle")[1].trigger("click");
    await flushPromises();
    await wrapper.findAll(".season-block")[1].find(".episode-card").trigger("click");
    const rows = wrapper.findAll(".season-block")[1].findAll(".result-row");
    expect(rows.map((r) => r.find(".result-label").text())).toHaveLength(2);
    await rows[1].trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("torrent");
    expect(readEpisodeTarget()).toEqual({ season: 2, episode: 2 });
  });

  it("a whole-season result forgets the episode target", async () => {
    const pack = { title: "Show S03 Complete 1080p", seeds: 4, magnet: MAGNET + "pack" };
    handlers["/api/rich_search/"] = () => ({ groups: [{ title: "Show", media_type: "tv", seasons: [{ season: 3, episodes: [pack] }], results: [] }], other: [] });
    const { wrapper } = await visit("/search/show?media=tv&tmdb=1");
    expect(wrapper.find(".episode-title").text()).toBe("Full season");
    const { rememberEpisodeTarget } = await import("../lib/magnet");
    rememberEpisodeTarget(1, 1);
    await wrapper.find(".episode-card").trigger("click");
    await wrapper.find(".result-row").trigger("click");
    await flushPromises();
    expect(readEpisodeTarget()).toBeNull();
  });

  it("shows loading while the season is fetched and survives a failed fetch", async () => {
    let release: (r: Response) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetched.push({ url });
        if (url.startsWith("/api/tv/")) return new Promise<Response>((resolve) => (release = resolve));
        if (url.startsWith("/api/rich_search/")) return new Response(JSON.stringify({ groups: [{ ...severance, seasons: [severance.seasons[0]] }], other: [] }));
        return new Response("{}", { status: 404 });
      }),
    );
    const { wrapper } = await visit("/search/severance?media=tv&tmdb=95396");
    expect(wrapper.find(".episode-loading").exists()).toBe(true);
    release(new Response("boom", { status: 500 }));
    await flushPromises();
    expect(wrapper.find(".episode-loading").exists()).toBe(false);
    // without TMDB details the episodes come from the torrent titles
    expect(wrapper.findAll(".episode-card").map((c) => c.find(".episode-title").text().replace(/\s+/g, " "))).toContain("S01E01");
  });

  it("marks watched episodes and movies from the local library", async () => {
    localStorage.setItem(
      "localTitles",
      JSON.stringify([
        { tmdb_id: 95396, media_type: "tv", title: "Severance", watched_at: 1, watched_episodes: [{ season: 2, episode: 2 }] },
        { tmdb_id: 438631, media_type: "movie", title: "Dune", watched_at: 5, watched_episodes: [] },
      ]),
    );
    handlers["/api/rich_search/"] = () => ({ groups: [severance, dune], other: [] });
    handlers["/api/tv/"] = () => ({ episodes: [] });
    const { wrapper } = await visit("/search/severance?media=tv&tmdb=95396");
    expect(wrapper.find(".latest-episode .watched-mark").exists()).toBe(true);
    const movie = wrapper.findAll(".group-card")[1];
    expect(movie.find(".group-title .watched-mark").exists()).toBe(true);
  });
});

// ---- history and favorites -----------------------------------------------------------------------

describe("history and favorites views", () => {
  it("lists the download history with download status and opens an entry", async () => {
    const downloaded = "magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&dn=One";
    localStorage.setItem("downloadHistory", JSON.stringify([{ magnet: downloaded, title: "One", ts: 2 }, { magnet: MAGNET, title: "Two", ts: 1 }]));
    handlers["/api/magnet_status/"] = () => ({ statuses: { aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: "downloaded" } });
    const { wrapper, router } = await visit("/search/[history]");
    expect(wrapper.find(".results-heading").text()).toBe("History");
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(wrapper.findAll(".result-row")).toHaveLength(2);
    const post = fetched.find((f) => f.url === "/api/magnet_status/");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ hashes: expect.arrayContaining(["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]), torrent_links: [] });
    await flushPromises();
    expect(wrapper.findAll(".result-row")[0].find(".result-status-downloaded").exists()).toBe(true);
    expect(wrapper.findAll(".result-row")[1].find(".result-status").exists()).toBe(false);
    await wrapper.findAll(".result-row")[0].trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("filelist");
    expect(router.currentRoute.value.fullPath).toBe("/magnet/" + encodeMagnetParam(downloaded));
  });

  it("shows the empty history message", async () => {
    const { wrapper } = await visit("/search/[history]");
    expect(wrapper.find(".empty-state").text()).toBe("Nothing in your history yet.");
  });

  it("lists favorites sorted by title and opens a file directly", async () => {
    localStorage.setItem(
      "favorites",
      JSON.stringify([
        { magnet: MAGNET, filename: "b.mkv", title: "b.mkv", ts: 1 },
        { magnet: MAGNET + "2", filename: "a.mkv", title: "a.mkv", ts: 2 },
      ]),
    );
    const { wrapper, router } = await visit("/search/[favorites]");
    expect(wrapper.find(".results-heading").text()).toBe("Favorites");
    expect(wrapper.findAll(".result-label").map((l) => l.text())).toEqual(["a.mkv", "b.mkv"]);
    await wrapper.findAll(".result-row")[0].trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("download");
    expect(router.currentRoute.value.fullPath).toBe("/magnet/" + encodeMagnetParam(MAGNET + "2") + "/a.mkv");
  });

  it("shows the empty favorites message", async () => {
    const { wrapper } = await visit("/search/[favorites]");
    expect(wrapper.find(".empty-state").text()).toContain("No favorites yet");
  });
});

// ---- search box and lifecycle ---------------------------------------------------------------------

describe("search box", () => {
  it("is prefilled, saves a new term to the search history and navigates", async () => {
    const { wrapper, router } = await visit("/search/dune");
    const input = wrapper.find("input.form-control");
    expect((input.element as HTMLInputElement).value).toBe("dune");
    await input.setValue("  big buck bunny ");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/search/big%20buck%20bunny");
    expect(JSON.parse(localStorage.getItem("searchHistory") || "[]")).toEqual(["big buck bunny"]);
  });

  it("opens a pasted magnet link instead of searching", async () => {
    const { wrapper, router } = await visit("/search/dune");
    await wrapper.find("input.form-control").setValue(MAGNET);
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("filelist");
    expect(localStorage.getItem("searchHistory")).toBeNull();
  });

  it("ignores an empty submit and is blank on history and favorites", async () => {
    const { wrapper, router } = await visit("/search/dune");
    await wrapper.find("input.form-control").setValue("   ");
    await wrapper.find("form").trigger("submit");
    expect(router.currentRoute.value.fullPath).toBe("/search/dune");
    await router.push("/search/[history]");
    await flushPromises();
    expect((wrapper.find("input.form-control").element as HTMLInputElement).value).toBe("");
  });
});

describe("request cancellation", () => {
  it("closes the stream and ignores late events when the term changes", async () => {
    const { wrapper, router } = await visit("/search/dune");
    const first = FakeEventSource.last("/api/rich_search_events/");
    await router.push("/search/arrival");
    await flushPromises();
    expect(first.closed).toBe(true);
    const second = FakeEventSource.last("/api/rich_search_events/");
    expect(second.url).toBe("/api/rich_search_events/arrival");
    expect(wrapper.find(".spinner").exists()).toBe(true);
    first.emit({ groups: [dune], other: [], done: true });
    await flushPromises();
    expect(wrapper.findAll(".group-card")).toHaveLength(0);
    second.emit({ groups: [{ ...dune, title: "Arrival" }], other: [], done: true });
    await flushPromises();
    expect(text(wrapper)).toContain("Arrival");
  });

  it("closes the stream when leaving the screen", async () => {
    const { router } = await visit("/search/dune");
    const source = FakeEventSource.last("/api/rich_search_events/");
    await router.push("/");
    await flushPromises();
    expect(source.closed).toBe(true);
  });

  it("ignores a late blocking response after navigating away", async () => {
    handlers["/api/rich_search/"] = () => ({ groups: [dune], other: [] });
    const { wrapper, router } = await visit("/search/dune?media=movie&tmdb=1");
    await router.push("/search/other?media=movie&tmdb=2");
    await flushPromises();
    expect(wrapper.findAll(".group-card")).toHaveLength(1);
  });
});

// ---- keyboard and remote -------------------------------------------------------------------------------

describe("keyboard and remote", () => {
  it("focuses the first result when results arrive and opens it with Enter", async () => {
    const { wrapper } = await visit("/search/dune");
    FakeEventSource.last("/api/rich_search_events/").emit({ groups: [dune, { ...dune, tmdb_id: 2, title: "Two" }], other: [], done: true });
    await flushPromises();
    await vi.waitFor(() => expect(document.activeElement?.classList.contains("group-card")).toBe(true));
    expect(document.activeElement?.getAttribute("data-group-key")).toBe("438631");
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
    await flushPromises();
    expect(wrapper.findAll(".group-card")[0].classes()).not.toContain("group-card-collapsed");
    // focus moves into the opened card
    expect(document.activeElement?.classList.contains("result-row")).toBe(true);
    expect(wrapper.findAll(".group-card")[0].element.contains(document.activeElement)).toBe(true);
  });

  it("gives every actionable row, card and season toggle a native focus stop", async () => {
    handlers["/api/rich_search/"] = () => ({ groups: [severance, dune], other: [magnetRes("Loose")] });
    handlers["/api/tv/"] = () => ({ episodes: [] });
    const { wrapper } = await visit("/search/severance?media=tv&tmdb=95396");
    const stops = wrapper.findAll("button, [tabindex='0']");
    expect(stops.length).toBeGreaterThan(4);
    // collapsed card is focusable; the opened one hands focus to its content
    expect(wrapper.findAll(".group-card")[1].attributes("tabindex")).toBe("0");
    expect(wrapper.findAll(".group-card")[0].attributes("tabindex")).toBe("-1");
    expect(wrapper.findAll(".season-toggle").length).toBe(2);
    expect(wrapper.findAll(".episode-card").every((c) => c.attributes("tabindex") === "0")).toBe(true);
  });

  it("Backspace goes back", async () => {
    await visit("/search/dune");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", keyCode: 8, bubbles: true, cancelable: true }));
    expect(back).toHaveBeenCalled();
  });
});
