import { expect, test, type Page } from "@playwright/test";

// Runs against the Docker stack: http://localhost:5050/
// Streams are mocked with page.route (deterministic); the last test searches for real.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("__seeded")) {
      localStorage.clear();
      sessionStorage.setItem("__seeded", "1");
    }
  });
});

const MAGNET = "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=";
const magnetFor = (name: string) => MAGNET + encodeURIComponent(name);
const item = (title: string, seeds: number, extra: Record<string, unknown> = {}) => ({ title, seeds, size: 3 * 1024 ** 3, magnet: magnetFor(title), ...extra });

const POSTER = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#456"/></svg>');
const BACKDROP = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300"><rect width="800" height="300" fill="#345"/></svg>');

const dune = {
  tmdb_id: 438631,
  media_type: "movie",
  title: "Dune",
  year: 2021,
  overview: "Paul Atreides, a brilliant and gifted young man born into a great destiny, must travel to the most dangerous planet.",
  poster_url: POSTER,
  backdrop_url: BACKDROP,
  genres: ["Science Fiction", "Adventure"],
  vote_average: 7.8,
  runtime: 155,
  seasons: [],
  results: [item("Dune.2021.2160p.UHD.BluRay", 80), item("Dune.2021.1080p.BluRay.x264", 120), item("Dune.2021.720p.WEB", 15)],
};
const severance = {
  tmdb_id: 95396,
  media_type: "tv",
  title: "Severance",
  year: 2022,
  overview: "Mark leads a team of office workers whose memories have been surgically divided.",
  poster_url: POSTER,
  backdrop_url: BACKDROP,
  genres: ["Drama"],
  vote_average: 8.4,
  latest_episode: { season_number: 2, episode_number: 2, name: "Goodbye, Mrs. Selvig", air_date: "2025-01-24", runtime: 50, vote_average: 8.4, overview: "Mark returns." },
  seasons: [
    { season: 1, episodes: [item("Severance.S01E01.1080p.WEB", 40), item("Severance.S01E01.720p.WEB", 10), item("Severance.S01E02.1080p.WEB", 30)] },
    { season: 2, episodes: [item("Severance.S02E02.1080p.WEB", 20)] },
  ],
  results: [],
};

function sse(events: unknown[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

async function mockRich(page: Page, payloads: unknown[]) {
  await page.route("**/api/rich_search_events/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(payloads) }),
  );
}

async function mockSeason(page: Page) {
  await page.route("**/api/tv/95396/season/**", (route) => {
    const season = route.request().url().includes("/season/1/");
    return route.fulfill({
      json: {
        episodes: season
          ? [
              { episode_number: 1, name: "Good News About Hell", air_date: "2022-02-18", runtime: 55, vote_average: 8.1 },
              { episode_number: 2, name: "Half Loop", air_date: "2022-02-18" },
            ]
          : [{ episode_number: 2, name: "Goodbye, Mrs. Selvig", air_date: "2025-01-24" }],
      },
    });
  });
}

test("streamed results render, a movie opens and focus walks with the arrow keys", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mockRich(page, [
    { groups: [dune, { ...dune, tmdb_id: 2, title: "Dune: Part Two", year: 2024, results: [item("Dune.Part.Two.2024.1080p", 90)] }], other: [], done: false },
    { groups: [dune, { ...dune, tmdb_id: 2, title: "Dune: Part Two", year: 2024, results: [item("Dune.Part.Two.2024.1080p", 90)] }], other: [item("Dune documentary", 3)], done: true },
  ]);
  await page.goto("/search/dune");
  await expect(page.locator('[data-screen="search-results-screen"]')).toBeVisible();
  await expect(page.locator(".group-card")).toHaveCount(2);
  await expect(page.locator(".rich-search-pending")).toHaveCount(0);
  // The first card takes the focus; Enter opens it and moves the focus to a release.
  await expect(page.locator(".group-card").first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".group-card").first().locator(".result-row")).toHaveCount(3);
  await expect(page.locator(".group-card").first().locator(".result-row").first()).toBeFocused();
  await expect(page.locator(".group-card").first().locator(".result-heading")).toHaveText(["2160p (1)", "1080p (1)", "720p (1)"]);
  // Down walks through the releases, then on to the next card.
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".group-card").first().locator(".result-row").nth(1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".group-card").nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".group-card").first().locator(".result-row").last()).toBeFocused();
  // Selecting a release opens its file list.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/magnet\/.+/);
  expect(errors).toEqual([]);
  // Backspace returns to the results.
  await page.keyboard.press("Backspace");
  await expect(page).toHaveURL(/\/search\/dune$/);
});

test("a TV show: pick a season, an episode and a release, and the choice reaches the file list", async ({ page }) => {
  await mockRich(page, [{ groups: [severance], other: [], done: true }]);
  await mockSeason(page);
  await page.goto("/search/severance");
  // A lone group opens by itself.
  await expect(page.locator(".season-toggle")).toHaveCount(2);
  await page.getByRole("button", { name: /Season 1/ }).click();
  await expect(page.locator(".season-block").first().locator(".episode-card")).toHaveCount(2);
  await page.locator(".season-block").first().locator(".episode-card").first().click();
  const releases = page.locator(".season-block").first().locator(".result-row");
  await expect(releases).toHaveText([/1080p WEB/, /720p WEB/]);
  await releases.first().click();
  await expect(page).toHaveURL(/\/magnet\//);
  expect(await page.evaluate(() => sessionStorage.getItem("rapidbayEpisodeTarget"))).toBe(JSON.stringify({ season: 1, episode: 1 }));
});

test("the search box searches and saves the term to the history", async ({ page }) => {
  await mockRich(page, [{ groups: [], other: [item("Something", 5)], done: true }]);
  await page.goto("/search/first");
  await page.locator("input.form-control").fill("second term");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/search\/second%20term$/);
  await expect(page.locator(".result-row")).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem("searchHistory"))).toBe(JSON.stringify(["second term"]));
});

test("history and favorites views list what was saved", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("__saved")) {
      sessionStorage.setItem("__saved", "1");
      localStorage.setItem("downloadHistory", JSON.stringify([{ magnet: "magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&dn=Old", title: "Old download", ts: 1 }]));
      localStorage.setItem("favorites", JSON.stringify([{ magnet: "magnet:?xt=urn:btih:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB&dn=Fav", filename: "fav.mkv", title: "fav.mkv", ts: 1 }]));
    }
  });
  await page.goto("/search/%5Bhistory%5D");
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await expect(page.locator(".result-label")).toHaveText(["Old download"]);
  await page.goto("/search/%5Bfavorites%5D");
  await expect(page.getByRole("heading", { name: "Favorites" })).toBeVisible();
  await page.locator(".result-row").click();
  await expect(page).toHaveURL(/\/magnet\/.+\/fav\.mkv$/);
});

test("an empty result set is explained", async ({ page }) => {
  await mockRich(page, [{ groups: [], other: [], done: true }]);
  await page.route("**/api/search_events/**", (route) => route.fulfill({ status: 200, contentType: "text/event-stream", body: sse([{ results: null, done: true }]) }));
  await page.goto("/search/nothingatall");
  await expect(page.locator(".empty-state")).toHaveText("No results for “nothingatall”.");
});

test("a real search settles (tolerant: results or an empty message, never a stuck spinner)", async ({ page }) => {
  await page.goto("/search/big%20buck%20bunny");
  await expect(page.locator(".results-body .spinner")).toHaveCount(0, { timeout: 25_000 });
  const rows = await page.locator(".result-row, .group-card").count();
  if (!rows) await expect(page.locator(".empty-state, .results-error")).toBeVisible();
});
