/* GitHub Pages 하위 경로에서도 동작하도록, 워커 파일 위치를 기준으로 범위를 잡습니다. */
const CACHE = 'homenote-shell-v3';
const SCOPE_URL = new URL('./', self.location);

const PRECACHE = [
    './',
    './index.html',
    './manifest.webmanifest',
    './fonts/fonts.css',
    './fonts/PretendardVariable.woff2',
    './fonts/HakgyoansimDunggeunmiso-R.woff2',
    './fonts/HakgyoansimGeurimilgi.woff2',
    './icon-192.png',
    './icon-512.png',
];

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
            const cached = await cache.match(request);
            if (cached) return cached;
            if (request.mode === 'navigate') {
                return (await cache.match('./index.html')) || (await cache.match('./'));
            }
            return new Response('오프라인입니다.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }
    })());
});
