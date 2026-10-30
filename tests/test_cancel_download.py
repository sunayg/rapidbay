from unittest.mock import MagicMock, patch

from app.locking import LockManager
from app.rapidbaydaemon import FileStatus, RapidBayDaemon

HASH = "a" * 40


def _daemon(status: str, priorities: list[int]):
    daemon = RapidBayDaemon.__new__(RapidBayDaemon)
    handle = MagicMock()
    handle.file_priorities.return_value = list(priorities)
    daemon.torrent_client = MagicMock()
    daemon.torrent_client.locks = LockManager()
    daemon.torrent_client.torrents = {HASH: handle}
    daemon.sessions = MagicMock()
    daemon._head_rushes = {}
    daemon._web_seeded = {HASH: {"a.mkv"}}
    daemon._notify_state_change = MagicMock()
    daemon.get_file_status = MagicMock(return_value={"status": status})
    daemon._discard_torrent = MagicMock()
    return daemon, handle


def _cancel(daemon, index: int | None = 0, subtitle_indexes=()):
    with patch("app.rapidbaydaemon.torrent.get_index_and_file_from_files", return_value=(index, object())), \
            patch("app.rapidbaydaemon._subtitle_indexes", return_value=list(subtitle_indexes)), \
            patch("app.rapidbaydaemon.torrent.prioritize_files") as prioritize:
        daemon.cancel_download(HASH, "a.mkv").join()
    return prioritize


def test_cancelling_the_only_file_discards_the_torrent():
    daemon, handle = _daemon(FileStatus.DOWNLOADING, [4])

    prioritize = _cancel(daemon)

    prioritize.assert_called_once_with(handle, [0])
    daemon._discard_torrent.assert_called_once_with(HASH, handle)
    assert "a.mkv" not in daemon._web_seeded[HASH]


def test_cancelling_one_file_keeps_the_torrent_for_the_others():
    daemon, handle = _daemon(FileStatus.DOWNLOADING, [4, 4])

    prioritize = _cancel(daemon)

    prioritize.assert_called_once_with(handle, [0, 4])
    daemon._discard_torrent.assert_not_called()


def test_cancelling_also_drops_the_files_subtitles():
    daemon, handle = _daemon(FileStatus.DOWNLOADING, [4, 4])

    prioritize = _cancel(daemon, subtitle_indexes=[1])

    prioritize.assert_called_once_with(handle, [0, 0])
    daemon._discard_torrent.assert_called_once_with(HASH, handle)


def test_a_finished_file_is_left_alone():
    daemon, _ = _daemon(FileStatus.READY, [4])

    prioritize = _cancel(daemon)

    prioritize.assert_not_called()
    daemon._discard_torrent.assert_not_called()
    daemon.sessions.close_prefix.assert_not_called()


def test_cancelling_ends_the_files_encode_session():
    daemon, _ = _daemon(FileStatus.DOWNLOADING, [4, 4])

    _cancel(daemon)

    daemon.sessions.close_prefix.assert_called_once_with(f"{HASH}/a.mkv")


def test_unknown_torrent_hash_or_file_is_a_no_op():
    daemon, _ = _daemon(FileStatus.DOWNLOADING, [4])
    daemon.torrent_client.torrents = {}
    assert not _cancel(daemon).called

    daemon, _ = _daemon(FileStatus.DOWNLOADING, [4])
    assert not _cancel(daemon, index=None).called

    daemon, _ = _daemon(FileStatus.DOWNLOADING, [4])
    daemon.cancel_download("../etc", "a.mkv").join()
    daemon.get_file_status.assert_not_called()
