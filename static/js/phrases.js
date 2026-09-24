(function () {
  'use strict';
  const { api, toast, esc, confirmSheet, actionSheet, openSheet, closeSheet, attachLongPress, bindDraft, isComposing } = window.AppUI;
  let items = [], filter = '', q = '';
  async function load() { const d = await api(`/api/phrases?learned=${filter}&q=${encodeURIComponent(q)}`); items = d.items; render(d.total); api('/api/stats/badge').then((b) => document.getElementById('cntDue').textContent = b.phrase_due || '').catch(() => {}); }
  function render(total) {
    document.getElementById('countLine').textContent = `${items.length}개 표시 · 전체 ${total ?? items.length}개`;
    document.getElementById('list').innerHTML = items.map((p) => `
      <div class="phrase-item glass rounded-2xl p-4 ${p.learned ? 'opacity-70' : ''}" data-id="${p.id}">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0"><p class="font-bold text-[15px] leading-snug select-text">${esc(p.phrase)}</p>${p.meaning_ko ? `<p class="text-xs text-white/60 mt-0.5 select-text">${esc(p.meaning_ko)}</p>` : ''}${p.example ? `<p class="text-[12px] text-white/45 italic mt-1 select-text">“${esc(p.example)}”</p>` : ''}</div>
          <span class="chip flex-shrink-0 ${p.kind === 'correction' ? 'text-red-200 border-red-400/30 bg-red-500/10' : 'text-blue-200 border-blue-400/30 bg-blue-500/10'}">${p.kind === 'correction' ? '교정' : '표현'}</span>
        </div>
        <div class="flex items-center gap-1 mt-2 text-[11px]">
          <button class="speak px-2 py-2 rounded-lg text-white/50 hover:text-white" data-text="${esc(p.phrase)}"><i class="fas fa-volume-high mr-1"></i>듣기</button>
          <button class="learn px-2 py-2 rounded-lg ${p.learned ? 'text-emerald-300' : 'text-white/50 hover:text-white'}" data-id="${p.id}" data-learned="${p.learned}"><i class="fas ${p.learned ? 'fa-circle-check' : 'fa-circle'} mr-1"></i>${p.learned ? '익힘' : '익혔어요'}</button>
          ${p.source_call_id ? `<a href="/history/${p.source_call_id}" class="px-2 py-2 rounded-lg text-white/40 hover:text-white no-lp"><i class="fas fa-phone mr-1"></i>통화</a>` : ''}
          <button class="more ml-auto icon-btn w-9 h-9 border-0 bg-transparent" data-id="${p.id}" aria-label="더 보기"><i class="fas fa-ellipsis"></i></button>
        </div>
      </div>`).join('') || '<div class="col-span-full text-center text-white/35 text-sm py-16"><i class="far fa-bookmark text-4xl mb-3 opacity-40 block"></i>저장된 표현이 없습니다.<br>통화 리포트에서 "표현 노트에 저장"을 눌러보세요.</div>';
    document.querySelectorAll('.speak').forEach((b) => b.addEventListener('click', () => speak(b)));
    document.querySelectorAll('.learn').forEach((b) => b.addEventListener('click', async () => { const v = b.dataset.learned !== 'true'; await api(`/api/phrases/${b.dataset.id}`, { method: 'PATCH', body: { learned: v } }); load(); }));
    document.querySelectorAll('.more').forEach((b) => b.addEventListener('click', () => menu(items.find((x) => x.id === b.dataset.id))));
  }
  function menu(p) {
    if (!p) return;
    actionSheet({ title: p.phrase, subtitle: p.meaning_ko, actions: [
      { icon: 'fa-volume-high', label: '듣기', onClick: () => speak(document.querySelector(`.speak[data-text="${CSS.escape(p.phrase)}"]`) || { dataset: { text: p.phrase }, innerHTML: '' }) },
      { icon: p.learned ? 'fa-rotate' : 'fa-circle-check', label: p.learned ? '다시 복습하기' : '익혔어요', onClick: async () => { await api(`/api/phrases/${p.id}`, { method: 'PATCH', body: { learned: !p.learned } }); load(); } },
      'sep',
      { icon: 'fa-trash', label: '삭제', danger: true, onClick: async () => { if (await confirmSheet({ title: '표현 삭제', message: `"${p.phrase}" 을(를) 삭제할까요?`, confirmLabel: '삭제', danger: true })) { await api(`/api/phrases/${p.id}`, { method: 'DELETE' }); toast('삭제했어요'); load(); } } },
    ] });
  }
  attachLongPress(document.getElementById('list'), '.phrase-item', (el) => menu(items.find((x) => x.id === el.dataset.id)));
  async function speak(b) {
    const orig = b.innerHTML; if (b.tagName) b.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    try { const res = await fetch('/api/assist/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: b.dataset.text }) }); if (!res.ok) throw new Error((await res.json()).detail); const a = new Audio(URL.createObjectURL(await res.blob())); a.onended = () => URL.revokeObjectURL(a.src); a.play(); }
    catch (e) { toast(e.message || '재생 실패', false); } finally { if (b.tagName) b.innerHTML = orig; }
  }
  document.getElementById('q').addEventListener('input', (e) => { q = e.target.value.trim(); load(); });
  document.querySelectorAll('#seg button').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.v; document.querySelectorAll('#seg button').forEach((x) => x.classList.toggle('active', x === b)); load(); }));
  const addPhrase = document.getElementById('addPhrase'), addMeaning = document.getElementById('addMeaning');
  const clearA = bindDraft(addPhrase, 'phrase-add'), clearB = bindDraft(addMeaning, 'phrase-add-meaning');
  [addPhrase, addMeaning].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && isComposing(e)) e.preventDefault(); }));
  document.getElementById('addForm').addEventListener('submit', async (e) => { e.preventDefault(); try { await api('/api/phrases', { method: 'POST', body: { phrase: addPhrase.value, meaning_ko: addMeaning.value } }); addPhrase.value = ''; addMeaning.value = ''; clearA(); clearB(); toast('추가했어요'); load(); } catch (err) { toast(err.message, false); } });

  // ---- 복습 퀴즈 (시트 안 플래시카드) ----
  let quiz = [], qi = 0;
  document.getElementById('quizBtn').addEventListener('click', async () => {
    const d = await api('/api/phrases?learned=0'); quiz = d.items.filter((p) => p.meaning_ko).sort(() => Math.random() - .5).slice(0, 10); qi = 0;
    if (!quiz.length) { toast('복습할 표현(뜻이 있는)이 없어요', false); return; }
    openSheet('<div class="sheet-head"><div><h3><i class="fas fa-graduation-cap text-purple-300 mr-2"></i>복습 퀴즈</h3></div><button type="button" class="sheet-close" aria-label="닫기">&times;</button></div><div id="quizBody" class="pb-2"></div>', (root) => { root.querySelector('.sheet-close').addEventListener('click', () => closeSheet()); showCard(root.querySelector('#quizBody')); }, () => load());
  });
  function showCard(body) {
    if (qi >= quiz.length) { body.innerHTML = `<div class="text-center py-6"><i class="fas fa-trophy text-4xl text-amber-300 mb-3"></i><p class="font-bold">오늘 복습 완료!</p><p class="text-xs opacity-60 mt-1">${quiz.length}개를 돌아봤어요.</p><button type="button" class="btn-glow px-5 py-3 rounded-xl text-sm font-bold mt-4 quiz-done">닫기</button></div>`; body.querySelector('.quiz-done').addEventListener('click', () => closeSheet()); return; }
    const p = quiz[qi];
    body.innerHTML = `<p class="text-[11px] opacity-50 mb-2">${qi + 1} / ${quiz.length}</p>
      <div class="glass rounded-2xl p-6 text-center min-h-[150px] flex flex-col items-center justify-center">
        <p class="text-xs opacity-60 mb-2">이 뜻을 영어로 말해보세요</p><p class="text-lg font-bold">${esc(p.meaning_ko)}</p>
        <div class="answer hidden mt-4 border-t border-white/10 pt-4 w-full"><p class="text-xl font-extrabold text-emerald-300">${esc(p.phrase)}</p>${p.example ? `<p class="text-xs opacity-60 italic mt-1">“${esc(p.example)}”</p>` : ''}<button type="button" class="speak text-xs opacity-70 hover:opacity-100 mt-2 px-3 py-2" data-text="${esc(p.phrase)}"><i class="fas fa-volume-high mr-1"></i>듣기</button></div>
      </div>
      <div class="grid grid-cols-2 gap-2 mt-4 quiz-actions"><button type="button" class="btn-glow py-3 rounded-xl text-sm font-bold col-span-2 reveal">정답 보기</button></div>`;
    body.querySelector('.reveal').addEventListener('click', () => {
      body.querySelector('.answer').classList.remove('hidden'); body.querySelector('.speak').addEventListener('click', (e) => speak(e.currentTarget));
      const acts = body.querySelector('.quiz-actions'); acts.innerHTML = '<button type="button" class="btn-ghost py-3 rounded-xl text-sm font-bold again"><i class="fas fa-rotate mr-1"></i>다시 볼래요</button><button type="button" class="btn-call py-3 rounded-xl text-sm font-bold got"><i class="fas fa-check mr-1"></i>익혔어요</button>';
      acts.querySelector('.again').addEventListener('click', () => { qi++; showCard(body); });
      acts.querySelector('.got').addEventListener('click', async () => { await api(`/api/phrases/${p.id}`, { method: 'PATCH', body: { learned: true } }); qi++; showCard(body); });
    });
  }
  load().catch((e) => toast(e.message, false));
})();
