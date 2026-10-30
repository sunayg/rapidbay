import { describe, expect, it } from "vitest";
import { startLevelFor } from "./useHls";

describe("startLevelFor", () => {
  const ladder = [
    { bitrate: 5_478_000, height: 1080 },
    { bitrate: 3_124_000, height: 720 },
    { bitrate: 1_626_000, height: 480 },
    { bitrate: 984_000, height: 360 },
  ];

  it("starts on the best level that fits the starting bitrate", () => {
    expect(startLevelFor(ladder)).toBe(2); // 480p, 1.6 Mbps
  });

  it("falls back to the lowest level when none fits", () => {
    expect(startLevelFor([{ bitrate: 8_000_000, height: 1080 }, { bitrate: 4_000_000, height: 720 }])).toBe(1);
  });

  it("does not depend on the order of the levels", () => {
    expect(startLevelFor([...ladder].reverse())).toBe(1);
  });

  it("has no answer for no levels", () => {
    expect(startLevelFor([])).toBe(-1);
  });
});
