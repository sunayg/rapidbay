import os

import hls_ladder
import hls_sessions as hs


def _session(duration=20.0, directory="/tmp/x"):
    ladder = hls_ladder.plan_ladder(1280, 720, [720, 480])
    return hs.Session(
        id="s", key="h/f", source="/in.mkv", directory=directory, duration=duration, segment_seconds=6,
        ladder=ladder, src_height=720, has_audio=True, audio_copy=False, encoder=hls_ladder.SOFTWARE,
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


class _FakeStdin:
    def __init__(self) -> None:
        self.data = b""
        self.closed = False

    def write(self, chunk: bytes) -> int:
        self.data += chunk
        return len(chunk)

    def close(self) -> None:
        self.closed = True


class _FakeProc:
    def __init__(self) -> None:
        self.stdin = _FakeStdin()
        self.returncode = None

    def poll(self):
        return self.returncode


def test_the_feeder_sends_only_what_has_arrived_and_finishes_when_the_file_is_whole(tmp_path, monkeypatch):
    monkeypatch.setattr(hs.time, "sleep", lambda _s: None)
    path = tmp_path / "movie.mkv"
    path.write_bytes(bytes(range(256)) * 4)  # 1024 bytes on disk (sparse in a real download)
    arrived = [300]
    windows: list[int] = []
    growing = hs.GrowingSource(total_size=1024, available=lambda: arrived[0], request_window=windows.append)
    proc = _FakeProc()

    # Let the "download" finish once the feeder has caught up with the first part.
    def more(_seconds):
        arrived[0] = 1024

    monkeypatch.setattr(hs.time, "sleep", more)
    hs.SessionManager._feed(str(path), growing, proc)  # type: ignore[arg-type]

    assert proc.stdin.data == path.read_bytes()
    assert proc.stdin.closed
    assert windows and windows[0] == 0  # it asked the torrent for the bytes it was about to need


def test_the_feeder_never_reads_past_what_the_torrent_has_confirmed(tmp_path, monkeypatch):
    path = tmp_path / "movie.mkv"
    path.write_bytes(b"x" * 1000)
    proc = _FakeProc()
    growing = hs.GrowingSource(total_size=1000, available=lambda: 400)

    def stop(_s):
        proc.returncode = 0  # the encoder ends while the feeder waits for more

    monkeypatch.setattr(hs.time, "sleep", stop)
    hs.SessionManager._feed(str(path), growing, proc)  # type: ignore[arg-type]

    assert len(proc.stdin.data) == 400


def test_a_download_in_progress_is_encoded_from_a_pipe_and_a_finished_one_by_path(tmp_path, monkeypatch):
    manager = hs.SessionManager(str(tmp_path))
    session = _session(directory=str(tmp_path))
    session.source = str(tmp_path / "missing-download.mkv")  # the download folder is gone
    final = tmp_path / "final.mkv"
    final.write_bytes(b"x")
    arrived = [10]
    session.growing = hs.GrowingSource(total_size=100, available=lambda: arrived[0], final_path=str(final))
    launched: list[tuple[list[str], object]] = []

    class Spawned(_FakeProc):
        def send_signal(self, _sig):
            return None

        def terminate(self):
            self.returncode = -15

        def wait(self, timeout=None):
            return self.returncode

    def fake_popen(args, stdin=None, **_kw):
        launched.append((args, stdin))
        return Spawned()

    monkeypatch.setattr(hs, "Popen", fake_popen)
    monkeypatch.setattr(hs.threading, "Thread", lambda **_kw: type("T", (), {"start": lambda self: None})())
    manager._start_process(session, 0)
    args, stdin = launched[-1]
    assert args[args.index("-i") + 1] == "pipe:0" and stdin == hs.PIPE

    arrived[0] = 100  # complete: read the file by path, so seeking works, from where it now lives
    manager._start_process(session, 4)
    args, stdin = launched[-1]
    assert args[args.index("-i") + 1] == str(final) and stdin == hs.DEVNULL
    assert args[args.index("-ss") + 1] == "24"


def test_sessions_for_a_torrent_or_file_are_closed_by_prefix(tmp_path):
    manager = hs.SessionManager(str(tmp_path))
    for name in ("h1/a.mkv", "h1/b.mkv", "h2/a.mkv"):
        s = _session(directory=str(tmp_path / name.replace("/", "_")))
        s.id, s.key = name, name
        manager._sessions[name] = s
    manager.close_prefix("h1/a.mkv")
    assert sorted(manager.keys()) == ["h1/b.mkv", "h2/a.mkv"]
    manager.close_prefix("h1/")
    assert manager.keys() == ["h2/a.mkv"]


def test_create_keeps_the_growing_source_and_the_audio_tracks(tmp_path, monkeypatch):
    source = tmp_path / "movie.mkv"
    source.write_bytes(b"x")
    monkeypatch.setattr(hs, "probe_duration", lambda _p: 60.0)
    monkeypatch.setattr(hs.hls_ladder, "probe_video_size", lambda _p: (1280, 720))
    tracks = [hls_ladder.AudioTrack(0, "aac", "eng", ""), hls_ladder.AudioTrack(1, "aac", "fra", "")]
    monkeypatch.setattr(hs.hls_ladder, "probe_audio_tracks", lambda _p: tracks)
    monkeypatch.setattr(hs.hls_ladder, "detect_encoder", lambda _p: hls_ladder.SOFTWARE)
    manager = hs.SessionManager(str(tmp_path / "sessions"))
    monkeypatch.setattr(manager, "_start_process", lambda s, i: None)
    monkeypatch.setattr(manager, "_ensure_watcher", lambda: None)
    growing = hs.GrowingSource(total_size=100, available=lambda: 10)

    session = manager.create("h/f", str(source), 0.0, growing)

    assert session.growing is growing
    assert session.audio_tracks == tracks and session.separate_audio
    assert session.variant_count == len(session.ladder) + 2


def test_the_start_point_is_seconds_of_this_files_own_video():
    from rapidbaydaemon import _start_threshold_bytes

    mib = 1024 * 1024
    # A 1 GB, 100-minute file runs at about 0.17 MB/s: 20 s is about 3.4 MB, so the 4 mib of headers rule.
    assert _start_threshold_bytes(1000 * mib, 6000.0, 20) == 4 * mib
    # The same length at 20 times the size (a remux) needs 20 times as many bytes for the same 20 s.
    assert _start_threshold_bytes(20000 * mib, 6000.0, 20) == int(20000 * mib / 6000.0 * 20)
    # More seconds, more bytes.
    assert abs(_start_threshold_bytes(5000 * mib, 3000.0, 60) - 3 * _start_threshold_bytes(5000 * mib, 3000.0, 20)) <= 3
    # Never more than a quarter of the file, so a short clip is not locked out.
    assert _start_threshold_bytes(40 * mib, 30.0, 20) == 10 * mib
    # Length unknown: the old 50 mib, still capped by the quarter rule.
    assert _start_threshold_bytes(1000 * mib, None, 20) == 50 * mib
    assert _start_threshold_bytes(80 * mib, None, 20) == 20 * mib
    # Tiny files still get a floor of 1 mib.
    assert _start_threshold_bytes(2 * mib, 10.0, 20) == 1 * mib


def test_an_init_file_is_not_sent_while_ffmpeg_is_still_writing_it(tmp_path, monkeypatch):
    monkeypatch.setattr(hs, "SEGMENT_WAIT_SECONDS", 0.4)
    manager = hs.SessionManager(str(tmp_path))
    session = _session(directory=str(tmp_path))
    session.runs = 1
    monkeypatch.setattr(manager, "_ensure_encoding", lambda s, i: None)
    init = tmp_path / "init_v0.mp4"
    init.write_bytes(b"")  # ffmpeg has opened it and has not written yet
    assert manager.file_for(session, "init_v0.mp4") is None
    init.write_bytes(b"ftyp-moov")  # written, but no segment of the variant yet: still not trusted
    assert manager.file_for(session, "init_v0.mp4") is None
    (tmp_path / hs.segment_name(0, 0)).write_bytes(b"x")  # the first segment is out, so the init file is whole
    assert manager.file_for(session, "init_v0.mp4") == str(init)


def test_an_init_file_waits_for_a_segment_of_its_own_variant(tmp_path, monkeypatch):
    monkeypatch.setattr(hs, "SEGMENT_WAIT_SECONDS", 0.3)
    manager = hs.SessionManager(str(tmp_path))
    session = _session(directory=str(tmp_path))
    session.runs = 1
    monkeypatch.setattr(manager, "_ensure_encoding", lambda s, i: None)
    (tmp_path / "init_v1.mp4").write_bytes(b"moov")
    (tmp_path / hs.segment_name(0, 0)).write_bytes(b"x")  # another variant's segment does not count
    assert manager.file_for(session, "init_v1.mp4") is None
    (tmp_path / hs.segment_name(1, 0)).write_bytes(b"x")
    assert manager.file_for(session, "init_v1.mp4") == str(tmp_path / "init_v1.mp4")


def test_segments_are_sent_as_soon_as_they_exist(tmp_path, monkeypatch):
    manager = hs.SessionManager(str(tmp_path))
    session = _session(directory=str(tmp_path))
    session.runs = 1
    monkeypatch.setattr(manager, "_ensure_encoding", lambda s, i: None)
    (tmp_path / hs.segment_name(0, 0)).write_bytes(b"x")
    assert manager.file_for(session, hs.segment_name(0, 0)) == str(tmp_path / hs.segment_name(0, 0))
