import os

from dotenv import load_dotenv

load_dotenv()


def _flag(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes", "on")


class Settings:
    APP_NAME = "Eng2Mouth"
    SECRET_KEY = os.getenv("SECRET_KEY", "change-me")

    MAIL_SENDER = (os.getenv("MAIL_SENDER", "") or "").strip().strip('"')
    MAIL_PASSWORD = (os.getenv("MAIL_PASSWORD", "") or "").strip().strip('"')
    SIGNUP_REQUIRE_EMAIL = _flag("SIGNUP_REQUIRE_EMAIL", "true") and bool(
        MAIL_SENDER and MAIL_PASSWORD
    )

    # ---- OpenAI (모든 호출은 사용자 개인 API Key 로 이루어진다) ----
    OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip(
        "/"
    )
    REALTIME_MODEL = os.getenv("REALTIME_MODEL", "gpt-realtime-2.1")
    REALTIME_MINI_MODEL = os.getenv("REALTIME_MINI_MODEL", "gpt-realtime-2.1-mini")
    TRANSCRIBE_MODEL = os.getenv("TRANSCRIBE_MODEL", "gpt-4o-transcribe")
    CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-5.6-luna")
    TTS_MODEL = os.getenv("TTS_MODEL", "gpt-4o-mini-tts")
    DEFAULT_VOICE = os.getenv("DEFAULT_VOICE", "marin")

    # ---- Google Gemini (두 번째 제공자, 사용자 개인 키) ----
    GEMINI_BASE_URL = os.getenv(
        "GEMINI_BASE_URL", "https://generativelanguage.googleapis.com"
    ).rstrip("/")
    # Live(실시간 음성) 모델. 키에서 접근 가능한 목록에 없으면 'native-audio' 가 들어간 최신 모델을 자동 선택한다.
    GEMINI_LIVE_MODEL = os.getenv("GEMINI_LIVE_MODEL", "gemini-3.8-live")
    GEMINI_CHAT_MODEL = os.getenv("GEMINI_CHAT_MODEL", "gemini-3.8-flash")  # 평가
    GEMINI_FAST_MODEL = os.getenv(
        "GEMINI_FAST_MODEL", "gemini-3.5-flash-lite"
    )  # 힌트/번역/주제
    GEMINI_TTS_MODEL = os.getenv("GEMINI_TTS_MODEL", "gemini-3.8-flash-tts")
    GEMINI_DEFAULT_VOICE = os.getenv("GEMINI_DEFAULT_VOICE", "Aoede")
    # 임시 토큰(v1alpha auth_tokens) 발급이 불가능한 환경에서 키를 브라우저에 직접 넘기는 폴백 허용 여부 (기본 꺼짐)
    GEMINI_ALLOW_DIRECT_KEY = _flag("GEMINI_ALLOW_DIRECT_KEY", "false")
    GEMINI_VOICES = [
        {
            "id": "Aoede",
            "label": "Aoede",
            "desc": "산뜻하고 자연스러운 여성 (추천)",
            "gender": "f",
        },
        {"id": "Kore", "label": "Kore", "desc": "단단하고 또렷한 여성", "gender": "f"},
        {"id": "Leda", "label": "Leda", "desc": "젊고 밝은 여성", "gender": "f"},
        {"id": "Zephyr", "label": "Zephyr", "desc": "경쾌한 여성", "gender": "f"},
        {"id": "Sulafat", "label": "Sulafat", "desc": "따뜻한 여성", "gender": "f"},
        {"id": "Puck", "label": "Puck", "desc": "활기찬 남성 (추천)", "gender": "m"},
        {
            "id": "Charon",
            "label": "Charon",
            "desc": "차분하고 낮은 남성",
            "gender": "m",
        },
        {"id": "Fenrir", "label": "Fenrir", "desc": "힘 있는 남성", "gender": "m"},
        {"id": "Orus", "label": "Orus", "desc": "안정적인 남성", "gender": "m"},
        {
            "id": "Enceladus",
            "label": "Enceladus",
            "desc": "부드러운 남성",
            "gender": "m",
        },
    ]
    GEMINI_VOICE_IDS = [v["id"] for v in GEMINI_VOICES]

    PROVIDERS = [
        {
            "id": "openai",
            "label": "OpenAI",
            "desc": "gpt-realtime · 가장 사람 같은 목소리",
        },
        {
            "id": "gemini",
            "label": "Google Gemini",
            "desc": "Gemini Live · 저렴, 무료 티어 있음",
        },
    ]
    PROVIDER_IDS = [p["id"] for p in PROVIDERS]

    BASE_DIR = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    STATIC_DIR = os.path.join(BASE_DIR, "static")
    PROFILE_DIR = os.path.join(STATIC_DIR, "profiles")

    # 사용자가 고를 수 있는 목소리 (Realtime API GA 기준). marin/cedar 가 가장 자연스럽다.
    VOICES = [
        {
            "id": "marin",
            "label": "Marin",
            "desc": "따뜻하고 또렷한 여성 목소리 (추천)",
            "gender": "f",
        },
        {
            "id": "cedar",
            "label": "Cedar",
            "desc": "차분하고 자연스러운 남성 목소리 (추천)",
            "gender": "m",
        },
        {"id": "coral", "label": "Coral", "desc": "밝고 친근한 여성", "gender": "f"},
        {"id": "sage", "label": "Sage", "desc": "부드러운 여성", "gender": "f"},
        {"id": "shimmer", "label": "Shimmer", "desc": "경쾌한 여성", "gender": "f"},
        {
            "id": "ballad",
            "label": "Ballad",
            "desc": "낮고 안정적인 남성",
            "gender": "m",
        },
        {"id": "ash", "label": "Ash", "desc": "명료한 남성", "gender": "m"},
        {"id": "echo", "label": "Echo", "desc": "단단한 남성", "gender": "m"},
        {"id": "verse", "label": "Verse", "desc": "표현력 있는 남성", "gender": "m"},
        {"id": "alloy", "label": "Alloy", "desc": "중성적인 목소리", "gender": "n"},
    ]
    VOICE_IDS = [v["id"] for v in VOICES]

    LEVELS = [
        {"id": "beginner", "label": "초급 (A1–A2)", "short": "초급"},
        {"id": "intermediate", "label": "중급 (B1–B2)", "short": "중급"},
        {"id": "advanced", "label": "고급 (C1–C2)", "short": "고급"},
    ]
    LEVEL_IDS = [x["id"] for x in LEVELS]

    CORRECTION_MODES = [
        {
            "id": "gentle",
            "label": "자연스럽게 (추천)",
            "desc": "틀린 표현을 대화 속에서 올바르게 되받아 말해줍니다.",
        },
        {
            "id": "strict",
            "label": "적극 교정",
            "desc": "틀릴 때마다 짧게 짚어주고 다시 말해보게 합니다.",
        },
        {
            "id": "none",
            "label": "교정 없음",
            "desc": "통화 중에는 교정하지 않고 끝난 뒤 리포트로만 알려줍니다.",
        },
    ]
    CORRECTION_IDS = [x["id"] for x in CORRECTION_MODES]

    # Realtime 모델 선택지 (요금은 참고용 추정치)
    REALTIME_MODELS = [
        {
            "id": REALTIME_MODEL,
            "label": f"{REALTIME_MODEL} (최신, 가장 자연스러움)",
            "desc": "음성 입력 $32 / 출력 $64 per 1M tokens (추정)",
        },
        {
            "id": REALTIME_MINI_MODEL,
            "label": f"{REALTIME_MINI_MODEL} (저렴)",
            "desc": "음성 입력 $10 / 출력 $20 per 1M tokens (추정)",
        },
        {
            "id": "gpt-realtime",
            "label": "gpt-realtime (1세대)",
            "desc": "음성 입력 $32 / 출력 $64 per 1M tokens",
        },
        {
            "id": "gpt-realtime-mini",
            "label": "gpt-realtime-mini (1세대, 저렴)",
            "desc": "음성 입력 $10 / 출력 $20 per 1M tokens",
        },
    ]
    CHAT_MODELS = [
        {"id": "gpt-5.6-luna", "label": "GPT-5.6 Luna (기본, 저렴)"},
        {"id": "gpt-5.4-mini", "label": "GPT-5.4 mini"},
        {"id": "gpt-5.4-nano", "label": "GPT-5.4 nano (가장 저렴)"},
        {"id": "gpt-5.5", "label": "GPT-5.5"},
        {"id": "gpt-5.6-sol", "label": "GPT-5.6 Sol (가장 꼼꼼한 평가)"},
        {"id": "gpt-5-mini", "label": "GPT-5 mini (구형)"},
    ]


settings = Settings()
os.makedirs(settings.PROFILE_DIR, exist_ok=True)
