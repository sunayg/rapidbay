import hls_ladder
from hls_ladder import (
    SOFTWARE,
    VAAPI,
    Rendition,
    bitrate_for_height,
    build_ffmpeg_args,
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


def test_software_ffmpeg_args():
    ladder = plan_ladder(1920, 1080, HEIGHTS)
    args = build_ffmpeg_args(ladder, 1080, SOFTWARE, "veryfast", 6, "stream", ["-c:a", "aac", "-b:a", "128k"])
    joined = " ".join(args)
    assert args[:2] == ["ffmpeg", "-nostdin"] and "pipe:0" in args
    graph = args[args.index("-filter_complex") + 1]
    assert graph.startswith("[0:v:0]format=yuv420p,split=4[s0][s1][s2][s3]")
    assert "[s0]null[v0]" in graph  # the top rung is not rescaled
    assert "[s1]scale=1280:720[v1]" in graph and "[s3]scale=640:360[v3]" in graph
    assert args.count("-map") == 8  # four video plus four audio
    assert "-b:v:1 2800k" in joined and "-maxrate:v:1 2996k" in joined and "-bufsize:v:1 5600k" in joined
    assert "-preset veryfast" in joined and "-sc_threshold 0" in joined
    assert "expr:gte(t,n_forced*6)" in joined  # keyframes at every segment boundary on every rung
    assert "-var_stream_map v:0,a:0 v:1,a:1 v:2,a:2 v:3,a:3" in joined
    assert "-hls_fmp4_init_filename stream_v%v_init.mp4" in joined
    assert args[-1] == "stream_v%v.m3u8"
    assert "-copyts" not in joined and "copy" not in args  # nothing is stream-copied on the video side


def test_source_without_audio_has_no_audio_maps():
    ladder = plan_ladder(1280, 720, HEIGHTS)
    args = build_ffmpeg_args(ladder, 720, SOFTWARE, "veryfast", 6, "s", None)
    assert "0:a:0" not in args
    assert args[args.index("-var_stream_map") + 1] == "v:0 v:1 v:2"


def test_single_rendition_graph_does_not_split():
    ladder = plan_ladder(320, 240, HEIGHTS)
    args = build_ffmpeg_args(ladder, 240, SOFTWARE, "veryfast", 6, "s", None)
    assert args[args.index("-filter_complex") + 1] == "[0:v:0]format=yuv420p[s0];[s0]null[v0]"


def test_vaapi_args_upload_frames_and_scale_on_the_gpu():
    ladder = plan_ladder(1920, 1080, [1080, 720])
    args = build_ffmpeg_args(ladder, 1080, VAAPI, "veryfast", 6, "s", ["-c:a", "aac"])
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
    args = build_ffmpeg_args(one, 240, SOFTWARE, "veryfast", 6, "s", None)
    assert args[args.index("-hls_fmp4_init_filename") + 1] == "s_v0_init.mp4"
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
