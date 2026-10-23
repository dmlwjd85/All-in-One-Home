/* 설치한 앱이 같은 주소의 sw.js 를 받아 갈아타도록 파일 이름을 유지합니다.
   프리캐시 목록은 빌드가 dist/precache-manifest.js 로 넣습니다.
   로컬 저장은 지우지 않습니다. */
const CACHE = 'ssug-gyomu-shell-v4';
const SCOPE_URL = new URL('./', self.location);

importScripts('./precache-manifest.js');

const PRECACHE = Array.isArray(self.__NB_PRECACHE__) ? self.__NB_PRECACHE__ : [];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(keys
            .filter((key) => key !== CACHE || key.startsWith('homenote-shell'))
            .map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
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
            if (response && response.ok && response.type === 'basic') cache.put(request, response.clone());
            return response;
        } catch {
            const cached = await cache.match(request) || await cache.match(url.pathname.replace(SCOPE_URL.pathname, './'));
            if (cached) return cached;
            if (request.mode === 'navigate') return (await cache.match('./index.html')) || (await cache.match('./'));
            return new Response('인터넷이 끊겼어요. 잠시 후 다시 열어 주세요.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }
    })());
});
