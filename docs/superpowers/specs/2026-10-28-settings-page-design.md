# Settings page and Vue 3 frontend pilot — design

Date: 2026-10-28

## Intent and why

RapidBay is configured only through environment variables read once at
startup (`app/settings.py`). Changing anything means editing a compose file
or `docker run` flags and restarting. The owner wants to change settings from
the browser, with changes saved so they survive restarts.

The existing frontend (`app/frontend`: Vue 2.5 x-templates, one ~4,000-line
`app.js`, jQuery, Navigo) is hard to extend and has no tests. The owner
decided to port it to Vue 3. The settings page is the **pilot** screen for
that port: it is the first screen written in Vue 3 + Vite + TypeScript, and
the old screens stay untouched until they are ported one at a time later.

The Python backend stays. A Node rewrite was considered and rejected
(Node libtorrent bindings lack file priorities and piece deadlines that
HLS-while-downloading needs). Angular was considered and declined.

## Goals

- A `/settings` page in the web UI covering **all** settings in
  `app/settings.py` except the excluded ones below.
- Settings are saved to disk and survive restarts and container rebuilds.
- A saved value overrides the environment variable, which overrides the
  built-in default. Each field can be reset (removes the saved value).
- Most changes take effect immediately; settings that cannot are clearly
  marked "restart needed" in the page.
- A new Vue 3 + Vite + TypeScript frontend project that can later absorb the
  other screens, served alongside the old frontend.

## Non-goals

- Porting any existing screen (home, search, player, etc.). Follow-up work,
  one screen at a time, each with tests for keyboard/remote focus movement
  and the HLS-to-MP4 player handover where relevant.
- Changing the Python backend language or the torrent engine.
- A new authentication system. The existing optional `PASSWORD` is reused.
- Editing storage paths (`DATA_DIR`, `OUTPUT_DIR`, `DOWNLOAD_DIR`,
  `FILELIST_DIR`, `TORRENTS_DIR`, `CACHE_DIR`, `LOGFILE`, `FRONTEND_DIR`,
  `KODI_ADDON_DIR`, `LIBRARY_PATH`). They stay environment-only (nginx
  hardcodes `/tmp/output/`, so a changed `OUTPUT_DIR` would split Python and
  nginx).
- Restarting the app or containers from the page.

## Anti-goals (a failure even if it technically works)

- A save that silently does nothing (e.g. enabling Jackett in the UI while
  the search module still uses the startup copy of the host).
- A page that lets any visitor make ffmpeg read or write arbitrary files, or
  that leaks an API key to an address typed into a host field.
- Saving a new `PASSWORD` that logs the saver out with no way back in
  without shell access.
- Putting the new frontend inside `app/`, where the `./app:/app` bind mount
  in `docker-compose.yml` would hide the Docker-built files.

## Decisions made by the owner

1. **Backend stays Python; frontend becomes Vue 3 + Vite + TypeScript**,
   built in a Docker build stage into static files served by the existing
   FastAPI/nginx. No Node at runtime.
2. **Pilot-first migration.** The settings page is the first Vue 3 screen.
3. **Layout: category list on the left, one category's fields on the right,
   a Save button per category** (chosen over one long page with one Save).
   Categories: Search, Torrents, Streaming, Conversion, Subtitles and
   metadata, Trending, General.
4. **Secrets** (API keys, passwords) are shown masked; leaving a secret blank
   keeps the current value. Each field can be reset to its default. Values are
   validated by type; invalid input is rejected with a message.
5. **Persistence:** a JSON file. **Precedence: saved > environment > built-in
   default.**
6. **Apply behaviour:** most settings apply immediately. `TORRENT_LISTENING_PORT`
   and `DHT_ROUTERS` need a restart (the page says so). Download and upload
   limits apply to torrents added after the change.
7. **Access:** the page and its API use the existing password check. With no
   `PASSWORD` set the page is open to anyone who can reach the server. The
   owner accepted that anyone can also set a `PASSWORD` and lock the owner
   out; recovery is deleting the settings file.
8. **Security restrictions (accepted after a review by a second model):**
   - `VIDEO_CONVERSION_PARAMS` is **not** free text. The page offers a codec
     dropdown (at least `libx264`, `libx265`, `copy`) and a preset dropdown
     (`ultrafast` … `slow`); the server builds the string. The stored value
     must still be what `shlex.split` in `app/video_conversion.py` expects.
   - When `PROWLARR_HOST` or `JACKETT_HOST` is changed, the paired API key is
     cleared unless a new key is supplied in the same save. Hosts must be
     `http`/`https` URLs with a hostname.
   - `AAC_BITRATE` is validated as `^\d+k?$`. Secrets are never echoed in
     responses or error messages.
   - Path settings are excluded (see non-goals).

## Constraints discovered in the code (the builder must handle these)

- **Import-time copies.** `app/prowlarr.py:14-15` and `app/jackett.py:14-15`
  copy host and API key into module globals at import. They must be changed to
  read `settings.X` inside the functions, or runtime edits won't work.
  `app/common.py:26-35` compiles `TRENDING_TITLE_BLOCKLIST` once and never
  recompiles; it needs a cache key or reset hook. The `memoize` decorator
  (`app/common.py:103-118`) caches `jackett.search`/`prowlarr.search` on disk
  by arguments only; changing an indexer host should clear that cache.
- Settings are read live at call time for `HLS_*`, `MAX_PARALLEL_*`, `AAC_*`,
  `SUBTITLE_LANGUAGES`, `TMDB_API_KEY`, `OPENSUBTITLES_*`,
  `MOVE_RESULTS_TO_BOTTOM_CONTAINING_STRINGS`, `EXCLUDE_*`,
  `AUTO_PLAY_NEXT_FILE`, `PASSWORD`, `CONVERT_VIDEO`, `MAX_TORRENT_AGE_HOURS`
  (checked by the reviewer; the builder should re-verify before relying on it).
- Settings stay **plain module attributes** on `app/settings.py`; existing
  tests use `monkeypatch.setattr(settings, ...)`.
- **Where to store the file:** next to the library file, i.e.
  `os.path.dirname(settings.LIBRARY_PATH)` (precedent: `app/stats.py:19`),
  not `DATA_DIR`, because `DATA_DIR` is `/tmp` in the Docker image and is not
  persisted. In `docker-compose.yml` that is the mounted `./data`.
- **Auth cookie** is the plaintext password (`app/app.py:551`); the server
  moves `Set-Cookie` into an `x-set-cookie` header (`app/app.py:338-342`) and
  the login page sets `document.cookie` by hand (`app/frontend/login.html`).
  Saving a new `PASSWORD` must return the new cookie and the Vue app must set
  it, otherwise the saver is locked out immediately.
- **Env parsing bug:** `app/settings.py:84-90` `eval()`s env values, so
  `PASSWORD=1234` becomes an int that never matches. Settings.json must use a
  per-field schema (type, validation, secret flag, restart-needed flag,
  group), not that parser. Applying the same schema to env values is
  optional and would be a documented behaviour change.
- **Serving the new frontend.** The old SPA is served by the catch-all route
  (`app/app.py:1494-1505`, GET-only, registered last). Build Vite with
  `base: '/v2/'`, serve `/v2/{path:path}` plus an explicit allow-list of
  page routes (initially `/settings`) before the catch-all, and apply the same
  password gate to the new entry HTML as `index.html` gets. Links between old
  and new apps must be full page loads.
- **Docker:** keep the Vite project outside `app/` (a top-level `frontend/`),
  build it in a Docker build stage to a path not shadowed by the
  `./app:/app` mount, and point a new env var (e.g. `FRONTEND_V2_DIR`) at it.
  Add `node_modules` to `.dockerignore`. In the local compose setup users may
  need to build on the host.
- `app/frontend/sw.js` serves cached responses first; hashed asset names make
  that harmless for the new bundle.

## API shape (guidance, builder may refine)

- `GET /api/settings` returns, per setting: key, category, type, current
  effective value (secrets masked), default, source (`saved` / `env` /
  `default`), restart-needed flag, and validation hints.
- `PUT /api/settings/{category}` saves that category's fields, validates all
  of them, and rejects the whole request on any invalid field.
- A way to reset one field to its default (removes the saved value).
- Responses and errors never contain secret values.

## Left to the builder

- Exact file names, schema representation, and how `settings.py` loads the
  saved file at startup.
- How cache clearing on indexer-host change is implemented.
- The Vue 3 project layout, state management, styling (it should look like
  the existing dark UI), and test setup (Vitest for the frontend; pytest for
  the backend).
- Whether to also apply the schema to env-var parsing.
- Exact dropdown contents for conversion codec and preset beyond the minimum
  above.
- Where the "Settings" link appears in the old UI (guess: a shortcut next to
  History / Community Searches / Favorites on the old home screen).

## Calls made by the writer (not yet confirmed by the owner)

These answer the builder-check questions. They are the writer's decisions;
the owner can overturn any of them.

1. **Clearing secrets and turning the password off.** A saved value is an
   override even when it is empty, so the API has an explicit "clear"
   operation that stores `""` for a setting and overrides an environment
   value. "Reset" removes the saved value (falls back to env, then default).
   A blank secret field in a save means "keep current". The host-change rule
   (clear the paired key unless a new one is supplied) applies to the stored
   value only.
2. **Scope.** All settings in `app/settings.py` are on the page except the
   path settings above and these env-only ones: `INCOMPLETE_POSTFIX`,
   `LOG_POSTFIX` (changing them orphans existing files on disk) and
   `OPENAPI_HOST`. `VIDEO_EXTENSIONS`, `SUPPORTED_EXTENSIONS` and
   `MAX_OUTPUT_FILE_AGE` go under Conversion, Conversion and Torrents
   respectively; all `HLS_*` under Streaming; `MAX_TORRENT_AGE_HOURS` under
   Torrents; `AUTO_PLAY_NEXT_FILE` and `PASSWORD` under General.
3. **List-valued settings.** One item per line in a textarea. `DHT_ROUTERS`
   uses `host:port` per line; category exclusions are one integer per line.
   Any invalid item rejects the whole category save with a message naming the
   item. `TRENDING_TITLE_BLOCKLIST` stays a regex list: each entry must
   compile, entries are limited to 200 characters and 50 per list. Residual
   risk: a hostile regex can still cost CPU while the page is open to anyone.
4. **Auth.** The settings API reuses the existing `authorize` dependency
   unchanged, with the existing cookie. The new HTML entry is gated the same
   way `index.html` is (login page when unauthenticated). If an API call
   fails authorization, the Vue app does a full page load of `/`. A password
   change returns the new cookie through the same `x-set-cookie` header
   mechanism the existing code uses, and the Vue app sets `document.cookie`
   from it.
5. **Restart-needed fields.** `GET /api/settings` returns both the saved
   value and the running value, plus a `pending_restart` flag that is true
   when they differ.
6. **Bad settings file.** Startup never fails because of it. An unreadable
   file is logged and ignored (environment and defaults apply) and is left
   in place until the next successful save, which keeps the old file as
   `settings.json.bak`. Unknown or invalid keys are logged and skipped while
   valid keys still apply. Writes are atomic (write a temporary file, then
   rename).
7. **`PASSWORD` from the environment.** Coerce it to a string so
   `PASSWORD=1234` matches. Deployments with a numeric password could never
   log in before, so this cannot break a working setup; mention it in the
   changelog.
8. **Local compose.** `docker-compose.local.yml` gets the same Vite build
   stage and `FRONTEND_V2_DIR` wiring as the main compose file.

## Success looks like

- Changing a setting on `/settings`, then restarting the container, shows the
  saved value still in effect.
- Enabling an indexer from the page makes searches use it without a restart.
- Saving a new password keeps the saver logged in.
- No free-text field reaches an ffmpeg command line, and a host change never
  sends the old key to the new host.
- Existing 165 backend tests still pass, with new tests for the settings
  store, validation, and the restrictions above.
