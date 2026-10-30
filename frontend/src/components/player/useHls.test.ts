import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForResumePoint, type ResumeWait } from "./useHls";

const MASTER = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080\nmovie_v0.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=900000\nmovie_v3.m3u8\n';
const playlist = (segments: number, ended = false) =>
  "#EXTM3U\n" + Array.from({ length: segments }, (_, i) => `#EXTINF:6.0,\nseg${i}.m4s\n`).join("") + (ended ? "#EXT-X-ENDLIST\n" : "");

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(playlists: string[]) {
  const seen: string[] = [];
  let polled = 0;
  const fetchText = async (url: string) => {
    seen.push(url);
    if (url.endsWith("master.m3u8")) return MASTER;
    return playlists[Math.min(polled++, playlists.length - 1)];
  };
  const waits: (ResumeWait | null)[] = [];
  return { fetchText, seen, waits, onWaiting: (w: ResumeWait | null) => waits.push(w) };
}

describe("waitForResumePoint", () => {
  it("starts at once when there is nothing to resume", async () => {
    const t = setup([]);
    expect(await waitForResumePoint("http://x/play/h/master.m3u8", 0, t.onWaiting, () => false, t.fetchText)).toBe(true);
    expect(t.seen).toEqual([]);
  });

  it("starts at once when the encoder is already past the resume point", async () => {
    const t = setup([playlist(20)]); // 120 s encoded
    expect(await waitForResumePoint("http://x/play/h/master.m3u8", 60, t.onWaiting, () => false, t.fetchText)).toBe(true);
    expect(t.seen[1]).toBe("http://x/play/h/movie_v0.m3u8"); // the top rendition decides
    expect(t.waits).toEqual([null]);
  });

  it("waits, reporting progress, until the encoder gets there", async () => {
    const t = setup([playlist(2), playlist(5), playlist(13)]); // 12 s, 30 s, 78 s
    const done = waitForResumePoint("http://x/play/h/master.m3u8", 60, t.onWaiting, () => false, t.fetchText);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await done).toBe(true);
    expect(t.waits).toEqual([{ encoded: 12, target: 60 }, { encoded: 30, target: 60 }, null]);
  });

  it("a finished stream is always ready, however short", async () => {
    const t = setup([playlist(3, true)]);
    expect(await waitForResumePoint("http://x/play/h/master.m3u8", 600, t.onWaiting, () => false, t.fetchText)).toBe(true);
  });

  it("stops waiting and says so when cancelled", async () => {
    const t = setup([playlist(1)]);
    let cancelled = false;
    const done = waitForResumePoint("http://x/play/h/master.m3u8", 600, t.onWaiting, () => cancelled, t.fetchText);
    await vi.advanceTimersByTimeAsync(2500);
    cancelled = true;
    await vi.advanceTimersByTimeAsync(500);
    expect(await done).toBe(false);
    expect(t.waits.at(-1)).toBeNull();
  });

  it("does not block playback when the playlists cannot be read", async () => {
    const t = setup([]);
    t.fetchText = async () => {
      throw new Error("offline");
    };
    expect(await waitForResumePoint("http://x/play/h/master.m3u8", 60, t.onWaiting, () => false, t.fetchText)).toBe(true);
  });

  it("a master without renditions (a single stream) starts at once", async () => {
    const t = setup([]);
    t.fetchText = async () => "#EXTM3U\n#EXT-X-VERSION:3\n";
    expect(await waitForResumePoint("http://x/play/h/master.m3u8", 60, t.onWaiting, () => false, t.fetchText)).toBe(true);
  });
});
