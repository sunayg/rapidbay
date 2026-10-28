import os
import re
import threading
from typing import Any, Callable, Dict, Iterable, List, Pattern, cast

import diskcache
import settings

# CJK, Hangul, Hiragana/Katakana, Cyrillic, Arabic, Hebrew, Thai, Devanagari ranges.
# Used by the trending filter to skip non-Latin-script titles.
_NON_LATIN_RE: Pattern[str] = re.compile(
    "["
    + "Ѐ-ԯ"        # Cyrillic + Cyrillic Supplement
    + "֐-׿"        # Hebrew
    + "؀-ۿ"        # Arabic
    + "ݐ-ݿ"        # Arabic Supplement
    + "ऀ-ॿ"        # Devanagari
    + "฀-๿"        # Thai
    + "　-ヿ"        # CJK Symbols and Punctuation, Hiragana, Katakana
    + "㐀-䶿"        # CJK Extension A
    + "一-鿿"        # CJK Unified Ideographs
    + "가-힯"        # Hangul Syllables
    + "豈-﫿"        # CJK Compatibility Ideographs
    + "＀-￯"        # Halfwidth and Fullwidth Forms
    + "]"
)
_blocklist_cache: tuple[tuple[str, ...], Pattern[str] | None] = ((), None)


def _get_trending_title_blocklist_re() -> Pattern[str] | None:
    """Compiled blocklist, rebuilt whenever the setting changes at runtime."""
    global _blocklist_cache
    patterns = tuple(settings.TRENDING_TITLE_BLOCKLIST)
    if _blocklist_cache[0] != patterns:
        compiled = re.compile("|".join(patterns), re.IGNORECASE) if patterns else None
        _blocklist_cache = (patterns, compiled)
    return _blocklist_cache[1]


def size_bytes(value: Any) -> int | None:
    """Indexer-reported size in bytes, or None when missing or not a positive number."""
    if isinstance(value, bool):
        return None
    try:
        size = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return size if size > 0 else None


def should_drop_from_trending(title: str | None, categories: Iterable[int] | None) -> bool:
    """Filter applied only to the empty-search trending feed.

    Drops a result if any of:
      - one of its Newznab/Torznab category ids is in EXCLUDE_CATEGORIES_FROM_TRENDING
      - its title matches the TRENDING_TITLE_BLOCKLIST regex
      - TRENDING_BLOCK_NON_LATIN_TITLES is True and the title contains non-Latin script
    """
    if categories and settings.EXCLUDE_CATEGORIES_FROM_TRENDING:
        excluded = set(settings.EXCLUDE_CATEGORIES_FROM_TRENDING)
        for c in categories:
            if c in excluded:
                return True
    if not title:
        return False
    blocklist_re = _get_trending_title_blocklist_re()
    if blocklist_re is not None and blocklist_re.search(title):
        return True
    return bool(
        settings.TRENDING_BLOCK_NON_LATIN_TITLES and _NON_LATIN_RE.search(title)
    )


def threaded(fn: Callable[..., Any]) -> Callable[..., threading.Thread]:
    def wrapper(*args: Any, **kwargs: Any) -> threading.Thread:
        thread = threading.Thread(target=fn, args=args, kwargs=kwargs)
        thread.start()
        return thread

    return wrapper


def path_hierarchy(path: str) -> Dict[str, List[Any]] | List[Any] | str:
    hierarchy = os.path.basename(path)
    try:
        return {
            hierarchy: [
                path_hierarchy(os.path.join(path, contents))
                for contents in os.listdir(path)
            ]
        }
    except OSError:
        pass
    if hierarchy == "":
        return []
    return hierarchy


def normalize_filename(s: str) -> str:
    """Normalize filename to ASCII alphanumerics for matching, preserving path separators and periods."""
    return "".join(c for c in s if (c.isalnum() and c.isascii()) or c in "/\\.")


def clear_memoized(module_name: str) -> int:
    """Drop cached memoize() results for functions defined in `module_name`."""
    cache = cast(Any, diskcache.Cache(settings.CACHE_DIR))
    try:
        stale: list[Any] = [k for k in cache.iterkeys() if isinstance(k, tuple) and k and k[0] == module_name]
        for k in stale:
            del cache[k]
        return len(stale)
    finally:
        cache.close()


def memoize(expire: int = 300) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        cache = diskcache.Cache(settings.CACHE_DIR)

        def wrapper(*args: Any, **kwargs: Any) -> Any:
            # Include the function identity in the key: all memoized functions
            # share the same cache directory, so e.g. jackett.search("x") and
            # prowlarr.search("x") would otherwise collide.
            key = (func.__module__, func.__qualname__, args, frozenset(kwargs.items()))
            if key in cache:
                return cache[key]
            result = func(*args, **kwargs)
            if result:
                cache.set(key, result, expire=expire)
            return result

        return wrapper
    return decorator
