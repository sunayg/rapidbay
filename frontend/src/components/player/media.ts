// Naming helpers behind the player: language labels, clock text and the
// episode-from-filename logic of the episode menu. Ported from the legacy app.
import { isVideoFilename } from "../../lib/magnet";

const LANGUAGE_ALIASES: Record<string, string> = {
  pb: "pt",
  jp: "ja",
  gr: "el",
  cz: "cs",
  dk: "da",
  se: "sv",
  kr: "ko",
  cn: "zh",
};

export function languageName(code: unknown): string {
  const raw = String(code || "").trim();
  if (!raw) return raw;
  let normalized = raw.replace(/_/g, "-");
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(normalized)) return raw;
  const alias = LANGUAGE_ALIASES[normalized.toLowerCase()];
  if (alias) normalized = alias;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(normalized);
    if (name && name.toLowerCase() !== normalized.toLowerCase() && name.toLowerCase() !== "root") return name;
  } catch {
    // Unknown code: fall through to the region lookup.
  }
  if (/^[A-Za-z]{2}$/.test(normalized)) {
    try {
      const region = new Intl.DisplayNames(["en"], { type: "region" }).of(normalized.toUpperCase());
      if (region && region.toLowerCase() !== normalized.toLowerCase()) return region;
    } catch {
      // Not a region either.
    }
  }
  return raw;
}

export function normalizeLanguage(lang: string | null | undefined): string {
  return lang ? lang.split("-")[0].toLowerCase() : "";
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => (value < 10 ? "0" : "") + value;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export function cleanMediaTitle(name: unknown): string {
  const text = safeDecode(String(name || ""));
  return (text.split(/[/\\]/).pop() || "")
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface Code {
  season: number;
  episode: number;
}

export function episodeCode(text: unknown): Code | null {
  const source = String(text || "");
  let match = source.match(/S0*(\d{1,2})[\s._-]*E0*(\d{1,3})(?!\d)/i);
  if (match) return { season: parseInt(match[1], 10), episode: parseInt(match[2], 10) };
  match = source.match(/(?:^|[^0-9])0*(\d{1,2})x0*(\d{1,3})(?!\d)/i);
  if (match) return { season: parseInt(match[1], 10), episode: parseInt(match[2], 10) };
  return null;
}

export function releaseSignature(display: unknown): string {
  const text = String(display || "");
  const quality = text.match(/\b\d{3,4}p\b[\s\S]*$/i);
  const tail = quality ? quality[0] : text.replace(/S0*\d{1,2}[\s._-]*E0*\d{1,3}/gi, " ").replace(/\bS0*\d{1,2}\b/gi, " ");
  // A stray tag such as "(C)" on one file must not split it from the rest of the pack.
  return tail
    .replace(/\([^)]*\)/g, " ")
    .replace(/[()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function releaseGroup(display: unknown): string {
  const token = releaseSignature(display).split(/\s+/).pop() || "";
  const piece = token.split("-").pop() || "";
  if (/^[a-z0-9]{3,}$/i.test(piece) && !/^(x|h)26[45]$/i.test(piece) && !/^\d{3,4}p$/i.test(piece)) return piece;
  return token;
}

export function showNameFromDisplay(display: unknown): string {
  const show = String(display || "").split(/S0*\d{1,2}[\s._-]*E0*\d{1,3}/i)[0];
  return show.replace(/\bS0*\d{1,2}\b/i, "").replace(/\s+/g, " ").trim();
}

export function releaseSearchTerm(display: unknown): string {
  return [showNameFromDisplay(display), releaseGroup(display)].filter(Boolean).join(" ");
}

export interface EpisodeChoice extends Code {
  label: string;
  name: string;
  overview: string;
  stillUrl: string;
  magnet: string;
  filename: string;
  torrentLink: string;
  current: boolean;
}

export function addReleaseEpisode(list: EpisodeChoice[], episode: EpisodeChoice): void {
  for (let i = 0; i < list.length; i++) {
    if (list[i].season === episode.season && list[i].episode === episode.episode) {
      if (episode.current) list[i] = episode;
      return;
    }
  }
  list.push(episode);
}

export function episodesFromNames(
  names: string[] | null | undefined,
  signature: string,
  magnet: string,
  currentFile: string,
): EpisodeChoice[] {
  const currentBase = String(currentFile || "").split(/[/\\]/).pop()!.toLowerCase();
  const list: EpisodeChoice[] = [];
  for (const name of names || []) {
    if (!isVideoFilename(name)) continue;
    const display = cleanMediaTitle(name);
    if (!signature || releaseSignature(display) !== signature) continue;
    const code = episodeCode(name) || episodeCode(display);
    if (!code) continue;
    const base = String(name).split(/[/\\]/).pop()!.toLowerCase();
    list.push({
      label: display,
      name: "",
      overview: "",
      stillUrl: "",
      season: code.season,
      episode: code.episode,
      magnet,
      filename: name,
      torrentLink: "",
      current: base === currentBase,
    });
  }
  return list;
}

export function groupBySeason(choices: EpisodeChoice[]): { season: number; episodes: EpisodeChoice[] }[] {
  const groups: { season: number; episodes: EpisodeChoice[] }[] = [];
  for (const episode of choices) {
    let group = groups.find((g) => g.season === episode.season);
    if (!group) {
      group = { season: episode.season, episodes: [] };
      groups.push(group);
    }
    group.episodes.push(episode);
  }
  return groups;
}
