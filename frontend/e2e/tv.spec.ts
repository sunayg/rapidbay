import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

// Runs in the tv-1080 and tv-540-2x projects (playwright.config.ts): an Android TV user agent, so the
// app is in its tv-ui mode, and only remote keys are pressed: arrows, Enter/Select, Backspace/Escape
// (Back) and media keys. The search, file list and status APIs are mocked; the video is a real file.
const MAGNET = "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Dune.2021.1080p.BluRay.x264";
const HASH = "abcdef0123456789abcdef0123456789abcdef01";
const FILES = ["Dune.2021.1080p.BluRay.x264.mkv", "Dune.2021.Extras.mkv"];
const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));
const POSTER = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#456"/></svg>');
const item = (title: string, seeds: number) => ({ title, seeds, size: 3 * 1024 ** 3, magnet: `magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=${encodeURIComponent(title)}` });
const dune = {
  tmdb_id: 438631,
  media_type: "movie",
  title: "Dune",
  year: 2021,
  overview: "A noble family accepts stewardship of a desert planet.",
  poster_url: POSTER,
  backdrop_url: POSTER,
  genres: ["Science Fiction"],
  vote_average: 7.8,
  runtime: 155,
  seasons: [],
  results: [item("Dune.2021.1080p.BluRay.x264", 120), item("Dune.2021.720p.WEB", 15)],
};
const sse = (events: unknown[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");

async function mockStack(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("__seeded")) {
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem("__seeded", "1");
    }
  });
  await page.route("**/api/home/**", (route) => route.fulfill({ json: { series: [], movies: [] } }));
  await page.route("**/api/library/**", (route) => route.fulfill({ json: { titles: [] } }));
  await page.route("**/api/rich_search_events/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: sse([{ groups: [dune], other: [], done: true }]) }),
  );
  await page.route("**/api/magnet_files/", (route) => route.fulfill({ json: { magnet_hash: HASH } }));
  await page.route("**/api/magnet_download/", (route) => route.fulfill({ json: {} }));
  // Later routes win: the generic abort (polling fallback) goes first.
  await page.route(`**/api/magnet_events/${HASH}/**`, (route) => route.abort());
  await page.route(`**/api/magnet_events/${HASH}/`, (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: sse([{ files: FILES, file_statuses: {}, done: true }]) }),
  );
  await page.route(`**/api/magnet/${HASH}/${encodeURIComponent(FILES[0])}`, (route) =>
    route.fulfill({ json: { status: "ready", progress: 1, filename: "sample.mp4", supported: true, subtitles: [] } }),
  );
  await page.route("**/api/next_file/**", (route) => route.fulfill({ json: { next_filename: null, next_magnet: null } }));
  await page.route("**/play/**", async (route: Route) => {
    const body = readFileSync(join(FIXTURES, "sample.mp4"));
    const range = route.request().headers()["range"];
    const match = range && /bytes=(\d+)-(\d*)/.exec(range);
    if (!match) return route.fulfill({ status: 200, headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes" }, body });
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
    return route.fulfill({
      status: 206,
      headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${body.length}` },
      body: body.subarray(start, end + 1),
    });
  });
}

const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el && el !== document.body ? `${el.tagName.toLowerCase()}.${el.className}`.replace(/\s+/g, ".") : "body";
  });
const press = async (page: Page, ...keys: string[]) => {
  for (const key of keys) await page.keyboard.press(key);
};
// Chromium's keyboard has no media keys: a remote's arrive as plain keydown events.
const media = (page: Page, key: string) =>
  page.evaluate((k) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })), key);
const currentTime = (page: Page) => page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime);
const isPaused = (page: Page) => page.locator("video").evaluate((v: HTMLVideoElement) => v.paused);

// Every focused element must be on screen: a focus the viewer cannot see is a trap.
async function expectFocusVisibleOnScreen(page: Page): Promise<void> {
  const box = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, bottom: r.bottom, right: r.right, w: innerWidth, h: innerHeight };
  });
  expect(box, "something should have the focus").not.toBeNull();
  expect(box!.bottom).toBeGreaterThan(0);
  expect(box!.top).toBeLessThan(box!.h);
  expect(box!.right).toBeGreaterThan(0);
  expect(box!.left).toBeLessThan(box!.w);
}

test("the TV user agent switches the app to tv-ui", async ({ page }) => {
  await mockStack(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/tv-ui/);
  // A TV remote has no pointer: the search box is not auto-focused (it would open the on-screen keyboard).
  await expect(page.locator("input.form-control")).not.toBeFocused();
});

test("home -> search -> file list -> player with only remote keys", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mockStack(page);
  await page.goto("/");
  await expect(page.locator('[data-screen="search-screen"]')).toBeVisible();

  // Home: the first D-pad press lands on the search box; Enter on it and typing reaches the field.
  await press(page, "ArrowDown");
  await expect(page.locator("input.form-control")).toBeFocused();
  await page.keyboard.type("dune");
  await press(page, "Enter");
  await expect(page).toHaveURL(/\/search\/dune$/);

  // Results: a lone title opens by itself and the focus is on its first release.
  const rows = page.locator(".group-card").first().locator(".result-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toBeFocused();
  await expectFocusVisibleOnScreen(page);
  await press(page, "ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  await press(page, "ArrowUp", "Enter");
  await expect(page).toHaveURL(/\/magnet\//);

  // File list: Down/Up move between files, Back returns to the results with the card still there.
  const fileRows = page.locator(".file-row");
  await expect(fileRows).toHaveCount(2);
  await expect(fileRows.first()).toBeFocused();
  await press(page, "ArrowDown");
  await expect(fileRows.nth(1)).toBeFocused();
  await expectFocusVisibleOnScreen(page);
  await press(page, "ArrowDown"); // the end of the list: the focus must stay on a file
  await expect(fileRows.nth(1)).toBeFocused();
  await press(page, "Backspace");
  await expect(page).toHaveURL(/\/search\/dune$/);
  await expect(page.locator(".group-card").first()).toBeVisible();
  await expect(rows.first()).toBeFocused();
  await press(page, "Enter");
  await expect(fileRows.first()).toBeFocused();
  await press(page, "Enter");

  // Player: it starts by itself; media keys and arrows drive it, Back leaves.
  await expect(page.locator('[data-screen="player-screen"]')).toBeVisible();
  await expect.poll(() => currentTime(page), { timeout: 15_000 }).toBeGreaterThan(0.5);
  await media(page, "MediaPause");
  await expect.poll(() => isPaused(page)).toBe(true);
  await media(page, "MediaPlayPause");
  await expect.poll(() => isPaused(page)).toBe(false);
  const before = await currentTime(page);
  await media(page, "MediaFastForward");
  await expect.poll(() => currentTime(page)).toBeGreaterThan(before + 5);
  // (MediaRewind on a plain MP4 deliberately opens the raw file, as in the legacy app: not pressed here.)
  // Controls are reachable with the D-pad and Select activates the focused control.
  // (The first Down may land on the video itself; a control is at most a few presses away.)
  for (let i = 0; i < 4 && !(await focused(page)).startsWith("button"); i++) await press(page, "ArrowDown");
  expect(await focused(page)).toMatch(/^button/);
  await expectFocusVisibleOnScreen(page);
  const seen = new Set<string>();
  for (let i = 0; i < 14; i++) {
    seen.add(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? ""));
    await expectFocusVisibleOnScreen(page);
    await press(page, i < 3 ? "ArrowRight" : "ArrowLeft");
  }
  // The D-pad walks right to the end of the control row and all the way back to the first control.
  expect([...seen]).toEqual(expect.arrayContaining(["Play", "Back 10 seconds", "Forward 10 seconds", "Mute", "Volume", "Episodes", "Full screen"]));
  await press(page, "Enter"); // Select presses the focused control without leaving the player
  await expect(page.locator('[data-screen="player-screen"]')).toBeVisible();
  // Back leaves the player for the file list, and Back again for the results.
  await press(page, "Escape");
  await expect(page).toHaveURL(/\/magnet\/[^/]+\/?$/);
  await press(page, "Backspace");
  await expect(page).toHaveURL(/\/search\/dune$/);
  await press(page, "Backspace");
  await expect(page).toHaveURL(/\/$/);
  expect(errors).toEqual([]);
});

test("the settings screen can be reached and left with the remote", async ({ page }) => {
  await mockStack(page);
  await page.goto("/");
  await page.locator(".home-shortcut", { hasText: "Settings" }).waitFor();
  await press(page, "ArrowDown");
  for (let i = 0; i < 10 && !(await focused(page)).includes("home-shortcut"); i++) await press(page, "ArrowUp");
  for (let i = 0; i < 5; i++) {
    if ((await page.evaluate(() => document.activeElement?.textContent ?? "")).trim() === "Settings") break;
    await press(page, "ArrowRight");
  }
  await press(page, "Enter");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await press(page, "ArrowDown");
  await expectFocusVisibleOnScreen(page);
});

test("the home rows are walked with the D-pad: nothing loses the focus or leaves the screen", async ({ page }) => {
  await mockStack(page);
  const titles = (kind: string) =>
    Array.from({ length: 10 }, (_, i) => ({ tmdb_id: i + 1, media_type: kind, title: `${kind} ${i + 1}`, year: 2020, poster_url: POSTER, backdrop_url: POSTER, rank: i + 1 }));
  await page.route("**/api/home/**", (route) => route.fulfill({ json: { series: titles("tv"), movies: titles("movie") } }));
  await page.addInitScript(() => localStorage.setItem("searchHistory", JSON.stringify(["dune", "severance"])));
  await page.goto("/");
  await expect(page.locator(".billboard-card, .poster-card").first()).toBeVisible();

  const visited: string[] = [];
  const remember = async () => {
    const f = await focused(page);
    expect(f, "the focus must not be lost").not.toBe("body");
    await expectFocusVisibleOnScreen(page);
    visited.push(f.split(".")[1] ?? f);
  };
  await press(page, "ArrowDown");
  await remember(); // the search box
  for (let i = 0; i < 12; i++) {
    await press(page, "ArrowDown");
    await remember();
  }
  // Along a row to the right and back; the row scrolls to keep the focused card in view.
  for (let i = 0; i < 6; i++) {
    await press(page, "ArrowRight");
    await remember();
  }
  for (let i = 0; i < 6; i++) {
    await press(page, "ArrowLeft");
    await remember();
  }
  expect(new Set(visited).size).toBeGreaterThan(2); // rows, shortcuts and more than one kind of target
  // Back up to the search box.
  for (let i = 0; i < 14 && !(await focused(page)).startsWith("input"); i++) await press(page, "ArrowUp");
  expect(await focused(page)).toMatch(/^input/);
});

test("a download in progress can be streamed, left and cancelled with the remote", async ({ page }) => {
  await mockStack(page);
  await page.route(`**/api/magnet/${HASH}/${encodeURIComponent(FILES[0])}`, (route) =>
    route.fulfill({ json: { status: "downloading", progress: 0.3, peers: 4, can_stream: true } }),
  );
  let cancelled = false;
  await page.route(`**/api/magnet/${HASH}/${encodeURIComponent(FILES[0])}/cancel`, (route) => {
    cancelled = true;
    return route.fulfill({ json: { magnet_hash: HASH } });
  });
  await page.goto(`/magnet/${encodeURIComponent(encodeURIComponent(MAGNET))}/${encodeURIComponent(FILES[0])}`);
  await expect(page.locator('[data-screen="download-screen"]')).toBeVisible();
  await expect(page.locator(".cancel-download")).toBeVisible();
  const seen = new Set<string>();
  for (let i = 0; i < 8; i++) {
    await press(page, "ArrowDown");
    const f = await focused(page);
    expect(f, "the focus must not be lost").not.toBe("body");
    await expectFocusVisibleOnScreen(page);
    seen.add(f);
    if (f.includes("cancel-download")) break;
  }
  expect([...seen].some((f) => f.includes("cancel-download")), "Cancel is reachable: " + [...seen].join(" | ")).toBe(true);
  // Back out of the bottom button to the top bar and in again.
  await press(page, "ArrowUp");
  await expectFocusVisibleOnScreen(page);
  for (let i = 0; i < 6 && !(await focused(page)).includes("cancel-download"); i++) await press(page, "ArrowDown");
  await press(page, "Enter");
  await expect.poll(() => cancelled).toBe(true);
  await expect(page).not.toHaveURL(/\.mkv$/);
});
