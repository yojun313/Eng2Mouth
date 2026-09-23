from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.db import calls_col, daily_picks_col
from app.routes.deps import get_current_user
from app.services import llm
from app.services.auth_manager import AuthManager
from app.services.personas import public_personas
from app.services.prompts import TOPIC_GEN_SYSTEM
from app.services.topics import (
    CATEGORY_LABELS,
    SCENARIOS,
    TOPIC_BANK,
    daily_scenario,
    daily_topics,
    today_kst,
)

router = APIRouter()


@router.get("/topics/today")
async def topics_today(user: str = Depends(get_current_user)):
    date = today_kst()
    picks = daily_picks_col.find_one(
        {"owner": user, "date": date}, {"_id": 0, "topics": 1}
    )
    done_ids = {
        (c.get("topic") or {}).get("id")
        for c in calls_col.find(
            {"owner": user, "status": {"$in": ["ended", "evaluated"]}}, {"topic.id": 1}
        )
        .sort("started_at", -1)
        .limit(50)
    }
    return {
        "date": date,
        "daily": daily_topics(date),
        "scenario_of_day": daily_scenario(date),
        "personal": (picks or {}).get("topics", []),
        "done_ids": [d for d in done_ids if d],
    }


@router.post("/topics/personal/refresh")
async def refresh_personal(user: str = Depends(get_current_user)):
    s = AuthManager.get_user_settings(user)
    recent = [
        (c.get("topic") or {}).get("title", "")
        for c in calls_col.find({"owner": user}, {"topic.title": 1})
        .sort("started_at", -1)
        .limit(15)
    ]
    system = (
        TOPIC_GEN_SYSTEM.replace("{level}", s["level"])
        .replace("{date}", today_kst())
        .replace("{recent}", ", ".join(t for t in recent if t) or "none")
        .replace(
            "{interests}",
            (s.get("custom_persona") or {}).get("description", "")[:200]
            or "not specified",
        )
    )
    result, _ = await llm.chat_json(
        user, s, system, "Generate today's topics.", max_tokens=2500, quality="best"
    )
    topics = result.get("topics") or []
    if not isinstance(topics, list) or not topics:
        raise HTTPException(
            status_code=502, detail="주제 생성에 실패했습니다. 다시 시도해 주세요."
        )
    clean = []
    for i, t in enumerate(topics[:6]):
        clean.append(
            {
                "id": f"p-{today_kst()}-{i}",
                "emoji": str(t.get("emoji") or "✨")[:4],
                "title": str(t.get("title") or "")[:80],
                "title_ko": str(t.get("title_ko") or "")[:80],
                "description_ko": str(t.get("description_ko") or "")[:200],
                "description_en": str(t.get("description_en") or "")[:300],
                "questions": [str(q)[:160] for q in (t.get("questions") or [])][:4],
                "category_label": str(t.get("category_label") or "추천")[:12],
            }
        )
    daily_picks_col.update_one(
        {"owner": user, "date": today_kst()},
        {"$set": {"topics": clean, "created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"topics": clean}


@router.get("/topics/all")
async def topics_all(user: str = Depends(get_current_user)):
    return {"topics": TOPIC_BANK, "scenarios": SCENARIOS, "categories": CATEGORY_LABELS}


@router.get("/personas")
async def personas(user: str = Depends(get_current_user)):
    return {"personas": public_personas()}
