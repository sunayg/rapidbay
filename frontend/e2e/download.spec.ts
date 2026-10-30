import { expect, test, type Page } from "@playwright/test";

// Runs against the Docker stack: http://localhost:5050/
// Every API call is mocked with page.route; no real torrent is ever started.
const MAGNET = "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Some.Show";
const HASH = "abcdef0123456789abcdef0123456789abcdef01";
const magnetUrl = (file?: string) => `/magnet/${encodeURIComponent(encodeURIComponent(MAGNET))}/${file ? encodeURIComponent(file) : ""}`;
const FILES = ["Some.Show.S01E01.1080p.mkv", "Some.Show.S01E02.1080p.mkv", "Some.Show.S01E03.1080p.mkv"];

const sse = (events: unknown[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("__seeded")) {
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem("__seeded", "1");
    }
  });
  // Anything not mocked below must not reach a real backend for downloads.
  await page.route("**/api/magnet_download/", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/magnet_files/", (route) => route.fulfill({ json: {} }));
});

async function mockFiles(page: Page, files: string[], statuses: Record<string, string> = {}) {
  await page.route(`**/api/magnet_events/${HASH}/`, (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: sse([{ files, file_statuses: statuses, done: true }]) }),
  );
}

// Progress comes from polling: the event stream is refused, as the legacy app copes with.
async function mockDownload(page: Page, file: string, state: { current: Record<string, unknown> }) {
  await page.route(`**/api/magnet_events/${HASH}/${encodeURIComponent(file)}`, (route) => route.abort());
  await page.route(`**/api/magnet/${HASH}/${encodeURIComponent(file)}`, (route) => route.fulfill({ json: state.current }));
}

test("file list renders, takes keyboard focus and opens a file", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mockFiles(page, FILES, { [FILES[1]]: "downloaded" });
  await page.goto(magnetUrl());
  const rows = page.locator(".file-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toBeFocused();
  await expect(rows.nth(1)).toContainText("Downloaded");
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(FILES[1]).replace(/\./g, "\\.")}$`));
  await expect(page.locator('[data-screen="download-screen"]')).toBeVisible();
  await page.keyboard.press("Backspace");
  await expect(page.locator('[data-screen="filelist-screen"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test("a remembered episode opens its file directly, and Back skips the list", async ({ page }) => {
  await mockFiles(page, FILES);
  await page.route(`**/api/magnet/${HASH}/${encodeURIComponent(FILES[2])}`, (route) => route.fulfill({ json: { status: "queued" } }));
  await page.route(`**/api/magnet_events/${HASH}/${encodeURIComponent(FILES[2])}`, (route) => route.abort());
  await page.goto("/search/nothing");
  await page.evaluate(() => sessionStorage.setItem("rapidbayEpisodeTarget", JSON.stringify({ season: 1, episode: 3 })));
  await page.goto(magnetUrl());
  await expect(page.locator('[data-screen="download-screen"]')).toBeVisible();
  await expect(page.locator(".dl-title")).toHaveText(FILES[2]);
  expect(await page.evaluate(() => sessionStorage.getItem("rapidbayEpisodeTarget"))).toBeNull();
  // The list replaced itself, so one Back returns to where the search was.
  await page.goBack();
  await expect(page).toHaveURL(/\/search\/nothing$/);
});

test("a single file opens without showing the list", async ({ page }) => {
  await mockFiles(page, ["Only.Movie.mkv"]);
  await page.route(`**/api/magnet/${HASH}/**`, (route) => route.fulfill({ json: { status: "queued" } }));
  await page.goto(magnetUrl());
  await expect(page.locator('[data-screen="download-screen"]')).toBeVisible();
  await expect(page.locator(".dl-title")).toHaveText("Only.Movie.mkv");
});

test("torrent link converts to a magnet and lands on the file list", async ({ page }) => {
  await page.route("**/api/torrent_url_to_magnet/", (route) => route.fulfill({ json: { magnet_link: MAGNET } }));
  await mockFiles(page, FILES);
  await page.goto("/torrent/" + encodeURIComponent("http://example.test/a.torrent") + "/");
  await expect(page.locator('[data-screen="filelist-screen"]')).toBeVisible();
  await expect(page.locator(".file-row")).toHaveCount(3);
  expect(new URL(page.url()).pathname).toBe(magnetUrl().replace(/\/$/, ""));
});

test("download shows progress, starts playback by itself when streamable, and cancel goes back", async ({ page }) => {
  const file = FILES[0];
  const state = { current: { status: "downloading", progress: 0.2, peers: 5, download_rate: 2_000_000 } as Record<string, unknown> };
  await mockFiles(page, FILES);
  await mockDownload(page, file, state);
  let sessionPosts = 0;
  await page.route(`**/api/magnet/${HASH}/${encodeURIComponent(file)}/session*`, (route) => {
    sessionPosts++;
    return route.fulfill({ json: { url: null, reason: "unsupported_format" } });
  });
  let cancelBody: string | null = null;
  await page.route(`**/api/magnet/${HASH}/${encodeURIComponent(file)}/cancel`, (route) => {
    cancelBody = route.request().method();
    return route.fulfill({ json: { magnet_hash: HASH } });
  });

  await page.goto(magnetUrl());
  await page.locator(".file-row").first().click();
  await expect(page.locator('[data-screen="download-screen"]')).toBeVisible();
  await expect(page.locator(".spinner-heading")).toHaveText("downloading (20%)");
  await expect(page.locator(".spinner-sub")).toHaveText("5 Peers · 2.00 MB/s");
  expect(sessionPosts).toBe(0); // not enough of the file yet

  state.current = { status: "downloading", progress: 0.6, peers: 8, can_stream: true };
  await expect(page.locator(".spinner-heading")).toHaveText("downloading (60%)", { timeout: 5000 });
  // No button to press: it asks for a session itself, and says why when it cannot play yet.
  await expect.poll(() => sessionPosts).toBe(1);
  await expect(page.locator(".stream-message")).toContainText("once it has finished");

  await page.locator(".cancel-download").click();
  await expect.poll(() => cancelBody).toBe("POST");
  await expect(page.locator('[data-screen="filelist-screen"]')).toBeVisible();
});

test("a ready file hands over to the player with the MP4 link", async ({ page }) => {
  const file = FILES[0];
  const state = { current: { status: "ready", progress: 1, filename: "Some.Show.S01E01.mp4", supported: true, playback: "direct" } as Record<string, unknown> };
  await mockDownload(page, file, state);
  await page.goto(magnetUrl(file));
  await expect(page.locator('[data-screen="player-screen"]')).toBeVisible();
  await expect(page.locator("video")).toHaveAttribute("src", new RegExp(`/play/${HASH}/Some\\.Show\\.S01E01\\.mp4$`));
});

test("errors are shown with a retry", async ({ page }) => {
  let ok = false;
  await page.route("**/api/magnet_files/", (route) => (ok ? route.fulfill({ json: {} }) : route.fulfill({ status: 500, json: {} })));
  await mockFiles(page, FILES);
  await page.goto(magnetUrl());
  await expect(page.getByRole("alert")).toContainText("Couldn't load the file list");
  ok = true;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".file-row")).toHaveCount(3);
});

// Screenshots for review: SHOTS=/some/dir npm run e2e -- download.spec.ts
test("screenshots", async ({ page }) => {
  test.skip(!process.env.SHOTS, "set SHOTS to a directory");
  const dir = process.env.SHOTS as string;
  await mockFiles(page, FILES, { [FILES[1]]: "downloaded", [FILES[2]]: "downloading" });
  const state = { current: { status: "downloading", progress: 0.42, peers: 12, download_rate: 3_400_000 } as Record<string, unknown> };
  await mockDownload(page, FILES[0], state);
  for (const [name, size] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 780 }]] as const) {
    await page.setViewportSize(size);
    await page.goto(magnetUrl());
    await expect(page.locator(".file-row")).toHaveCount(3);
    await page.screenshot({ path: `${dir}/filelist-${name}.png` });
    await page.goto(magnetUrl(FILES[0]));
    await expect(page.locator(".cancel-download")).toBeVisible();
    await page.screenshot({ path: `${dir}/download-${name}.png` });
  }
});
