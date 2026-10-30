import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { castVideo } from "./useCast";

vi.mock("../../lib/api", () => ({ get: vi.fn(async () => ({ prefix: "/cast/tok/abc/" })) }));

const HASH = "abcdef0123456789abcdef0123456789abcdef01";

function video(): HTMLVideoElement {
  const el = document.createElement("video");
  Object.defineProperty(el, "currentTime", { value: 42, configurable: true });
  return el;
}

beforeEach(() => {
  vi.stubGlobal("location", { ...window.location, hostname: "rapidbay.lan", origin: "http://rapidbay.lan:5050" });
});
afterEach(() => vi.unstubAllGlobals());

describe("castVideo", () => {
  it("sends the signed link of a file played from /play/", async () => {
    const cast = vi.fn((_options: { content: string; contentType: string }, done: (problem?: string) => void) => done());
    const problem = await castVideo({ videoUrl: `/play/${HASH}/Show.mp4`, title: "Show", video: video(), cc: { cast } });
    expect(problem).toBeNull();
    expect(cast.mock.calls[0][0].content).toBe("http://rapidbay.lan:5050/cast/tok/abc/Show.mp4");
    expect(cast.mock.calls[0][0].contentType).toBe("video/mp4");
  });

  it("sends the signed link of an encode session, taking the torrent from the player", async () => {
    const cast = vi.fn((_options: { content: string; contentType: string; time: number }, done: (problem?: string) => void) => done());
    const problem = await castVideo({
      videoUrl: "/api/hls/s1d2/master.m3u8",
      magnetHash: HASH,
      title: "Show",
      video: video(),
      cc: { cast },
    });
    expect(problem).toBeNull();
    expect(cast.mock.calls[0][0].content).toBe("http://rapidbay.lan:5050/cast/tok/abc/session/s1d2/master.m3u8");
    expect(cast.mock.calls[0][0].contentType).toBe("application/x-mpegURL"); // the receiver must be told it is HLS
    expect(cast.mock.calls[0][0].time).toBe(42);
  });

  it("cannot cast a session without knowing its torrent", async () => {
    const cast = vi.fn();
    const problem = await castVideo({ videoUrl: "/api/hls/s1d2/master.m3u8", title: "t", video: video(), cc: { cast } });
    expect(problem).toBe("This video cannot be cast.");
    expect(cast).not.toHaveBeenCalled();
  });
});
