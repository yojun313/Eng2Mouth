from fastapi import APIRouter, Depends

from app.routes.deps import get_current_user
from app.services.auth_manager import AuthManager
from app.services.call_service import dashboard_stats

router = APIRouter()


@router.get("/stats/dashboard")
async def stats(user: str = Depends(get_current_user)):
    s = AuthManager.get_user_settings(user)
    return dashboard_stats(user, int(s.get("daily_goal_min") or 10))


@router.get("/stats/badge")
async def badge(user: str = Depends(get_current_user)):
    from app.db import calls_col, phrases_col

    return {
        "unevaluated": calls_col.count_documents({"owner": user, "status": "ended"}),
        "phrase_due": phrases_col.count_documents({"owner": user, "learned": {"$ne": True}}),
    }
