"""Just enough fragmented-MP4 parsing to put a segment's fragments at their place in the file.

ffmpeg's HLS muxer starts every run's fragment times (tfdt) at 0, whatever segment the run starts at.
A player that trusts a fragment's tfdt then puts a segment from the middle of the film at its start;
cast from the middle, a Chromecast plays the sound but never shows a picture. So each segment is moved,
before it is sent, to start at its index times the segment length.
"""

import struct
from typing import Dict, Iterator, Tuple

_CONTAINERS = {b"moov", b"trak", b"mdia", b"moof", b"traf"}


def _boxes(data: bytes, start: int, end: int) -> Iterator[Tuple[bytes, int, int]]:
    """(type, payload start, box end) of each box between start and end."""
    offset = start
    while offset + 8 <= end:
        size, kind = struct.unpack_from(">I4s", data, offset)
        header = 8
        if size == 1:
            if offset + 16 > end:
                return
            size = struct.unpack_from(">Q", data, offset + 8)[0]
            header = 16
        elif size == 0:
            size = end - offset
        if size < header or offset + size > end:
            return
        yield kind, offset + header, offset + size
        offset += size


def _walk(data: bytes, start: int, end: int) -> Iterator[Tuple[bytes, int, int]]:
    for kind, payload, box_end in _boxes(data, start, end):
        yield kind, payload, box_end
        if kind in _CONTAINERS:
            yield from _walk(data, payload, box_end)


def track_timescales(init: bytes) -> Dict[int, int]:
    """Track id -> media timescale, read from an init segment's moov."""
    timescales: Dict[int, int] = {}
    for kind, payload, end in _boxes(init, 0, len(init)):
        if kind != b"moov":
            continue
        for trak, trak_payload, trak_end in _boxes(init, payload, end):
            if trak != b"trak":
                continue
            track_id = timescale = None
            for box, box_payload, box_end in _walk(init, trak_payload, trak_end):
                version = init[box_payload] if box_payload < box_end else 0
                if box == b"tkhd":
                    track_id = struct.unpack_from(">I", init, box_payload + (20 if version == 1 else 12))[0]
                elif box == b"mdhd":
                    timescale = struct.unpack_from(">I", init, box_payload + (20 if version == 1 else 12))[0]
            if track_id is not None and timescale:
                timescales[track_id] = timescale
    return timescales


def place_segment(path: str, timescales: Dict[int, int], index: int, segment_seconds: int) -> None:
    """Shift each track's fragment times in the segment at `path` so it starts at segment `index`.

    A run's own times are whole segments short of the file's (it began at a segment boundary), give or
    take an audio frame, so the shift is the whole number of segments nearest to the gap. A segment
    already in place is left as it is.
    """
    with open(path, "r+b") as f:
        data = f.read()
        track_id = None
        shifts: Dict[int, int] = {}  # by track, from its first fragment; later ones in the segment move as far
        for kind, payload, _end in _walk(data, 0, len(data)):
            if kind == b"tfhd":
                track_id = struct.unpack_from(">I", data, payload + 4)[0]
            elif kind == b"tfdt" and track_id in timescales:
                version = data[payload]
                field = ">Q" if version == 1 else ">I"
                current = struct.unpack_from(field, data, payload + 4)[0]
                if track_id not in shifts:
                    step = segment_seconds * timescales[track_id]
                    shifts[track_id] = round((index * step - current) / step) * step
                shift = shifts[track_id]
                moved = current + shift
                if shift and 0 <= moved < (1 << (64 if version == 1 else 32)):
                    f.seek(payload + 4)
                    f.write(struct.pack(field, moved))
