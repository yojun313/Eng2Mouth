// 앱 셸 공통 동작: 사이드바(모바일 열고 닫기 · 데스크톱 접기) · 로그아웃(POST) · 누적 사용 · 탭 배지 · API Key 안내 · 서비스 워커
(function () {
  'use strict';
  const { api, toast } = window.AppUI;
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const menuBtn = document.getElementById('menuBtn');
  const md = matchMedia('(min-width: 768px)');

  function setSidebarOpen(open) {
    sidebar.classList.toggle('-translate-x-full', !open);
    overlay.classList.toggle('hidden', !open);
    menuBtn?.setAttribute('aria-expanded', String(open));
  }
  try { if (localStorage.getItem('sidebar') === 'true') document.body.classList.add('sidebar-collapsed'); } catch (e) {}
  menuBtn?.addEventListener('click', () => {
    if (md.matches) { const c = document.body.classList.toggle('sidebar-collapsed'); try { localStorage.setItem('sidebar', String(c)); } catch (e) {} }
    else setSidebarOpen(true);
  });
  document.getElementById('closeSidebarBtn')?.addEventListener('click', () => setSidebarOpen(false));
  overlay?.addEventListener('click', () => setSidebarOpen(false));

  // 로그아웃은 POST 로만 (GET 로그아웃은 CSRF 로 강제 로그아웃 가능)
  document.querySelectorAll('[data-action="logout"]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) {}
    location.href = '/login';
  }));

  api('/api/settings/usage').then((d) => {
    const el = document.getElementById('sidebarUsage');
    if (el) el.innerHTML = `$${(d.total_spent_usd || 0).toFixed(3)} <span class="opacity-70">· ${window.fmtKrw(d.total_spent_krw)}</span>`;
  }).catch(() => {});

  // 탭 배지: 아직 평가하지 않은 통화 수
  api('/api/stats/badge').then((d) => {
    const n = d.unevaluated || 0;
    document.querySelectorAll('[data-badge="history"]').forEach((b) => { b.textContent = n > 99 ? '99+' : String(n); b.classList.toggle('hidden', !n); });
  }).catch(() => {});

  // API Key 안내
  const notice = document.getElementById('apiKeyNotice');
  if (notice) {
    let later = false; try { later = sessionStorage.getItem('apiKeyNoticeLater') === '1'; } catch (e) {}
    if (!later) { notice.classList.remove('hidden'); notice.classList.add('flex'); }
    notice.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-action]'); if (!b) return;
      notice.classList.add('hidden'); notice.classList.remove('flex');
      if (b.dataset.action === 'notice-forever') { try { await api('/api/settings', { method: 'POST', body: { hide_api_key_notice: true } }); } catch (err) {} }
      else { try { sessionStorage.setItem('apiKeyNoticeLater', '1'); } catch (err) {} }
    });
  }

  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  // 앱으로 돌아왔을 때 배지 · 사용량 갱신
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') api('/api/stats/badge').then((d) => { const n = d.unevaluated || 0; document.querySelectorAll('[data-badge="history"]').forEach((b) => { b.textContent = n > 99 ? '99+' : String(n); b.classList.toggle('hidden', !n); }); }).catch(() => {}); });
})();
