import { describe, expect, it } from "vitest";
import { canCancelStatus, headingFor, hlsLink, isAppleBrowser, mp4Link, playLinkIdentity, streamDeclinedMessage, subheadingFor, subtitleTracks } from "./download";

describe("download helpers", () => {
  it("only the torrent phase can be cancelled", () => {
    expect(canCancelStatus(null)).toBe(false);
    for (const s of ["ready", "finishing_up", "converting"]) expect(canCancelStatus(s)).toBe(false);
    for (const s of ["queued", "downloading", "getting_metadata"]) expect(canCancelStatus(s)).toBe(true);
  });
  it("builds heading and subheading", () => {
    expect(headingFor({ status: "downloading", progress: 0.256 })).toBe("downloading (26%)");
    expect(headingFor({ status: "getting_metadata" })).toBe("getting metadata");
    expect(headingFor({ status: "queued", progress: 0 })).toBe("queued (0%)");
    expect(subheadingFor({ peers: 0, download_rate: 2500000 })).toBe("0 Peers · 2.50 MB/s");
    expect(subheadingFor({ source: "http", peers: 4 })).toBe("HTTP");
    expect(subheadingFor({})).toBeNull();
  });
  it("builds play links, with the HLS link carrying the subtitle count", () => {
    expect(mp4Link("abc", "a b.mp4")).toBe("/play/abc/a%20b.mp4");
    expect(hlsLink("abc", "hls/master.m3u8", 2)).toBe("/play/abc/hls%2Fmaster.m3u8?subs=2");
    expect(playLinkIdentity("/play/abc/x.m3u8?subs=3")).toBe("/play/abc/x.m3u8");
  });
  it("derives subtitle language and url", () => {
    expect(subtitleTracks("abc", ["movie_eng.vtt"])).toEqual([{ language: "eng", url: "/play/abc/movie_eng.vtt" }]);
  });
  it("explains why a stream was declined", () => {
    expect(streamDeclinedMessage("capacity")).toContain("capacity");
    expect(streamDeclinedMessage("weird")).toBe("Couldn't start the stream.");
    expect(streamDeclinedMessage(undefined)).toBe("Couldn't start the stream.");
  });
  it("detects Apple browsers by vendor", () => {
    expect(isAppleBrowser("Apple Computer, Inc.")).toBe(true);
    expect(isAppleBrowser("Google Inc.")).toBe(false);
  });
});
