"""정적 파일 버전 주소 + 캐시 정책 (prompts/10-perceived-speed §1).

템플릿에서 {{ asset('shared/app.css') }} → /static/shared/app.css?v=<mtime·크기 해시>.
?v= 가 붙은 요청만 1년 immutable 로 캐시시키고, 파일을 고치면 주소가 바뀌므로 새로고침 없이 새 파일을 받는다.
HTML · API 는 보안 미들웨어가 계속 no-store.
"""

from pathlib import Path

STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "static"
_cache: dict[str, tuple[int, int, str]] = {}


def asset_url(path: str) -> str:
    rel = path.lstrip("/")
    if rel.startswith("static/"):
        rel = rel[len("static/"):]
    try:
        st = (STATIC_DIR / rel).stat()
    except OSError:
        return f"/static/{rel}"
    hit = _cache.get(rel)
    if hit and hit[0] == st.st_mtime_ns and hit[1] == st.st_size:
        return hit[2]
    url = f"/static/{rel}?v={format((st.st_mtime_ns ^ (st.st_size << 20)) & 0xFFFFFFFFFF, 'x')}"
    _cache[rel] = (st.st_mtime_ns, st.st_size, url)
    return url


def install(templates) -> None:
    """Jinja2Templates 마다 한 번 호출 (빠뜨리면 asset 이 정의되지 않았다는 오류)."""
    templates.env.globals["asset"] = asset_url


def static_cache_control(path: str, query: str) -> bytes | None:
    if path in ("/sw.js", "/manifest.webmanifest", "/favicon.ico"):
        return b"no-cache"
    if not path.startswith("/static/"):
        return None                                        # 페이지 · API 는 no-store 그대로
    versioned = any(p.startswith("v=") for p in query.split("&"))
    if path.startswith("/static/profiles/"):
        # 업로드 때마다 ?v=<mtime> 이 바뀌므로 버전 주소면 오래 캐시 (사용자 사진이라 private)
        return b"private, max-age=31536000, immutable" if versioned else b"private, no-cache"
    if versioned:
        return b"public, max-age=31536000, immutable"
    if path.startswith("/static/vendor/"):
        return b"public, max-age=2592000"                  # CSS 안에서 상대 경로로 부르는 글꼴 등
    return b"no-cache"                                     # 아이콘 · manifest: ETag 로 304
