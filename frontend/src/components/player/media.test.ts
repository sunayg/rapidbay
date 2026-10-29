import { describe, expect, it } from "vitest";
import {
  addReleaseEpisode,
  cleanMediaTitle,
  episodeCode,
  episodesFromNames,
  formatClock,
  groupBySeason,
  languageName,
  normalizeLanguage,
  releaseSearchTerm,
  releaseSignature,
  showNameFromDisplay,
} from "./media";

describe("media names", () => {
  it("formats the clock", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(3725.9)).toBe("1:02:05");
    expect(formatClock(NaN)).toBe("0:00");
  });

  it("names languages and falls back to the raw code", () => {
    expect(languageName("en")).toBe("English");
    expect(languageName("pb")).toBe("Portuguese");
    expect(languageName("nl-BE")).toMatch(/Dutch|Flemish/);
    expect(languageName("Forced track!")).toBe("Forced track!");
    expect(languageName("")).toBe("");
  });

  it("normalises a language to its primary subtag", () => {
    expect(normalizeLanguage("pt-BR")).toBe("pt");
    expect(normalizeLanguage(null)).toBe("");
  });

  it("cleans file names into titles", () => {
    expect(cleanMediaTitle("dir/Show.Name.S01E02.1080p[tag].mkv")).toBe("Show Name S01E02 1080p");
    expect(cleanMediaTitle("Show%20Name.mp4")).toBe("Show Name");
  });

  it("reads episode codes", () => {
    expect(episodeCode("Show.S02E05.mkv")).toEqual({ season: 2, episode: 5 });
    expect(episodeCode("Show 1x07")).toEqual({ season: 1, episode: 7 });
    expect(episodeCode("Movie 2020")).toBeNull();
  });

  it("builds release signatures and search terms", () => {
    expect(releaseSignature("Show S01E02 1080p WEB x265-GRP")).toBe("1080p web x265-grp");
    expect(showNameFromDisplay("Show Name S01E02 1080p")).toBe("Show Name");
    expect(releaseSearchTerm("Show Name S01E02 1080p WEB x265-GRP")).toBe("Show Name grp");
  });

  it("finds sibling episodes in a pack, marks the current one and groups by season", () => {
    const current = "Show.S01E02.1080p.mkv";
    const sig = releaseSignature(cleanMediaTitle(current));
    const list = episodesFromNames(
      ["Show.S01E01.1080p.mkv", current, "Show.S02E01.1080p.mkv", "Show.S01E03.720p.mkv", "notes.txt"],
      sig,
      "magnet:x",
      current,
    );
    expect(list.map((e) => `${e.season}x${e.episode}`)).toEqual(["1x1", "1x2", "2x1"]);
    expect(list.filter((e) => e.current).map((e) => e.episode)).toEqual([2]);
    expect(groupBySeason(list).map((g) => [g.season, g.episodes.length])).toEqual([[1, 2], [2, 1]]);
    addReleaseEpisode(list, { ...list[0], current: true, label: "new" });
    expect(list).toHaveLength(3);
    expect(list[0].label).toBe("new");
  });
});
