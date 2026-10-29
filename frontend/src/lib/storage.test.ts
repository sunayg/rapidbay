import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readJSON, storageGet, storageKeys, storageRemove, storageSet, writeJSON } from "./storage";

describe("storage", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("sets, gets and removes", () => {
    expect(storageSet("a", "1")).toBe(true);
    expect(storageGet("a")).toBe("1");
    storageRemove("a");
    expect(storageGet("a")).toBeNull();
  });

  it("lists keys", () => {
    storageSet("a", "1");
    storageSet("b", "2");
    expect(storageKeys().sort()).toEqual(["a", "b"]);
  });

  it("readJSON honours the fallback shape", () => {
    storageSet("arr", "[1,2]");
    storageSet("obj", '{"x":1}');
    expect(readJSON("arr", [])).toEqual([1, 2]);
    expect(readJSON("arr", {})).toEqual({});
    expect(readJSON("obj", {})).toEqual({ x: 1 });
    expect(readJSON("obj", [])).toEqual([]);
    expect(readJSON("missing", ["d"])).toEqual(["d"]);
  });

  it("readJSON survives corrupt values", () => {
    storageSet("bad", "{nope");
    expect(readJSON("bad", [])).toEqual([]);
  });

  it("writeJSON round-trips", () => {
    expect(writeJSON("k", { a: [1] })).toBe(true);
    expect(readJSON("k", {})).toEqual({ a: [1] });
  });

  it("never throws when storage is blocked", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(localStorage, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(storageGet("a")).toBeNull();
    expect(storageSet("a", "1")).toBe(false);
    expect(() => storageRemove("a")).not.toThrow();
    expect(readJSON("a", [])).toEqual([]);
  });
});
