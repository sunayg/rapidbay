import hls_ladder
from hls_ladder import (
    SOFTWARE,
    VAAPI,
    Rendition,
    bitrate_for_height,
    plan_ladder,
    stream_inf_lines,
)

HEIGHTS = [1080, 720, 480, 360]


def test_ladder_for_a_1080p_source():
    ladder = plan_ladder(1920, 1080, HEIGHTS)
    assert [(r.width, r.height, r.video_kbps) for r in ladder] == [
        (1920, 1080, 5000), (1280, 720, 2800), (854, 480, 1400), (640, 360, 800),
    ]
    assert [r.index for r in ladder] == [0, 1, 2, 3]


def test_ladder_never_upscales():
    assert [r.height for r in plan_ladder(1280, 720, HEIGHTS)] == [720, 480, 360]
    # smaller than every configured height: one rendition at the source size
    ladder = plan_ladder(320, 240, HEIGHTS)
    assert [(r.width, r.height) for r in ladder] == [(320, 240)]
    assert ladder[0].video_kbps == 400


def test_odd_source_height_becomes_the_top_rung():
    ladder = plan_ladder(1920, 800, HEIGHTS)  # scope film
    assert [r.height for r in ladder] == [800, 720, 480, 360]
    assert ladder[0].width == 1920
    assert all(r.width % 2 == 0 and r.height % 2 == 0 for r in ladder)
    assert ladder[0].video_kbps > ladder[1].video_kbps


def test_4k_source_is_capped_at_the_largest_configured_height():
    assert [r.height for r in plan_ladder(3840, 2160, HEIGHTS)] == [1080, 720, 480, 360]


def test_bad_input_gives_no_ladder():
    assert plan_ladder(0, 0, HEIGHTS) == []
    assert plan_ladder(1920, 1080, []) == []


def test_bitrate_interpolates_and_has_a_floor():
    assert bitrate_for_height(720) == 2800
    assert 800 < bitrate_for_height(400) < 1400
    assert bitrate_for_height(60) == hls_ladder.MIN_VIDEO_KBPS


def test_bandwidth_is_peak_video_plus_audio():
    r = Rendition(0, 1280, 720, 2800)
    assert r.bandwidth == (int(2800 * 1.07) + 128) * 1000


def test_vaapi_args_upload_frames_and_scale_on_the_gpu():
    ladder = plan_ladder(1920, 1080, [1080, 720])
    args = hls_ladder.build_session_args(ladder, 1080, VAAPI, "veryfast", 6, "/in.mkv", ["-c:a", "aac"], 0, "init")
    joined = " ".join(args)
    assert "-init_hw_device vaapi=va:/dev/dri/renderD128 -filter_hw_device va" in joined
    graph = args[args.index("-filter_complex") + 1]
    assert graph.startswith("[0:v:0]format=nv12,hwupload,split=2")
    assert "scale_vaapi=w=1280:h=720" in graph
    assert "-preset" not in args and "-sc_threshold" not in args  # x264-only options


def test_stream_inf_lines():
    ladder = plan_ladder(1280, 720, [720, 480])
    lines = stream_inf_lines(ladder, "movie", True, True)
    assert lines[0] == (
        '#EXT-X-STREAM-INF:BANDWIDTH=3124000,RESOLUTION=1280x720,CODECS="avc1.640029,mp4a.40.2",SUBTITLES="subs"'
    )
    assert lines[1] == "movie_v0.m3u8" and lines[3] == "movie_v1.m3u8"
    assert "mp4a" not in stream_inf_lines(ladder, "m", False, False)[0]
    assert "SUBTITLES" not in stream_inf_lines(ladder, "m", False, False)[0]


def test_encoder_detection_prefers_software_unless_vaapi_really_works(monkeypatch, tmp_path):
    hls_ladder.reset_encoder_cache()
    device = tmp_path / "renderD128"
    device.write_text("")
    monkeypatch.setattr(hls_ladder, "_vaapi_works", lambda _d: False)
    assert hls_ladder.detect_encoder("auto", str(device)) == SOFTWARE  # driver present but no bitrate control
    hls_ladder.reset_encoder_cache()
    monkeypatch.setattr(hls_ladder, "_vaapi_works", lambda _d: True)
    assert hls_ladder.detect_encoder("auto", str(device)) == VAAPI
    assert hls_ladder.detect_encoder("auto", str(device)) == VAAPI  # cached
    assert hls_ladder.detect_encoder("software", str(device)) == SOFTWARE
    hls_ladder.reset_encoder_cache()
    assert hls_ladder.detect_encoder("auto", str(tmp_path / "missing")) == SOFTWARE
    hls_ladder.reset_encoder_cache()


def test_a_single_rendition_names_its_init_file_without_a_placeholder():
    # ffmpeg leaves %v in the init file name untouched when there is only one rendition.
    one = plan_ladder(320, 240, HEIGHTS)
    session = hls_ladder.build_session_args(one, 240, SOFTWARE, "veryfast", 6, "/in.mkv", None, 0, "init")
    assert session[session.index("-hls_fmp4_init_filename") + 1] == "init_v0.mp4"
    many = plan_ladder(1920, 1080, HEIGHTS)
    session = hls_ladder.build_session_args(many, 1080, SOFTWARE, "veryfast", 6, "/in.mkv", None, 0, "init")
    assert session[session.index("-hls_fmp4_init_filename") + 1] == "init_v%v.mp4"


def test_session_args_restart_at_a_segment_on_the_same_timeline():
    ladder = plan_ladder(1920, 1080, HEIGHTS)
    args = build_session_args_for_test(ladder, start=7)
    assert args[args.index("-ss") + 1] == "42"
    assert args[args.index("-output_ts_offset") + 1] == "42"
    assert args[args.index("-start_number") + 1] == "7"
    assert args.index("-ss") < args.index("-i")  # input seeking, so it is fast
    assert "temp_file" in args[args.index("-hls_flags") + 1]  # a segment is never visible half-written
    assert args[args.index("-i") + 1] == "/in.mkv"
    fresh = build_session_args_for_test(ladder, start=0)
    assert "-ss" not in fresh and "-output_ts_offset" not in fresh


def build_session_args_for_test(ladder, start):
    return hls_ladder.build_session_args(ladder, 1080, SOFTWARE, "veryfast", 6, "/in.mkv", ["-c:a", "aac"], start, "init")


def _tracks():
    return [hls_ladder.AudioTrack(0, "aac", "eng", ""), hls_ladder.AudioTrack(1, "ac3", "fra", "Version française"), hls_ladder.AudioTrack(2, "aac", "ita", "")]


def test_several_audio_tracks_become_separate_variants_after_the_video_ones():
    ladder = plan_ladder(1920, 1080, [1080, 720])
    args = hls_ladder.build_session_args(ladder, 1080, SOFTWARE, "veryfast", 6, "/in.mkv", ["-c:a", "aac"], 0, "init", _tracks())
    maps = [args[i + 1] for i, a in enumerate(args) if a == "-map"]
    assert maps == ["[v0]", "[v1]", "0:a:0", "0:a:1", "0:a:2"]  # each track once, not once per video rendition
    assert args[args.index("-var_stream_map") + 1] == "v:0 v:1 a:0 a:1 a:2"
    assert args[args.index("-hls_fmp4_init_filename") + 1] == "init_v%v.mp4"


def test_one_audio_track_stays_muxed_into_every_video_variant():
    ladder = plan_ladder(1920, 1080, [1080, 720])
    args = hls_ladder.build_session_args(ladder, 1080, SOFTWARE, "veryfast", 6, "/in.mkv", ["-c:a", "aac"], 0, "init", _tracks()[:1])
    assert [args[i + 1] for i, a in enumerate(args) if a == "-map"] == ["[v0]", "[v1]", "0:a:0", "0:a:0"]
    assert args[args.index("-var_stream_map") + 1] == "v:0,a:0 v:1,a:1"


def test_audio_tracks_are_listed_in_the_master_playlist_and_tied_to_every_rendition():
    ladder = plan_ladder(1280, 720, [720, 480])
    names = {"eng": ("en", "English"), "fra": ("fr", "Version française"), "ita": ("it", "Italian")}
    lines = hls_ladder.audio_media_lines(_tracks(), len(ladder), "playlist", lambda t: names[t.language])
    assert lines[0] == '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="playlist_v2.m3u8"'
    assert 'NAME="Version française",LANGUAGE="fr",DEFAULT=NO' in lines[1] and lines[1].endswith('URI="playlist_v3.m3u8"')
    assert lines[2].endswith('URI="playlist_v4.m3u8"')
    streams = hls_ladder.stream_inf_lines(ladder, "playlist", True, False, audio_group=True)
    assert all('AUDIO="aud"' in line for line in streams[::2])
    assert 'AUDIO' not in hls_ladder.stream_inf_lines(ladder, "playlist", True, False)[0]
