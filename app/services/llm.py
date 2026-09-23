"""
텍스트 작업(평가/힌트/번역/주제)과 TTS 를 제공자별로 분기하는 얇은 디스패처.
기본은 사용자의 provider 설정을 따르고, 그 제공자 키가 없으면 키가 있는 쪽으로 자동 전환한다.
"""

from fastapi import HTTPException

from app.core.config import settings
from app.services import gemini_service, openai_service, pricing
from app.services.auth_manager import AuthManager


def key_for(s: dict, provider: str) -> str:
    return (
        s.get("gemini_api_key") if provider == "gemini" else s.get("openai_api_key")
    ) or ""


def pick_text_provider(s: dict) -> str:
    pref = s.get("provider") or "openai"
    if key_for(s, pref).strip():
        return pref
    other = "gemini" if pref == "openai" else "openai"
    if key_for(s, other).strip():
        return other
    raise HTTPException(
        status_code=400,
        detail="OpenAI 또는 Gemini API Key를 설정에서 먼저 등록해 주세요.",
    )


async def chat_json(
    username: str,
    s: dict,
    system: str,
    user: str,
    schema: dict | None = None,
    max_tokens: int = 1500,
    quality: str = "fast",
) -> tuple[dict, str]:
    """(result, model). 비용은 여기서 누적한다. quality: fast | best"""
    provider = pick_text_provider(s)
    key = key_for(s, provider).strip()
    if provider == "gemini":
        preferred = (
            (s.get("gemini_chat_model") or settings.GEMINI_CHAT_MODEL)
            if quality == "best"
            else settings.GEMINI_FAST_MODEL
        )
        model = await gemini_service.resolve_text_model(
            key, preferred, "best" if quality == "best" else "fast"
        )
        result, usage = await gemini_service.chat_json(
            key,
            model,
            system,
            user,
            schema=schema,
            max_tokens=max_tokens,
            thinking=1024 if quality == "best" else 0,
        )
        model = usage.get("_model") or model
        AuthManager.add_usage(username, pricing.gemini_text_cost(model, usage))
    else:
        model = s.get("chat_model") or settings.CHAT_MODEL
        result, usage = await openai_service.chat_json(
            key,
            model,
            system,
            user,
            schema=schema,
            max_tokens=max_tokens,
            effort="low" if quality == "best" else "minimal",
        )
        model = usage.get("_model") or model
        AuthManager.add_usage(username, pricing.chat_cost(model, usage))
    return result, model


async def tts(
    username: str, s: dict, text: str, voice: str | None = None
) -> tuple[bytes, str]:
    provider = pick_text_provider(s)
    key = key_for(s, provider).strip()
    if provider == "gemini":
        audio, cost = await gemini_service.tts(
            key, text, voice or s.get("gemini_voice") or settings.GEMINI_DEFAULT_VOICE
        )
        AuthManager.add_usage(username, cost)
        return audio, "audio/wav"
    audio = await openai_service.tts(
        key,
        text,
        voice or s.get("voice") or "coral",
        instructions="Speak naturally and clearly, like a friendly native speaker teaching a phrase.",
    )
    AuthManager.add_usage(username, round(len(text) / 1_000_000 * 12.0, 6))
    return audio, "audio/mpeg"
