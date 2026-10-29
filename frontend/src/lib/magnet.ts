import { sessionGet, sessionRemove, sessionSet } from "./storage";

export function get_hash(magnetLink: string): string {
  const start = magnetLink.indexOf("btih:") + 5;
  const end = magnetLink.indexOf("&");
  if (end === -1) return magnetLink.substring(start).toLowerCase();
  return magnetLink.substring(start, end).toLowerCase();
}

export function get_magnet_name(magnetLink: string): string {
  const match = magnetLink.match(/dn=([^&]+)/);
  if (match) {
    try {
      return decodeURIComponent(match[1].replace(/\+/g, " "));
    } catch {
      return match[1].replace(/\+/g, " ");
    }
  }
  return get_hash(magnetLink);
}

const EXECUTABLE_EXTENSIONS = new Set(
  "exe bat cmd com msi msp scr pif cpl ps1 vbs vbe js jse wsf wsh hta sh bash command bin run apk jar dll sys msc reg lnk gadget".split(
    " ",
  ),
);
const VIDEO_EXTENSIONS = new Set("mkv mp4 avi m4v webm mov wmv mpg mpeg ts m2ts".split(" "));

function extensionOf(filename: unknown): string | null {
  const base = String(filename ?? "")
    .split(/[/\\]/)
    .pop() as string;
  const dot = base.lastIndexOf(".");
  return dot < 0 ? null : base.slice(dot + 1).toLowerCase();
}

export function isExecutableFilename(filename: unknown): boolean {
  const ext = extensionOf(filename);
  return ext !== null && EXECUTABLE_EXTENSIONS.has(ext);
}

export function isVideoFilename(filename: unknown): boolean {
  const ext = extensionOf(filename);
  return ext !== null && VIDEO_EXTENSIONS.has(ext);
}

const EPISODE_TARGET_KEY = "rapidbayEpisodeTarget";

export interface EpisodeTarget {
  season: number;
  episode: number;
}

export function rememberEpisodeTarget(season: unknown, episode: unknown): void {
  const s = parseInt(String(season), 10);
  const e = parseInt(String(episode), 10);
  if (isNaN(s) || isNaN(e)) {
    sessionRemove(EPISODE_TARGET_KEY);
    return;
  }
  sessionSet(EPISODE_TARGET_KEY, JSON.stringify({ season: s, episode: e }));
}

export function readEpisodeTarget(): EpisodeTarget | null {
  try {
    const parsed = JSON.parse(sessionGet(EPISODE_TARGET_KEY) || "null");
    if (!parsed) return null;
    const season = parseInt(parsed.season, 10);
    const episode = parseInt(parsed.episode, 10);
    if (isNaN(season) || isNaN(episode)) return null;
    return { season, episode };
  } catch {
    return null;
  }
}

export function clearEpisodeTarget(): void {
  sessionRemove(EPISODE_TARGET_KEY);
}

export function fileMatchesEpisode(filename: unknown, season: number | string, episode: number | string): boolean {
  const name = String(filename ?? "");
  const code = new RegExp(`(?:^|[^A-Za-z0-9])S0*${season}(?!\\d)[\\s._-]*E0*${episode}(?!\\d)`, "i");
  const cross = new RegExp(`(?:^|[^0-9])0*${season}[xX]0*${episode}(?!\\d)`);
  const words = new RegExp(`\\bseason[\\s._-]*0*${season}\\b[\\s\\S]{0,40}?\\bepisode[\\s._-]*0*${episode}\\b`, "i");
  return code.test(name) || cross.test(name) || words.test(name);
}

export function pickEpisodeFile(files: string[] | null | undefined, season: number | string, episode: number | string): string | null {
  let matches = (files || []).filter((name) => fileMatchesEpisode(name, season, episode) && !isExecutableFilename(name));
  const fresh = matches.filter((name) => !/\bsample\b/i.test(name));
  if (fresh.length) matches = fresh;
  const videos = matches.filter(isVideoFilename);
  if (videos.length === 1) return videos[0];
  if (videos.length > 1) return null;
  return matches.length === 1 ? matches[0] : null;
}

export interface PinnedTitle {
  media: "tv" | "movie";
  tmdb: string;
}

export function pinnedTitleFromLocation(search: string = window.location.search): PinnedTitle | null {
  const params = new URLSearchParams(search);
  const media = params.get("media");
  const tmdb = params.get("tmdb");
  if ((media === "tv" || media === "movie") && /^\d+$/.test(tmdb || "")) {
    return { media, tmdb: tmdb as string };
  }
  return null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Magnet links are put in the path doubly encoded. The router decodes a route
// param once; display_view in the legacy app decoded it twice more, and so do we.
export function decodeMagnetParam(param: string): string {
  return safeDecode(safeDecode(param));
}

export function encodeMagnetParam(magnet: string): string {
  return encodeURIComponent(encodeURIComponent(magnet));
}

export function searchPath(term: string): string {
  return "/search/" + encodeURIComponent(term);
}

export function magnetPath(magnet: string, filename?: string): string {
  return "/magnet/" + encodeMagnetParam(magnet) + (filename ? "/" + encodeURIComponent(filename) : "");
}

export function torrentPath(link: string): string {
  return "/torrent/" + encodeURIComponent(link);
}
