import { expect, test } from "@playwright/test";

// Runs against the Docker stack: http://localhost:5050/
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

test("home shows rows, shortcuts and takes remote-style keyboard focus", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const homeResponse = page.waitForResponse((r) => r.url().includes("/api/home/"));
  await page.goto("/");
  const home = (await (await homeResponse).json()) as { series?: unknown[]; movies?: unknown[] };

  await expect(page.locator('[data-screen="search-screen"]')).toBeVisible();
  await expect(page.locator("input.form-control")).toBeFocused();
  await expect(page.locator(".home-shortcut")).toHaveText(["History", "Latest releases", "Favorites", "Settings"]);

  if ((home.series ?? []).length) {
    await expect(page.getByRole("heading", { name: "Trending series this week" })).toBeVisible();
    await expect(page.locator(".poster-card").first()).toBeVisible();
    // Down from the search box lands on the first row.
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".poster-card").first()).toBeFocused();
    await page.keyboard.press("ArrowUp");
    // The header buttons sit beside the search box: right from the empty box reaches them.
    await page.locator("input.form-control").focus();
    const activeClass = () => page.evaluate(() => document.activeElement?.className ?? "");
    await page.keyboard.press("ArrowRight");
    expect(await activeClass()).toContain("home-shortcut");
    const before = await page.evaluate(() => document.activeElement?.textContent);
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => document.activeElement?.textContent)).not.toBe(before);
    expect(await activeClass()).toContain("home-shortcut");
  } else {
    await expect(page.locator(".home-empty")).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("searching navigates to /search/:term and remembers the term", async ({ page }) => {
  await page.goto("/");
  await page.locator("input.form-control").fill("big buck bunny");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/search\/big%20buck%20bunny$/);
  await expect(page.locator('[data-screen="search-results-screen"]')).toBeVisible();
  await page.goBack();
  await expect(page.locator(".search-chip")).toHaveText(["big buck bunny"]);
  await page.locator(".search-chip").click();
  await expect(page).toHaveURL(/\/search\/big%20buck%20bunny$/);
  await page.goBack();
  await page.getByRole("button", { name: "Clear search history" }).click();
  await expect(page.locator(".search-chip")).toHaveCount(0);
});

test("the Settings shortcut opens settings", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});
