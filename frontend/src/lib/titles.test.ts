import { describe, expect, it } from "vitest";
import { cardSubtitle, formatAirDate, recentSubtitle, titleSearchQuery } from "./titles";

describe("title helpers", () => {
  it("subtitle: year for movies, latest episode for shows", () => {
    expect(recentSubtitle({ media_type: "movie", year: 1999 })).toBe("1999");
    expect(recentSubtitle({ media_type: "movie" })).toBe("");
    expect(recentSubtitle(null)).toBe("");
    expect(
      recentSubtitle({
        media_type: "tv",
        watched_episodes: [
          { season: 1, episode: 2, at: 5 },
          { season: 2, episode: 10, at: 9 },
        ],
      }),
    ).toBe("S02E10");
    expect(recentSubtitle({ media_type: "tv", watched_episodes: [] })).toBe("");
  });
  it("an explicit subtitle wins", () => {
    expect(cardSubtitle({ subtitle: "S01E01", media_type: "movie", year: 2000 })).toBe("S01E01");
    expect(cardSubtitle({ media_type: "movie", year: 2000 })).toBe("2000");
  });
  it("formats air dates, omitting the current year", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    expect(formatAirDate("2026-10-03", now)).toBe("3 Oct");
    expect(formatAirDate("2027-01-15", now)).toBe("15 Jan 2027");
    expect(formatAirDate("soon", now)).toBe("soon");
    expect(formatAirDate("2026-13-01", now)).toBe("2026-13-01");
    expect(formatAirDate(null, now)).toBe("");
  });
  it("pins a title to TMDB only for tv and movie", () => {
    expect(titleSearchQuery({ tmdb_id: 5, media_type: "tv" })).toBe("?media=tv&tmdb=5");
    expect(titleSearchQuery({ tmdb_id: 5, media_type: "person" })).toBe("");
    expect(titleSearchQuery({ media_type: "movie" })).toBe("");
  });
});
