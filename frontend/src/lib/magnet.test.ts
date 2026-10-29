import { beforeEach, describe, expect, it } from "vitest";
import {
  decodeMagnetParam,
  encodeMagnetParam,
  fileMatchesEpisode,
  get_hash,
  get_magnet_name,
  isExecutableFilename,
  isVideoFilename,
  magnetPath,
  pickEpisodeFile,
  pinnedTitleFromLocation,
  readEpisodeTarget,
  rememberEpisodeTarget,
  searchPath,
} from "./magnet";

describe("hash and name", () => {
  it("reads the hash with and without trackers", () => {
    expect(get_hash("magnet:?xt=urn:btih:ABCDEF&dn=x")).toBe("abcdef");
    expect(get_hash("magnet:?xt=urn:btih:ABCDEF")).toBe("abcdef");
  });
  it("reads dn, plus signs as spaces, else the hash", () => {
    expect(get_magnet_name("magnet:?xt=urn:btih:abc&dn=Some+Show%20S01")).toBe("Some Show S01");
    expect(get_magnet_name("magnet:?xt=urn:btih:ABC")).toBe("abc");
  });
});

describe("file types", () => {
  it("flags executables, case-insensitively, also in paths", () => {
    expect(isExecutableFilename("setup.EXE")).toBe(true);
    expect(isExecutableFilename("dir\\run.bat")).toBe(true);
    expect(isExecutableFilename("movie.mkv")).toBe(false);
    expect(isExecutableFilename("noext")).toBe(false);
    expect(isExecutableFilename(null)).toBe(false);
  });
  it("flags videos", () => {
    expect(isVideoFilename("a/b/Movie.MKV")).toBe(true);
    expect(isVideoFilename("a.srt")).toBe(false);
  });
});

describe("episode matching", () => {
  it("matches the usual forms", () => {
    expect(fileMatchesEpisode("Show.S01E02.mkv", 1, 2)).toBe(true);
    expect(fileMatchesEpisode("Show.S01.E02.mkv", 1, 2)).toBe(true);
    expect(fileMatchesEpisode("Show 1x02.mkv", 1, 2)).toBe(true);
    expect(fileMatchesEpisode("Show Season 1 Episode 2.mkv", 1, 2)).toBe(true);
    expect(fileMatchesEpisode("Show.S01E12.mkv", 1, 2)).toBe(false);
    expect(fileMatchesEpisode("Show.S10E02.mkv", 1, 2)).toBe(false);
  });
  it("picks a single video, skips samples and executables", () => {
    expect(pickEpisodeFile(["a.S01E02.mkv", "a.S01E03.mkv"], 1, 2)).toBe("a.S01E02.mkv");
    expect(pickEpisodeFile(["sample.S01E02.mkv", "a.S01E02.mkv"], 1, 2)).toBe("a.S01E02.mkv");
    expect(pickEpisodeFile(["a.S01E02.exe"], 1, 2)).toBeNull();
    expect(pickEpisodeFile(["a.S01E02.mkv", "b.S01E02.mp4"], 1, 2)).toBeNull();
    expect(pickEpisodeFile(["a.S01E02.nfo"], 1, 2)).toBe("a.S01E02.nfo");
    expect(pickEpisodeFile(undefined, 1, 2)).toBeNull();
  });
});

describe("episode target", () => {
  beforeEach(() => sessionStorage.clear());
  it("remembers and clears", () => {
    rememberEpisodeTarget("2", "5");
    expect(readEpisodeTarget()).toEqual({ season: 2, episode: 5 });
    rememberEpisodeTarget("x", "5");
    expect(readEpisodeTarget()).toBeNull();
  });
  it("ignores garbage", () => {
    sessionStorage.setItem("rapidbayEpisodeTarget", "{bad");
    expect(readEpisodeTarget()).toBeNull();
  });
});

describe("pinned title", () => {
  it("needs a media type and numeric tmdb id", () => {
    expect(pinnedTitleFromLocation("?media=tv&tmdb=12")).toEqual({ media: "tv", tmdb: "12" });
    expect(pinnedTitleFromLocation("?media=tv&tmdb=1x")).toBeNull();
    expect(pinnedTitleFromLocation("?media=game&tmdb=1")).toBeNull();
    expect(pinnedTitleFromLocation("")).toBeNull();
  });
});

describe("path params", () => {
  const magnet = "magnet:?xt=urn:btih:abc&dn=A+B&tr=http://t/a";
  it("round-trips a magnet through the double encoding", () => {
    // vue-router decodes a route param once before we see it
    expect(decodeMagnetParam(decodeURIComponent(encodeMagnetParam(magnet)))).toBe(magnet);
  });
  it("decodes percent escapes inside the magnet one more time, like the legacy app", () => {
    const withEscape = "magnet:?xt=urn:btih:abc&dn=A%20B";
    expect(decodeMagnetParam(decodeURIComponent(encodeMagnetParam(withEscape)))).toBe("magnet:?xt=urn:btih:abc&dn=A B");
  });
  it("survives malformed escapes", () => {
    expect(decodeMagnetParam("100%")).toBe("100%");
  });
  it("builds paths", () => {
    expect(searchPath("a b/c")).toBe("/search/a%20b%2Fc");
    expect(magnetPath("m:?x", "f g.mkv")).toBe("/magnet/m%253A%253Fx/f%20g.mkv");
  });
});
