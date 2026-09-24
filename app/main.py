import os

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.core.security import SecurityMiddleware
from app.db import ensure_indexes
from app.routes import (
    assist_routes,
    auth_routes,
    call_routes,
    phrase_routes,
    stats_routes,
    topic_routes,
    user_routes,
    view_routes,
)

app = FastAPI(title=settings.APP_NAME, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(SecurityMiddleware)


@app.exception_handler(RequestValidationError)
async def _validation_error(request, exc):
    # 스키마(필드명 · 타입)를 노출하지 않는다
    return JSONResponse(status_code=422, content={"detail": "잘못된 요청입니다."})


@app.on_event("startup")
async def on_startup():
    try:
        ensure_indexes()
        from app.services.auth_manager import AuthManager

        n = AuthManager.migrate_legacy_sessions()
        if n:
            print(f"[INFO] migrated {n} legacy sessions to hashed ids")
    except Exception as e:  # noqa: BLE001
        print(f"[WARN] index/migration skipped: {e}")
    try:
        from app.services import pricing

        await pricing.refresh_rate(force=True)
    except Exception as e:  # noqa: BLE001
        print(f"[WARN] exchange rate fetch failed: {e}")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse(os.path.join(settings.STATIC_DIR, "favicon.ico"))


@app.get("/manifest.webmanifest", include_in_schema=False)
async def manifest():
    return FileResponse(
        os.path.join(settings.STATIC_DIR, "manifest.webmanifest"),
        media_type="application/manifest+json",
    )


@app.get("/sw.js", include_in_schema=False)
async def service_worker():
    return FileResponse(
        os.path.join(settings.STATIC_DIR, "sw.js"),
        media_type="application/javascript",
        headers={"Service-Worker-Allowed": "/", "Cache-Control": "no-cache"},
    )


app.mount("/static", StaticFiles(directory=settings.STATIC_DIR), name="static")

app.include_router(view_routes.router)
app.include_router(auth_routes.router, prefix="/api", tags=["Auth"])
app.include_router(user_routes.router, prefix="/api", tags=["User"])
app.include_router(call_routes.router, prefix="/api", tags=["Calls"])
app.include_router(topic_routes.router, prefix="/api", tags=["Topics"])
app.include_router(assist_routes.router, prefix="/api", tags=["Assist"])
app.include_router(phrase_routes.router, prefix="/api", tags=["Phrases"])
app.include_router(stats_routes.router, prefix="/api", tags=["Stats"])
