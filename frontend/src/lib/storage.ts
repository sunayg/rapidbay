// localStorage can throw (quota, blocked storage) or hold a value that no
// longer parses; neither should abort a render.

export function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

// Legacy bug: storageRemove called itself through window and never removed anything.
export function storageRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // nothing to clean up when storage is unavailable
  }
}

export function storageKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key !== null) keys.push(key);
    }
  } catch {
    return [];
  }
  return keys;
}

// The fallback decides the expected shape: an array or a plain object.
export function readJSON<T>(key: string, fallback: T): T {
  const raw = storageGet(key);
  if (raw === null) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(fallback)) return Array.isArray(value) ? (value as T) : fallback;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown): boolean {
  return storageSet(key, JSON.stringify(value));
}

export function sessionGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function sessionSet(key: string, value: string): boolean {
  try {
    window.sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function sessionRemove(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}
