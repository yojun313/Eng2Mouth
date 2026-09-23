import hashlib
import random
import re
import time
import uuid
from datetime import datetime, timezone

import bcrypt

from app.core.config import settings
from app.db import sessions_col, users_col
from app.services.email_service import send_verification_email
from app.services.personas import DEFAULT_PERSONA_ID, PERSONA_IDS

# email -> {username, password, code, ts}
verification_codes: dict[str, dict] = {}
USERNAME_RE = re.compile(r"^[a-zA-Z0-9_.-]{3,24}$")


def default_user_fields() -> dict:
    return {
        "openai_api_key": "",
        "gemini_api_key": "",
        "provider": "openai",
        "gemini_voice": settings.GEMINI_DEFAULT_VOICE,
        "gemini_live_model": "",  # 비우면 키로 접근 가능한 최신 native-audio 모델 자동 선택
        "gemini_chat_model": settings.GEMINI_CHAT_MODEL,
        "profile_img": "",
        "level": "intermediate",
        "voice": settings.DEFAULT_VOICE,
        "persona": DEFAULT_PERSONA_ID,
        "custom_persona": {"name": "", "description": ""},
        "correction_mode": "gentle",
        "turn_mode": "auto",  # auto(핸즈프리) | ptt(누르고 말하기)
        "speed": 1.0,
        "realtime_model": settings.REALTIME_MODEL,
        "chat_model": settings.CHAT_MODEL,
        "captions": True,
        "allow_korean": True,
        "daily_goal_min": 10,
        "hide_api_key_notice": False,
        "total_spent_usd": 0.0,
    }


class AuthManager:
    @staticmethod
    def _pre_hash(password: str) -> bytes:
        return hashlib.sha256(password.encode("utf-8")).hexdigest().encode("utf-8")

    @staticmethod
    def _validate(username: str, password: str):
        if not USERNAME_RE.match(username or ""):
            return "invalid_username"
        if len(password or "") < 6:
            return "weak_password"
        return None

    @staticmethod
    def request_signup(username: str, password: str, email: str):
        err = AuthManager._validate(username, password)
        if err:
            return err
        if users_col.find_one({"username": username}):
            return "username_exists"
        if email and users_col.find_one({"email": email}):
            return "email_exists"

        if not settings.SIGNUP_REQUIRE_EMAIL:
            AuthManager._insert_user(username, password, email, verified=False)
            return "created"

        code = str(random.randint(100000, 999999))
        if send_verification_email(email, code):
            verification_codes[email] = {
                "username": username,
                "password": password,
                "code": code,
                "ts": time.time(),
            }
            return "success"
        return "mail_failed"

    @staticmethod
    def verify_and_create_user(email: str, code: str) -> bool:
        data = verification_codes.get(email)
        if not data or data["code"] != code:
            return False
        if time.time() - data["ts"] > 60 * 15:
            del verification_codes[email]
            return False
        if users_col.find_one({"username": data["username"]}):
            del verification_codes[email]
            return False
        AuthManager._insert_user(
            data["username"], data["password"], email, verified=True
        )
        del verification_codes[email]
        return True

    @staticmethod
    def _insert_user(username, password, email, verified):
        hashed = bcrypt.hashpw(
            AuthManager._pre_hash(password), bcrypt.gensalt()
        ).decode()
        doc = {
            "username": username,
            "password": hashed,
            "email": email or "",
            "verified": verified,
            "created_at": datetime.now(timezone.utc),
        }
        doc.update(default_user_fields())
        users_col.insert_one(doc)

    @staticmethod
    def authenticate_user(username: str, password: str):
        user = users_col.find_one({"username": username})
        if not user:
            return None
        if bcrypt.checkpw(AuthManager._pre_hash(password), user["password"].encode()):
            session_id = str(uuid.uuid4())
            sessions_col.insert_one(
                {
                    "session_id": session_id,
                    "username": username,
                    "created_at": datetime.now(timezone.utc),
                }
            )
            return session_id
        return None

    @staticmethod
    def change_password(username: str, current: str, new: str) -> str:
        user = users_col.find_one({"username": username})
        if not user or not bcrypt.checkpw(
            AuthManager._pre_hash(current), user["password"].encode()
        ):
            return "wrong_password"
        if len(new or "") < 6:
            return "weak_password"
        hashed = bcrypt.hashpw(AuthManager._pre_hash(new), bcrypt.gensalt()).decode()
        users_col.update_one({"username": username}, {"$set": {"password": hashed}})
        return "ok"

    @staticmethod
    def get_user_by_session(session_id):
        if not session_id:
            return None
        s = sessions_col.find_one({"session_id": session_id})
        return s["username"] if s else None

    @staticmethod
    def logout(session_id):
        if session_id:
            sessions_col.delete_one({"session_id": session_id})

    @staticmethod
    def get_user_settings(username: str) -> dict:
        user = users_col.find_one({"username": username}) or {}
        out = default_user_fields()
        for k in out:
            if k in user and user[k] is not None:
                out[k] = user[k]
        out["username"] = username
        out["email"] = user.get("email", "")
        out["profile_img"] = user.get("profile_img") or "/static/default_avatar.png"
        if out["persona"] not in PERSONA_IDS and out["persona"] != "custom":
            out["persona"] = DEFAULT_PERSONA_ID
        if out["voice"] not in settings.VOICE_IDS:
            out["voice"] = settings.DEFAULT_VOICE
        if out["gemini_voice"] not in settings.GEMINI_VOICE_IDS:
            out["gemini_voice"] = settings.GEMINI_DEFAULT_VOICE
        if out["provider"] not in settings.PROVIDER_IDS:
            out["provider"] = "openai"
        try:
            out["speed"] = max(0.6, min(1.5, float(out["speed"])))
        except (TypeError, ValueError):
            out["speed"] = 1.0
        return out

    @staticmethod
    def update_settings(username: str, data: dict) -> bool:
        allowed = {
            "openai_api_key": str,
            "gemini_api_key": str,
            "provider": str,
            "gemini_voice": str,
            "gemini_live_model": str,
            "gemini_chat_model": str,
            "level": str,
            "voice": str,
            "persona": str,
            "custom_persona": dict,
            "correction_mode": str,
            "turn_mode": str,
            "speed": float,
            "realtime_model": str,
            "chat_model": str,
            "captions": bool,
            "allow_korean": bool,
            "daily_goal_min": int,
            "hide_api_key_notice": bool,
            "profile_img": str,
        }
        update = {}
        for k, typ in allowed.items():
            if k not in data or data[k] is None:
                continue
            v = data[k]
            try:
                if typ is bool:
                    v = (
                        v
                        if isinstance(v, bool)
                        else str(v).lower() in ("1", "true", "on", "yes")
                    )
                elif typ is float:
                    v = float(v)
                elif typ is int:
                    v = int(v)
                elif typ is dict:
                    v = {
                        "name": str(v.get("name", ""))[:40],
                        "description": str(v.get("description", ""))[:1200],
                    }
                else:
                    v = str(v).strip()
            except (TypeError, ValueError):
                continue
            update[k] = v

        if "level" in update and update["level"] not in settings.LEVEL_IDS:
            update.pop("level")
        if "voice" in update and update["voice"] not in settings.VOICE_IDS:
            update.pop("voice")
        if (
            "gemini_voice" in update
            and update["gemini_voice"] not in settings.GEMINI_VOICE_IDS
        ):
            update.pop("gemini_voice")
        if "provider" in update and update["provider"] not in settings.PROVIDER_IDS:
            update.pop("provider")
        for k in (
            "gemini_live_model",
            "gemini_chat_model",
            "chat_model",
            "realtime_model",
        ):
            if k in update and not re.match(r"^[A-Za-z0-9._:\-]{0,80}$", update[k]):
                update.pop(k)
        if (
            "persona" in update
            and update["persona"] not in PERSONA_IDS
            and update["persona"] != "custom"
        ):
            update.pop("persona")
        if (
            "correction_mode" in update
            and update["correction_mode"] not in settings.CORRECTION_IDS
        ):
            update.pop("correction_mode")
        if "turn_mode" in update and update["turn_mode"] not in ("auto", "ptt"):
            update.pop("turn_mode")
        if "speed" in update:
            update["speed"] = max(0.6, min(1.5, update["speed"]))
        if "daily_goal_min" in update:
            update["daily_goal_min"] = max(1, min(180, update["daily_goal_min"]))
        if not update:
            return True
        res = users_col.update_one({"username": username}, {"$set": update})
        return res.matched_count > 0

    @staticmethod
    def add_usage(username: str, cost_usd: float):
        if cost_usd and cost_usd > 0:
            users_col.update_one(
                {"username": username}, {"$inc": {"total_spent_usd": float(cost_usd)}}
            )

    @staticmethod
    def get_usage(username: str) -> float:
        u = users_col.find_one({"username": username}, {"total_spent_usd": 1})
        return float(u.get("total_spent_usd", 0.0)) if u else 0.0
