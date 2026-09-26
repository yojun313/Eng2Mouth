// 통화 기록: 목록 + 상세 (모바일 슬라이드 패널 · 뒤로 가기 · 길게 누르기 메뉴 · 무한 스크롤) — 상세는 /history/{id} 주소를 갖는다
(function () {
  'use strict';
  const { api, swr, swrInvalidate, toast, esc, fmtDur, fmtDate, fmtKrw, scoreColor, pageData, actionSheet, confirmSheet, attachLongPress } = window.AppUI;
  // 통화 데이터가 바뀌면 그 통화 · 대시보드 캐시를 비운다 (목록은 swr 이 알아서 새로 받는다)
  const invalidate = (id) => { if (id) swrInvalidate(`/api/calls/${id}`); swrInvalidate('/api/stats'); swrInvalidate('/api/calls?limit=5'); };
  const lg = matchMedia('(min-width: 1024px)');
  const state = { q: '', kind: '', bookmarked: false, skip: 0, total: 0, loading: false, items: [] };
  let debounce = null, current = null, saved = new Set();
  const LABELS = { fluency: '유창성', grammar: '문법', vocabulary: '어휘', coherence: '논리/구성', interaction: '상호작용' };
  const LEVEL_KO = { beginner: '초급', intermediate: '중급', advanced: '고급' };
  const listEl = document.getElementById('list'), pane = document.getElementById('detailPane'), body = document.getElementById('detailBody');

  // ---------- 목록 ----------
  function dayKey(iso) { const d = new Date(iso), t = new Date(), y = new Date(); y.setDate(t.getDate() - 1); const same = (a, b) => a.toDateString() === b.toDateString(); return same(d, t) ? '오늘' : same(d, y) ? '어제' : d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }); }
  function card(c) {
    const t = c.topic || {}, p = c.persona || {};
    const kindChip = t.kind === 'scenario' ? '<span class="chip text-purple-200 border-purple-400/30 bg-purple-500/10">롤플레이</span>' : t.kind === 'free' ? '<span class="chip text-white/50">자유</span>' : '';
    return `<a href="/history/${c.id}" data-id="${c.id}" class="call-item row-cell glass rounded-2xl p-3 flex items-center gap-3 hover:border-blue-400/40 transition group ${current === c.id ? 'selected' : ''}">
      <div class="w-11 h-11 rounded-xl bg-gradient-to-br ${p.gradient || 'from-blue-500 to-purple-500'} flex items-center justify-center text-xl flex-shrink-0 shadow">${p.emoji || '📞'}</div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 min-w-0"><p class="font-bold text-sm truncate">${esc(t.emoji || '')} ${esc(t.title_ko || t.title || '통화')}</p>${kindChip}${c.bookmarked ? '<i class="fas fa-star text-amber-300 text-xs"></i>' : ''}</div>
        <p class="text-[11px] text-white/45 truncate mt-0.5">${esc(p.name || '')} · ${new Date(c.started_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} · ${fmtDur(c.duration_sec)} · ${c.stats?.user_words ?? 0}단어${c.note ? ' · 📝 ' + esc(c.note.slice(0, 24)) : ''}</p>
      </div>
      <div class="text-right flex-shrink-0">
        ${c.overall != null ? `<p class="text-xl font-extrabold tabular leading-none" style="color:${scoreColor(c.overall)}">${c.overall}</p><p class="text-[10px] text-white/40">${esc(c.cefr || '')}</p>` : '<p class="text-[10px] text-amber-200 flex items-center gap-1 justify-end"><span class="status-dot warn"></span>미평가</p>'}
        <p class="text-[10px] text-amber-200/90 tabular mt-0.5 whitespace-nowrap"><i class="fas fa-coins mr-0.5 text-[8px]"></i>${fmtKrw(c.cost_krw)}</p>
      </div>
      <i class="fas fa-chevron-right text-white/20 group-hover:text-white/60 transition text-xs"></i>
    </a>`;
  }
  function appendPage(d, reset) {
    state.total = d.total;
    if (reset) { listEl.innerHTML = ''; listEl.dataset.lastDay = ''; state.items = []; state.skip = 0; }
    if (!d.items.length && reset) listEl.innerHTML = '<div class="text-center text-white/35 text-sm py-16"><i class="far fa-folder-open text-4xl mb-3 opacity-40 block"></i>통화 기록이 없습니다.<br><a href="/call" class="text-emerald-300 hover:underline mt-2 inline-block">첫 통화 걸기 →</a></div>';
    let lastDay = listEl.dataset.lastDay || '';
    d.items.forEach((c) => { const k = dayKey(c.started_at); if (k !== lastDay) { listEl.insertAdjacentHTML('beforeend', `<p class="text-[10px] font-bold text-white/40 uppercase tracking-wider pt-3 pb-1 px-1">${k}</p>`); lastDay = k; } listEl.insertAdjacentHTML('beforeend', card(c)); });
    listEl.dataset.lastDay = lastDay; state.items = state.items.concat(d.items); state.skip += d.items.length;
    document.getElementById('countLine').textContent = `총 ${state.total}건`;
    document.getElementById('moreSentinel').textContent = state.skip < state.total ? '아래로 내리면 더 불러옵니다' : (state.total ? '끝' : '');
  }
  async function load(reset = true) {
    if (state.loading) return; state.loading = true;
    try {
      if (reset) {
        // 첫 페이지: 전에 본 목록을 즉시 → 새 데이터가 다르면 교체 (10 §4)
        listEl.innerHTML = '<p class="text-center text-white/35 text-sm py-10"><i class="fas fa-spinner fa-spin mr-2"></i>불러오는 중…</p>';
        const qs = new URLSearchParams({ q: state.q, kind: state.kind, bookmarked: state.bookmarked, limit: 30, skip: 0 });
        await swr('/api/calls?' + qs, (d) => appendPage(d, true));
      } else {
        const qs = new URLSearchParams({ q: state.q, kind: state.kind, bookmarked: state.bookmarked, limit: 30, skip: state.skip });
        appendPage(await api('/api/calls?' + qs), false);
      }
    } catch (e) { toast(e.message, false); } finally { state.loading = false; }
  }
  // 무한 스크롤 (버튼 누르게 하지 않기)
  new IntersectionObserver((es) => { if (es[0].isIntersecting && state.skip < state.total && !state.loading) load(false); }, { root: document.getElementById('listScroll'), rootMargin: '200px' }).observe(document.getElementById('moreSentinel'));
  document.getElementById('q').addEventListener('input', (e) => { clearTimeout(debounce); debounce = setTimeout(() => { state.q = e.target.value.trim(); load(); }, 300); });
  document.querySelectorAll('#kindSeg button').forEach((b) => b.addEventListener('click', () => { state.kind = b.dataset.kind; document.querySelectorAll('#kindSeg button').forEach((x) => x.classList.toggle('active', x === b)); load(); }));
  document.getElementById('bookmarkFilter').addEventListener('click', (e) => { state.bookmarked = !state.bookmarked; e.currentTarget.classList.toggle('text-amber-300', state.bookmarked); e.currentTarget.querySelector('i').className = state.bookmarked ? 'fas fa-star mr-1' : 'far fa-star mr-1'; load(); });

  // 목록 클릭 → 상세 (페이지 이동 대신 패널)
  listEl.addEventListener('click', (e) => { const a = e.target.closest('a.call-item'); if (!a || e.metaKey || e.ctrlKey) return; e.preventDefault(); open(a.dataset.id); });
  attachLongPress(listEl, 'a.call-item', (el) => { const c = state.items.find((x) => x.id === el.dataset.id); if (c) menu(c); });

  // ---------- 상세 패널 열기/닫기 + 뒤로 가기 ----------
  function open(id, fromPop = false) {
    current = id; pane.classList.remove('hidden');
    listEl.querySelectorAll('.call-item').forEach((el) => el.classList.toggle('selected', el.dataset.id === id));
    document.body.classList.add('detail-open');
    if (!fromPop) history.pushState({ detail: id }, '', `/history/${id}`);
    render(id);
  }
  function close(fromPop = false) {
    if (!fromPop && history.state?.detail) { history.back(); return; }
    document.body.classList.remove('detail-open'); current = null;
    listEl.querySelectorAll('.call-item.selected').forEach((el) => el.classList.remove('selected'));
    if (!lg.matches) pane.classList.add('hidden');
    if (location.pathname !== '/history' && !fromPop) history.replaceState(null, '', '/history');
  }
  addEventListener('popstate', (e) => { if (e.state?.detail) open(e.state.detail, true); else if (document.body.classList.contains('detail-open')) close(true); });
  document.getElementById('backBtn').addEventListener('click', () => close());
  lg.addEventListener('change', () => { if (lg.matches) pane.classList.remove('hidden'); else if (!current) pane.classList.add('hidden'); });
  if (lg.matches) pane.classList.remove('hidden');

  // ---------- 상세 렌더 ----------
  async function render(id) {
    // 캐시(미리 받은 것 포함)가 있으면 즉시 그리고, 새 데이터가 다를 때만 다시 그린다 (10 §4 · §5)
    body.innerHTML = '<p class="text-center text-white/40 text-sm py-10"><i class="fas fa-spinner fa-spin mr-2"></i>불러오는 중…</p>';
    let shown = false;
    try {
      await swr(`/api/calls/${id}`, (doc) => {
        if (current !== id) return;                                                        // 그 사이 다른 걸 열었으면 버린다
        if (shown && body.contains(document.activeElement) && document.activeElement.matches('textarea, input')) return;   // 메모 입력 중이면 덮지 않는다
        paint(doc); shown = true;
      });
    } catch (e) { if (!shown && current === id) body.innerHTML = `<p class="text-center text-red-300 text-sm py-10">${esc(e.message)}</p>`; }
  }
  function paint(doc) {
    saved = new Set(doc.saved_phrases || []);
    const t = doc.topic || {}, p = doc.persona || {}, ev = doc.evaluation, st = doc.stats || {};
    document.getElementById('paneTitle').textContent = t.title_ko || t.title || '통화 상세';
    document.querySelector('#bookmarkBtn i').className = `${doc.bookmarked ? 'fas text-amber-300' : 'far'} fa-star`;
    document.getElementById('bookmarkBtn').onclick = () => toggleBookmark(doc);
    document.getElementById('moreBtn').onclick = () => menu(doc);
    const redial = `/call?kind=${t.kind === 'scenario' ? 'scenario' : t.kind === 'free' ? 'free' : (t.id === 'custom' ? 'custom&title=' + encodeURIComponent(t.title || '') : 'topic')}&id=${encodeURIComponent(t.id || '')}`;
    body.innerHTML = `
      <div class="max-w-6xl mx-auto grid grid-cols-[minmax(0,1fr)] 2xl:grid-cols-12 gap-4">
        <div class="2xl:col-span-5 space-y-4 min-w-0">
          <section class="glass-strong rounded-3xl p-5">
            <div class="flex items-center gap-4">
              <div class="w-16 h-16 rounded-2xl bg-gradient-to-br ${p.gradient || 'from-blue-500 to-purple-500'} flex items-center justify-center text-3xl shadow-lg flex-shrink-0">${p.emoji || '📞'}</div>
              <div class="min-w-0 flex-1"><h2 class="text-lg font-extrabold leading-tight">${esc(t.emoji || '')} ${esc(t.title_ko || t.title || '')}</h2><p class="text-xs text-white/50 mt-0.5">${esc(t.title || '')}</p><p class="text-xs text-white/60 mt-1">${[p.name, p.title, LEVEL_KO[doc.level]].filter(Boolean).map(esc).join(' · ')}</p></div>
              <div class="hidden lg:flex items-center gap-1 ml-auto"><button class="icon-btn bm-desk" aria-label="북마크"><i class="${doc.bookmarked ? 'fas text-amber-300' : 'far'} fa-star"></i></button><button class="icon-btn more-desk" aria-label="더 보기"><i class="fas fa-ellipsis"></i></button></div>
            </div>
            <div class="grid grid-cols-3 gap-2 mt-4 text-center">
              ${[['통화 시간', fmtDur(doc.duration_sec)], ['내 단어', st.user_words ?? 0], ['발화 비중', (st.talk_share ?? 0) + '%'], ['분당 단어', st.words_per_minute ?? 0], ['고유 단어', st.unique_words ?? 0], ['최장 발화', (st.longest_turn_words ?? 0) + '<span class="text-[10px] font-normal text-white/40">단어</span>']].map(([l, v]) => `<div class="glass-soft rounded-xl p-2"><p class="text-[10px] text-white/45">${l}</p><p class="font-extrabold tabular">${v}</p></div>`).join('')}
            </div>
            <p class="text-[10px] text-white/35 mt-3">${fmtDate(doc.started_at)}${t.kind === 'scenario' ? ` · 롤플레이 (AI: ${esc(t.ai_role || '')})` : ''}</p>
            <div class="glass-soft rounded-xl p-3 mt-3 flex items-center justify-between"><div><p class="text-[10px] text-white/45"><i class="fas fa-coins mr-1 text-amber-300"></i>이 통화 비용 (평가 포함 · 추정)</p><p class="text-lg font-extrabold tabular">${fmtKrw(doc.cost_krw)} <span class="text-xs font-normal text-white/50">≈ $${(doc.cost_usd || 0).toFixed(4)}</span></p></div><p class="text-[10px] text-white/35 text-right">${esc(doc.provider || '')}<br>${esc(doc.model || '')}<br>환율 ${Number(doc.usd_krw || 0).toLocaleString('ko-KR')}원/$</p></div>
            <div class="flex gap-2 mt-4"><a href="${redial}" class="btn-call flex-1 py-3 rounded-xl text-sm font-bold text-center"><i class="fas fa-phone mr-1"></i>같은 주제로 다시</a><button class="icon-btn h-auto copy-btn" title="대화 복사" aria-label="대화 복사"><i class="fas fa-copy"></i></button></div>
          </section>
          <section class="glass rounded-2xl p-4">
            <p class="text-[10px] font-bold text-white/50 uppercase tracking-wider mb-2"><i class="fas fa-note-sticky mr-1 text-amber-300"></i>내 메모</p>
            <textarea class="note-input w-full glass-input rounded-xl p-3 text-sm resize-none" rows="3" placeholder="이 통화에서 기억하고 싶은 것">${esc(doc.note || '')}</textarea>
            <p class="text-[10px] text-white/35 mt-1 note-status">입력하면 자동 저장됩니다.</p>
          </section>
          <section class="glass rounded-2xl overflow-hidden">
            <div class="p-4 border-b border-white/10 flex items-center justify-between"><p class="text-[10px] font-bold text-white/50 uppercase tracking-wider"><i class="fas fa-comments mr-1 text-blue-300"></i>대화 전문 <span class="normal-case font-normal text-white/35">(${(doc.transcript || []).length}턴)</span></p><button class="only-me hit text-[11px] text-white/50 hover:text-white px-2 py-2"><i class="fas fa-highlighter mr-1"></i>내 말만 보기</button></div>
            <div class="p-4 space-y-2">${(doc.transcript || []).map((x, i) => `<div class="flex ${x.role === 'user' ? 'justify-end' : ''} turn-${x.role}"><div class="max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed transcript-text ${x.role === 'user' ? 'bg-blue-500/30 rounded-br-md' : 'bg-white/10 rounded-bl-md'}"><p>${esc(x.text)}</p>${x.role === 'assistant' ? `<button class="tr-btn hit text-[10px] text-white/45 hover:text-white mt-1 py-1" data-i="${i}"><i class="fas fa-language mr-1"></i>번역</button><span class="tr-out block text-[11px] text-emerald-200 mt-1"></span>` : ''}</div></div>`).join('') || '<p class="text-xs text-white/40 text-center py-6">저장된 대화가 없습니다.</p>'}</div>
          </section>
        </div>
        <div class="2xl:col-span-7 space-y-4 min-w-0 eval-col">${ev ? evalHtml(ev) : `<div class="glass rounded-2xl p-8 text-center"><i class="fas fa-wand-magic-sparkles text-3xl text-purple-300 mb-3"></i><p class="text-sm text-white/70 mb-4">아직 평가 리포트가 없습니다.</p><button class="eval-btn btn-glow px-6 py-3 rounded-xl font-bold text-sm">지금 평가하기</button><p class="text-[10px] text-white/35 mt-2">내 API Key 로 평가 (약 $0.003~0.02)</p></div>`}</div>
      </div>`;
    bind(doc);
  }
  function evalHtml(ev) {
    const S = ev.scores || {};
    return `
      <section class="glass-strong rounded-3xl p-5">
        <div class="flex items-center gap-5">
          <div class="relative w-28 h-28 flex-shrink-0"><svg viewBox="0 0 100 100" class="w-full h-full -rotate-90"><circle cx="50" cy="50" r="42" fill="none" stroke="rgba(148,163,184,.15)" stroke-width="10"/><circle cx="50" cy="50" r="42" fill="none" stroke="${scoreColor(ev.overall)}" stroke-width="10" stroke-linecap="round" stroke-dasharray="264" stroke-dashoffset="${264 - 264 * ev.overall / 100}"/></svg><div class="absolute inset-0 flex flex-col items-center justify-center"><span class="text-3xl font-extrabold tabular">${ev.overall}</span><span class="text-[10px] text-white/50">/100</span></div></div>
          <div class="min-w-0"><p class="text-[10px] font-bold text-white/45 uppercase">종합 평가</p><p class="text-3xl font-extrabold">${esc(ev.cefr)} <span class="text-sm text-white/50 font-semibold">CEFR</span></p><p class="text-sm text-white/65 mt-1 leading-relaxed">${esc(ev.summary_ko)}</p></div>
        </div>
        <div class="mt-5 grid grid-cols-[minmax(0,1fr)] sm:grid-cols-2 gap-x-6 gap-y-2">${Object.keys(LABELS).map((k) => `<div class="flex items-center gap-3 text-xs"><span class="w-16 text-white/60">${LABELS[k]}</span><div class="score-track flex-1"><div class="score-fill" style="width:${S[k] || 0}%;background:${scoreColor(S[k] || 0)}"></div></div><span class="w-7 text-right font-bold tabular">${S[k] ?? '-'}</span></div>`).join('')}</div>
      </section>
      <div class="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-2 gap-4">
        <section class="glass rounded-2xl p-4"><p class="text-xs font-bold text-emerald-300 mb-2"><i class="fas fa-thumbs-up mr-1"></i>잘한 점</p><ul class="text-sm text-white/75 space-y-1.5 list-disc list-inside">${(ev.strengths || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ul></section>
        <section class="glass rounded-2xl p-4"><p class="text-xs font-bold text-amber-300 mb-2"><i class="fas fa-bullseye mr-1"></i>보완할 점</p><ul class="text-sm text-white/75 space-y-1.5 list-disc list-inside">${(ev.improvements || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ul></section>
      </div>
      ${(ev.corrections || []).length ? `<section class="glass rounded-2xl p-4"><p class="text-xs font-bold text-red-300 mb-3"><i class="fas fa-pen mr-1"></i>이렇게 고쳐 말해요</p><div class="grid grid-cols-[minmax(0,1fr)] md:grid-cols-2 gap-3">${ev.corrections.map((c) => `<div class="glass-soft rounded-xl p-3 text-sm"><p class="text-white/50 line-through decoration-red-400/60 text-[13px]">${esc(c.original)}</p><p class="font-bold text-emerald-200 mt-0.5 select-text">${esc(c.better)}</p><p class="text-[11px] text-white/50 mt-1">${esc(c.why_ko)}</p><div class="flex gap-1 mt-1">${saveBtn(c.better, c.why_ko, c.original, 'correction')}<button class="speak-btn text-[11px] text-white/50 hover:text-white px-2 py-2" data-text="${esc(c.better)}"><i class="fas fa-volume-high mr-1"></i>듣기</button></div></div>`).join('')}</div></section>` : ''}
      ${(ev.expressions || []).length ? `<section class="glass rounded-2xl p-4"><p class="text-xs font-bold text-blue-300 mb-3"><i class="fas fa-star mr-1"></i>가져갈 표현</p><div class="grid grid-cols-[minmax(0,1fr)] md:grid-cols-2 gap-3">${ev.expressions.map((x) => `<div class="glass-soft rounded-xl p-3 text-sm"><p class="font-bold select-text">${esc(x.phrase)}</p><p class="text-xs text-white/60">${esc(x.meaning_ko)}</p><p class="text-[12px] text-white/50 italic mt-1">“${esc(x.example)}”</p><div class="flex gap-1 mt-1">${saveBtn(x.phrase, x.meaning_ko, x.example, 'expression')}<button class="speak-btn text-[11px] text-white/50 hover:text-white px-2 py-2" data-text="${esc(x.phrase)}"><i class="fas fa-volume-high mr-1"></i>듣기</button></div></div>`).join('')}</div></section>` : ''}
      ${(ev.filler_words || []).length ? `<div class="glass-soft rounded-2xl p-3 text-xs text-white/60"><i class="fas fa-comment-slash mr-1 text-white/40"></i>자주 쓴 군말: ${ev.filler_words.map((f) => `<span class="chip mx-0.5">${esc(f)}</span>`).join('')}</div>` : ''}
      <section class="glass rounded-2xl p-4"><p class="text-xs font-bold text-purple-300 mb-2"><i class="fas fa-flag-checkered mr-1"></i>다음 통화 목표</p><ul class="text-sm text-white/75 space-y-1.5 list-disc list-inside">${(ev.next_goals || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ul><p class="text-[10px] text-white/30 mt-3">평가 모델 ${esc(ev.model || '')} · ${fmtDate(ev.evaluated_at)}</p></section>`;
  }
  function saveBtn(phrase, meaning, example, kind) {
    const done = saved.has(phrase);
    return `<button class="save-phrase text-[11px] px-2 py-2 ${done ? 'text-emerald-300' : 'text-blue-300 hover:text-blue-200'}" ${done ? 'disabled' : ''} data-phrase="${esc(phrase)}" data-meaning="${esc(meaning)}" data-example="${esc(example)}" data-kind="${kind}"><i class="${done ? 'fas' : 'far'} fa-bookmark mr-1"></i>${done ? '저장됨' : '노트에 저장'}</button>`;
  }
  async function speak(b) { const orig = b.innerHTML; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; try { const res = await fetch('/api/assist/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: b.dataset.text }) }); if (!res.ok) throw new Error((await res.json()).detail); const a = new Audio(URL.createObjectURL(await res.blob())); a.onended = () => URL.revokeObjectURL(a.src); a.play(); } catch (e) { toast(e.message || '재생 실패', false); } finally { b.innerHTML = orig; } }
  function bind(doc) {
    body.querySelectorAll('.save-phrase:not([disabled])').forEach((b) => b.addEventListener('click', async () => { try { const d = await api('/api/phrases', { method: 'POST', body: { phrase: b.dataset.phrase, meaning_ko: b.dataset.meaning, example: b.dataset.example, kind: b.dataset.kind, source_call_id: doc.id } }); b.innerHTML = '<i class="fas fa-bookmark mr-1"></i>저장됨'; b.className = 'save-phrase text-[11px] px-2 py-2 text-emerald-300'; b.disabled = true; toast(d.status === 'exists' ? '이미 노트에 있어요' : '표현 노트에 저장했어요', true, 3000, { label: '노트 열기', onClick: () => location.href = '/phrases' }); } catch (e) { toast(e.message, false); } }));
    body.querySelectorAll('.speak-btn').forEach((b) => b.addEventListener('click', () => speak(b)));
    body.querySelectorAll('.tr-btn').forEach((b) => b.addEventListener('click', async () => { const out = b.nextElementSibling; out.textContent = '번역 중…'; try { const d = await api('/api/assist/translate', { method: 'POST', body: { text: doc.transcript[+b.dataset.i].text } }); out.textContent = d.ko + (d.notes ? ` (${d.notes})` : ''); b.remove(); } catch (e) { out.textContent = e.message; } }));
    body.querySelector('.eval-btn')?.addEventListener('click', async (e) => { const btn = e.currentTarget; btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>평가 중… (10~30초)'; try { await api(`/api/calls/${doc.id}/evaluate`, { method: 'POST' }); invalidate(doc.id); toast('평가가 완료됐어요!'); render(doc.id); load(); } catch (err) { toast(err.message, false, 5000); btn.disabled = false; btn.textContent = '지금 평가하기'; } });
    let noteTimer = null; const note = body.querySelector('.note-input'), noteStatus = body.querySelector('.note-status');
    note.addEventListener('input', () => { clearTimeout(noteTimer); noteStatus.textContent = '저장 대기…'; noteTimer = setTimeout(async () => { try { await api(`/api/calls/${doc.id}`, { method: 'PATCH', body: { note: note.value } }); invalidate(doc.id); noteStatus.textContent = '저장됨 ' + new Date().toLocaleTimeString('ko-KR'); } catch (err) { noteStatus.textContent = '저장 실패'; } }, 800); });
    let onlyMe = false; body.querySelector('.only-me').addEventListener('click', (e) => { onlyMe = !onlyMe; body.querySelectorAll('.turn-assistant').forEach((el) => el.classList.toggle('hidden', onlyMe)); e.currentTarget.innerHTML = onlyMe ? '<i class="fas fa-comments mr-1"></i>전체 보기' : '<i class="fas fa-highlighter mr-1"></i>내 말만 보기'; });
    body.querySelector('.copy-btn').addEventListener('click', async () => { const txt = (doc.transcript || []).map((x) => `${x.role === 'user' ? '나' : (doc.persona?.name || 'AI')}: ${x.text}`).join('\n'); try { await navigator.clipboard.writeText(txt); toast('대화 내용을 복사했어요'); } catch (e) { toast('복사 실패', false); } });
    body.querySelector('.bm-desk')?.addEventListener('click', () => toggleBookmark(doc));
    body.querySelector('.more-desk')?.addEventListener('click', () => menu(doc));
  }
  function paintBookmark(on) {
    const cls = `${on ? 'fas text-amber-300' : 'far'} fa-star`;
    document.querySelector('#bookmarkBtn i').className = cls;
    const d = body.querySelector('.bm-desk i'); if (d) d.className = cls;
  }
  async function toggleBookmark(doc) {
    // 낙관적 UI: 먼저 바꾸고, 실패하면 되돌린다 (10 §6)
    doc.bookmarked = !doc.bookmarked;
    if (current === doc.id) paintBookmark(doc.bookmarked);
    try {
      await api(`/api/calls/${doc.id}`, { method: 'PATCH', body: { bookmarked: doc.bookmarked } });
      invalidate(doc.id); toast(doc.bookmarked ? '북마크에 추가' : '북마크 해제'); load();
    } catch (e) { doc.bookmarked = !doc.bookmarked; if (current === doc.id) paintBookmark(doc.bookmarked); toast(e.message, false); }
  }
  function menu(c) {
    const t = c.topic || {};
    const redial = `/call?kind=${t.kind === 'scenario' ? 'scenario' : t.kind === 'free' ? 'free' : (t.id === 'custom' ? 'custom&title=' + encodeURIComponent(t.title || '') : 'topic')}&id=${encodeURIComponent(t.id || '')}`;
    actionSheet({ title: t.title_ko || t.title || '통화', subtitle: `${c.persona?.name || ''} · ${fmtDate(c.started_at)} · ${fmtDur(c.duration_sec)}`, actions: [
      { icon: 'fa-phone', label: '같은 주제로 다시 통화', onClick: () => location.href = redial },
      { icon: c.bookmarked ? 'fa-star-half-stroke' : 'fa-star', label: c.bookmarked ? '북마크 해제' : '북마크', onClick: () => toggleBookmark(c) },
      ...(c.overall == null ? [{ icon: 'fa-wand-magic-sparkles', label: '지금 평가하기', sub: '내 API Key 로 리포트 생성', onClick: async () => { toast('평가 중… 10~30초 걸려요'); await api(`/api/calls/${c.id}/evaluate`, { method: 'POST' }); invalidate(c.id); toast('평가 완료'); load(); if (current === c.id) render(c.id); } }] : []),
      'sep',
      { icon: 'fa-trash', label: '기록 삭제', danger: true, onClick: async () => { if (!await confirmSheet({ title: '통화 기록 삭제', message: '이 통화의 대화와 평가가 모두 삭제됩니다. 되돌릴 수 없습니다.', confirmLabel: '삭제', danger: true })) return; listEl.querySelector(`[data-id="${c.id}"]`)?.remove(); await api(`/api/calls/${c.id}`, { method: 'DELETE' }); invalidate(c.id); toast('삭제했어요'); if (current === c.id) close(); load(); } },
    ] });
  }

  // ---------- 초기 진입 ----------
  const initial = pageData().call_id;
  load().then(() => {
    if (initial) { history.replaceState(null, '', '/history'); open(initial); }
  });
})();
