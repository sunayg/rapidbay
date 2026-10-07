"""Short-lived links that let a Chromecast fetch one torrent's files.

A Chromecast cannot send the password cookie or bearer token, so /play/ is
closed to it when a password is set. A cast link carries its own proof in the
path: ``/cast/<expiry>.<signature>/<magnet_hash>/<file>``. The signature covers
the magnet hash and the expiry. Relative URLs inside an HLS playlist keep the
path prefix, so segments and subtitle playlists are covered by the same link.
"""

import hashlib
import hmac
import secrets
import time

TOKEN_LIFETIME_SECONDS = 12 * 60 * 60

# Links stop working when the server restarts.
_secret = secrets.token_bytes(32)


def _sign(magnet_hash: str, expiry: int) -> str:
    message = f"{magnet_hash}:{expiry}".encode()
    return hmac.new(_secret, message, hashlib.sha256).hexdigest()


def make_token(magnet_hash: str, now: float | None = None) -> str:
    expiry = int((time.time() if now is None else now) + TOKEN_LIFETIME_SECONDS)
    return f"{expiry}.{_sign(magnet_hash, expiry)}"


def verify_token(token: str, magnet_hash: str, now: float | None = None) -> bool:
    expiry_text, separator, signature = token.partition(".")
    if not separator or not expiry_text.isdigit():
        return False
    expiry = int(expiry_text)
    if expiry < (time.time() if now is None else now):
        return False
    return hmac.compare_digest(signature, _sign(magnet_hash, expiry))
