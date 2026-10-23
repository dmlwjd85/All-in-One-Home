/* 설치한 앱이 같은 주소의 sw.js 를 받아 갈아타도록 파일 이름을 유지합니다.
   프리캐시 목록은 빌드가 dist/precache-manifest.js 로 넣습니다.
   로컬 저장은 지우지 않습니다.
   GitHub Pages는 HTML에 max-age=600을 붙입니다. 페이지와 미리 저장은
   cache:'no-cache'로 받아서, 브라우저가 10분짜리 사본을 새 파일인 것처럼 쓰지 않게 합니다.
   목록 주소에도 캐시 이름을 붙입니다. 예전 등록은 importScripts 만 HTTP 캐시를 보므로,
   같은 주소의 옛 목록을 읽으면 없는 파일로 설치가 실패합니다. */
const CACHE = 'ssug-gyomu-shell-v7';
const SCOPE_URL = new URL('./', self.location);

importScripts(`./precache-manifest.js?v=${CACHE}`);

const PRECACHE = Array.isArray(self.__NB_PRECACHE__) ? self.__NB_PRECACHE__ : [];

function isPageRequest(request) {
    if (request.mode === 'navigate' || request.destination === 'document') return true;
    const path = new URL(request.url).pathname;
    return path.endsWith('/') || path.endsWith('.html');
}

async function storeResponse(response) {
    if (!response.redirected) return response;
    return new Response(await response.blob(), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
}

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then(async (cache) => {
        await Promise.all(PRECACHE.map(async (url) => {
            const response = await fetch(new Request(url, { cache: 'no-cache' }));
            if (!response || !response.ok) throw new Error(url);
            await cache.put(url, await storeResponse(response));
        }));
    }).then(() => self.skipWaiting()));
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
            const response = isPageRequest(request)
                ? await fetch(request.url, { cache: 'no-cache', credentials: 'same-origin', redirect: 'follow' })
                : await fetch(request);
            if (response && response.ok && response.type === 'basic') {
                const stored = response.redirected
                    ? await storeResponse(response.clone())
                    : response.clone();
                cache.put(request, stored).catch(() => {});
            }
            return response;
        } catch {
            const cached = await cache.match(request) || await cache.match(url.pathname.replace(SCOPE_URL.pathname, './'));
            if (cached) return cached;
            if (request.mode === 'navigate') return (await cache.match('./index.html')) || (await cache.match('./'));
            return new Response('인터넷이 끊겼어요. 잠시 후 다시 열어 주세요.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }
    })());
});
