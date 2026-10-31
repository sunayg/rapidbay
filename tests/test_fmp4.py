import struct

import fmp4


def box(kind, payload):
    return struct.pack(">I4s", 8 + len(payload), kind) + payload


def init_segment(tracks):
    """An init segment with one trak per (track id, timescale)."""
    traks = b""
    for track_id, timescale in tracks:
        tkhd = box(b"tkhd", bytes(4) + bytes(8) + struct.pack(">I", track_id) + bytes(68))
        mdhd = box(b"mdhd", bytes(4) + bytes(8) + struct.pack(">I", timescale) + bytes(8))
        traks += box(b"trak", tkhd + box(b"mdia", mdhd))
    return box(b"ftyp", b"iso6") + box(b"moov", box(b"mvhd", bytes(100)) + traks)


def media_segment(fragments):
    """A media segment with one moof per list of (track id, tfdt), each tfdt a version 1 box."""
    out = box(b"styp", b"msdh")
    for trafs in fragments:
        body = box(b"mfhd", bytes(8))
        for track_id, time in trafs:
            tfhd = box(b"tfhd", bytes(4) + struct.pack(">I", track_id))
            tfdt = box(b"tfdt", b"\x01\x00\x00\x00" + struct.pack(">Q", time))
            body += box(b"traf", tfhd + tfdt)
        out += box(b"moof", body) + box(b"mdat", b"\x00" * 16)
    return out


def tfdts(data):
    return [struct.unpack_from(">Q", data, i + 12)[0] for i in range(len(data)) if data[i + 4 : i + 8] == b"tfdt"]


def test_timescales_come_from_each_track_of_the_init():
    assert fmp4.track_timescales(init_segment([(1, 12288), (2, 48000)])) == {1: 12288, 2: 48000}
    assert fmp4.track_timescales(b"ftyp-moov") == {}


def test_a_restarted_runs_segment_moves_to_its_place_in_the_file(tmp_path):
    # Run started at segment 164: its first segment's video starts at 0, its audio a frame early.
    path = tmp_path / "seg.m4s"
    path.write_bytes(media_segment([[(1, 0), (2, 0)]]))
    fmp4.place_segment(str(path), {1: 12288, 2: 48000}, 164, 6)
    assert tfdts(path.read_bytes()) == [164 * 6 * 12288, 164 * 6 * 48000]
    # Its next segment, with audio a few samples off the boundary, moves by the same whole segments.
    path.write_bytes(media_segment([[(1, 6 * 12288), (2, 6 * 48000 - 256)]]))
    fmp4.place_segment(str(path), {1: 12288, 2: 48000}, 165, 6)
    assert tfdts(path.read_bytes()) == [165 * 6 * 12288, 165 * 6 * 48000 - 256]


def test_a_segment_already_in_place_is_left_alone(tmp_path):
    path = tmp_path / "seg.m4s"
    original = media_segment([[(1, 7 * 6 * 12288), (2, 7 * 6 * 48000 - 256)]])
    path.write_bytes(original)
    fmp4.place_segment(str(path), {1: 12288, 2: 48000}, 7, 6)
    assert path.read_bytes() == original


def test_later_fragments_of_a_segment_move_with_the_first(tmp_path):
    # A fragment 5 s in sits nearer the next boundary; it must still move as far as the first one.
    path = tmp_path / "seg.m4s"
    path.write_bytes(media_segment([[(1, 0)], [(1, 5 * 12288)]]))
    fmp4.place_segment(str(path), {1: 12288}, 10, 6)
    assert tfdts(path.read_bytes()) == [60 * 12288, 65 * 12288]


def test_tracks_the_init_does_not_name_and_files_that_are_not_mp4_are_left_alone(tmp_path):
    path = tmp_path / "seg.m4s"
    original = media_segment([[(3, 0)]])
    path.write_bytes(original)
    fmp4.place_segment(str(path), {1: 12288}, 4, 6)
    assert path.read_bytes() == original
    path.write_bytes(b"x")
    fmp4.place_segment(str(path), {1: 12288}, 4, 6)
    assert path.read_bytes() == b"x"
