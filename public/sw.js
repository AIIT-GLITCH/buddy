'use strict';

var VERSION = '2026-07-10.04';
var STATIC_CACHE = 'aiit-static-' + VERSION;
var PAGE_CACHE = 'aiit-pages-' + VERSION;
var RUNTIME_CACHE = 'aiit-runtime-' + VERSION;
var MAX_PAGE_ENTRIES = 64;
var MAX_RUNTIME_ENTRIES = 96;
var CORE_ASSETS = [
  '/snappy-nav.js',
  '/paper-game-sync.js',
  '/favicon.ico',
  '/buddy-icon-64.png',
  '/buddy-icon-192.png',
  '/buddy-icon-512.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(function (cache) {
        return Promise.all(CORE_ASSETS.map(function (url) {
          return cache.add(url).catch(function () {});
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names.map(function (name) {
          if (name === STATIC_CACHE || name === PAGE_CACHE || name === RUNTIME_CACHE) return null;
          if (/^aiit-(?:static|pages|runtime)-/.test(name)) return caches.delete(name);
          return null;
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  if (!event.data || event.data.type !== 'AIIT_SNAPPY_VERSION') return;
  VERSION = event.data.version || VERSION;
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (!request || request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cdn-cgi/')) return;

  if (isHtmlRequest(request, url)) {
    event.respondWith(networkFirstPage(request));
    return;
  }

  if (isRuntimeAsset(request, url)) {
    event.respondWith(cacheFirstRuntime(request));
  }
});

function isHtmlRequest(request, url) {
  if (request.mode === 'navigate') return true;
  var accept = request.headers.get('accept') || '';
  if (!accept.includes('text/html')) return false;
  return !/\.[a-z0-9]{2,5}$/i.test(url.pathname) || /\.html$/i.test(url.pathname);
}

function isRuntimeAsset(request, url) {
  if (url.pathname.startsWith('/papers/') || url.pathname.startsWith('/letters/')) return false;
  if (/\.(?:pdf|zip|mp4|webm|mp3|wav)$/i.test(url.pathname)) return false;
  if (url.pathname.startsWith('/_astro/')) return true;
  if (['script', 'style', 'font', 'image'].includes(request.destination)) return true;
  return /\.(?:js|css|woff2?|png|jpg|jpeg|gif|svg|ico)$/i.test(url.pathname);
}

function canonicalPageUrl(request) {
  var url = new URL(request.url);
  url.hash = '';
  if (needsTrailingSlash(url)) url.pathname += '/';
  return url;
}

function needsTrailingSlash(url) {
  if (url.pathname === '/' || url.pathname.endsWith('/')) return false;
  return !/\.[a-z0-9]{2,5}$/i.test(url.pathname);
}

function cleanRequestUrl(request, url) {
  url = url || new URL(request.url);
  return new Request(url.href, {
    method: 'GET',
    headers: request.headers,
    mode: request.mode === 'navigate' ? 'same-origin' : request.mode,
    credentials: request.credentials,
    redirect: 'follow',
  });
}

function networkFirstPage(request) {
  var pageUrl = canonicalPageUrl(request);
  var cleanRequest = cleanRequestUrl(request, pageUrl);
  return caches.open(PAGE_CACHE).then(function (cache) {
    return fetch(cleanRequest)
      .then(function (response) {
        if (canCache(response)) {
          cache.put(cleanRequest, response.clone());
          trimCache(PAGE_CACHE, MAX_PAGE_ENTRIES);
        }
        return response;
      })
      .catch(function () {
        return cache.match(cleanRequest).then(function (cached) {
          return cached || new Response('Offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        });
    });
  });
}

function cacheFirstRuntime(request) {
  var cleanRequest = cleanRequestUrl(request);
  return caches.open(RUNTIME_CACHE).then(function (cache) {
    return cache.match(cleanRequest).then(function (cached) {
      if (cached) return cached;
      return fetch(cleanRequest).then(function (response) {
        if (canCache(response)) {
          cache.put(cleanRequest, response.clone());
          trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES);
        }
        return response;
      });
    });
  });
}

function canCache(response) {
  if (!response || !response.ok) return false;
  if (response.type !== 'basic') return false;
  var cc = response.headers.get('cache-control') || '';
  return !/no-store/i.test(cc);
}

function trimCache(cacheName, maxEntries) {
  caches.open(cacheName)
    .then(function (cache) {
      return cache.keys().then(function (keys) {
        if (keys.length <= maxEntries) return null;
        return Promise.all(keys.slice(0, keys.length - maxEntries).map(function (key) {
          return cache.delete(key);
        }));
      });
    })
    .catch(function () {});
}
