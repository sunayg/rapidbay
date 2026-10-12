from unittest.mock import patch

import jackett
import prowlarr
from common import size_bytes


def test_size_bytes_accepts_positive_numbers_and_numeric_strings() -> None:
    assert size_bytes(1_500_000_000) == 1_500_000_000
    assert size_bytes("734003200") == 734003200
    assert size_bytes(1.5e9) == 1_500_000_000


def test_size_bytes_rejects_missing_zero_negative_and_junk() -> None:
    for value in (None, 0, -5, "", "big", True, float("inf"), [], {}):
        assert size_bytes(value) is None


def test_jackett_results_carry_the_indexer_size() -> None:
    raw = [
        {"Title": "A", "Seeders": 5, "Size": 1234, "MagnetUri": "magnet:?xt=urn:btih:" + "a" * 40, "Category": [2000]},
        {"Title": "B", "Seeders": 3, "MagnetUri": "magnet:?xt=urn:btih:" + "b" * 40, "Category": [2000]},
    ]
    parsed = jackett._parse_results(raw, "term")  # pyright: ignore[reportPrivateUsage]
    assert [r["size"] for r in parsed] == [1234, None]


def test_prowlarr_results_carry_the_indexer_size() -> None:
    raw = [
        {"title": "A", "seeders": 5, "size": 4321, "magnetUrl": "magnet:?xt=urn:btih:" + "a" * 40},
        {"title": "B", "seeders": 3, "size": 0, "magnetUrl": "magnet:?xt=urn:btih:" + "b" * 40},
    ]
    with patch.object(prowlarr.torrent, "get_hash", side_effect=lambda m: m[-40:]):
        parsed = prowlarr._parse_results(raw, "term")  # pyright: ignore[reportPrivateUsage]
    assert [r["size"] for r in parsed] == [4321, None]
