from fastapi import HTTPException, Request

from app.services.auth_manager import AuthManager


def get_current_user(request: Request) -> str:
    user = AuthManager.get_user_by_session(request.cookies.get("session_id"))
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user


def optional_user(request: Request):
    return AuthManager.get_user_by_session(request.cookies.get("session_id"))
