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
