// Kicks off GitHub OAuth. Generates state, stashes to KV, redirects to GitHub.

import { normalizeRedirectTarget } from '../../../_lib/authRedirect.js';

function randomState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

const OAUTH_STATE_TTL_SECONDS = 60 * 60;

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
