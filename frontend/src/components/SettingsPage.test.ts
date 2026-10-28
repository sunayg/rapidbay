import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { SettingsPayload } from "../types";
import { field } from "./fixtures";
import SettingsPage from "./SettingsPage.vue";

vi.mock("../api");

const payload: SettingsPayload = {
  categories: [
    { id: "streaming", label: "Streaming" },
    { id: "subtitles", label: "Subtitles and metadata" },
  ],
  fields: [
    field({ key: "HLS_SEGMENT_DURATION", category: "streaming", kind: "int", label: "Segment", value: 6 }),
    field({ key: "HLS_STALL_TIMEOUT", category: "streaming", kind: "int", label: "Stall", value: 180 }),
    field({ key: "TMDB_API_KEY", category: "subtitles", kind: "str", label: "TMDB", secret: true, is_set: true }),
  ],
};

async function mounted() {
  vi.mocked(api.getSettings).mockResolvedValue(payload);
  const w = mount(SettingsPage);
  await flushPromises();
  return w;
}

describe("SettingsPage", () => {
  beforeEach(() => vi.resetAllMocks());

  it("shows only the selected category", async () => {
    const w = await mounted();
    expect(w.text()).toContain("Segment");
    expect(w.text()).not.toContain("TMDB");
    await w.findAll(".categories button")[1].trigger("click");
    expect(w.text()).toContain("TMDB");
    expect(w.text()).not.toContain("Segment");
  });

  it("saves only edited keys of the current category", async () => {
    const w = await mounted();
    vi.mocked(api.saveCategory).mockResolvedValue({ ok: true, payload });
    await w.find("#field-HLS_SEGMENT_DURATION").setValue("4");
    await w.find("form").trigger("submit");
    expect(api.saveCategory).toHaveBeenCalledWith("streaming", { HLS_SEGMENT_DURATION: 4 });
  });

  it("shows server errors beside fields and keeps typed values", async () => {
    const w = await mounted();
    vi.mocked(api.saveCategory).mockResolvedValue({ ok: false, errors: { HLS_SEGMENT_DURATION: "too small" } });
    await w.find("#field-HLS_SEGMENT_DURATION").setValue("0");
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(w.text()).toContain("too small");
    expect((w.find("#field-HLS_SEGMENT_DURATION").element as HTMLInputElement).value).toBe("0");
  });

  it("leaves a blank secret out of the payload", async () => {
    const w = await mounted();
    vi.mocked(api.saveCategory).mockResolvedValue({ ok: true, payload });
    await w.findAll(".categories button")[1].trigger("click");
    await w.find("#field-TMDB_API_KEY").setValue("");
    await w.find("form").trigger("submit");
    expect(api.saveCategory).toHaveBeenCalledWith("subtitles", {});
  });
});
