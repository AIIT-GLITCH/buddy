(function () {
  'use strict';

  var VERSION = '2026-05-20.4';
  var PREFETCH_LIMIT = 18;
  var HOVER_DELAY_MS = 45;
  var MAX_PREFETCH_AGE_MS = 10 * 60 * 1000;
  var likelyPages = [
    '/',
    '/ask-buddy',
    '/apps',
    '/agentic',
    '/lac',
    '/voice2',
    '/weather',
    '/framework',
    '/papers',
    '/shop',
    '/support',
  ];

  var prefetched = new Map();
  var inFlight = new Map();
  var hoverTimers = new WeakMap();
  var linkHints = new Set();

  function supportsFastPath() {
    var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection) return true;
    if (connection.saveData) return false;
    return !/2g/.test(connection.effectiveType || '');
  }

  function normalizeUrl(input) {
    try {
      var url = new URL(input, location.href);
      if (url.origin !== location.origin) return null;
      if (url.username || url.password) return null;
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cdn-cgi/')) return null;
      if (/\.(?:pdf|zip|mp4|webm|mp3|wav|jpg|jpeg|png|gif|svg|ico|css|js|json|xml|txt)$/i.test(url.pathname)) return null;
      url.hash = '';
      if (needsTrailingSlash(url)) url.pathname += '/';
      return url;
    } catch (error) {
      return null;
    }
  }

  function needsTrailingSlash(url) {
    if (url.pathname === '/' || url.pathname.endsWith('/')) return false;
    return !/\.[a-z0-9]{2,5}$/i.test(url.pathname);
  }

  function linkUrl(anchor) {
    if (!anchor) return null;
    var href = anchor.getAttribute('href');
    if (!href || href[0] === '#') return null;
    if (/^(?:mailto|tel|sms|javascript):/i.test(href)) return null;
    if (anchor.target && anchor.target !== '_self') return null;
    if (anchor.hasAttribute('download') || anchor.dataset.noPrefetch === 'true') return null;

    var url = normalizeUrl(anchor.href);
    if (!url) return null;
    if (url.pathname === location.pathname && url.search === location.search) return null;
    return url;
  }

  function touchTimestamp(url) {
    prefetched.set(url.href, Date.now());
    if (prefetched.size <= PREFETCH_LIMIT) return;
    var oldestKey = null;
    var oldestValue = Infinity;
    prefetched.forEach(function (value, key) {
      if (value < oldestValue) {
        oldestValue = value;
        oldestKey = key;
      }
    });
    if (oldestKey) prefetched.delete(oldestKey);
  }

  function alreadyFresh(url) {
    var seenAt = prefetched.get(url.href);
    return seenAt && Date.now() - seenAt < MAX_PREFETCH_AGE_MS;
  }

  function addLinkHint(url) {
    if (linkHints.has(url.href)) return;
    linkHints.add(url.href);
    var link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url.href;
    link.as = 'document';
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }

  function prefetchUrl(url, reason) {
    if (!url || !supportsFastPath()) return Promise.resolve(false);
    if (alreadyFresh(url)) return Promise.resolve(true);
    if (inFlight.has(url.href)) return inFlight.get(url.href);

    addLinkHint(url);

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeout = controller ? setTimeout(function () { controller.abort(); }, 6000) : null;
    var request = fetch(url.href, {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'X-AIIT-Prefetch': reason || 'intent',
      },
      priority: reason === 'mousedown' ? 'high' : 'low',
      signal: controller ? controller.signal : undefined,
    })
      .then(function (response) {
        if (response && response.ok) {
          touchTimestamp(url);
          return true;
        }
        return false;
      })
      .catch(function () { return false; })
      .finally(function () {
        if (timeout) clearTimeout(timeout);
        inFlight.delete(url.href);
      });

    inFlight.set(url.href, request);
    return request;
  }

  function scheduleHover(anchor) {
    if (hoverTimers.has(anchor)) return;
    var timer = setTimeout(function () {
      hoverTimers.delete(anchor);
      prefetchUrl(linkUrl(anchor), 'hover');
    }, HOVER_DELAY_MS);
    hoverTimers.set(anchor, timer);
  }

  function cancelHover(anchor) {
    var timer = hoverTimers.get(anchor);
    if (!timer) return;
    clearTimeout(timer);
    hoverTimers.delete(anchor);
  }

  function anchorFromEvent(event) {
    return event.target && event.target.closest ? event.target.closest('a[href]') : null;
  }

  function warmLikelyPages() {
    if (!supportsFastPath()) return;
    var queue = likelyPages
      .map(normalizeUrl)
      .filter(Boolean)
      .filter(function (url) {
        return !(url.pathname === location.pathname && url.search === location.search);
      });

    var run = function () {
      var next = queue.shift();
      if (!next) return;
      prefetchUrl(next, 'idle').finally(function () {
        setTimeout(run, 180);
      });
    };

    if ('requestIdleCallback' in window) {
      requestIdleCallback(run, { timeout: 2500 });
    } else {
      setTimeout(run, 1000);
    }
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(function (registration) {
          if (registration && registration.active) {
            registration.active.postMessage({ type: 'AIIT_SNAPPY_VERSION', version: VERSION });
          }
        })
        .catch(function () {});
    }, { once: true });
  }

  document.addEventListener('pointerenter', function (event) {
    var anchor = anchorFromEvent(event);
    if (anchor) scheduleHover(anchor);
  }, true);

  document.addEventListener('pointerleave', function (event) {
    var anchor = anchorFromEvent(event);
    if (anchor) cancelHover(anchor);
  }, true);

  document.addEventListener('focusin', function (event) {
    prefetchUrl(linkUrl(anchorFromEvent(event)), 'focus');
  }, true);

  document.addEventListener('touchstart', function (event) {
    prefetchUrl(linkUrl(anchorFromEvent(event)), 'touch');
  }, { capture: true, passive: true });

  document.addEventListener('mousedown', function (event) {
    if (event.button !== 0) return;
    prefetchUrl(linkUrl(anchorFromEvent(event)), 'mousedown');
  }, true);

  registerServiceWorker();
  warmLikelyPages();
})();
