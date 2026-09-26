const { api, swr, haptic, toast, esc, fmtDur, fmtKrw, scoreColor, isComposing, bindDraft, actionSheet } = window.AppUI;

// =====================================================================================
//  Eng2Mouth Call — OpenAI Realtime (WebRTC) 전화 통화
//  흐름: setup → /api/calls/start(임시키) → WebRTC 연결(발신음) → 통화 → 종료 → 저장/평가 → 리포트
// =====================================================================================
const PD = window.AppUI.pageData();
const PERSONAS = PD.personas || [];
const USER = PD.settings || {};
const REALTIME_MODEL = PD.realtime_model;
const STATIC_MODELS = {
    openai: { voice_models: PD.realtime_models || [], text_models: PD.chat_models || [], voices: PD.voices || [] },
    gemini: { voice_models: [{ id: '', label: '자동 (최신 native-audio)', desc: '' }], text_models: [{ id: PD.gemini_fast_model, label: PD.gemini_fast_model + ' (가장 저렴)' }, { id: PD.gemini_chat_model, label: PD.gemini_chat_model + ' (기본)' }], voices: PD.gemini_voices || [] },
};
const PROVIDER_INFO = { openai: { label: 'OpenAI', icon: 'fa-bolt', desc: 'gpt-realtime · 가장 사람 같은 목소리' }, gemini: { label: 'Google Gemini', icon: 'fa-gem', desc: 'Gemini Live · 저렴 · 무료 티어' } };
const params = new URLSearchParams(location.search);

const gradColors = { 'from-pink-500': ['rgba(236,72,153,.5)', 'rgba(251,146,60,.3)'], 'from-indigo-500': ['rgba(99,102,241,.5)', 'rgba(59,130,246,.3)'], 'from-emerald-500': ['rgba(16,185,129,.5)', 'rgba(45,212,191,.3)'], 'from-slate-500': ['rgba(100,116,139,.5)', 'rgba(6,182,212,.3)'], 'from-amber-500': ['rgba(245,158,11,.5)', 'rgba(248,113,113,.3)'], 'from-violet-500': ['rgba(139,92,246,.5)', 'rgba(168,85,247,.3)'], 'from-sky-500': ['rgba(14,165,233,.5)', 'rgba(52,211,153,.3)'], 'from-rose-400': ['rgba(251,113,133,.5)', 'rgba(249,168,212,.3)'], 'from-fuchsia-500': ['rgba(217,70,239,.5)', 'rgba(99,102,241,.3)'], 'from-teal-500': ['rgba(20,184,166,.5)', 'rgba(96,165,250,.3)'], 'from-blue-500': ['rgba(59,130,246,.5)', 'rgba(139,92,246,.3)'] };

// ---------- 상태 ----------
const setup = {
    kind: params.get('kind') || 'topic', topicId: params.get('id') || null, customTitle: params.get('title') || '',
    persona: USER.persona || 'friend', level: USER.level, correction: USER.correction_mode, turn: USER.turn_mode || 'auto',
    provider: USER.provider || 'openai',
    realtime_model: USER.realtime_model || REALTIME_MODEL, gemini_live_model: USER.gemini_live_model || '',
    voice: USER.voice || 'marin', gemini_voice: USER.gemini_voice || 'Aoede',
    chat_model: USER.chat_model || PD.chat_model, gemini_chat_model: USER.gemini_chat_model || PD.gemini_chat_model,
    topicLabel: '', topicEmoji: '💬',
};
let MODELS = JSON.parse(JSON.stringify(STATIC_MODELS));
MODELS.openai.has_key = !!USER.has_openai_key; MODELS.gemini.has_key = !!USER.has_gemini_key;
let today = null;
const call = { id: null, provider: 'openai', ws: null, P: null, pc: null, dc: null, mic: null, audioEl: null, startedAt: null, timer: null, connected: false, ended: false, muted: false, held: false, captions: USER.captions !== false, items: [], itemMap: {}, aiCurrent: '', usage: { text_in: 0, text_cached: 0, text_out: 0, audio_in: 0, audio_cached: 0, audio_out: 0 }, aiSpeaking: false, endRequested: false, wakeLock: null, ptt: false };

// ---------- 발신음 / 효과음 (WebAudio) ----------
let actx = null, ringTimer = null, ringNodes = [];
function ensureAudioCtx() { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); return actx; }
function startRingback() {
    const ctx = ensureAudioCtx();
    const burst = () => {
        const g = ctx.createGain(); g.gain.value = 0; g.connect(ctx.destination);
        const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(); o1.frequency.value = 440; o2.frequency.value = 480; o1.connect(g); o2.connect(g);
        const t = ctx.currentTime; g.gain.linearRampToValueAtTime(0.06, t + 0.02); g.gain.setValueAtTime(0.06, t + 0.98); g.gain.linearRampToValueAtTime(0, t + 1.0);
        o1.start(t); o2.start(t); o1.stop(t + 1.02); o2.stop(t + 1.02); ringNodes.push(o1, o2);
    };
    burst(); ringTimer = setInterval(burst, 3000);
}
function stopRingback() { clearInterval(ringTimer); ringTimer = null; ringNodes.forEach((n) => { try { n.stop(); } catch (e) {} }); ringNodes = []; }
function beep(freq = 880, dur = 0.12, vol = 0.05) { try { const ctx = ensureAudioCtx(); const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = freq; g.gain.value = vol; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + dur); } catch (e) {} }
function hangupTone() { beep(480, 0.25, 0.05); setTimeout(() => beep(480, 0.25, 0.05), 400); }
// 연결 · 상대가 끊음처럼 제스처 밖에서 일어나는 알림은 안드로이드 진동만 (iOS 햅틱은 제스처 안에서만 울린다)
function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }

// ---------- 준비 화면 ----------
function show(id) { ['setupScreen', 'callScreen', 'reportScreen'].forEach((s) => document.getElementById(s).hidden = s !== id); }
function personaOf(id) { return PERSONAS.find((p) => p.id === id) || PERSONAS[0]; }
function renderSetupPersonas() {
    const row = document.getElementById('setupPersonas');
    row.innerHTML = PERSONAS.map((p) => `<button type="button" data-id="${p.id}" class="opt-card flex-shrink-0 w-[108px] text-left ${p.id === setup.persona ? 'selected' : ''}">
        <div class="w-9 h-9 rounded-lg bg-gradient-to-br ${p.gradient} flex items-center justify-center text-lg mb-1.5">${p.emoji}</div>
        <p class="text-xs font-bold truncate">${esc(p.name)}</p><p class="text-[10px] text-white/45 truncate">${esc(p.title)}</p></button>`).join('');
    row.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { setup.persona = b.dataset.id; persist({ persona: b.dataset.id }); renderSetupPersonas(); if (document.getElementById('providerCards').innerHTML) renderModelSection(); }));
    const p = personaOf(setup.persona);
    document.getElementById('personaDesc').innerHTML = `<b>${esc(p.name)}</b> · ${esc(p.accent)}<br>${esc(p.tagline)}${p.id === 'custom' && !(USER.custom_persona && USER.custom_persona.description) ? '<br><span class="text-amber-300">설정에서 설명을 적어두면 더 개성 있는 상대가 됩니다.</span>' : ''}`;
    row.querySelector('.selected')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
}
function setTopicChoice(kind, t) {
    setup.kind = kind; setup.topicId = t ? t.id : null; setup.customTitle = kind === 'custom' ? (t.title || '') : '';
    setup.topicLabel = t ? (t.title_ko || t.title) : '자유 대화'; setup.topicEmoji = t ? (t.emoji || '💬') : '📞';
    const sub = kind === 'scenario' ? `롤플레이 · AI: ${t.ai_role}` : kind === 'free' ? '아무 얘기나 편하게' : (t && t.description_ko) || (t && t.title) || '';
    document.getElementById('setupTopic').innerHTML = `<div class="text-2xl">${setup.topicEmoji}</div><div class="min-w-0"><p class="text-sm font-bold truncate">${esc(setup.topicLabel)}</p><p class="text-[11px] text-white/45 truncate">${esc(sub)}</p></div><i class="fas fa-check text-blue-300 ml-auto"></i>`;
}
function renderSetupTopicList() {
    const list = document.getElementById('setupTopicList');
    const cards = [{ kind: 'free', t: { id: 'free', emoji: '📞', title_ko: '자유 대화', title: 'Free talk' } }]
        .concat((today?.daily || []).slice(0, 5).map((t) => ({ kind: 'topic', t })))
        .concat(today?.scenario_of_day ? [{ kind: 'scenario', t: today.scenario_of_day }] : [])
        .concat((today?.personal || []).slice(0, 3).map((t) => ({ kind: 'personal', t })));
    list.innerHTML = cards.map((c, i) => `<button type="button" data-i="${i}" class="opt-card text-left flex items-center gap-2"><span class="text-xl">${c.t.emoji}</span><span class="min-w-0"><span class="block text-xs font-bold truncate">${esc(c.t.title_ko || c.t.title)}</span><span class="block text-[10px] text-white/40 truncate">${c.kind === 'scenario' ? '롤플레이' : c.kind === 'personal' ? 'AI 추천' : esc(c.t.title || '')}</span></span></button>`).join('');
    list.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { const c = cards[+b.dataset.i]; setTopicChoice(c.kind, c.t); }));
}
// ---- 제공자/모델 선택 (변경 즉시 DB 저장) ----
let persistTimer = null, persistPatch = {};
function persist(patch) { Object.assign(persistPatch, patch); clearTimeout(persistTimer); persistTimer = setTimeout(async () => { const p = persistPatch; persistPatch = {}; try { await api('/api/settings', { method: 'POST', body: p }); } catch (e) { console.warn('persist', e); } }, 500); }
function estLabel(e) { return e ? `$${e.low.toFixed(2)}~${e.high.toFixed(2)}` : ''; }
function renderModelSection() {
    const prov = setup.provider, M = MODELS[prov] || STATIC_MODELS[prov];
    const est = MODELS.estimates || {};
    document.getElementById('providerCards').innerHTML = ['openai', 'gemini'].map((id) => {
        const info = PROVIDER_INFO[id], m = MODELS[id] || {}, e = id === 'openai' ? est.openai : est.gemini;
        return `<button type="button" data-id="${id}" class="opt-card text-left ${prov === id ? 'selected' : ''}">
            <div class="flex items-center justify-between"><p class="text-sm font-bold"><i class="fas ${info.icon} mr-1 ${id === 'openai' ? 'text-emerald-300' : 'text-blue-300'}"></i>${info.label}</p>${m.has_key ? '<span class="chip text-emerald-200 border-emerald-400/30 bg-emerald-500/10">키 있음</span>' : '<span class="chip text-amber-200 border-amber-400/30 bg-amber-500/10">키 없음</span>'}</div>
            <p class="text-[10px] text-white/45 mt-1">${info.desc}</p>
            <p class="text-[11px] mt-1.5 font-bold ${id === 'openai' ? 'text-emerald-200' : 'text-blue-200'}">${e ? `${estLabel(e)} / 10분` : ''}${id === 'openai' && est.openai_mini ? ` <span class="font-normal text-white/40">(mini ${estLabel(est.openai_mini)})</span>` : ''}</p>
            ${id === 'gemini' ? '<p class="text-[10px] text-white/40">AI Studio 무료 티어 내에서는 $0</p>' : ''}</button>`;
    }).join('');
    document.querySelectorAll('#providerCards button').forEach((b) => b.addEventListener('click', () => { setup.provider = b.dataset.id; persist({ provider: setup.provider }); renderModelSection(); }));

    const vmSel = document.getElementById('voiceModelSel'), vSel = document.getElementById('voiceSel'), tSel = document.getElementById('textModelSel');
    const curVM = prov === 'openai' ? setup.realtime_model : setup.gemini_live_model;
    const vms = (M.voice_models || []).slice();
    if (curVM && !vms.some((x) => x.id === curVM)) vms.push({ id: curVM, label: curVM, desc: '' });
    vmSel.innerHTML = vms.map((x) => `<option value="${esc(x.id)}" ${x.id === curVM ? 'selected' : ''}>${esc(x.label)}${x.estimate ? ' · ' + estLabel(x.estimate) : ''}</option>`).join('');
    const curV = prov === 'openai' ? setup.voice : setup.gemini_voice;
    vSel.innerHTML = (M.voices || []).map((v) => `<option value="${v.id}" ${v.id === curV ? 'selected' : ''}>${v.label} · ${esc(v.desc)}</option>`).join('');
    const curT = prov === 'openai' ? setup.chat_model : setup.gemini_chat_model;
    const tms = (M.text_models || []).slice();
    if (curT && !tms.some((x) => x.id === curT)) tms.push({ id: curT, label: curT });
    tSel.innerHTML = tms.map((x) => `<option value="${esc(x.id)}" ${x.id === curT ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
    vmSel.onchange = () => { if (prov === 'openai') { setup.realtime_model = vmSel.value; persist({ realtime_model: vmSel.value }); } else { setup.gemini_live_model = vmSel.value; persist({ gemini_live_model: vmSel.value }); } updateEstimate(); };
    vSel.onchange = () => { if (prov === 'openai') { setup.voice = vSel.value; persist({ voice: vSel.value }); } else { setup.gemini_voice = vSel.value; persist({ gemini_voice: vSel.value }); } };
    tSel.onchange = () => { if (prov === 'openai') { setup.chat_model = tSel.value; persist({ chat_model: tSel.value }); } else { setup.gemini_chat_model = tSel.value; persist({ gemini_chat_model: tSel.value }); } };
    updateEstimate();
    const p = personaOf(setup.persona); document.getElementById('dialLabel').textContent = `${p.name}에게 전화 걸기 (${PROVIDER_INFO[prov].label})`;
}
function updateEstimate() {
    const prov = setup.provider, M = MODELS[prov] || {}, est = MODELS.estimates || {};
    const curVM = prov === 'openai' ? setup.realtime_model : setup.gemini_live_model;
    const vm = (M.voice_models || []).find((x) => x.id === curVM);
    const e = (vm && vm.estimate) || (prov === 'openai' ? est.openai : est.gemini);
    const line = document.getElementById('estimateLine');
    line.innerHTML = e ? `<i class="fas fa-coins mr-1 text-amber-300"></i>이 설정으로 10분 통화 시 약 <b class="text-white/80">${estLabel(e)}</b> + 평가 리포트 $0.01 안팎 (공개 단가 기준 추정${e.note ? ' · ' + esc(e.note) : ''})` : '';
    if (!(M.has_key)) line.innerHTML += `<br><span class="text-amber-300"><i class="fas fa-triangle-exclamation mr-1"></i>${PROVIDER_INFO[prov].label} API Key가 없습니다. <a href="/settings#api" class="underline">설정에서 등록</a></span>`;
}
async function loadModels() {
    try { await swr('/api/models', (d) => { MODELS = { ...MODELS, ...d, openai: { ...MODELS.openai, ...d.openai }, gemini: { ...MODELS.gemini, ...d.gemini } }; renderModelSection(); }); }
    catch (e) { console.warn('models', e); }
}
function segInit(id, key) {
    const seg = document.getElementById(id);
    const sync = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === setup[key]));
    const dbKey = { level: 'level', correction: 'correction_mode', turn: 'turn_mode' }[key];
    seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { setup[key] = b.dataset.v; sync(); if (dbKey) persist({ [dbKey]: b.dataset.v }); }));
    sync();
}
async function initSetup() {
    renderSetupPersonas();
    segInit('segLevel', 'level'); segInit('segCorr', 'correction'); segInit('segTurn', 'turn');
    renderModelSection(); loadModels();
    if (setup.kind === 'custom' && setup.customTitle) setTopicChoice('custom', { id: 'custom', title: setup.customTitle, title_ko: setup.customTitle, emoji: '💬', description_ko: '직접 정한 주제' });
    else if (setup.kind === 'free') setTopicChoice('free', null);
    else setTopicChoice('free', null);
    try {
        // 캐시 먼저 → 새 데이터 (10 §4). 주소로 넘어온 주제 선택은 처음 한 번만 적용 (그 뒤 사용자가 바꾼 선택을 덮지 않게)
        let all = null, t = null, applied = false;
        const apply = () => {
            if (!all || !t) return;
            today = t;
            if (!applied) {
                applied = true;
                if (setup.kind === 'topic' && setup.topicId) { const f = all.topics.find((x) => x.id === setup.topicId); if (f) setTopicChoice('topic', f); }
                if (setup.kind === 'scenario' && setup.topicId) { const f = all.scenarios.find((x) => x.id === setup.topicId); if (f) setTopicChoice('scenario', f); }
                if (setup.kind === 'personal' && setup.topicId) { const f = (t.personal || []).find((x) => x.id === setup.topicId); if (f) setTopicChoice('personal', f); }
                if (!setup.topicId && setup.kind === 'topic' && t.daily?.length) setTopicChoice('topic', t.daily[0]);
            }
            renderSetupTopicList();
        };
        await Promise.all([swr('/api/topics/today', (d) => { t = d; apply(); }), swr('/api/topics/all', (d) => { all = d; apply(); })]);
    } catch (e) { console.error(e); }
    document.getElementById('setupCustomForm').addEventListener('submit', (e) => { e.preventDefault(); const v = document.getElementById('setupCustomInput').value.trim(); if (v) setTopicChoice('custom', { id: 'custom', title: v, title_ko: v, emoji: '💬', description_ko: '직접 정한 주제' }); });
    document.getElementById('dialBtn').addEventListener('click', dial);
    if (params.get('autodial') === '1') dial();
}

// ---------- 발신 ----------
async function dial() {
    haptic(10);   // 누른 그 순간 — await 뒤에 두면 iOS 에서 안 울린다
    const err = document.getElementById('setupError'); err.classList.add('hidden');
    const provHasKey = setup.provider === 'gemini' ? MODELS.gemini.has_key : MODELS.openai.has_key;
    if (!provHasKey) { err.textContent = `설정에서 ${PROVIDER_INFO[setup.provider].label} API Key를 먼저 등록해 주세요.`; err.classList.remove('hidden'); setTimeout(() => location.href = '/settings#api', 1200); return; }
    const btn = document.getElementById('dialBtn'); btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 연결 준비 중…';
    try {
        ensureAudioCtx();
        // 1) 마이크 (사용자 제스처 안에서)
        call.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (e) { err.textContent = '마이크 권한이 필요합니다. 브라우저 설정에서 마이크를 허용해 주세요.'; err.classList.remove('hidden'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-phone"></i> 전화 걸기'; return; }
    // 2) 통화 화면 + 발신음
    const p = personaOf(setup.persona);
    applyPersonaUi(p, setup.topicLabel);
    show('callScreen'); startRingback();
    setStatus('발신 중…'); document.getElementById('netLabel').textContent = '연결 중';
    document.getElementById('pttWrap').classList.toggle('hidden', setup.turn !== 'ptt'); document.getElementById('pttWrap').classList.toggle('flex', setup.turn === 'ptt');
    call.ptt = setup.turn === 'ptt';
    document.body.classList.toggle('ptt-mode', call.ptt);
    if (call.ptt) call.mic.getAudioTracks().forEach((t) => t.enabled = false);
    try {
        const body = { kind: setup.kind, topic_id: setup.topicId, custom_title: setup.customTitle, persona: setup.persona, level: setup.level, correction_mode: setup.correction, turn_mode: setup.turn,
            provider: setup.provider, realtime_model: setup.realtime_model, gemini_live_model: setup.gemini_live_model, voice: setup.voice, gemini_voice: setup.gemini_voice, chat_model: setup.chat_model, gemini_chat_model: setup.gemini_chat_model };
        const s = await api('/api/calls/start', { method: 'POST', body });
        call.id = s.call_id; call.provider = s.provider || 'openai'; call.model = s.model;
        applyPersonaUi({ ...p, ...s.persona }, s.topic?.title_ko || s.topic?.title);
        document.getElementById('netChip').title = `${PROVIDER_INFO[call.provider].label} · ${s.model}`;
        if (call.provider === 'gemini') await connectGemini(s); else await connectRealtime(s.client_secret, s.model);
    } catch (e) {
        stopRingback(); toast(e.message, false, 5000); cleanupMedia();
        show('setupScreen'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-phone"></i> 전화 걸기';
        err.textContent = e.message; err.classList.remove('hidden');
    }
}
function applyPersonaUi(p, topicLabel) {
    document.getElementById('avatarEl').textContent = p.emoji || '😊';
    document.getElementById('avatarEl').className = `avatar bg-gradient-to-br ${p.gradient || 'from-blue-500 to-purple-500'}`;
    document.getElementById('callName').textContent = p.name;
    document.getElementById('callTitle').textContent = `${p.title || ''}${p.accent ? ' · ' + p.accent : ''}`;
    document.getElementById('callTopicChip').innerHTML = `${setup.topicEmoji} ${esc(topicLabel || '자유 대화')}`;
    const key = Object.keys(gradColors).find((k) => (p.gradient || '').startsWith(k));
    const c = gradColors[key] || gradColors['from-blue-500'];
    document.getElementById('callBg').style.setProperty('--p1', c[0]); document.getElementById('callBg').style.setProperty('--p2', c[1]);
}
function setStatus(t) { document.getElementById('callStatus').textContent = t; }
function setNetDot(kind) { const d = document.getElementById('netDot'); if (d) d.className = 'status-dot ' + kind; }
// 휴대폰은 백그라운드에서 소켓이 끊긴다 → 돌아왔을 때 끊겨 있으면 다시 걸기 제안
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !call.connected || call.ended) return;
    const dead = (call.pc && ['failed', 'closed', 'disconnected'].includes(call.pc.connectionState)) || (call.ws && call.ws.readyState > 1);
    if (dead) { hangup('network'); toast('백그라운드에서 통화가 끊겼어요.', false, 6000, { label: '다시 걸기', onClick: () => location.reload() }); }
});

// ---------- WebRTC ----------
async function connectRealtime(secret, model) {
    const pc = new RTCPeerConnection();
    call.pc = pc;
    call.audioEl = new Audio(); call.audioEl.autoplay = true; call.audioEl.playsInline = true; call.audioEl.setAttribute('playsinline', '');
    pc.ontrack = (e) => { call.audioEl.srcObject = e.streams[0]; call.audioEl.play().catch(() => {}); setupAnalyser(e.streams[0], 'speakRing', 1.0, 0.18); };
    pc.addTrack(call.mic.getAudioTracks()[0], call.mic);
    setupAnalyser(call.mic, 'userRing', 1.0, 0.12);
    pc.onconnectionstatechange = () => {
        const st = pc.connectionState; document.getElementById('netLabel').textContent = { connected: '통화 중', connecting: '연결 중', disconnected: '끊김', failed: '실패', closed: '종료' }[st] || st;
        if ((st === 'failed' || st === 'disconnected') && !call.ended) { toast('연결이 불안정합니다.', false); if (st === 'failed') hangup('network'); }
    };
    const dc = pc.createDataChannel('oai-events'); call.dc = dc;
    dc.onmessage = (e) => { try { handleEvent(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    dc.onopen = () => onConnected();
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    const res = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`, { method: 'POST', body: offer.sdp, headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/sdp' } });
    if (!res.ok) { const t = await res.text(); throw new Error(`실시간 연결 실패 (${res.status}): ${t.slice(0, 200)}`); }
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
}
const P_OPENAI = {
    sendText(text) { send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }); send({ type: 'response.create' }); },
    pttStart() { send({ type: 'input_audio_buffer.clear' }); if (call.aiSpeaking) send({ type: 'response.cancel' }); },
    pttEnd() { send({ type: 'input_audio_buffer.commit' }); send({ type: 'response.create' }); },
    greet() { send({ type: 'response.create' }); },
    close() { try { call.dc && call.dc.close(); } catch (e) {} try { call.pc && call.pc.close(); } catch (e) {} },
};
function onConnected() {
    call.P = call.P || P_OPENAI;
    if (call.connected) return;
    call.connected = true; stopRingback(); vibrate([40, 60, 40]);
    document.getElementById('avatarWrap').classList.remove('ringing');
    call.startedAt = Date.now(); setNetDot('ok');
    call.timer = setInterval(() => setStatus(fmtDur((Date.now() - call.startedAt) / 1000)), 500);
    setStatus('0:00'); document.getElementById('netLabel').textContent = '통화 중';
    requestWakeLock();
    // 상대가 전화를 받는다 (첫 인사)
    call.P.greet();
    document.getElementById('captionHint').textContent = call.ptt ? '버튼을 누른 채 말하고, 놓으면 상대가 답합니다' : '말이 끝나면 상대가 자연스럽게 이어 말해요';
}
function send(obj) { if (call.dc && call.dc.readyState === 'open') call.dc.send(JSON.stringify(obj)); }

// ---------- Realtime 이벤트 ----------
function ensureItem(id, role) { if (!call.itemMap[id]) { call.itemMap[id] = { id, role, text: '', t: (Date.now() - (call.startedAt || Date.now())) / 1000 }; call.items.push(call.itemMap[id]); } return call.itemMap[id]; }
function handleEvent(ev) {
    const t = ev.type;
    if (t === 'conversation.item.added' || t === 'conversation.item.created') {
        const it = ev.item; if (it && (it.role === 'user' || it.role === 'assistant') && it.type === 'message') {
            const node = ensureItem(it.id, it.role);
            const txt = (it.content || []).map((c) => c.text || c.transcript || '').join('').trim(); if (txt && !node.text) { node.text = txt; if (it.role === 'user') showUserCaption(txt); }
        }
    } else if (t === 'conversation.item.input_audio_transcription.completed') {
        const node = ensureItem(ev.item_id, 'user'); node.text = (ev.transcript || '').trim(); showUserCaption(node.text); renderLog();
    } else if (t === 'conversation.item.input_audio_transcription.delta') {
        const node = ensureItem(ev.item_id, 'user'); node.partial = (node.partial || '') + (ev.delta || ''); showUserCaption(node.partial, true);
    } else if (t === 'response.output_audio_transcript.delta' || t === 'response.audio_transcript.delta') {
        const node = ensureItem(ev.item_id, 'assistant'); node.text += ev.delta || ''; showAiCaption(node.text);
    } else if (t === 'response.output_audio_transcript.done' || t === 'response.audio_transcript.done') {
        const node = ensureItem(ev.item_id, 'assistant'); node.text = ev.transcript || node.text; showAiCaption(node.text); renderLog();
    } else if (t === 'output_audio_buffer.started') { call.aiSpeaking = true; }
    else if (t === 'output_audio_buffer.stopped' || t === 'output_audio_buffer.cleared') { call.aiSpeaking = false; if (call.endRequested) finishByPartner(); }
    else if (t === 'input_audio_buffer.speech_started') { document.getElementById('captionUser').textContent = '…'; }
    else if (t === 'response.done') {
        const u = ev.response?.usage; if (u) accumulateUsage(u);
        (ev.response?.output || []).forEach((o) => { if (o.type === 'function_call' && o.name === 'end_call') requestEndByPartner(o.call_id); });
        if (ev.response?.status === 'failed') { const msg = ev.response?.status_details?.error?.message || '응답 실패'; toast(msg, false, 4000); }
    } else if (t === 'response.function_call_arguments.done') { if (ev.name === 'end_call') requestEndByPartner(ev.call_id); }
    else if (t === 'error') { console.error(ev); toast(ev.error?.message || '오류', false, 4000); }
}
function accumulateUsage(u) {
    const i = u.input_token_details || {}, o = u.output_token_details || {}, c = i.cached_tokens_details || {};
    call.usage.text_in += i.text_tokens || 0; call.usage.audio_in += i.audio_tokens || 0;
    call.usage.text_cached += c.text_tokens || 0; call.usage.audio_cached += c.audio_tokens || 0;
    call.usage.text_out += o.text_tokens || 0; call.usage.audio_out += o.audio_tokens || 0;
}
function requestEndByPartner(callId) {
    if (call.endRequested) return; call.endRequested = true;
    send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: JSON.stringify({ ok: true }) } });
    setTimeout(() => finishByPartner(), call.aiSpeaking ? 6000 : 1500);
}
let _finishedByPartner = false;
function finishByPartner() { if (_finishedByPartner || call.ended) return; _finishedByPartner = true; setTimeout(() => hangup('partner'), 600); }
function showAiCaption(text) { if (!call.captions) return; document.getElementById('captionAi').textContent = text; document.getElementById('captionHint').textContent = ''; }
function showUserCaption(text, partial = false) { if (!call.captions) return; const el = document.getElementById('captionUser'); el.textContent = text ? `“${text}”` : ''; el.style.opacity = partial ? .6 : 1; }
function renderLog() {
    const body = document.getElementById('logBody');
    body.innerHTML = call.items.filter((x) => x.text).map((x) => `<div class="bubble ${x.role === 'user' ? 'me' : 'ai'}">${esc(x.text)}</div>`).join('') || '<p class="text-xs text-white/40 text-center py-4">아직 대화가 없습니다.</p>';
    body.scrollTop = body.scrollHeight;
}


// =====================================================================================
//  Gemini Live (WebSocket + PCM16). 마이크 16kHz 업스트림, 24kHz 다운스트림을 AudioContext 로 재생.
// =====================================================================================
let gPlayGain = null, gNextTime = 0, gSources = [], gMicNode = null, gResPos = 0, gOut = [], gCurUser = null, gCurAi = null, gSeq = 0, gPttHolding = false;
const P_GEMINI = {
    sendText(text) { gsend({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } }); },
    pttStart() { gPttHolding = true; flushPlayback(); gsend({ realtimeInput: { activityStart: {} } }); },
    pttEnd() { gPttHolding = false; gsend({ realtimeInput: { activityEnd: {} } }); },
    greet() { gsend({ clientContent: { turns: [{ role: 'user', parts: [{ text: '(The phone connects. Answer the call now with your natural opening line, then wait for me.)' }] }], turnComplete: true } }); },
    close() { stopLiveCaptions(); try { call.ws && call.ws.close(); } catch (e) {} try { gMicNode && gMicNode.disconnect(); } catch (e) {} try { gLoop && gLoop.forEach((p) => p.close()); } catch (e) {} flushPlayback(); if (gLatencies.length) console.debug('[gemini] latencies(ms)', gLatencies.map(Math.round)); },
};
function gsend(obj) { if (call.ws && call.ws.readyState === 1) call.ws.send(JSON.stringify(obj)); }
// Gemini 는 내 말의 전사를 말이 끝난 뒤(응답과 함께) 보내므로, 브라우저 음성 인식으로 '말하는 중' 자막을 먼저 보여준다.
let liveRec = null, liveInterim = '';
function startLiveCaptions() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || /Android/i.test(navigator.userAgent) || !call.captions) return; // Android 크롬은 인식 시작음이 통화에 섞여 제외
    try {
        liveRec = new SR(); liveRec.lang = 'en-US'; liveRec.continuous = true; liveRec.interimResults = true;
        liveRec.onresult = (e) => { if (!micSending()) return; let txt = ''; for (let i = e.resultIndex; i < e.results.length; i++) txt += e.results[i][0].transcript; liveInterim = txt.trim(); if (liveInterim && !gCurUser) showUserCaption(liveInterim, true); };
        liveRec.onend = () => { if (!call.ended && liveRec) { try { liveRec.start(); } catch (e) {} } };
        liveRec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { liveRec = null; } };
        liveRec.start();
    } catch (e) { liveRec = null; }
}
function stopLiveCaptions() { if (liveRec) { const r = liveRec; liveRec = null; try { r.onend = null; r.stop(); } catch (e) {} } }
let gLoop = null; // AEC 루프백용 PeerConnection 쌍
async function setupAecPlayback(ctx) {
    // Chrome 은 Web Audio 로 직접 낸 소리를 에코 제거 참조로 잘 쓰지 못한다. WebRTC 트랙으로 돌려 <audio> 로 재생하면
    // OpenAI(WebRTC) 경로와 같은 방식으로 AEC 가 걸려, 스피커폰에서도 상대 목소리가 마이크로 되먹임되지 않는다.
    try {
        const dest = ctx.createMediaStreamDestination(); gPlayGain.connect(dest);
        const pc1 = new RTCPeerConnection(), pc2 = new RTCPeerConnection(); gLoop = [pc1, pc2];
        pc1.onicecandidate = (e) => e.candidate && pc2.addIceCandidate(e.candidate).catch(() => {});
        pc2.onicecandidate = (e) => e.candidate && pc1.addIceCandidate(e.candidate).catch(() => {});
        dest.stream.getTracks().forEach((t) => pc1.addTrack(t, dest.stream));
        const remote = new Promise((res) => { pc2.ontrack = (e) => res(e.streams[0]); });
        const offer = await pc1.createOffer(); await pc1.setLocalDescription(offer); await pc2.setRemoteDescription(offer);
        const answer = await pc2.createAnswer(); await pc2.setLocalDescription(answer); await pc1.setRemoteDescription(answer);
        const stream = await Promise.race([remote, new Promise((_, rej) => setTimeout(() => rej(new Error('loopback timeout')), 3000))]);
        call.audioEl = new Audio(); call.audioEl.autoplay = true; call.audioEl.playsInline = true; call.audioEl.setAttribute('playsinline', ''); call.audioEl.srcObject = stream;
        await call.audioEl.play().catch(() => {});
        console.debug('[gemini] AEC loopback playback ready');
    } catch (e) {
        console.warn('[gemini] loopback failed, falling back to direct output', e);
        try { gLoop && gLoop.forEach((p) => p.close()); } catch (e2) {}
        gLoop = null; gPlayGain.connect(ctx.destination);
    }
}
// 지연 측정: 내 말이 끝난 시점 → 상대 첫 오디오 도착
let gLastVoiceAt = 0, gSpeechEndAt = 0, gWaitingReply = false, gLatencies = [];
function noteMicLevel(lvl) { const now = performance.now(); if (lvl > 0.08) { gLastVoiceAt = now; gWaitingReply = true; gSpeechEndAt = 0; } else if (gWaitingReply && !gSpeechEndAt && gLastVoiceAt && now - gLastVoiceAt > 300) { gSpeechEndAt = gLastVoiceAt; } }
function noteReplyAudio() { if (gWaitingReply && gSpeechEndAt) { const ms = performance.now() - gSpeechEndAt; gLatencies.push(ms); gWaitingReply = false; const el = document.getElementById('netLabel'); if (el) el.textContent = `지연 ${(ms / 1000).toFixed(1)}s`; console.debug('[gemini] reply latency', Math.round(ms), 'ms; ws buffered', call.ws?.bufferedAmount); } }
async function connectGemini(s) {
    call.P = P_GEMINI;
    const ctx = ensureAudioCtx();
    gPlayGain = ctx.createGain();
    await setupAecPlayback(ctx);
    setupAnalyserNode(gPlayGain, 'speakRing', 1.0, 0.18);
    setupAnalyser(call.mic, 'userRing', 1.0, 0.12, noteMicLevel);
    try { await openGeminiSocket(s, s.ws_url); }
    catch (e) { if (s.ws_url_alt && /1008|unregistered|403|401/.test(String(e.message))) { console.warn('primary ws rejected, trying alt', e.message); await openGeminiSocket(s, s.ws_url_alt); } else throw e; }
}
function openGeminiSocket(s, url) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const ws = new WebSocket(url); call.ws = ws;
        const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('Gemini 연결 시간 초과')); } }, 15000);
        ws.onopen = () => { ws.send(JSON.stringify({ setup: s.setup })); };
        ws.onmessage = async (e) => {
            let txt = e.data; if (txt instanceof Blob) txt = await txt.text();
            let msg; try { msg = JSON.parse(txt); } catch (err) { return; }
            if (msg.setupComplete !== undefined) { if (!settled) { settled = true; clearTimeout(timer); resolve(); } startMicStreaming().catch((err) => toast('마이크 스트리밍 오류: ' + err.message, false)); onConnected(); startLiveCaptions();
                setInterval(() => { if (!call.ended && call.ws && call.ws.bufferedAmount > 20000) console.warn('[gemini] upstream backlog', call.ws.bufferedAmount, 'bytes'); }, 3000); return; }
            handleGemini(msg);
        };
        ws.onerror = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Gemini WebSocket 연결 실패 (키/모델/네트워크 확인)')); } };
        ws.onclose = (ev) => {
            if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`Gemini 연결이 거부되었습니다 (${ev.code}) ${ev.reason || ''}`)); return; }
            if (!call.ended) { document.getElementById('netLabel').textContent = '끊김'; if (call.endRequested) finishByPartner(); else { toast('상대와의 연결이 끊어졌습니다.', false); hangup('network'); } }
        };
    });
}
function handleGemini(msg) {
    if (msg.serverContent) {
        const sc = msg.serverContent;
        if (sc.inputTranscription && sc.inputTranscription.text) {
            if (gCurAi) { gCurAi = null; }
            if (!gCurUser) gCurUser = ensureItem('gu' + (++gSeq), 'user');
            gCurUser.text = (gCurUser.text + sc.inputTranscription.text).replace(/\s+/g, ' ');
            liveInterim = ''; showUserCaption(gCurUser.text.trim());
        }
        if (sc.outputTranscription && sc.outputTranscription.text) {
            if (gCurUser) { gCurUser = null; renderLog(); }
            if (!gCurAi) gCurAi = ensureItem('ga' + (++gSeq), 'assistant');
            gCurAi.text += sc.outputTranscription.text; showAiCaption(gCurAi.text);
        }
        if (sc.modelTurn && sc.modelTurn.parts) {
            for (const part of sc.modelTurn.parts) {
                if (part.inlineData && (part.inlineData.mimeType || '').startsWith('audio/pcm')) {
                    const m = /rate=(\d+)/.exec(part.inlineData.mimeType || ''); enqueuePcm(part.inlineData.data, m ? +m[1] : 24000);
                }
            }
        }
        if (sc.interrupted) { flushPlayback(); gCurAi = null; }
        if (sc.turnComplete) { gCurAi = null; renderLog(); if (call.endRequested) waitPlaybackThen(finishByPartner); }
    }
    if (msg.toolCall && msg.toolCall.functionCalls) {
        const responses = msg.toolCall.functionCalls.map((fc) => ({ id: fc.id, name: fc.name, response: { ok: true } }));
        gsend({ toolResponse: { functionResponses: responses } });
        if (msg.toolCall.functionCalls.some((fc) => fc.name === 'end_call')) { call.endRequested = true; setTimeout(() => waitPlaybackThen(finishByPartner), 1500); }
    }
    if (msg.usageMetadata) {
        const u = msg.usageMetadata;
        (u.promptTokensDetails || []).forEach((d) => { if (d.modality === 'AUDIO') call.usage.audio_in += d.tokenCount || 0; else call.usage.text_in += d.tokenCount || 0; });
        (u.responseTokensDetails || []).forEach((d) => { if (d.modality === 'AUDIO') call.usage.audio_out += d.tokenCount || 0; else call.usage.text_out += d.tokenCount || 0; });
        if (!u.promptTokensDetails && u.promptTokenCount) call.usage.audio_in += u.promptTokenCount;
        if (!u.responseTokensDetails && u.responseTokenCount) call.usage.audio_out += u.responseTokenCount;
    }
    if (msg.goAway) { toast('세션 시간이 곧 만료됩니다. 마무리 인사를 해보세요.', false, 5000); }
}
function enqueuePcm(b64, rate) {
    noteReplyAudio();
    const ctx = ensureAudioCtx(); const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const n = bytes.length >> 1; if (!n) return; const i16 = new Int16Array(bytes.buffer, 0, n); const f32 = new Float32Array(n); for (let i = 0; i < n; i++) f32[i] = i16[i] / 32768;
    const buf = ctx.createBuffer(1, n, rate); buf.copyToChannel(f32, 0);
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(gPlayGain);
    const t = Math.max(ctx.currentTime + 0.03, gNextTime); src.start(t); gNextTime = t + buf.duration; gSources.push(src);
    src.onended = () => { gSources = gSources.filter((x) => x !== src); call.aiSpeaking = gNextTime > ctx.currentTime + 0.05; };
    call.aiSpeaking = true;
}
function flushPlayback() { gSources.forEach((x) => { try { x.stop(); } catch (e) {} }); gSources = []; gNextTime = 0; call.aiSpeaking = false; }
function waitPlaybackThen(fn) { const ctx = actx; const left = ctx ? Math.max(0, gNextTime - ctx.currentTime) : 0; setTimeout(fn, left * 1000 + 400); }
function micSending() { return call.connected && !call.ended && !call.muted && !call.held && (!call.ptt || gPttHolding); }
async function startMicStreaming() {
    const ctx = ensureAudioCtx(); const src = ctx.createMediaStreamSource(call.mic); const sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination);
    const onFrame = (f32) => { if (!micSending()) { gCarry = null; gOut = []; return; } downsampleAndSend(f32, ctx.sampleRate); };
    if (ctx.audioWorklet) {
        const code = `class P extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true;}}registerProcessor('e2m-cap',P);`;
        const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
        await ctx.audioWorklet.addModule(url);
        gMicNode = new AudioWorkletNode(ctx, 'e2m-cap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
        gMicNode.port.onmessage = (e) => onFrame(e.data); src.connect(gMicNode); gMicNode.connect(sink);
    } else {
        gMicNode = ctx.createScriptProcessor(2048, 1, 1); gMicNode.onaudioprocess = (e) => onFrame(e.inputBuffer.getChannelData(0)); src.connect(gMicNode); gMicNode.connect(sink);
    }
}
let gCarry = null;
function downsampleAndSend(f32, inRate) {
    const ratio = inRate / 16000;
    let src = f32;
    if (gCarry && gCarry.length) { const merged = new Float32Array(gCarry.length + f32.length); merged.set(gCarry, 0); merged.set(f32, gCarry.length); src = merged; }
    let pos = 0;
    while (pos + ratio <= src.length) {
        const end = pos + ratio; let sum = 0, n = 0;
        for (let i = Math.floor(pos); i < Math.min(src.length, Math.ceil(end)); i++) { sum += src[i]; n++; }
        const v = n ? sum / n : 0;
        gOut.push(Math.max(-32768, Math.min(32767, Math.round(v * 32767))));
        pos = end;
    }
    gCarry = src.subarray(Math.floor(pos));
    if (gOut.length >= 960) { const chunk = new Int16Array(gOut.splice(0, gOut.length)); const bytes = new Uint8Array(chunk.buffer); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); gsend({ realtimeInput: { audio: { data: btoa(bin), mimeType: 'audio/pcm;rate=16000' } } }); }
}
function setupAnalyserNode(node, ringId, base, gain) {
    try { const ctx = ensureAudioCtx(); const an = ctx.createAnalyser(); an.fftSize = 512; node.connect(an); const data = new Uint8Array(an.frequencyBinCount); const ring = document.getElementById(ringId);
        const loop = () => { if (call.ended) return; an.getByteTimeDomainData(data); let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; } const lvl = Math.min(1, Math.sqrt(sum / data.length) * 6); ring.style.opacity = lvl > 0.06 ? String(0.35 + lvl * 0.65) : '0'; ring.style.transform = `scale(${(base + lvl * gain * 2).toFixed(3)})`; requestAnimationFrame(loop); }; loop();
    } catch (e) { console.warn('analyser', e); }
}

// ---------- 오디오 레벨 → 링 애니메이션 ----------
function setupAnalyser(stream, ringId, base, gain, onLevel) {
    try {
        const ctx = ensureAudioCtx(); const src = ctx.createMediaStreamSource(stream); const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
        const data = new Uint8Array(an.frequencyBinCount); const ring = document.getElementById(ringId);
        const loop = () => { if (call.ended) return; an.getByteTimeDomainData(data); let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; } const rms = Math.sqrt(sum / data.length); const lvl = Math.min(1, rms * 6); if (onLevel) onLevel(lvl); ring.style.opacity = lvl > 0.06 ? String(0.35 + lvl * 0.65) : '0'; ring.style.transform = `scale(${(base + lvl * gain * 2).toFixed(3)})`; requestAnimationFrame(loop); };
        loop();
    } catch (e) { console.warn('analyser', e); }
}
async function requestWakeLock() { try { if ('wakeLock' in navigator) { call.wakeLock = await navigator.wakeLock.request('screen'); document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && !call.ended) { try { call.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {} } }); } } catch (e) {} }

// ---------- 컨트롤 ----------
function toggleBtn(id, on) { document.getElementById(id).classList.toggle('on', on); }
document.getElementById('muteBtn').addEventListener('click', () => { call.muted = !call.muted; call.mic?.getAudioTracks().forEach((t) => t.enabled = !call.muted && !call.held && !call.ptt); toggleBtn('muteBtn', call.muted); document.querySelector('#muteBtn i').className = call.muted ? 'fas fa-microphone-slash' : 'fas fa-microphone'; toast(call.muted ? '음소거' : '음소거 해제'); });
document.getElementById('captionBtn').addEventListener('click', () => { call.captions = !call.captions; toggleBtn('captionBtn', !call.captions ? false : true); document.getElementById('captions').style.visibility = call.captions ? 'visible' : 'hidden'; });
toggleBtn('captionBtn', call.captions);
document.getElementById('holdBtn').addEventListener('click', () => { call.held = !call.held; call.mic?.getAudioTracks().forEach((t) => t.enabled = !call.held && !call.muted && !call.ptt); if (call.audioEl) call.audioEl.muted = call.held; if (gPlayGain) gPlayGain.gain.value = call.held ? 0 : 1; toggleBtn('holdBtn', call.held); toast(call.held ? '통화 보류 중 (상대는 들리지 않습니다)' : '통화 재개'); });
document.getElementById('slowerBtn').addEventListener('click', () => { sendText("Sorry, I didn't quite catch that. Could you say it again a little more slowly?", false); toast('다시 천천히 말해달라고 요청했어요'); });
document.getElementById('keyboardBtn').addEventListener('click', () => openSheet('keyboardSheet', () => document.getElementById('typeInput').focus()));
document.getElementById('logBtn').addEventListener('click', () => { renderLog(); openSheet('logSheet'); });
document.getElementById('hangupBtn').addEventListener('click', () => { haptic(20); hangup('user'); });
const typeInput = document.getElementById('typeInput'); const clearTypeDraft = bindDraft(typeInput, 'call-typed');
typeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && isComposing(e)) e.preventDefault(); });
document.getElementById('typeForm').addEventListener('submit', (e) => { e.preventDefault(); const v = typeInput.value.trim(); if (!v) return; haptic(10); sendText(v, true); typeInput.value = ''; clearTypeDraft(); closeSheets(); });
// 빠른 문구: 탭 = 입력창에 넣기, 길게 누름 = 바로 보내기 (버튼을 눌러도 키보드가 내려가지 않게 pointerdown 에서 preventDefault)
const QUICK = ['Could you say that again?', 'What does that mean?', 'Let me think for a second.', 'How do you say it in English?', 'Sorry, I meant…', "That's interesting!"];
const quickRow = document.getElementById('quickPhrases');
if (quickRow) {
    quickRow.innerHTML = QUICK.map((q) => `<button type="button" class="quick-chip chip px-3 py-2 text-[11px] whitespace-nowrap" data-q="${esc(q)}">${esc(q)}</button>`).join('');
    quickRow.addEventListener('pointerdown', (e) => { if (e.target.closest('.quick-chip')) e.preventDefault(); });
    quickRow.addEventListener('mousedown', (e) => { if (e.target.closest('.quick-chip')) e.preventDefault(); });
    quickRow.addEventListener('click', (e) => { const b = e.target.closest('.quick-chip'); if (!b) return; typeInput.value = b.dataset.q; typeInput.focus(); });
    window.AppUI.attachLongPress(quickRow, '.quick-chip', (b) => { sendText(b.dataset.q, true); closeSheets(); toast('보냈어요'); });
}
function sendText(text, record) {
    if (call.P) call.P.sendText(text);
    if (record) { const node = ensureItem('typed-' + Date.now(), 'user'); node.text = text; showUserCaption(text); renderLog(); }
}
document.getElementById('hintBtn').addEventListener('click', async () => {
    openSheet('hintSheet'); const body = document.getElementById('hintBody'); body.innerHTML = '<p class="text-white/50 text-center py-4"><i class="fas fa-spinner fa-spin mr-2"></i>상황에 맞는 표현을 찾는 중…</p>';
    try {
        const d = await api('/api/assist/hint', { method: 'POST', body: { transcript: call.items.filter((x) => x.text).slice(-8).map((x) => ({ role: x.role, text: x.text })) } });
        body.innerHTML = d.hints.map((h) => `<div class="glass-soft rounded-xl p-3"><p class="font-bold text-[15px] leading-snug">${esc(h.en)}</p><p class="text-xs text-white/55 mt-1">${esc(h.ko)}</p></div>`).join('') || '<p class="text-white/50">힌트를 만들지 못했어요.</p>';
    } catch (e) { body.innerHTML = `<p class="text-red-300 text-sm">${esc(e.message)}</p>`; }
});
document.getElementById('translateBtn').addEventListener('click', async () => {
    const last = [...call.items].reverse().find((x) => x.role === 'assistant' && x.text);
    openSheet('translateSheet'); const body = document.getElementById('translateBody');
    if (!last) { body.innerHTML = '<p class="text-white/50">아직 상대가 말한 문장이 없어요.</p>'; return; }
    body.innerHTML = `<p class="text-white/80 leading-snug">“${esc(last.text)}”</p><p class="text-white/50 text-center py-3"><i class="fas fa-spinner fa-spin mr-2"></i>번역 중…</p>`;
    try { const d = await api('/api/assist/translate', { method: 'POST', body: { text: last.text } }); body.innerHTML = `<p class="text-white/80 leading-snug">“${esc(last.text)}”</p><p class="font-bold text-[15px] mt-2">${esc(d.ko)}</p>${d.notes ? `<p class="text-xs text-amber-200/90 mt-1"><i class="fas fa-circle-info mr-1"></i>${esc(d.notes)}</p>` : ''}`; }
    catch (e) { body.innerHTML += `<p class="text-red-300 text-sm">${esc(e.message)}</p>`; }
});
// PTT
(function () {
    const btn = document.getElementById('pttBtn'); let holding = false;
    const down = (e) => { e.preventDefault(); if (holding || !call.connected) return; holding = true; btn.classList.add('holding'); haptic(15); call.mic?.getAudioTracks().forEach((t) => t.enabled = !call.muted); call.P && call.P.pttStart(); document.getElementById('pttLabel').textContent = '듣고 있어요… 놓으면 전송'; };
    const up = (e) => { e.preventDefault(); if (!holding) return; holding = false; btn.classList.remove('holding'); setTimeout(() => { call.mic?.getAudioTracks().forEach((t) => t.enabled = false); call.P && call.P.pttEnd(); }, 250); document.getElementById('pttLabel').textContent = '누르고 있는 동안 말하세요'; };
    btn.addEventListener('pointerdown', down); btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('pointerleave', (e) => { if (holding) up(e); });
    document.addEventListener('keydown', (e) => { if (e.code === 'Space' && call.ptt && !e.repeat && e.target.tagName !== 'INPUT') down(e); });
    document.addEventListener('keyup', (e) => { if (e.code === 'Space' && call.ptt && e.target.tagName !== 'INPUT') up(e); });
})();
// 시트
function openSheet(id, cb) { closeSheets(); document.getElementById(id).classList.add('open'); document.getElementById('sheetBackdrop').classList.add('open'); cb && setTimeout(cb, 250); }
function closeSheets() { document.querySelectorAll('.sheet').forEach((s) => s.classList.remove('open')); document.getElementById('sheetBackdrop').classList.remove('open'); }
document.getElementById('sheetBackdrop').addEventListener('click', closeSheets);
document.querySelectorAll('.sheet-close').forEach((b) => b.addEventListener('click', closeSheets));

// ---------- 종료 ----------
function cleanupMedia() {
    try { call.P && call.P.close(); } catch (e) {}
    try { call.dc && call.dc.close(); } catch (e) {}
    try { call.pc && call.pc.close(); } catch (e) {}
    try { call.mic && call.mic.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { if (call.audioEl) { call.audioEl.pause(); call.audioEl.srcObject = null; } } catch (e) {}
    try { call.wakeLock && call.wakeLock.release(); } catch (e) {}
    stopRingback();
}
function transcriptPayload() { return call.items.filter((x) => x.text && x.text.trim()).map((x) => ({ role: x.role, text: x.text.trim(), t: x.t })); }
async function hangup(reason) {
    if (call.ended) return; call.ended = true; clearInterval(call.timer);
    const dur = call.startedAt ? Math.round((Date.now() - call.startedAt) / 1000) : 0;
    closeSheets(); cleanupMedia(); hangupTone(); vibrate(60);
    setStatus(reason === 'partner' ? `${document.getElementById('callName').textContent}가 통화를 마쳤어요 · ${fmtDur(dur)}` : `통화 종료 · ${fmtDur(dur)}`);
    document.getElementById('netLabel').textContent = '종료';
    if (!call.id) { setTimeout(() => location.href = '/', 800); return; }
    const payload = { transcript: transcriptPayload(), duration_sec: dur, usage: call.usage, ended_by: reason };
    setTimeout(() => showReport(payload), 900);
}
window.addEventListener('pagehide', () => { if (call.id && !call.ended && call.startedAt) { const payload = { transcript: transcriptPayload(), duration_sec: Math.round((Date.now() - call.startedAt) / 1000), usage: call.usage, ended_by: 'pagehide' }; navigator.sendBeacon && navigator.sendBeacon(`/api/calls/${call.id}/finish`, new Blob([JSON.stringify(payload)], { type: 'application/json' })); } });
window.addEventListener('beforeunload', (e) => { if (call.connected && !call.ended) { e.preventDefault(); e.returnValue = ''; } });

// ---------- 리포트 ----------
async function showReport(payload) {
    show('reportScreen');
    document.getElementById('reportDetailLink').href = `/history/${call.id}`;
    const body = document.getElementById('reportBody');
    const p = personaOf(setup.persona);
    body.innerHTML = `
        <div class="glass-strong rounded-3xl p-5 text-center fade-in">
            <div class="w-16 h-16 mx-auto rounded-full bg-gradient-to-br ${p.gradient} flex items-center justify-center text-3xl mb-2 shadow-lg">${p.emoji}</div>
            <p class="text-sm text-white/60">${esc(p.name)}와의 통화</p>
            <p class="text-3xl font-extrabold tabular mt-1">${fmtDur(payload.duration_sec)}</p>
            <p class="text-xs text-white/45 mt-1">${setup.topicEmoji} ${esc(setup.topicLabel)}</p>
            <p class="text-[10px] text-white/35 mt-1"><i class="fas ${PROVIDER_INFO[call.provider]?.icon || 'fa-bolt'} mr-1"></i>${PROVIDER_INFO[call.provider]?.label || ''} · ${esc(call.model || '')}</p>
        </div>
        <div id="statRow" class="grid grid-cols-3 gap-2"></div>
        <div id="costBox" class="glass rounded-2xl p-4 flex items-center justify-between hidden"><div><p class="text-[10px] text-white/45"><i class="fas fa-coins mr-1 text-amber-300"></i>이 통화 비용 (추정)</p><p class="text-2xl font-extrabold tabular" id="costKrw">—</p></div><p class="text-xs text-white/45 text-right" id="costUsd"></p></div>
        <div id="evalBox" class="glass rounded-2xl p-5 text-center"><p class="text-white/60 text-sm"><i class="fas fa-spinner fa-spin mr-2"></i>통화 내용을 저장하고 있어요…</p></div>`;
    let fin;
    try { fin = await api(`/api/calls/${call.id}/finish`, { method: 'POST', body: payload }); }
    catch (e) { document.getElementById('evalBox').innerHTML = `<p class="text-red-300 text-sm">${esc(e.message)}</p>`; return; }
    const st = fin.stats || {};
    const showCost = (usd, krw, rate, note) => { const b = document.getElementById('costBox'); b.classList.remove('hidden'); document.getElementById('costKrw').textContent = fmtKrw(krw); document.getElementById('costUsd').innerHTML = `≈ $${(usd || 0).toFixed(4)}<br><span class="text-[10px] text-white/35">환율 ${Number(rate || 0).toLocaleString('ko-KR')}원/$ · ${note}</span>`; };
    showCost(fin.cost_usd, fin.cost_krw, fin.usd_krw, '통화만');
    document.getElementById('statRow').innerHTML = [['내가 말한 단어', st.user_words, '개'], ['내 발화 비중', st.talk_share, '%'], ['분당 단어', st.words_per_minute, 'wpm']].map(([l, v, u]) => `<div class="glass rounded-2xl p-3 text-center"><p class="text-[10px] text-white/45">${l}</p><p class="text-xl font-extrabold tabular">${v ?? 0}<span class="text-xs text-white/40 font-normal ml-0.5">${u}</span></p></div>`).join('');
    const box = document.getElementById('evalBox');
    if (!fin.can_evaluate) { box.innerHTML = `<i class="fas fa-face-smile text-3xl text-white/40 mb-2"></i><p class="text-sm text-white/70">이번엔 짧게 끝났네요. 평가는 두 마디 이상 이야기했을 때 만들어져요.</p>`; return; }
    box.innerHTML = `<p class="text-white/70 text-sm"><i class="fas fa-wand-magic-sparkles text-purple-300 mr-2"></i>말하기 평가 리포트를 만들고 있어요… (10~30초)</p><div class="score-track mt-3"><div class="score-fill bg-gradient-to-r from-blue-400 to-purple-400" style="width:30%;animation:grow 20s linear forwards"></div></div><style>@keyframes grow{to{width:95%}}</style>`;
    try {
        const evRes = await api(`/api/calls/${call.id}/evaluate`, { method: 'POST' }); const ev = evRes.evaluation;
        showCost(evRes.cost_usd, evRes.cost_krw, evRes.usd_krw, `통화 + 평가 리포트(${fmtKrw((ev.cost_usd || 0) * (evRes.usd_krw || 0))})`);
        box.outerHTML = renderEvaluation(ev, call.id) + `<p class="text-[10px] text-white/35 text-center">평가 모델 ${esc(ev.model || '')}</p>`;
        bindSaveButtons();
    } catch (e) { box.innerHTML = `<p class="text-red-300 text-sm">${esc(e.message)}</p><button type="button" class="btn-ghost px-4 py-2.5 rounded-xl text-xs mt-3 retry-eval">다시 시도</button>`; box.querySelector('.retry-eval').addEventListener('click', () => location.reload()); }
}
function renderEvaluation(ev, callId) {
    const S = ev.scores || {}; const labels = { fluency: '유창성', grammar: '문법', vocabulary: '어휘', coherence: '논리/구성', interaction: '상호작용' };
    return `
    <div class="glass-strong rounded-3xl p-5 fade-in">
        <div class="flex items-center gap-4">
            <div class="relative w-24 h-24 flex-shrink-0">
                <svg viewBox="0 0 100 100" class="w-full h-full -rotate-90"><circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="10"/><circle cx="50" cy="50" r="42" fill="none" stroke="${scoreColor(ev.overall)}" stroke-width="10" stroke-linecap="round" stroke-dasharray="264" stroke-dashoffset="${264 - 264 * ev.overall / 100}" style="transition:stroke-dashoffset 1s"/></svg>
                <div class="absolute inset-0 flex flex-col items-center justify-center"><span class="text-2xl font-extrabold tabular">${ev.overall}</span><span class="text-[10px] text-white/50">/100</span></div>
            </div>
            <div class="min-w-0"><p class="text-[10px] font-bold text-white/45 uppercase">종합 평가</p><p class="text-2xl font-extrabold">${esc(ev.cefr)} <span class="text-sm text-white/50 font-semibold">CEFR</span></p><p class="text-xs text-white/60 mt-1 leading-relaxed">${esc(ev.summary_ko)}</p></div>
        </div>
        <div class="mt-4 space-y-2">${Object.keys(labels).map((k) => `<div class="flex items-center gap-3 text-xs"><span class="w-16 text-white/60">${labels[k]}</span><div class="score-track flex-1"><div class="score-fill" style="width:${S[k] || 0}%;background:${scoreColor(S[k] || 0)}"></div></div><span class="w-7 text-right font-bold tabular">${S[k] ?? '-'}</span></div>`).join('')}</div>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="glass rounded-2xl p-4"><p class="text-xs font-bold text-emerald-300 mb-2"><i class="fas fa-thumbs-up mr-1"></i>잘한 점</p><ul class="text-xs text-white/75 space-y-1.5 list-disc list-inside">${(ev.strengths || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>
        <div class="glass rounded-2xl p-4"><p class="text-xs font-bold text-amber-300 mb-2"><i class="fas fa-bullseye mr-1"></i>보완할 점</p><ul class="text-xs text-white/75 space-y-1.5 list-disc list-inside">${(ev.improvements || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>
    </div>
    ${(ev.corrections || []).length ? `<div class="glass rounded-2xl p-4"><p class="text-xs font-bold text-red-300 mb-3"><i class="fas fa-pen mr-1"></i>이렇게 고쳐 말해요</p><div class="space-y-3">${ev.corrections.map((c) => `<div class="glass-soft rounded-xl p-3 text-sm"><p class="text-white/50 line-through decoration-red-400/60 text-[13px]">${esc(c.original)}</p><p class="font-bold text-emerald-200 mt-0.5">${esc(c.better)}</p><p class="text-[11px] text-white/50 mt-1">${esc(c.why_ko)}</p><button class="save-phrase hit mt-2 text-[11px] text-blue-300 hover:text-blue-200" data-phrase="${esc(c.better)}" data-meaning="${esc(c.why_ko)}" data-example="${esc(c.original)}" data-kind="correction"><i class="far fa-bookmark mr-1"></i>표현 노트에 저장</button></div>`).join('')}</div></div>` : ''}
    ${(ev.expressions || []).length ? `<div class="glass rounded-2xl p-4"><p class="text-xs font-bold text-blue-300 mb-3"><i class="fas fa-star mr-1"></i>가져갈 표현</p><div class="space-y-3">${ev.expressions.map((x) => `<div class="glass-soft rounded-xl p-3 text-sm"><div class="flex items-start justify-between gap-2"><p class="font-bold">${esc(x.phrase)}</p><button class="speak-btn hit text-white/50 hover:text-white flex-shrink-0" data-text="${esc(x.phrase)}" aria-label="듣기"><i class="fas fa-volume-high"></i></button></div><p class="text-xs text-white/60">${esc(x.meaning_ko)}</p><p class="text-[12px] text-white/50 italic mt-1">“${esc(x.example)}”</p><button class="save-phrase hit mt-2 text-[11px] text-blue-300 hover:text-blue-200" data-phrase="${esc(x.phrase)}" data-meaning="${esc(x.meaning_ko)}" data-example="${esc(x.example)}" data-kind="expression"><i class="far fa-bookmark mr-1"></i>표현 노트에 저장</button></div>`).join('')}</div></div>` : ''}
    ${(ev.filler_words || []).length ? `<div class="glass-soft rounded-2xl p-3 text-xs text-white/60"><i class="fas fa-comment-slash mr-1 text-white/40"></i>자주 쓴 군말: ${ev.filler_words.map((f) => `<span class="chip mx-0.5">${esc(f)}</span>`).join('')}</div>` : ''}
    <div class="glass rounded-2xl p-4"><p class="text-xs font-bold text-purple-300 mb-2"><i class="fas fa-flag-checkered mr-1"></i>다음 통화 목표</p><ul class="text-xs text-white/75 space-y-1.5 list-disc list-inside">${(ev.next_goals || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>`;
}
function bindSaveButtons(root = document) {
    root.querySelectorAll('.save-phrase').forEach((b) => b.addEventListener('click', async () => {
        try { const d = await api('/api/phrases', { method: 'POST', body: { phrase: b.dataset.phrase, meaning_ko: b.dataset.meaning, example: b.dataset.example, kind: b.dataset.kind, source_call_id: call.id } }); b.innerHTML = '<i class="fas fa-bookmark mr-1"></i>저장됨'; b.classList.add('text-emerald-300'); b.disabled = true; toast(d.status === 'exists' ? '이미 노트에 있어요' : '표현 노트에 저장했어요'); }
        catch (e) { toast(e.message, false); }
    }, { once: true }));
    root.querySelectorAll('.speak-btn').forEach((b) => b.addEventListener('click', async () => {
        b.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        try { const res = await fetch('/api/assist/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: b.dataset.text }) }); if (!res.ok) throw new Error((await res.json()).detail); const a = new Audio(URL.createObjectURL(await res.blob())); a.play(); }
        catch (e) { toast(e.message || '재생 실패', false); } finally { b.innerHTML = '<i class="fas fa-volume-high"></i>'; }
    }));
}
document.getElementById('againBtn').addEventListener('click', () => { const u = new URL(location.href); u.searchParams.set('autodial', '0'); location.href = u.pathname + u.search; });

initSetup();
