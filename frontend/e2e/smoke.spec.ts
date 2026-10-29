import { expect, test } from "@playwright/test";

test("/next/ loads the app shell", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await page.goto("/next/");
  expect(response?.status()).toBe(200);
  await expect(page.locator('[data-screen="search-screen"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test("/next/ deep links load the matching screen", async ({ page }) => {
  await page.goto("/next/search/dune");
  await expect(page.locator('[data-screen="search-results-screen"]')).toBeVisible();
});

test("/settings loads and lists categories", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.locator(".categories button").first()).toBeVisible();
  expect(await page.locator(".categories button").count()).toBeGreaterThan(1);
});
