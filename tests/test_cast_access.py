"""Cast links let a Chromecast fetch one torrent's files without the password."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import app as app_module
from app import cast_access

HASH = "a" * 40


def test_token_is_valid_for_its_hash_until_it_expires() -> None:
    token = cast_access.make_token(HASH, now=1000)

    assert cast_access.verify_token(token, HASH, now=1000)
    assert cast_access.verify_token(token, HASH, now=1000 + cast_access.TOKEN_LIFETIME_SECONDS)
    assert not cast_access.verify_token(token, HASH, now=1000 + cast_access.TOKEN_LIFETIME_SECONDS + 1)


def test_token_does_not_open_another_hash() -> None:
    token = cast_access.make_token(HASH, now=1000)

    assert not cast_access.verify_token(token, "b" * 40, now=1000)


def test_tampered_or_malformed_tokens_are_refused() -> None:
    token = cast_access.make_token(HASH, now=1000)
    expiry, _, signature = token.partition(".")

    assert not cast_access.verify_token(f"{int(expiry) + 1000}.{signature}", HASH, now=1000)
    assert not cast_access.verify_token(f"{expiry}.{'0' * 64}", HASH, now=1000)
    assert not cast_access.verify_token("", HASH, now=1000)
    assert not cast_access.verify_token("nodot", HASH, now=1000)
    assert not cast_access.verify_token("abc.def", HASH, now=1000)


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    output = tmp_path / "output"
    (output / HASH / "hls").mkdir(parents=True)
    (output / HASH / "movie.mp4").write_bytes(b"video")
    (output / HASH / "hls" / "segment0.ts").write_bytes(b"segment")
    monkeypatch.setattr(app_module.settings, "OUTPUT_DIR", str(output))
    monkeypatch.setattr(app_module.settings, "PASSWORD", "secret")
    yield TestClient(app_module.app)


def _prefix(client: TestClient) -> str:
    response = client.get(f"/api/cast_link/{HASH}", headers={"Authorization": "Bearer secret"})
    assert response.status_code == 200
    return str(response.json()["prefix"])


def test_play_stays_closed_without_the_password(client: TestClient) -> None:
    assert client.get(f"/play/{HASH}/movie.mp4").status_code == 404


def test_cast_link_needs_the_password(client: TestClient) -> None:
    assert client.get(f"/api/cast_link/{HASH}").status_code == 404


def test_cast_link_serves_files_without_credentials(client: TestClient) -> None:
    prefix = _prefix(client)

    movie = client.get(f"{prefix}movie.mp4")
    segment = client.get(f"{prefix}hls/segment0.ts")

    assert movie.status_code == 200
    assert movie.content == b"video"
    assert movie.headers["access-control-allow-origin"] == "*"
    assert segment.content == b"segment"


def test_cast_link_refuses_other_torrents_and_bad_tokens(client: TestClient) -> None:
    prefix = _prefix(client)
    token = prefix.split("/")[2]

    assert client.get(f"/cast/{token}/{'b' * 40}/movie.mp4").status_code == 404
    altered = token[:-1] + ("1" if token[-1] == "0" else "0")
    assert client.get(f"/cast/{altered}/{HASH}/movie.mp4").status_code == 404
    assert client.get(f"{prefix}missing.mp4").status_code == 404


def test_cast_link_cannot_escape_the_output_directory(client: TestClient) -> None:
    prefix = _prefix(client)
    outside = Path(app_module.settings.OUTPUT_DIR).parent / "secret.txt"
    outside.write_text("nope")

    response = client.get(f"{prefix}..%2f..%2fsecret.txt")

    assert response.status_code == 404
    assert b"nope" not in response.content
