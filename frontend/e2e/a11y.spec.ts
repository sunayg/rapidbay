import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

// Accessibility and layout checks, asserted in the browser on every screen (API mocked, media real):
//  - nothing scrolls sideways at 320 px
//  - every control has an accessible name
//  - every control shows a visible change when it takes keyboard focus
//  - text contrast is at least WCAG AA (4.5:1, 3:1 for large text), measured from computed colours
//  - prefers-reduced-motion stops transitions and animations
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
const titles = (kind: string) =>
  Array.from({ length: 6 }, (_, i) => ({ tmdb_id: i + 1, media_type: kind, title: `A fairly long ${kind} title number ${i + 1}`, year: 2020, poster_url: POSTER, backdrop_url: POSTER, rank: i + 1 }));
const sse = (events: unknown[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
const magnetUrl = (file?: string) => `/next/magnet/${encodeURIComponent(encodeURIComponent(MAGNET))}/${file ? encodeURIComponent(file) : ""}`;

type Info = Record<string, unknown>;
async function mock(page: Page, info: Info): Promise<{ current: Info }> {
  const holder = { current: info };
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("__seeded")) {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("searchHistory", JSON.stringify(["dune", "severance"]));
      sessionStorage.setItem("__seeded", "1");
    }
  });
  await page.route("**/api/home/**", (route) => route.fulfill({ json: { series: titles("tv"), movies: titles("movie") } }));
  await page.route("**/api/library/**", (route) => route.fulfill({ json: { titles: [] } }));
  await page.route("**/api/rich_search_events/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: sse([{ groups: [dune], other: [item("Dune documentary", 3)], done: true }]) }),
  );
  await page.route("**/api/magnet_download/", (route) => route.fulfill({ json: {} }));
  await page.route(`**/api/magnet_events/${HASH}/**`, (route) => route.abort());
  await page.route(`**/api/magnet_events/${HASH}/`, (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: sse([{ files: FILES, file_statuses: { [FILES[1]]: "downloaded" }, done: true }]) }),
  );
  await page.route(`**/api/magnet/${HASH}/${encodeURIComponent(FILES[0])}`, (route) => route.fulfill({ json: holder.current }));
  await page.route("**/api/next_file/**", (route) => route.fulfill({ json: { next_filename: FILES[1], next_magnet: null } }));
  await page.route("**/play/**", (route) => {
    const body = readFileSync(join(FIXTURES, "sample.mp4"));
    const range = route.request().headers()["range"];
    const match = range && /bytes=(\d+)-(\d*)/.exec(range);
    if (!match) return route.fulfill({ status: 200, headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes" }, body });
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
    return route.fulfill({ status: 206, headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${body.length}` }, body: body.subarray(start, end + 1) });
  });
  return holder;
}

const READY = { status: "ready", progress: 1, filename: "sample.mp4", supported: true, subtitles: [] };
const DOWNLOADING = { status: "downloading", progress: 0.3, peers: 4, can_stream: true };

interface Screen {
  name: string;
  path: string;
  info: Info;
  ready: string;
}
const SCREENS: Screen[] = [
  { name: "home", path: "/next/", info: READY, ready: ".poster-card" },
  { name: "search results", path: "/next/search/dune", info: READY, ready: ".result-row" },
  { name: "file list", path: magnetUrl(), info: READY, ready: ".file-row" },
  { name: "download", path: magnetUrl(FILES[0]), info: DOWNLOADING, ready: ".cancel-download" },
  { name: "player", path: magnetUrl(FILES[0]), info: READY, ready: ".player-controls" },
  { name: "settings", path: "/settings", info: READY, ready: ".categories button" },
];

// Runs in the page: returns what is wrong, as strings.
function nameless(): string[] {
  const out: string[] = [];
  const text = (el: Element) => (el.textContent || "").replace(/\s+/g, " ").trim();
  const labelled = (el: Element): string => {
    const aria = el.getAttribute("aria-label")?.trim();
    if (aria) return aria;
    const by = el.getAttribute("aria-labelledby");
    if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ").trim();
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) return Array.from(labels).map(text).join(" ");
    if (el.tagName === "IMG") return (el.getAttribute("alt") || "").trim();
    const content = text(el);
    if (content) return content;
    return (el.getAttribute("title") || "").trim();
  };
  document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [tabindex="0"]').forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (!labelled(el)) out.push(`${el.tagName.toLowerCase()}.${(el as HTMLElement).className}`);
  });
  document.querySelectorAll("img").forEach((el) => {
    if (el.getAttribute("alt") === null && el.getAttribute("role") !== "presentation" && el.getAttribute("aria-hidden") !== "true") out.push(`img[no alt] ${el.src.slice(0, 40)}`);
  });
  return out;
}

function contrastFailures(): string[] {
  type RGBA = [number, number, number, number];
  const parse = (value: string): RGBA => {
    const m = value.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 0];
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const over = (top: RGBA, bottom: RGBA): RGBA => {
    const a = top[3] + bottom[3] * (1 - top[3]);
    if (a === 0) return [0, 0, 0, 0];
    return [0, 1, 2].map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a).concat(a) as RGBA;
  };
  const lum = (c: RGBA) => {
    const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a: RGBA, b: RGBA) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const out: string[] = [];
  const seen = new Set<string>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    const el = node.parentElement;
    if (!el || ["SCRIPT", "STYLE", "OPTION"].includes(el.tagName)) continue;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") continue;
    // Effective opacity (it multiplies down the tree) and the first painted background behind the text.
    let opacity = 1;
    let bg: RGBA = [0, 0, 0, 0];
    let unknown = false;
    for (let a: Element | null = el; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      opacity *= parseFloat(s.opacity);
      if (bg[3] < 1) {
        if (s.backgroundImage !== "none") unknown = true; // a gradient or picture: not measurable here
        bg = over(bg, parse(s.backgroundColor));
        if (a === el) bg = parse(s.backgroundColor);
      }
    }
    // Rebuild the background properly: composite ancestors bottom-up.
    const stack: RGBA[] = [];
    for (let a: Element | null = el; a; a = a.parentElement) stack.push(parse(getComputedStyle(a).backgroundColor));
    let base: RGBA = [15, 16, 19, 1];
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    if (unknown) continue;
    if ((el as HTMLInputElement).disabled || el.closest("button:disabled, [disabled]")) continue; // disabled controls are exempt
    const fgRaw = parse(style.color);
    const fg = over([fgRaw[0], fgRaw[1], fgRaw[2], fgRaw[3] * opacity], base);
    const size = parseFloat(style.fontSize);
    const bold = parseInt(style.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const got = ratio(fg, base);
    if (got + 0.01 < need) {
      const key = `${el.tagName.toLowerCase()}.${el.className}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`${key} "${node.textContent.trim().slice(0, 30)}" ${got.toFixed(2)} < ${need}`);
    }
  }
  return out;
}

async function focusChanges(page: Page): Promise<string[]> {
  // Tab once so the page is in keyboard modality (:focus-visible matches), then focus each control.
  await page.keyboard.press("Tab");
  return page.evaluate(() => {
    const sig = (el: Element) => {
      const s = getComputedStyle(el);
      return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.backgroundColor, s.color, s.transform, s.filter, s.textDecorationLine, s.opacity].join("|");
    };
    const out: string[] = [];
    const selector = 'button, a[href], input:not([type="hidden"]), select, textarea, [tabindex="0"], [tabindex="-1"]';
    const seen = new Set<string>();
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || el.hasAttribute("disabled") || el.closest("[hidden]")) return;
      if (el.getAttribute("tabindex") === "-1" && !el.matches(selector.replace(', [tabindex="-1"]', ""))) return;
      const key = `${el.tagName.toLowerCase()}.${el.className}`;
      if (seen.has(key)) return;
      seen.add(key);
      (document.activeElement as HTMLElement | null)?.blur();
      const before = sig(el);
      el.focus({ focusVisible: true } as FocusOptions);
      if (document.activeElement !== el) return;
      if (sig(el) === before) {
        // The video element shows no ring by design (the picture is the focus target).
        if (el.tagName !== "VIDEO") out.push(key);
      }
      el.blur();
    });
    return out;
  });
}

for (const screen of SCREENS) {
  test.describe(screen.name, () => {
    test("controls are named, show keyboard focus, and text has AA contrast", async ({ page }) => {
      await mock(page, screen.info);
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(screen.path);
      await expect(page.locator(screen.ready).first()).toBeVisible();
      if (screen.name === "player") await page.waitForTimeout(300);
      expect(await page.evaluate(nameless), "controls without an accessible name").toEqual([]);
      expect(await page.evaluate(contrastFailures), "text below WCAG AA contrast").toEqual([]);
      expect(await focusChanges(page), "controls whose focus is invisible").toEqual([]);
    });

    test("fits a 320 px wide screen without sideways scrolling", async ({ page }) => {
      await mock(page, screen.info);
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto(screen.path);
      await expect(page.locator(screen.ready).first()).toBeVisible();
      await page.waitForTimeout(200);
      const overflow = await page.evaluate(() => {
        const wide: string[] = [];
        document.querySelectorAll("body *").forEach((el) => {
          const r = el.getBoundingClientRect();
          // Inside a deliberately horizontal scroller (a rail) wide children are fine.
          if (r.right > innerWidth + 1 && !el.closest(".billboard-scroller, .home-rail, [data-scroll-x], .episode-strip")) {
            const s = getComputedStyle(el);
            if (s.position !== "fixed" && s.visibility !== "hidden") wide.push(`${el.tagName.toLowerCase()}.${(el as HTMLElement).className} right=${Math.round(r.right)}`);
          }
        });
        return { doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, inner: innerWidth, wide: wide.slice(0, 6) };
      });
      expect(overflow.doc, JSON.stringify(overflow)).toBeLessThanOrEqual(320);
      expect(overflow.body, JSON.stringify(overflow)).toBeLessThanOrEqual(320);
    });
  });
}

test("prefers-reduced-motion: no long transitions, no smooth scrolling, a slowed spinner", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mock(page, DOWNLOADING);
  await page.goto(magnetUrl(FILES[0]));
  await expect(page.locator(".cancel-download")).toBeVisible();
  const motion = await page.evaluate(() => {
    const long: string[] = [];
    document.querySelectorAll("*").forEach((el) => {
      const s = getComputedStyle(el);
      const durations = s.transitionDuration.split(",").map((d) => parseFloat(d) * (d.includes("ms") ? 0.001 : 1));
      if (durations.some((d) => d > 0.05)) long.push(`${el.tagName.toLowerCase()}.${(el as HTMLElement).className} transition ${s.transitionDuration}`);
      if (s.animationName !== "none" && parseFloat(s.animationDuration) < 2) long.push(`${el.tagName.toLowerCase()}.${(el as HTMLElement).className} animation ${s.animationDuration}`);
      if (s.scrollBehavior === "smooth") long.push(`${el.tagName.toLowerCase()} smooth`);
    });
    return long;
  });
  expect(motion).toEqual([]);
});

test("the page declares its language and a viewport, and each screen has one main landmark", async ({ page }) => {
  const holder = await mock(page, READY);
  for (const screen of SCREENS) {
    holder.current = screen.info;
    await page.goto(screen.path);
    await expect(page.locator(screen.ready).first()).toBeVisible();
    expect(await page.locator("html").getAttribute("lang"), screen.name).toBeTruthy();
    expect(await page.locator("main").count(), `${screen.name}: <main> landmarks`).toBe(1);
    expect(await page.locator("h1, h2").count(), `${screen.name}: headings`).toBeGreaterThan(0);
  }
  await page.goto("/next/");
  expect(await page.locator('meta[name="viewport"]').getAttribute("content")).toContain("width=device-width");
});
