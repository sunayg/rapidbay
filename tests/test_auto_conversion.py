from unittest.mock import MagicMock, patch

import rapidbaydaemon
from rapidbaydaemon import RapidBayDaemon

M3U8 = "/out/h/Show.m3u8"


def _daemon(active=(), started=None, ladder_complete=False, file_exists=True):
    d = MagicMock()
    d.hls_streamer.active_streams = {m: object() for m in active}
    d.start_hls_stream.return_value = started or {"started": True}
    patches = [
        patch.object(rapidbaydaemon, "_m3u8_path", return_value=M3U8),
        patch.object(rapidbaydaemon.video_conversion, "hls_ladder_complete", return_value=ladder_complete),
        patch.object(rapidbaydaemon.video_conversion, "variant_playlist_paths", return_value=["/out/h/Show_v0.m3u8"]),
        patch.object(rapidbaydaemon.os.path, "isfile", return_value=file_exists),
        patch.object(rapidbaydaemon.os, "makedirs"),
    ]
    return d, patches


def _step(d, patches):
    for p in patches:
        p.start()
    try:
        return RapidBayDaemon._advance_conversion(d, "h", "Show.mkv", "/dl/h/Show.mkv", "/out/h/Show.mp4")
    finally:
        for p in patches:
            p.stop()


def test_a_finished_download_starts_the_streaming_encode_with_no_viewer():
    d, p = _daemon()
    assert _step(d, p) == "encoding"
    d.start_hls_stream.assert_called_once_with("h", "Show.mkv", auto=True)
    d.video_converter.convert_file.assert_not_called()


def test_a_running_encode_is_left_alone():
    d, p = _daemon(active=[M3U8])
    assert _step(d, p) == "encoding"
    d.start_hls_stream.assert_not_called()


def test_a_finished_encode_is_remuxed_into_the_mp4():
    d, p = _daemon(ladder_complete=True)
    assert _step(d, p) == "remux"
    d.video_converter.remux_hls_to_mp4.assert_called_once_with("/out/h/Show_v0.m3u8", "/out/h/Show.mp4")
    d.start_hls_stream.assert_not_called()


def test_no_free_slot_waits_instead_of_starting_a_second_encoder():
    d, p = _daemon(started={"started": False, "reason": "capacity"})
    assert _step(d, p) == "waiting"
    d.video_converter.convert_file.assert_not_called()


def test_a_file_the_encode_cannot_take_falls_back_to_the_old_converter():
    for reason in ("codec_failed", "unsupported_format"):
        d, p = _daemon(started={"started": False, "reason": reason})
        assert _step(d, p) == "converter"
        d.video_converter.convert_file.assert_called_once_with("/dl/h/Show.mkv", "/out/h/Show.mp4")


def test_a_missing_file_does_nothing():
    d, p = _daemon(file_exists=False)
    assert _step(d, p) == "missing"
    d.start_hls_stream.assert_not_called()
    d.video_converter.convert_file.assert_not_called()
