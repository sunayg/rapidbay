import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import LoadingSpinner from "./LoadingSpinner.vue";

describe("LoadingSpinner progress bar", () => {
  it("has no bar without progress, and no marker without one", () => {
    expect(mount(LoadingSpinner).find(".spinner-progress").exists()).toBe(false);
    const w = mount(LoadingSpinner, { props: { progress: 20 } });
    expect(w.find(".spinner-progress-bar").attributes("style")).toContain("width: 20%");
    expect(w.find(".spinner-marker").exists()).toBe(false);
  });

  it("marks where playback can begin, and says so until the download gets there", () => {
    const w = mount(LoadingSpinner, { props: { progress: 20, marker: 35, markerLabel: "Playback starts here" } });
    expect(w.find(".spinner-marker").attributes("style")).toContain("left: 35%");
    expect(w.find(".spinner-marker").classes()).not.toContain("reached");
    expect(w.find(".spinner-marker-label").text()).toBe("Playback starts here");
    expect(w.find('[role="progressbar"]').attributes("aria-label")).toBe("Playback starts here at 35%");
  });

  it("shows the marker as reached once the download passes it", async () => {
    const w = mount(LoadingSpinner, { props: { progress: 20, marker: 35, markerLabel: "Playback starts here" } });
    await w.setProps({ progress: 36 });
    expect(w.find(".spinner-marker").classes()).toContain("reached");
    expect(w.find(".spinner-marker-label").classes()).toContain("reached");
  });

  it("keeps the marker on the bar when it is out of range", () => {
    const w = mount(LoadingSpinner, { props: { progress: 5, marker: 140, markerLabel: "x" } });
    expect(w.find(".spinner-marker").attributes("style")).toContain("left: 100%");
  });
});
