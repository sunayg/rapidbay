import { describe, expect, it } from "vitest";
import {
  buildResolutionRows,
  episodeGroups,
  episodeResultRows,
  episodeVariation,
  flatRows,
  formatFullAirDate,
  formatRuntime,
  formatSize,
  labelWithResolution,
  latestEpisodeResults,
  movieResultRows,
  resolutionSummary,
  seasonEpisodes,
  stripKnownMovieTitle,
  type Group,
  type SearchResult,
} from "./results";

const r = (title: string, seeds = 1, extra: Partial<SearchResult> = {}): SearchResult => ({ title, seeds, magnet: "magnet:?xt=urn:btih:" + title, ...extra });

describe("formatting", () => {
  it("formats sizes, runtimes and dates like the legacy screen", () => {
    expect(formatSize(0)).toBe("");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1536)).toBe("2 KB");
    expect(formatSize(5 * 1024 ** 3)).toBe("5.00 GB");
    expect(formatRuntime(95)).toBe("1h 35m");
    expect(formatRuntime(120)).toBe("2h");
    expect(formatRuntime(45)).toBe("45 min");
    expect(formatRuntime(0)).toBe("");
    expect(formatFullAirDate("2024-03-07")).toBe("7 Mar 2024");
    expect(formatFullAirDate("soon")).toBe("soon");
  });
});

describe("resolution labels", () => {
  it("moves the resolution to the front and ranks it", () => {
    expect(labelWithResolution("Dune 2021 1080p BluRay")).toEqual({ text: "1080p Dune 2021 BluRay", rank: 1080 });
    expect(labelWithResolution("Dune 4K HDR").rank).toBe(2160);
    expect(labelWithResolution("Dune WEB")).toEqual({ text: "Dune WEB", rank: 0 });
  });

  it("strips the known movie title and year", () => {
    expect(labelWithResolution(stripKnownMovieTitle("Dune.Part.Two.2024.1080p", "Dune: Part Two", 2024)).text).toBe("1080p");
    expect(stripKnownMovieTitle("Dune (2021) [720p]", "Dune", 2021)).toBe("720p");
  });

  it("summarises counts per resolution, best first", () => {
    const summary = resolutionSummary([r("a 720p"), r("b 1080p"), r("c 1080p"), r("d")]);
    expect(summary).toEqual([
      { rank: 1080, name: "1080p", count: 2 },
      { rank: 720, name: "720p", count: 1 },
      { rank: 0, name: "Other", count: 1 },
    ]);
  });
});

describe("resolution rows", () => {
  const movie: Group = { title: "Dune", year: 2021, media_type: "movie", results: [r("Dune 720p", 50), r("Dune 1080p", 5), r("Dune 1080p x265", 90)] };

  it("sorts by resolution, then seeds, with headings when mixed", () => {
    const rows = movieResultRows(movie, () => false);
    expect(rows.map((row) => (row.type === "heading" ? row.label : row.type === "result" ? row.label : "?"))).toEqual([
      "1080p (2)",
      "1080p x265",
      "1080p",
      "720p (1)",
      "720p",
    ]);
  });

  it("has no headings for a single resolution", () => {
    const rows = movieResultRows({ ...movie, results: [r("Dune 1080p"), r("Dune 1080p b")] }, () => false);
    expect(rows.every((row) => row.type === "result")).toBe(true);
  });

  it("collapses a big bucket to three plus a more row, until opened", () => {
    const many = Array.from({ length: 12 }, (_, i) => r("Dune 1080p v" + i, 100 - i));
    const closed = movieResultRows({ ...movie, results: many }, () => false);
    expect(closed.filter((row) => row.type === "result")).toHaveLength(3);
    expect(closed.at(-1)).toMatchObject({ type: "more", rank: 1080, label: "1080p - 9 more results..." });
    const open = movieResultRows({ ...movie, results: many }, (rank) => rank === 1080);
    expect(open.filter((row) => row.type === "result")).toHaveLength(12);
  });

  it("does not collapse short lists unless forced", () => {
    const labelled = Array.from({ length: 6 }, (_, i) => ({ result: r("x" + i), label: "x" + i, rank: 720 }));
    expect(buildResolutionRows(labelled, () => false).filter((row) => row.type === "result")).toHaveLength(6);
    expect(buildResolutionRows(labelled, () => false, true).filter((row) => row.type === "result")).toHaveLength(3);
  });

  it("builds unlabelled rows for flat lists", () => {
    expect(flatRows([r("A"), r("B")]).map((row) => row.type)).toEqual(["result", "result"]);
  });
});

describe("episode grouping", () => {
  const season = {
    episodes: [
      r("Show.S01E02.1080p"),
      r("Show S01E02 720p"),
      r("Show.1x03.720p"),
      r("Show.S01.Complete.1080p"),
      r("Show Seasons 1-3 Complete"),
      r("Show S01-S03 pack"),
    ],
  };

  it("buckets by episode and puts packs and ranges together", () => {
    const groups = episodeGroups(season);
    expect(groups.map((g) => [g.key, g.results.length])).toEqual([
      ["2", 2],
      ["3", 1],
      ["season-pack", 3],
    ]);
    expect(groups[2]).toMatchObject({ episode: null, label: "Full season" });
  });

  it("lists episodes with TMDB details, hides unreleased ones and adds packs to every aired episode", () => {
    const now = new Date(2024, 5, 1);
    const details = [
      { episode_number: 1, name: "Pilot", air_date: "2024-01-01" },
      { episode_number: 2, name: "Two", air_date: "2024-01-08" },
      { episode_number: 3, name: "Three", air_date: "2024-01-15" },
      { episode_number: 4, name: "Future", air_date: "2999-01-01" },
    ];
    const list = seasonEpisodes(season, details, now);
    expect(list.map((e) => e.episode)).toEqual([1, 2, 3]);
    expect(list[0].label).toBe("Pilot");
    // episode 1 has no own releases but offers the 3 packs
    expect(list[0].results).toHaveLength(3);
    expect(list[0].results.every((x) => x.seasonPack)).toBe(true);
    expect(list[1].results).toHaveLength(5);
  });

  it("drops an unreleased episode that torrents already mention", () => {
    const list = seasonEpisodes({ episodes: [r("Show S01E05 1080p")] }, [{ episode_number: 5, air_date: "2999-01-01" }], new Date(2024, 0, 1));
    expect(list).toEqual([]);
  });

  it("shows one Full season entry when there are only packs and no details", () => {
    const list = seasonEpisodes({ episodes: [r("Show S02 Complete")] }, []);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ episode: null, key: "season-pack", label: "Full season" });
  });

  it("finds the latest episode's results", () => {
    const group: Group = {
      title: "Show",
      media_type: "tv",
      latest_episode: { season_number: 1, episode_number: 3 },
      seasons: [{ season: 1, episodes: season.episodes }],
    };
    expect(latestEpisodeResults(group)).toHaveLength(1);
    expect(latestEpisodeResults({ ...group, latest_episode: { season_number: 9, episode_number: 1 } })).toEqual([]);
  });

  it("labels variations without the show, year and episode tokens", () => {
    const group = { title: "Show Name", year: 2020 };
    expect(episodeVariation(group, 1, 2, r("Show.Name.2020.S01E02.1080p.WEB-DL")).text).toBe("1080p WEB-DL");
    expect(episodeVariation(group, 1, null, r("Show Name S01 Complete 1080p mkv")).text).toBe("1080p");
    const rows = episodeResultRows(group, 1, 2, [r("Show.Name.S01E02.720p", 5), r("Show.Name.S01E02.1080p", 1)], () => false);
    expect(rows[0]).toMatchObject({ type: "heading", label: "1080p (1)" });
  });
});
