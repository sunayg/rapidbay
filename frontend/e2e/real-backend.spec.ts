import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

// The REAL backend, no torrent. A finished download is just files on disk, so the
// spec writes them into the running container the way the daemon would:
//   FILELIST_DIR/<hash>            JSON list of the torrent's files   (-> file list)
//   OUTPUT_DIR/<hash>/<stem>.mp4   the converted file                 (-> status "ready")
//   OUTPUT_DIR/<hash>/<stem>.m3u8  the HLS media playlist + init/segments
//                                  (-> hls_filename, written into a master playlist by the backend)
// Everything the UI calls (file list, status, SSE, /play/, next_file, master playlist) is the real
// FastAPI app. Not covered: HLSStreamer/ffmpeg segmenting and libtorrent, which need a live torrent.
//
// Media are the small VP9/Opus fixtures (Playwright's Chromium has no H.264). Nothing on these
// paths transcodes, so the backend does not care about the codec.
//
// Skipped when the stack or its container is not reachable. Override the container with
// RAPIDBAY_CONTAINER (default: rapidbay-rapidbay-1).
const CONTAINER = process.env.RAPIDBAY_CONTAINER || "rapidbay-rapidbay-1";
const BASE = process.env.BASE_URL || "http://localhost:5050";
const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

const READY_HASH = "e2e0000000000000000000000000000000000001";
const HLS_HASH = "e2e0000000000000000000000000000000000002";
const HASHES = [READY_HASH, HLS_HASH];
const magnetFor = (hash: string, name: string) => `magnet:?xt=urn:btih:${hash.toUpperCase()}&dn=${name}`;
// No SxxEyy in the names: the last file of a pack would otherwise make next_file run a real indexer search.
const ONE = "RapidBay.E2E.Part.One.mkv";
const TWO = "RapidBay.E2E.Part.Two.mkv";
const stem = (file: string) => file.replace(/\.mkv$/, "");
const READY_MAGNET = magnetFor(READY_HASH, "RapidBay.E2E");
const HLS_MAGNET = magnetFor(HLS_HASH, "RapidBay.E2E.Hls");
const url = (magnet: string, file?: string) => `/magnet/${encodeURIComponent(encodeURIComponent(magnet))}/${file ? encodeURIComponent(file) : ""}`;

let reachable = false;
let outputDir = "";
let filelistDir = "";
let staging = "";

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
const inContainer = (...cmd: string[]) => docker("exec", CONTAINER, ...cmd);

async function probe(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok || !(await res.json()).ok) return false;
    docker("inspect", "--format", "{{.State.Running}}", CONTAINER);
    outputDir = inContainer("python3", "-c", "import sys;sys.path.insert(0,'/app');import settings;print(settings.OUTPUT_DIR)").replace(/\/$/, "");
    filelistDir = inContainer("python3", "-c", "import sys;sys.path.insert(0,'/app');import settings;print(settings.FILELIST_DIR)").replace(/\/$/, "");
    return true;
  } catch {
    return false;
  }
}

function cleanup(): void {
  for (const hash of HASHES) {
    try {
      inContainer("rm", "-rf", `${outputDir}/${hash}`, `${filelistDir}/${hash}`);
    } catch {
      // Container gone: nothing left to clean.
    }
  }
  if (staging) rmSync(staging, { recursive: true, force: true });
}

const put = (local: string, hash: string, name: string) => docker("cp", local, `${CONTAINER}:${outputDir}/${hash}/${name}`);

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  reachable = await probe();
  if (!reachable) return;
  cleanup();
  staging = mkdtempSync(join(tmpdir(), "rapidbay-e2e-"));
  for (const hash of HASHES) {
    inContainer("mkdir", "-p", `${outputDir}/${hash}`, filelistDir);
    inContainer("sh", "-c", `printf '%s' '["${ONE}","${TWO}"]' > ${filelistDir}/${hash}`);
  }
  // Pack 1: both files finished (what a completed download leaves behind).
  put(join(FIXTURES, "sample.mp4"), READY_HASH, `${stem(ONE)}.mp4`);
  put(join(FIXTURES, "sample.mp4"), READY_HASH, `${stem(TWO)}.mp4`);
  // Pack 2: file one has only an HLS playlist so far (a live stream); no mp4, no torrent.
  const live = readHlsPlaylist();
  const playlist = join(staging, `${stem(ONE)}.m3u8`);
  writeFileSync(playlist, live);
  put(playlist, HLS_HASH, `${stem(ONE)}.m3u8`);
  put(join(FIXTURES, "hls", "init.mp4"), HLS_HASH, "init.mp4");
  for (let i = 0; i < 5; i++) put(join(FIXTURES, "hls", `seg${i}.m4s`), HLS_HASH, `seg${i}.m4s`);
});

test.afterAll(() => {
  if (!reachable) return;
  cleanup();
});

function readHlsPlaylist(): string {
  // Still converting: no end marker, so the playlist looks live.
  return readFileSync(join(FIXTURES, "hls", "master.m3u8"), "utf8")
    .replace("#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-PLAYLIST-TYPE:EVENT")
    .replace("#EXT-X-ENDLIST", "");
}

test.beforeEach(async ({ page }) => {
  test.skip(!reachable, `RapidBay stack/container not reachable at ${BASE} (${CONTAINER})`);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("__seeded")) {
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem("__seeded", "1");
    }
  });
  // These two write to the user's real data (watch library) or would add the fake hash to the
  // torrent session; everything else is the real backend.
  await page.route("**/api/library/**", (route) => route.fulfill({ json: { titles: [] } }));
  await page.route("**/api/magnet_download/", (route) => route.fulfill({ json: {} }));
});

const stat = (page: Page) =>
  page.locator("video").evaluate((v: HTMLVideoElement) => ({ t: v.currentTime, paused: v.paused, duration: v.duration, src: v.currentSrc, width: v.videoWidth, ready: v.readyState }));

async function playing(page: Page, after: number): Promise<void> {
  await expect.poll(async () => (await stat(page)).t, { timeout: 15_000 }).toBeGreaterThan(after);
}

test("real file list: the daemon's file list and statuses render", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Straight against the API first, so a UI failure can be told from a backend one.
  const api = await (await request.get(`/api/magnet/${READY_HASH}/`)).json();
  expect(api.files).toEqual([ONE, TWO]);
  expect(api.file_statuses).toEqual({ [ONE]: "downloaded", [TWO]: "downloaded" });

  await page.goto(url(READY_MAGNET));
  const rows = page.locator(".file-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(ONE);
  await expect(rows.nth(0)).toContainText("Downloaded");
  await expect(rows.nth(1)).toContainText("Downloaded");
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-screen="player-screen"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test("real status + /play/: a finished file plays and seeks with no subtitles", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const status = await (await request.get(`/api/magnet/${READY_HASH}/${encodeURIComponent(ONE)}`)).json();
  expect(status).toMatchObject({ status: "ready", filename: `${stem(ONE)}.mp4`, subtitles: [], supported: true });

  await page.goto(url(READY_MAGNET, ONE));
  await expect(page.locator('[data-screen="player-screen"]')).toBeVisible();
  await playing(page, 1);
  let s = await stat(page);
  expect(s.src).toContain(`/play/${READY_HASH}/${stem(ONE)}.mp4`);
  expect(s.width).toBe(192); // frames were decoded from the backend's own bytes
  expect(s.duration).toBeGreaterThan(9);
  await expect(page.locator(".player-controls")).toBeVisible();
  await expect(page.locator(".caption-btn")).toHaveCount(0); // no subtitles offered

  // Range seek through FileResponse, by the bar and by the keyboard.
  await page.locator(".player-scrub").evaluate((el: HTMLInputElement) => {
    el.value = "700";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect.poll(async () => (await stat(page)).t).toBeGreaterThan(6.9);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await stat(page)).t).toBeLessThan(4);
  await page.keyboard.press("Space");
  await expect.poll(async () => (await stat(page)).paused).toBe(true);
  s = await stat(page);
  expect(s.ready).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});

test("real next_file: the player knows the following file of the pack", async ({ request }) => {
  const next = await (await request.get(`/api/next_file/${READY_HASH}/${encodeURIComponent(ONE)}`)).json();
  expect(next).toEqual({ next_filename: TWO, next_magnet: null });
});

test("real HLS: plays the backend's master playlist and stays on it when the MP4 appears", async ({ page, request }) => {
  test.setTimeout(60_000);
  const status = await (await request.get(`/api/magnet/${HLS_HASH}/${encodeURIComponent(ONE)}`)).json();
  expect(status.hls_filename, JSON.stringify(status)).toBeTruthy();
  // The backend wrapped our media playlist in a master playlist of its own.
  expect(status.hls_filename).toBe(`${stem(ONE)}_master.m3u8`);
  const master = await (await request.get(`/play/${HLS_HASH}/${status.hls_filename}`)).text();
  expect(master).toContain("#EXT-X-STREAM-INF");
  expect(master).toContain(`${stem(ONE)}.m3u8`);

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url(HLS_MAGNET, ONE));
  await expect(page.locator('[data-screen="player-screen"]')).toBeVisible();
  await playing(page, 1.5);
  let s = await stat(page);
  expect(s.src).toMatch(/^blob:/); // hls.js through MediaSource, from the real segments
  expect(s.width).toBe(192);

  // The conversion "finishes": the mp4 appears (atomically, as the converter's rename does).
  docker("cp", join(FIXTURES, "sample.mp4"), `${CONTAINER}:${outputDir}/${HLS_HASH}/.${stem(ONE)}.mp4.tmp`);
  s = await stat(page);
  inContainer("mv", `${outputDir}/${HLS_HASH}/.${stem(ONE)}.mp4.tmp`, `${outputDir}/${HLS_HASH}/${stem(ONE)}.mp4`);
  // The player is not handed over: it stays on the stream and keeps playing.
  await playing(page, s.t + 2);
  const after = await stat(page);
  expect(after.src).toMatch(/^blob:/);
  expect(after.t).toBeGreaterThan(s.t);
  expect(errors).toEqual([]);
});

test("the test data is gone from the container and nothing reached the torrent session", async ({ request }) => {
  const status = await (await request.get("/api/status")).json();
  for (const key of ["session_torrents", "torrent_downloads", "subtitle_downloads", "conversions", "hls_streams"]) {
    expect(JSON.stringify(status[key]), key).not.toContain("e2e00000");
  }
  cleanup();
  for (const hash of HASHES) {
    expect(inContainer("sh", "-c", `ls ${outputDir}/${hash} ${filelistDir}/${hash} 2>&1 | grep -c 'No such'`)).toBe("2");
  }
});
