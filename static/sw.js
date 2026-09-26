// Eng2Mouth — 서비스 워커는 더 이상 쓰지 않는다. 정적 파일은 ?v= 주소 + 1년 immutable HTTP 캐시로 충분하다 (prompts/10).
// 예전에 설치된 워커가 남아 있는 기기를 위해: 캐시를 모두 지우고 스스로 해제한 뒤 열린 페이지를 한 번 새로 고친다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
  })());
});
