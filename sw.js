var CACHE = 'maga-v1';
var PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './app.js',
  './styles.css',
  './i18n.js',
  'https://cdn.tailwindcss.com'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) {
        return Promise.allSettled(PRECACHE.map(function (url) {
          return caches.match(url).then(function (hit) {
            return hit || cache.add(url);
          });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys.filter(function (k) { return k !== CACHE; })
            .map(function (k) { return caches.delete(k); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);

  if (url.origin === location.origin && url.pathname.indexOf('/api/') === 0) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(request, copy); });
          return res;
        })
        .catch(function () { return caches.match('./index.html'); })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(request, copy); });
        }
        return res;
      });
    })
  );
});
