const CACHE_NAME = 'accountbook-v8';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json'
]; // 不缓存 CDN 资源，避免 CDN 挂了导致 SW 安装失败

// 强制安装时删除所有旧缓存（包括 v5/v6/v7）
self.addEventListener('install', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => {
      return caches.open(CACHE_NAME).then(cache => {
        return cache.addAll(ASSETS);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        if (response.ok && (event.request.url.startsWith('http'))) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
