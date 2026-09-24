"""RFC 6238 TOTP — 표준 라이브러리만 사용 (2단계 인증)."""

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def totp_code(secret_b32: str, counter: int, digits: int = 6) -> str:
    key = base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8), casefold=True)
    h = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    o = h[-1] & 0x0F
    return str((int.from_bytes(h[o:o + 4], "big") & 0x7FFFFFFF) % 10 ** digits).zfill(digits)


def verify(secret_b32: str, code: str, last_used_step: int | None = None, window: int = 1) -> int | None:
    """맞으면 사용한 time step 을 반환(재사용 방지용), 틀리면 None. ±30초 허용."""
    code = (code or "").strip().replace(" ", "")
    if not code.isdigit() or len(code) != 6:
        return None
    step = int(time.time() // 30)
    for delta in range(-window, window + 1):
        s = step + delta
        if last_used_step is not None and s <= last_used_step:
            continue
        if hmac.compare_digest(totp_code(secret_b32, s), code):
            return s
    return None


def otpauth_uri(secret_b32: str, username: str, issuer: str = "Eng2Mouth") -> str:
    return f"otpauth://totp/{quote(issuer)}:{quote(username)}?secret={secret_b32}&issuer={quote(issuer)}&digits=6&period=30"
