"""표현 노트(Phrasebook): 평가 리포트에서 저장한 표현을 모아 복습한다."""

from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.db import phrases_col
from app.routes.deps import get_current_user

router = APIRouter()


class PhraseIn(BaseModel):
    phrase: str
    meaning_ko: str = ""
    example: str = ""
    source_call_id: str | None = None
    kind: str = "expression"  # expression | correction


class PhrasePatch(BaseModel):
    learned: bool | None = None
    meaning_ko: str | None = None
    example: str | None = None


def _ser(p: dict) -> dict:
    return {
        "id": str(p["_id"]),
        "phrase": p.get("phrase", ""),
        "meaning_ko": p.get("meaning_ko", ""),
        "example": p.get("example", ""),
        "kind": p.get("kind", "expression"),
        "learned": bool(p.get("learned")),
        "source_call_id": p.get("source_call_id"),
        "created_at": p["created_at"].isoformat()
        if isinstance(p.get("created_at"), datetime)
        else None,
        "reviews": int(p.get("reviews", 0)),
    }


@router.get("/phrases")
async def list_phrases(
    user: str = Depends(get_current_user),
    q: str = "",
    learned: str = "",
    limit: int = Query(500, le=1000),
):
    query: dict = {"owner": user}
    if q:
        query["$or"] = [
            {"phrase": {"$regex": q, "$options": "i"}},
            {"meaning_ko": {"$regex": q, "$options": "i"}},
        ]
    if learned == "1":
        query["learned"] = True
    elif learned == "0":
        query["learned"] = {"$ne": True}
    items = [
        _ser(p) for p in phrases_col.find(query).sort("created_at", -1).limit(limit)
    ]
    return {"items": items, "total": phrases_col.count_documents({"owner": user})}


@router.post("/phrases")
async def add_phrase(req: PhraseIn, user: str = Depends(get_current_user)):
    phrase = req.phrase.strip()
    if not phrase:
        raise HTTPException(status_code=400, detail="표현이 비어 있습니다.")
    existing = phrases_col.find_one({"owner": user, "phrase": phrase})
    if existing:
        return {"status": "exists", "item": _ser(existing)}
    doc = {
        "owner": user,
        "phrase": phrase[:300],
        "meaning_ko": req.meaning_ko.strip()[:300],
        "example": req.example.strip()[:400],
        "kind": req.kind if req.kind in ("expression", "correction") else "expression",
        "source_call_id": req.source_call_id,
        "learned": False,
        "reviews": 0,
        "created_at": datetime.now(timezone.utc),
    }
    res = phrases_col.insert_one(doc)
    doc["_id"] = res.inserted_id
    return {"status": "ok", "item": _ser(doc)}


@router.patch("/phrases/{pid}")
async def patch_phrase(
    pid: str, req: PhrasePatch, user: str = Depends(get_current_user)
):
    update = {k: v for k, v in req.model_dump().items() if v is not None}
    inc = {}
    if "learned" in update:
        inc["reviews"] = 1
    op = {"$set": update} if update else {}
    if inc:
        op["$inc"] = inc
    if op:
        phrases_col.update_one({"_id": ObjectId(pid), "owner": user}, op)
    return {"status": "ok"}


@router.delete("/phrases/{pid}")
async def delete_phrase(pid: str, user: str = Depends(get_current_user)):
    phrases_col.delete_one({"_id": ObjectId(pid), "owner": user})
    return {"status": "ok"}
