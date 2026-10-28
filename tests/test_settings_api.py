import json

import pytest
import settings
from fastapi.testclient import TestClient
from settings_schema import FIELDS

from app.app import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "LIBRARY_PATH", str(tmp_path / "library.json"))
    monkeypatch.setattr(settings, "CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setattr(settings, "_ENV_VALUES", {})
    for key in FIELDS:
        monkeypatch.setattr(settings, key, getattr(settings, key))
    monkeypatch.setattr(settings, "PASSWORD", None)
    return TestClient(app)


def test_get_requires_password_when_set(client, monkeypatch):
    assert client.get("/api/settings").status_code == 200
    monkeypatch.setattr(settings, "PASSWORD", "pw")
    assert client.get("/api/settings").status_code == 404
    assert client.get("/api/settings", cookies={"password": "pw"}).status_code == 200


def test_put_saves_and_returns_description(client):
    r = client.put("/api/settings/streaming", json={"values": {"HLS_SEGMENT_DURATION": 4}})
    assert r.status_code == 200
    row = next(f for f in r.json()["fields"] if f["key"] == "HLS_SEGMENT_DURATION")
    assert row["value"] == 4 and row["source"] == "saved"
    assert client.put("/api/settings/nope", json={"values": {}}).status_code == 404


def test_put_invalid_returns_422_without_secret(client):
    r = client.put("/api/settings/general", json={"values": {"PASSWORD": "bad;pw"}})
    assert r.status_code == 422
    assert "PASSWORD" in r.json()["errors"]
    assert "bad;pw" not in r.text


def test_password_change_keeps_saver_logged_in(client, monkeypatch):
    monkeypatch.setattr(settings, "PASSWORD", "old")
    r = client.put("/api/settings/general", json={"values": {"PASSWORD": "new"}}, cookies={"password": "old"})
    assert r.status_code == 200
    assert "password=new" in r.headers["set-cookie"]
    assert r.headers["x-set-cookie"] == r.headers["set-cookie"]
    assert client.get("/api/settings", cookies={"password": "new"}).status_code == 200
    assert client.get("/api/settings", cookies={"password": "old"}).status_code == 404


def test_password_round_trips_as_cookie(client):
    assert client.put("/api/settings/general", json={"values": {"PASSWORD": "pässword"}}).status_code == 422
    r = client.put("/api/settings/general", json={"values": {"PASSWORD": "p4ss-w0rd_!"}})
    assert r.status_code == 200
    cookie = r.cookies.get("password")
    assert client.get("/api/settings", cookies={"password": cookie}).status_code == 200


def test_clear_password_opens_access(client, monkeypatch):
    monkeypatch.setattr(settings, "PASSWORD", "pw")
    assert client.post("/api/settings/PASSWORD/clear", cookies={"password": "pw"}).status_code == 200
    assert client.get("/api/settings").status_code == 200
    assert client.post("/api/settings/AAC_CHANNELS/clear").status_code == 422
    assert client.post("/api/settings/NOPE/clear").status_code == 404


def test_reset_endpoint(client):
    client.put("/api/settings/conversion", json={"values": {"AAC_CHANNELS": 6}})
    r = client.post("/api/settings/AAC_CHANNELS/reset")
    assert r.status_code == 200
    assert settings._DEFAULTS["AAC_CHANNELS"] == settings.AAC_CHANNELS


def test_responses_never_contain_secrets(client, monkeypatch):
    monkeypatch.setattr(settings, "TMDB_API_KEY", "SUPERSECRETKEY")
    bodies = [
        client.get("/api/settings").text,
        client.put("/api/settings/subtitles", json={"values": {"SUBTITLE_LANGUAGES": ["en"]}}).text,
        client.put("/api/settings/subtitles", json={"values": {"TMDB_API_KEY": "SUPERSECRETKEY2", "SUBTITLE_LANGUAGES": "x"}}).text,
    ]
    for body in bodies:
        assert "SUPERSECRETKEY" not in body
    json.loads(bodies[0])
