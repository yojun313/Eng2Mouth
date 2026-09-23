import os
import shutil
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.core.config import settings
from app.db import calls_col, phrases_col, daily_picks_col, sessions_col, users_col
from app.routes.deps import get_current_user
from app.services import gemini_service, openai_service, pricing
from app.services.auth_manager import AuthManager

router = APIRouter()


class SettingsUpdate(BaseModel):
    openai_api_key: str | None = None
    gemini_api_key: str | None = None
    provider: str | None = None
    gemini_voice: str | None = None
    gemini_live_model: str | None = None
    gemini_chat_model: str | None = None
    level: str | None = None
    voice: str | None = None
    persona: str | None = None
    custom_persona: dict | None = None
    correction_mode: str | None = None
    turn_mode: str | None = None
    speed: float | None = None
    realtime_model: str | None = None
    chat_model: str | None = None
    captions: bool | None = None
    allow_korean: bool | None = None
    daily_goal_min: int | None = None
    hide_api_key_notice: bool | None = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


@router.get("/settings")
async def get_settings(user: str = Depends(get_current_user)):
    s = AuthManager.get_user_settings(user)
    for name in ("openai_api_key", "gemini_api_key"):
        key = s.pop(name, "") or ""
        s[name + "_masked"] = (
            (key[:7] + "…" + key[-4:]) if len(key) > 12 else ("설정됨" if key else "")
        )
        s["has_" + name.split("_")[0] + "_key"] = bool(key)
    s["has_api_key"] = s["has_openai_key"] or s["has_gemini_key"]
    return s


@router.post("/settings")
async def update_settings(req: SettingsUpdate, user: str = Depends(get_current_user)):
    data = {k: v for k, v in req.model_dump().items() if v is not None}
    if not AuthManager.update_settings(user, data):
        raise HTTPException(status_code=400, detail="설정 저장 실패")
    return {"status": "ok"}


@router.post("/settings/verify-key")
async def verify_api_key(
    provider: str = "openai", user: str = Depends(get_current_user)
):
    s = AuthManager.get_user_settings(user)
    if provider == "gemini":
        key = (s.get("gemini_api_key") or "").strip()
        if not key:
            raise HTTPException(status_code=400, detail="등록된 Gemini 키가 없습니다.")
        return await gemini_service.verify_key(key)
    key = (s.get("openai_api_key") or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="등록된 OpenAI 키가 없습니다.")
    return await openai_service.verify_key(key)


@router.get("/models")
async def list_models(user: str = Depends(get_current_user)):
    """통화 준비 화면용: 제공자별 선택 가능 모델 + 요금 추정. 키가 있으면 실제 접근 가능한 목록으로 보강한다."""
    s = AuthManager.get_user_settings(user)
    out = {
        "openai": {
            "has_key": bool((s.get("openai_api_key") or "").strip()),
            "voice_models": [
                {
                    "id": m["id"],
                    "label": m["label"],
                    "desc": m["desc"],
                    "estimate": pricing.estimate_10min("openai", m["id"]),
                }
                for m in settings.REALTIME_MODELS
            ],
            "text_models": [
                {"id": m["id"], "label": m["label"]} for m in settings.CHAT_MODELS
            ],
            "voices": settings.VOICES,
        },
        "gemini": {
            "has_key": bool((s.get("gemini_api_key") or "").strip()),
            "voice_models": [
                {
                    "id": "",
                    "label": "자동 (최신 native-audio)",
                    "desc": "키로 접근 가능한 최신 Live 모델",
                    "estimate": pricing.estimate_10min("gemini"),
                }
            ],
            "text_models": [
                {
                    "id": settings.GEMINI_FAST_MODEL,
                    "label": f"{settings.GEMINI_FAST_MODEL} (가장 저렴)",
                },
                {
                    "id": settings.GEMINI_CHAT_MODEL,
                    "label": f"{settings.GEMINI_CHAT_MODEL} (기본)",
                },
                {"id": "gemini-2.5-pro", "label": "gemini-2.5-pro (가장 꼼꼼)"},
            ],
            "voices": settings.GEMINI_VOICES,
        },
        "estimates": {
            "openai": pricing.estimate_10min("openai", settings.REALTIME_MODEL),
            "openai_mini": pricing.estimate_10min(
                "openai", settings.REALTIME_MINI_MODEL
            ),
            "gemini": pricing.estimate_10min("gemini"),
        },
    }
    gkey = (s.get("gemini_api_key") or "").strip()
    if gkey:
        try:
            names = await gemini_service.list_models(gkey)
            live = sorted(
                [
                    n
                    for n in names
                    if ("native-audio" in n or "live" in n) and "tts" not in n
                ],
                reverse=True,
            )
            out["gemini"]["voice_models"] += [
                {
                    "id": n,
                    "label": n,
                    "desc": "",
                    "estimate": pricing.estimate_10min("gemini"),
                }
                for n in live
            ]
            text = [
                n
                for n in names
                if n.startswith("gemini-")
                and "flash" in n
                or n.startswith("gemini-2.5-pro")
                or n.startswith("gemini-3")
            ]
            known = {m["id"] for m in out["gemini"]["text_models"]}
            out["gemini"]["text_models"] += [
                {"id": n, "label": n}
                for n in sorted(text)
                if n not in known
                and "tts" not in n
                and "audio" not in n
                and "image" not in n
                and "live" not in n
            ][:20]
        except Exception as e:  # noqa: BLE001
            out["gemini"]["error"] = str(getattr(e, "detail", e))
    okey = (s.get("openai_api_key") or "").strip()
    if okey:
        try:
            r = await openai_service.verify_key(okey)
            out["openai"]["verified"] = r
        except Exception as e:  # noqa: BLE001
            out["openai"]["error"] = str(getattr(e, "detail", e))
    return out


@router.get("/settings/usage")
async def usage(user: str = Depends(get_current_user)):
    await pricing.refresh_rate()
    usd = AuthManager.get_usage(user)
    return {"total_spent_usd": round(usd, 4), "total_spent_krw": pricing.to_krw(usd), **pricing.rate_info()}


@router.post("/settings/password")
async def change_password(req: PasswordChange, user: str = Depends(get_current_user)):
    r = AuthManager.change_password(user, req.current_password, req.new_password)
    if r == "wrong_password":
        raise HTTPException(
            status_code=400, detail="현재 비밀번호가 올바르지 않습니다."
        )
    if r == "weak_password":
        raise HTTPException(
            status_code=400, detail="새 비밀번호는 6자 이상이어야 합니다."
        )
    return {"status": "ok"}


@router.post("/user/profile-image")
async def upload_profile_image(
    file: UploadFile = File(...), user: Any = Depends(get_current_user)
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        raise HTTPException(
            status_code=400, detail="이미지 파일(JPG/PNG/WEBP)만 업로드할 수 있습니다."
        )
    os.makedirs(settings.PROFILE_DIR, exist_ok=True)
    for old in os.listdir(settings.PROFILE_DIR):
        if old.startswith(user + "."):
            try:
                os.remove(os.path.join(settings.PROFILE_DIR, old))
            except OSError:
                pass
    path = os.path.join(settings.PROFILE_DIR, f"{user}{ext}")
    with open(path, "wb") as out:
        shutil.copyfileobj(file.file, out)
    url = f"/static/profiles/{user}{ext}?v={int(os.path.getmtime(path))}"
    users_col.update_one({"username": user}, {"$set": {"profile_img": url}})
    return {"status": "ok", "url": url}


@router.get("/user/export")
async def export_data(user: str = Depends(get_current_user)):
    """내 데이터 전체 내보내기 (JSON)."""
    from app.services.call_service import serialize_call

    calls = [
        serialize_call(c, full=True)
        for c in calls_col.find({"owner": user}).sort("started_at", -1)
    ]
    phrases = list(phrases_col.find({"owner": user}, {"_id": 0, "owner": 0}))
    for p in phrases:
        if p.get("created_at"):
            p["created_at"] = p["created_at"].isoformat()
    s = AuthManager.get_user_settings(user)
    s.pop("openai_api_key", None)
    return {"user": s, "calls": calls, "phrases": phrases}


@router.delete("/user/account")
async def delete_account(
    password: str = Form(...), user: str = Depends(get_current_user)
):
    if not AuthManager.authenticate_user(user, password):
        raise HTTPException(status_code=400, detail="비밀번호가 올바르지 않습니다.")
    calls_col.delete_many({"owner": user})
    phrases_col.delete_many({"owner": user})
    daily_picks_col.delete_many({"owner": user})
    sessions_col.delete_many({"username": user})
    users_col.delete_one({"username": user})
    return {"status": "ok"}
