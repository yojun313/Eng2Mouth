import logging

from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.core.config import settings
from app.core.security import clear_session_cookie, client_ip, get_session_id, login_limiter, set_session_cookie
from app.services import totp
from app.services.auth_manager import AuthManager

router = APIRouter()
log = logging.getLogger("eng2mouth.auth")
LOGIN_FAIL_MSG = "로그인 정보가 올바르지 않습니다."


class VerifyRequest(BaseModel):
    email: str
    code: str


@router.post("/auth/signup/request")
async def signup_request(username: str = Form(...), password: str = Form(...), email: str = Form("")):
    username = username.strip()
    email = email.strip().lower()
    if settings.SIGNUP_REQUIRE_EMAIL and not email:
        raise HTTPException(status_code=400, detail="이메일을 입력해 주세요.")
    result = AuthManager.request_signup(username, password, email)
    if result == "success":
        return {"message": "verification_sent", "verify": True}
    if result == "created":
        return {"message": "created", "verify": False}
    detail = {
        "username_exists": "이미 사용 중인 아이디입니다.",
        "email_exists": "이미 가입된 이메일입니다.",
        "invalid_username": "아이디는 영문/숫자/._- 3~24자여야 합니다.",
        "weak_password": "비밀번호는 6자 이상이어야 합니다.",
        "mail_failed": "인증 메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    }.get(result, "회원가입 실패")
    raise HTTPException(status_code=400 if result != "mail_failed" else 500, detail=detail)


@router.post("/auth/signup/verify")
async def signup_verify(req: VerifyRequest):
    if AuthManager.verify_and_create_user(req.email.strip().lower(), req.code.strip()):
        return {"message": "created"}
    raise HTTPException(status_code=400, detail="인증 코드가 올바르지 않거나 만료되었습니다.")


@router.post("/auth/login")
async def login(request: Request, username: str = Form(...), password: str = Form(...), code: str = Form("")):
    ip = client_ip(request)
    ua = request.headers.get("user-agent", "")
    wait = login_limiter.blocked(ip)
    if wait:
        log.warning("login blocked ip=%s user=%s wait=%ss", ip, username, wait)
        raise HTTPException(status_code=429, detail=f"로그인 시도가 너무 많습니다. {max(1, wait // 60)}분 후 다시 시도해 주세요.")
    username = username.strip()
    user = AuthManager.check_password(username, password)
    if not user:
        login_limiter.fail(ip)
        log.info("login fail ip=%s user=%s ua=%s", ip, username, ua[:80])
        raise HTTPException(status_code=401, detail=LOGIN_FAIL_MSG)
    if user.get("totp_enabled"):
        # 비밀번호가 맞을 때만 코드 검사 (틀린 비밀번호로 유효 코드를 소모시키지 못하게)
        if not code:
            return JSONResponse(status_code=200, content={"message": "totp_required", "totp_required": True})
        step = totp.verify(user.get("totp_secret", ""), code, last_used_step=user.get("totp_last_step"))
        if step is None:
            login_limiter.fail(ip)
            log.info("login totp fail ip=%s user=%s", ip, username)
            raise HTTPException(status_code=401, detail="인증 코드가 올바르지 않습니다.")
        AuthManager.totp_mark_used(username, step)
    login_limiter.success(ip)
    session_id = AuthManager.create_session(username, ip=ip, user_agent=ua)
    log.info("login ok ip=%s user=%s ua=%s", ip, username, ua[:80])
    resp = JSONResponse(content={"message": "ok"})
    set_session_cookie(resp, session_id, request)
    return resp


@router.post("/auth/logout")
async def logout_api(request: Request):
    sid = get_session_id(request)
    user = AuthManager.get_user_by_session(sid)
    AuthManager.logout(sid)
    log.info("logout ip=%s user=%s", client_ip(request), user)
    resp = JSONResponse(content={"message": "ok"})
    clear_session_cookie(resp)
    return resp


@router.post("/auth/logout-all")
async def logout_all(request: Request):
    sid = get_session_id(request)
    user = AuthManager.get_user_by_session(sid)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    n = AuthManager.logout_all(user, keep_session_id=sid)
    return {"message": "ok", "removed": n}


@router.get("/auth/config")
async def auth_config():
    return {"require_email": settings.SIGNUP_REQUIRE_EMAIL}
