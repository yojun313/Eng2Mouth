"""
통화 API.
POST /api/calls/start     → 통화 문서 생성 + (OpenAI) Realtime 임시 키 / (Gemini) Live 임시 토큰 발급
POST /api/calls/{id}/finish   → 트랜스크립트/사용량 저장
POST /api/calls/{id}/evaluate → 말하기 평가 리포트 생성
GET  /api/calls, /api/calls/{id}, DELETE, PATCH(북마크/메모)
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.config import settings
from app.db import calls_col, daily_picks_col
from app.routes.deps import get_current_user
from app.services import gemini_service, openai_service, pricing
from app.services.auth_manager import AuthManager
from app.services.call_service import (
    compute_stats,
    evaluate_call,
    new_call_id,
    serialize_call,
)
from app.services.personas import resolve_persona
from app.services.prompts import END_CALL_TOOL, build_realtime_instructions
from app.services.topics import SCENARIO_MAP, TOPIC_MAP, today_kst

router = APIRouter()


class StartRequest(BaseModel):
    kind: str = Field(pattern="^(topic|scenario|custom|free|personal)$")
    topic_id: str | None = None
    custom_title: str | None = None
    persona: str | None = None
    # 통화 직전 선택 (없으면 설정값). 선택값은 사용자 기본값으로 저장된다.
    provider: str | None = None
    level: str | None = None
    correction_mode: str | None = None
    turn_mode: str | None = None
    voice: str | None = None
    gemini_voice: str | None = None
    realtime_model: str | None = None
    gemini_live_model: str | None = None
    chat_model: str | None = None
    gemini_chat_model: str | None = None
    remember: bool = True


class Turn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    text: str
    t: float | None = None


class FinishRequest(BaseModel):
    transcript: list[Turn] = []
    duration_sec: int = 0
    usage: dict = {}
    ended_by: str = "user"


class PatchRequest(BaseModel):
    bookmarked: bool | None = None
    note: str | None = None


def _resolve_topic(req: StartRequest, user: str) -> dict:
    if req.kind == "topic":
        t = TOPIC_MAP.get(req.topic_id or "")
        if not t:
            raise HTTPException(status_code=404, detail="주제를 찾을 수 없습니다.")
        return {
            "kind": "topic",
            "id": t["id"],
            "title": t["title"],
            "title_ko": t["title_ko"],
            "emoji": t["emoji"],
            "description_en": "",
            "description_ko": t["description_ko"],
            "questions": t["questions"],
        }
    if req.kind == "personal":
        doc = daily_picks_col.find_one({"owner": user, "date": today_kst()})
        for t in (doc or {}).get("topics", []):
            if t.get("id") == req.topic_id:
                return {
                    "kind": "topic",
                    "id": t["id"],
                    "title": t["title"],
                    "title_ko": t.get("title_ko"),
                    "emoji": t.get("emoji", "✨"),
                    "description_en": t.get("description_en", ""),
                    "description_ko": t.get("description_ko", ""),
                    "questions": t.get("questions", []),
                }
        raise HTTPException(
            status_code=404, detail="추천 주제를 찾을 수 없습니다. 새로 고침해 주세요."
        )
    if req.kind == "scenario":
        s = SCENARIO_MAP.get(req.topic_id or "")
        if not s:
            raise HTTPException(status_code=404, detail="시나리오를 찾을 수 없습니다.")
        return {
            "kind": "scenario",
            "id": s["id"],
            "title": s["title"],
            "title_ko": s["title_ko"],
            "emoji": s["emoji"],
            "ai_role": s["ai_role"],
            "user_role": s["user_role"],
            "situation": s["situation"],
        }
    if req.kind == "custom":
        title = (req.custom_title or "").strip()
        if not title:
            raise HTTPException(
                status_code=400, detail="이야기하고 싶은 주제를 입력해 주세요."
            )
        return {
            "kind": "topic",
            "id": "custom",
            "title": title[:120],
            "title_ko": title[:120],
            "emoji": "💬",
            "description_en": "",
            "description_ko": "직접 정한 주제",
            "questions": [],
        }
    return {
        "kind": "free",
        "id": "free",
        "title": "Free talk",
        "title_ko": "자유 대화",
        "emoji": "📞",
    }


@router.post("/calls/start")
async def start_call(req: StartRequest, user: str = Depends(get_current_user)):
    s = AuthManager.get_user_settings(user)

    # ---- 이번 통화 선택값 (없으면 저장된 기본값) ----
    provider = req.provider if req.provider in settings.PROVIDER_IDS else s["provider"]
    level = req.level if req.level in settings.LEVEL_IDS else s["level"]
    correction = (
        req.correction_mode
        if req.correction_mode in settings.CORRECTION_IDS
        else s["correction_mode"]
    )
    turn_mode = req.turn_mode if req.turn_mode in ("auto", "ptt") else s["turn_mode"]
    persona_id = req.persona or s["persona"]
    persona = resolve_persona(persona_id, s.get("custom_persona"))
    voice = (
        req.voice
        if req.voice in settings.VOICE_IDS
        else (s["voice"] or persona["voice"])
    )
    gemini_voice = (
        req.gemini_voice
        if req.gemini_voice in settings.GEMINI_VOICE_IDS
        else s["gemini_voice"]
    )
    realtime_model = (
        req.realtime_model or s["realtime_model"] or settings.REALTIME_MODEL
    )
    gemini_live_model = (
        req.gemini_live_model
        if req.gemini_live_model is not None
        else s.get("gemini_live_model")
    ) or ""
    chat_model = req.chat_model or s["chat_model"]
    gemini_chat_model = (
        req.gemini_chat_model
        or s.get("gemini_chat_model")
        or settings.GEMINI_CHAT_MODEL
    )

    # ---- 선택값을 사용자 기본값으로 저장 (DB) ----
    if req.remember:
        AuthManager.update_settings(
            user,
            {
                "provider": provider,
                "level": level,
                "correction_mode": correction,
                "turn_mode": turn_mode,
                "persona": persona_id,
                "voice": voice,
                "gemini_voice": gemini_voice,
                "realtime_model": realtime_model,
                "gemini_live_model": gemini_live_model,
                "chat_model": chat_model,
                "gemini_chat_model": gemini_chat_model,
            },
        )

    topic = _resolve_topic(req, user)
    instructions = build_realtime_instructions(
        persona=persona,
        level=level,
        correction_mode=correction,
        topic=topic,
        allow_korean=bool(s.get("allow_korean", True)),
        user_name=user,
    )

    if provider == "gemini":
        api_key = (s.get("gemini_api_key") or "").strip()
        if not api_key:
            raise HTTPException(
                status_code=400,
                detail="Gemini API Key가 등록되지 않았습니다. 설정에서 먼저 등록해 주세요.",
            )
        model = gemini_live_model or await gemini_service.pick_live_model(api_key)
        tool = {
            "name": END_CALL_TOOL["name"],
            "description": END_CALL_TOOL["description"],
        }
        setup = gemini_service.build_live_setup(
            model, instructions, gemini_voice, turn_mode, [tool]
        )
        conn = await gemini_service.create_live_token(api_key, setup)
        session = {
            "provider": "gemini",
            "ws_url": conn["ws_url"],
            "ws_url_alt": conn.get("ws_url_alt"),
            "setup": setup,
            "token_mode": conn["mode"],
            "model": model,
        }
        used_voice = gemini_voice
    else:
        api_key = openai_service.require_key(s)
        model = realtime_model
        secret = await openai_service.create_realtime_secret(
            api_key=api_key,
            model=model,
            instructions=instructions,
            voice=voice,
            speed=float(s.get("speed", 1.0)),
            turn_mode=turn_mode,
            tools=[END_CALL_TOOL],
        )
        session = {
            "provider": "openai",
            "client_secret": secret["client_secret"],
            "model": model,
        }
        used_voice = voice

    call_id = new_call_id()
    calls_col.insert_one(
        {
            "id": call_id,
            "owner": user,
            "topic": topic,
            "persona": {
                "id": persona["id"],
                "name": persona["name"],
                "title": persona.get("title"),
                "emoji": persona.get("emoji"),
                "gradient": persona.get("gradient"),
                "voice": used_voice,
            },
            "level": level,
            "correction_mode": correction,
            "turn_mode": turn_mode,
            "provider": provider,
            "model": model,
            "status": "active",
            "started_at": datetime.now(timezone.utc),
            "transcript": [],
            "duration_sec": 0,
            "cost_usd": 0.0,
        }
    )
    return {
        "call_id": call_id,
        **session,
        "turn_mode": turn_mode,
        "persona": {
            "id": persona["id"],
            "name": persona["name"],
            "title": persona.get("title"),
            "emoji": persona.get("emoji"),
            "gradient": persona.get("gradient"),
            "accent": persona.get("accent"),
        },
        "topic": topic,
        "level": level,
        "captions": bool(s.get("captions", True)),
        "estimate": pricing.estimate_10min(provider, model),
    }


@router.post("/calls/{call_id}/finish")
async def finish_call(
    call_id: str, req: FinishRequest, user: str = Depends(get_current_user)
):
    call = calls_col.find_one({"id": call_id, "owner": user})
    if not call:
        raise HTTPException(status_code=404, detail="통화를 찾을 수 없습니다.")
    transcript = [t.model_dump() for t in req.transcript if (t.text or "").strip()]
    duration = max(0, int(req.duration_sec))
    stats = compute_stats(transcript, duration)
    cost = pricing.call_cost(
        call.get("provider", "openai"), call.get("model", ""), req.usage
    )
    AuthManager.add_usage(user, cost)
    calls_col.update_one(
        {"id": call_id},
        {
            "$set": {
                "transcript": transcript,
                "duration_sec": duration,
                "usage": req.usage,
                "stats": stats,
                "ended_at": datetime.now(timezone.utc),
                "ended_by": req.ended_by,
                "status": "ended" if transcript else "empty",
            },
            "$inc": {"cost_usd": cost},
        },
    )
    return {
        "status": "ok",
        "stats": stats,
        "cost_usd": cost,
        "can_evaluate": stats["user_turns"] >= 2 and stats["user_words"] >= 12,
    }


@router.post("/calls/{call_id}/evaluate")
async def evaluate(call_id: str, user: str = Depends(get_current_user)):
    call = calls_col.find_one({"id": call_id, "owner": user})
    if not call:
        raise HTTPException(status_code=404, detail="통화를 찾을 수 없습니다.")
    if call.get("evaluation"):
        return {
            "status": "ok",
            "evaluation": serialize_call(call, full=True)["evaluation"],
            "cached": True,
        }
    s = AuthManager.get_user_settings(user)
    await evaluate_call(user, call, s)
    call = calls_col.find_one({"id": call_id})
    return {
        "status": "ok",
        "evaluation": serialize_call(call, full=True)["evaluation"],
        "cached": False,
    }


@router.get("/calls")
async def list_calls(
    user: str = Depends(get_current_user),
    q: str = "",
    kind: str = "",
    bookmarked: bool = False,
    limit: int = Query(30, le=200),
    skip: int = 0,
):
    query: dict = {"owner": user, "status": {"$in": ["ended", "evaluated"]}}
    if q:
        query["$or"] = [
            {"topic.title": {"$regex": q, "$options": "i"}},
            {"topic.title_ko": {"$regex": q, "$options": "i"}},
            {"persona.name": {"$regex": q, "$options": "i"}},
            {"transcript.text": {"$regex": q, "$options": "i"}},
            {"note": {"$regex": q, "$options": "i"}},
        ]
    if kind in ("topic", "scenario", "free"):
        query["topic.kind"] = kind
    if bookmarked:
        query["bookmarked"] = True
    total = calls_col.count_documents(query)
    docs = (
        calls_col.find(query, {"transcript": 0})
        .sort("started_at", -1)
        .skip(skip)
        .limit(limit)
    )
    return {"items": [serialize_call(d) for d in docs], "total": total}


@router.get("/calls/{call_id}")
async def get_call(call_id: str, user: str = Depends(get_current_user)):
    call = calls_col.find_one({"id": call_id, "owner": user})
    if not call:
        raise HTTPException(status_code=404, detail="통화를 찾을 수 없습니다.")
    return serialize_call(call, full=True)


@router.patch("/calls/{call_id}")
async def patch_call(
    call_id: str, req: PatchRequest, user: str = Depends(get_current_user)
):
    update = {}
    if req.bookmarked is not None:
        update["bookmarked"] = req.bookmarked
    if req.note is not None:
        update["note"] = req.note[:2000]
    if update:
        calls_col.update_one({"id": call_id, "owner": user}, {"$set": update})
    return {"status": "ok"}


@router.delete("/calls/{call_id}")
async def delete_call(call_id: str, user: str = Depends(get_current_user)):
    calls_col.delete_one({"id": call_id, "owner": user})
    return {"status": "ok"}
