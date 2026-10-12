/* GitHub Pages 하위 경로에서도 동작하도록, 워커 파일 위치를 기준으로 범위를 잡습니다.
   프리캐시 목록은 빌드가 dist/precache-manifest.js 로 넣습니다. */
const CACHE = 'homenote-shell-v4';
const SCOPE_URL = new URL('./', self.location);

importScripts('./precache-manifest.js');

const PRECACHE = Array.isArray(self.__NB_PRECACHE__) ? self.__NB_PRECACHE__ : [];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (!url.pathname.startsWith(SCOPE_URL.pathname)) return;

    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        try {
            const response = await fetch(request);
            if (response && response.ok && response.type === 'basic') {
                cache.put(request, response.clone());
            }
            return response;
        } catch {
            const cached = await cache.match(request) || await cache.match(url.pathname.replace(SCOPE_URL.pathname, './'));
            if (cached) return cached;
            if (request.mode === 'navigate') {
                return (await cache.match('./index.html')) || (await cache.match('./'));
            }
            return new Response('오프라인입니다.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }
    })());
});
