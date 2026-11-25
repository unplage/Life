// sw.js - Life PWA service worker
// Cache names are derived from the deployment path so multiple GitHub Pages
// projects on the same origin cannot delete or read each other's caches.
const BASE_PATH = self.location.pathname.replace(/[^/]+$/, '');
const PROJECT_NAME = BASE_PATH.replace(/\/+$/, '').split('/').filter(Boolean).pop() || 'root';
const PROJECT_CACHE_PREFIX = `pwa-cache-${PROJECT_NAME}--`;
const CACHE_NAME = `${PROJECT_CACHE_PREFIX}v14`;
const PRECACHE_URLS = [
  BASE_PATH,
  `${BASE_PATH}index.html`,
  `${BASE_PATH}manifest.json`,
  `${BASE_PATH}health.js`,
  `${BASE_PATH}health-links.json`,
  `${BASE_PATH}offline.html`,
  `${BASE_PATH}echarts.min.js`,
  `${BASE_PATH}icon-192.png`,
  `${BASE_PATH}icon-512.png`,
  `${BASE_PATH}icon-maskable-192.png`,
  `${BASE_PATH}icon-maskable-512.png`,
  `${BASE_PATH}apple-touch-icon.png`,
  `${BASE_PATH}favicon-32.png`,
  `${BASE_PATH}icon.svg`,
  `${BASE_PATH}icon-maskable.svg`,
];
const STATIC_EXTENSIONS = ['js', 'css', 'json', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'woff', 'woff2', 'ttf', 'eot', 'ico'];

function isStaticResource(url) {
  const name = url.pathname.split('/').pop().split('?')[0].toLowerCase();
  return STATIC_EXTENSIONS.includes(name.split('.').pop());
}
function isNavigateRequest(request) {
  return request.mode === 'navigate' || (request.method === 'GET' && request.destination === 'document');
}
function projectCache() { return caches.open(CACHE_NAME); }

self.addEventListener('install', event => {
  event.waitUntil(
    projectCache()
      .then(cache => Promise.allSettled(PRECACHE_URLS.map(url => cache.add(url).catch(err => console.warn(`预缓存失败 ${url}:`, err)))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.map(name => {
        if (name.startsWith(PROJECT_CACHE_PREFIX) && name !== CACHE_NAME) return caches.delete(name);
        return undefined;
      })))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const hash = typeof data.hash === 'string' && data.hash.startsWith('#') ? data.hash : '#me';
  const target = BASE_PATH + hash;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async list => {
      for (const client of list) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) { try { await client.navigate(target); } catch {} }
          return;
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== location.origin || request.method !== 'GET') return;

  if (url.pathname.endsWith('/health-links.json')) {
    event.respondWith((async () => {
      const cache = await projectCache();
      const cached = await cache.match(request);
      const network = fetch(request).then(response => {
        if (response && response.status === 200) cache.put(request, response.clone());
        return response;
      }).catch(() => cached);
      return cached || network;
    })());
    return;
  }

  if (isNavigateRequest(request)) {
    event.respondWith((async () => {
      const cache = await projectCache();
      try {
        const response = await fetch(request);
        if (response && response.status === 200) cache.put(request, response.clone());
        return response;
      } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        const index = await cache.match(`${BASE_PATH}index.html`);
        if (index) return index;
        const offline = await cache.match(`${BASE_PATH}offline.html`);
        if (offline) return offline;
        return new Response('<h1>📴 离线状态</h1><p>请检查网络连接后刷新页面。</p>', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  if (isStaticResource(url)) {
    event.respondWith((async () => {
      const cache = await projectCache();
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response && response.status === 200) cache.put(request, response.clone());
        return response;
      } catch {
        return new Response('', { status: 408 });
      }
    })());
  }
});
