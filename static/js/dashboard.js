(function () {
  'use strict';
  const { api, swr, swrInvalidate, toast, esc, fmtDur, fmtDate, scoreColor, pageData, bindDraft, isComposing } = window.AppUI;
  const D = pageData();
  const PERSONAS = D.personas || [];
  let currentPersona = D.persona;
  const hasKey = !!D.has_key;
  let lastStats = null;

  (function greet() {
    const h = new Date().getHours();
    document.getElementById('greetLine').textContent = h < 5 ? 'Late night session 🌙' : h < 12 ? 'Good morning ☀️' : h < 18 ? 'Good afternoon 🌤️' : 'Good evening 🌆';
  })();

  function renderPersonas() {
    const row = document.getElementById('personaRow');
    row.innerHTML = PERSONAS.map((p) => `
      <button type="button" data-id="${p.id}" class="persona-card glass rounded-2xl p-3 text-left flex-shrink-0 w-[132px] md:w-auto border ${p.id === currentPersona ? 'selected' : ''}">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-br ${p.gradient} flex items-center justify-center text-xl shadow-lg mb-2">${p.emoji}</div>
        <p class="text-sm font-bold truncate">${esc(p.name)}</p>
        <p class="text-[10px] text-white/45 truncate">${esc(p.title)}</p>
      </button>`).join('');
    row.querySelectorAll('.persona-card').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.id;
      if (id === 'custom' && !D.has_custom) { location.href = '/settings#persona'; return; }
      currentPersona = id;
      row.querySelectorAll('.persona-card').forEach((x) => x.classList.toggle('selected', x.dataset.id === id));
      try { await api('/api/settings', { method: 'POST', body: { persona: id } }); const p = PERSONAS.find((x) => x.id === id); toast(`이제 ${p.name}(${p.title})와 통화합니다`); } catch (e) { toast(e.message, false); }
    }));
  }
  renderPersonas();

  function topicCard(t, kind, done) {
    return `<a href="/call?kind=${kind}&id=${encodeURIComponent(t.id)}" class="topic-card glass-soft rounded-2xl p-3 relative block ${done ? 'done' : ''}">
      <div class="text-2xl mb-1.5">${t.emoji || '💬'}</div>
      <p class="text-sm font-bold leading-snug line-clamp-2">${esc(t.title_ko || t.title)}</p>
      <p class="text-[10px] text-white/40 mt-0.5 truncate">${esc(t.title)}</p>
      <span class="chip mt-2 text-white/50">${esc(t.category_label || '추천')}</span>
    </a>`;
  }

  async function loadTopics() {
    try {
      await swr('/api/topics/today', (d) => {
      document.getElementById('todayDate').textContent = d.date;
      const done = new Set(d.done_ids || []);
      document.getElementById('dailyTopics').innerHTML = d.daily.map((t) => topicCard(t, 'topic', done.has(t.id))).join('');
      const s = d.scenario_of_day;
      document.getElementById('scenarioOfDay').innerHTML = `
        <a href="/call?kind=scenario&id=${s.id}" class="topic-card glass-soft rounded-2xl p-3 flex items-center gap-3 border border-purple-400/20 hover:border-purple-400/50 row-cell">
          <div class="w-11 h-11 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-2xl flex-shrink-0">${s.emoji}</div>
          <div class="min-w-0 flex-1"><p class="text-[10px] font-bold text-purple-300 uppercase">오늘의 롤플레이</p><p class="text-sm font-bold truncate">${esc(s.title_ko)} <span class="text-white/40 font-normal">· ${esc(s.title)}</span></p><p class="text-[11px] text-white/45 truncate">${esc(s.description_ko)}</p></div>
          <i class="fas fa-phone text-emerald-400"></i>
        </a>`;
      if (d.personal && d.personal.length) document.getElementById('personalTopics').innerHTML = d.personal.map((t) => topicCard(t, 'personal', done.has(t.id))).join('');
      });
    } catch (e) { console.error(e); }
  }
  loadTopics();

  document.getElementById('refreshPersonalBtn').addEventListener('click', async (e) => {
    if (!hasKey) { toast('먼저 설정에서 API Key를 등록해 주세요.', false, 4000, { label: '설정', onClick: () => location.href = '/settings#api' }); return; }
    const btn = e.currentTarget; btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>생성 중...';
    document.getElementById('personalTopics').innerHTML = '<p class="col-span-full text-xs text-white/40 py-6 text-center"><i class="fas fa-spinner fa-spin mr-2"></i>내 기록을 바탕으로 주제를 만들고 있어요...</p>';
    try { const d = await api('/api/topics/personal/refresh', { method: 'POST' }); swrInvalidate('/api/topics'); document.getElementById('personalTopics').innerHTML = d.topics.map((t) => topicCard(t, 'personal', false)).join(''); toast('새 주제가 준비됐어요!'); }
    catch (err) { toast(err.message, false); document.getElementById('personalTopics').innerHTML = `<p class="col-span-full text-xs text-red-300 py-4 text-center">${esc(err.message)}</p>`; }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-rotate mr-1"></i>새로 추천받기'; }
  });

  // 직접 입력: 초안 유지 · 한글 조합 중 Enter 무시
  const customInput = document.getElementById('customTopicInput');
  const clearDraft = bindDraft(customInput, 'custom-topic');
  customInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && isComposing(e)) e.preventDefault(); });
  document.getElementById('customTopicForm').addEventListener('submit', (e) => {
    e.preventDefault(); const v = customInput.value.trim(); if (!v) return;
    clearDraft(); location.href = `/call?kind=custom&title=${encodeURIComponent(v)}`;
  });

  const isLight = () => document.documentElement.getAttribute('data-ui-theme-mode') === 'light';
  function renderCharts(s) {
    const max = Math.max(1, ...s.last14.map((d) => d.min));
    document.getElementById('minutesChart').innerHTML = s.last14.map((d, i) => {
      const h = Math.max(d.min > 0 ? 6 : 2, Math.round(d.min / max * 100));
      const isToday = i === s.last14.length - 1;
      return `<div class="flex-1 h-full flex items-end group relative" title="${d.date}: ${d.min}분 · ${d.calls}통화">
        <div class="w-full rounded-t-[4px] ${isToday ? 'bg-emerald-400' : 'bg-blue-400/70'} group-hover:bg-emerald-300 transition" style="height:${h}%"></div>
        <div class="absolute -top-7 left-1/2 -translate-x-1/2 glass-strong text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap">${d.min}분</div>
      </div>`;
    }).join('');
    document.getElementById('chartStart').textContent = s.last14[0].date.slice(5);
    if (s.trend.length >= 2) {
      document.getElementById('trendEmpty').classList.add('hidden');
      const W = 300, H = 110, pad = 12, grid = isLight() ? 'rgba(15,23,42,.10)' : 'rgba(148,163,184,.15)', dotBg = isLight() ? '#eef0f9' : '#05070f', label = isLight() ? '#1d4ed8' : '#bfdbfe';
      const xs = s.trend.map((_, i) => pad + i * (W - pad * 2) / (s.trend.length - 1));
      const ys = s.trend.map((t) => H - pad - (t.overall / 100) * (H - pad * 2));
      const path = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
      const area = `${path} L${xs[xs.length - 1].toFixed(1)},${H - pad} L${xs[0].toFixed(1)},${H - pad} Z`;
      document.getElementById('trendSvg').innerHTML = `
        <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#60a5fa" stop-opacity=".35"/><stop offset="100%" stop-color="#60a5fa" stop-opacity="0"/></linearGradient></defs>
        ${[25, 50, 75].map((g) => `<line x1="${pad}" x2="${W - pad}" y1="${H - pad - g / 100 * (H - pad * 2)}" y2="${H - pad - g / 100 * (H - pad * 2)}" stroke="${grid}" stroke-dasharray="2 3"/>`).join('')}
        <path d="${area}" fill="url(#ga)"/>
        <path d="${path}" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
        ${xs.map((x, i) => `<a href="/history/${s.trend[i].id}"><circle cx="${x}" cy="${ys[i]}" r="4" fill="${dotBg}" stroke="#60a5fa" stroke-width="2"><title>${esc(s.trend[i].title || '')}: ${s.trend[i].overall}점 (${s.trend[i].cefr})</title></circle></a>`).join('')}
        <text x="${xs[xs.length - 1]}" y="${Math.max(10, ys[ys.length - 1] - 8)}" text-anchor="end" font-size="10" fill="${label}" font-weight="700">${s.trend[s.trend.length - 1].overall}</text>`;
    }
  }
  addEventListener('e2m-theme-change', () => { if (lastStats) renderCharts(lastStats); });

  async function loadStats() {
    try {
      await swr('/api/stats/dashboard', (s) => { lastStats = s;
      if (s.streak > 0) { document.getElementById('streakBadge').classList.remove('hidden'); document.getElementById('streakVal').textContent = s.streak; }
      document.getElementById('todayMin').textContent = s.today_min;
      document.getElementById('goalMin').textContent = s.daily_goal_min;
      document.getElementById('goalRing').style.strokeDashoffset = 264 - 264 * (s.goal_pct / 100);
      const left = Math.max(0, s.daily_goal_min - s.today_min);
      document.getElementById('heroSub').innerHTML = left <= 0 ? '🎉 오늘 목표를 달성했어요! 한 통화 더 하면 실력이 쑥쑥.' : `오늘 목표까지 <b class="text-white/85">${left.toFixed(left % 1 ? 1 : 0)}분</b> 남았어요.`;
      document.getElementById('weekMin').textContent = s.week_min;
      document.getElementById('totalCalls').textContent = s.total_calls;
      document.getElementById('avgScore').textContent = s.avg_score ?? '—';
      document.getElementById('phraseCount').textContent = s.phrase_count;
      renderCharts(s);
      });
    } catch (e) { console.error(e); }
  }
  loadStats();

  async function loadRecent() {
    try {
      await swr('/api/calls?limit=5', (d) => {
      if (!d.items.length) return;
      document.getElementById('recentCalls').innerHTML = d.items.map((c) => `
        <a href="/history/${c.id}" class="flex items-center gap-3 glass-soft rounded-xl p-2.5 hover:bg-white/5 transition row-cell">
          <div class="w-9 h-9 rounded-lg bg-gradient-to-br ${c.persona?.gradient || 'from-blue-500 to-purple-500'} flex items-center justify-center text-lg flex-shrink-0">${c.persona?.emoji || '📞'}</div>
          <div class="min-w-0 flex-1"><p class="text-xs font-bold truncate">${esc(c.topic?.title_ko || c.topic?.title || '통화')}</p><p class="text-[10px] text-white/40">${fmtDate(c.started_at)} · ${fmtDur(c.duration_sec)} · ${esc(c.persona?.name || '')}</p></div>
          ${c.overall != null ? `<span class="text-sm font-extrabold tabular" style="color:${scoreColor(c.overall)}">${c.overall}</span>` : '<span class="status-dot warn" title="미평가"></span>'}
        </a>`).join('');
      });
    } catch (e) { console.error(e); }
  }
  loadRecent();

  document.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      if (e.code === 'KeyC') location.href = '/call';
      if (e.code === 'KeyH') location.href = '/history';
      if (e.code === 'KeyS') location.href = '/settings';
    }
  });
})();
