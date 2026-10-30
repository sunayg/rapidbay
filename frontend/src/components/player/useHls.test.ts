import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeHls } from "./testing";

vi.mock("hls.js", () => ({ default: FakeHls }));

import { attachHls, startLevelFor } from "./useHls";

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


describe("the starting quality hold", () => {
  const LEVELS = [
    { bitrate: 5_478_000, height: 1080 },
    { bitrate: 3_124_000, height: 720 },
    { bitrate: 1_626_000, height: 480 },
    { bitrate: 984_000, height: 360 },
  ];
  const frag = { frag: { type: "main" } };

  async function start() {
    const video = document.createElement("video");
    const handle = await attachHls(video, "/api/hls/s/master.m3u8", { startPosition: 0, onFatal: () => {}, onLive: () => {} });
    const hls = FakeHls.instances.at(-1)!;
    hls.emit("hlsManifestParsed", { levels: LEVELS });
    return { handle: handle!, hls };
  }

  beforeEach(() => {
    FakeHls.instances = [];
    FakeHls.supported = true;
  });

  it("starts on a fixed level and hands over to automatic after three segments", async () => {
    const { hls } = await start();
    expect(hls.startLevel).toBe(2);
    expect(hls.currentLevel).toBe(2);
    hls.emit("hlsFragBuffered", frag);
    hls.emit("hlsFragBuffered", frag);
    expect(hls.currentLevel).toBe(2);
    hls.emit("hlsFragBuffered", frag);
    expect(hls.currentLevel).toBe(-1);
  });

  it("does not count audio segments", async () => {
    const { hls } = await start();
    for (let i = 0; i < 5; i++) hls.emit("hlsFragBuffered", { frag: { type: "audio" } });
    expect(hls.currentLevel).toBe(2);
  });

  it("leaves a quality the viewer chose alone", async () => {
    const { handle, hls } = await start();
    handle.setQuality(0); // 1080p, picked from the menu in the first seconds
    for (let i = 0; i < 4; i++) hls.emit("hlsFragBuffered", frag);
    expect(hls.currentLevel).toBe(0);
  });

  it("does not lock a stream that has one level", async () => {
    const video = document.createElement("video");
    await attachHls(video, "/x.m3u8", { startPosition: 0, onFatal: () => {}, onLive: () => {} });
    const hls = FakeHls.instances.at(-1)!;
    hls.emit("hlsManifestParsed", { levels: [LEVELS[0]] });
    expect(hls.currentLevel).toBe(-1);
  });
});
