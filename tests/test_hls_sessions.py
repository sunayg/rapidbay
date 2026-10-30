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
