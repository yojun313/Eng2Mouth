(function () {
  'use strict';
  const { api, toast, esc, fmtKrw, fmtDate, pageData, formSheet, confirmSheet, openSheet, closeSheet, actionSheet } = window.AppUI;
  const D = pageData(); const S = D.settings || {}; const PERSONAS = D.personas || [];
  const state = { persona: S.persona, voice: S.voice, gemini_voice: S.gemini_voice, provider: S.provider || 'openai', level: S.level, correction_mode: S.correction_mode, turn_mode: S.turn_mode, realtime_model: S.realtime_model };
  let saveTimer = null;
  async function save(patch, delay = 0) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => { try { await api('/api/settings', { method: 'POST', body: patch }); const el = document.getElementById('saveState'); if (el) el.innerHTML = `<i class="fas fa-circle-check text-emerald-400 mr-1"></i>저장됨 ${new Date().toLocaleTimeString('ko-KR')}`; toast('저장됨', true, 1200); } catch (e) { toast('저장 실패: ' + e.message, false); } }, delay);
  }
  function mark(cls, val) { document.querySelectorAll('.' + cls).forEach((b) => { const on = b.dataset.v === String(val); b.classList.toggle('border-blue-400/70', on); b.classList.toggle('bg-blue-500/15', on); b.classList.toggle('border-transparent', !on); }); }
  function bindOpts(cls, key) { document.querySelectorAll('.' + cls).forEach((b) => b.addEventListener('click', () => { state[key] = b.dataset.v; mark(cls, b.dataset.v); save({ [key]: b.dataset.v }); })); mark(cls, state[key]); }
  bindOpts('voice-opt', 'voice'); bindOpts('gvoice-opt', 'gemini_voice'); bindOpts('prov-opt', 'provider'); bindOpts('level-opt', 'level'); bindOpts('corr-opt', 'correction_mode'); bindOpts('turn-opt', 'turn_mode'); bindOpts('rt-opt', 'realtime_model');

  function renderPersonas() {
    document.getElementById('personaGrid').innerHTML = PERSONAS.map((p) => `<button type="button" data-id="${p.id}" class="persona-card glass-soft rounded-xl p-3 text-left border ${p.id === state.persona ? 'selected' : 'border-transparent'}"><div class="flex items-center gap-2"><div class="w-9 h-9 rounded-lg bg-gradient-to-br ${p.gradient} flex items-center justify-center text-lg flex-shrink-0">${p.emoji}</div><div class="min-w-0"><p class="text-sm font-bold truncate">${esc(p.name)}</p><p class="text-[10px] text-white/45 truncate">${esc(p.title)}</p></div></div><p class="text-[10px] text-white/45 mt-2 leading-tight line-clamp-2">${esc(p.tagline)}</p></button>`).join('');
    document.querySelectorAll('#personaGrid .persona-card').forEach((b) => b.addEventListener('click', () => { state.persona = b.dataset.id; renderPersonas(); save({ persona: b.dataset.id }); }));
    document.getElementById('customPersonaBox').classList.toggle('hidden', state.persona !== 'custom');
  }
  renderPersonas();
  ['customName', 'customDesc'].forEach((id) => document.getElementById(id).addEventListener('input', () => save({ custom_persona: { name: document.getElementById('customName').value, description: document.getElementById('customDesc').value } }, 900)));

  // ---- API keys ----
  const keyInput = document.getElementById('apiKeyInput');
  keyInput.addEventListener('input', () => { const v = keyInput.value.trim(); if (v.length < 20) return; save({ openai_api_key: v }, 800); document.getElementById('keyStatus').innerHTML = '<span class="text-white/50">저장 중… 저장 후 "키 확인"으로 검증해 보세요.</span>'; });
  document.getElementById('verifyKeyBtn').addEventListener('click', async (e) => { const b = e.currentTarget; b.disabled = true; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; const st = document.getElementById('keyStatus'); try { clearTimeout(saveTimer); if (keyInput.value.trim().length >= 20) await api('/api/settings', { method: 'POST', body: { openai_api_key: keyInput.value.trim() } }); const r = await api('/api/settings/verify-key?provider=openai', { method: 'POST' }); st.innerHTML = `<span class="text-emerald-300"><i class="fas fa-circle-check mr-1"></i>유효한 키</span> <span class="text-white/50">realtime ${r.realtime ? '✅' : '⚠️'} · mini ${r.realtime_mini ? '✅' : '⚠️'} · 평가 모델 ${r.chat ? '✅' : '⚠️'}</span>`; } catch (err) { st.innerHTML = `<span class="text-red-300"><i class="fas fa-circle-xmark mr-1"></i>${esc(err.message)}</span>`; } finally { b.disabled = false; b.textContent = '키 확인'; } });
  const gInput = document.getElementById('geminiKeyInput');
  gInput.addEventListener('input', () => { const v = gInput.value.trim(); if (v.length < 20) return; save({ gemini_api_key: v }, 800); document.getElementById('geminiKeyStatus').innerHTML = '<span class="text-white/50">저장 중… 저장 후 "키 확인"으로 검증해 보세요.</span>'; });
  async function fillGeminiModels() {
    try { const d = await api('/api/models'); const sel = document.getElementById('geminiLiveSel'); const cur = S.gemini_live_model || ''; sel.innerHTML = (d.gemini.voice_models || []).map((m) => `<option value="${esc(m.id)}" ${m.id === cur ? 'selected' : ''}>${esc(m.label)}</option>`).join(''); if (cur && !(d.gemini.voice_models || []).some((m) => m.id === cur)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(cur)}" selected>${esc(cur)}</option>`); const tsel = document.getElementById('geminiChatSel'); (d.gemini.text_models || []).forEach((m) => { if (![...tsel.options].some((o) => o.value === m.id)) tsel.insertAdjacentHTML('beforeend', `<option value="${esc(m.id)}">${esc(m.label)}</option>`); }); tsel.value = S.gemini_chat_model || tsel.value; } catch (e) { console.warn(e); }
  }
  document.getElementById('verifyGeminiBtn').addEventListener('click', async (e) => { const b = e.currentTarget; b.disabled = true; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; const st = document.getElementById('geminiKeyStatus'); try { clearTimeout(saveTimer); if (gInput.value.trim().length >= 20) await api('/api/settings', { method: 'POST', body: { gemini_api_key: gInput.value.trim() } }); const r = await api('/api/settings/verify-key?provider=gemini', { method: 'POST' }); st.innerHTML = `<span class="text-emerald-300"><i class="fas fa-circle-check mr-1"></i>유효한 키</span> <span class="text-white/50">Live ${r.live_model ? '✅ ' + esc(r.live_model) : '⚠️ 없음'} · 평가 ${r.chat ? '✅' : '⚠️'} · TTS ${r.tts ? '✅' : '⚠️'}</span>`; fillGeminiModels(); } catch (err) { st.innerHTML = `<span class="text-red-300"><i class="fas fa-circle-xmark mr-1"></i>${esc(err.message)}</span>`; } finally { b.disabled = false; b.textContent = '키 확인'; } });
  document.getElementById('geminiLiveSel').addEventListener('change', (e) => save({ gemini_live_model: e.target.value }));
  const gcs = document.getElementById('geminiChatSel'); gcs.value = S.gemini_chat_model || gcs.value; gcs.addEventListener('change', (e) => save({ gemini_chat_model: e.target.value }));
  if (S.has_gemini_key) fillGeminiModels();

  // ---- 슬라이더 / 체크박스 / 셀렉트 ----
  const speed = document.getElementById('speedRange'); const sv = () => document.getElementById('speedVal').textContent = Number(speed.value).toFixed(2).replace(/0$/, '') + 'x'; sv(); speed.addEventListener('input', sv); speed.addEventListener('change', () => save({ speed: Number(speed.value) }));
  const goal = document.getElementById('goalRange'); goal.addEventListener('input', () => document.getElementById('goalVal').textContent = goal.value); goal.addEventListener('change', () => save({ daily_goal_min: Number(goal.value) }));
  document.getElementById('captionsChk').addEventListener('change', (e) => save({ captions: e.target.checked }));
  document.getElementById('koreanChk').addEventListener('change', (e) => save({ allow_korean: e.target.checked }));
  const cm = document.getElementById('chatModelSel'); cm.value = S.chat_model; cm.addEventListener('change', () => save({ chat_model: cm.value }));

  // ---- 프로필 사진: 선택 · 드래그앤드롭 · 붙여넣기, XHR 진행률 ----
  const drop = document.getElementById('avatarDrop');
  function uploadAvatar(file) {
    if (!file || !file.type.startsWith('image/')) { toast('이미지 파일만 올릴 수 있어요', false); return; }
    if (file.size > 5 * 1024 * 1024) { toast('5MB 이하 이미지만 가능해요', false); return; }
    const preview = document.getElementById('profilePreview'); const old = preview.src; preview.src = URL.createObjectURL(file); preview.style.opacity = '.5';
    const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/user/profile-image');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) preview.style.opacity = String(0.5 + 0.5 * e.loaded / e.total); };
    xhr.onload = () => { preview.style.opacity = '1'; URL.revokeObjectURL(preview.src); try { const d = JSON.parse(xhr.responseText); if (xhr.status >= 400) throw new Error(d.detail); ['profilePreview', 'sidebarAvatar', 'headerAvatar'].forEach((id) => { const el = document.getElementById(id); if (el) el.src = d.url; }); toast('프로필 사진을 변경했어요'); } catch (e) { preview.src = old; toast(e.message || '업로드 실패', false); } };
    xhr.onerror = () => { preview.style.opacity = '1'; preview.src = old; toast('업로드 실패', false); };
    xhr.send(file);
  }
  document.getElementById('profileInput').addEventListener('change', (e) => uploadAvatar(e.target.files[0]));
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; drop.classList.add('drop-active'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('drop-active')));
  drop.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); uploadAvatar(e.dataTransfer.files[0]); });
  addEventListener('blur', () => drop.classList.remove('drop-active'));
  document.addEventListener('paste', (e) => { if (e.target.closest('input, textarea')) return; const f = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).find((x) => x && x.type.startsWith('image/')); if (f) { e.preventDefault(); uploadAvatar(f); } });

  // ---- 비밀번호 변경 (시트) ----
  document.getElementById('pwBtn').addEventListener('click', () => formSheet({ title: '비밀번호 변경', fields: [{ name: 'current_password', label: '현재 비밀번호', type: 'password', autocomplete: 'current-password', required: true }, { name: 'new_password', label: '새 비밀번호 (6자 이상)', type: 'password', autocomplete: 'new-password', required: true }], submitLabel: '변경', onSubmit: async (d) => { await api('/api/settings/password', { method: 'POST', body: d }); toast('비밀번호를 변경했어요. 다른 기기는 로그아웃됩니다.'); loadSecurity(); } }));

  // ---- 2단계 인증 ----
  async function loadSecurity() {
    try {
      const s = await api('/api/security/status');
      document.getElementById('totpState').innerHTML = s.enabled ? '<i class="fas fa-circle-check text-emerald-300 mr-1"></i>켜짐' : '<i class="fas fa-circle text-white/30 mr-1"></i>꺼짐';
      document.getElementById('totpBtn').textContent = s.enabled ? '끄기' : '켜기';
      document.getElementById('totpBtn').onclick = () => s.enabled ? disableTotp() : beginTotp();
      document.getElementById('sessionList').innerHTML = (s.sessions || []).map((x) => `<div class="glass-soft rounded-lg px-3 py-2 flex items-center gap-2 row-cell min-h-0"><span class="status-dot ${x.current ? 'ok' : ''}" style="${x.current ? '' : 'background:rgba(148,163,184,.4)'}"></span><span class="min-w-0 flex-1 truncate">${esc(uaLabel(x.ua))} · ${esc(x.ip || '')}</span><span class="text-[10px] text-white/40 whitespace-nowrap">${x.current ? '이 기기' : fmtDate(x.last_seen)}</span></div>`).join('') || '<p class="text-white/40">세션 없음</p>';
    } catch (e) { console.warn(e); }
  }
  function uaLabel(ua = '') { const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '기기'; const br = /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : /Firefox/.test(ua) ? 'Firefox' : ''; return `${os} ${br}`.trim(); }
  function beginTotp() {
    formSheet({ title: '2단계 인증 켜기', subtitle: '본인 확인을 위해 비밀번호를 입력하세요', fields: [{ name: 'password', label: '비밀번호', type: 'password', autocomplete: 'current-password', required: true }], submitLabel: '다음', onSubmit: async (d) => { const r = await api('/api/security/totp/begin', { method: 'POST', body: d }); setTimeout(() => showTotpQr(r), 250); } });
  }
  function showTotpQr(r) {
    let qrSvg = '';
    try { const q = window.qrcode(0, 'M'); q.addData(r.uri); q.make(); qrSvg = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) { qrSvg = ''; }
    formSheet({ title: '인증 앱에 등록', subtitle: 'QR 을 스캔하거나 아래 키를 직접 입력한 뒤, 앱에 뜬 6자리 코드를 넣어 주세요',
      fields: [{ name: 'code', label: '6자리 코드', inputmode: 'numeric', placeholder: '123456', maxlength: 6, required: true }],
      extraHtml: `<div class="flex flex-col items-center gap-2 py-2"><div class="bg-white p-2 rounded-xl w-44 h-44 [&>svg]:w-full [&>svg]:h-full">${qrSvg}</div><p class="text-[11px] opacity-60">키 (직접 입력용)</p><code class="text-xs font-mono select-text break-all text-center">${esc(r.secret)}</code></div>`,
      submitLabel: '켜기', onSubmit: async (d) => { await api('/api/security/totp/enable', { method: 'POST', body: { code: d.code } }); toast('2단계 인증을 켰어요. 다음 로그인부터 코드를 확인합니다.'); loadSecurity(); } });
  }
  function disableTotp() {
    formSheet({ title: '2단계 인증 끄기', subtitle: '비밀번호를 입력하면 꺼집니다', danger: true, fields: [{ name: 'password', label: '비밀번호', type: 'password', autocomplete: 'current-password', required: true }], submitLabel: '끄기', onSubmit: async (d) => { await api('/api/security/totp/disable', { method: 'POST', body: d }); toast('2단계 인증을 껐어요'); loadSecurity(); } });
  }
  document.getElementById('logoutAllBtn').addEventListener('click', async () => { if (await confirmSheet({ title: '다른 기기 모두 로그아웃', message: '이 기기를 제외한 모든 로그인 세션이 종료됩니다.', confirmLabel: '로그아웃', danger: true })) { const r = await api('/api/auth/logout-all', { method: 'POST' }); toast(`${r.removed}개 세션을 종료했어요`); loadSecurity(); } });
  loadSecurity();

  // ---- 계정 삭제 ----
  document.getElementById('deleteAccountBtn').addEventListener('click', () => formSheet({ title: '계정 삭제', subtitle: '모든 통화 기록과 표현이 삭제되며 되돌릴 수 없습니다.', danger: true, fields: [{ name: 'password', label: '확인을 위해 비밀번호 입력', type: 'password', autocomplete: 'current-password', required: true }], submitLabel: '영구 삭제', onSubmit: async (d) => { const fd = new FormData(); fd.append('password', d.password); await api('/api/user/account', { method: 'DELETE', body: fd }); location.href = '/login'; } }));

  // ---- PWA 설치 ----
  let deferredPrompt = null; addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; document.getElementById('installBtn').classList.remove('hidden'); });
  document.getElementById('installBtn').addEventListener('click', async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; document.getElementById('installBtn').classList.add('hidden'); });
  api('/api/settings/usage').then((d) => { document.getElementById('totalUsageText').textContent = `$${(d.total_spent_usd || 0).toFixed(4)}`; document.getElementById('totalUsageKrw').textContent = `약 ${fmtKrw(d.total_spent_krw)} (환율 ${Number(d.usd_krw).toLocaleString('ko-KR')}원/$, ${d.source === 'fallback' ? '고정값' : '일 1회 갱신'})`; }).catch(() => {});
  if (location.hash) setTimeout(() => document.querySelector(location.hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
})();
