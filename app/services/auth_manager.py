import hashlib
import random
import re
import secrets
import time
import uuid
from datetime import datetime, timezone

import bcrypt

from app.core.assets import asset_url
from app.core.config import settings
from app.core.security import SESSION_IDLE_AGE, SESSION_MAX_AGE, hash_token
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
        "totp_enabled": False,
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
    def _fingerprint(user: dict) -> str:
        """비밀번호나 2FA 비밀이 바뀌면 모든 세션이 자동 무효가 되도록 하는 지문."""
        return hashlib.sha256(f"{user.get('password','')}|{user.get('totp_secret','')}".encode()).hexdigest()[:32]

    @staticmethod
    def check_password(username: str, password: str) -> dict | None:
        user = users_col.find_one({"username": username})
        if not user:
            bcrypt.checkpw(b"x", bcrypt.gensalt())  # 사용자 유무에 따른 응답 시간 차이 줄이기
            return None
        try:
            ok = bcrypt.checkpw(AuthManager._pre_hash(password), user["password"].encode())
        except ValueError:
            ok = False
        return user if ok else None

    @staticmethod
    def create_session(username: str, ip: str = "", user_agent: str = "") -> str:
        user = users_col.find_one({"username": username}) or {}
        session_id = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        sessions_col.insert_one({
            "session_id": hash_token(session_id), "username": username, "fp": AuthManager._fingerprint(user),
            "created_at": now, "last_seen": now, "ip": ip[:64], "ua": (user_agent or "")[:200],
        })
        return session_id

    @staticmethod
    def authenticate_user(username: str, password: str):
        user = AuthManager.check_password(username, password)
        return AuthManager.create_session(username) if user else None

    @staticmethod
    def get_user_by_session(session_id):
        if not session_id:
            return None
        s = sessions_col.find_one({"session_id": hash_token(session_id)})
        if not s:
            return None
        now = datetime.now(timezone.utc)
        created = s.get("created_at") or now
        last = s.get("last_seen") or created
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        if (now - created).total_seconds() > SESSION_MAX_AGE or (now - last).total_seconds() > SESSION_IDLE_AGE:
            sessions_col.delete_one({"_id": s["_id"]})
            return None
        user = users_col.find_one({"username": s["username"]}, {"password": 1, "totp_secret": 1})
        if not user or (s.get("fp") and s["fp"] != AuthManager._fingerprint(user)):
            sessions_col.delete_one({"_id": s["_id"]})
            return None
        if (now - last).total_seconds() > 300:
            sessions_col.update_one({"_id": s["_id"]}, {"$set": {"last_seen": now}})
        return s["username"]

    @staticmethod
    def logout(session_id):
        if session_id:
            sessions_col.delete_one({"session_id": hash_token(session_id)})

    @staticmethod
    def logout_all(username: str, keep_session_id: str | None = None) -> int:
        q = {"username": username}
        if keep_session_id:
            q["session_id"] = {"$ne": hash_token(keep_session_id)}
        return sessions_col.delete_many(q).deleted_count

    @staticmethod
    def list_sessions(username: str, current_session_id: str | None = None) -> list[dict]:
        cur = hash_token(current_session_id) if current_session_id else None
        out = []
        for s in sessions_col.find({"username": username}).sort("last_seen", -1):
            out.append({"current": s["session_id"] == cur, "ip": s.get("ip", ""), "ua": s.get("ua", ""),
                        "created_at": s.get("created_at").isoformat() if s.get("created_at") else None,
                        "last_seen": s.get("last_seen").isoformat() if s.get("last_seen") else None})
        return out

    @staticmethod
    def migrate_legacy_sessions():
        """예전(평문 session_id, uuid 36자) 세션을 해시 저장으로 전환."""
        n = 0
        for s in sessions_col.find({"session_id": {"$regex": "^[0-9a-f-]{36}$"}}):
            user = users_col.find_one({"username": s["username"]}) or {}
            sessions_col.update_one({"_id": s["_id"]}, {"$set": {"session_id": hash_token(s["session_id"]), "fp": AuthManager._fingerprint(user),
                                                                  "created_at": s.get("created_at") or datetime.now(timezone.utc), "last_seen": datetime.now(timezone.utc)}})
            n += 1
        return n

    @staticmethod
    def change_password(username: str, current: str, new: str) -> str:
        if not AuthManager.check_password(username, current):
            return "wrong_password"
        if len(new or "") < 6:
            return "weak_password"
        hashed = bcrypt.hashpw(AuthManager._pre_hash(new), bcrypt.gensalt()).decode()
        users_col.update_one({"username": username}, {"$set": {"password": hashed}})
        sessions_col.delete_many({"username": username})  # 지문이 바뀌어 어차피 무효 — 명시적으로 정리
        return "ok"

    # ---- 2단계 인증 (TOTP) ----
    @staticmethod
    def totp_status(username: str) -> dict:
        u = users_col.find_one({"username": username}, {"totp_enabled": 1}) or {}
        return {"enabled": bool(u.get("totp_enabled"))}

    @staticmethod
    def totp_begin(username: str, secret: str):
        users_col.update_one({"username": username}, {"$set": {"totp_pending_secret": secret}})

    @staticmethod
    def totp_enable(username: str) -> bool:
        u = users_col.find_one({"username": username}, {"totp_pending_secret": 1})
        if not u or not u.get("totp_pending_secret"):
            return False
        users_col.update_one({"username": username}, {"$set": {"totp_secret": u["totp_pending_secret"], "totp_enabled": True, "totp_last_step": 0}, "$unset": {"totp_pending_secret": ""}})
        return True

    @staticmethod
    def totp_disable(username: str):
        users_col.update_one({"username": username}, {"$set": {"totp_enabled": False}, "$unset": {"totp_secret": "", "totp_pending_secret": "", "totp_last_step": ""}})

    @staticmethod
    def totp_mark_used(username: str, step: int):
        users_col.update_one({"username": username}, {"$set": {"totp_last_step": int(step)}})

    @staticmethod
    def get_user_settings(username: str) -> dict:
        user = users_col.find_one({"username": username}) or {}
        out = default_user_fields()
        for k in out:
            if k in user and user[k] is not None:
                out[k] = user[k]
        out["username"] = username
        out["email"] = user.get("email", "")
        out["totp_enabled"] = bool(user.get("totp_enabled"))
        out["profile_img"] = user.get("profile_img") or asset_url("default_avatar.png")
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
