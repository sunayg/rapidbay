# RapidBay

Rapid bay is a self hosted video service/torrent client that makes playing videos from torrents as easy as:

1. Opening the webapp on a phone/laptop/tablet/smartTV.
2. Searching for content.
3. Selecting desired video file.
4. Waiting for Download/Conversion.
5. Playing on the device or cast to AppleTV/Chromecast

## Features:

-   Uses [Jackett](https://github.com/Jackett/Jackett) and/or [Prowlarr](https://github.com/Prowlarr/Prowlarr) as a search backend.
-   Pick individual video files you want to play and the system takes care of the rest to make it streamable.
-   Automatic download of Closed Captions/Subtitles
-   Automatically converts the video file and subtitles to be playable on all browsers/chromecast/appletv
-   Plays while it converts: the video is encoded on the fly into several quality levels and the player switches between them to match your connection speed
-   Automatically converts audio that is unsupported by browsers to AAC
-   Allows registering as a handler for any magnet link
-   Automatically cleans up disk space so you don't need to manage it yourself
-   Kodi support

## Demo:

![](https://user-images.githubusercontent.com/2439255/48429861-44b60b00-e76e-11e8-8bdb-042f125357ce.gif)

## Setting up a search backend:

Rapidbay requires a torrent indexer for searching. You can use [Jackett](https://github.com/Jackett/Jackett), [Prowlarr](https://github.com/Prowlarr/Prowlarr), or both at the same time (results are merged and deduplicated).

### Jackett

Have a look [here](https://github.com/Jackett/Jackett#installation-using-docker) on how to set Jackett up using Docker. There's also a [docker-compose example](https://github.com/hauxir/rapidbay/blob/master/docker-compose.example.with.jackett.yml) showing how to connect rapidbay and Jackett together.

### Prowlarr

See the [Prowlarr docs](https://wiki.servarr.com/prowlarr/installation) for installation instructions. There's a [docker-compose example](https://github.com/hauxir/rapidbay/blob/master/docker-compose.example.with.prowlarr.yml) showing how to connect rapidbay and Prowlarr together.

## Running:

### With Docker (recommended)

```
# Using Jackett
docker run -p 5000:5000 -e JACKETT_HOST="http://your.jackett.host" -e JACKETT_API_KEY="YourAPIKey" hauxir/rapidbay

# Using Prowlarr
docker run -p 5000:5000 -e PROWLARR_HOST="http://your.prowlarr.host" -e PROWLARR_API_KEY="YourAPIKey" hauxir/rapidbay
```

### Without Docker

**System dependencies:**

```bash
# Ubuntu/Debian
sudo apt install python3 python3-venv ffmpeg mediainfo nginx

# macOS
brew install python ffmpeg mediainfo nginx
```

**Optional:** Install [alass](https://github.com/kaegi/alass/releases) for subtitle synchronization.

**Install Python dependencies:**

```bash
# Using uv (recommended)
uv sync

# Or using pip
python3 -m venv .venv
source .venv/bin/activate
pip install .
```

**Run the app:**

```bash
# Set environment variables (Jackett, Prowlarr, or both)
export JACKETT_HOST="http://your.jackett.host"
export JACKETT_API_KEY="YourAPIKey"
# export PROWLARR_HOST="http://your.prowlarr.host"
# export PROWLARR_API_KEY="YourAPIKey"

# Run directly (without nginx)
cd app
uvicorn app:app --host 0.0.0.0 --port 5000 --workers 1 --timeout-keep-alive 900
```

App will be running at http://localhost:5000

## Settings page

Open `/settings` (or the Settings shortcut on the home screen) to change settings from the browser. Changes are saved to `settings.json` next to the library file (`LIBRARY_PATH`), so mount that directory as a volume to keep them across container rebuilds.

A saved value beats the environment variable, which beats the built-in default. "Reset" removes the saved value; "Clear" saves an empty value that overrides the environment. Listening port and DHT routers need a restart; download and upload limits apply to torrents added afterwards. Storage paths stay environment-only.

If `PASSWORD` is set, the page uses it. If it is not, anyone who can reach the server can open the page, and can set a password. To recover from a lockout, delete `settings.json`. A numeric `PASSWORD` from the environment (such as `1234`) now works; before it could never match.

The whole web UI is a Vue 3 + Vite app in `frontend/` (`npm install && npm run dev` for development; the Dockerfile builds it into `/frontend`, which the backend serves at `/`, see `FRONTEND_DIR`). See `frontend/README.md` for tests.

## Subtitles

You'll need a VIP account at OpenSubtitles.org for it to work:
```
-e OPENSUBTITLES_USERNAME=someusername -e OPENSUBTITLES_PASSWORD=yourpassword
```
### Configuring which subtitles to download:

The default setting downloads english subtitles.

Add the env variable SUBTITLE_LANGUAGES to your docker params like so to get more languages:

```
-e SUBTITLE_LANGUAGES="['en', 'de', 'es']"
```

## Require a password:

Add the env variable PASSWORD to your docker params like so to prompt for a password when opening rapidbay:

```
-e PASSWORD=YOURPASSWORD
```

## Registering as a handler for any magnet link:

-   Go to https://\<RAPIDBAY_HOST\>/registerHandler and it should prompt you to register your running RapidBay instance as a default handler for torrent links on any torrent site!
-   You can also copy/paste a magnet link directly into the search bar to open magnet links manually.

## Developing

Requires Docker + docker-compose

```
docker-compose up
```

## Running RapidBay on a VPS

[Setting RapidBay up on a VPS and tunnel torrent traffic through NordVPN](https://github.com/hauxir/rapidbay/wiki/Setting-RapidBay-up-on-a-VPS-and-tunnel-torrent-traffic-through-NordVPN)

## Using Kodi as a frontend

[Setting up Rapidbay with Kodi](https://github.com/hauxir/rapidbay/wiki/Setting-up-Rapidbay-with-Kodi)

## Using debrid caching

-   You can speed up downloads by using a torrent cache from Real Debrid and/or TorBox
-   For Real Debrid, set the env variable RD_TOKEN to the one on https://real-debrid.com/apitoken
-   For TorBox, set the env variable TB_TOKEN to your API key from https://torbox.app/settings
-   If both are set, Real Debrid is tried first and TorBox is used as a fallback

## Adaptive streaming

Playback starts from the first encoded segments, before the download or conversion has finished. One ffmpeg process decodes the file once and encodes every quality level (1080p, 720p, 480p and 360p by default, never above the source size) as HLS. The player picks a level from the measured connection speed, and the quality menu in the player lets you pin one. The encode starts by itself when a download finishes, so nobody has to be watching, and a viewer who opens the file later joins it. When the whole file has been encoded, the top level is copied into the MP4 that Kodi and the rest of the app use. Only a file the streaming encode cannot take (an unusual container, or a codec ffmpeg rejects) falls back to the old full conversion.

- **Quality levels:** edit them in Settings, under Streaming.
- **Hardware encoding:** `HLS_ENCODER=auto` (the default) tries VAAPI when `/dev/dri/renderD128` exists and a bitrate-capped test encode works, and falls back to software x264 otherwise. `HLS_ENCODER=software` or `vaapi` forces one. The local compose file maps `/dev/dri` into the container. Some Intel iGPUs only offer constant-quality VAAPI encoding, which cannot honour the bitrates, so they use software encoding.
- **Speed:** each stream must encode faster than real time, and every quality level adds CPU. With software encoding, drop the highest levels in Settings, or set `HLS_X264_PRESET` to `superfast`, if playback stalls. `MAX_PARALLEL_HLS_STREAMS` limits concurrent streams.
- **Resuming late in a file:** the encode starts at the beginning, so resuming far into a file waits until the encoder reaches that point.

## Responsible use

RapidBay is a general-purpose, self-hosted torrent client and media player. It ships with no content and no list of sources. You are responsible for what you search for, download and stream, and for following the copyright laws and other rules that apply where you live. Only use it for content you have the right to access, such as public-domain, openly licensed or your own media.
