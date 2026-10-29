# RapidBay frontend (Vue 3)

Vue 3 + TypeScript + Vite. The new UI is served by the backend under `/next/` (the settings page at
`/settings`) while the legacy app still lives at `/`. The Dockerfile builds it in its first stage, so a
change only shows up in the stack after the image is rebuilt.

## Scripts

Run from `frontend/` after `npm ci` (or `npm install`).

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (proxies `/api` to `localhost:5000`). Good for the home screen; client-side routes only resolve under `/next/`, so for anything else use the Docker stack below. |
| `npm test` | Unit and component tests (Vitest + jsdom). No stack needed. |
| `npm run build` | `vue-tsc --noEmit` (type check) and `vite build` into `dist/`. |
| `npm run e2e` | Playwright end-to-end tests against a running stack (see below). |

Playwright needs its browser once: `npx playwright install chromium`.

## The stack the e2e tests run against

```sh
# repo root; port 5050 is what the tests expect (override with BASE_URL)
RAPIDBAY_PORT=5050 docker compose -f docker-compose.local.yml --env-file .env --env-file .env.vpn up -d --build rapidbay
```

`HLS_STREAMING=True` is needed for the HLS test in `real-backend.spec.ts` (it skips itself otherwise).
After changing anything in `src/`, rebuild with the command above before running `npm run e2e`.

Environment: `BASE_URL` (default `http://localhost:5050`), `RAPIDBAY_CONTAINER` (default `rapidbay-rapidbay-1`).

## E2E specs

`npm run e2e` runs everything; `npx playwright test e2e/<file>` runs one.

| Spec | Backend | Covers |
| --- | --- | --- |
| `smoke`, `home`, `search`, `download` | API mocked with `page.route` (home and the last search test also hit the live indexer, tolerantly) | screens, keyboard focus, flows |
| `player` | API mocked, media are real small VP9 files in `e2e/fixtures` | playback, seek, captions, HLS to MP4 swap, remote keys |
| `real-backend` | **Real**: writes a finished download into the running container (`docker exec`/`docker cp`) and drives the UI against the real file list, status, SSE, `/play/` and HLS master playlist. Skipped when the stack or the container is unreachable. Cleans up after itself. | the backend contract end to end |
| `tv` | mocked | Android TV user agent (`tv-ui` mode) at 1920x1080 and 960x540 @2x, remote keys only (projects `tv-1080`, `tv-540-2x`) |
| `a11y` | mocked | accessible names, visible keyboard focus, WCAG AA text contrast, no sideways scroll at 320 px, reduced motion, landmarks |

Chromium (as shipped by Playwright) has no H.264, so the fixtures are VP9/Opus. The backend does not
transcode finished files, so the codec does not matter to what is being tested.

Failure traces are written to `test-results/` (`npx playwright show-trace <trace.zip>`).

## Full check before a commit

```sh
cd frontend && npm test && npm run build
cd .. && PATH=$PWD/.venv/bin:$PATH ./ci.sh      # Python: types, lint, tests
cd frontend && npm run e2e                       # needs the stack above
```

The GitHub workflow only runs the Python checks today; the frontend gates are run locally.

## Layout

- `src/screens/` one component per route; `src/components/` shared pieces, `components/player/` the player.
- `src/lib/` plain TypeScript: API client, library/history, magnet helpers, `focus.ts` (keyboard, TV remote and media keys).
- `src/style.css` the design tokens (colours, spacing) and shared styles.
