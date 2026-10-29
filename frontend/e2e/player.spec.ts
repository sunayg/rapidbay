import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

// Runs against the Docker stack: http://localhost:5050/next/
// The API and the media are mocked with page.route; the media are small real
// VP9/Opus files (e2e/fixtures: a 10 s MP4 and the same clip as fMP4 HLS), so
// the <video> element really decodes, plays, seeks and shows captions. VP9 is
// used because the Chromium that Playwright ships has no H.264.
const MAGNET = "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Some.Show";
const HASH = "abcdef0123456789abcdef0123456789abcdef01";
const FILE = "Some.Show.S01E01.1080p.mkv";
const NEXT_FILE = "Some.Show.S01E02.1080p.mkv";
const magnetUrl = (file: string) => `/next/magnet/${encodeURIComponent(encodeURIComponent(MAGNET))}/${encodeURIComponent(file)}`;
const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));
const VTT = (text: string) => `WEBVTT\n\n00:00:00.000 --> 00:00:09.000\n${text}\n`;

type Info = Record<string, unknown>;
const READY: Info = { status: "ready", progress: 1, filename: "sample.mp4", supported: true, subtitles: ["sample_eng.vtt", "sample_nld.vtt"] };

async function serveBytes(route: Route, path: string, type: string): Promise<void> {
  const body = readFileSync(path);
  const range = route.request().headers()["range"];
  const match = range && /bytes=(\d+)-(\d*)/.exec(range);
  if (match) {
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
    await route.fulfill({
      status: 206,
      headers: { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${body.length}` },
      body: body.subarray(start, end + 1),
    });
  } else {
    await route.fulfill({ status: 200, headers: { "Content-Type": type, "Accept-Ranges": "bytes" }, body });
  }
}

interface Mocks {
  info: { current: Info };
  hlsManifestStatus: { current: number };
  nextFile: { current: Record<string, unknown> };
  played: string[];
}

async function mockStack(page: Page, info: Info): Promise<Mocks> {
  const mocks: Mocks = { info: { current: info }, hlsManifestStatus: { current: 200 }, nextFile: { current: { next_filename: null, next_magnet: null } }, played: [] };
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("__seeded")) {
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem("__seeded", "1");
    }
  });
  await page.route("**/api/magnet_download/", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/library/**", (route) => route.fulfill({ json: { titles: [] } }));
  await page.route(`**/api/magnet_events/${HASH}/**`, (route) => route.abort());
  await page.route(`**/api/magnet/${HASH}/${encodeURIComponent(FILE)}`, (route) => route.fulfill({ json: mocks.info.current }));
  await page.route(`**/api/magnet/${HASH}/${encodeURIComponent(NEXT_FILE)}`, (route) => route.fulfill({ json: { status: "queued" } }));
  await page.route(`**/api/magnet/${HASH}/`, (route) => route.fulfill({ json: { files: [FILE, NEXT_FILE] } }));
  await page.route("**/api/next_file/**", (route) => route.fulfill({ json: mocks.nextFile.current }));
  await page.route("**/play/**", async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(`/play/${HASH}/`, "");
    mocks.played.push(path);
    if (path === "sample.mp4") return serveBytes(route, join(FIXTURES, "sample.mp4"), "video/mp4");
    if (path === "sample_eng.vtt") return route.fulfill({ contentType: "text/vtt", body: VTT("Hello captions") });
    if (path === "sample_nld.vtt") return route.fulfill({ contentType: "text/vtt", body: VTT("Hallo ondertitels") });
    if (path === "hls/master.m3u8") {
      if (mocks.hlsManifestStatus.current !== 200) return route.fulfill({ status: mocks.hlsManifestStatus.current, body: "nope" });
      // Still converting: no end marker, so the playlist looks live.
      const playlist = readFileSync(join(FIXTURES, "hls", "master.m3u8"), "utf8")
        .replace("#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-PLAYLIST-TYPE:EVENT")
        .replace("#EXT-X-ENDLIST", "");
      return route.fulfill({ contentType: "application/vnd.apple.mpegurl", body: playlist });
    }
    if (path === "init.mp4") return serveBytes(route, join(FIXTURES, "hls", "init.mp4"), "video/mp4");
    if (/^seg\d+\.m4s$/.test(path)) return serveBytes(route, join(FIXTURES, "hls", path), "video/iso.segment");
    return route.fulfill({ status: 404, body: "" });
  });
  return mocks;
}

const video = (page: Page) => page.locator("video");
const stat = (page: Page) =>
  video(page).evaluate((v: HTMLVideoElement) => ({
    t: v.currentTime,
    paused: v.paused,
    ended: v.ended,
    duration: v.duration,
    src: v.currentSrc,
    width: v.videoWidth,
    ready: v.readyState,
  }));

async function playing(page: Page, after = 1): Promise<void> {
  await expect.poll(async () => (await stat(page)).t, { timeout: 15_000 }).toBeGreaterThan(after);
}

test("an MP4 really plays, seeks, pauses, and shows captions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mockStack(page, READY);
  await page.goto(magnetUrl(FILE));
  await expect(page.locator('[data-screen="player-screen"]')).toBeVisible();
  await playing(page, 1);
  let s = await stat(page);
  expect(s.src).toMatch(/\/play\/.+\/sample\.mp4$/);
  expect(s.width).toBe(192); // frames were decoded
  expect(s.duration).toBeGreaterThan(9);
  expect(s.paused).toBe(false);

  // Seek with the bar, then with the keyboard.
  await page.locator(".player-scrub").evaluate((el: HTMLInputElement) => {
    el.value = "700";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect.poll(async () => (await stat(page)).t).toBeGreaterThan(6.9);
  await page.keyboard.press("ArrowLeft"); // -15 s clamps to the start
  await expect.poll(async () => (await stat(page)).t).toBeLessThan(2);
  await page.keyboard.press("Space");
  await expect.poll(async () => (await stat(page)).paused).toBe(true);
  s = await stat(page);
  await page.waitForTimeout(600);
  expect((await stat(page)).t).toBeCloseTo(s.t, 1);
  await page.keyboard.press("k");
  await expect.poll(async () => (await stat(page)).paused).toBe(false);

  // Captions: off at first, then English from the menu.
  const showing = () => video(page).evaluate((v: HTMLVideoElement) => Array.from(v.textTracks).map((t) => `${t.language}:${t.mode}`));
  await expect.poll(showing).toEqual(["eng:disabled", "nld:disabled"]);
  await page.getByRole("button", { name: "Audio and subtitles" }).click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  await expect.poll(showing).toEqual(["eng:showing", "nld:disabled"]);
  await expect
    .poll(() => video(page).evaluate((v: HTMLVideoElement) => Array.from(v.textTracks[0].activeCues || []).map((c) => (c as VTTCue).text)))
    .toEqual(["Hello captions"]);
  // The choice is remembered, and the caption button shows it.
  expect(await page.evaluate(() => localStorage.getItem("captionLanguage"))).toBe("eng");
  await page.keyboard.press("Escape");
  await expect(page.locator(".player-tracks")).toHaveCount(0);
  await expect(page.locator(".caption-btn")).toHaveText("eng");
  await page.locator(".caption-btn").click(); // eng -> nld
  await expect.poll(showing).toEqual(["eng:hidden", "nld:showing"]);
  await page.locator(".caption-btn").click(); // nld -> off
  await expect.poll(showing).toEqual(["eng:hidden", "nld:hidden"]);

  // Controls hide by themselves and come back on a key.
  await page.mouse.move(5, 5);
  await expect(page.locator(".player-controls")).toBeHidden({ timeout: 6000 });
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".player-controls")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the position is resumed, and saved when leaving", async ({ page }) => {
  await mockStack(page, READY);
  await page.addInitScript((key) => {
    if (!sessionStorage.getItem("__resume")) {
      sessionStorage.setItem("__resume", "1");
      localStorage.setItem(key, JSON.stringify({ position: 5, duration: 10, ts: Date.now() }));
    }
  }, `videoPosition_${HASH}_${FILE}`);
  await page.goto(magnetUrl(FILE));
  await expect.poll(async () => (await stat(page)).t, { timeout: 15_000 }).toBeGreaterThan(4.9);
  expect((await stat(page)).t).toBeLessThan(8);
  await page.keyboard.press("Space"); // pause: position saved at once
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "{}"), `videoPosition_${HASH}_${FILE}`);
  expect(saved.position).toBeGreaterThan(4.9);
  expect(saved.duration).toBeGreaterThan(9);
});

test("HLS plays through hls.js while downloading, then swaps to the MP4 at the same position", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const mocks = await mockStack(page, { status: "downloading", progress: 0.4, hls_filename: "hls/master.m3u8", hls_subtitles: [], peers: 3 });
  await page.goto(magnetUrl(FILE));
  await expect(page.locator('[data-screen="player-screen"]')).toBeVisible();
  await playing(page, 2.5);
  let s = await stat(page);
  expect(s.src).toMatch(/^blob:/); // hls.js feeds the element through MediaSource
  expect(mocks.played.some((p) => /^seg\d+\.m4s$/.test(p))).toBe(true);
  await expect(page.locator(".player-badge")).toContainText("40%");
  // A live playlist has no known length yet: nothing is marked watched.
  expect(await page.evaluate(() => localStorage.getItem("completedFiles"))).toBeNull();

  s = await stat(page);
  mocks.info.current = { ...READY, hls_filename: "hls/master.m3u8" };
  await expect.poll(async () => (await stat(page)).src, { timeout: 10_000 }).toMatch(/sample\.mp4$/);
  await expect.poll(async () => (await stat(page)).ready, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  const after = await stat(page);
  expect(after.t).toBeGreaterThanOrEqual(s.t - 0.5);
  expect(after.t).toBeLessThan(s.t + 5);
  await expect(page.locator(".player-badge")).toHaveCount(0);
  await playing(page, s.t + 0.5);
  expect(errors).toEqual([]);
});

test("a stream that cannot be played drops back to the progress view", async ({ page }) => {
  test.setTimeout(60_000);
  const mocks = await mockStack(page, { status: "downloading", progress: 0.2, hls_filename: "hls/master.m3u8", hls_subtitles: [], can_stream: false });
  mocks.hlsManifestStatus.current = 500;
  await page.goto(magnetUrl(FILE));
  await expect(page.locator('[data-screen="player-screen"]')).toBeVisible();
  await expect(page.locator('[data-screen="player-screen"]')).toHaveCount(0, { timeout: 45_000 });
  await expect(page.locator('[data-screen="download-screen"]')).toBeVisible();
  await expect(page.locator(".dl-title")).toHaveText(FILE);
});

test("the next episode opens when the video ends, and the next button is offered", async ({ page }) => {
  const mocks = await mockStack(page, READY);
  mocks.nextFile.current = { next_filename: NEXT_FILE, next_magnet: null };
  await page.goto(magnetUrl(FILE));
  await playing(page, 0.5);
  await expect(page.getByRole("button", { name: "Next episode" })).toBeVisible();
  await page.locator(".player-scrub").evaluate((el: HTMLInputElement) => {
    el.value = "950";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(NEXT_FILE).replace(/\./g, "\\.")}$`), { timeout: 15_000 });
  await expect(page.locator('[data-screen="download-screen"]')).toBeVisible();
  // The finished episode counts as watched.
  expect(await page.evaluate(() => localStorage.getItem("completedFiles"))).toContain(FILE);
});

test("remote and media keys control playback, and the episode menu lists the pack", async ({ page }) => {
  await mockStack(page, READY);
  await page.goto(magnetUrl(FILE));
  await playing(page, 0.5);
  const key = (name: string) =>
    page.evaluate((k) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })), name);
  await key("MediaPause");
  await expect.poll(async () => (await stat(page)).paused).toBe(true);
  await key("MediaPlayPause");
  await expect.poll(async () => (await stat(page)).paused).toBe(false);
  await key("MediaPause");
  const before = (await stat(page)).t;
  await key("MediaFastForward");
  await expect.poll(async () => (await stat(page)).t).toBeGreaterThan(before + 3); // +30 s clamps near the end
  await page.getByRole("button", { name: "Episodes" }).click();
  const items = page.locator(".player-episode");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".player-episodes")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Episodes" })).toBeFocused();
});

test("the cast button explains that localhost cannot be cast to", async ({ page }) => {
  await mockStack(page, READY);
  await page.goto(magnetUrl(FILE));
  await playing(page, 0.5);
  const cast = page.getByRole("button", { name: "Cast to TV" });
  // Shown in desktop Chrome while the scripts load; it only goes away when they cannot load.
  await expect(cast).toBeVisible();
  await cast.click();
  await expect(page.locator(".cast-error")).toContainText("network address");
});

test("layout: desktop, phone and fullscreen screenshots", async ({ page }, info) => {
  const mocks = await mockStack(page, READY);
  mocks.nextFile.current = { next_filename: NEXT_FILE, next_magnet: null }; // the widest row: Next button too
  await page.goto(magnetUrl(FILE));
  await playing(page, 0.5);
  await page.getByRole("button", { name: "Audio and subtitles" }).click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  const shot = (name: string) => page.screenshot({ path: info.outputPath(`${name}.png`) });
  await shot("player-desktop");
  await page.keyboard.press("Escape"); // close the menu: the caption shows
  await page.setViewportSize({ width: 390, height: 780 });
  await page.mouse.move(100, 100);
  await shot("player-phone");
  // Nothing may overflow the phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const controlsRight = await page.locator(".player-row").evaluate((el) => Math.max(...Array.from(el.querySelectorAll("button")).map((b) => b.getBoundingClientRect().right)));
  expect(controlsRight).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Full screen" }).first().click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await shot("player-fullscreen");
  await page.getByRole("button", { name: "Full screen" }).first().click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
});
