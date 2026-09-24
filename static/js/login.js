(function () {
  'use strict';
  const form = document.getElementById('loginForm'), btn = document.getElementById('loginBtn'), err = document.getElementById('loginError'), totpRow = document.getElementById('totpRow');
  const showErr = (m) => { err.textContent = m; err.classList.remove('hidden'); };
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); btn.disabled = true; btn.textContent = '로그인 중...'; err.classList.add('hidden');
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', body: new FormData(form) });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.totp_required) { totpRow.classList.remove('hidden'); form.code.focus(); showErr('2단계 인증이 켜져 있습니다. 인증 앱의 코드를 입력하세요.'); err.className = 'text-xs text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2'; return; }
      if (res.ok) { location.href = '/'; return; }
      showErr(data.detail || '로그인 실패');
    } catch (e2) { showErr('네트워크 오류가 발생했습니다.'); }
    finally { btn.disabled = false; btn.textContent = '로그인'; }
  });
})();
