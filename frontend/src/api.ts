import type { SaveResult, SettingsPayload } from "./types";

async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const cookie = response.headers.get("x-set-cookie");
  if (cookie) document.cookie = cookie;
  // The server answers 404 when the password cookie is missing or wrong.
  if (response.status === 404) {
    window.location.assign("/");
    throw new Error("Not authorized");
  }
  return response;
}

async function payloadOrThrow(response: Response): Promise<SettingsPayload> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const errors = (body as { errors?: Record<string, string> }).errors;
    throw new Error(errors ? Object.values(errors).join(", ") : `Request failed (${response.status})`);
  }
  return response.json();
}

export async function getSettings(): Promise<SettingsPayload> {
  return payloadOrThrow(await request("/api/settings"));
}

export async function saveCategory(category: string, values: Record<string, unknown>): Promise<SaveResult> {
  const response = await request(`/api/settings/${encodeURIComponent(category)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
  if (response.status === 422) {
    const body = (await response.json()) as { errors: Record<string, string> };
    return { ok: false, errors: body.errors };
  }
  return { ok: true, payload: await payloadOrThrow(response) };
}

export async function resetField(key: string): Promise<SettingsPayload> {
  return payloadOrThrow(await request(`/api/settings/${encodeURIComponent(key)}/reset`, { method: "POST" }));
}

export async function clearField(key: string): Promise<SettingsPayload> {
  return payloadOrThrow(await request(`/api/settings/${encodeURIComponent(key)}/clear`, { method: "POST" }));
}
