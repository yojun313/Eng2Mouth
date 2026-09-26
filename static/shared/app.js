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
    try { window.AppUI.swrClear(); } catch (e) {}   // 캐시된 화면 데이터도 지운다
    location.href = '/login';
  }));

  window.AppUI.swr('/api/settings/usage', (d) => {
    const el = document.getElementById('sidebarUsage');
    if (el) el.innerHTML = `$${(d.total_spent_usd || 0).toFixed(3)} <span class="opacity-70">· ${window.fmtKrw(d.total_spent_krw)}</span>`;
  }).catch(() => {});

  // 탭 배지: 아직 평가하지 않은 통화 수
  window.AppUI.swr('/api/stats/badge', (d) => {
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

  // 예전 서비스 워커가 남아 있으면 해제 (정적 파일은 immutable HTTP 캐시로 처리)
  if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.update().catch(() => {}))).catch(() => {});
  // 앱으로 돌아왔을 때 배지 · 사용량 갱신
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') api('/api/stats/badge').then((d) => { const n = d.unevaluated || 0; document.querySelectorAll('[data-badge="history"]').forEach((b) => { b.textContent = n > 99 ? '99+' : String(n); b.classList.toggle('hidden', !n); }); }).catch(() => {}); });

  // ── 탭바는 손가락이 닿는 순간 이동 (10 §2). iOS 탭바는 touch down 에 바뀐다 ──
  // 스크롤되는 목록 안 링크에는 쓰지 않는다. 사이드바 서랍은 마우스일 때만 (터치는 스크롤과 헷갈림).
  let navTo = '';
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest?.('.tabbar a.tab-item, a.nav-link');
    if (!link || link.getAttribute('aria-current') === 'page' || link.target) return;
    if (e.pointerType !== 'mouse' && !link.closest('.tabbar')) return;
    document.querySelectorAll('.tabbar a.tab-item.active').forEach((a) => a.classList.remove('active'));
    if (link.classList.contains('tab-item')) link.classList.add('active');   // 선택 표시도 즉시
    navTo = link.href;
    location.href = link.href;
  }, { capture: true });
  document.addEventListener('click', (e) => {            // 뒤따라오는 click 으로 두 번 이동하지 않게
    const a = e.target.closest?.('a[href]');
    if (a && navTo && a.href === navTo) e.preventDefault();
  }, true);
  addEventListener('pageshow', () => {                   // 뒤로 가기로 돌아왔을 때 탭 표시 되돌리기
    navTo = '';
    document.querySelectorAll('.tabbar a.tab-item').forEach((a) => a.classList.toggle('active', a.getAttribute('aria-current') === 'page'));
  });

  // ── 통화 상세 링크는 누르는 순간 / 마우스를 올리면 미리 받기 (10 §5) ──
  const detailUrl = (a) => { const m = /^\/history\/([\w-]+)$/.exec(new URL(a.href, location.href).pathname); return m ? `/api/calls/${m[1]}` : null; };
  document.addEventListener('pointerdown', (e) => { const a = e.target.closest?.('a[href^="/history/"]'); const u = a && detailUrl(a); if (u) window.AppUI.prefetch(u); }, { passive: true, capture: true });
  let hoverTimer = 0;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const a = e.target.closest?.('a[href^="/history/"]'); clearTimeout(hoverTimer);
    const u = a && detailUrl(a); if (u) hoverTimer = setTimeout(() => window.AppUI.prefetch(u), 80);
  });
})();
