// Presentation helpers for the title cards on the home rows (ported from the
// legacy search-screen: recentSubtitle, cardSubtitle, formatAirDate).

export interface HomeTitle {
  tmdb_id?: number;
  media_type?: string;
  title?: string;
  year?: number | null;
  poster_url?: string | null;
  backdrop_url?: string | null;
  subtitle?: string | null;
  rank?: number | null;
  next_air_date?: string | null;
  minutes_left?: number | null;
  magnet?: string | null;
  filename?: string | null;
  watched_episodes?: { season: number | string; episode: number | string; at?: number }[];
  [key: string]: unknown;
}

function pad(value: number | string): string {
  const number = parseInt(String(value), 10);
  return (number < 10 ? "0" : "") + number;
}

export function recentSubtitle(title: HomeTitle | null | undefined): string {
  if (!title || title.media_type !== "tv") return title && title.year ? String(title.year) : "";
  let latest: NonNullable<HomeTitle["watched_episodes"]>[number] | null = null;
  for (const episode of title.watched_episodes || []) {
    if (!latest || (episode.at || 0) >= (latest.at || 0)) latest = episode;
  }
  return latest ? "S" + pad(latest.season) + "E" + pad(latest.episode) : "";
}

export function cardSubtitle(title: HomeTitle | null | undefined): string {
  if (title && title.subtitle) return title.subtitle;
  return recentSubtitle(title);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatAirDate(value: string | null | undefined, now: Date = new Date()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return value || "";
  const month = MONTHS[parseInt(match[2], 10) - 1];
  if (!month) return value || "";
  const day = parseInt(match[3], 10);
  return match[1] === String(now.getFullYear()) ? `${day} ${month}` : `${day} ${month} ${match[1]}`;
}

// Where a title card leads: a text search, pinned to the exact TMDB title.
export function titleSearchQuery(title: HomeTitle): string {
  if (title.tmdb_id && (title.media_type === "tv" || title.media_type === "movie")) {
    return `?media=${title.media_type}&tmdb=${title.tmdb_id}`;
  }
  return "";
}
