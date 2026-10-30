import os
from unittest.mock import patch

import rapidbaydaemon
from rapidbaydaemon import _link_or_copy


def test_the_download_is_hard_linked_so_it_uses_no_second_copy(tmp_path):
    source = tmp_path / "dl" / "Movie.mkv"
    source.parent.mkdir()
    source.write_bytes(b"x" * 1000)
    destination = tmp_path / "out" / "Movie.mkv"
    destination.parent.mkdir()
    _link_or_copy(str(source), str(destination))
    assert destination.read_bytes() == source.read_bytes()
    assert os.stat(destination).st_ino == os.stat(source).st_ino
    source.unlink()  # cleaning the download folder must not take the file away
    assert destination.read_bytes() == b"x" * 1000


def test_it_copies_when_a_link_is_not_possible(tmp_path):
    source = tmp_path / "Movie.mkv"
    source.write_bytes(b"data")
    destination = tmp_path / "Out.mkv"
    with patch.object(rapidbaydaemon.os, "link", side_effect=OSError("cross-device")):
        _link_or_copy(str(source), str(destination))
    assert destination.read_bytes() == b"data"
    assert os.stat(destination).st_ino != os.stat(source).st_ino
    assert [p.name for p in tmp_path.iterdir() if p.name.endswith(".part")] == []


def test_a_stale_partial_file_does_not_block_linking(tmp_path):
    source = tmp_path / "a.mkv"
    source.write_bytes(b"1")
    destination = tmp_path / "b.mkv"
    (tmp_path / f"b.mkv.{os.getpid()}.part").write_bytes(b"left over")
    _link_or_copy(str(source), str(destination))
    assert destination.read_bytes() == b"1"


def test_finishing_a_file_extracts_subtitles_then_links_it_once(tmp_path, monkeypatch):
    import threading

    daemon = rapidbaydaemon.RapidBayDaemon.__new__(rapidbaydaemon.RapidBayDaemon)
    daemon._finishing = set()
    daemon._notify_state_change = lambda: None
    source = tmp_path / "dl" / "Movie.mkv"
    source.parent.mkdir()
    source.write_bytes(b"data")
    output = tmp_path / "out" / "Movie.mkv"
    order: list[str] = []
    gate = threading.Event()

    class Extraction:
        def wait(self, timeout=None):
            order.append("extract")
            gate.wait(2)  # slow: the heartbeat must not be waiting for this

        def kill(self):
            order.append("kill")

    monkeypatch.setattr(rapidbaydaemon.video_conversion, "extract_subtitles_as_vtt", lambda f, d: Extraction())
    key = ("h" * 40, "Movie.mkv")
    daemon._finish_file(*key, str(source), str(output))
    daemon._finish_file(*key, str(source), str(output))  # the next heartbeat asks again: nothing new starts
    assert key in daemon._finishing and not output.exists()  # extraction in progress, nothing linked yet
    gate.set()
    for _ in range(100):
        if output.exists() and key not in daemon._finishing:
            break
        threading.Event().wait(0.02)
    assert output.read_bytes() == b"data" and order == ["extract"] and key not in daemon._finishing


def test_a_stuck_subtitle_extraction_is_killed_and_the_file_is_linked_anyway(tmp_path, monkeypatch):
    import subprocess

    daemon = rapidbaydaemon.RapidBayDaemon.__new__(rapidbaydaemon.RapidBayDaemon)
    daemon._finishing = {("h" * 40, "Movie.mkv")}
    daemon._notify_state_change = lambda: None
    source = tmp_path / "Movie.mkv"
    source.write_bytes(b"data")
    output = tmp_path / "out" / "Movie.mkv"
    killed: list[bool] = []

    class Stuck:
        def wait(self, timeout=None):
            raise subprocess.TimeoutExpired("ffmpeg", timeout)

        def kill(self):
            killed.append(True)

    monkeypatch.setattr(rapidbaydaemon.video_conversion, "extract_subtitles_as_vtt", lambda f, d: Stuck())
    daemon._extract_and_link(("h" * 40, "Movie.mkv"), str(source), str(output))
    assert killed == [True] and output.read_bytes() == b"data" and not daemon._finishing
