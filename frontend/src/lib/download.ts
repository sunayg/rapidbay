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
  hls_filename?: string;
  hls_subtitles?: string[];
  hls_pending?: boolean;
  subtitles?: string[];
  can_stream?: boolean;
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

// The link identity ignores the query string (the ?subs= cache-buster).
export function playLinkIdentity(link: string): string {
  return link.split("?")[0];
}

export function mp4Link(hash: string, filename: string): string {
  return "/play/" + hash + "/" + encodeURIComponent(filename);
}

// The HLS link is tagged with the subtitle count so a regenerated master
// playlist is refetched by hls.js when new VTTs arrive.
export function hlsLink(hash: string, hlsFilename: string, subtitleCount: number): string {
  return "/play/" + hash + "/" + encodeURIComponent(hlsFilename) + "?subs=" + subtitleCount;
}

export function subtitleTracks(hash: string, subtitles: string[]): SubtitleTrack[] {
  return subtitles.map((sub) => ({
    language: sub.substring(sub.lastIndexOf("_") + 1).replace(".vtt", ""),
    url: "/play/" + hash + "/" + sub,
  }));
}

export const STREAM_REASONS: Record<string, string> = {
  disabled: "Streaming is disabled.",
  unsupported_format: "This file format can't be streamed live.",
  codec_failed: "Streaming failed for this file's codec.",
  capacity: "Server is at streaming capacity. Try again shortly.",
  not_ready: "Not enough data buffered yet — wait a moment.",
  no_torrent: "Torrent isn't ready yet.",
  file_not_found: "File not found in torrent.",
  invalid_path: "Invalid filename.",
};

export const STREAM_STARTING = "Starting stream…";

export function streamDeclinedMessage(reason: string | undefined): string {
  return (reason && STREAM_REASONS[reason]) || "Couldn't start the stream.";
}

export function isAppleBrowser(vendor: string = navigator.vendor): boolean {
  return !!vendor && vendor.indexOf("Apple") > -1;
}
