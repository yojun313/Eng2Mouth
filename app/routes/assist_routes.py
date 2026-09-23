"""통화 중 보조 기능: 힌트, 번역, 표현 듣기(TTS)."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from app.routes.deps import get_current_user
from app.services import llm
from app.services.auth_manager import AuthManager
from app.services.prompts import HINT_SYSTEM, TRANSLATE_SYSTEM

router = APIRouter()


class HintRequest(BaseModel):
    transcript: list[dict] = []


class TranslateRequest(BaseModel):
    text: str


class TtsRequest(BaseModel):
    text: str
    voice: str | None = None


def _recent(transcript: list[dict], n: int = 8) -> str:
    lines = []
    for t in transcript[-n:]:
        role = "LEARNER" if t.get("role") == "user" else "PARTNER"
        if (t.get("text") or "").strip():
            lines.append(f"{role}: {t['text'].strip()}")
    return "\n".join(lines) or "(call just started, partner said hello)"


@router.post("/assist/hint")
async def hint(req: HintRequest, user: str = Depends(get_current_user)):
    s = AuthManager.get_user_settings(user)
    result, _ = await llm.chat_json(
        user,
        s,
        HINT_SYSTEM.replace("{level}", s["level"]),
        _recent(req.transcript),
        max_tokens=600,
    )
    hints = result.get("hints") or []
    return {
        "hints": [
            {"en": str(h.get("en", "")), "ko": str(h.get("ko", ""))}
            for h in hints
            if isinstance(h, dict)
        ][:3]
    }


@router.post("/assist/translate")
async def translate(req: TranslateRequest, user: str = Depends(get_current_user)):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="번역할 문장이 없습니다.")
    s = AuthManager.get_user_settings(user)
    result, _ = await llm.chat_json(
        user, s, TRANSLATE_SYSTEM, text[:1200], max_tokens=500
    )
    return {"ko": str(result.get("ko", "")), "notes": str(result.get("notes", ""))}


@router.post("/assist/tts")
async def speak(req: TtsRequest, user: str = Depends(get_current_user)):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="읽을 문장이 없습니다.")
    s = AuthManager.get_user_settings(user)
    audio, mime = await llm.tts(user, s, text, req.voice)
    return Response(
        content=audio,
        media_type=mime,
        headers={"Cache-Control": "private, max-age=86400"},
    )
