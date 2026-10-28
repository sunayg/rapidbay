# Settings Page and Vue 3 Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/settings` page, written in Vue 3 + Vite + TypeScript, that edits RapidBay's settings from the browser and saves them to disk so they survive restarts.

**Architecture:** A per-field schema (`settings_schema.py`) validates values and describes them to the UI. A JSON store (`settings_store.py`) saves them next to the library file and applies them to the plain `settings` module at startup and on save. A small FastAPI router exposes them behind the existing `authorize` dependency. The Vue app is built in a Docker stage and served by FastAPI under `/v2/`, with `/settings` as its entry page.

**Tech Stack:** Python 3.12 / FastAPI / pytest / ruff / basedpyright (`ci.sh`); Vue 3, Vite, TypeScript, Vitest, @vue/test-utils, jsdom.

**Spec:** `docs/superpowers/specs/2026-10-28-settings-page-design.md`

## Global Constraints

- Precedence is saved > environment > built-in default. Reset removes the saved value; Clear stores `""` (or JSON `null` for nullable numbers) as an override.
- Settings stay plain module attributes on `app/settings.py`; tests use `monkeypatch.setattr(settings, ...)`.
- The settings file is `os.path.join(os.path.dirname(settings.LIBRARY_PATH), "settings.json")`, not `DATA_DIR`.
- Not editable on the page: `DATA_DIR`, `OUTPUT_DIR`, `DOWNLOAD_DIR`, `FILELIST_DIR`, `TORRENTS_DIR`, `CACHE_DIR`, `LOGFILE`, `FRONTEND_DIR`, `KODI_ADDON_DIR`, `LIBRARY_PATH`, `INCOMPLETE_POSTFIX`, `LOG_POSTFIX`, `OPENAPI_HOST`.
- `VIDEO_CONVERSION_PARAMS` is never free text: codec dropdown (`libx264`, `libx265`, `copy`) plus preset dropdown (`ultrafast` … `slow`); the server builds the string.
- Hosts must be `http`/`https` URLs with a hostname. A host change clears the paired API key unless a new key is supplied in the same save.
- `AAC_BITRATE` must match `^\d+k?$`. Secrets are never in any response or error message.
- `TORRENT_LISTENING_PORT` and `DHT_ROUTERS` are restart-needed. Limits apply to torrents added after the change.
- The Vite project lives in top-level `frontend/`, never under `app/` (the `./app:/app` mount hides it). Vite `base` is `/v2/`.
- All 165 existing backend tests must keep passing; `./ci.sh` must pass (basedpyright, ruff, pytest).

## Review Focus

1. A corrupt, wrong-typed, or half-valid `settings.json` must not stop startup; valid keys still apply (Task 2).
2. Host with trailing slash or surrounding spaces, or an empty host string, must not produce `//api/v1` or a request to `None` (Task 1).
3. List textareas with blank lines, CRLF, duplicates, or padding spaces behave like clean lists (Task 1, Task 6).
4. A password with a space, `;`, or non-ASCII characters must either work as a cookie after saving or be rejected with a message, never lock the saver out (Task 4).
5. Two browser tabs saving different categories must not overwrite each other, and an unchanged restart-needed field must not show "pending restart" (Task 2, Task 4).

---

### Task 1: Settings schema and validation

**Files:**
- Create: `app/settings_schema.py`
- Test: `tests/test_settings_schema.py`

**Interfaces:**
- Produces:
  - `class ValidationError(Exception)` with `.message: str`
  - `@dataclass(frozen=True) class Field`: `key, category, kind, label, help="", secret=False, restart_needed=False, nullable=False, min=None, max=None`
  - `CATEGORIES: list[tuple[str, str]]` (id, label), in order: `search`, `torrents`, `streaming`, `conversion`, `subtitles` ("Subtitles and metadata"), `trending`, `general`
  - `FIELDS: dict[str, Field]` keyed by setting name
  - `coerce(field: Field, wire: Any) -> Any` — wire (JSON) value to the Python type `settings.py` uses; raises `ValidationError`
  - `to_wire(field: Field, value: Any) -> Any` — Python value to wire value (lists of strings; DHT as `"host:port"`; `codec_preset` as `{"codec", "preset"}` or `None` when the string is not one the dropdowns can produce)
  - `build_conversion_params(codec: str, preset: str | None) -> str`

- [ ] **Step 1: Write failing tests** in `tests/test_settings_schema.py`:
  - `test_every_editable_setting_has_a_field`: `FIELDS` has exactly these 35 keys — Search: `JACKETT_HOST, JACKETT_API_KEY, PROWLARR_HOST, PROWLARR_API_KEY, MOVE_RESULTS_TO_BOTTOM_CONTAINING_STRINGS`; Torrents: `TORRENT_LISTENING_PORT, DHT_ROUTERS, MAX_TORRENT_AGE_HOURS, TORRENT_DOWNLOAD_LIMIT, TORRENT_UPLOAD_LIMIT, SUPPORTED_EXTENSIONS, MAX_OUTPUT_FILE_AGE`; Streaming: `HLS_STREAMING, HLS_SEGMENT_DURATION, HLS_START_THRESHOLD, MAX_PARALLEL_HLS_STREAMS, HLS_STALL_TIMEOUT, HLS_VIEWER_TIMEOUT, HLS_PREFETCH_BYTES`; Conversion: `CONVERT_VIDEO, VIDEO_CONVERSION_PARAMS, AAC_BITRATE, AAC_CHANNELS, MAX_PARALLEL_CONVERSIONS, VIDEO_EXTENSIONS`; Subtitles: `SUBTITLE_LANGUAGES, OPENSUBTITLES_USERNAME, OPENSUBTITLES_PASSWORD, TMDB_API_KEY`; Trending: `EXCLUDE_TRACKERS_FROM_TRENDING, EXCLUDE_CATEGORIES_FROM_TRENDING, TRENDING_TITLE_BLOCKLIST, TRENDING_BLOCK_NON_LATIN_TITLES`; General: `AUTO_PLAY_NEXT_FILE, PASSWORD`. Also assert every key exists as an attribute of the `settings` module and the restart-needed set is `{TORRENT_LISTENING_PORT, DHT_ROUTERS}` and the secret set is `{JACKETT_API_KEY, PROWLARR_API_KEY, OPENSUBTITLES_PASSWORD, TMDB_API_KEY, PASSWORD}`.
  - `test_host_must_be_http_url`: `coerce(PROWLARR_HOST, "ftp://x")`, `"javascript:1"`, `"http://"`, `"nohost"` raise; `"  http://prowlarr:9696/  "` returns `"http://prowlarr:9696"`; `""` returns `""` (cleared).
  - `test_aac_bitrate`: `"256k"` and `"192"` pass; `"256k; rm"`, `"-1k"`, `"k"` raise.
  - `test_conversion_params_built_server_side`: `coerce(VIDEO_CONVERSION_PARAMS, {"codec": "libx264", "preset": "ultrafast"}) == "libx264 -preset ultrafast"`; `{"codec": "copy"}` gives `"copy"`; `{"codec": "libx264; evil", "preset": "ultrafast"}`, `{"codec": "libx264", "preset": "-i /etc/passwd"}`, and a plain string `"libx264 -i /etc/passwd"` all raise.
  - `test_to_wire_conversion_custom_env_value_is_none`: `to_wire(VIDEO_CONVERSION_PARAMS, "libx264 -crf 18")` is `None`; `"libx264 -preset ultrafast"` gives `{"codec": "libx264", "preset": "ultrafast"}`.
  - `test_lists_are_cleaned`: `coerce(SUBTITLE_LANGUAGES, [" en ", "", "de", "en"]) == ["en", "de"]`; `coerce(EXCLUDE_CATEGORIES_FROM_TRENDING, ["5000", "x"])` raises naming `"x"`; `coerce(DHT_ROUTERS, ["router.example.com:6881"]) == [("router.example.com", 6881)]` and `"nohostport"` or `"h:99999"` raise.
  - `test_blocklist_limits`: invalid regex `"("` raises naming the item; an entry of 201 characters raises; 51 entries raise; `r"\bcam\b"` passes.
  - `test_ints_and_ranges`: `TORRENT_LISTENING_PORT` accepts `None` and 1–65535 only; `TORRENT_DOWNLOAD_LIMIT` accepts `-1` and up, rejects `-2`; `AAC_CHANNELS` 1–8; bool fields reject `"yes"` and `1`.
  - `test_errors_never_contain_secret`: `coerce(PASSWORD, "bad value;")` raises and `"bad value;"` is not in `.message`. `PASSWORD` must be 1–128 printable ASCII characters excluding space, `;`, `,`, `"`, `\` (so it round-trips as a cookie); `""` means cleared and is allowed. Apply the same exclusion rule only to `PASSWORD`.

- [ ] **Step 2: Run** `python -m pytest tests/test_settings_schema.py -v` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement `app/settings_schema.py`** with the interface above. One `FIELDS` table; kinds such as `bool`, `int`, `str`, `url`, `bitrate`, `str_list`, `int_list`, `host_port_list`, `regex_list`, `codec_preset`. Sensible numeric minimums: counts/durations ≥ 1, limits ≥ -1, `HLS_*` byte values ≥ 1. Error messages name the offending item but never echo a `secret` field's value.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git add app/settings_schema.py tests/test_settings_schema.py && git commit -m "Add settings schema and validation"`

---

### Task 2: Settings store and startup wiring

**Files:**
- Create: `app/settings_store.py`
- Modify: `app/settings.py` (record defaults and env values; coerce `PASSWORD`; apply saved values at the end)
- Test: `tests/test_settings_store.py`

**Interfaces:**
- Consumes: `settings_schema` (Task 1).
- Produces (all import `settings` lazily inside functions):
  - `settings_path() -> str`
  - `load_saved(path: str | None = None) -> dict[str, Any]` — wire values from the file; never raises; logs and skips unreadable files, unknown keys, and invalid values
  - `apply_saved(mod: types.ModuleType) -> None` — startup: for each valid saved key, `setattr(mod, key, coerce(...))`
  - `class SettingsValidationError(Exception)` with `.errors: dict[str, str]`
  - `save_category(category: str, wire_values: dict[str, Any]) -> list[str]` — validates every field first, rejects all on any error, writes atomically (copies the old file to `settings.json.bak`), applies live, returns the changed keys
  - `reset_field(key: str) -> list[str]`, `clear_field(key: str) -> list[str]` — same return
  - `describe_all() -> dict` — `{"categories": [{"id","label"}], "fields": [{"key","category","kind","label","help","secret","restart_needed","nullable","min","max","default","value","source","is_set","pending_restart"}]}`; for secret fields `value` is `None` and `is_set` says whether a non-empty value is in effect; `source` is `"saved" | "env" | "default"`
- `app/settings.py` gains, defined before the env loop and underscore-prefixed so the loop ignores them: `_DEFAULTS` (deep copy of every public setting's default) and, filled inside the loop, `_ENV_VALUES: dict[str, Any]`.

- [ ] **Step 1: Write failing tests** in `tests/test_settings_store.py` using a fixture that points `settings.LIBRARY_PATH` at `tmp_path/library.json` and restores changed attributes:
  - `test_save_applies_live_and_persists`: `save_category("streaming", {"HLS_SEGMENT_DURATION": 4})` returns `["HLS_SEGMENT_DURATION"]`, `settings.HLS_SEGMENT_DURATION == 4`, and `json.load` of the file contains `4`.
  - `test_startup_applies_saved_over_env`: with `_ENV_VALUES`/attribute set to an env value and a file saying otherwise, `apply_saved(settings)` leaves the saved value; `describe_all()` reports `source == "saved"`.
  - `test_reset_falls_back_to_env_then_default`: reset with an env value present restores it and `source == "env"`; with none restores `_DEFAULTS` value and `source == "default"`.
  - `test_clear_overrides_env`: `clear_field("PASSWORD")` with an env password sets `settings.PASSWORD == ""` and a restart reads `""` from the file.
  - `test_corrupt_file_does_not_fail_startup`: file contains `{not json` → `load_saved()` returns `{}`; file with `{"values": {"HLS_SEGMENT_DURATION": "x", "NOPE": 1, "AAC_CHANNELS": 6}}` applies only `AAC_CHANNELS`.
  - `test_invalid_field_rejects_whole_category`: `save_category("conversion", {"AAC_CHANNELS": 6, "AAC_BITRATE": "bad;"})` raises `SettingsValidationError` with `errors == {"AAC_BITRATE": ...}`, the file is unchanged, and `settings.AAC_CHANNELS` is unchanged.
  - `test_backup_and_atomic_write`: second save leaves `settings.json.bak` with the first content and no `*.tmp` files left.
  - `test_secret_blank_keeps_current`: `save_category("subtitles", {"TMDB_API_KEY": ""})` and `{"TMDB_API_KEY": None}` keep the existing value; `describe_all()` never contains the key's value anywhere (`json.dumps(...)` has no occurrence of it).
  - `test_host_change_clears_paired_key`: with `PROWLARR_HOST="http://a"`, key `"k1"`; `save_category("search", {"PROWLARR_HOST": "http://b"})` makes `settings.PROWLARR_API_KEY == ""` (stored as an explicit `""` override so an env key is cleared too); supplying `"PROWLARR_API_KEY": "k2"` in the same save keeps `"k2"`; saving the same host does not clear the key. Same for Jackett.
  - `test_restart_needed_not_applied_live`: saving `TORRENT_LISTENING_PORT=7000` leaves `settings.TORRENT_LISTENING_PORT` unchanged; `describe_all()` shows `pending_restart` true for it; saving a value equal to the running one shows false.
  - `test_categories_do_not_clobber_each_other`: save `streaming`, then `conversion` from a stale view; both values are in the file.
  - `test_password_env_is_string`: importing `settings` with `PASSWORD=1234` in the environment (via `importlib.reload` under `monkeypatch.setenv`) gives `settings.PASSWORD == "1234"`.
- [ ] **Step 2: Run** `python -m pytest tests/test_settings_store.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement `app/settings_store.py` and edit `app/settings.py`.** File format `{"version": 1, "values": {KEY: wire_value}}`. In `settings.py`: add `_DEFAULTS` before the env loop; record env-parsed values into `_ENV_VALUES` inside it; after the loop `if PASSWORD is not None: PASSWORD = str(PASSWORD)`; at the very bottom `import sys; import settings_store; settings_store.apply_saved(sys.modules[__name__])` (stores must tolerate being imported while `settings` is only just defined). Restart-needed keys are written to the file but not `setattr`-ed at runtime; at startup `apply_saved` does apply them. After a live change of `*_HOST` keys call `common.clear_memoized("prowlarr")` / `("jackett")` (Task 3).
- [ ] **Step 4: Run** the new tests plus `python -m pytest tests -q` — Expected: all PASS.
- [ ] **Step 5: Commit** `git add app/settings.py app/settings_store.py tests/test_settings_store.py && git commit -m "Add persistent settings store"`

---

### Task 3: Make runtime consumers read settings live

**Files:**
- Modify: `app/prowlarr.py:14-15` and its uses (lines ~53, 54, 76, 84, 176), `app/jackett.py:14-15` and its uses (lines ~28, 54), `app/common.py` (`_get_trending_title_blocklist_re`, `memoize`)
- Test: `tests/test_live_settings.py`; update any existing tests that reference `prowlarr.API_PATH/API_KEY` or `jackett.API_PATH/API_KEY` (find with grep)

**Interfaces:**
- Produces: `common.clear_memoized(module_name: str) -> int` (deletes cached entries whose key's first element is `module_name`; returns how many); `prowlarr._api_path() -> str`, `prowlarr._api_key() -> str`, `jackett._api_path() -> str`, `jackett._api_key() -> str`, each reading `settings` at call time.

- [ ] **Step 1: Write failing tests**:
  - `test_prowlarr_uses_current_host_and_key`: set `settings.PROWLARR_HOST="http://x:1"`, `PROWLARR_API_KEY="abc"`; `_api_path() == "http://x:1/api/v1"`, `_api_key() == "abc"`; change both and assert the new values (no import-time copy). Same for jackett (`/api/v2.0`).
  - `test_blocklist_regex_recompiles_when_list_changes`: set `TRENDING_TITLE_BLOCKLIST=["cam"]`, check a title matches via `should_drop_from_trending`; change it to `["hdts"]` and check `"cam"` no longer matches and `"hdts"` does; empty list means no match.
  - `test_clear_memoized_only_clears_that_module`: point `settings.CACHE_DIR` at `tmp_path`; memoize two functions defined in modules named differently (set `__module__`), fill both, `clear_memoized("a")` returns 1 and leaves the other cached.
- [ ] **Step 2: Run** `python -m pytest tests/test_live_settings.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement.** Replace the module constants with the `_api_path`/`_api_key` functions and update every use. Cache the compiled blocklist keyed by `tuple(settings.TRENDING_TITLE_BLOCKLIST)`. Implement `clear_memoized` by opening `diskcache.Cache(settings.CACHE_DIR)` and deleting matching keys.
- [ ] **Step 4: Run** `python -m pytest tests -q` — Expected: all PASS.
- [ ] **Step 5: Commit** `git add app tests && git commit -m "Read indexer and blocklist settings at call time"`

---

### Task 4: Settings API

**Files:**
- Create: `app/settings_api.py` (an `APIRouter`)
- Modify: `app/app.py` (include the router before the catch-all route at ~line 1494)
- Test: `tests/test_settings_api.py`

**Interfaces:**
- Consumes: `settings_store.describe_all/save_category/reset_field/clear_field`, `app.authorize`.
- Produces routes, all guarded by `Depends(authorize)`:
  - `GET /api/settings` → `describe_all()`
  - `PUT /api/settings/{category}` body `{"values": {...}}` → 200 `describe_all()`; unknown category 404; validation failure 422 `{"errors": {key: message}}`
  - `POST /api/settings/{key}/reset` and `POST /api/settings/{key}/clear` → 200 `describe_all()`; unknown key 404; `clear` on a non-clearable kind (bool, int without `nullable`, lists) 422
  - Whenever `PASSWORD` is among the changed keys and the new value is non-empty, the response sets cookie `password` to it (`response.set_cookie(key="password", value=new)`), the same way `login()` does at `app/app.py:551`.

- [ ] **Step 1: Write failing tests** with FastAPI `TestClient` and the store fixture from Task 2:
  - `test_get_requires_password_when_set`: with `settings.PASSWORD="pw"`, no cookie → 404; cookie `password=pw` → 200; with no password set → 200.
  - `test_put_saves_and_returns_description` and `test_put_invalid_returns_422_without_secret`: send `{"values": {"PASSWORD": "bad;pw"}}`, expect 422 and `"bad;pw"` not in `response.text`.
  - `test_password_change_keeps_saver_logged_in`: authenticated as `old`; `PUT /api/settings/general {"values": {"PASSWORD": "new"}}` → response header `set-cookie` contains `password=new`; the next `GET /api/settings` with cookie `new` → 200 and with `old` → 404.
  - `test_password_round_trips_as_cookie`: for `"pässword"` (rejected by schema) and `"p4ss-w0rd_!"` (accepted) assert the rejected one returns 422 and the accepted one authenticates on the next request using the cookie the response set.
  - `test_clear_password_opens_access`: `POST /api/settings/PASSWORD/clear` → later requests with no cookie → 200.
  - `test_responses_never_contain_secrets`: set a TMDB key, call GET, PUT and 422 paths, assert the key string is absent from every response body.
- [ ] **Step 2: Run** `python -m pytest tests/test_settings_api.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement** the router and include it in `app/app.py` before the catch-all. Translate `SettingsValidationError` to 422.
- [ ] **Step 4: Run** `python -m pytest tests -q` and `./ci.sh` — Expected: PASS.
- [ ] **Step 5: Commit** `git add app tests && git commit -m "Add settings API"`

---

### Task 5: Serve the Vue app

**Files:**
- Modify: `app/settings.py` (add `FRONTEND_V2_DIR` in the path section: `_frontend_v2_dir = os.getenv("FRONTEND_V2_DIR", "./frontend/dist")`, public `FRONTEND_V2_DIR`), `app/app.py`
- Test: `tests/test_frontend_v2.py`

**Interfaces:**
- Produces routes registered before the catch-all: `GET /settings` (serves `index.html` from `FRONTEND_V2_DIR` when authorized, else the existing `login.html` from `FRONTEND_DIR`), `GET /v2/{path:path}` (static files from `FRONTEND_V2_DIR` via `_resolve_within`; `index.html` and `""` are gated like `/settings`; missing directory or file → 404).

- [ ] **Step 1: Write failing tests**: with `settings.FRONTEND_V2_DIR` pointed at a `tmp_path` holding `index.html` and `assets/a.js`:
  - `/settings` returns the v2 index when no password is set; with a password and no cookie it returns the old `login.html`; with the cookie, the v2 index.
  - `/v2/assets/a.js` is served; `/v2/%2e%2e/%2e%2e/etc/passwd` and `/v2//etc/passwd` return 404 (path traversal, as in `tests/test_path_traversal.py`).
  - `/v2/index.html` is gated like `/settings`.
  - With the directory missing, `/settings` returns 404 and the old catch-all still serves `/`.
- [ ] **Step 2: Run** `python -m pytest tests/test_frontend_v2.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement** routes next to the catch-all, reusing `_resolve_within`, `_send_from_directory`, and the cookie check in `frontend()`.
- [ ] **Step 4: Run** `python -m pytest tests -q` — Expected: PASS.
- [ ] **Step 5: Commit** `git add app tests && git commit -m "Serve the Vue frontend under /v2 and /settings"`

---

### Task 6: Vue 3 settings page

**Files (all new, under `frontend/`):**
- `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts` (`base: '/v2/'`; dev server proxies `/api` to `http://localhost:5000`; Vitest with `jsdom`), `index.html`, `.gitignore` (`node_modules`, `dist`)
- `src/main.ts`, `src/App.vue`, `src/types.ts`, `src/api.ts`, `src/style.css` (dark theme matching `app/frontend/style.css` colours)
- `src/components/CategoryNav.vue`, `SettingField.vue`, `SettingsPage.vue`
- Tests beside sources: `src/api.test.ts`, `src/components/SettingField.test.ts`, `src/components/SettingsPage.test.ts`

**Interfaces:**
- Produces `src/api.ts`: `getSettings(): Promise<SettingsPayload>`, `saveCategory(category: string, values: Record<string, unknown>): Promise<SaveResult>` (`{ok: true, payload}` or `{ok: false, errors: Record<string,string>}`), `resetField(key)`, `clearField(key)`, all returning the new `SettingsPayload`. Every call: on HTTP 404 from the API do `window.location.assign('/')` (the auth failure signal); if the response has an `x-set-cookie` header, write `password=<value>` to `document.cookie` with `path=/`.
- `SettingField` props `{field, modelValue, error?}`, emits `update:modelValue`, `reset`, `clear`. Rendering by `kind`: `bool` checkbox; `int` number input; `str`/`url`/`bitrate` text; secret fields as `type=password`, empty by default with a "set" / "not set" badge and placeholder "leave blank to keep"; list kinds as one-per-line textarea (split on `\r?\n`, trimmed, blanks dropped before sending); `codec_preset` as two dropdowns (preset hidden for `copy`), with a "custom value from environment" note when `value` is `null`. Shows a source badge (saved/env/default), a restart-needed note, a pending-restart badge, and Reset (shown when `source === "saved"`) and Clear buttons (secret and nullable/string kinds).
- `SettingsPage` holds the category list on the left and the selected category's fields on the right, with one Save button per category that sends only that category's changed fields (secrets only when typed).

- [ ] **Step 1: Scaffold** the Vite project (Vue + TS template files written by hand; pin versions in `package.json`: `vue@^3.5`, `vite@^6`, `@vitejs/plugin-vue`, `typescript`, `vue-tsc`, `vitest`, `@vue/test-utils`, `jsdom`), run `npm install`, and confirm `npm run build` produces `frontend/dist/index.html` with assets under `/v2/`. Scripts: `dev`, `build` (`vue-tsc --noEmit && vite build`), `test` (`vitest run`).
- [ ] **Step 2: Write failing tests**:
  - `api.test.ts`: a 404 response calls `window.location.assign` with `"/"`; a 422 yields `{ok: false, errors}`; an `x-set-cookie: password=new; Path=/` header results in `document.cookie` containing `password=new`.
  - `SettingField.test.ts`: a secret field renders `input[type=password]` with an empty value and "set" badge, and the page never shows a secret value; a textarea value `"en\r\n\r\n de \n"` emits `["en","de"]`; `codec_preset` with `copy` hides the preset select and emits `{codec:"copy"}`; `source: "saved"` shows Reset, `"default"` does not; `pending_restart: true` shows the badge.
  - `SettingsPage.test.ts`: clicking a category shows its fields and hides the others; Save in `streaming` calls `saveCategory("streaming", …)` with only changed keys and no keys from other categories; a 422 result renders each message beside its field and keeps the typed values; leaving a secret blank omits it from the payload.
- [ ] **Step 3: Run** `npm test` in `frontend/` — Expected: FAIL.
- [ ] **Step 4: Implement** the files per the interfaces above, in the existing dark style, usable on a phone width and with visible focus styles for keyboard/remote use.
- [ ] **Step 5: Run** `npm test && npm run build` — Expected: all tests PASS and build succeeds.
- [ ] **Step 6: Commit** `git add frontend && git commit -m "Add Vue 3 settings page"`

---

### Task 7: Docker wiring, entry link, docs, end-to-end check

**Files:**
- Modify: `Dockerfile`, `docker-compose.yml`, `docker-compose.local.yml`, `.dockerignore` (create if missing: `node_modules`, `frontend/dist`), `app/frontend/index.html` (a "Settings" link as a full-page `<a href="/settings">` beside History / Community Searches / Favorites), `README.md` (settings page, precedence, recovery by deleting `settings.json`, numeric `PASSWORD` behaviour change)

- [ ] **Step 1: Dockerfile.** Add a first stage `FROM node:22-alpine AS frontend-build` that copies `frontend/`, runs `npm ci && npm run build`; in the runtime stage `COPY --from=frontend-build /frontend/dist /frontend-v2` and add `FRONTEND_V2_DIR=/frontend-v2` to the existing `ENV` line (outside `/app`, so the bind mount cannot hide it).
- [ ] **Step 2: Compose files.** Confirm both compose files build from the Dockerfile (they then get the stage and the env var automatically); if either uses a prebuilt image, switch it to `build: .` for local use. Make sure the settings file lands in the mounted data volume (`LIBRARY_PATH` directory is `./data` in local compose, already so).
- [ ] **Step 3: Old UI link and README.**
- [ ] **Step 4: Run** `./ci.sh` and `cd frontend && npm test` — Expected: PASS.
- [ ] **Step 5: End-to-end check** with `docker compose -f docker-compose.local.yml --env-file .env --env-file .env.vpn up -d --build` and `RAPIDBAY_PORT=5050`, using the browser pane at `http://localhost:5050/settings`:
  - Change `HLS_SEGMENT_DURATION`, restart the rapidbay container (`docker compose … restart rapidbay`), reload: the value is still in effect and the badge says "saved".
  - Remove `PROWLARR_HOST` via Clear then set it again with the key in the same save: a search from the home screen works without restarting.
  - Set a password in General: the page stays usable without a login prompt; a private window gets the login page; Clear the password afterwards.
  - Change `TORRENT_LISTENING_PORT`: the page shows "pending restart" and the running port does not change until restart.
  - Confirm `docker exec` of the saved file shows no API key in any browser-visible response (check Network tab payloads).
- [ ] **Step 6: Commit** `git add -A` for the files above only, then `git commit -m "Build and serve the Vue settings page in Docker"`.
