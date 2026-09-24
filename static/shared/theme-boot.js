// 첫 페인트 전에 저장된 테마를 적용한다 (CSP 때문에 인라인 대신 파일, defer 없이 <head> 맨 위에서).
(function(){try{
  var d=document.documentElement, s=localStorage.getItem('e2m_theme_style'), m=localStorage.getItem('theme');
  if(s&&s!=='default') d.setAttribute('data-ui-theme',s);
  if(m!=='light'&&m!=='dark') m=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';   // 처음엔 OS 설정
  if(m==='light') d.setAttribute('data-ui-theme-mode','light'); else d.classList.add('dark');
  d.style.colorScheme=m;
  if(navigator.standalone||matchMedia('(display-mode: standalone)').matches) d.classList.add('standalone');
}catch(e){}})();
