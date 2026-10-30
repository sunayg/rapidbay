import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { field } from "./fixtures";
import SettingField from "./SettingField.vue";

describe("SettingField", () => {
  it("renders secrets masked, empty and with a set badge", () => {
    const w = mount(SettingField, { props: { field: field({ secret: true, is_set: true, kind: "str" }), modelValue: "" } });
    const input = w.find("input");
    expect(input.attributes("type")).toBe("password");
    expect((input.element as HTMLInputElement).value).toBe("");
    expect(w.text()).toContain("set");
  });

  it("splits list text on lines, trimming and dropping blanks", async () => {
    const w = mount(SettingField, { props: { field: field({ kind: "str_list" }), modelValue: [] } });
    await w.find("textarea").setValue("en\r\n\r\n de \n");
    expect(w.emitted("update:modelValue")!.at(-1)).toEqual([["en", "de"]]);
  });

  it("shows Reset only for saved values and the pending restart badge", () => {
    const saved = mount(SettingField, { props: { field: field({ source: "saved", pending_restart: true }), modelValue: "a" } });
    expect(saved.text()).toContain("Reset");
    expect(saved.text()).toContain("pending restart");
    const dflt = mount(SettingField, { props: { field: field({ source: "default" }), modelValue: "a" } });
    expect(dflt.text()).not.toContain("Reset");
  });
});
