"""
보안 미들웨어/헬퍼 (05-security 스킬셋 반영).
- 보안 헤더 + CSP (script-src 'self', 외부는 통화 API 연결만 허용)
- CSRF: 상태 변경 요청과 WebSocket 은 Origin/Referer 가 같은 호스트일 때만
- 요청 본문 크기 제한
- 로그인 무차별 대입 제한 (IP 별 + 전체)
- 세션 쿠키 이름/속성 (HTTPS 면 __Host- 접두사 + Secure)
"""

import hashlib
import hmac
import logging
import os
import threading
import time
from collections import defaultdict, deque
from urllib.parse import urlsplit

from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.assets import static_cache_control

log = logging.getLogger("eng2mouth.security")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

SESSION_HTTPS_ONLY = os.getenv("SESSION_HTTPS_ONLY", "false").strip().lower() in ("1", "true", "yes", "on")
ALLOWED_HOSTS = [h.strip().lower() for h in os.getenv("ALLOWED_HOSTS", "").split(",") if h.strip()]
SESSION_COOKIE = "__Host-session_id" if SESSION_HTTPS_ONLY else "session_id"
SESSION_MAX_AGE = int(os.getenv("SESSION_MAX_AGE_DAYS", "30")) * 86400
SESSION_IDLE_AGE = int(os.getenv("SESSION_IDLE_DAYS", "14")) * 86400
MAX_BODY = int(os.getenv("MAX_BODY_BYTES", str(2 * 1024 * 1024)))          # JSON/폼 2MB
MAX_UPLOAD = int(os.getenv("MAX_UPLOAD_BYTES", str(5 * 1024 * 1024)))      # 프로필 이미지 5MB

CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: data:",
    # 통화: OpenAI Realtime(WebRTC SDP POST) · Gemini Live(WebSocket) 에 브라우저가 직접 연결한다
    "connect-src 'self' https://api.openai.com https://generativelanguage.googleapis.com wss://generativelanguage.googleapis.com",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])

SECURITY_HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    # 통화에 마이크가 필요하다. 그 외 권한은 모두 차단
    "Permissions-Policy": "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), clipboard-read=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
}


def hash_token(token: str) -> str:
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()


def constant_eq(a: str, b: str) -> bool:
    return hmac.compare_digest((a or "").encode(), (b or "").encode())


def _header(scope: Scope, name: bytes) -> str:
    for k, v in scope.get("headers", []):
        if k == name:
            return v.decode("latin-1")
    return ""


def request_host(scope: Scope) -> str:
    return (_header(scope, b"x-forwarded-host") or _header(scope, b"host")).split(",")[0].strip().lower()


def is_https(scope: Scope) -> bool:
    return scope.get("scheme") == "https" or _header(scope, b"x-forwarded-proto").split(",")[0].strip().lower() == "https"


def is_same_origin(scope: Scope) -> bool:
    source = _header(scope, b"origin") or _header(scope, b"referer")
    if not source or source == "null":
        return False
    netloc = urlsplit(source).netloc.lower()
    allowed = {request_host(scope), _header(scope, b"host").lower(), *ALLOWED_HOSTS}
    return netloc in allowed


class SecurityMiddleware:
    """헤더 · CSRF · 본문 크기 · Host 허용 목록을 한 번에 처리하는 순수 ASGI 미들웨어."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)

        host = request_host(scope).split(":")[0]
        if ALLOWED_HOSTS and host not in ALLOWED_HOSTS and host not in ("127.0.0.1", "localhost"):
            return await self._reject(scope, send, 400, "잘못된 호스트입니다.")

        method = scope.get("method", "GET")
        path = scope.get("path", "")
        if scope["type"] == "websocket" or method in ("POST", "PUT", "PATCH", "DELETE"):
            if not is_same_origin(scope):
                log.warning("CSRF blocked %s %s from %s", method, path, _header(scope, b"origin") or "-")
                return await self._reject(scope, send, 403, "요청 출처를 확인할 수 없습니다.")

        if scope["type"] == "http":
            limit = MAX_UPLOAD if path.startswith("/api/user/profile-image") else MAX_BODY
            try:
                declared = int(_header(scope, b"content-length") or 0)
            except ValueError:
                declared = 0
            if declared > limit:
                return await self._reject(scope, send, 413, "요청이 너무 큽니다.")
            received = 0

            async def limited_receive():
                nonlocal received
                message = await receive()
                if message.get("type") == "http.request":
                    received += len(message.get("body") or b"")
                    if received > limit:
                        raise RuntimeError("body too large")
                return message

            async def send_with_headers(message):
                if message["type"] == "http.response.start":
                    headers = list(message.get("headers", []))
                    existing = {k.lower() for k, _ in headers}
                    for k, v in SECURITY_HEADERS.items():
                        if k == "X-Robots-Tag" and path in ("/", "/about"):
                            continue  # 소개 페이지는 검색 허용
                        if k.lower().encode() not in existing:
                            headers.append((k.lower().encode(), v.encode()))
                    if b"cache-control" not in existing:
                        query = (scope.get("query_string") or b"").decode("latin-1")
                        headers.append((b"cache-control", static_cache_control(path, query) or b"no-store"))
                    if is_https(scope):
                        headers.append((b"strict-transport-security", b"max-age=63072000; includeSubDomains"))
                        headers[:] = [(k, (v.decode() + "; upgrade-insecure-requests").encode() if k == b"content-security-policy" else v) for k, v in headers]
                    message["headers"] = headers
                await send(message)

            try:
                return await self.app(scope, limited_receive, send_with_headers)
            except RuntimeError as e:
                if "body too large" in str(e):
                    return await self._reject(scope, send, 413, "요청이 너무 큽니다.")
                raise
        return await self.app(scope, receive, send)

    async def _reject(self, scope, send, status, detail):
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        body = ('{"detail":"%s"}' % detail).encode("utf-8")
        await send({"type": "http.response.start", "status": status, "headers": [(b"content-type", b"application/json; charset=utf-8"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})


class LoginLimiter:
    """IP 별 15분 5회, 전체 15분 30회 실패 시 잠금."""

    def __init__(self, per_ip=5, total=30, window=900):
        self.per_ip, self.total, self.window = per_ip, total, window
        self.fails: dict[str, deque] = defaultdict(deque)
        self.all: deque = deque()
        self.lock = threading.Lock()

    def _prune(self, dq: deque, now: float):
        while dq and now - dq[0] > self.window:
            dq.popleft()

    def blocked(self, ip: str) -> int:
        """남은 잠금 초. 0 이면 허용."""
        now = time.time()
        with self.lock:
            self._prune(self.all, now)
            dq = self.fails[ip]
            self._prune(dq, now)
            if len(dq) >= self.per_ip:
                return int(self.window - (now - dq[0])) + 1
            if len(self.all) >= self.total:
                return int(self.window - (now - self.all[0])) + 1
        return 0

    def fail(self, ip: str):
        now = time.time()
        with self.lock:
            self.fails[ip].append(now)
            self.all.append(now)

    def success(self, ip: str):
        with self.lock:
            self.fails.pop(ip, None)


login_limiter = LoginLimiter()


def client_ip(request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "?"


def set_session_cookie(response, session_id: str, request=None):
    secure = SESSION_HTTPS_ONLY or (request is not None and is_https(request.scope))
    response.set_cookie(
        SESSION_COOKIE, session_id, httponly=True, secure=secure, samesite="strict",
        max_age=SESSION_MAX_AGE, path="/",
    )


def clear_session_cookie(response):
    response.delete_cookie(SESSION_COOKIE, path="/")
    if SESSION_COOKIE != "session_id":
        response.delete_cookie("session_id", path="/")


def get_session_id(request) -> str | None:
    return request.cookies.get(SESSION_COOKIE) or (None if SESSION_HTTPS_ONLY else request.cookies.get("session_id"))
