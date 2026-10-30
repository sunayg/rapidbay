import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App.vue";
import { uninstallFocus } from "../lib/focus";
import * as libraryModule from "../lib/library";
import { markFileCompleted, refreshLibrary } from "../lib/library";
import { encodeMagnetParam, readEpisodeTarget, rememberEpisodeTarget } from "../lib/magnet";
import { createAppRouter } from "../router";

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
    this.onmessage?.({ data: JSON.stringify(payload) });
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
      if (!key) return new Response("{}", { status: 500 });
      const body = handlers[key](url, init);
      if (body instanceof Response) return body;
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}

const MAGNET = "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Show";
const HASH = "abcdef0123456789abcdef0123456789abcdef01";
const filesPath = `/magnet/${encodeMagnetParam(MAGNET)}/`;
const downloadPath = (file: string) => `/magnet/${encodeMagnetParam(MAGNET)}/${encodeURIComponent(file)}`;
const posts = (prefix: string) => fetched.filter((f) => f.url.startsWith(prefix) && f.init?.method === "POST");
const body = (call: { init?: RequestInit }) => Object.fromEntries((call.init?.body as URLSearchParams).entries());

let mounted: VueWrapper | null = null;

async function visit(path: string, before?: string) {
  const router = createAppRouter(createMemoryHistory("/"));
  if (before) await router.push(before);
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
  handlers = {
    "/api/magnet_files/": () => ({}),
    "/api/magnet_download/": () => ({}),
    "/api/torrent_url_to_magnet/": () => ({ magnet_link: MAGNET }),
  };
  vi.stubGlobal("EventSource", FakeEventSource);
  Object.defineProperty(window, "EventSource", { value: FakeEventSource, configurable: true, writable: true });
  stubFetch();
  // jsdom reports an Apple vendor, which would suppress <track> subtitles.
  vi.spyOn(navigator, "vendor", "get").mockReturnValue("Google Inc.");
  vi.spyOn(libraryModule, "syncLibraryFromLocalHistory").mockResolvedValue();
  vi.spyOn(libraryModule, "reportLibraryEvents").mockResolvedValue(true);
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  uninstallFocus();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- torrent link ------------------------------------------------------------------

describe("torrent link screen", () => {
  it("converts the link and replaces itself with the file list", async () => {
    const { router, wrapper } = await visit("/torrent/" + encodeURIComponent("http://t/x.torrent") + "/", "/search/x");
    expect(body(posts("/api/torrent_url_to_magnet/")[0])).toEqual({ url: "http://t/x.torrent" });
    expect(router.currentRoute.value.name).toBe("filelist");
    expect(wrapper.find('[data-screen="filelist-screen"]').exists()).toBe(true);
    // replaced, so Back goes to the search, not the torrent link
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/search/x");
  });

  it("shows an error with retry when conversion fails", async () => {
    handlers["/api/torrent_url_to_magnet/"] = () => new Response("{}", { status: 500 });
    const { router, wrapper } = await visit("/torrent/x/");
    expect(wrapper.find('[role="alert"]').text()).toContain("Couldn't read that torrent link");
    handlers["/api/torrent_url_to_magnet/"] = () => ({ magnet_link: MAGNET });
    await wrapper.find(".dl-button").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("filelist");
  });
});

// ---- file list ---------------------------------------------------------------------

describe("filelist screen", () => {
  it("asks for the files, shows a spinner and renders the list pushed over SSE", async () => {
    const { wrapper } = await visit(filesPath);
    expect(body(posts("/api/magnet_files/")[0])).toEqual({ magnet_link: MAGNET });
    expect(wrapper.find(".spinner").exists()).toBe(true);
    const source = FakeEventSource.last("/api/magnet_events/");
    expect(source.url).toBe(`/api/magnet_events/${HASH}/`);
    source.emit({ files: ["Show.S01E01.mkv", "Show.S01E02.mkv", "readme.txt"], file_statuses: { "Show.S01E02.mkv": "downloaded", "readme.txt": "downloading" } });
    await flushPromises();
    expect(wrapper.find(".spinner").exists()).toBe(false);
    const rows = wrapper.findAll(".file-row");
    expect(rows.map((r) => r.find(".file-name").text())).toEqual(["Show.S01E01.mkv", "Show.S01E02.mkv", "readme.txt"]);
    expect(rows[1].text()).toContain("Downloaded");
    expect(rows[2].text()).toContain("Downloading");
  });

  it("marks watched files and focuses the first unwatched one", async () => {
    markFileCompleted(MAGNET, "Show.S01E01.mkv");
    const { wrapper } = await visit(filesPath);
    FakeEventSource.last("/api/magnet_events/").emit({ files: ["Show.S01E01.mkv", "Show.S01E02.mkv"] });
    await flushPromises();
    const rows = wrapper.findAll(".file-row");
    expect(rows[0].text()).toContain("Watched");
    expect(document.activeElement).toBe(rows[1].element);
  });

  it("opens a file on click and on Enter, pushing the download route", async () => {
    const { router, wrapper } = await visit(filesPath);
    FakeEventSource.last("/api/magnet_events/").emit({ files: ["a b.mkv", "c.mkv"] });
    await flushPromises();
    await wrapper.findAll(".file-row")[1].trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("download");
    expect(router.currentRoute.value.params.filename).toBe("c.mkv");
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("filelist");
    // keyboard: first row is focused, Enter (the remote's select) activates it
    FakeEventSource.last("/api/magnet_events/").emit({ files: ["a b.mkv", "c.mkv"] });
    await flushPromises();
    (wrapper.findAll(".file-row")[0].element as HTMLElement).focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
    await flushPromises();
    expect(router.currentRoute.value.params.filename).toBe("a b.mkv");
  });

  it("opens a lone file directly, replacing the list in the history", async () => {
    const { router } = await visit(filesPath, "/search/x");
    FakeEventSource.last("/api/magnet_events/").emit({ files: ["Movie.mkv"] });
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("download");
    expect(FakeEventSource.instances[0].closed).toBe(true);
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/search/x");
  });

  it("lists a lone executable instead of opening it", async () => {
    const { router, wrapper } = await visit(filesPath);
    FakeEventSource.last("/api/magnet_events/").emit({ files: ["setup.exe"] });
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("filelist");
    expect(wrapper.findAll(".file-row")).toHaveLength(1);
  });

  it("auto-picks the remembered episode and forgets the target", async () => {
    rememberEpisodeTarget(1, 2);
    const { router } = await visit(filesPath);
    FakeEventSource.last("/api/magnet_events/").emit({ files: ["Show.S01E01.mkv", "Show.S01E02.mkv", "Show.S01E02.sample.txt"] });
    await flushPromises();
    expect(router.currentRoute.value.params.filename).toBe("Show.S01E02.mkv");
    expect(readEpisodeTarget()).toBeNull();
  });

  it("shows the list and clears the target when the episode is ambiguous or missing", async () => {
    rememberEpisodeTarget(1, 2);
    const { router, wrapper } = await visit(filesPath);
    FakeEventSource.last("/api/magnet_events/").emit({ files: ["Show.S01E02.mkv", "Show.S01E02.1080p.mkv"] });
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("filelist");
    expect(wrapper.findAll(".file-row")).toHaveLength(2);
    expect(readEpisodeTarget()).toBeNull();
  });

  it("falls back to polling when the event stream fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    handlers[`/api/magnet/${HASH}/`] = () => (++calls < 2 ? { files: null } : { files: ["a.mkv", "b.mkv"] });
    const { wrapper } = await visit(filesPath);
    FakeEventSource.last("/api/magnet_events/").fail();
    await flushPromises();
    expect(wrapper.find(".spinner").exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(1100);
    await flushPromises();
    expect(calls).toBe(2);
    expect(wrapper.findAll(".file-row")).toHaveLength(2);
  });

  it("shows an error with retry when the request fails", async () => {
    handlers["/api/magnet_files/"] = () => new Response("{}", { status: 500 });
    const { wrapper } = await visit(filesPath);
    expect(wrapper.find('[role="alert"]').text()).toContain("Couldn't load the file list");
    handlers["/api/magnet_files/"] = () => ({});
    await wrapper.find(".dl-button").trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    FakeEventSource.last("/api/magnet_events/").emit({ files: ["a.mkv", "b.mkv"] });
    await flushPromises();
    expect(wrapper.findAll(".file-row")).toHaveLength(2);
  });

  it("shows an empty message and toggles the torrent favourite", async () => {
    const { wrapper } = await visit(filesPath);
    FakeEventSource.last("/api/magnet_events/").emit({ files: [] });
    await flushPromises();
    expect(text(wrapper)).toContain("No files found");
    const fav = wrapper.find(".favorite-btn");
    expect(fav.attributes("aria-pressed")).toBe("false");
    await fav.trigger("click");
    expect(fav.attributes("aria-pressed")).toBe("true");
    expect(libraryModule.isFavorite(MAGNET, "")).toBe(true);
    await fav.trigger("click");
    expect(libraryModule.isFavorite(MAGNET, "")).toBe(false);
  });

  it("closes the stream and stops polling when the route changes", async () => {
    const { router } = await visit(filesPath);
    const source = FakeEventSource.last("/api/magnet_events/");
    await router.push("/settings");
    await flushPromises();
    expect(source.closed).toBe(true);
  });
});

// ---- download ----------------------------------------------------------------------

const info = (extra: Record<string, unknown> = {}) => ({ status: "downloading", progress: 0.25, peers: 7, download_rate: 1500000, ...extra });

describe("download screen", () => {
  async function download(before = filesPath) {
    return visit(downloadPath("Show.S01E01.mkv"), before);
  }

  it("starts the download, records history and shows progress from SSE", async () => {
    const { wrapper } = await download();
    expect(body(posts("/api/magnet_download/")[0])).toEqual({ magnet_link: MAGNET, filename: "Show.S01E01.mkv" });
    expect(libraryModule.getHistory()[0].magnet).toBe(MAGNET);
    expect(libraryModule.reportLibraryEvents).toHaveBeenCalledWith([expect.objectContaining({ event: "download", filename: "Show.S01E01.mkv", title: "Show" })]);
    expect(wrapper.find(".dl-title").text()).toBe("Show.S01E01.mkv");
    const source = FakeEventSource.last("/api/magnet_events/");
    expect(source.url).toBe(`/api/magnet_events/${HASH}/Show.S01E01.mkv`);
    source.emit(info());
    await flushPromises();
    expect(text(wrapper)).toContain("downloading (25%)");
    expect(text(wrapper)).toContain("7 Peers · 1.50 MB/s");
    expect(wrapper.find('[role="progressbar"]').attributes("aria-valuenow")).toBe("25");
    source.emit(info({ progress: 0.5 }));
    await flushPromises();
    expect(text(wrapper)).toContain("downloading (50%)");
    expect(wrapper.find('[role="progressbar"]').attributes("aria-valuenow")).toBe("50");
  });

  it("cancel posts to the cancel endpoint and navigates back", async () => {
    const { router, wrapper } = await download();
    FakeEventSource.last("/api/magnet_events/").emit(info());
    await flushPromises();
    const cancel = wrapper.find(".cancel-download");
    expect(cancel.text()).toBe("Cancel download");
    await cancel.trigger("click");
    expect(cancel.attributes("disabled")).toBeDefined();
    await flushPromises();
    expect(posts(`/api/magnet/${HASH}/Show.S01E01.mkv/cancel`)).toHaveLength(1);
    expect(router.currentRoute.value.name).toBe("filelist");
  });

  it("navigates back even if the cancel request fails", async () => {
    handlers[`/api/magnet/${HASH}/`] = () => new Response("{}", { status: 500 });
    const { router, wrapper } = await download();
    FakeEventSource.last("/api/magnet_events/").emit(info());
    await flushPromises();
    await wrapper.find(".cancel-download").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("filelist");
  });

  it("cancel falls back to the file list when opened directly", async () => {
    const { router, wrapper } = await download(); // no earlier entry in history
    const fresh = await visit(downloadPath("x.mkv"));
    FakeEventSource.last("/api/magnet_events/").emit(info());
    await flushPromises();
    await fresh.wrapper.find(".cancel-download").trigger("click");
    await flushPromises();
    expect(fresh.router.currentRoute.value.name).toBe("filelist");
    expect(router).toBeTruthy();
    expect(wrapper).toBeTruthy();
  });

  it("hides cancel once the file is converting, finishing up or ready", async () => {
    const { wrapper } = await download();
    const source = FakeEventSource.last("/api/magnet_events/");
    for (const status of ["converting", "finishing_up"]) {
      source.emit(info({ status, progress: undefined }));
      await flushPromises();
      expect(wrapper.find(".cancel-download").exists()).toBe(false);
    }
    source.emit(info({ status: "queued" }));
    await flushPromises();
    expect(wrapper.find(".cancel-download").exists()).toBe(true);
  });

  const SESSION = `/api/magnet/${HASH}/Show.S01E01.mkv/session`;
  const readySession = { status: "ready", filename: "Show.S01E01.mkv", supported: true, playback: "session" as const };

  it("opens an encode session as soon as a downloading file can stream, resuming where it left off", async () => {
    localStorage.setItem(libraryModule.getVideoPositionKey(MAGNET, "Show.S01E01.mkv"), JSON.stringify({ position: 612.8, duration: 3000, ts: Date.now() }));
    handlers[SESSION] = () => ({ url: "/api/hls/abc123/master.m3u8" });
    const { wrapper } = await download();
    const source = FakeEventSource.last("/api/magnet_events/");
    source.emit(info());
    await flushPromises();
    expect(posts(SESSION)).toHaveLength(0); // not enough of the file yet
    expect(wrapper.find(".stream-btn").exists()).toBe(false); // there is no play button to press
    source.emit(info({ can_stream: true }));
    await flushPromises();
    const call = posts(SESSION);
    expect(call).toHaveLength(1);
    expect(call[0].url).toContain("?start=612");
    const host = wrapper.findComponent({ name: "PlayerHost" });
    expect(host.props("url")).toBe("/api/hls/abc123/master.m3u8");
    expect(host.props("supported")).toBe(true);
    expect(host.props("subtitles")).toEqual([]);
    expect(host.props("downloadStatus")).toBe("downloading");
    expect(host.props("downloadProgress")).toBe(0.25);
  });

  it("shows on the progress bar where playback will begin", async () => {
    const { wrapper } = await download();
    const source = FakeEventSource.last("/api/magnet_events/");
    source.emit(info({ progress: 0.1, start_at: 0.3 }));
    await flushPromises();
    expect(wrapper.find(".spinner-marker").attributes("style")).toContain("left: 30%");
    expect(wrapper.find(".spinner-marker-label").text()).toBe("Playback starts here");
    expect(wrapper.find(".spinner-marker").classes()).not.toContain("reached");
    source.emit(info({ progress: 0.4, start_at: 0.3 }));
    await flushPromises();
    expect(wrapper.find(".spinner-marker").classes()).toContain("reached");
    source.emit(info({ progress: 0.4 })); // the server has nothing to say about it (not a video)
    await flushPromises();
    expect(wrapper.find(".spinner-marker").exists()).toBe(false);
  });

  it("keeps the same session and player when the download finishes", async () => {
    handlers[SESSION] = () => ({ url: "/api/hls/abc123/master.m3u8" });
    const { wrapper } = await download();
    const source = FakeEventSource.last("/api/magnet_events/");
    source.emit(info({ can_stream: true }));
    await flushPromises();
    const host = wrapper.findComponent({ name: "PlayerHost" });
    source.emit(info({ ...readySession, progress: 1, subtitles: ["Show_eng.vtt"] }));
    await flushPromises();
    const still = wrapper.findComponent({ name: "PlayerHost" });
    expect(still.element).toBe(host.element);
    expect(still.props("url")).toBe("/api/hls/abc123/master.m3u8");
    expect(still.props("downloadProgress")).toBeNull();
    expect(posts(SESSION)).toHaveLength(1); // no second session
  });

  it("explains a refusal while downloading, without an error, and tries again later", async () => {
    vi.useFakeTimers();
    let answers = [{ url: null, reason: "capacity" }, { url: "/api/hls/abc123/master.m3u8" }];
    handlers[SESSION] = () => answers.shift();
    const { wrapper } = await download();
    const source = FakeEventSource.last("/api/magnet_events/");
    source.emit(info({ can_stream: true }));
    await flushPromises();
    expect(wrapper.find(".stream-message").text()).toContain("capacity");
    expect(wrapper.find(".dl-error").exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(5100);
    source.emit(info({ can_stream: true }));
    await flushPromises();
    expect(wrapper.findComponent({ name: "PlayerHost" }).props("url")).toBe("/api/hls/abc123/master.m3u8");
    vi.useRealTimers();
  });

  it("does not keep asking for a file that can never stream while it downloads", async () => {
    vi.useFakeTimers();
    handlers[SESSION] = () => ({ url: null, reason: "unsupported_format" });
    const { wrapper } = await download();
    const source = FakeEventSource.last("/api/magnet_events/");
    source.emit(info({ can_stream: true }));
    await flushPromises();
    await vi.advanceTimersByTimeAsync(20000);
    source.emit(info({ can_stream: true }));
    await flushPromises();
    expect(posts(SESSION)).toHaveLength(1);
    expect(wrapper.find(".stream-message").text()).toContain("once it has finished");
    vi.useRealTimers();
  });

  it("opens a session for a finished file the browser cannot play directly", async () => {
    handlers[SESSION] = () => ({ url: "/api/hls/abc123/master.m3u8" });
    const { wrapper } = await download();
    FakeEventSource.last("/api/magnet_events/").emit(info(readySession));
    await flushPromises();
    expect(posts(SESSION)).toHaveLength(1);
    expect(wrapper.findComponent({ name: "PlayerHost" }).props("url")).toBe("/api/hls/abc123/master.m3u8");
  });

  it("shows an error with retry when a finished file has no room for a session", async () => {
    handlers[SESSION] = () => ({ url: null, reason: "capacity" });
    const { wrapper } = await download();
    FakeEventSource.last("/api/magnet_events/").emit(info(readySession));
    await flushPromises();
    expect(wrapper.findComponent({ name: "PlayerHost" }).exists()).toBe(false);
    expect(wrapper.find(".dl-error").text()).toContain("capacity");
  });

  it("plays a browser-friendly MP4 directly, with no session", async () => {
    const { wrapper } = await download();
    FakeEventSource.last("/api/magnet_events/").emit(info({ status: "ready", filename: "x y.mp4", supported: true, playback: "direct" }));
    await flushPromises();
    expect(wrapper.findComponent({ name: "PlayerHost" }).props("url")).toBe(`/play/${HASH}/x%20y.mp4`);
    expect(posts("/api/magnet/")).toHaveLength(0);
  });

  it("falls back to the progress view when playback fails, and does not retry the session", async () => {
    handlers[SESSION] = () => ({ url: "/api/hls/abc123/master.m3u8" });
    const { wrapper } = await download();
    const source = FakeEventSource.last("/api/magnet_events/");
    source.emit(info({ can_stream: true }));
    await flushPromises();
    wrapper.findComponent({ name: "PlayerHost" }).vm.$emit("stream-error");
    await flushPromises();
    expect(wrapper.findComponent({ name: "PlayerHost" }).exists()).toBe(false);
    source.emit(info({ can_stream: true }));
    await flushPromises();
    expect(wrapper.findComponent({ name: "PlayerHost" }).exists()).toBe(false);
    expect(posts(SESSION)).toHaveLength(1);
    // a directly playable MP4 is still welcome
    source.emit(info({ status: "ready", filename: "a.mp4", supported: true, playback: "direct" }));
    await flushPromises();
    expect(wrapper.findComponent({ name: "PlayerHost" }).exists()).toBe(true);
  });

  it("back from the player returns to the file list", async () => {
    const { router, wrapper } = await download();
    FakeEventSource.last("/api/magnet_events/").emit(info({ status: "ready", filename: "a.mp4", supported: true, playback: "direct" }));
    await flushPromises();
    wrapper.findComponent({ name: "PlayerHost" }).vm.$emit("back");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("filelist");
  });

  it("falls back to polling until ready when the event stream fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    handlers[`/api/magnet/${HASH}/Show.S01E01.mkv`] = () => (++calls < 3 ? info({ progress: calls / 10 }) : info({ status: "ready", filename: "a.mp4", supported: true, playback: "direct" }));
    const { wrapper } = await download();
    FakeEventSource.last("/api/magnet_events/").fail();
    await flushPromises();
    expect(calls).toBe(1);
    expect(text(wrapper)).toContain("downloading (10%)");
    await vi.advanceTimersByTimeAsync(1100);
    await flushPromises();
    expect(text(wrapper)).toContain("downloading (20%)");
    await vi.advanceTimersByTimeAsync(1100);
    await flushPromises();
    expect(wrapper.findComponent({ name: "PlayerHost" }).exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toBe(3); // stopped at ready
  });

  it("shows an error with retry when the download cannot be started", async () => {
    handlers["/api/magnet_download/"] = () => new Response("{}", { status: 500 });
    const { wrapper } = await download();
    expect(wrapper.find('[role="alert"]').text()).toContain("Couldn't start the download");
    expect(FakeEventSource.instances).toHaveLength(0);
    handlers["/api/magnet_download/"] = () => ({});
    await wrapper.find(".dl-button").trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    FakeEventSource.last("/api/magnet_events/").emit(info());
    await flushPromises();
    expect(text(wrapper)).toContain("downloading (25%)");
  });

  it("shows an error when polling loses the server", async () => {
    handlers[`/api/magnet/${HASH}/Show.S01E01.mkv`] = () => new Response("{}", { status: 500 });
    const { wrapper } = await download();
    FakeEventSource.last("/api/magnet_events/").fail();
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain("Lost contact");
  });

  it("closes the stream and stops polling when the route changes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    handlers[`/api/magnet/${HASH}/Show.S01E01.mkv`] = () => (++calls, info());
    const { router } = await download();
    const source = FakeEventSource.last("/api/magnet_events/");
    source.fail();
    await flushPromises();
    expect(calls).toBe(1);
    await router.push("/settings");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toBe(1);
    const second = await download();
    const live = FakeEventSource.last("/api/magnet_events/");
    await second.router.push("/settings");
    await flushPromises();
    expect(live.closed).toBe(true);
  });

  it("is keyboard reachable: Enter on the focused cancel button cancels", async () => {
    const { router, wrapper } = await download();
    FakeEventSource.last("/api/magnet_events/").emit(info());
    await flushPromises();
    (wrapper.find(".cancel-download").element as HTMLElement).focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
    await flushPromises();
    expect(posts("/api/magnet/").some((c) => c.url.endsWith("/cancel"))).toBe(true);
    expect(router.currentRoute.value.name).toBe("filelist");
  });
});
