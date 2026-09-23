# Eng2Mouth — AI 전화영어

AI 원어민(실제로는 OpenAI Realtime 모델)과 **전화하듯** 영어 회화를 연습하고, 통화가 끝나면 말하기 평가 리포트를 받는 모바일 우선 웹앱입니다.

## 주요 기능
- 📞 **실시간 음성 통화** — OpenAI `gpt-realtime`(WebRTC) 또는 **Google Gemini Live**(WebSocket) 중 통화마다 선택. 발신음, 진동, 자연스러운 끼어들기, 통화 종료까지 진짜 전화처럼.
- 💸 **제공자·모델·목소리·평가 모델을 통화 직전에 선택** — 10분 통화 예상 요금을 함께 표시하고, 선택값은 DB에 저장돼 다음 통화 기본값이 됨. Gemini 는 AI Studio 무료 티어로 $0 연습 가능.
- 🧑‍🤝‍🧑 **페르소나 10종 + 직접 만들기** — 편한 친구, 교수, 튜터, 직장 동료, 상사, 면접관, 현지인, 할머니, 토론 파트너, 의사.
- 🗓️ **매일 바뀌는 추천 주제** 6개 + 오늘의 롤플레이 + GPT 개인화 추천 4개 + 직접 입력 + 자유 대화. 주제 뱅크 60개, 롤플레이 시나리오 16개.
- 📝 **통화 후 말하기 평가** — 종합 점수/CEFR, 유창성·문법·어휘·논리·상호작용, 잘한 점/보완점, 교정 문장, 가져갈 표현, 군말, 다음 목표.
- 🎧 통화 중 보조: 실시간 자막, 힌트(이렇게 말해보세요), 번역, 다시 천천히, 타이핑 입력, 보류, 음소거, 누르고 말하기(PTT).
- 📚 **표현 노트** — 리포트에서 저장 → TTS 듣기 → 플래시카드 복습 퀴즈.
- 📈 대시보드 — 연속 일수, 하루 목표, 14일 통화량, 점수 추이, 최근 통화.
- 🔎 **통화 기록** 전체 조회/검색/필터/북마크/메모, 대화 전문 + 문장별 번역, 같은 주제로 다시 통화.
- 🎨 LecAI 와 동일한 테마 시스템(오로라/그라디언트 메시/애플 글래스/미니멀 + 다크/라이트), PWA(홈 화면 설치).
- 🔐 회원가입(이메일 인증) / 로그인, 사용자별 OpenAI API Key, MongoDB 연동, 사용 요금 추정, 데이터 내보내기.

## 실행
```bash
uv sync
cp .env.example .env   # 값 채우기
python3 run.py          # 기본 포트 7005
```

## .env
| 키 | 설명 |
|---|---|
| `PORT` | 서비스 포트 (기본 7005) |
| `MONGO_*` | MongoDB 접속 정보 (DB: `eng2mouth`) |
| `MAIL_SENDER`, `MAIL_PASSWORD` | Gmail SMTP (없으면 이메일 인증 없이 가입) |
| `REALTIME_MODEL`, `REALTIME_MINI_MODEL` | 통화 모델 (`gpt-realtime`, `gpt-realtime-mini`) |
| `CHAT_MODEL` | 평가/힌트/번역/주제 생성 모델 (`gpt-5-mini`) |
| `TRANSCRIBE_MODEL`, `TTS_MODEL`, `DEFAULT_VOICE` | 사용자 음성 인식, 표현 듣기 TTS, 기본 목소리 |
| `GEMINI_LIVE_MODEL` | Gemini Live 모델 (키로 접근 불가하면 최신 `native-audio` 모델 자동 선택) |
| `GEMINI_CHAT_MODEL`, `GEMINI_FAST_MODEL`, `GEMINI_TTS_MODEL`, `GEMINI_DEFAULT_VOICE` | Gemini 평가 / 힌트·번역 / TTS 모델, 기본 목소리 |
| `GEMINI_ALLOW_DIRECT_KEY` | 임시 토큰 발급 실패 시 키를 브라우저에 직접 넘기는 폴백 허용 (기본 false) |

## 구조
```
app/
  main.py            FastAPI 앱
  core/config.py     설정 · 목소리/레벨/모델 목록
  db/                MongoDB (users, sessions, calls, phrases, daily_picks)
  routes/            view / auth / user / call / topic / assist / phrase / stats
  services/          auth_manager, personas, topics, prompts, openai_service, gemini_service, llm(제공자 분기), call_service, pricing
  templates/         base(공통 레이아웃) + dashboard, call, history, call_detail, topics, phrases, settings, login, signup
static/shared/       app.css, theme.css, theme.js  · manifest, sw.js, icons
```

## 통화 동작 원리
1. `POST /api/calls/start` — 서버가 사용자 키로 **임시 토큰**을 발급 (OpenAI: Realtime client secret 10분 / Gemini: v1alpha auth_tokens 1회용). 페르소나·레벨·주제·교정 방식으로 instructions 구성. 이때 고른 제공자/모델/목소리는 사용자 기본값으로 저장.
2. 브라우저가 OpenAI(WebRTC) 또는 Gemini(WebSocket, PCM16 16kHz↑/24kHz↓)에 직접 연결 (실제 키는 브라우저에 가지 않음). 자막·사용량·`end_call` 툴 이벤트를 받아 동일한 통화 UI로 처리.
3. 종료 시 `POST /api/calls/{id}/finish` (트랜스크립트·사용량 저장) → `POST /api/calls/{id}/evaluate` (JSON 스키마 강제 평가).
