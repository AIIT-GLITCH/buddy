// Kicks off GitHub OAuth. Generates state, stashes to KV, redirects to GitHub.

function randomState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

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
    await env.AUTH_KV.put(`state:${state}`, redirect, { expirationTtl: 600 });
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
