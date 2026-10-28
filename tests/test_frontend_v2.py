import pytest
import settings
from fastapi.testclient import TestClient

from app.app import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    v2 = tmp_path / "v2"
    (v2 / "assets").mkdir(parents=True)
    (v2 / "index.html").write_text("V2-INDEX")
    (v2 / "assets" / "a.js").write_text("console.log(1)")
    old = tmp_path / "old"
    old.mkdir()
    (old / "login.html").write_text("LOGIN")
    (old / "index.html").write_text("OLD-INDEX")
    monkeypatch.setattr(settings, "FRONTEND_V2_DIR", str(v2))
    monkeypatch.setattr(settings, "FRONTEND_DIR", str(old))
    monkeypatch.setattr(settings, "PASSWORD", None)
    return TestClient(app)


def test_settings_page_gating(client, monkeypatch):
    assert client.get("/settings").text == "V2-INDEX"
    monkeypatch.setattr(settings, "PASSWORD", "pw")
    assert client.get("/settings").text == "LOGIN"
    client.cookies.set("password", "pw")
    assert client.get("/settings").text == "V2-INDEX"


def test_assets_and_index_gate(client, monkeypatch):
    assert client.get("/v2/assets/a.js").text == "console.log(1)"
    monkeypatch.setattr(settings, "PASSWORD", "pw")
    assert client.get("/v2/index.html").text == "LOGIN"
    assert client.get("/v2/").text == "LOGIN"


def test_traversal_is_blocked(client):
    assert client.get("/v2/%2e%2e/old/index.html").status_code == 404
    assert client.get("/v2/%2Fetc%2Fpasswd").status_code == 404
    assert client.get("/v2//etc/passwd").status_code == 404


def test_missing_directory(client, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "FRONTEND_V2_DIR", str(tmp_path / "nope"))
    assert client.get("/settings").status_code == 404
    assert client.get("/").text == "OLD-INDEX"
