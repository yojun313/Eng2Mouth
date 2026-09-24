(function () {
  'use strict';
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
  document.querySelectorAll('.reveal:not(.in)').forEach((el) => io.observe(el));
  const caps = document.querySelectorAll('#captions span'); let ci = 0;
  if (caps.length) setInterval(() => { caps[ci].classList.remove('show'); ci = (ci + 1) % caps.length; caps[ci].classList.add('show'); }, 3800);
  let t = 222; const timer = document.getElementById('demoTimer');
  if (timer) setInterval(() => { t++; timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }, 1000);
})();
