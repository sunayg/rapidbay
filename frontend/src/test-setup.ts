// Newer Node versions define a global localStorage getter that returns
// undefined without --localstorage-file and hides jsdom's. Provide a plain
// in-memory one so tests behave the same everywhere.
class MemoryStorage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }
  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, name, { value: storage, configurable: true, writable: true });
  Object.defineProperty(window, name, { value: storage, configurable: true, writable: true });
}

// jsdom does not implement media playback; its stubs log "not implemented".
// Tests that care install their own fake element behaviour.
const mediaProto = (globalThis as unknown as { HTMLMediaElement?: { prototype: Record<string, unknown> } }).HTMLMediaElement?.prototype;
if (mediaProto) {
  mediaProto.play = function () {
    return Promise.resolve();
  };
  mediaProto.pause = function () {};
  mediaProto.load = function () {};
}
