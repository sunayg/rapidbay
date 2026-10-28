import type { FieldInfo } from "../types";

export function field(over: Partial<FieldInfo>): FieldInfo {
  return {
    key: "X",
    category: "general",
    kind: "str",
    label: "X",
    help: "",
    secret: false,
    restart_needed: false,
    nullable: false,
    min: null,
    max: null,
    default: null,
    value: null,
    is_set: null,
    source: "default",
    pending_restart: false,
    ...over,
  };
}
