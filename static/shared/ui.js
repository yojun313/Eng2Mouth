// Eng2Mouth 공통 UI: 토스트(상단, 최대 3개, 액션 버튼) · 바텀 시트(모바일) = 가운데 모달(데스크톱) · 길게 누르기 · fetch 헬퍼
(function () {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const coarse = matchMedia('(pointer: coarse)').matches;

  // ---------- 토스트 ----------
  let host = null;
  function toastHost() { if (!host) { host = document.createElement('div'); host.className = 'toast-host'; host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); } return host; }
  function toast(message, ok = true, ms = 2400, action = null) {
    const h = toastHost();
    while (h.children.length >= 3) h.firstElementChild.remove();
    const el = document.createElement('div'); el.className = 'toast';
    el.innerHTML = `<i class="fas ${ok ? 'fa-circle-check text-emerald-400' : 'fa-triangle-exclamation text-red-400'}"></i><span class="toast-msg">${esc(message)}</span>`;
    if (action) { const b = document.createElement('button'); b.type = 'button'; b.textContent = action.label; b.addEventListener('click', () => { el.remove(); action.onClick?.(); }); el.appendChild(b); }
    h.appendChild(el);
    if (!ok) { try { navigator.vibrate?.([20, 60, 20]); } catch (e) {} }
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 200); }, action ? Math.max(ms, 5000) : ms);
    return el;
  }

  // ---------- 시트 ----------
  let overlay = null, body = null, onCloseCb = null;
  function ensureSheet() {
    if (overlay) return;
    overlay = document.createElement('div'); overlay.className = 'sheet-overlay'; overlay.hidden = true;
    overlay.innerHTML = '<div class="e2m-sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div><div class="sheet-body"></div></div>';
    document.body.appendChild(overlay);
    body = overlay.querySelector('.sheet-body');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheet(); });
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) closeSheet(); });
  }
  function openSheet(html, onMount, onClose) {
    ensureSheet(); body.innerHTML = html; overlay.hidden = false; onCloseCb = onClose || null;
    document.documentElement.classList.add('sheet-open');
    onMount?.(body);
    if (!history.state?.sheet) history.pushState({ ...(history.state || {}), sheet: true }, '');
  }
  function closeSheet(fromPop = false) {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true; body.innerHTML = ''; document.documentElement.classList.remove('sheet-open');
    const cb = onCloseCb; onCloseCb = null; cb?.();
    if (!fromPop && history.state?.sheet) history.back();
  }
  addEventListener('popstate', () => { if (overlay && !overlay.hidden) closeSheet(true); });

  function sheetHeader(title, subtitle) {
    return `<div class="sheet-head"><div><h3>${esc(title || '')}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><button type="button" class="sheet-close hit" aria-label="닫기">&times;</button></div>`;
  }
  function bindClose(root) { root.querySelector('.sheet-close')?.addEventListener('click', () => closeSheet()); }

  // 1) 메뉴
  function actionSheet({ title, subtitle, actions = [] }) {
    const html = sheetHeader(title, subtitle) + '<div class="sheet-actions">' + actions.map((a, i) => a === 'sep' ? '<div class="sheet-sep"></div>' :
      `<button type="button" class="sheet-action ${a.danger ? 'danger' : ''} ${a.current ? 'current' : ''}" data-i="${i}">
        ${a.icon ? `<span class="sheet-action-icon"><i class="fas ${a.icon}"></i></span>` : ''}
        <span class="min-w-0 flex-1 text-left"><span class="block truncate">${esc(a.label)}</span>${a.sub ? `<span class="block text-[11px] opacity-60 truncate">${esc(a.sub)}</span>` : ''}</span>
        ${a.current ? '<i class="fas fa-check text-blue-300"></i>' : ''}</button>`).join('') + '</div>';
    openSheet(html, (root) => {
      bindClose(root);
      root.querySelectorAll('.sheet-action').forEach((b) => b.addEventListener('click', async () => { const a = actions[+b.dataset.i]; closeSheet(); try { await a.onClick?.(); } catch (e) { toast(e.message || '실패', false); } }));
    });
  }
  // 2) 입력 폼 (onSubmit 이 throw 하면 토스트, true 반환하면 안 닫음)
  function formSheet({ title, subtitle, fields = [], extraHtml = '', submitLabel = '확인', danger = false, onMount, onSubmit }) {
    const html = sheetHeader(title, subtitle) + `<form class="sheet-form">${fields.map((f) => `<label class="block"><span class="sheet-label">${esc(f.label || '')}</span>${f.type === 'textarea' ? `<textarea name="${esc(f.name)}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}" ${f.maxlength ? `maxlength="${f.maxlength}"` : ''}>${esc(f.value || '')}</textarea>` : `<input type="${f.type || 'text'}" name="${esc(f.name)}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" ${f.maxlength ? `maxlength="${f.maxlength}"` : ''} ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ''} ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} ${f.required ? 'required' : ''}>`}</label>`).join('')}${extraHtml}<div class="sheet-btns"><button type="button" class="btn-ghost sheet-cancel">취소</button><button type="submit" class="${danger ? 'btn-danger' : 'btn-glow'}">${esc(submitLabel)}</button></div></form>`;
    openSheet(html, (root) => {
      bindClose(root); root.querySelector('.sheet-cancel').addEventListener('click', () => closeSheet());
      const form = root.querySelector('form');
      if (!coarse) form.querySelector('input, textarea')?.focus();   // 모바일은 자동 포커스 X (키보드가 갑자기 뜸)
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); const btn = form.querySelector('[type=submit]'); btn.disabled = true;
        try { const data = Object.fromEntries(new FormData(form).entries()); const keep = await onSubmit?.(data, root); if (keep !== true) closeSheet(); }
        catch (err) { toast(err.message || '실패', false); } finally { btn.disabled = false; }
      });
      onMount?.(root);
    });
  }
  // 3) 확인 (Promise<boolean>)
  function confirmSheet({ title, message, confirmLabel = '확인', cancelLabel = '취소', danger = false }) {
    return new Promise((resolve) => {
      let done = false;
      openSheet(sheetHeader(title) + `<p class="sheet-message">${esc(message || '')}</p><div class="sheet-btns"><button type="button" class="btn-ghost sheet-cancel">${esc(cancelLabel)}</button><button type="button" class="${danger ? 'btn-danger' : 'btn-glow'} sheet-ok">${esc(confirmLabel)}</button></div>`,
        (root) => { bindClose(root); root.querySelector('.sheet-cancel').addEventListener('click', () => closeSheet()); root.querySelector('.sheet-ok').addEventListener('click', () => { done = true; closeSheet(); resolve(true); }); },
        () => { if (!done) resolve(false); });
    });
  }

  // ---------- 길게 누르기 (iOS 는 contextmenu 가 없다) ----------
  function attachLongPress(root, selector, onLongPress) {
    let timer = null, start = null, fired = false;
    root.addEventListener('pointerdown', (e) => {
      const target = e.target.closest(selector);
      if (!target || e.button > 0 || e.target.closest('button, a.no-lp')) return;
      fired = false; start = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => { fired = true; haptic(12); onLongPress(target); }, 520);   // 타이머 안이라 iOS 는 안 울림 (안드로이드만)
    });
    const cancel = () => { clearTimeout(timer); timer = null; };
    root.addEventListener('pointermove', (e) => { if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel(); });
    root.addEventListener('pointerup', cancel); root.addEventListener('pointercancel', cancel);
    root.addEventListener('contextmenu', (e) => { const t = e.target.closest(selector); if (!t) return; e.preventDefault(); if (!fired) onLongPress(t); cancel(); });
    root.addEventListener('click', (e) => { if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; } }, true);
  }

  // ---------- fetch 헬퍼 ----------
  const haptic = (p) => window.NativeFeel?.haptic(p);
  async function request(url, opts = {}) {
    const o = { headers: {}, credentials: 'same-origin', ...opts };
    if (o.body && typeof o.body === 'object' && !(o.body instanceof FormData) && !(o.body instanceof Blob)) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.body); }
    const res = await fetch(url, o);
    if (res.status === 401) { location.href = '/login'; throw new Error('로그인이 필요합니다.'); }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.detail) ? (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)) : `오류 ${res.status}`);
    return data;
  }
  // 방금 누른 버튼이 시작한 요청이 120ms 넘게 걸리면 그 버튼에 .is-busy (09 §7)
  function api(url, opts = {}) {
    const NF = window.NativeFeel;
    const tap = NF ? NF.takeTap() : null;
    return NF ? NF.busy(tap, request(url, opts)) : request(url, opts);
  }

  // ---------- 캐시 먼저 → 새 데이터로 교체 (stale-while-revalidate · 10 §4) ----------
  // 사용자별 sessionStorage (탭 안에서만, 로그아웃 때 지움). 최근 40개만 유지.
  const USER = document.body?.dataset.user || '';
  const SWR_PREFIX = `e2m_swr:${USER}:`, SWR_INDEX = `e2m_swr_idx:${USER}`, SWR_MAX = 40;
  const inflight = new Map();
  function swrRead(url) { try { const v = sessionStorage.getItem(SWR_PREFIX + url); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function swrWrite(url, data) {
    try {
      let idx = JSON.parse(sessionStorage.getItem(SWR_INDEX) || '[]').filter((u) => u !== url);
      idx.push(url);
      while (idx.length > SWR_MAX) sessionStorage.removeItem(SWR_PREFIX + idx.shift());
      sessionStorage.setItem(SWR_PREFIX + url, JSON.stringify(data));
      sessionStorage.setItem(SWR_INDEX, JSON.stringify(idx));
    } catch (e) { try { swrClear(); } catch (err) {} }   // 용량 초과 → 비우고 계속
  }
  function swrClear() { Object.keys(sessionStorage).filter((k) => k.startsWith('e2m_swr')).forEach((k) => sessionStorage.removeItem(k)); }
  function swrInvalidate(prefix) { try { Object.keys(sessionStorage).filter((k) => k.startsWith(SWR_PREFIX + prefix)).forEach((k) => sessionStorage.removeItem(k)); } catch (e) {} }
  function fetchFresh(url) {
    if (inflight.has(url)) return inflight.get(url);
    const req = request(url).then((d) => { swrWrite(url, d); return d; }).finally(() => inflight.delete(url));
    req.catch(() => {});
    inflight.set(url, req);
    return req;
  }
  // onData(data, fromCache): 캐시가 있으면 즉시 한 번, 새 데이터가 다르면 한 번 더 부른다 (같으면 다시 그리지 않음 → 깜빡임 · 스크롤 튐 방지)
  async function swr(url, onData) {
    const NF = window.NativeFeel;
    const tap = NF ? NF.takeTap() : null;                   // 버튼이 시작한 요청이면
    const cached = swrRead(url);
    if (cached) { try { onData(cached, true); } catch (e) { console.error(e); } }
    // 캐시로 이미 바뀐 화면이면 버튼은 그대로, 캐시가 없을 때만 120ms 넘으면 .is-busy
    const fresh = await (cached || !NF ? fetchFresh(url) : NF.busy(tap, fetchFresh(url)));
    if (!cached || JSON.stringify(cached) !== JSON.stringify(fresh)) onData(fresh, false);
    return fresh;
  }
  // 누르기 시작할 때 / 마우스를 올렸을 때 GET 을 미리 받아 둔다 (10 §5). 읽기 요청만.
  function prefetch(url) { if (!swrRead(url) && !inflight.has(url)) fetchFresh(url); }

  const fmtDur = (sec) => { sec = Math.max(0, Math.round(sec || 0)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const fmtKrw = (n) => `${Math.round(n || 0).toLocaleString('ko-KR')}원`;
  const scoreColor = (v) => v >= 80 ? '#34d399' : v >= 60 ? '#60a5fa' : v >= 40 ? '#fbbf24' : '#f87171';
  const pageData = (id = 'page-data') => { try { return JSON.parse(document.getElementById(id)?.textContent || '{}'); } catch (e) { return {}; } };
  // 초안 저장 (localStorage)
  const draft = { get: (k) => { try { return localStorage.getItem('e2m_draft:' + k) || ''; } catch (e) { return ''; } }, set: (k, v) => { try { v ? localStorage.setItem('e2m_draft:' + k, v) : localStorage.removeItem('e2m_draft:' + k); } catch (e) {} } };
  function bindDraft(el, key) { if (!el) return; const v = draft.get(key); if (v && !el.value) el.value = v; el.addEventListener('input', () => draft.set(key, el.value)); return () => draft.set(key, ''); }
  // 한글 조합 중 Enter 무시
  const isComposing = (e) => e.isComposing || e.keyCode === 229;

  window.AppUI = { toast, actionSheet, formSheet, confirmSheet, openSheet, closeSheet, attachLongPress, api, swr, prefetch, swrClear, swrInvalidate, haptic, esc, fmtDur, fmtDate, fmtKrw, scoreColor, pageData, draft, bindDraft, isComposing, coarse };
  window.toast = toast; window.api = api; window.esc = esc; window.fmtDur = fmtDur; window.fmtDate = fmtDate; window.fmtKrw = fmtKrw; window.scoreColor = scoreColor;
})();
