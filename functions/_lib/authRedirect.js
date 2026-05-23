const APP_ASSET_PREFIX = '/appassets';
const BUDDY_THREAD_TARGET = '/ask-buddy/?thread=1';

export function decodeLoose(value) {
  let out = String(value || '').trim();
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(out);
      if (next === out) break;
      out = next;
    } catch {
      break;
    }
  }
  return out;
}

function appAssetPublicPath(pathname) {
  const path = pathname || '/';
  const lower = path.toLowerCase();
  if (lower === APP_ASSET_PREFIX || lower === APP_ASSET_PREFIX + '/') return '/';
  if (!lower.startsWith(APP_ASSET_PREFIX + '/')) return path;

  const publicPath = path.slice(APP_ASSET_PREFIX.length) || '/';
  const publicLower = publicPath.toLowerCase();
  if (publicLower === '/index.html') return '/';
  if (publicLower === '/astro' || publicLower.startsWith('/astro/')) return '/';
  if (publicLower.endsWith('/index.html')) {
    return publicPath.slice(0, -'/index.html'.length) + '/';
  }
  return publicPath;
}

function normalizeAppAssetTarget(target) {
  try {
    const parsed = new URL(target, 'https://aiit.local');
    const publicPath = appAssetPublicPath(parsed.pathname);
    return publicPath + parsed.search + parsed.hash;
  } catch {
    return target;
  }
}

export function canonicalBuddyThreadRedirect(target) {
  try {
    const parsed = new URL(target, 'https://aiit.local');
    const decodedPath = decodeLoose(parsed.pathname).toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const encodedThreadPath =
      decodedPath === '/ask-buddy/#buddy-thread' ||
      decodedPath === '/ask-buddy/#thread' ||
      decodedPath === '/ask-buddy/#persistent-chat';

    if (encodedThreadPath) return BUDDY_THREAD_TARGET;
    if (path !== '/ask-buddy' && path !== '/ask-buddy/') return '';

    const hash = parsed.hash.toLowerCase();
    const mode = (parsed.searchParams.get('mode') || parsed.searchParams.get('view') || '').toLowerCase();
    const thread = (parsed.searchParams.get('thread') || parsed.searchParams.get('persistent') || '').toLowerCase();
    const threadHash = hash === '#buddy-thread' || hash === '#thread' || hash === '#persistent-chat';
    const threadQuery = mode === 'thread' || mode === 'persistent' || thread === '1' || thread === 'true' || thread === 'yes';

    return threadHash || threadQuery ? BUDDY_THREAD_TARGET : '';
  } catch {
    return '';
  }
}

export function normalizeRedirectTarget(raw, origin, fallback = '/') {
  let target = decodeLoose(raw || fallback);
  try {
    if (/^https?:\/\//i.test(target)) {
      const parsed = new URL(target);
      if (parsed.origin !== origin) return fallback;
      target = parsed.pathname + parsed.search + parsed.hash;
    }
  } catch {
    return fallback;
  }

  target = normalizeAppAssetTarget(target);

  if (!target.startsWith('/') || target.startsWith('//') || /[\u0000-\u001f\\]/.test(target)) return fallback;
  if (target.startsWith('/api/')) return fallback;
  const buddyThreadTarget = canonicalBuddyThreadRedirect(target);
  if (buddyThreadTarget) return buddyThreadTarget;
  if (target === '/ask-buddy') return '/ask-buddy/';
  if (target.startsWith('/ask-buddy#')) return target.replace('/ask-buddy#', '/ask-buddy/#');
  return target;
}
