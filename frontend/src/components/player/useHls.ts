// hls.js wiring for early playback: the stream is played while the file is
// still being converted. hls.js is a separate chunk, loaded only for .m3u8 links.
import type HlsType from "hls.js";

export const MAX_HLS_RECOVERIES = 5;

export async function loadHls(): Promise<typeof HlsType> {
  return (await import("hls.js")).default;
}

export interface HlsHandle {
  // Swap the playlist (new subtitles arrived) and keep the position and play state.
  reload(url: string): void;
  destroy(): void;
}

export interface HlsOptions {
  startPosition: number;
  onFatal: () => void;
  // Whether the playlist is still growing; the length is unknown until it is not.
  onLive: (live: boolean) => void;
}

export function playSafely(video: HTMLVideoElement): void {
  try {
    const promise = video.play() as Promise<void> | undefined;
    if (promise && typeof promise.catch === "function") promise.catch(() => {});
  } catch {
    // Autoplay refused; the user presses play.
  }
}

// Resolves to null when hls.js cannot run here (the caller then uses the
// browser's native HLS, or the plain src).
export async function attachHls(video: HTMLVideoElement, url: string, options: HlsOptions): Promise<HlsHandle | null> {
  const Hls = await loadHls();
  if (!Hls.isSupported()) return null;
  const hls = new Hls({
    // Resume through hls.js itself: setting currentTime before the manifest is
    // parsed races its own initial seek (the live edge for EVENT playlists).
    // 0 is an explicit start at the beginning.
    startPosition: options.startPosition > 0 ? options.startPosition : 0,
    maxBufferHole: 0.5,
    nudgeOffset: 0.2,
    nudgeMaxRetry: 10,
    // Subtitles come from EXT-X-MEDIA in the master playlist; skip the
    // embedded CEA-608/708 captions so they do not render alongside.
    enableCEA708Captions: false,
  });
  let dead = false;
  let recoveries = 0;
  const giveUp = () => {
    if (dead) return;
    dead = true;
    hls.destroy();
    options.onFatal();
  };
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (dead || !data.fatal) return;
    console.warn("HLS fatal error:", data.type, data.details);
    recoveries++;
    if (recoveries > MAX_HLS_RECOVERIES) giveUp();
    else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
    else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      // startLoad() only resumes fragment loading; a playlist that never
      // arrived has to be requested again, or playback would hang with no
      // error ever reaching the fallback below.
      if (/^manifest/.test(String(data.details))) hls.loadSource(currentUrl);
      else hls.startLoad();
    }
    else giveUp();
  });
  hls.on(Hls.Events.LEVEL_UPDATED, (_event, data) => {
    options.onLive(!!(data && data.details && data.details.live));
  });
  let currentUrl = url;
  hls.loadSource(url);
  hls.attachMedia(video);
  return {
    reload(newUrl: string) {
      if (dead) return;
      const resumeAt = video.currentTime;
      const wasPlaying = !video.paused && !video.ended;
      hls.once(Hls.Events.MANIFEST_PARSED, () => {
        if (resumeAt > 0) video.currentTime = resumeAt;
        if (wasPlaying) playSafely(video);
      });
      currentUrl = newUrl;
      hls.loadSource(newUrl);
    },
    destroy() {
      if (dead) return;
      dead = true;
      hls.destroy();
    },
  };
}
