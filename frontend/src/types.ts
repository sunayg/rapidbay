export type Kind =
  | "bool"
  | "int"
  | "str"
  | "url"
  | "bitrate"
  | "str_list"
  | "int_list"
  | "host_port_list"
  | "regex_list";

export interface FieldInfo {
  key: string;
  category: string;
  kind: Kind;
  label: string;
  help: string;
  secret: boolean;
  restart_needed: boolean;
  nullable: boolean;
  min: number | null;
  max: number | null;
  default: unknown;
  value: unknown;
  is_set: boolean | null;
  source: "saved" | "env" | "default";
  pending_restart: boolean;
}

export interface SettingsPayload {
  categories: { id: string; label: string }[];
  fields: FieldInfo[];
}

export type SaveResult =
  | { ok: true; payload: SettingsPayload }
  | { ok: false; errors: Record<string, string> };
