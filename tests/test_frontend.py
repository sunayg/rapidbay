import pytest
import settings
from fastapi.testclient import TestClient

from app.app import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    build = tmp_path / "dist"
    (build / "assets").mkdir(parents=True)
    (build / "index.html").write_text("INDEX")
    (build / "login.html").write_text("LOGIN")
    (build / "manifest.json").write_text('{"short_name": "Rapidbay"}')
    (build / "assets" / "a.js").write_text("console.log(1)")
    (tmp_path / "secret.txt").write_text("secret")
    kodi = tmp_path / "kodi"
    kodi.mkdir()
    (kodi / "app.kodi.py").write_text("KODI-CODE")
    monkeypatch.setattr(settings, "FRONTEND_DIR", str(build))
    monkeypatch.setattr(settings, "KODI_ADDON_DIR", str(kodi))
    monkeypatch.setattr(settings, "PASSWORD", None)
    return TestClient(app)


SPA_PATHS = [
    "/",
    "/index.html",
    "/settings",
    "/search/dune",
    "/search/",
    "/torrent/http%253A%252F%252Fx.test%252Fa.torrent/",
    "/magnet/abc/",
    "/magnet/abc%253A/file.mkv",
    "/magnet/abc/Some%20Show%20S01E01.mkv",
    "/registerHandler",
]


@pytest.mark.parametrize("path", SPA_PATHS)
def test_spa_routes_serve_the_entry_page(client, path):
    response = client.get(path)
    assert response.status_code == 200
    assert response.text == "INDEX"


@pytest.mark.parametrize("path", SPA_PATHS)
def test_spa_routes_show_login_without_the_password(client, monkeypatch, path):
    monkeypatch.setattr(settings, "PASSWORD", "pw")
    assert client.get(path).text == "LOGIN"
    client.cookies.set("password", "wrong")
    assert client.get(path).text == "LOGIN"
    client.cookies.set("password", "pw")
    assert client.get(path).text == "INDEX"


def test_real_files_are_served_without_a_password(client, monkeypatch):
    monkeypatch.setattr(settings, "PASSWORD", "pw")
    assert client.get("/assets/a.js").text == "console.log(1)"
    assert client.get("/manifest.json").json() == {"short_name": "Rapidbay"}
    assert client.get("/login.html").text == "LOGIN"


def test_unknown_api_paths_are_json_404s(client):
    for path in ("/api/does-not-exist", "/api/", "/api", "/play/nope", "/play/nope/file.mp4", "/cast/tok/hash/file.mp4"):
        response = client.get(path)
        assert response.status_code == 404, path
        assert response.headers["content-type"] == "application/json", path
        assert response.json()["detail"], path


def test_kodi_plugin_code_is_served_for_the_addon(client, monkeypatch):
    monkeypatch.setattr(settings, "PASSWORD", "pw")
    assert client.get("/app.kodi.py").text == "KODI-CODE"


def test_traversal_never_leaks_files_outside_the_build(client):
    for path in ("/%2e%2e/secret.txt", "/%2Fetc%2Fpasswd", "//etc/passwd", "/..%2f..%2fetc/passwd", "/assets/..%2f..%2fsecret.txt"):
        assert client.get(path).text == "INDEX", path


def test_missing_build_directory_is_a_404(client, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "FRONTEND_DIR", str(tmp_path / "nope"))
    assert client.get("/").status_code == 404
    assert client.get("/settings").status_code == 404
