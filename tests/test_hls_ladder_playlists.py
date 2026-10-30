import os

import hls_ladder
import video_conversion as vc


def _ladder():
    return hls_ladder.plan_ladder(1280, 720, [720, 480])


def _write_stream(tmp_path, ended):
    m3u8 = str(tmp_path / "stream.m3u8")
    vc.write_ladder_info(m3u8, "stream", True, _ladder())
    for i, done in enumerate(ended):
        if done is not None:
            (tmp_path / f"stream_v{i}.m3u8").write_text("#EXTM3U\n#EXTINF:6,\nx.m4s\n" + ("#EXT-X-ENDLIST\n" if done else ""))
    return m3u8


def test_ladder_info_round_trips(tmp_path):
    m3u8 = _write_stream(tmp_path, [])
    prefix, has_audio, ladder = vc.read_ladder_info(m3u8)
    assert (prefix, has_audio, ladder) == ("stream", True, _ladder())
    assert vc.read_ladder_info(str(tmp_path / "missing.m3u8")) is None


def test_stream_is_ready_only_when_every_rendition_has_a_playlist(tmp_path):
    assert not vc.hls_playlists_ready(_write_stream(tmp_path, [False, None]))
    assert vc.hls_playlists_ready(_write_stream(tmp_path, [False, False]))


def test_legacy_single_playlist_still_counts_as_ready(tmp_path):
    legacy = tmp_path / "old.m3u8"
    assert not vc.hls_playlists_ready(str(legacy))
    legacy.write_text("#EXTM3U\n")
    assert vc.hls_playlists_ready(str(legacy))
    assert not vc.hls_ladder_complete(str(legacy))  # no ladder, so never remuxed as one


def test_ladder_is_complete_only_when_every_rendition_has_endlist(tmp_path):
    assert not vc.hls_ladder_complete(_write_stream(tmp_path, [True, False]))
    assert not vc.hls_ladder_complete(_write_stream(tmp_path, [True, None]))
    assert vc.hls_ladder_complete(_write_stream(tmp_path, [True, True]))


def test_master_playlist_lists_every_rendition_with_subtitles(tmp_path):
    m3u8 = _write_stream(tmp_path, [False, False])
    (tmp_path / "stream_en.vtt").write_text("WEBVTT\n")
    name = vc.write_hls_master_playlist(str(tmp_path), "stream.m3u8", ["stream_en.vtt"])
    text = (tmp_path / name).read_text()
    assert text.count("#EXT-X-STREAM-INF") == 2
    assert "RESOLUTION=1280x720" in text and "RESOLUTION=854x480" in text
    assert 'SUBTITLES="subs"' in text
    assert "stream_v0.m3u8" in text and "stream_v1.m3u8" in text
    assert os.path.isfile(m3u8 + ".ladder.json")


def test_master_playlist_is_rewritten_when_the_ladder_changes(tmp_path):
    _write_stream(tmp_path, [False, False])
    name = vc.write_hls_master_playlist(str(tmp_path), "stream.m3u8", [])
    first = (tmp_path / name).read_text()
    vc.write_ladder_info(str(tmp_path / "stream.m3u8"), "stream", True, hls_ladder.plan_ladder(1280, 720, [720, 480, 360]))
    second = (tmp_path / vc.write_hls_master_playlist(str(tmp_path), "stream.m3u8", [])).read_text()
    assert second.count("#EXT-X-STREAM-INF") == 3 and first != second


def test_stream_complete_covers_ladders_and_single_playlists(tmp_path):
    assert vc.hls_stream_complete(_write_stream(tmp_path, [True, True]))
    assert not vc.hls_stream_complete(_write_stream(tmp_path, [True, False]))
    single = tmp_path / "single.m3u8"
    assert not vc.hls_stream_complete(str(single))
    single.write_text("#EXTM3U\n#EXTINF:6,\nx.m4s\n")
    assert not vc.hls_stream_complete(str(single))
    single.write_text("#EXTM3U\n#EXTINF:6,\nx.m4s\n#EXT-X-ENDLIST\n")
    assert vc.hls_stream_complete(str(single))


def test_discarding_a_partial_stream_removes_every_playlist_and_the_sidecar(tmp_path):
    m3u8 = _write_stream(tmp_path, [False, False])
    (tmp_path / "stream.m3u8").write_text("#EXTM3U\n")
    vc.discard_stream_playlists(m3u8)
    assert sorted(p.name for p in tmp_path.iterdir()) == []
    assert not vc.hls_playlists_ready(m3u8)
    vc.discard_stream_playlists(m3u8)  # already gone: no error
