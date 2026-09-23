"""
Google Gemini 호출 (사용자 개인 키).
- create_live_token: Live API(WebSocket) 용 임시 토큰(v1alpha auth_tokens). 실제 키는 브라우저로 가지 않는다.
- chat_json: generateContent + JSON 스키마 (평가/힌트/번역/주제)
- tts: gemini-2.5-flash-preview-tts → WAV bytes
- verify_key / pick_live_model: 키 검증 + 접근 가능한 Live 모델 자동 선택
"""

import base64
import hashlib
import json
import re
import struct
import time
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import HTTPException

from app.core.config import settings

TIMEOUT = httpx.Timeout(60.0, connect=15.0)
_model_cache: dict[str, tuple[float, list[str]]] = {}


def _headers(api_key: str) -> dict:
    return {"x-goog-api-key": api_key, "Content-Type": "application/json"}


def _friendly_error(status: int, body: str) -> str:
    try:
        msg = json.loads(body).get("error", {}).get("message") or body[:300]
    except Exception:  # noqa: BLE001
        msg = body[:300]
    if status in (401, 403) or (status == 400 and "API key not valid" in msg):
        return (
            "Gemini API Key가 올바르지 않습니다. AI Studio에서 키를 다시 확인해 주세요."
        )
    if status == 429:
        return f"Gemini 요청 한도(무료 티어 분당 제한 등)에 걸렸습니다: {msg}"
    if status == 404:
        return f"Gemini 모델을 찾을 수 없습니다 (.env 의 GEMINI_* 모델명을 확인하세요): {msg}"
    return f"Gemini 오류 {status}: {msg}"


async def list_models(api_key: str) -> list[str]:
    key_id = hashlib.sha256(api_key.encode()).hexdigest()[:16]
    cached = _model_cache.get(key_id)
    if cached and time.time() - cached[0] < 3600:
        return cached[1]
    names: list[str] = []
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        token = None
        for _ in range(5):
            params = {"pageSize": 200}
            if token:
                params["pageToken"] = token
            r = await client.get(
                f"{settings.GEMINI_BASE_URL}/v1beta/models",
                headers=_headers(api_key),
                params=params,
            )
            if r.status_code >= 400:
                raise HTTPException(
                    status_code=400, detail=_friendly_error(r.status_code, r.text)
                )
            data = r.json()
            names += [
                m.get("name", "").replace("models/", "") for m in data.get("models", [])
            ]
            token = data.get("nextPageToken")
            if not token:
                break
    _model_cache[key_id] = (time.time(), names)
    return names


_bad_models: set[str] = (
    set()
)  # "no longer available" 등으로 거부된 모델 (프로세스 수명 동안 기억)


def _version(name: str) -> float:
    m = re.search(r"gemini-(\d+(?:\.\d+)?)", name)
    return float(m.group(1)) if m else 0.0


def _choose_live(names: list[str]) -> str | None:
    """Live(음성 대화) 모델: 버전 높은 것 > 일반(live/native-audio) > 'thinking/translate/transcribe' 특수형 제외."""
    cands = [
        n
        for n in names
        if ("native-audio" in n or "live" in n)
        and not any(x in n for x in ("tts", "translate", "transcribe", "thinking"))
        and n not in _bad_models
    ]
    if settings.GEMINI_LIVE_MODEL in cands:
        return settings.GEMINI_LIVE_MODEL
    if not cands:
        return None
    return max(cands, key=lambda n: (_version(n), "preview" not in n, "latest" in n, n))


def _choose_text(names: list[str], tier: str) -> str | None:
    """텍스트 모델: tier 'fast' 는 flash-lite, 'best' 는 flash. 버전 높고 안정판(날짜/preview 없는) 우선."""
    base = [
        n
        for n in names
        if n.startswith("gemini-")
        and "flash" in n
        and "omni" not in n
        and not any(
            x in n
            for x in (
                "tts",
                "audio",
                "live",
                "image",
                "embedding",
                "translate",
                "transcribe",
                "latest",
            )
        )
        and n not in _bad_models
    ]
    lite = [n for n in base if "lite" in n]
    full = [n for n in base if "lite" not in n]
    pool = (lite or full) if tier == "fast" else (full or lite)
    if not pool:
        return None
    return max(pool, key=lambda n: (_version(n), "preview" not in n, -len(n)))


async def resolve_text_model(api_key: str, preferred: str, tier: str) -> str:
    """설정된 모델이 키에서 접근 가능하면 그대로, 아니면 목록에서 최신 모델 자동 선택."""
    try:
        names = await list_models(api_key)
    except Exception:  # noqa: BLE001
        return preferred
    if preferred and preferred in names and preferred not in _bad_models:
        return preferred
    return _choose_text(names, tier) or preferred


def _is_model_gone(status: int, body: str) -> bool:
    b = body.lower()
    return (
        status == 404
        or "no longer available" in b
        or "not found" in b
        or "not supported" in b
    )


async def pick_live_model(api_key: str) -> str:
    try:
        names = await list_models(api_key)
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001
        return settings.GEMINI_LIVE_MODEL
    chosen = _choose_live(names)
    if not chosen:
        raise HTTPException(
            status_code=400,
            detail="이 Gemini 키로 접근 가능한 Live(native-audio) 모델이 없습니다. AI Studio 에서 키 권한을 확인해 주세요.",
        )
    return chosen


async def verify_key(api_key: str) -> dict:
    names = await list_models(api_key)
    live = _choose_live(names)
    return {
        "ok": True,
        "live_model": live,
        "chat": settings.GEMINI_CHAT_MODEL in names,
        "fast": settings.GEMINI_FAST_MODEL in names,
        "tts": settings.GEMINI_TTS_MODEL in names,
    }


def build_live_setup(
    model: str, instructions: str, voice: str, turn_mode: str, tools: list[dict]
) -> dict:
    """Live API BidiGenerateContentSetup (토큰에 잠그고, 클라이언트도 동일하게 보낸다)."""
    vad = (
        {"disabled": True}
        if turn_mode == "ptt"
        else {
            "disabled": False,
            "startOfSpeechSensitivity": "START_SENSITIVITY_HIGH",
            "endOfSpeechSensitivity": "END_SENSITIVITY_HIGH",
            "prefixPaddingMs": 150,
            "silenceDurationMs": 450,
        }
    )
    return {
        "model": f"models/{model}",
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "temperature": 0.9,
            "speechConfig": {
                "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}},
                "languageCode": "en-US",
            },
            # native-audio 모델의 '생각(thinking)' 은 응답 전 수 초를 잡아먹는다. 전화 대화에서는 끈다.
            "thinkingConfig": {"thinkingBudget": 0},
        },
        "systemInstruction": {"parts": [{"text": instructions}]},
        "tools": [{"functionDeclarations": tools}],
        "realtimeInputConfig": {
            "automaticActivityDetection": vad,
            "activityHandling": "START_OF_ACTIVITY_INTERRUPTS",
        },
        "inputAudioTranscription": {},
        "outputAudioTranscription": {},
        "contextWindowCompression": {"slidingWindow": {}},
    }


async def create_live_token(api_key: str, setup: dict) -> dict:
    """v1alpha auth_tokens 로 1회용 임시 토큰 발급. 실패 시 (허용된 경우에만) 키 직접 사용 폴백."""
    now = datetime.now(timezone.utc)
    payload = {
        "uses": 1,
        "expireTime": (now + timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "newSessionExpireTime": (now + timedelta(minutes=2)).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        ),
        "bidiGenerateContentSetup": setup,
    }
    ws_base = f"{settings.GEMINI_BASE_URL}".replace("https://", "wss://").replace(
        "http://", "ws://"
    )
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.post(
            f"{settings.GEMINI_BASE_URL}/v1alpha/auth_tokens",
            headers=_headers(api_key),
            json=payload,
        )
        if r.status_code == 400 and "thinking" in r.text.lower():
            # 이 모델이 thinkingConfig 를 받지 않으면 빼고 재시도
            setup.get("generationConfig", {}).pop("thinkingConfig", None)
            r = await client.post(
                f"{settings.GEMINI_BASE_URL}/v1alpha/auth_tokens",
                headers=_headers(api_key),
                json=payload,
            )
    if r.status_code < 400:
        name = r.json().get("name")
        if name:
            # 임시 토큰은 'Constrained' 메서드로만 인증된다 (공식 SDK 동작과 동일). 예비로 일반 메서드 URL 도 함께 준다.
            return {
                "token": name,
                "ws_url": f"{ws_base}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token={name}",
                "ws_url_alt": f"{ws_base}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?access_token={name}",
                "mode": "ephemeral",
            }
    if settings.GEMINI_ALLOW_DIRECT_KEY:
        return {
            "token": None,
            "ws_url": f"{ws_base}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={api_key}",
            "mode": "direct",
        }
    raise HTTPException(
        status_code=502,
        detail="Gemini 임시 토큰 발급 실패: " + _friendly_error(r.status_code, r.text),
    )


def _gemini_schema(schema: dict) -> dict:
    """OpenAI json_schema(strict) → Gemini responseSchema 부분집합으로 변환."""
    src = schema.get("schema", schema)

    def conv(node):
        if isinstance(node, dict):
            out = {}
            for k, v in node.items():
                if k in ("additionalProperties", "strict", "$schema", "title"):
                    continue
                out[k] = conv(v)
            if out.get("type") == "object" and "properties" in out:
                out["propertyOrdering"] = list(out["properties"].keys())
            return out
        if isinstance(node, list):
            return [conv(x) for x in node]
        return node

    return conv(src)


async def chat_json(
    api_key: str,
    model: str,
    system: str,
    user: str,
    schema: dict | None = None,
    max_tokens: int = 1500,
    thinking: int = 0,
) -> tuple[dict, dict]:
    gen = {
        "responseMimeType": "application/json",
        "temperature": 0.7,
        "maxOutputTokens": max_tokens,
    }
    if schema:
        gen["responseSchema"] = _gemini_schema(schema)
    if "2.5" in model or "3" in model:
        gen["thinkingConfig"] = {"thinkingBudget": thinking}
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": gen,
    }

    async def _post(client, m):
        u = f"{settings.GEMINI_BASE_URL}/v1beta/models/{m}:generateContent"
        r = await client.post(u, headers=_headers(api_key), json=payload)
        if r.status_code == 400 and "thinking" in r.text.lower():
            gen.pop("thinkingConfig", None)
            r = await client.post(u, headers=_headers(api_key), json=payload)
        return r

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0)) as client:
        r = await _post(client, model)
        if r.status_code >= 400 and _is_model_gone(r.status_code, r.text):
            _bad_models.add(model)
            try:
                names = await list_models(api_key)
            except Exception:  # noqa: BLE001
                names = []
            alt = _choose_text(names, "fast" if "lite" in model else "best")
            if alt and alt != model:
                model = alt
                r = await _post(client, model)
    if r.status_code >= 400:
        raise HTTPException(
            status_code=502, detail=_friendly_error(r.status_code, r.text)
        )
    data = r.json()
    data.setdefault("usageMetadata", {})["_model"] = model
    try:
        text = "".join(
            p.get("text", "") for p in data["candidates"][0]["content"]["parts"]
        )
        result = json.loads(text)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=502, detail=f"Gemini 응답을 해석할 수 없습니다: {e}"
        )
    return result, data.get("usageMetadata") or {}


def _pcm_to_wav(pcm: bytes, rate: int = 24000) -> bytes:
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + len(pcm),
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        rate,
        rate * 2,
        2,
        16,
        b"data",
        len(pcm),
    )
    return header + pcm


async def tts(api_key: str, text: str, voice: str) -> tuple[bytes, float]:
    voice = (
        voice if voice in settings.GEMINI_VOICE_IDS else settings.GEMINI_DEFAULT_VOICE
    )
    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": f"Say this naturally and clearly, like a friendly native speaker teaching a phrase: {text[:600]}"
                    }
                ]
            }
        ],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}
            },
        },
    }
    model = settings.GEMINI_TTS_MODEL
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.post(
            f"{settings.GEMINI_BASE_URL}/v1beta/models/{model}:generateContent",
            headers=_headers(api_key),
            json=payload,
        )
        if r.status_code >= 400 and _is_model_gone(r.status_code, r.text):
            try:
                names = await list_models(api_key)
                tts_models = [n for n in names if "tts" in n and n != model]
                if tts_models:
                    model = max(
                        tts_models,
                        key=lambda n: (
                            _version(n),
                            "lite" not in n,
                            "preview" not in n,
                        ),
                    )
                    r = await client.post(
                        f"{settings.GEMINI_BASE_URL}/v1beta/models/{model}:generateContent",
                        headers=_headers(api_key),
                        json=payload,
                    )
            except Exception:  # noqa: BLE001
                pass
    if r.status_code >= 400:
        raise HTTPException(
            status_code=502, detail=_friendly_error(r.status_code, r.text)
        )
    data = r.json()
    try:
        part = next(
            p for p in data["candidates"][0]["content"]["parts"] if "inlineData" in p
        )
        pcm = base64.b64decode(part["inlineData"]["data"])
        mime = part["inlineData"].get("mimeType", "audio/pcm;rate=24000")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Gemini TTS 응답 오류: {e}")
    rate = 24000
    if "rate=" in mime:
        try:
            rate = int(mime.split("rate=")[1].split(";")[0])
        except ValueError:
            pass
    usage = data.get("usageMetadata") or {}
    cost = float(usage.get("candidatesTokenCount", 0)) * 10.0 / 1e6
    return _pcm_to_wav(pcm, rate), cost
