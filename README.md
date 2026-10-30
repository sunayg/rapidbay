# RapidBay

RapidBay is a self-hosted video service and torrent client that makes playing videos from torrents as easy as:

1. Opening the web app on a phone, laptop, tablet or smart TV.
2. Searching for content.
3. Selecting the video file you want.
4. Pressing play. It starts while the file is still downloading and converting.
5. Watching on the device, or casting to AppleTV/Chromecast.

This repository is a fork of [hauxir/rapidbay](https://github.com/hauxir/rapidbay). It keeps the Python backend and the MIT license, and changes how the app looks, streams and is configured. See [What is different in this fork](#what-is-different-in-this-fork).

## Features

-   Uses [Jackett](https://github.com/Jackett/Jackett) and/or [Prowlarr](https://github.com/Prowlarr/Prowlarr) as a search backend.
-   Pick the individual video file you want to play and the system takes care of the rest to make it streamable.
-   Plays while it converts: the video is encoded on the fly into several quality levels and the player switches between them to match your connection speed.
-   Automatic download of subtitles, converted for all browsers, Chromecast and AppleTV.
-   Converts audio that browsers don't support to AAC.
-   Settings page: change almost every option from the browser, no restart needed for most.
-   Home screen with this week's worldwide trending series and movies, your watch history and favorites.
-   Works with a TV remote, including Android TV and Google TV.
-   Registers as a handler for any magnet link.
-   Cleans up disk space automatically.
-   Kodi support.

## What is different in this fork

-   **New web UI.** The whole frontend is rewritten in Vue 3, TypeScript and Vite (`frontend/`), with a new dark design. Keyboard and TV-remote navigation, resume, favorites, search history and Chromecast are kept. It has unit tests (Vitest) and browser tests (Playwright).
-   **Adaptive-bitrate streaming.** One ffmpeg process encodes 1080p, 720p, 480p and 360p (never above the source) as HLS, and the player picks a level from the measured connection speed. A quality menu pins one. See [Adaptive streaming](#adaptive-streaming).
-   **Settings page** at `/settings`: 35 options in seven categories, saved to `settings.json`, applied live where possible. See [Settings page](#settings-page).
-   **Trending from TMDB.** The home rails show this week's worldwide trending titles when a TMDB key is set. The empty-search feed is now called "Latest releases".
-   **Rich search is the only mode,** and a download can be cancelled from its screen.
-   **A local stack with a VPN.** `docker-compose.local.yml` runs RapidBay and Prowlarr behind an ExpressVPN tunnel (via [gluetun](https://github.com/qdm12/gluetun)), so searches and torrent traffic both leave through the VPN. See [Running the local stack](#running-the-local-stack).
-   **Hardware-encoding hooks.** The image includes the Intel VAAPI driver and the local stack maps `/dev/dri`. It is used only when the GPU supports bitrate-capped encoding; otherwise encoding is software.

## Setting up a search backend

RapidBay requires a torrent indexer for searching. You can use [Jackett](https://github.com/Jackett/Jackett), [Prowlarr](https://github.com/Prowlarr/Prowlarr), or both at the same time (results are merged and deduplicated).

### Jackett

See [how to set Jackett up with Docker](https://github.com/Jackett/Jackett#installation-using-docker). The [Jackett compose example](docker-compose.example.with.jackett.yml) shows how to connect it to RapidBay.

### Prowlarr

See the [Prowlarr docs](https://wiki.servarr.com/prowlarr/installation). The [Prowlarr compose example](docker-compose.example.with.prowlarr.yml) shows how to connect it to RapidBay.

## Running

There is no published image for this fork, so build it from this repository.

### Running the local stack

`docker-compose.local.yml` starts RapidBay and Prowlarr behind an ExpressVPN tunnel.

1. Copy `.env.example` to `.env` and `.env.vpn.example` to `.env.vpn`.
2. In `.env.vpn`, set `OPENVPN_USER` and `OPENVPN_PASSWORD` to your ExpressVPN **manual-configuration** credentials (not your login email and password), and optionally `SERVER_COUNTRIES`.
3. In `.env`, set `TMDB_API_KEY` if you want posters and the trending rails.
4. Start it:

```bash
docker compose --env-file .env --env-file .env.vpn -f docker-compose.local.yml up -d --build
```

RapidBay is at <http://localhost:5050> (change it with `RAPIDBAY_PORT`) and Prowlarr at <http://localhost:9696>. After Prowlarr's first start, copy its API key (Settings > General) into `PROWLARR_API_KEY` in `.env.vpn` and run the command again. The `.env` files stay out of git.

Without a VPN, `docker-compose.yml` runs RapidBay alone on port 5000.

### With Docker

```bash
docker build -t rapidbay .

# Using Jackett
docker run -p 5000:5000 -e JACKETT_HOST="http://your.jackett.host" -e JACKETT_API_KEY="YourAPIKey" rapidbay

# Using Prowlarr
docker run -p 5000:5000 -e PROWLARR_HOST="http://your.prowlarr.host" -e PROWLARR_API_KEY="YourAPIKey" rapidbay
```

### Without Docker

**System dependencies:**

```bash
# Ubuntu/Debian
sudo apt install python3 python3-venv ffmpeg mediainfo nginx nodejs npm

# macOS
brew install python ffmpeg mediainfo nginx node
```

**Optional:** install [alass](https://github.com/kaegi/alass/releases) for subtitle synchronization.

**Install and build:**

```bash
# Python dependencies (uv is recommended)
uv sync
# or: python3 -m venv .venv && source .venv/bin/activate && pip install .

# The web UI
cd frontend && npm ci && npm run build && cd ..
```

**Run the app:**

```bash
export JACKETT_HOST="http://your.jackett.host"
export JACKETT_API_KEY="YourAPIKey"
# export PROWLARR_HOST="http://your.prowlarr.host"
# export PROWLARR_API_KEY="YourAPIKey"

cd app
uvicorn app:app --host 0.0.0.0 --port 5000 --workers 1 --timeout-keep-alive 900
```

The app is at http://localhost:5000. It serves the built UI from `./frontend/dist`; point `FRONTEND_DIR` elsewhere to change that.

## Settings page

Open `/settings` (or the Settings button in the home screen's header) to change settings from the browser. Changes are saved to `settings.json` next to the library file (`LIBRARY_PATH`), so mount that directory as a volume to keep them across container rebuilds.

A saved value beats the environment variable, which beats the built-in default. "Reset" removes the saved value; "Clear" saves an empty value that overrides the environment. Listening port and DHT routers need a restart; download and upload limits apply to torrents added afterwards. Storage paths stay environment-only.

If `PASSWORD` is set, the page uses it. If it is not, anyone who can reach the server can open the page, and can set a password. To recover from a lockout, delete `settings.json`. A numeric `PASSWORD` from the environment (such as `1234`) now works; before it could never match.

## Adaptive streaming

Playback starts from the first encoded segments, before the download or conversion has finished. One ffmpeg process decodes the file once and encodes every quality level (1080p, 720p, 480p and 360p by default, never above the source size) as HLS. The player picks a level from the measured connection speed, and the quality menu in the player lets you pin one. The encode starts by itself when a download finishes, so nobody has to be watching, and a viewer who opens the file later joins it. When the whole file has been encoded, the top level is copied into the MP4 that Kodi and the rest of the app use. Only a file the streaming encode cannot take (an unusual container, or a codec ffmpeg rejects) falls back to the old full conversion.

- **Quality levels:** edit them in Settings, under Streaming.
- **Hardware encoding:** `HLS_ENCODER=auto` (the default) tries VAAPI when `/dev/dri/renderD128` exists and a bitrate-capped test encode works, and falls back to software x264 otherwise. `HLS_ENCODER=software` or `vaapi` forces one. The local compose file maps `/dev/dri` into the container. Some Intel iGPUs only offer constant-quality VAAPI encoding, which cannot honour the bitrates, so they use software encoding. The VAAPI path has only been unit-tested, not run on a GPU that supports it.
- **Speed:** each stream must encode faster than real time, and every quality level adds CPU. With software encoding, drop the highest levels in Settings, or set `HLS_X264_PRESET` to `superfast`, if playback stalls. `MAX_PARALLEL_HLS_STREAMS` limits concurrent streams.
- **Resuming late in a file:** the encode starts at the beginning, so resuming far into a file waits until the encoder reaches that point. The player shows how far it has got and offers to start from the beginning.

## Subtitles

You'll need a VIP account at OpenSubtitles.org for it to work:

```
-e OPENSUBTITLES_USERNAME=someusername -e OPENSUBTITLES_PASSWORD=yourpassword
```

### Configuring which subtitles to download

The default setting downloads English subtitles. Add the env variable `SUBTITLE_LANGUAGES` to get more languages:

```
-e SUBTITLE_LANGUAGES="['en', 'de', 'es']"
```

## Require a password

Add the env variable `PASSWORD` to prompt for a password when opening RapidBay (or set it on the Settings page):

```
-e PASSWORD=YOURPASSWORD
```

## Registering as a handler for any magnet link

-   Go to `https://<RAPIDBAY_HOST>/registerHandler` and it should prompt you to register your running RapidBay instance as the default handler for torrent links on any torrent site.
-   You can also paste a magnet link directly into the search bar to open it.

## Using debrid caching

-   You can speed up downloads by using a torrent cache from Real Debrid and/or TorBox.
-   For Real Debrid, set the env variable `RD_TOKEN` to the one on https://real-debrid.com/apitoken.
-   For TorBox, set the env variable `TB_TOKEN` to your API key from https://torbox.app/settings.
-   If both are set, Real Debrid is tried first and TorBox is used as a fallback.

## Using Kodi as a frontend

The Kodi addon is served at `/app.kodi.py`. Setup steps are in the [upstream wiki](https://github.com/hauxir/rapidbay/wiki/Setting-up-Rapidbay-with-Kodi). They predate this fork, so some details may differ. The addon is not tested here.

## Running RapidBay on a VPS

The [upstream wiki](https://github.com/hauxir/rapidbay/wiki/Setting-RapidBay-up-on-a-VPS-and-tunnel-torrent-traffic-through-NordVPN) describes tunnelling torrent traffic through NordVPN. The local stack above does the same with ExpressVPN and gluetun.

## Developing

```bash
# Backend: type check, lint and tests
./ci.sh

# Frontend (in frontend/): dev server, unit tests, build, browser tests
npm run dev
npm test
npm run build
npm run e2e        # needs the Docker stack running on port 5050
```

See [`frontend/README.md`](frontend/README.md) for how the browser tests work. The Dockerfile builds the frontend into `/frontend`, which the backend serves at `/`. The image must be rebuilt after any change under `frontend/src`.

Design notes and plans are in [`docs/superpowers`](docs/superpowers).

## Responsible use

RapidBay is a general-purpose, self-hosted torrent client and media player. It ships with no content and no list of sources. You are responsible for what you search for, download and stream, and for following the copyright laws and other rules that apply where you live. Only use it for content you have the right to access, such as public-domain, openly licensed or your own media.

## License and credits

MIT, see [LICENSE](LICENSE). RapidBay was created by [Haukur Rosinkranz (hauxir)](https://github.com/hauxir/rapidbay); this fork builds on that work.
