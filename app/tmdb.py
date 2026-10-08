"""Synchronous client for the TMDB v3 API."""

import copy
import threading
import time
from typing import Any, cast

import requests

_CACHE_TTL_SECONDS = 6 * 60 * 60
_CACHE_MISS = object()
_disk_cache: Any = None

# (connect, read) seconds. TMDB answers in well under a second when it is up.
REQUEST_TIMEOUT = (3.05, 8)
# After this many failed requests in a row, skip the network for the cooldown.
_BREAKER_THRESHOLD = 3
_BREAKER_COOLDOWN_SECONDS = 60

_health_lock = threading.Lock()
_consecutive_failures = 0
_open_until = 0.0
_failure_total = 0


def failure_count() -> int:
    """Failed requests so far. Compare before and after a lookup to tell an outage from "no match"."""
    with _health_lock:
        return _failure_total


def is_unavailable() -> bool:
    """True while recent requests kept failing and the client is not calling TMDB."""
    with _health_lock:
        return time.monotonic() < _open_until


def reset_health() -> None:
    global _consecutive_failures, _open_until, _failure_total
    with _health_lock:
        _consecutive_failures = 0
        _open_until = 0.0
        _failure_total = 0


def _record_failure() -> None:
    global _consecutive_failures, _open_until, _failure_total
    with _health_lock:
        _failure_total += 1
        _consecutive_failures += 1
        if _consecutive_failures >= _BREAKER_THRESHOLD:
            _open_until = time.monotonic() + _BREAKER_COOLDOWN_SECONDS


def _record_skipped() -> None:
    """A request the open breaker refused. Counts as a failure without extending the cooldown."""
    global _failure_total
    with _health_lock:
        _failure_total += 1


def _record_success() -> None:
    global _consecutive_failures, _open_until
    with _health_lock:
        _consecutive_failures = 0
        _open_until = 0.0


def tmdb_disk_cache() -> Any:
    """Shared on-disk cache for TMDB responses. Repeat searches skip the network."""
    global _disk_cache
    if _disk_cache is None:
        import os

        import diskcache
        import settings

        _disk_cache = diskcache.Cache(os.path.join(settings.CACHE_DIR, "tmdb"))
    return _disk_cache


class TMDBClient:
    """Make requests to TMDB using an API key.

    Pass a disk cache to reuse search and detail responses. Without one, every
    call goes to the network.
    """

    BASE_URL = "https://api.themoviedb.org/3"
    IMAGE_BASE_URL = "https://image.tmdb.org/t/p/"

    def __init__(self, api_key: str, cache: Any | None = None) -> None:
        self.api_key = api_key
        self._cache = cache

    def _auth(self) -> tuple[dict[str, str], dict[str, str]]:
        # TMDB v4 read tokens are JWTs and must be sent as a bearer token.
        # v3 API keys are sent as the api_key query parameter.
        if self.api_key.count(".") == 2:
            return {}, {"Authorization": f"Bearer {self.api_key}"}
        return {"api_key": self.api_key}, {}

    def _get_json(self, endpoint: str, params: dict[str, str] | None = None) -> dict[str, Any] | None:
        request_params, headers = self._auth()
        if params is not None:
            request_params.update(params)

        request_kwargs: dict[str, Any] = {"params": request_params, "timeout": REQUEST_TIMEOUT}
        if headers:
            request_kwargs["headers"] = headers

        cache_key = (
            endpoint,
            tuple(sorted((key, value) for key, value in request_params.items() if key != "api_key")),
        )
        cached = self._read_cache(cache_key)
        if cached is not None:
            return cached

        if is_unavailable():
            _record_skipped()
            return None

        try:
            response = requests.get(f"{self.BASE_URL}{endpoint}", **request_kwargs)
            if response.status_code == 404:
                # TMDB answered: this id or query has nothing. Not an outage.
                _record_success()
                return None
            if response.status_code != 200:
                _record_failure()
                return None

            data = response.json()
            _record_success()
            if isinstance(data, dict):
                payload = cast("dict[str, Any]", data)
                self._write_cache(cache_key, payload)
                return copy.deepcopy(payload)
            return None
        except Exception:
            # Network failures and invalid JSON should not interrupt search results.
            _record_failure()
            return None

    def _read_cache(self, key: tuple[Any, ...]) -> dict[str, Any] | None:
        if self._cache is None:
            return None
        try:
            cached = self._cache.get(key, default=_CACHE_MISS)
        except Exception:
            return None
        if cached is _CACHE_MISS or not isinstance(cached, dict):
            return None
        return copy.deepcopy(cast("dict[str, Any]", cached))

    def _write_cache(self, key: tuple[Any, ...], data: dict[str, Any]) -> None:
        if self._cache is None:
            return
        try:
            self._cache.set(key, data, expire=_CACHE_TTL_SECONDS)
        except Exception:
            return

    def search_multi(self, query: str) -> dict[str, Any] | None:
        """Search movies and TV shows matching a query."""
        return self._get_json("/search/multi", {"query": query})

    def get_tv_details(self, tv_id: int) -> dict[str, Any] | None:
        """Fetch details for a TV show by its TMDB ID."""
        return self._get_json(f"/tv/{tv_id}")

    def get_tv_season(self, tv_id: int, season_number: int) -> dict[str, Any] | None:
        """Fetch one season, including its episode list."""
        return self._get_json(f"/tv/{tv_id}/season/{season_number}")

    def get_movie_details(self, movie_id: int) -> dict[str, Any] | None:
        """Fetch details for a movie by its TMDB ID."""
        return self._get_json(f"/movie/{movie_id}")

    def get_image_url(self, path: str | None, size: str = "w185") -> str | None:
        """Build a TMDB image URL, or return None for an absent path."""
        if not path:
            return None
        return f"{self.IMAGE_BASE_URL}{size}{path}"
