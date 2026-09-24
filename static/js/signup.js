(function () {
  'use strict';
  const { toast } = window.AppUI;
  const form = document.getElementById('signupForm'), sendBtn = document.getElementById('sendBtn'), verifySection = document.getElementById('verifySection'), verifyBtn = document.getElementById('verifyBtn'), err = document.getElementById('signupError');
  const showErr = (m) => { err.textContent = m; err.classList.remove('hidden'); };
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.classList.add('hidden'); sendBtn.disabled = true; const orig = sendBtn.textContent; sendBtn.textContent = '처리 중...';
    try {
      const res = await fetch('/api/auth/signup/request', { method: 'POST', body: new FormData(form) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showErr(data.detail || '가입 실패'); sendBtn.disabled = false; sendBtn.textContent = orig; return; }
      if (data.verify) { form.classList.add('opacity-50', 'pointer-events-none'); verifySection.classList.remove('hidden'); toast('인증 메일을 보냈어요'); }
      else { toast('가입 완료! 로그인해 주세요'); setTimeout(() => location.href = '/login', 800); }
    } catch (e2) { showErr('네트워크 오류'); sendBtn.disabled = false; sendBtn.textContent = orig; }
  });
  verifyBtn.addEventListener('click', async () => {
    const code = document.getElementById('verifyCode').value.trim(), email = document.getElementById('inputEmail').value.trim();
    verifyBtn.disabled = true; verifyBtn.textContent = '확인 중...';
    try {
      const res = await fetch('/api/auth/signup/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { toast('가입 완료! 로그인해 주세요'); setTimeout(() => location.href = '/login', 800); } else showErr(data.detail || '인증 실패');
    } catch (e2) { showErr('네트워크 오류'); }
    finally { verifyBtn.disabled = false; verifyBtn.textContent = '확인 및 가입 완료'; }
  });
})();
