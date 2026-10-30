"""Seekable on-demand HLS for finished files, in the style of Plex and Jellyfin.

A session lists every segment of the file up front (so the player sees the whole timeline and can
seek anywhere), but encodes only what is asked for. A request for a segment that is not there yet
starts an encode at that point; the encoder then runs a few segments ahead of the viewer, is paused
when it gets too far ahead, and segments well behind the viewer are deleted. Disk use stays at a few
minutes of video instead of the whole ladder.
"""

import contextlib
import math
import os
import re
import shutil
import signal
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from subprocess import DEVNULL, Popen
from typing import Callable, Dict, List

import hls_ladder
import log
import settings
import video_conversion

# Segments the encoder may run past the farthest one asked for before a request restarts it elsewhere.
RESTART_GAP = 4
# Pause the encoder once it is this many segments ahead of the viewer; resume when it is within RESUME_AT.
PAUSE_AHEAD = 30
RESUME_AT = 20
# Keep this many segments behind the viewer, so short rewinds do not trigger a re-encode.
KEEP_BEHIND = 20
# A session nobody has requested anything from for this long is closed.
IDLE_SECONDS = 180
# How long a request waits for an encode to produce its segment.
SEGMENT_WAIT_SECONDS = 45
POLL_SECONDS = 0.1

_SEGMENT_RE = re.compile(r"^seg_v(\d+)_(\d{4,})\.m4s$")
_INIT_RE = re.compile(r"^init_v(\d+)\.mp4$")


class SessionError(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass
class Session:
    id: str
    key: str
    source: str
    directory: str
    duration: float
    segment_seconds: int
    ladder: List[hls_ladder.Rendition]
    src_height: int
    has_audio: bool
    audio_is_aac: bool
    encoder: str
    lock: threading.RLock = field(default_factory=threading.RLock)
    proc: "Popen[bytes] | None" = None
    start_segment: int = 0
    runs: int = 0
    paused: bool = False
    requested: int = 0
    # The segment of the newest request. Only requests near it may move the encoder, so requests
    # left over from an earlier playback position cannot pull it back.
    latest: int = 0
    last_request: float = field(default_factory=time.monotonic)

    @property
    def segment_count(self) -> int:
        return max(1, math.ceil(self.duration / self.segment_seconds))


def segment_name(level: int, index: int) -> str:
    return f"seg_v{level}_{index:04d}.m4s"


def variant_playlist(session: Session, level: int) -> str:
    """The whole file as a finished playlist: the player can seek anywhere in it."""
    lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:7",
        f"#EXT-X-TARGETDURATION:{session.segment_seconds}",
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXT-X-PLAYLIST-TYPE:VOD",
        f'#EXT-X-MAP:URI="init_v{level}.mp4"',
    ]
    remaining = session.duration
    for index in range(session.segment_count):
        length = min(float(session.segment_seconds), remaining)
        remaining -= length
        lines += [f"#EXTINF:{length:.6f},", segment_name(level, index)]
    lines.append("#EXT-X-ENDLIST")
    return "\n".join(lines) + "\n"


def parse_segment_request(name: str) -> tuple[str, int, int] | None:
    """("init"|"seg", level, index) for a file name the session serves, else None."""
    match = _INIT_RE.match(name)
    if match:
        return ("init", int(match.group(1)), 0)
    match = _SEGMENT_RE.match(name)
    if match:
        return ("seg", int(match.group(1)), int(match.group(2)))
    return None


def produced_indexes(directory: str, level: int = 0) -> List[int]:
    """Indexes of the finished segments of one rendition currently on disk."""
    found: List[int] = []
    with contextlib.suppress(OSError):
        for name in os.listdir(directory):
            match = _SEGMENT_RE.match(name)
            if match and int(match.group(1)) == level:
                found.append(int(match.group(2)))
    return sorted(found)


def encoded_through(indexes: List[int], start: int) -> int:
    """Last segment of the unbroken run that begins at `start` (start - 1 when none is there yet).

    Segments left by an earlier run, elsewhere in the file, do not count as this run's progress.
    """
    present = set(indexes)
    last = start - 1
    while last + 1 in present:
        last += 1
    return last


def _probe_duration(source: str) -> float | None:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", source],
            capture_output=True, text=True, timeout=30, check=False,
        ).stdout.strip()
        value = float(out)
    except Exception:
        return None
    return value if value > 0 else None


class SessionManager:
    def __init__(self, root: str) -> None:
        self.root = root
        self._sessions: Dict[str, Session] = {}
        self._lock = threading.Lock()
        self._watcher: threading.Thread | None = None
        self._closing = False

    # -- lifecycle ---------------------------------------------------------------------------

    def create(self, key: str, source: str, start_seconds: float = 0.0) -> Session:
        """The session for a file, made on first use; its encode starts at `start_seconds`, where
        the viewer is about to resume. Raises SessionError(reason) when it cannot be made."""
        with self._lock:
            existing = next((s for s in self._sessions.values() if s.key == key), None)
            if existing:
                existing.last_request = time.monotonic()
                return existing
            self._make_room()
        if not os.path.isfile(source):
            raise SessionError("file_not_found")
        duration = _probe_duration(source)
        size = hls_ladder.probe_video_size(source)
        if duration is None or size is None:
            raise SessionError("unreadable")
        ladder = hls_ladder.plan_ladder(size[0], size[1], settings.HLS_LADDER_HEIGHTS)
        if not ladder:
            raise SessionError("unreadable")
        codecs = video_conversion.audio_codecs(source)
        has_audio = bool(codecs) if codecs is not None else bool(video_conversion.first_audio_format(source))
        audio_is_aac = "aac" in codecs[0] if codecs else False
        session_id = uuid.uuid4().hex
        directory = os.path.join(self.root, session_id)
        os.makedirs(directory, exist_ok=True)
        session = Session(
            id=session_id, key=key, source=source, directory=directory, duration=duration,
            segment_seconds=settings.HLS_SEGMENT_DURATION, ladder=ladder, src_height=size[1],
            has_audio=has_audio, audio_is_aac=audio_is_aac, encoder=hls_ladder.detect_encoder(settings.HLS_ENCODER),
        )
        with self._lock:
            self._sessions[session_id] = session
        with session.lock:
            first = min(session.segment_count - 1, max(0, int(start_seconds // session.segment_seconds)))
            session.requested = first
            session.latest = first
            self._start_process(session, first)
        self._ensure_watcher()
        return session

    def get(self, session_id: str) -> Session | None:
        with self._lock:
            session = self._sessions.get(session_id)
        if session:
            session.last_request = time.monotonic()
        return session

    def close(self, session_id: str) -> None:
        with self._lock:
            session = self._sessions.pop(session_id, None)
        if session is None:
            return
        with session.lock:
            self._stop_process(session)
        shutil.rmtree(session.directory, ignore_errors=True)

    def close_all(self) -> None:
        self._closing = True
        for session_id in list(self._sessions):
            self.close(session_id)

    def _make_room(self) -> None:
        """Caller holds self._lock. Drop the longest-idle session if the limit is reached."""
        if len(self._sessions) < max(1, settings.MAX_PARALLEL_HLS_STREAMS):
            return
        oldest = min(self._sessions.values(), key=lambda s: s.last_request)
        if time.monotonic() - oldest.last_request < 30:
            raise SessionError("capacity")
        self._sessions.pop(oldest.id, None)
        threading.Thread(target=self._discard, args=(oldest,), daemon=True).start()

    def _discard(self, session: Session) -> None:
        with session.lock:
            self._stop_process(session)
        shutil.rmtree(session.directory, ignore_errors=True)

    # -- encoder control ---------------------------------------------------------------------

    def _audio_args(self, session: Session) -> List[str] | None:
        if not session.has_audio:
            return None
        if session.audio_is_aac:
            return ["-c:a", "copy", "-bsf:a", "aac_adtstoasc"]
        return ["-c:a", "aac", "-b:a", settings.AAC_BITRATE, "-ac", str(settings.AAC_CHANNELS), "-bsf:a", "aac_adtstoasc"]

    def _stop_process(self, session: Session) -> None:
        proc = session.proc
        session.proc = None
        session.paused = False
        if proc is None or proc.poll() is not None:
            return
        with contextlib.suppress(OSError):
            proc.send_signal(signal.SIGCONT)  # a stopped process only sees SIGTERM once resumed
        with contextlib.suppress(OSError):
            proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            with contextlib.suppress(OSError):
                proc.kill()
            with contextlib.suppress(Exception):
                proc.wait(timeout=5)

    def _start_process(self, session: Session, index: int) -> None:
        """Caller holds session.lock."""
        self._stop_process(session)
        session.runs += 1
        # The first run's init segments are the ones the playlists point at; later runs write theirs aside.
        init_prefix = "init" if session.runs == 1 else f"rinit{session.runs}"
        args = hls_ladder.build_session_args(
            session.ladder, session.src_height, session.encoder, settings.HLS_X264_PRESET,
            session.segment_seconds, session.source, self._audio_args(session), index, init_prefix,
        )
        with open(os.path.join(session.directory, "ffmpeg.log"), "a") as stderr_log:
            session.proc = Popen(args, stdin=DEVNULL, stdout=DEVNULL, stderr=stderr_log, cwd=session.directory)
        session.start_segment = index
        log.debug(f"HLS session {session.id[:8]}: encoding from segment {index} ({session.encoder})")

    def _ensure_encoding(self, session: Session, index: int) -> None:
        """Make sure an encoder is, or soon will be, producing segment `index`."""
        with session.lock:
            if abs(index - session.latest) > RESTART_GAP:
                return  # a newer request has moved on; this one is stale
            proc = session.proc
            alive = proc is not None and proc.poll() is None
            if alive:
                last = encoded_through(produced_indexes(session.directory), session.start_segment)
                # Coming up (or next) in this run: wait for it. Already past, or too far ahead: restart there.
                if last < index <= last + 1 + RESTART_GAP:
                    if session.paused:
                        self._resume(session)
                    return
            self._start_process(session, index)

    def _resume(self, session: Session) -> None:
        if session.proc and session.paused:
            with contextlib.suppress(OSError):
                session.proc.send_signal(signal.SIGCONT)
        session.paused = False

    # -- serving -----------------------------------------------------------------------------

    def file_for(self, session: Session, name: str, cancelled: Callable[[], bool] = lambda: False) -> str | None:
        """Path of an init or media segment, waiting for the encoder if it has not got there yet."""
        parsed = parse_segment_request(name)
        if parsed is None or parsed[1] >= len(session.ladder):
            return None
        kind, _level, index = parsed
        path = os.path.join(session.directory, name)
        session.last_request = time.monotonic()
        if kind == "seg":
            if index >= session.segment_count:
                return None
            session.requested = index
            session.latest = index
        if not os.path.isfile(path):
            if kind == "seg":
                self._ensure_encoding(session, index)
            elif session.runs == 0:
                self._ensure_encoding(session, 0)  # nothing has started yet: the init comes with the first run
        retried = False
        deadline = time.monotonic() + SEGMENT_WAIT_SECONDS
        while time.monotonic() < deadline and not cancelled():
            if os.path.isfile(path):
                return path
            proc = session.proc
            if proc is not None and proc.poll() not in (None, 0):
                return None  # the encoder failed
            if kind == "seg" and abs(index - session.latest) > RESTART_GAP:
                return None  # the viewer has moved on
            if kind == "seg" and (proc is None or proc.poll() is not None):
                # It finished or was replaced without producing this one: start over here, once.
                if retried:
                    return None
                retried = True
                self._ensure_encoding(session, index)
            time.sleep(POLL_SECONDS)
        return path if os.path.isfile(path) else None

    # -- housekeeping ------------------------------------------------------------------------

    def _ensure_watcher(self) -> None:
        with self._lock:
            if self._watcher and self._watcher.is_alive():
                return
            self._watcher = threading.Thread(target=self._watch, daemon=True)
            self._watcher.start()

    def _watch(self) -> None:
        while not self._closing:
            time.sleep(1.0)
            with self._lock:
                sessions = list(self._sessions.values())
            if not sessions:
                continue
            for session in sessions:
                try:
                    self._tend(session)
                except Exception as e:  # keep the watcher alive whatever one session does
                    log.debug(f"HLS session housekeeping failed: {e}")

    def _tend(self, session: Session) -> None:
        if time.monotonic() - session.last_request > IDLE_SECONDS:
            self.close(session.id)
            return
        with session.lock:
            indexes = produced_indexes(session.directory)
            if session.proc is not None and session.proc.poll() is None and indexes:
                ahead = encoded_through(indexes, session.start_segment) - session.requested
                if ahead > PAUSE_AHEAD and not session.paused:
                    with contextlib.suppress(OSError):
                        session.proc.send_signal(signal.SIGSTOP)
                    session.paused = True
                elif ahead <= RESUME_AT and session.paused:
                    self._resume(session)
        self._delete_behind(session)

    def _delete_behind(self, session: Session) -> None:
        cutoff = session.requested - KEEP_BEHIND
        if cutoff <= 0:
            return
        with contextlib.suppress(OSError):
            for name in os.listdir(session.directory):
                match = _SEGMENT_RE.match(name)
                if match and int(match.group(2)) < cutoff:
                    with contextlib.suppress(OSError):
                        os.remove(os.path.join(session.directory, name))
