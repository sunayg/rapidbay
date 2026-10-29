import { expect, test } from "@playwright/test";

// Runs against the Docker stack: http://localhost:5050/next/
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

test("home shows rows, shortcuts and takes remote-style keyboard focus", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const homeResponse = page.waitForResponse((r) => r.url().includes("/api/home/"));
  await page.goto("/next/");
  const home = (await (await homeResponse).json()) as { series?: unknown[]; movies?: unknown[] };

  await expect(page.locator('[data-screen="search-screen"]')).toBeVisible();
  await expect(page.locator("input.form-control")).toBeFocused();
  await expect(page.locator(".home-shortcut")).toHaveText(["History", "Community Searches", "Favorites", "Settings"]);

  if ((home.series ?? []).length) {
    await expect(page.getByRole("heading", { name: "Top 10 series trending" })).toBeVisible();
    await expect(page.locator(".poster-card").first()).toBeVisible();
    // Down from the search box lands on the first row, then walks down to the shortcuts.
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".poster-card").first()).toBeFocused();
    const activeClass = () => page.evaluate(() => document.activeElement?.className ?? "");
    for (let i = 0; i < 8 && !(await activeClass()).includes("home-shortcut"); i++) await page.keyboard.press("ArrowDown");
    expect(await activeClass()).toContain("home-shortcut");
    const before = await page.evaluate(() => document.activeElement?.textContent);
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => document.activeElement?.textContent)).not.toBe(before);
    expect(await activeClass()).toContain("home-shortcut");
    await page.keyboard.press("ArrowUp");
    expect(await activeClass()).toContain("poster-card");
  } else {
    await expect(page.locator(".home-empty")).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("searching navigates to /next/search/:term and remembers the term", async ({ page }) => {
  await page.goto("/next/");
  await page.locator("input.form-control").fill("big buck bunny");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/next\/search\/big%20buck%20bunny$/);
  await expect(page.locator('[data-screen="search-results-screen"]')).toBeVisible();
  await page.goBack();
  await expect(page.locator(".search-chip")).toHaveText(["big buck bunny"]);
  await page.locator(".search-chip").click();
  await expect(page).toHaveURL(/\/next\/search\/big%20buck%20bunny$/);
  await page.goBack();
  await page.getByRole("button", { name: "Clear search history" }).click();
  await expect(page.locator(".search-chip")).toHaveCount(0);
});

test("the Settings shortcut opens settings", async ({ page }) => {
  await page.goto("/next/");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/next\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});
