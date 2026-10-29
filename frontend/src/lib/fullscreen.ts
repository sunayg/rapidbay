type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitCancelFullScreen?: () => void };
type FsElement = HTMLElement & { webkitRequestFullscreen?: (flags?: number) => void };

export function isFullscreen(): boolean {
  const doc = document as FsDocument;
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement);
}

// The whole page goes fullscreen (not just the video) so the controls stay.
export function toggleFullscreen(): void {
  const doc = document as FsDocument;
  const root = document.documentElement as FsElement;
  if (!isFullscreen()) {
    if (root.requestFullscreen) void root.requestFullscreen().catch(() => {});
    else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
  } else if (doc.exitFullscreen) {
    void doc.exitFullscreen().catch(() => {});
  } else if (doc.webkitCancelFullScreen) {
    doc.webkitCancelFullScreen();
  }
}
