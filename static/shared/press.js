// 아이폰 앱처럼 누르는 느낌 — 눌림 표시 · 햅틱 · 느린 버튼 표시 (prompts/09-native-touch-feel, templates/press.js 기반)
// <head> 에서 바로 불러도 된다 (document 에만 리스너를 건다). CSS 는 mobile.css 의 "누르는 느낌" 부분.
(function () {
  'use strict';

  // 버튼처럼 흐려질 것 / 목록 줄처럼 배경이 진해질 것
  const PRESSABLE = 'button, [role="button"], a[href], summary, label.cursor-pointer, .call-item, .row-cell, .persona-card, .topic-card, .opt-card, .opt, .quick-chip';
  const ROW = '.call-item, .row-cell, .nav-link, .sheet-action';
  // 세그먼트 · 필터 · 선택지 · 확인처럼 "고르는" 동작에만 가벼운 햅틱 (UISelectionFeedbackGenerator 자리)
  const HAPTIC = '[data-haptic], .seg button, .filter-chip, .opt, .opt-card, .persona-card, .sheet-ok, .sheet-btns [type=submit], #bookmarkFilter, #catRow button, input[type=checkbox]';

  // ── 햅틱: 안드로이드 navigator.vibrate · iOS 18+ 숨긴 <input type=checkbox switch> 토글 ──
  // ⚠️ 사용자 제스처(click/touchend 처리 중)에서만 울린다. await 뒤 · setTimeout 안 · WebSocket 메시지에서는 iOS 가 무시한다.
  let hapticLabel = null;
  function haptic(pattern = 8) {
    try {
      if (typeof navigator.vibrate === 'function') { navigator.vibrate(pattern); return; }
      if (!document.body) return;
      if (!hapticLabel) {
        hapticLabel = document.createElement('label');
        hapticLabel.setAttribute('aria-hidden', 'true');
        hapticLabel.className = 'e2m-haptic';
        // display:none 이면 안 울린다 — 화면 밖에 1px 로 둔다
        hapticLabel.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden';
        const box = document.createElement('input');
        box.type = 'checkbox'; box.setAttribute('switch', ''); box.tabIndex = -1;
        hapticLabel.appendChild(box);
        const stop = (event) => event.stopPropagation();   // 가짜 클릭이 "바깥 클릭 → 닫기" 로 번지지 않게
        hapticLabel.addEventListener('click', stop); box.addEventListener('click', stop);
        document.body.appendChild(hapticLabel);
      }
      hapticLabel.click();
    } catch (e) { /* noop */ }
  }
  const isHapticClick = (event) => !!(hapticLabel && hapticLabel.contains(event.target));

  // ── 눌림 표시: 누르는 순간 0ms 로 .is-pressed, 뗄 때 .press-release 로 200ms 복귀 ──
  // 목록 줄은 50ms 늦게 (스크롤하려고 댄 손가락에 번쩍이지 않게), 10px 넘게 움직이거나 스크롤이 시작되면 즉시 취소.
  let pressed = null, pressTimer = 0, pressStart = null;
  function release(fade = true) {
    clearTimeout(pressTimer);
    const el = pressed; pressed = null;
    if (!el || !el.classList.contains('is-pressed')) return;
    el.classList.remove('is-pressed');
    if (!fade) return;
    el.classList.add('press-release');
    setTimeout(() => el.classList.remove('press-release'), 220);
  }
  const opts = { capture: true, passive: true };   // passive: 스크롤을 절대 막지 않는다
  document.addEventListener('pointerdown', (event) => {
    if (event.button > 0) return;
    release(false);
    const target = event.target.closest?.(PRESSABLE);   // 가장 안쪽 — 줄 안의 ⋯ 버튼을 누르면 그 버튼만
    if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true' || target.closest('[data-no-press]')) return;
    pressed = target; pressStart = { x: event.clientX, y: event.clientY };
    if (event.pointerType !== 'mouse' && target.matches(ROW)) pressTimer = setTimeout(() => pressed?.classList.add('is-pressed'), 50);
    else target.classList.add('is-pressed');
  }, opts);
  document.addEventListener('pointermove', (event) => {
    if (pressed && pressStart && Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > 10) release(false);
  }, opts);
  document.addEventListener('pointerup', () => {
    // 50ms 안에 톡 친 줄도 눌림을 한 번 보여 준다 (추가와 제거를 같은 프레임에 하면 안 보인다)
    if (pressed && !pressed.classList.contains('is-pressed')) {
      clearTimeout(pressTimer);
      const el = pressed; el.classList.add('is-pressed');
      pressTimer = setTimeout(() => { if (pressed === el) release(true); }, 90);
      return;
    }
    release(true);
  }, opts);
  document.addEventListener('pointercancel', () => release(false), opts);   // iOS: 스크롤이 시작되면 온다
  document.addEventListener('scroll', () => release(false), opts);           // capture 라 안쪽 스크롤도 잡힌다
  document.addEventListener('dragstart', () => release(false), opts);
  document.addEventListener('touchstart', () => {}, { passive: true });      // iOS Safari :active 켜기

  document.addEventListener('click', (event) => {
    if (isHapticClick(event)) return;
    if (event.target.closest?.(HAPTIC)) haptic(6);
  });

  // ── 느린 버튼: 방금(80ms 안에) 누른 버튼이 시작한 요청이 120ms 넘게 걸리면 .is-busy ──
  let lastTap = null;
  document.addEventListener('click', (event) => {
    if (isHapticClick(event)) return;
    const el = event.target.closest?.('button, [role="button"]');
    lastTap = el && !el.closest('.sheet-overlay') ? { el, t: performance.now() } : null;   // 시트는 곧 닫히므로 제외
  }, true);
  function takeTap() {
    const tap = lastTap && performance.now() - lastTap.t < 80 ? lastTap.el : null;
    lastTap = null;
    return tap;
  }
  async function busy(tap, promise) {
    if (!tap) return promise;
    const timer = setTimeout(() => tap.classList.add('is-busy'), 120);
    try { return await promise; } finally { clearTimeout(timer); tap.classList.remove('is-busy'); }
  }

  window.NativeFeel = { haptic, takeTap, busy, isHapticClick };
})();
