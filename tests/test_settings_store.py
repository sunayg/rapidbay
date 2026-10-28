import importlib
import json
import os

import pytest
import settings
import settings_store
from settings_schema import FIELDS


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setattr(settings, "LIBRARY_PATH", str(tmp_path / "library.json"))
    for key in FIELDS:
        monkeypatch.setattr(settings, key, getattr(settings, key))
    monkeypatch.setattr(settings, "_ENV_VALUES", {})
    return tmp_path / "settings.json"


def saved_values(path):
    return json.loads(path.read_text())["values"]


def test_save_applies_live_and_persists(store):
    assert settings_store.save_category("streaming", {"HLS_SEGMENT_DURATION": 4}) == ["HLS_SEGMENT_DURATION"]
    assert settings.HLS_SEGMENT_DURATION == 4
    assert saved_values(store)["HLS_SEGMENT_DURATION"] == 4


def test_startup_applies_saved_over_env(store, monkeypatch):
    monkeypatch.setattr(settings, "_ENV_VALUES", {"AAC_CHANNELS": 3})
    monkeypatch.setattr(settings, "AAC_CHANNELS", 3)
    store.write_text(json.dumps({"version": 1, "values": {"AAC_CHANNELS": 6}}))
    settings_store.apply_saved(settings)
    assert settings.AAC_CHANNELS == 6
    row = next(f for f in settings_store.describe_all()["fields"] if f["key"] == "AAC_CHANNELS")
    assert row["source"] == "saved"


def test_reset_falls_back_to_env_then_default(store, monkeypatch):
    monkeypatch.setattr(settings, "_ENV_VALUES", {"AAC_CHANNELS": 3})
    settings_store.save_category("conversion", {"AAC_CHANNELS": 6})
    settings_store.reset_field("AAC_CHANNELS")
    assert settings.AAC_CHANNELS == 3
    monkeypatch.setattr(settings, "_ENV_VALUES", {})
    settings_store.save_category("conversion", {"AAC_CHANNELS": 6})
    settings_store.reset_field("AAC_CHANNELS")
    assert settings._DEFAULTS["AAC_CHANNELS"] == settings.AAC_CHANNELS
    row = next(f for f in settings_store.describe_all()["fields"] if f["key"] == "AAC_CHANNELS")
    assert row["source"] == "default"


def test_clear_overrides_env(store, monkeypatch):
    monkeypatch.setattr(settings, "_ENV_VALUES", {"PASSWORD": "envpw"})
    monkeypatch.setattr(settings, "PASSWORD", "envpw")
    settings_store.clear_field("PASSWORD")
    assert settings.PASSWORD == ""
    assert saved_values(store)["PASSWORD"] == ""
    monkeypatch.setattr(settings, "PASSWORD", "envpw")
    settings_store.apply_saved(settings)
    assert settings.PASSWORD == ""


def test_corrupt_file_does_not_fail_startup(store):
    store.write_text("{not json")
    assert settings_store.load_saved() == {}
    store.write_text(json.dumps({"values": {"HLS_SEGMENT_DURATION": "x", "NOPE": 1, "AAC_CHANNELS": 6}}))
    settings_store.apply_saved(settings)
    assert settings.AAC_CHANNELS == 6
    assert settings.HLS_SEGMENT_DURATION != "x"


def test_invalid_field_rejects_whole_category(store):
    before = settings.AAC_CHANNELS
    with pytest.raises(settings_store.SettingsValidationError) as exc:
        settings_store.save_category("conversion", {"AAC_CHANNELS": 6, "AAC_BITRATE": "bad;"})
    assert list(exc.value.errors) == ["AAC_BITRATE"]
    assert not store.exists()
    assert before == settings.AAC_CHANNELS


def test_backup_and_atomic_write(store):
    settings_store.save_category("streaming", {"HLS_SEGMENT_DURATION": 4})
    settings_store.save_category("streaming", {"HLS_SEGMENT_DURATION": 5})
    bak = store.with_name("settings.json.bak")
    assert json.loads(bak.read_text())["values"]["HLS_SEGMENT_DURATION"] == 4
    assert [p for p in os.listdir(store.parent) if p.endswith(".tmp")] == []


def test_secret_blank_keeps_current(store, monkeypatch):
    monkeypatch.setattr(settings, "TMDB_API_KEY", "SECRETKEY123")
    settings_store.save_category("subtitles", {"TMDB_API_KEY": ""})
    settings_store.save_category("subtitles", {"TMDB_API_KEY": None})
    assert settings.TMDB_API_KEY == "SECRETKEY123"
    assert "SECRETKEY123" not in json.dumps(settings_store.describe_all())


def test_host_change_clears_paired_key(store, monkeypatch):
    monkeypatch.setattr(settings, "PROWLARR_HOST", "http://a")
    monkeypatch.setattr(settings, "PROWLARR_API_KEY", "k1")
    settings_store.save_category("search", {"PROWLARR_HOST": "http://a/"})
    assert settings.PROWLARR_API_KEY == "k1"
    settings_store.save_category("search", {"PROWLARR_HOST": "http://b"})
    assert settings.PROWLARR_API_KEY == ""
    assert saved_values(store)["PROWLARR_API_KEY"] == ""
    settings_store.save_category("search", {"PROWLARR_HOST": "http://c", "PROWLARR_API_KEY": "k2"})
    assert settings.PROWLARR_API_KEY == "k2"
    monkeypatch.setattr(settings, "JACKETT_HOST", "http://j1")
    monkeypatch.setattr(settings, "JACKETT_API_KEY", "jk")
    settings_store.save_category("search", {"JACKETT_HOST": "http://j2"})
    assert settings.JACKETT_API_KEY == ""


def test_restart_needed_not_applied_live(store, monkeypatch):
    monkeypatch.setattr(settings, "TORRENT_LISTENING_PORT", None)
    settings_store.save_category("torrents", {"TORRENT_LISTENING_PORT": 7000})
    assert settings.TORRENT_LISTENING_PORT is None
    row = next(f for f in settings_store.describe_all()["fields"] if f["key"] == "TORRENT_LISTENING_PORT")
    assert row["pending_restart"] is True
    monkeypatch.setattr(settings, "TORRENT_LISTENING_PORT", 7000)
    row = next(f for f in settings_store.describe_all()["fields"] if f["key"] == "TORRENT_LISTENING_PORT")
    assert row["pending_restart"] is False


def test_categories_do_not_clobber_each_other(store):
    settings_store.save_category("streaming", {"HLS_SEGMENT_DURATION": 4})
    settings_store.save_category("conversion", {"AAC_CHANNELS": 6})
    values = saved_values(store)
    assert values["HLS_SEGMENT_DURATION"] == 4 and values["AAC_CHANNELS"] == 6


def test_password_env_is_string(monkeypatch):
    monkeypatch.setenv("PASSWORD", "1234")
    try:
        importlib.reload(settings)
        assert settings.PASSWORD == "1234"
    finally:
        monkeypatch.delenv("PASSWORD")
        importlib.reload(settings)
