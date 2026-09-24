from fastapi import HTTPException, Request

from app.core.security import get_session_id
from app.services.auth_manager import AuthManager


def get_current_user(request: Request) -> str:
    user = AuthManager.get_user_by_session(get_session_id(request))
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user


def optional_user(request: Request):
    return AuthManager.get_user_by_session(get_session_id(request))
