"""통화 기록 저장/통계/평가 오케스트레이션."""

import re
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from app.db import calls_col, phrases_col
from app.services import llm, pricing
from app.services.prompts import EVAL_SCHEMA, EVAL_SYSTEM
from app.services.topics import KST

FILLERS = [
    "um",
    "uh",
    "like",
    "you know",
    "i mean",
    "actually",
    "basically",
    "so",
    "well",
]
WORD_RE = re.compile(r"[A-Za-z']+")


def new_call_id() -> str:
    return uuid.uuid4().hex


def compute_stats(transcript: list[dict], duration_sec: int) -> dict:
    user_texts = [t.get("text", "") for t in transcript if t.get("role") == "user"]
    ai_texts = [t.get("text", "") for t in transcript if t.get("role") == "assistant"]
    words = [w.lower() for txt in user_texts for w in WORD_RE.findall(txt)]
    ai_words = [w for txt in ai_texts for w in WORD_RE.findall(txt)]
    joined = " ".join(user_texts).lower()
    filler_counts = {}
    for f in FILLERS:
        c = len(re.findall(rf"\b{re.escape(f)}\b", joined))
        if c:
            filler_counts[f] = c
    minutes = max(duration_sec, 1) / 60
    return {
        "user_turns": len(user_texts),
        "ai_turns": len(ai_texts),
        "user_words": len(words),
        "ai_words": len(ai_words),
        "unique_words": len(set(words)),
        "avg_words_per_turn": round(len(words) / len(user_texts), 1)
        if user_texts
        else 0,
        "words_per_minute": round(len(words) / minutes, 1),
        "talk_share": round(len(words) / (len(words) + len(ai_words)) * 100)
        if (words or ai_words)
        else 0,
        "filler_counts": filler_counts,
        "longest_turn_words": max(
            (len(WORD_RE.findall(t)) for t in user_texts), default=0
        ),
    }


def transcript_text(transcript: list[dict]) -> str:
    lines = []
    for t in transcript:
        role = "USER" if t.get("role") == "user" else "PARTNER"
        txt = (t.get("text") or "").strip()
        if txt:
            lines.append(f"{role}: {txt}")
    return "\n".join(lines)


async def evaluate_call(username: str, call: dict, user_settings: dict) -> dict:
    transcript = call.get("transcript") or []
    user_turns = [
        t
        for t in transcript
        if t.get("role") == "user" and (t.get("text") or "").strip()
    ]
    if (
        len(user_turns) < 2
        or sum(len(WORD_RE.findall(t["text"])) for t in user_turns) < 12
    ):
        raise HTTPException(
            status_code=400,
            detail="평가하기에는 발화가 너무 적습니다. 다음엔 조금 더 길게 이야기해 보세요!",
        )

    topic = call.get("topic") or {}
    system = EVAL_SYSTEM.replace(
        "{level}", user_settings.get("level", "intermediate")
    ).replace("{topic}", str(topic.get("title") or topic.get("kind") or "free talk"))
    result, meta = await llm.chat_json(
        username,
        user_settings,
        system,
        transcript_text(transcript),
        schema=EVAL_SCHEMA,
        max_tokens=4000,
        quality="best",
    )
    model, eval_cost = meta["model"], meta["cost_usd"]

    # 점수 범위 보정
    result["overall"] = int(max(0, min(100, result.get("overall", 0))))
    for k, v in (result.get("scores") or {}).items():
        result["scores"][k] = int(max(0, min(100, v)))
    result["model"] = model
    result["cost_usd"] = eval_cost
    result["evaluated_at"] = datetime.now(timezone.utc)

    calls_col.update_one(
        {"id": call["id"]},
        {"$set": {"evaluation": result, "status": "evaluated"}, "$inc": {"cost_usd": eval_cost}},
    )
    return result


def serialize_call(doc: dict, full: bool = False) -> dict:
    out = {
        "id": doc["id"],
        "topic": doc.get("topic"),
        "persona": doc.get("persona"),
        "status": doc.get("status"),
        "started_at": _iso(doc.get("started_at")),
        "ended_at": _iso(doc.get("ended_at")),
        "duration_sec": doc.get("duration_sec", 0),
        "stats": doc.get("stats") or {},
        "cost_usd": round(float(doc.get("cost_usd", 0) or 0), 4),
        "cost_krw": pricing.to_krw(doc.get("cost_usd", 0) or 0),
        "usd_krw": round(pricing.current_rate(), 2),
        "provider": doc.get("provider", "openai"),
        "model": doc.get("model"),
        "overall": (doc.get("evaluation") or {}).get("overall"),
        "cefr": (doc.get("evaluation") or {}).get("cefr"),
        "bookmarked": bool(doc.get("bookmarked")),
        "note": doc.get("note", ""),
    }
    if full:
        ev = dict(doc.get("evaluation") or {})
        if ev.get("evaluated_at"):
            ev["evaluated_at"] = _iso(ev["evaluated_at"])
        out["evaluation"] = ev or None
        out["transcript"] = doc.get("transcript") or []
        out["usage"] = doc.get("usage") or {}
        out["level"] = doc.get("level")
        out["saved_phrases"] = [
            p["phrase"]
            for p in phrases_col.find(
                {"owner": doc["owner"], "source_call_id": doc["id"]}, {"phrase": 1}
            )
        ]
    return out


def _iso(v):
    if isinstance(v, datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.isoformat()
    return v


def dashboard_stats(username: str, daily_goal_min: int) -> dict:
    now = datetime.now(KST)
    since = (now - timedelta(days=90)).astimezone(timezone.utc)
    docs = list(
        calls_col.find(
            {
                "owner": username,
                "status": {"$in": ["ended", "evaluated"]},
                "started_at": {"$gte": since},
            },
            {
                "started_at": 1,
                "duration_sec": 1,
                "evaluation.overall": 1,
                "evaluation.cefr": 1,
                "topic.title": 1,
            },
        )
    )
    per_day: dict[str, dict] = {}
    for d in docs:
        st = d.get("started_at")
        if not isinstance(st, datetime):
            continue
        if st.tzinfo is None:
            st = st.replace(tzinfo=timezone.utc)
        day = st.astimezone(KST).strftime("%Y-%m-%d")
        slot = per_day.setdefault(day, {"sec": 0, "calls": 0, "scores": []})
        slot["sec"] += int(d.get("duration_sec") or 0)
        slot["calls"] += 1
        sc = (d.get("evaluation") or {}).get("overall")
        if isinstance(sc, (int, float)):
            slot["scores"].append(sc)

    # streak: 오늘 또는 어제부터 연속
    streak = 0
    cursor = now.date()
    if cursor.strftime("%Y-%m-%d") not in per_day:
        cursor -= timedelta(days=1)
    while cursor.strftime("%Y-%m-%d") in per_day:
        streak += 1
        cursor -= timedelta(days=1)

    last14 = []
    for i in range(13, -1, -1):
        day = (now - timedelta(days=i)).strftime("%Y-%m-%d")
        slot = per_day.get(day, {"sec": 0, "calls": 0, "scores": []})
        last14.append(
            {
                "date": day,
                "label": (now - timedelta(days=i)).strftime("%d"),
                "min": round(slot["sec"] / 60, 1),
                "calls": slot["calls"],
            }
        )

    today = per_day.get(now.strftime("%Y-%m-%d"), {"sec": 0, "calls": 0, "scores": []})
    week_days = [(now - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(7)]
    week_sec = sum(per_day.get(d, {"sec": 0})["sec"] for d in week_days)
    recent_scores = [s for d in sorted(per_day) for s in per_day[d]["scores"]][-10:]
    total_calls = calls_col.count_documents(
        {"owner": username, "status": {"$in": ["ended", "evaluated"]}}
    )
    total_sec_agg = list(
        calls_col.aggregate(
            [
                {
                    "$match": {
                        "owner": username,
                        "status": {"$in": ["ended", "evaluated"]},
                    }
                },
                {"$group": {"_id": None, "sec": {"$sum": "$duration_sec"}}},
            ]
        )
    )
    total_sec = int(total_sec_agg[0]["sec"]) if total_sec_agg else 0

    # 점수 추이 (최근 평가 12개)
    trend_docs = list(
        calls_col.find(
            {"owner": username, "status": "evaluated"},
            {
                "started_at": 1,
                "evaluation.overall": 1,
                "evaluation.scores": 1,
                "evaluation.cefr": 1,
                "topic.title": 1,
                "id": 1,
            },
        )
        .sort("started_at", -1)
        .limit(12)
    )
    trend = [
        {
            "id": d["id"],
            "date": _iso(d.get("started_at")),
            "overall": d["evaluation"].get("overall"),
            "cefr": d["evaluation"].get("cefr"),
            "scores": d["evaluation"].get("scores") or {},
            "title": (d.get("topic") or {}).get("title"),
        }
        for d in reversed(trend_docs)
    ]

    return {
        "streak": streak,
        "today_min": round(today["sec"] / 60, 1),
        "today_calls": today["calls"],
        "daily_goal_min": daily_goal_min,
        "goal_pct": min(100, round(today["sec"] / 60 / max(daily_goal_min, 1) * 100)),
        "week_min": round(week_sec / 60, 1),
        "total_calls": total_calls,
        "total_min": round(total_sec / 60),
        "avg_score": round(sum(recent_scores) / len(recent_scores))
        if recent_scores
        else None,
        "last14": last14,
        "trend": trend,
        "phrase_count": phrases_col.count_documents({"owner": username}),
        "phrase_due": phrases_col.count_documents(
            {"owner": username, "learned": {"$ne": True}}
        ),
    }
