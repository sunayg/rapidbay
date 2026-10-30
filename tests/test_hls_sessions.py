import os

import hls_ladder
import hls_sessions as hs


def _session(duration=20.0, directory="/tmp/x"):
    ladder = hls_ladder.plan_ladder(1280, 720, [720, 480])
    return hs.Session(
        id="s", key="h/f", source="/in.mkv", directory=directory, duration=duration, segment_seconds=6,
        ladder=ladder, src_height=720, has_audio=True, audio_is_aac=False, encoder=hls_ladder.SOFTWARE,
    )


def test_playlist_lists_the_whole_file_up_front_with_a_short_last_segment():
    session = _session(duration=20.0)
    assert session.segment_count == 4
    text = hs.variant_playlist(session, 1)
    assert text.count("#EXTINF") == 4
    assert "#EXTINF:6.000000,\nseg_v1_0000.m4s" in text and "#EXTINF:2.000000,\nseg_v1_0003.m4s" in text
    assert text.rstrip().endswith("#EXT-X-ENDLIST") and "PLAYLIST-TYPE:VOD" in text
    assert '#EXT-X-MAP:URI="init_v1.mp4"' in text


def test_exact_multiple_of_the_segment_length_has_no_empty_tail():
    session = _session(duration=18.0)
    assert session.segment_count == 3
    assert "#EXTINF:0" not in hs.variant_playlist(session, 0)


def test_only_known_file_names_are_served():
    assert hs.parse_segment_request("seg_v2_0013.m4s") == ("seg", 2, 13)
    assert hs.parse_segment_request("init_v0.mp4") == ("init", 0, 0)
    for bad in ("../etc/passwd", "seg_v0_1.m4s", "seg_v0_0001.m4s.tmp", "ffmpeg.log", "rinit2_v0.mp4", "seg_v0_0001.mp4"):
        assert hs.parse_segment_request(bad) is None


def test_progress_only_counts_the_unbroken_run_from_the_start():
    assert hs.encoded_through([], 5) == 4
    assert hs.encoded_through([5, 6, 7, 33, 34], 5) == 7  # 33 and 34 are left over from an earlier run
    assert hs.encoded_through([5, 7], 5) == 5
    assert hs.encoded_through([0, 1, 2], 0) == 2


def test_produced_indexes_ignores_half_written_and_other_files(tmp_path):
    for name in ("seg_v0_0003.m4s", "seg_v0_0004.m4s", "seg_v1_0003.m4s", "seg_v0_0005.m4s.tmp", "init_v0.mp4", "ffmpeg.log"):
        (tmp_path / name).write_text("x")
    assert hs.produced_indexes(str(tmp_path)) == [3, 4]
    assert hs.produced_indexes(str(tmp_path), level=1) == [3]
    assert hs.produced_indexes(str(tmp_path / "missing")) == []


def test_segments_far_behind_the_viewer_are_deleted_and_the_rest_kept(tmp_path):
    manager = hs.SessionManager(str(tmp_path))
    session = _session(duration=600.0, directory=str(tmp_path))
    for i in range(0, 60):
        (tmp_path / hs.segment_name(0, i)).write_text("x")
    (tmp_path / "init_v0.mp4").write_text("x")
    session.requested = 40
    manager._delete_behind(session)
    left = hs.produced_indexes(str(tmp_path))
    assert min(left) == 40 - hs.KEEP_BEHIND and max(left) == 59
    assert (tmp_path / "init_v0.mp4").exists()  # the init segment is never deleted


def test_nothing_is_deleted_near_the_start(tmp_path):
    manager = hs.SessionManager(str(tmp_path))
    session = _session(directory=str(tmp_path))
    for i in range(5):
        (tmp_path / hs.segment_name(0, i)).write_text("x")
    session.requested = 3
    manager._delete_behind(session)
    assert hs.produced_indexes(str(tmp_path)) == [0, 1, 2, 3, 4]


def test_a_stale_request_cannot_move_the_encoder(tmp_path):
    manager = hs.SessionManager(str(tmp_path))
    session = _session(duration=600.0, directory=str(tmp_path))
    session.latest = 33  # the viewer has already moved on to segment 33
    started = []
    manager._start_process = lambda s, i: started.append(i)  # type: ignore[method-assign]
    manager._ensure_encoding(session, 5)  # an old request from before the seek
    assert started == []
    manager._ensure_encoding(session, 34)  # near the newest request: allowed
    assert started == [34]


def test_a_missing_segment_behind_a_running_encoder_triggers_a_restart(tmp_path):
    manager = hs.SessionManager(str(tmp_path))
    session = _session(duration=600.0, directory=str(tmp_path))
    session.start_segment = 10
    for i in range(10, 16):
        (tmp_path / hs.segment_name(0, i)).write_text("x")

    class Alive:
        def poll(self):
            return None

    session.proc = Alive()  # type: ignore[assignment]
    started = []
    manager._start_process = lambda s, i: started.append(i)  # type: ignore[method-assign]
    session.latest = 12
    manager._ensure_encoding(session, 12)  # already encoded, then deleted: this run is past it
    assert started == [12]
    started.clear()
    session.latest = 17
    manager._ensure_encoding(session, 17)  # next up in the running encode: just wait
    assert started == []
    session.latest = 40
    manager._ensure_encoding(session, 40)  # far ahead: restart there
    assert started == [40]


def test_close_removes_the_session_directory(tmp_path):
    manager = hs.SessionManager(str(tmp_path))
    directory = tmp_path / "abc"
    directory.mkdir()
    session = _session(directory=str(directory))
    manager._sessions[session.id] = session
    manager.close(session.id)
    assert not os.path.exists(directory)
    assert manager.get(session.id) is None
