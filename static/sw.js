// Eng2Mouth service worker — 홈 화면 설치용 최소 구현. API/통화는 항상 네트워크, 정적 파일만 캐시.
const CACHE = 'e2m-static-v2';
const STATIC = ['/static/shared/app.css', '/static/shared/theme.css', '/static/shared/mobile.css', '/static/vendor/tailwind.css', '/static/vendor/fonts.css',
  '/static/vendor/fontawesome/css/all.min.css', '/static/shared/theme-boot.js', '/static/shared/theme.js', '/static/shared/viewport.js', '/static/shared/ui.js', '/static/shared/app.js',
  '/static/default_avatar.png', '/static/icons/icon-192.png', '/static/icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)).catch(() => null)); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith('/static/')) return;
  // 정적 파일: 네트워크 우선, 실패 시 캐시 (배포 직후 옛 CSS 가 남지 않게)
  e.respondWith(fetch(e.request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; }).catch(() => caches.match(e.request)));
});
