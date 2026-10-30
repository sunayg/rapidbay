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
