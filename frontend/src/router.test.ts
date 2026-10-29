import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.vue";
import * as api from "./lib/api";
import { encodeMagnetParam } from "./lib/magnet";
import { createAppRouter, runtimeBase } from "./router";

vi.mock("./components/SettingsPage.vue", () => ({ default: { template: "<div class='settings-stub'>categories</div>" } }));

beforeEach(() => {
  // The download screens talk to the API as soon as they mount; keep it pending.
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
});

async function visit(path: string) {
  const router = createAppRouter(createMemoryHistory("/next/"));
  router.push(path);
  await router.isReady();
  const wrapper = mount(App, { global: { plugins: [router] } });
  await flushPromises();
  return { router, wrapper };
}

describe("router", () => {
  it("chooses the base from the path", () => {
    expect(runtimeBase("/next/search/x")).toBe("/next/");
    expect(runtimeBase("/next")).toBe("/next/");
    expect(runtimeBase("/settings")).toBe("/");
    expect(runtimeBase("/nextgen")).toBe("/");
  });

  it.each([
    ["/", "search-screen"],
    ["/search", "search-results-screen"],
    ["/search/dune", "search-results-screen"],
    ["/torrent/abc/", "torrent-link-screen"],
    ["/torrent/abc", "torrent-link-screen"],
    ["/magnet/xyz/", "filelist-screen"],
    ["/magnet/xyz/file.mkv", "download-screen"],
    ["/nonsense/here", "search-screen"],
  ])("renders %s as %s", async (path, screen) => {
    const { wrapper } = await visit(path);
    expect(wrapper.find(`[data-screen="${screen}"]`).exists()).toBe(true);
  });

  it("round-trips a search term and a magnet link like the legacy display_view", async () => {
    const magnet = "magnet:?xt=urn:btih:abc&dn=Some+Show&tr=udp://t:80/a";
    const { router, wrapper } = await visit(`/magnet/${encodeMagnetParam(magnet)}/${encodeURIComponent("a b.mkv")}`);
    expect(router.currentRoute.value.params.filename).toBe("a b.mkv");
    expect(wrapper.vm.$route.params.magnet_link).not.toBe(magnet); // raw param is still encoded once
    const posted = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([url]) => url === "/api/magnet_download/")!;
    expect((posted[1].body as URLSearchParams).get("magnet_link")).toBe(magnet);
    expect((posted[1].body as URLSearchParams).get("filename")).toBe("a b.mkv");

    const search = await visit("/search/" + encodeURIComponent("a/b c&d"));
    expect(search.router.currentRoute.value.params.searchterm).toBe("a/b c&d");
  });

  it("mounts the settings page at /settings", async () => {
    const { wrapper } = await visit("/settings");
    expect(wrapper.text()).toContain("Settings");
    expect(wrapper.find(".settings-stub").exists()).toBe(true);
  });

  it("drops pending requests when the route changes", async () => {
    const clear = vi.spyOn(api, "clearPending");
    const { router } = await visit("/");
    clear.mockClear();
    await router.push("/search/x");
    expect(clear).toHaveBeenCalled();
  });
});
