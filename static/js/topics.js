(function () {
  'use strict';
  const { api, swr, toast, esc } = window.AppUI;
  let all = { topics: [], scenarios: [], categories: {} }, kind = 'topic', cat = '', done = new Set();
  const LEVEL_KO = { beginner: '초급', intermediate: '중급', advanced: '고급' };
  async function load() {
    const paint = () => { document.getElementById('cntTopic').textContent = all.topics.length; document.getElementById('cntScn').textContent = all.scenarios.length; renderCats(); render(); };
    // 캐시 먼저 → 새 데이터가 다르면 다시 (10 §4)
    await Promise.all([swr('/api/topics/all', (d) => { all = d; paint(); }), swr('/api/topics/today', (t) => { done = new Set(t.done_ids || []); if (all.topics.length) render(); })]);
  }
  function renderCats() {
    const row = document.getElementById('catRow');
    if (kind !== 'topic') { row.innerHTML = ''; return; }
    const counts = {}; all.topics.forEach((t) => counts[t.category] = (counts[t.category] || 0) + 1);
    row.innerHTML = [`<button data-cat="" class="chip px-3 py-2 text-[11px] ${cat === '' ? 'bg-blue-500/20 text-blue-200 border-blue-400/40' : 'text-white/60'}">전체 ${all.topics.length}</button>`]
      .concat(Object.entries(all.categories).map(([k, v]) => `<button data-cat="${k}" class="chip px-3 py-2 text-[11px] whitespace-nowrap ${cat === k ? 'bg-blue-500/20 text-blue-200 border-blue-400/40' : 'text-white/60'}">${v} <span class="opacity-60">${counts[k] || 0}</span></button>`)).join('');
    row.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { cat = b.dataset.cat; renderCats(); render(); }));
  }
  function render() {
    const q = document.getElementById('q').value.trim().toLowerCase();
    const grid = document.getElementById('grid');
    if (kind === 'topic') {
      const items = all.topics.filter((t) => (!cat || t.category === cat) && (!q || `${t.title} ${t.title_ko} ${t.description_ko}`.toLowerCase().includes(q)));
      grid.innerHTML = items.map((t) => `
        <a href="/call?kind=topic&id=${t.id}" class="topic-card glass rounded-2xl p-4 relative block ${done.has(t.id) ? 'done' : ''}">
          <div class="text-3xl mb-2">${t.emoji}</div>
          <p class="font-bold leading-snug">${esc(t.title_ko)}</p>
          <p class="text-[11px] text-white/45 mt-0.5">${esc(t.title)}</p>
          <p class="text-xs text-white/55 mt-2 line-clamp-2">${esc(t.description_ko)}</p>
          <span class="chip mt-3 text-white/50">${esc(t.category_label)}</span>
        </a>`).join('') || '<p class="col-span-full text-center text-white/35 text-sm py-10">검색 결과가 없습니다.</p>';
    } else {
      const items = all.scenarios.filter((s) => !q || `${s.title} ${s.title_ko} ${s.description_ko}`.toLowerCase().includes(q));
      grid.innerHTML = items.map((s) => `
        <a href="/call?kind=scenario&id=${s.id}" class="topic-card glass rounded-2xl p-4 relative block ${done.has(s.id) ? 'done' : ''}">
          <div class="flex items-center justify-between"><div class="text-3xl mb-2">${s.emoji}</div><span class="chip text-purple-200 border-purple-400/30 bg-purple-500/10">${LEVEL_KO[s.level] || ''}</span></div>
          <p class="font-bold leading-snug">${esc(s.title_ko)}</p>
          <p class="text-[11px] text-white/45 mt-0.5">${esc(s.title)}</p>
          <p class="text-xs text-white/55 mt-2 line-clamp-2">${esc(s.description_ko)}</p>
          <p class="text-[10px] text-white/40 mt-2 truncate"><i class="fas fa-masks-theater mr-1"></i>AI: ${esc(s.ai_role)}</p>
        </a>`).join('');
    }
  }
  document.getElementById('q').addEventListener('input', render);
  document.querySelectorAll('#kindSeg button').forEach((b) => b.addEventListener('click', () => { kind = b.dataset.kind; document.querySelectorAll('#kindSeg button').forEach((x) => x.classList.toggle('active', x === b)); renderCats(); render(); }));
  load().catch((e) => toast(e.message, false));
})();
