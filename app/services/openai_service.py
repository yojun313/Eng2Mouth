"""
OpenAI 호출 (모두 사용자 개인 API Key 사용).
- create_realtime_secret: Realtime(WebRTC) 용 임시 키 발급. 실제 키는 절대 브라우저로 내려가지 않는다.
- chat_json: Chat Completions + JSON 응답 (힌트/번역/평가/주제 생성)
- tts: 표현 듣기용 짧은 TTS
"""

import json
import re

import httpx
from fastapi import HTTPException

from app.core.config import settings

TIMEOUT = httpx.Timeout(60.0, connect=15.0)


def _headers(api_key: str) -> dict:
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def require_key(user_settings: dict) -> str:
    key = (user_settings.get("openai_api_key") or "").strip()
    if not key:
        raise HTTPException(
            status_code=400,
            detail="OpenAI API Key가 등록되지 않았습니다. 설정에서 먼저 등록해 주세요.",
        )
    return key


def _friendly_error(status: int, body: str) -> str:
    text = body[:400]
    try:
        msg = json.loads(body).get("error", {}).get("message") or text
    except Exception:  # noqa: BLE001
        msg = text
    if status == 401:
        return "OpenAI API Key가 올바르지 않습니다. 설정에서 키를 다시 확인해 주세요."
    if status == 429:
        return f"OpenAI 사용량/잔액 한도에 걸렸습니다: {msg}"
    if status == 403:
        return f"이 키로는 해당 모델에 접근할 수 없습니다: {msg}"
    return f"OpenAI 오류 {status}: {msg}"


def is_reasoning_model(model_id: str) -> bool:
    return bool(re.match(r"^(gpt-5|o\d)", model_id or ""))


async def create_realtime_secret(
    api_key: str,
    model: str,
    instructions: str,
    voice: str,
    speed: float,
    turn_mode: str,
    tools: list[dict],
) -> dict:
    if turn_mode == "ptt":
        turn_detection = None
    else:
        turn_detection = {
            "type": "semantic_vad",
            "eagerness": "medium",
            "create_response": True,
            "interrupt_response": True,
        }
    session = {
        "type": "realtime",
        "model": model,
        "instructions": instructions,
        "output_modalities": ["audio"],
        "tools": tools,
        "tool_choice": "auto",
        "audio": {
            "input": {
                "transcription": {"model": settings.TRANSCRIBE_MODEL, "language": "en"},
                "turn_detection": turn_detection,
                "noise_reduction": {"type": "near_field"},
            },
            "output": {"voice": voice, "speed": round(float(speed), 2)},
        },
    }
    payload = {
        "expires_after": {"anchor": "created_at", "seconds": 600},
        "session": session,
    }
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.post(
            f"{settings.OPENAI_BASE_URL}/realtime/client_secrets",
            headers=_headers(api_key),
            json=payload,
        )
    if r.status_code >= 400:
        raise HTTPException(
            status_code=502, detail=_friendly_error(r.status_code, r.text)
        )
    data = r.json()
    value = data.get("value") or (data.get("client_secret") or {}).get("value")
    if not value:
        raise HTTPException(
            status_code=502, detail="임시 키 발급 응답이 올바르지 않습니다."
        )
    return {
        "client_secret": value,
        "expires_at": data.get("expires_at"),
        "model": model,
    }


async def chat_json(
    api_key: str,
    model: str,
    system: str,
    user: str,
    schema: dict | None = None,
    max_tokens: int = 1500,
    effort: str = "minimal",
) -> tuple[dict, dict]:
    """JSON 응답을 강제해 dict 로 반환. (result, usage)"""
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_completion_tokens": max_tokens,
    }
    if schema:
        payload["response_format"] = {"type": "json_schema", "json_schema": schema}
    else:
        payload["response_format"] = {"type": "json_object"}
    if is_reasoning_model(model):
        payload["reasoning_effort"] = effort
    else:
        payload["temperature"] = 0.7

    async def _post(client):
        r = await client.post(
            f"{settings.OPENAI_BASE_URL}/chat/completions",
            headers=_headers(api_key),
            json=payload,
        )
        if r.status_code == 400 and (
            "reasoning_effort" in r.text or "temperature" in r.text
        ):
            payload.pop("reasoning_effort", None)
            payload.pop("temperature", None)
            r = await client.post(
                f"{settings.OPENAI_BASE_URL}/chat/completions",
                headers=_headers(api_key),
                json=payload,
            )
        return r

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0)) as client:
        r = await _post(client)
        if r.status_code == 404 or (
            r.status_code == 400
            and "model" in r.text.lower()
            and "not" in r.text.lower()
            and "exist" in r.text.lower()
        ):
            alt = await pick_chat_model(api_key, exclude=payload["model"])
            if alt:
                payload["model"] = alt
                if is_reasoning_model(alt):
                    payload.pop("temperature", None)
                    payload.setdefault("reasoning_effort", effort)
                r = await _post(client)
    if r.status_code >= 400:
        raise HTTPException(
            status_code=502, detail=_friendly_error(r.status_code, r.text)
        )
    data = r.json()
    data.setdefault("usage", {})["_model"] = payload["model"]
    try:
        content = data["choices"][0]["message"]["content"]
        result = json.loads(content)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=502, detail=f"모델 응답을 해석할 수 없습니다: {e}"
        )
    return result, data.get("usage") or {}


async def tts(
    api_key: str, text: str, voice: str, instructions: str | None = None
) -> bytes:
    payload = {
        "model": settings.TTS_MODEL,
        "input": text[:600],
        "voice": voice
        if voice
        in (
            "alloy",
            "ash",
            "ballad",
            "coral",
            "echo",
            "sage",
            "shimmer",
            "verse",
            "marin",
            "cedar",
        )
        else "coral",
        "response_format": "mp3",
    }
    if instructions:
        payload["instructions"] = instructions
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.post(
            f"{settings.OPENAI_BASE_URL}/audio/speech",
            headers=_headers(api_key),
            json=payload,
        )
    if r.status_code >= 400:
        raise HTTPException(
            status_code=502, detail=_friendly_error(r.status_code, r.text)
        )
    return r.content


async def verify_key(api_key: str) -> dict:
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.get(
            f"{settings.OPENAI_BASE_URL}/models", headers=_headers(api_key)
        )
    if r.status_code >= 400:
        raise HTTPException(
            status_code=400, detail=_friendly_error(r.status_code, r.text)
        )
    ids = {m.get("id") for m in r.json().get("data", [])}
    return {
        "ok": True,
        "realtime": settings.REALTIME_MODEL in ids,
        "realtime_mini": settings.REALTIME_MINI_MODEL in ids,
        "chat": settings.CHAT_MODEL in ids,
    }


_openai_model_cache: dict[str, tuple[float, list[str]]] = {}


async def list_model_ids(api_key: str) -> list[str]:
    import hashlib
    import time

    kid = hashlib.sha256(api_key.encode()).hexdigest()[:16]
    hit = _openai_model_cache.get(kid)
    if hit and time.time() - hit[0] < 3600:
        return hit[1]
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.get(
            f"{settings.OPENAI_BASE_URL}/models", headers=_headers(api_key)
        )
    if r.status_code >= 400:
        raise HTTPException(
            status_code=400, detail=_friendly_error(r.status_code, r.text)
        )
    ids = [m.get("id", "") for m in r.json().get("data", [])]
    _openai_model_cache[kid] = (time.time(), ids)
    return ids


def _gpt_version(model_id: str) -> float:
    m = re.match(r"gpt-(\d+)(?:\.(\d+))?", model_id or "")
    return float(f"{m.group(1)}.{m.group(2) or 0}") if m else 0.0


async def pick_chat_model(api_key: str, exclude: str = "") -> str | None:
    """설정 모델이 없을 때: 최신 mini 계열 → 없으면 최신 gpt-5.x 본 모델."""
    try:
        ids = await list_model_ids(api_key)
    except Exception:  # noqa: BLE001
        return None
    base = [
        i
        for i in ids
        if i.startswith("gpt-5")
        and not re.search(r"\d{4}-\d{2}-\d{2}$", i)
        and i != exclude
        and not any(
            x in i
            for x in (
                "codex",
                "search",
                "pro",
                "chat-latest",
                "realtime",
                "transcribe",
                "tts",
            )
        )
    ]
    minis = [i for i in base if "mini" in i]
    pool = minis or base
    return max(pool, key=_gpt_version) if pool else None
