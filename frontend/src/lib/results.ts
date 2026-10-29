// Presentation logic for the search results screen, ported from the legacy
// search-results-screen: label cleaning, resolution ranking and bucketing, and
// the episode grouping of TV season results. Pure functions, no DOM.

export interface SearchResult {
  title: string;
  seeds?: number;
  size?: number | null;
  magnet?: string | null;
  torrent_link?: string | null;
  filename?: string | null;
  status?: string | null;
  seasonPack?: boolean;
  ts?: number;
}

export interface EpisodeInfo {
  episode_number: number;
  season_number?: number;
  name?: string | null;
  overview?: string | null;
  air_date?: string | null;
  runtime?: number | null;
  vote_average?: number | null;
  still_url?: string | null;
}

export interface Season {
  season: number;
  episodes: SearchResult[];
}

export interface Group {
  tmdb_id?: number | null;
  title: string;
  year?: number | null;
  poster_url?: string | null;
  backdrop_url?: string | null;
  media_type?: string | null;
  overview?: string | null;
  genres?: string[];
  vote_average?: number | null;
  runtime?: number | null;
  latest_episode?: (EpisodeInfo & { season_number: number }) | null;
  seasons?: Season[];
  results?: SearchResult[];
}

export interface RichPayload {
  groups?: Group[];
  other?: SearchResult[];
  done?: boolean;
}

// ---- formatting ---------------------------------------------------------------

export function formatRating(value: unknown): string {
  const number = Number(value);
  return isFinite(number) ? number.toFixed(1) : "";
}

function pad(value: number | string): string {
  const number = parseInt(String(value), 10);
  return (number < 10 ? "0" : "") + number;
}

export function episodeCode(season: number | string, episode: number | string): string {
  return "S" + pad(season) + "E" + pad(episode);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Unlike the home rows, the results screen always shows the year.
export function formatFullAirDate(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return value || "";
  const month = MONTHS[parseInt(match[2], 10) - 1];
  if (!month) return value || "";
  return parseInt(match[3], 10) + " " + month + " " + match[1];
}

export function formatSize(bytes: unknown): string {
  let value = Number(bytes);
  if (!(value > 0)) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = unit >= 3 ? value.toFixed(2) : unit >= 1 ? value.toFixed(0) : String(value);
  return text + " " + units[unit];
}

export function formatRuntime(minutes: unknown): string {
  const total = parseInt(String(minutes), 10);
  if (!total || total < 1) return "";
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (!hours) return mins + " min";
  if (!mins) return hours + "h";
  return hours + "h " + mins + "m";
}

// ---- title cleaning and resolution labels -----------------------------------------

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function flexibleShowPattern(showTitle: string | null | undefined): string | null {
  const parts = String(showTitle || "")
    .split(/[\s._:-]+/)
    .filter(Boolean)
    .map(escapeRegExp);
  return parts.length ? parts.join("[\\s._:-]+") : null;
}

const RESOLUTION_LABELS = [
  { rank: 2160, label: "2160p", pattern: "2160p|4k|uhd" },
  { rank: 1080, label: "1080p", pattern: "1080p|full[\\s._-]*hd" },
  { rank: 720, label: "720p", pattern: "720p" },
  { rank: 576, label: "576p", pattern: "576p" },
  { rank: 480, label: "480p", pattern: "480p" },
];

export function resolutionLabelForRank(rank: number): string {
  return RESOLUTION_LABELS.find((spec) => spec.rank === rank)?.label ?? "";
}

export function stripKnownMovieTitle(title: string, movieTitle?: string | null, year?: number | string | null): string {
  let cleaned = title;
  const showPattern = flexibleShowPattern(movieTitle);
  if (showPattern) {
    const part = "(?:[\\s._:-]+part[\\s._:-]*(?:one|two|three|four|1|2|3|4|i{1,3}))?";
    cleaned = cleaned.replace(new RegExp("(^|[^A-Za-z0-9])" + showPattern + part + "(?![A-Za-z0-9])", "ig"), "$1 ");
  }
  if (year) {
    cleaned = cleaned.replace(new RegExp("\\(\\s*" + year + "\\s*\\)", "g"), " ");
    cleaned = cleaned.replace(new RegExp("(^|[^0-9])" + year + "(?![0-9])", "g"), "$1 ");
  }
  cleaned = cleaned.replace(/[[\]()]/g, " ");
  return cleaned.replace(/\s{2,}/g, " ").trim();
}

export function labelWithResolution(title: string): { text: string; rank: number } {
  let cleaned = title;
  let rank = 0;
  let label = "";
  for (const spec of RESOLUTION_LABELS) {
    const marker = "(?:^|[^A-Za-z0-9])(?:" + spec.pattern + ")(?![A-Za-z0-9])";
    if (!new RegExp(marker, "i").test(cleaned)) continue;
    rank = spec.rank;
    label = spec.label;
    cleaned = cleaned.replace(new RegExp(marker, "ig"), " ");
    break;
  }
  cleaned = cleaned.replace(/^[\s._:-]+/, "").replace(/[\s._:-]+$/, "").replace(/\s{2,}/g, " ").trim();
  return { text: label ? (cleaned ? label + " " + cleaned : label) : cleaned, rank };
}

export function stripEpisodeToken(title: string, seasonNumber: unknown, episodeNumber: unknown): string {
  let cleaned = title;
  const season = parseInt(String(seasonNumber), 10);
  const episode = parseInt(String(episodeNumber), 10);
  if (!isNaN(season) && !isNaN(episode)) {
    cleaned = cleaned.replace(new RegExp("[Ss]0*" + season + "[\\s._-]*[Ee]0*" + episode + "(?![0-9])", "i"), " ");
    cleaned = cleaned.replace(new RegExp("(^|[^0-9])0*" + season + "[xX]0*" + episode + "(?![0-9])", "i"), "$1 ");
    cleaned = cleaned.replace(new RegExp("\\bseason[\\s._-]*0*" + season + "\\b", "i"), " ");
    cleaned = cleaned.replace(new RegExp("\\bepisode[\\s._-]*0*" + episode + "\\b", "i"), " ");
  } else if (!isNaN(season)) {
    cleaned = cleaned.replace(new RegExp("[Ss]0*" + season + "(?![\\s._-]*[Ee]\\d)", "i"), " ");
    cleaned = cleaned.replace(new RegExp("\\bseason[\\s._-]*0*" + season + "\\b", "i"), " ");
  }
  return cleaned;
}

// ---- resolution bucketing -----------------------------------------------------------

export interface Labelled {
  result: SearchResult;
  label: string;
  rank: number;
}

export type ResultRow =
  | { type: "heading"; key: string; rank: number; label: string }
  | { type: "result"; key: string; result: SearchResult; label: string }
  | { type: "more"; key: string; rank: number; label: string };

export function sortByResolutionAndSeeds(
  results: SearchResult[] | null | undefined,
  describe: (result: SearchResult) => { text: string; rank: number },
): Labelled[] {
  return (results || [])
    .slice()
    .sort((a, b) => {
      const left = describe(a);
      const right = describe(b);
      if (left.rank !== right.rank) return right.rank - left.rank;
      return (b.seeds || 0) - (a.seeds || 0);
    })
    .map((result) => {
      const info = describe(result);
      return { result, label: info.text || result.title, rank: info.rank };
    });
}

// Buckets by resolution (headings only when there is more than one), and
// collapses a bucket of more than four down to three plus a "more" row when the
// list is long or collapsing is forced.
export function buildResolutionRows(
  labelled: Labelled[],
  isRankOpen: (rank: number) => boolean,
  alwaysCollapse = false,
): ResultRow[] {
  const collapse = alwaysCollapse || labelled.length > 10;
  const buckets: { rank: number; name: string; results: Labelled[] }[] = [];
  const indexByRank = new Map<number, number>();
  for (const item of labelled) {
    let index = indexByRank.get(item.rank);
    if (index === undefined) {
      index = buckets.length;
      indexByRank.set(item.rank, index);
      buckets.push({ rank: item.rank, name: resolutionLabelForRank(item.rank) || "Other", results: [] });
    }
    buckets[index].results.push(item);
  }
  const rows: ResultRow[] = [];
  for (const bucket of buckets) {
    if (buckets.length > 1) {
      rows.push({
        type: "heading",
        key: "heading:" + bucket.rank,
        rank: bucket.rank,
        label: bucket.name + " (" + bucket.results.length + ")",
      });
    }
    const hidden = collapse && bucket.results.length > 4 && !isRankOpen(bucket.rank);
    const visible = hidden ? bucket.results.slice(0, 3) : bucket.results;
    visible.forEach((item, index) => {
      rows.push({
        type: "result",
        key: (item.result.magnet || item.result.torrent_link || item.result.title) + ":" + bucket.rank + ":" + index,
        result: item.result,
        label: item.label,
      });
    });
    if (hidden) {
      rows.push({
        type: "more",
        key: "more:" + bucket.rank,
        rank: bucket.rank,
        label: bucket.name + " - " + (bucket.results.length - 3) + " more results...",
      });
    }
  }
  return rows;
}

export function resolutionSummary(results: SearchResult[] | null | undefined): { rank: number; name: string; count: number }[] {
  const counts = new Map<number, number>();
  for (const result of results || []) {
    const rank = labelWithResolution(result.title || "").rank;
    counts.set(rank, (counts.get(rank) || 0) + 1);
  }
  return [...counts.keys()]
    .sort((a, b) => b - a)
    .map((rank) => ({ rank, name: resolutionLabelForRank(rank) || "Other", count: counts.get(rank) as number }));
}

export function movieResultRows(group: Group, isRankOpen: (rank: number) => boolean): ResultRow[] {
  const labelled = sortByResolutionAndSeeds(group.results || [], (result) => {
    const info = labelWithResolution(stripKnownMovieTitle(result.title || "", group.title, group.year));
    return { text: info.text || result.title, rank: info.rank };
  });
  return buildResolutionRows(labelled, isRankOpen);
}

// ---- TV: episodes ---------------------------------------------------------------------

export interface EpisodeBucket {
  episode: number | null;
  key: string;
  label: string;
  results: SearchResult[];
}

const SEASON_RANGE = /\bseasons?\s+\d{1,2}\s*(?:to|thru|through|[-–—~])\s*(?:season\s+)?\d{1,2}\b/i;
const CODE_RANGE = /(?:^|[^A-Za-z0-9])S\d{1,2}(?:[ ._-]*E\d{1,2})?\s*(?:to|thru|through|[-–—~])\s*S\d{1,2}/i;

// Groups a season's results by the episode number found in the title; results
// that name no single episode (packs, multi-season ranges) share "season-pack".
export function episodeGroups(season: Pick<Season, "episodes">): EpisodeBucket[] {
  const groups: EpisodeBucket[] = [];
  const indexByEpisode = new Map<string, number>();
  for (const result of season.episodes || []) {
    const title = result.title || "";
    const seasonEpisode = title.match(/[Ss]\d{1,2}[ ._-]*[Ee](\d{1,2})/);
    const cross = title.match(/(?:^|[^0-9])\d{1,2}x(\d{1,2})(?:[^0-9]|$)/);
    const coversSeveral = SEASON_RANGE.test(title) || CODE_RANGE.test(title);
    const episodeNumber = coversSeveral ? null : seasonEpisode ? parseInt(seasonEpisode[1], 10) : cross ? parseInt(cross[1], 10) : null;
    const key = episodeNumber === null ? "season-pack" : String(episodeNumber);
    let index = indexByEpisode.get(key);
    if (index === undefined) {
      index = groups.length;
      indexByEpisode.set(key, index);
      groups.push({ episode: episodeNumber, key, label: episodeNumber === null ? "Full season" : "Episode " + episodeNumber, results: [] });
    }
    groups[index].results.push(result);
  }
  return groups;
}

export function episodeHasAired(info: { air_date?: string | null } | null | undefined, now: Date = new Date()): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((info && info.air_date) || "");
  if (!match) return false;
  const aired = new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
  const today = new Date(now.getTime());
  today.setHours(0, 0, 0, 0);
  return aired.getTime() <= today.getTime();
}

export interface SeasonEpisode {
  episode: number | null;
  key: string;
  label: string;
  details: EpisodeInfo | null;
  results: SearchResult[];
}

// Merges the torrent results with TMDB's episode list: unreleased episodes are
// hidden, and when only season packs exist the aired episodes are listed (each
// offering the packs). A pack-only season with no TMDB data is one "Full season".
export function seasonEpisodes(season: Pick<Season, "episodes">, details: EpisodeInfo[] | null | undefined, now: Date = new Date()): SeasonEpisode[] {
  const tmdbEpisodes = Array.isArray(details) ? details : [];
  let packs: SearchResult[] = [];
  const byEpisode = new Map<number, SearchResult[]>();
  for (const bucket of episodeGroups(season)) {
    if (bucket.episode === null) packs = packs.concat(bucket.results);
    else byEpisode.set(bucket.episode, bucket.results);
  }
  const tmdbByNumber = new Map<number, EpisodeInfo>();
  for (const episode of tmdbEpisodes) tmdbByNumber.set(episode.episode_number, episode);

  const numbers: number[] = [];
  const seen = new Set<number>();
  const add = (value: number) => {
    const number = parseInt(String(value), 10);
    if (isNaN(number) || seen.has(number)) return;
    seen.add(number);
    numbers.push(number);
  };
  const isUnreleased = (number: number) => {
    const info = tmdbByNumber.get(number);
    return !!(info && info.air_date && !episodeHasAired(info, now));
  };
  if (packs.length && tmdbEpisodes.length) {
    for (const episode of tmdbEpisodes) if (episodeHasAired(episode, now)) add(episode.episode_number);
  }
  for (const number of byEpisode.keys()) if (!isUnreleased(number)) add(number);

  if (!numbers.length && packs.length) {
    return [{ episode: null, key: "season-pack", label: "Full season", details: null, results: packs }];
  }
  numbers.sort((a, b) => a - b);
  return numbers.map((number) => {
    const results = (byEpisode.get(number) || []).slice();
    for (const pack of packs) results.push({ ...pack, seasonPack: true });
    const info = tmdbByNumber.get(number) || null;
    return { episode: number, key: String(number), label: (info && info.name) || "Episode " + number, details: info, results };
  });
}

export function latestEpisodeResults(group: Group): SearchResult[] {
  const latest = group.latest_episode;
  if (!latest || !group.seasons) return [];
  const season = group.seasons.find((item) => item.season === latest.season_number);
  if (!season) return [];
  return episodeGroups(season).find((bucket) => bucket.episode === latest.episode_number)?.results ?? [];
}

// A result's label inside an episode: the show, year and episode tokens come
// off, leaving the resolution and release tags.
export function episodeVariation(
  group: Pick<Group, "title" | "year"> | null,
  seasonNumber: number | null | undefined,
  episodeNumber: number | null | undefined,
  result: SearchResult,
): { text: string; rank: number } {
  const title = result.title || "";
  let cleaned = title;
  const showPattern = flexibleShowPattern(group && group.title);
  if (showPattern) {
    cleaned = cleaned.replace(new RegExp("(^|[^A-Za-z0-9])" + showPattern + "(?![A-Za-z0-9])", "i"), "$1 ");
  }
  if (group && group.year) {
    cleaned = cleaned.replace(new RegExp("\\(\\s*" + group.year + "\\s*\\)", "g"), " ");
    cleaned = cleaned.replace(new RegExp("(^|[^0-9])" + group.year + "(?![0-9])", "g"), "$1 ");
  }
  cleaned = stripEpisodeToken(cleaned, seasonNumber, episodeNumber);
  if (episodeNumber === null || episodeNumber === undefined || result.seasonPack) {
    cleaned = cleaned.replace(/\bseasons?\s+\d{1,2}\s*(?:to|thru|through|[-–—~])\s*(?:season\s+)?\d{1,2}\b/gi, " ");
    cleaned = cleaned.replace(/(?:^|[^A-Za-z0-9])S\d{1,2}(?:[ ._-]*E\d{1,2})?\s*(?:to|thru|through|[-–—~])\s*S\d{1,2}(?:[ ._-]*E\d{1,2})?/gi, " ");
    cleaned = cleaned.replace(/(?:^|[^A-Za-z0-9])[Ss]\d{1,2}(?![A-Za-z0-9])/g, " ");
    cleaned = cleaned.replace(/\bseason\s+\d{1,2}\b/gi, " ");
    cleaned = cleaned.replace(/\bcomplete\b/gi, " ");
    cleaned = cleaned.replace(/\b(?:mp4|mkv|avi|m4v)\b/gi, " ");
  }
  cleaned = cleaned.replace(/[[\]()]/g, " ");
  cleaned = cleaned.replace(/^[\s._:-]+/, "").replace(/[\s._:-]+$/, "").replace(/\s{2,}/g, " ").trim();
  const labelled = labelWithResolution(cleaned);
  return { text: labelled.text || title, rank: labelled.rank };
}

export function episodeResultRows(
  group: Pick<Group, "title" | "year">,
  seasonNumber: number | null | undefined,
  episodeNumber: number | null | undefined,
  results: SearchResult[],
  isRankOpen: (rank: number) => boolean,
): ResultRow[] {
  const labelled = sortByResolutionAndSeeds(results, (result) => episodeVariation(group, seasonNumber, episodeNumber, result));
  return buildResolutionRows(labelled, isRankOpen, true);
}

export function isEpisodeNumberWatched(
  watchedEpisodes: { season: number | string; episode: number | string }[] | undefined,
  seasonNumber: unknown,
  episodeNumber: unknown,
): boolean {
  if (episodeNumber === null || episodeNumber === undefined) return false;
  const season = Number(seasonNumber);
  const episode = Number(episodeNumber);
  return (watchedEpisodes || []).some((item) => Number(item.season) === season && Number(item.episode) === episode);
}

export function libraryMatch<T extends { tmdb_id?: number | null; media_type?: string | null }>(
  titles: T[],
  group: Pick<Group, "tmdb_id" | "media_type">,
): T | null {
  const id = group && group.tmdb_id;
  if (!id) return null;
  return titles.find((item) => item.tmdb_id === id && item.media_type === group.media_type) ?? null;
}

export function groupKey(group: Pick<Group, "tmdb_id" | "title">): string {
  return String(group.tmdb_id || group.title || "");
}

// Plain lists (history, favorites, "other results", plain search) show every
// result unlabelled, in the order given.
export function flatRows(results: SearchResult[]): ResultRow[] {
  return results.map((result, index) => ({
    type: "result" as const,
    key: (result.magnet || result.torrent_link || result.title) + ":" + (result.filename || "") + ":" + index,
    result,
    label: result.title,
  }));
}
