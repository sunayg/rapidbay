import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSettings, saveCategory } from "./api";

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("api", () => {
  const assign = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("location", { assign });
    document.cookie = "password=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    assign.mockReset();
  });

  it("sends the person to / when the server answers 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(404, {})));
    await expect(getSettings()).rejects.toThrow();
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("returns field errors for a 422", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(422, { errors: { AAC_BITRATE: "bad" } })));
    expect(await saveCategory("conversion", { AAC_BITRATE: "x" })).toEqual({ ok: false, errors: { AAC_BITRATE: "bad" } });
  });

  it("stores the cookie from x-set-cookie", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(respond(200, { categories: [], fields: [] }, { "x-set-cookie": "password=new; Path=/" })),
    );
    await getSettings();
    expect(document.cookie).toContain("password=new");
  });
});

import { clearPending, get, post, postJSON, routeTimeout, subscribe, isAbortError } from "./api";

describe("generic helpers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("get parses JSON and sends credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, { a: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await get("/api/x")).toEqual({ a: 1 });
    expect(fetchMock.mock.calls[0][1].credentials).toBe("same-origin");
  });

  it("get rejects on server errors and 404 sends the person to /", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(500, {})));
    await expect(get("/api/x")).rejects.toThrow("500");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(404, {})));
    await expect(get("/api/x")).rejects.toThrow();
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("post is form-encoded and postJSON is JSON", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(respond(200, {})));
    vi.stubGlobal("fetch", fetchMock);
    await post("/api/p", { a: "1 2", b: true });
    expect((fetchMock.mock.calls[0][1].body as URLSearchParams).toString()).toBe("a=1+2&b=true");
    await postJSON("/api/j", { k: [1] });
    expect(fetchMock.mock.calls[1][1].headers["Content-Type"]).toBe("application/json");
    expect(fetchMock.mock.calls[1][1].body).toBe('{"k":[1]}');
  });

  it("clearPending aborts requests that are still running", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      ),
    );
    const pending = get("/api/slow");
    clearPending();
    const error = await pending.catch((e) => e);
    expect(isAbortError(error)).toBe(true);
  });

  it("routeTimeout keeps one timer and clearPending cancels it", () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    routeTimeout(first, 100);
    routeTimeout(second, 100);
    vi.advanceTimersByTime(100);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
    const third = vi.fn();
    routeTimeout(third, 100);
    clearPending();
    vi.advanceTimersByTime(200);
    expect(third).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("subscribe delivers events, closes on done and falls back on error", () => {
    const instances: FakeSource[] = [];
    class FakeSource {
      onmessage: ((e: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();
      constructor(public url: string) {
        instances.push(this);
      }
    }
    vi.stubGlobal("EventSource", FakeSource);
    const callback = vi.fn();
    const fallback = vi.fn();
    const source = subscribe("/api/events", callback, fallback) as unknown as FakeSource;
    source.onmessage!({ data: JSON.stringify({ progress: 1 }) });
    expect(callback).toHaveBeenCalledWith({ progress: 1 });
    expect(source.close).not.toHaveBeenCalled();
    source.onmessage!({ data: JSON.stringify({ done: true }) });
    expect(source.close).toHaveBeenCalled();
    source.onerror!();
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("subscribe falls back immediately without EventSource", () => {
    vi.stubGlobal("EventSource", undefined);
    const fallback = vi.fn();
    expect(subscribe("/x", vi.fn(), fallback)).toBeNull();
    expect(fallback).toHaveBeenCalled();
  });
});
