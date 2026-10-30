// Pure helpers behind the download screen: how a status payload turns into the
// heading, the play link and the subtitle list. Ported from the legacy
// download-screen applyFileInfo.

export interface FileInfo {
  status: string;
  progress?: number | null;
  peers?: number | null;
  source?: string;
  download_rate?: number | null;
  filename?: string;
  supported?: boolean;
  subtitles?: string[];
  can_stream?: boolean;
  // How far into the file (0 to 1) it has to have downloaded before it can start playing.
  start_at?: number;
  // "direct": the browser plays the file as it is. "session": it is encoded on demand.
  playback?: "direct" | "session";
  done?: boolean;
}

export interface SubtitleTrack {
  language: string;
  url: string;
}

// Once the file is converting or playable the work is done; only the torrent
// phase can be called off.
export function canCancelStatus(status: string | null): boolean {
  return !!status && ["ready", "finishing_up", "converting"].indexOf(status) === -1;
}

export function headingFor(info: Pick<FileInfo, "status" | "progress">): string {
  const text = info.status.replace(/_/g, " ");
  return info.progress === 0 || info.progress ? `${text} (${Math.round(info.progress * 100)}%)` : text;
}

export function subheadingFor(info: Pick<FileInfo, "source" | "peers" | "download_rate">): string | null {
  const parts: string[] = [];
  if (info.source === "http") parts.push("HTTP");
  else if (info.peers === 0 || info.peers) parts.push(`${info.peers} Peers`);
  if (info.download_rate) parts.push(`${(info.download_rate / 1000000).toFixed(2)} MB/s`);
  return parts.length ? parts.join(" · ") : null;
}

export function isHlsLink(link: string | null): boolean {
  return !!link && link.indexOf(".m3u8") !== -1;
}

// The link identity ignores any query string.
export function playLinkIdentity(link: string): string {
  return link.split("?")[0];
}

export function mp4Link(hash: string, filename: string): string {
  return "/play/" + hash + "/" + encodeURIComponent(filename);
}

export function subtitleTracks(hash: string, subtitles: string[]): SubtitleTrack[] {
  return subtitles.map((sub) => ({
    language: sub.substring(sub.lastIndexOf("_") + 1).replace(".vtt", ""),
    url: "/play/" + hash + "/" + sub,
  }));
}

export const STREAM_REASONS: Record<string, string> = {
  unsupported_format: "This file can't be played while it downloads. It will play once it has finished.",
  unreadable: "This file couldn't be read.",
  capacity: "Server is at streaming capacity. Try again shortly.",
  not_ready: "Not enough data buffered yet — wait a moment.",
  no_torrent: "Torrent isn't ready yet.",
  file_not_found: "File not found in torrent.",
  invalid_path: "Invalid filename.",
};

export function streamDeclinedMessage(reason: string | undefined): string {
  return (reason && STREAM_REASONS[reason]) || "Couldn't start playback.";
}

export function isAppleBrowser(vendor: string = navigator.vendor): boolean {
  return !!vendor && vendor.indexOf("Apple") > -1;
}
