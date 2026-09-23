"""요금 추정 (USD per 1M tokens). 참고용 근사치 — 실제 청구는 OpenAI 대시보드 기준."""

_RT_FULL = {
    "text_in": 4.0,
    "text_cached": 0.40,
    "text_out": 16.0,
    "audio_in": 32.0,
    "audio_cached": 0.40,
    "audio_out": 64.0,
}
_RT_MINI = {
    "text_in": 0.60,
    "text_cached": 0.06,
    "text_out": 2.40,
    "audio_in": 10.0,
    "audio_cached": 0.30,
    "audio_out": 20.0,
}
REALTIME_PRICES = {
    "gpt-realtime": _RT_FULL,
    "gpt-realtime-mini": _RT_MINI,
    "gpt-realtime-1.5": _RT_FULL,
    "gpt-realtime-2": _RT_FULL,
    "gpt-realtime-2.1": _RT_FULL,
    "gpt-realtime-2.1-mini": _RT_MINI,
}
CHAT_PRICES = {
    "gpt-5.6-luna": {"in": 0.20, "cached": 0.02, "out": 1.20},
    "gpt-5.6-terra": {"in": 2.00, "cached": 0.20, "out": 12.0},
    "gpt-5.6-sol": {"in": 4.00, "cached": 0.40, "out": 20.0},
    "gpt-5.5": {"in": 1.75, "cached": 0.175, "out": 14.0},
    "gpt-5.4-mini": {"in": 0.25, "cached": 0.025, "out": 2.0},
    "gpt-5.4-nano": {"in": 0.05, "cached": 0.005, "out": 0.40},
    "gpt-5.4": {"in": 1.75, "cached": 0.175, "out": 14.0},
    "gpt-5.2": {"in": 1.75, "cached": 0.175, "out": 14.0},
    "gpt-5": {"in": 1.25, "cached": 0.125, "out": 10.0},
    "gpt-5-mini": {"in": 0.25, "cached": 0.025, "out": 2.0},
    "gpt-5-nano": {"in": 0.05, "cached": 0.005, "out": 0.40},
    "gpt-4.1-mini": {"in": 0.40, "cached": 0.10, "out": 1.60},
    "gpt-4o-mini": {"in": 0.15, "cached": 0.075, "out": 0.60},
    "gpt-4o": {"in": 2.50, "cached": 1.25, "out": 10.0},
}


def _match(table: dict, model: str):
    for k in sorted(table, key=len, reverse=True):
        if model and model.startswith(k):
            return table[k]
    return None


def realtime_cost(model: str, usage: dict) -> float:
    """Realtime 누적 usage → USD. usage 는 클라이언트가 response.done 들을 합산한 값."""
    p = _match(REALTIME_PRICES, model) or REALTIME_PRICES["gpt-realtime"]
    u = usage or {}
    text_in = float(u.get("text_in", 0))
    text_cached = float(u.get("text_cached", 0))
    audio_in = float(u.get("audio_in", 0))
    audio_cached = float(u.get("audio_cached", 0))
    text_out = float(u.get("text_out", 0))
    audio_out = float(u.get("audio_out", 0))
    cost = (
        (text_in - text_cached) * p["text_in"]
        + text_cached * p["text_cached"]
        + text_out * p["text_out"]
        + (audio_in - audio_cached) * p["audio_in"]
        + audio_cached * p["audio_cached"]
        + audio_out * p["audio_out"]
    ) / 1_000_000
    return round(max(cost, 0.0), 6)


def chat_cost(model: str, usage: dict) -> float:
    p = _match(CHAT_PRICES, model)
    if not p or not usage:
        return 0.0
    prompt = float(usage.get("prompt_tokens", 0))
    cached = float((usage.get("prompt_tokens_details") or {}).get("cached_tokens", 0))
    completion = float(usage.get("completion_tokens", 0))
    return round(
        ((prompt - cached) * p["in"] + cached * p["cached"] + completion * p["out"])
        / 1_000_000,
        6,
    )


# ---- Gemini (USD per 1M tokens). Live 오디오는 초당 32토큰(분당 1,920). 참고용 추정치 ----
GEMINI_LIVE_PRICES = {
    "default": {"text_in": 0.50, "audio_in": 3.00, "text_out": 2.00, "audio_out": 12.00}
}
GEMINI_TEXT_PRICES = {  # 3.x 단가는 2.5 계열 기준 추정
    "gemini-2.5-pro": {"in": 1.25, "out": 10.0},
    "gemini-2.5-flash-lite": {"in": 0.10, "out": 0.40},
    "gemini-2.5-flash": {"in": 0.30, "out": 2.50},
    "gemini-3.1-pro": {"in": 2.0, "out": 12.0},
    "gemini-3.1-flash-lite": {"in": 0.10, "out": 0.40},
    "gemini-3.5-flash-lite": {"in": 0.10, "out": 0.40},
    "gemini-3.5-flash": {"in": 0.30, "out": 2.50},
    "gemini-3.6-flash": {"in": 0.30, "out": 2.50},
    "gemini-3.7-flash": {"in": 0.30, "out": 2.50},
    "gemini-3.8-flash": {"in": 0.30, "out": 2.50},
    "gemini-flash-lite": {"in": 0.10, "out": 0.40},
    "gemini-flash": {"in": 0.30, "out": 2.50},
}
GEMINI_TTS_AUDIO_OUT = 10.0  # per 1M audio tokens


def gemini_live_cost(model: str, usage: dict) -> float:
    p = GEMINI_LIVE_PRICES["default"]
    u = usage or {}
    cost = (
        float(u.get("text_in", 0)) * p["text_in"]
        + float(u.get("audio_in", 0)) * p["audio_in"]
        + float(u.get("text_out", 0)) * p["text_out"]
        + float(u.get("audio_out", 0)) * p["audio_out"]
    ) / 1_000_000
    return round(max(cost, 0.0), 6)


def gemini_text_cost(model: str, usage: dict) -> float:
    """usage = generateContent usageMetadata"""
    p = _match(GEMINI_TEXT_PRICES, model)
    if not p or not usage:
        return 0.0
    prompt = float(usage.get("promptTokenCount", 0))
    out = float(usage.get("candidatesTokenCount", 0)) + float(
        usage.get("thoughtsTokenCount", 0)
    )
    return round((prompt * p["in"] + out * p["out"]) / 1_000_000, 6)


def call_cost(provider: str, model: str, usage: dict) -> float:
    return (
        gemini_live_cost(model, usage)
        if provider == "gemini"
        else realtime_cost(model, usage)
    )


def estimate_10min(provider: str, model: str = "") -> dict:
    """UI 표시용: 10분 통화(내가 5분, 상대 4분 발화) 추정 비용."""
    if provider == "gemini":
        p = GEMINI_LIVE_PRICES["default"]
        # 5분 입력(9,600) + 4분 출력(7,680) + 턴마다 다시 읽는 문맥(캐시 할인 없음 가정, 약 60k)
        low = (9600 * p["audio_in"] + 7680 * p["audio_out"]) / 1e6
        high = low + (60000 * p["audio_in"] + 40000 * p["text_in"]) / 1e6
        return {
            "low": round(low, 2),
            "high": round(high, 2),
            "label": f"${low:.2f}~{high:.2f} / 10분",
            "note": "AI Studio 무료 티어 한도 내에서는 $0",
        }
    pr = _match(REALTIME_PRICES, model) or REALTIME_PRICES["gpt-realtime"]
    low = (
        3000 * pr["audio_in"]
        + 2400 * pr["audio_out"]
        + 120000 * pr["audio_cached"]
        + 60000 * pr["text_cached"]
    ) / 1e6
    high = low * 1.4
    return {
        "low": round(low, 2),
        "high": round(high, 2),
        "label": f"${low:.2f}~{high:.2f} / 10분",
        "note": "",
    }
