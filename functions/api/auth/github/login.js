// Kicks off GitHub OAuth. Generates state, stashes to KV, redirects to GitHub.

function randomState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

const OAUTH_STATE_TTL_SECONDS = 60 * 60;

function decodeLoose(value) {
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

function canonicalBuddyThreadRedirect(target) {
  try {
    const parsed = new URL(target, 'https://aiit.local');
    const path = parsed.pathname.toLowerCase();
    if (path !== '/ask-buddy' && path !== '/ask-buddy/') return '';

    const hash = parsed.hash.toLowerCase();
    const mode = (parsed.searchParams.get('mode') || parsed.searchParams.get('view') || '').toLowerCase();
    const thread = (parsed.searchParams.get('thread') || parsed.searchParams.get('persistent') || '').toLowerCase();
    const threadHash = hash === '#buddy-thread' || hash === '#thread' || hash === '#persistent-chat';
    const threadQuery = mode === 'thread' || mode === 'persistent' || thread === '1' || thread === 'true' || thread === 'yes';

    return threadHash || threadQuery ? '/ask-buddy/?thread=1' : '';
  } catch {
    return '';
  }
}

function normalizeRedirectTarget(raw, origin) {
  let target = decodeLoose(raw || '/');
  try {
    if (/^https?:\/\//i.test(target)) {
      const parsed = new URL(target);
      if (parsed.origin !== origin) return '/';
      target = parsed.pathname + parsed.search + parsed.hash;
    }
  } catch {
    return '/';
  }

  if (!target.startsWith('/') || target.startsWith('//') || /[\u0000-\u001f\\]/.test(target)) return '/';
  if (target.startsWith('/api/')) return '/';
  const buddyThreadTarget = canonicalBuddyThreadRedirect(target);
  if (buddyThreadTarget) return buddyThreadTarget;
  if (target === '/ask-buddy') return '/ask-buddy/';
  if (target.startsWith('/ask-buddy#')) return target.replace('/ask-buddy#', '/ask-buddy/#');
  return target;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const clientId = (env.GITHUB_CLIENT_ID || '').trim();
  if (!clientId) {
    return new Response('OAuth not configured: missing GITHUB_CLIENT_ID.', { status: 500 });
  }

  const url = new URL(request.url);
  const redirect = normalizeRedirectTarget(url.searchParams.get('redirect') || '/', url.origin);

  const state = randomState();

  if (env.AUTH_KV) {
    await env.AUTH_KV.put(`state:${state}`, JSON.stringify({
      redirect,
      created_at: Date.now(),
      consumed: false,
    }), { expirationTtl: OAUTH_STATE_TTL_SECONDS });
  }

  const callback = `${url.origin}/api/auth/github/callback`;
  const ghUrl = new URL('https://github.com/login/oauth/authorize');
  ghUrl.searchParams.set('client_id', clientId);
  ghUrl.searchParams.set('redirect_uri', callback);
  ghUrl.searchParams.set('scope', 'read:user');
  ghUrl.searchParams.set('state', state);
  ghUrl.searchParams.set('allow_signup', 'true');

  return Response.redirect(ghUrl.toString(), 302);
}
