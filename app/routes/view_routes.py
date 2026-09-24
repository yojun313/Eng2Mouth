from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from app.core.config import settings
from app.routes.deps import optional_user
from app.services.auth_manager import AuthManager
from app.services.personas import public_personas

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


def _ctx(request: Request, user: str, page: str, **extra) -> dict:
    s = AuthManager.get_user_settings(user)
    s_public = dict(s)
    key = s_public.pop("openai_api_key", "") or ""
    gkey = s_public.pop("gemini_api_key", "") or ""
    s_public["has_openai_key"] = bool(key)
    s_public["has_gemini_key"] = bool(gkey)
    s_public["has_api_key"] = bool(key or gkey)
    mask = lambda k: (k[:7] + "…" + k[-4:]) if len(k) > 12 else ("설정됨" if k else "")  # noqa: E731
    ctx = {
        "request": request,
        "username": user,
        "settings": s_public,
        "settings_masked": mask(key),
        "gemini_masked": mask(gkey),
        "page": page,
        "app": settings,
        "personas": public_personas(),
        "page_data": {},
    }
    ctx.update(extra)
    return ctx


def _page(request: Request, name: str, page: str, **extra):
    user = optional_user(request)
    if not user:
        return RedirectResponse(url="/login", status_code=302)
    return templates.TemplateResponse(request, name, _ctx(request, user, page, **extra))


@router.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """접속 시: 로그인 전이면 서비스 소개(랜딩), 로그인 후면 대시보드."""
    user = optional_user(request)
    if not user:
        return templates.TemplateResponse(
            request,
            "landing.html",
            {"request": request, "app": settings, "personas": public_personas()},
        )
    return _page(request, "dashboard.html", "home")


@router.get("/about", response_class=HTMLResponse)
async def about(request: Request):
    """로그인한 사용자도 소개 페이지를 볼 수 있는 주소."""
    return templates.TemplateResponse(
        request,
        "landing.html",
        {"request": request, "app": settings, "personas": public_personas()},
    )


@router.get("/call", response_class=HTMLResponse)
async def call_page(request: Request):
    return _page(request, "call.html", "call")


@router.get("/history", response_class=HTMLResponse)
async def history_page(request: Request):
    return _page(request, "history.html", "history")


@router.get("/history/{call_id}", response_class=HTMLResponse)
async def call_detail_page(request: Request, call_id: str):
    # 목록+상세 한 페이지 (모바일: 슬라이드 패널, 데스크톱: 마스터-디테일). 새로고침해도 같은 통화가 열린다.
    return _page(request, "history.html", "history", call_id=call_id)


@router.get("/phrases", response_class=HTMLResponse)
async def phrases_page(request: Request):
    return _page(request, "phrases.html", "phrases")


@router.get("/topics", response_class=HTMLResponse)
async def topics_page(request: Request):
    return _page(request, "topics.html", "topics")


@router.get("/settings", response_class=HTMLResponse)
async def settings_page(request: Request):
    return _page(request, "settings.html", "settings")


@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    if optional_user(request):
        return RedirectResponse(url="/", status_code=302)
    return templates.TemplateResponse(
        request, "login.html", {"request": request, "app": settings}
    )


@router.get("/signup", response_class=HTMLResponse)
async def signup_page(request: Request):
    return templates.TemplateResponse(
        request,
        "signup.html",
        {
            "request": request,
            "app": settings,
            "require_email": settings.SIGNUP_REQUIRE_EMAIL,
        },
    )


@router.get("/logout")
async def logout_get():
    """GET 로그아웃은 CSRF(<img src=/logout>)에 악용될 수 있어 지원하지 않는다. 사이드바 버튼이 POST /api/auth/logout 을 부른다."""
    return RedirectResponse(url="/", status_code=302)


@router.get("/guide/openai", response_class=HTMLResponse)
async def guide(request: Request):
    return templates.TemplateResponse(
        request, "guide_openai.html", {"request": request, "app": settings}
    )
