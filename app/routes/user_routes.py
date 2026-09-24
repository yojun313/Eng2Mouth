import os
import secrets
from typing import Any

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from pydantic import BaseModel

from app.core.config import settings
from app.core.security import MAX_UPLOAD, get_session_id
from app.services import totp
from app.db import calls_col, daily_picks_col, phrases_col, sessions_col, users_col
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


IMAGE_MAGIC = {
    b"\x89PNG\r\n\x1a\n": ".png",
    b"\xff\xd8\xff": ".jpg",
    b"GIF87a": ".gif",
    b"GIF89a": ".gif",
}


def _sniff_image(head: bytes) -> str | None:
    for magic, ext in IMAGE_MAGIC.items():
        if head.startswith(magic):
            return ext
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp"
    return None


@router.post("/user/profile-image")
async def upload_profile_image(request: Request, user: str = Depends(get_current_user)):
    """프로필 이미지: 로그인 확인 후에만 본문을 읽고, 스트리밍하며 크기를 검사한다. 파일명은 서버가 정한다."""
    try:
        declared = int(request.headers.get("content-length") or 0)
    except ValueError:
        declared = 0
    if declared > MAX_UPLOAD:
        raise HTTPException(status_code=413, detail="이미지는 5MB 이하만 올릴 수 있습니다.")
    os.makedirs(settings.PROFILE_DIR, exist_ok=True)
    tmp_name = f".{user}-{secrets.token_hex(6)}.part"
    tmp_path = os.path.join(settings.PROFILE_DIR, tmp_name)
    size, head, ext = 0, b"", None
    fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as out:
            async for chunk in request.stream():
                if not chunk:
                    continue
                if len(head) < 16:
                    head += chunk[: 16 - len(head)]
                    if len(head) >= 12 and ext is None:
                        ext = _sniff_image(head)
                        if not ext:
                            raise HTTPException(status_code=400, detail="이미지 파일(JPG/PNG/WEBP/GIF)만 업로드할 수 있습니다.")
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise HTTPException(status_code=413, detail="이미지는 5MB 이하만 올릴 수 있습니다.")
                out.write(chunk)
        if not ext or size == 0:
            raise HTTPException(status_code=400, detail="이미지를 읽을 수 없습니다.")
        for old in os.listdir(settings.PROFILE_DIR):
            if old.startswith(user + ".") or (old.startswith("." + user + "-") and old != tmp_name):
                try:
                    os.remove(os.path.join(settings.PROFILE_DIR, old))
                except OSError:
                    pass
        final = os.path.join(settings.PROFILE_DIR, f"{user}{ext}")
        os.replace(tmp_path, final)
    except Exception:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise
    url = f"/static/profiles/{user}{ext}?v={int(os.path.getmtime(final))}"
    users_col.update_one({"username": user}, {"$set": {"profile_img": url}})
    return {"status": "ok", "url": url}


# ---- 2단계 인증 ----
class TotpCode(BaseModel):
    code: str


class PasswordOnly(BaseModel):
    password: str


@router.get("/security/status")
async def security_status(request: Request, user: str = Depends(get_current_user)):
    return {**AuthManager.totp_status(user), "sessions": AuthManager.list_sessions(user, get_session_id(request))}


@router.post("/security/totp/begin")
async def totp_begin(req: PasswordOnly, user: str = Depends(get_current_user)):
    if not AuthManager.check_password(user, req.password):
        raise HTTPException(status_code=400, detail="비밀번호가 올바르지 않습니다.")
    secret = totp.new_secret()
    AuthManager.totp_begin(user, secret)
    return {"secret": secret, "uri": totp.otpauth_uri(secret, user)}


@router.post("/security/totp/enable")
async def totp_enable(req: TotpCode, user: str = Depends(get_current_user)):
    u = users_col.find_one({"username": user}, {"totp_pending_secret": 1})
    if not u or not u.get("totp_pending_secret"):
        raise HTTPException(status_code=400, detail="먼저 등록을 시작해 주세요.")
    if totp.verify(u["totp_pending_secret"], req.code) is None:
        raise HTTPException(status_code=400, detail="인증 코드가 올바르지 않습니다. 앱의 시간이 맞는지 확인해 주세요.")
    AuthManager.totp_enable(user)
    return {"status": "ok"}


@router.post("/security/totp/disable")
async def totp_disable(req: PasswordOnly, user: str = Depends(get_current_user)):
    if not AuthManager.check_password(user, req.password):
        raise HTTPException(status_code=400, detail="비밀번호가 올바르지 않습니다.")
    AuthManager.totp_disable(user)
    return {"status": "ok"}


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
