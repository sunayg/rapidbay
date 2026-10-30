"""Adaptive-bitrate HLS ladder: which renditions to encode and the ffmpeg command for them.

One ffmpeg process decodes the source once, splits it into several renditions
and writes one fMP4 media playlist per rendition. Every rendition cuts
segments at the same timestamps, so a player can switch between them at any
segment boundary.
"""

import json
import os
import subprocess
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Sequence

# Video bitrate (kbit/s) for the usual heights; other heights are interpolated.
_BITRATE_BY_HEIGHT = {2160: 14000, 1440: 8000, 1080: 5000, 720: 2800, 480: 1400, 360: 800, 240: 400}
MIN_VIDEO_KBPS = 300
# The encoder may overshoot its target; the master playlist advertises the peak.
MAXRATE_FACTOR = 1.07
AUDIO_KBPS = 128

SOFTWARE = "libx264"
VAAPI = "h264_vaapi"
VAAPI_DEVICE = "/dev/dri/renderD128"
# High profile, level 4.1: covers every rung up to 1080p60 and is what CODECS advertises.
H264_CODEC_TAG = "avc1.640029"
AAC_CODEC_TAG = "mp4a.40.2"


@dataclass(frozen=True)
class Rendition:
    index: int
    width: int
    height: int
    video_kbps: int

    @property
    def maxrate_kbps(self) -> int:
        return int(self.video_kbps * MAXRATE_FACTOR)

    @property
    def bufsize_kbps(self) -> int:
        return self.video_kbps * 2

    @property
    def bandwidth(self) -> int:
        """Peak bits per second, video plus audio, as EXT-X-STREAM-INF wants it."""
        return (self.maxrate_kbps + AUDIO_KBPS) * 1000

    @property
    def playlist_suffix(self) -> str:
        return f"_v{self.index}.m3u8"


@dataclass(frozen=True)
class AudioTrack:
    """One audio stream of the source. `index` counts audio streams only (0 is the first)."""

    index: int
    codec: str
    language: str  # as tagged in the file, usually a 3-letter code ("" when untagged)
    title: str


def probe_audio_tracks(filepath: str) -> List[AudioTrack] | None:
    """The audio streams of a file, or None when ffprobe could not read it."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error", "-select_streams", "a",
                "-show_entries", "stream=codec_name:stream_tags=language,title", "-of", "json", filepath,
            ],
            capture_output=True, timeout=20, check=False,
        )
        if result.returncode != 0:
            return None
        streams: List[Dict[str, Any]] = json.loads(result.stdout or b"{}").get("streams", [])
    except Exception:
        return None
    tracks: List[AudioTrack] = []
    for position, stream in enumerate(streams):
        tags: Dict[str, Any] = stream.get("tags") or {}
        language = str(tags.get("language") or "")
        tracks.append(
            AudioTrack(position, str(stream.get("codec_name") or ""), "" if language == "und" else language, str(tags.get("title") or ""))
        )
    return tracks


def bitrate_for_height(height: int) -> int:
    """Video kbit/s for a height: the table value, or interpolated by pixel area between its neighbours."""
    if height in _BITRATE_BY_HEIGHT:
        return _BITRATE_BY_HEIGHT[height]
    heights = sorted(_BITRATE_BY_HEIGHT)
    if height < heights[0]:
        return max(MIN_VIDEO_KBPS, int(_BITRATE_BY_HEIGHT[heights[0]] * (height / heights[0]) ** 2))
    if height > heights[-1]:
        return _BITRATE_BY_HEIGHT[heights[-1]]
    lo = max(h for h in heights if h < height)
    hi = min(h for h in heights if h > height)
    share = (height**2 - lo**2) / (hi**2 - lo**2)
    return int(_BITRATE_BY_HEIGHT[lo] + (_BITRATE_BY_HEIGHT[hi] - _BITRATE_BY_HEIGHT[lo]) * share)


def _even(value: float) -> int:
    return max(2, int(round(value / 2.0)) * 2)


def plan_ladder(src_width: int, src_height: int, heights: Sequence[int]) -> List[Rendition]:
    """Renditions to encode, highest first. Never upscales: a source smaller than the
    configured heights gets a single rendition at its own size."""
    wanted = sorted({h for h in heights if h > 0}, reverse=True)
    if src_width <= 0 or src_height <= 0 or not wanted:
        return []
    top = min(src_height, wanted[0])
    rungs = [top] + [h for h in wanted if h < top]
    ladder: List[Rendition] = []
    for index, height in enumerate(rungs):
        width = src_width if height == src_height else _even(src_width * height / src_height)
        ladder.append(Rendition(index, _even(width), _even(height), bitrate_for_height(height)))
    return ladder


def probe_video_size(filepath: str) -> tuple[int, int] | None:
    """Width and height of the first video stream, or None if ffprobe cannot tell."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", filepath],
            capture_output=True,
            timeout=20,
            check=False,
        )
        stream = json.loads(result.stdout or b"{}")["streams"][0]
        width, height = int(stream["width"]), int(stream["height"])
    except Exception:
        return None
    return (width, height) if width > 0 and height > 0 else None


_encoder_cache: dict[str, str] = {}


def detect_encoder(preference: str, device: str = VAAPI_DEVICE) -> str:
    """Pick the H.264 encoder. `preference` is "auto", "software" or "vaapi".

    Hardware is used only if a real test encode with a bitrate cap succeeds: many
    Intel iGPUs expose VAAPI but only support constant-QP, which cannot honour the
    ladder's bitrates. The result is cached for the life of the process.
    """
    if preference == "software":
        return SOFTWARE
    if preference in _encoder_cache:
        return _encoder_cache[preference]
    chosen = SOFTWARE
    if os.path.exists(device) and _vaapi_works(device):
        chosen = VAAPI
    _encoder_cache[preference] = chosen
    return chosen


def reset_encoder_cache() -> None:
    _encoder_cache.clear()


def _vaapi_works(device: str) -> bool:
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-init_hw_device", f"vaapi=va:{device}", "-filter_hw_device", "va",
        "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24:duration=1",
        "-vf", "format=nv12,hwupload",
        "-c:v", VAAPI, "-b:v", "2M", "-maxrate", "2M", "-bufsize", "4M",
        "-f", "null", "-",
    ]
    try:
        return subprocess.run(cmd, capture_output=True, timeout=20, check=False).returncode == 0
    except Exception:
        return False


def filter_graph(ladder: Sequence[Rendition], src_height: int, encoder: str) -> str:
    count = len(ladder)
    if encoder == VAAPI:
        head = "[0:v:0]format=nv12,hwupload"
        scale = "scale_vaapi=w={w}:h={h}"
    else:
        head = "[0:v:0]format=yuv420p"
        scale = "scale={w}:{h}"
    labels = "".join(f"[s{r.index}]" for r in ladder)
    parts = [f"{head},split={count}{labels}" if count > 1 else f"{head}[s0]"]
    for r in ladder:
        if r.height == src_height:
            parts.append(f"[s{r.index}]null[v{r.index}]")
        else:
            parts.append(f"[s{r.index}]" + scale.format(w=r.width, h=r.height) + f"[v{r.index}]")
    return ";".join(parts)


def _variant_token(variant_count: int) -> str:
    """ffmpeg fills %v in the init file name only when there is more than one variant."""
    return "%v" if variant_count > 1 else "0"


def encode_args(
    ladder: Sequence[Rendition],
    encoder: str,
    preset: str,
    segment_seconds: int,
    audio_args: Sequence[str] | None,
) -> List[str]:
    """Codec, rate-control and keyframe options shared by every way of running the ladder."""
    args: List[str] = []
    args += ["-c:v", encoder, "-profile:v", "high"]
    if encoder == SOFTWARE:
        args += ["-preset", preset, "-level", "4.1", "-sc_threshold", "0", "-pix_fmt", "yuv420p"]
    args += ["-force_key_frames", f"expr:gte(t,n_forced*{segment_seconds})"]
    for r in ladder:
        args += [
            f"-b:v:{r.index}", f"{r.video_kbps}k",
            f"-maxrate:v:{r.index}", f"{r.maxrate_kbps}k",
            f"-bufsize:v:{r.index}", f"{r.bufsize_kbps}k",
        ]
    if audio_args is not None:
        args += list(audio_args)
    args += ["-tag:v", "avc1"]
    return args


def audio_media_lines(tracks: Sequence[AudioTrack], first_variant: int, prefix: str, describe: "Callable[[AudioTrack], tuple[str, str]]") -> List[str]:
    """EXT-X-MEDIA lines for the audio tracks. Track k is variant `first_variant + k`.

    `describe` turns a track into (BCP-47 language code, display name).
    """
    lines: List[str] = []
    for track in tracks:
        code, name = describe(track)
        language = f'LANGUAGE="{code}",' if code else ""
        default = "YES" if track.index == 0 else "NO"
        uri = f"{prefix}_v{first_variant + track.index}.m3u8"
        lines.append(f'#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="{name}",{language}DEFAULT={default},AUTOSELECT=YES,URI="{uri}"')
    return lines


def stream_inf_lines(
    ladder: Sequence[Rendition], prefix: str, has_audio: bool, subtitles_group: bool, audio_group: bool = False
) -> List[str]:
    """EXT-X-STREAM-INF entries (tag line plus URI line) for every rendition, best first."""
    lines: List[str] = []
    codecs = f"{H264_CODEC_TAG},{AAC_CODEC_TAG}" if has_audio else H264_CODEC_TAG
    for r in ladder:
        tag = f'#EXT-X-STREAM-INF:BANDWIDTH={r.bandwidth},RESOLUTION={r.width}x{r.height},CODECS="{codecs}"'
        if audio_group:
            tag += ',AUDIO="aud"'
        if subtitles_group:
            tag += ',SUBTITLES="subs"'
        lines += [tag, f"{prefix}{r.playlist_suffix}"]
    return lines


def build_session_args(
    ladder: Sequence[Rendition],
    src_height: int,
    encoder: str,
    preset: str,
    segment_seconds: int,
    source: str,
    audio_args: Sequence[str] | None,
    start_segment: int,
    init_prefix: str,
    audio_tracks: Sequence[AudioTrack] = (),
) -> List[str]:
    """ffmpeg arguments for a seekable session: read `source` by path from `start_segment`.

    Output goes to the working directory as `seg_v{N}_{index:04d}.m4s` with the index and the
    timestamps continuing from the start point, so a restarted encode lands on the same timeline
    as the one it replaced. With more than one audio track, each track is written as an audio-only
    variant after the video ones (so variant `len(ladder) + k` is track k) and the video variants
    carry no audio; with one, the audio is muxed into every video variant. `init_prefix` names the init files (`{init_prefix}_v{N}.mp4`); a
    restart gives them a new name because their edit lists differ, and the first one is kept.
    """
    start = start_segment * segment_seconds
    args: List[str] = ["ffmpeg", "-nostdin", "-v", "error"]
    if encoder == VAAPI:
        args += ["-init_hw_device", f"vaapi=va:{VAAPI_DEVICE}", "-filter_hw_device", "va"]
    if start > 0:
        args += ["-ss", str(start)]
    args += ["-i", source, "-sn", "-filter_complex", filter_graph(ladder, src_height, encoder)]
    for r in ladder:
        args += ["-map", f"[v{r.index}]"]
    separate = audio_args is not None and len(audio_tracks) > 1
    if audio_args is not None:
        if separate:
            for track in audio_tracks:
                args += ["-map", f"0:a:{track.index}"]
        else:
            for _ in ladder:
                args += ["-map", "0:a:0"]
    args += encode_args(ladder, encoder, preset, segment_seconds, audio_args)
    if start > 0:
        # Timestamps restart at 0 after -ss; shift them back so segment N sits at N * seconds.
        args += ["-output_ts_offset", str(start)]
    if separate:
        parts = [f"v:{r.index}" for r in ladder] + [f"a:{k}" for k in range(len(audio_tracks))]
    else:
        parts = [f"v:{r.index},a:{r.index}" if audio_args is not None else f"v:{r.index}" for r in ladder]
    stream_map = " ".join(parts)
    args += [
        "-f", "hls",
        "-hls_segment_type", "fmp4",
        "-hls_time", str(segment_seconds),
        "-hls_list_size", "0",
        "-start_number", str(start_segment),
        "-hls_flags", "temp_file",
        "-hls_fmp4_init_filename", f"{init_prefix}_v{_variant_token(len(parts))}.mp4",
        "-hls_segment_filename", "seg_v%v_%04d.m4s",
        "-var_stream_map", stream_map,
        "ff_v%v.m3u8",
    ]
    return args
