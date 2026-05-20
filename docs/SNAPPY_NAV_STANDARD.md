# Snappy Navigation Standard

Status: active site standard
Date: 2026-05-20

AIIT_SITE uses a McMaster-style navigation performance layer: static HTML stays real, likely pages are warmed before click, and repeat navigations are served from the browser/service-worker cache.

## Required Pieces

- `src/layouts/Layout.astro` must preload and load `/snappy-nav.js` on every normal page.
- `public/snappy-nav.js` owns intent prefetch:
  - idle prefetch for high-traffic routes
  - hover prefetch
  - focus prefetch
  - touchstart prefetch
  - mousedown prefetch
  - service-worker registration
- `public/sw.js` owns runtime caching:
  - static core assets
  - stale-while-revalidate HTML page cache
  - cache-first runtime assets
  - API, download, and large media exclusions
- `public/_headers` owns Cloudflare Pages cache behavior:
  - CDN stale-while-revalidate for static HTML
  - no-store for `/sw.js`
  - immutable caching for hashed Astro assets
  - bounded cache for images and runtime scripts

## Rules For Future Pages

- Use the shared layout unless there is a strong reason not to.
- Same-origin page links should be normal `<a href="/route">` anchors so `snappy-nav.js` can warm them.
- Do not attach prefetch to API routes, downloads, external links, or large media.
- Add `data-no-prefetch="true"` to any same-origin link that must never be warmed.
- Extensionless same-origin page URLs must canonicalize to the trailing-slash page before service-worker caching. Do not cache or return raw redirect responses for document navigations.
- Keep the visible nav loader delayed; fast navigations should not flash a loading overlay.
- Bump the version in `snappy-nav.js` and `sw.js` when changing cache behavior.

## Verification

Before shipping changes to this layer:

```bash
npm run build
```

Then verify in a browser:

- service worker controls the page after one reload
- hovering a visible same-origin link places that page in `aiit-pages-*`
- clicking the warmed link renders the destination without loader flash
- no relevant console errors beyond local-preview-only missing Cloudflare Functions

Known local preview-only 404s:

- `/api/auth/me`
- `/api/paper-game/collection`
