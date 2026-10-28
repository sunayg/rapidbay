import common
import jackett
import prowlarr
import settings


def test_prowlarr_uses_current_host_and_key(monkeypatch):
    monkeypatch.setattr(settings, "PROWLARR_HOST", "http://x:1")
    monkeypatch.setattr(settings, "PROWLARR_API_KEY", "abc")
    assert prowlarr._api_path() == "http://x:1/api/v1"
    assert prowlarr._api_key() == "abc"
    monkeypatch.setattr(settings, "PROWLARR_HOST", "http://y:2")
    monkeypatch.setattr(settings, "PROWLARR_API_KEY", "def")
    assert prowlarr._api_path() == "http://y:2/api/v1"
    assert prowlarr._api_key() == "def"


def test_jackett_uses_current_host_and_key(monkeypatch):
    monkeypatch.setattr(settings, "JACKETT_HOST", "http://x:1")
    monkeypatch.setattr(settings, "JACKETT_API_KEY", "abc")
    assert jackett._api_path() == "http://x:1/api/v2.0"
    monkeypatch.setattr(settings, "JACKETT_HOST", "http://y:2")
    monkeypatch.setattr(settings, "JACKETT_API_KEY", "def")
    assert jackett._api_path() == "http://y:2/api/v2.0"
    assert jackett._api_key() == "def"


def test_blocklist_regex_recompiles_when_list_changes(monkeypatch):
    monkeypatch.setattr(settings, "TRENDING_TITLE_BLOCKLIST", ["cam"])
    assert common.should_drop_from_trending("Movie CAM 2024", None)
    monkeypatch.setattr(settings, "TRENDING_TITLE_BLOCKLIST", ["hdts"])
    assert not common.should_drop_from_trending("Movie CAM 2024", None)
    assert common.should_drop_from_trending("Movie HDTS", None)
    monkeypatch.setattr(settings, "TRENDING_TITLE_BLOCKLIST", [])
    assert not common.should_drop_from_trending("Movie HDTS", None)


def test_clear_memoized_only_clears_that_module(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "CACHE_DIR", str(tmp_path))

    def make(name):
        def fn(x):
            return [x]

        fn.__module__ = name
        fn.__qualname__ = "fn"
        return common.memoize(60)(fn)

    a, b = make("a"), make("b")
    a(1), b(1)
    assert common.clear_memoized("a") == 1
    assert common.clear_memoized("b") == 1
