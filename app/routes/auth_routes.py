from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.core.config import settings
from app.services.auth_manager import AuthManager

router = APIRouter()
COOKIE_AGE = 60 * 60 * 24 * 30


class VerifyRequest(BaseModel):
    email: str
    code: str


@router.post("/auth/signup/request")
async def signup_request(
    username: str = Form(...), password: str = Form(...), email: str = Form("")
):
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
    raise HTTPException(
        status_code=400 if result != "mail_failed" else 500, detail=detail
    )


@router.post("/auth/signup/verify")
async def signup_verify(req: VerifyRequest):
    if AuthManager.verify_and_create_user(req.email.strip().lower(), req.code.strip()):
        return {"message": "created"}
    raise HTTPException(
        status_code=400, detail="인증 코드가 올바르지 않거나 만료되었습니다."
    )


@router.post("/auth/login")
async def login(username: str = Form(...), password: str = Form(...)):
    session_id = AuthManager.authenticate_user(username.strip(), password)
    if not session_id:
        raise HTTPException(
            status_code=401, detail="아이디 또는 비밀번호가 올바르지 않습니다."
        )
    resp = JSONResponse(content={"message": "ok"})
    resp.set_cookie(
        "session_id", session_id, httponly=True, max_age=COOKIE_AGE, samesite="lax"
    )
    return resp


@router.post("/auth/logout")
async def logout_api(request: Request):
    AuthManager.logout(request.cookies.get("session_id"))
    resp = JSONResponse(content={"message": "ok"})
    resp.delete_cookie("session_id")
    return resp


@router.get("/auth/config")
async def auth_config():
    return {"require_email": settings.SIGNUP_REQUIRE_EMAIL}
