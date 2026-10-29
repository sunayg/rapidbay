// Test doubles for the player: a controllable HTMLMediaElement and a fake
// hls.js. Test-only; not imported by the app.
import { vi } from "vitest";

export class FakeTrack extends EventTarget {
  mode: TextTrackMode = "disabled";
  cues: unknown[] | null = null;
  constructor(
    public language: string,
    public kind: string = "subtitles",
    public label: string = "",
    public id: string = "",
  ) {
    super();
  }
}

export class FakeTrackList extends EventTarget {
  items: FakeTrack[] = [];
  get length(): number {
    return this.items.length;
  }
  [index: number]: FakeTrack;
  add(track: FakeTrack): void {
    this.items.push(track);
    (this as unknown as Record<number, FakeTrack>)[this.items.length - 1] = track;
    const event = new Event("addtrack") as Event & { track: FakeTrack };
    event.track = track;
    this.dispatchEvent(event);
  }
}

export interface MediaState {
  currentTime: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  volume: number;
  muted: boolean;
  textTracks: FakeTrackList;
  playCalls: number;
  pauseCalls: number;
}

const states = new WeakMap<object, MediaState>();

export function mediaState(el: Element): MediaState {
  let state = states.get(el);
  if (!state) {
    state = {
      currentTime: 0,
      duration: NaN,
      paused: true,
      ended: false,
      volume: 1,
      muted: false,
      textTracks: new FakeTrackList(),
      playCalls: 0,
      pauseCalls: 0,
    };
    states.set(el, state);
  }
  return state;
}

const FIELDS = ["currentTime", "duration", "paused", "ended", "volume", "muted", "textTracks"] as const;
const saved: Record<string, PropertyDescriptor | undefined> = {};

export function installFakeMedia(): void {
  const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>;
  for (const field of FIELDS) {
    saved[field] = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, field);
    Object.defineProperty(HTMLMediaElement.prototype, field, {
      configurable: true,
      get(this: HTMLMediaElement) {
        return mediaState(this)[field];
      },
      set(this: HTMLMediaElement, value: never) {
        (mediaState(this) as unknown as Record<string, unknown>)[field] = value;
      },
    });
  }
  for (const field of ["play", "pause", "load", "canPlayType"]) saved[field] = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, field);
  proto.play = function (this: HTMLMediaElement) {
    const state = mediaState(this);
    state.playCalls++;
    state.paused = false;
    return Promise.resolve();
  };
  proto.pause = function (this: HTMLMediaElement) {
    const state = mediaState(this);
    state.pauseCalls++;
    if (!state.paused) {
      state.paused = true;
      this.dispatchEvent(new Event("pause"));
    }
  };
  proto.load = function () {};
  proto.canPlayType = function () {
    return "";
  };
}

export function restoreFakeMedia(): void {
  for (const [field, descriptor] of Object.entries(saved)) {
    if (descriptor) Object.defineProperty(HTMLMediaElement.prototype, field, descriptor);
  }
}

// ---- fake hls.js -------------------------------------------------------------------

type Listener = (event: string, data: unknown) => void;

export class FakeHls {
  static instances: FakeHls[] = [];
  static supported = true;
  static isSupported(): boolean {
    return FakeHls.supported;
  }
  static Events = { ERROR: "hlsError", LEVEL_UPDATED: "hlsLevelUpdated", MANIFEST_PARSED: "hlsManifestParsed" };
  static ErrorTypes = { NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError", OTHER_ERROR: "otherError" };
  listeners = new Map<string, { fn: Listener; once: boolean }[]>();
  loaded: string[] = [];
  attached: HTMLVideoElement | null = null;
  // Like hls.js, detaching the media resets the element.
  destroy = vi.fn(() => {
    if (this.attached) mediaState(this.attached).currentTime = 0;
  });
  recoverMediaError = vi.fn();
  startLoad = vi.fn();
  constructor(public config: Record<string, unknown>) {
    FakeHls.instances.push(this);
  }
  on(name: string, fn: Listener): void {
    this.listeners.set(name, [...(this.listeners.get(name) || []), { fn, once: false }]);
  }
  once(name: string, fn: Listener): void {
    this.listeners.set(name, [...(this.listeners.get(name) || []), { fn, once: true }]);
  }
  off(name: string, fn: Listener): void {
    this.listeners.set(name, (this.listeners.get(name) || []).filter((l) => l.fn !== fn));
  }
  loadSource(url: string): void {
    this.loaded.push(url);
  }
  attachMedia(el: HTMLVideoElement): void {
    this.attached = el;
  }
  emit(name: string, data: unknown = {}): void {
    const entries = this.listeners.get(name) || [];
    this.listeners.set(name, entries.filter((l) => !l.once));
    for (const entry of entries) entry.fn(name, data);
  }
  static last(): FakeHls {
    return FakeHls.instances[FakeHls.instances.length - 1];
  }
}
