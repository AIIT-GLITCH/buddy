// Kicks off GitHub OAuth. Generates state, stashes to KV, redirects to GitHub.

function randomState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const clientId = env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return new Response('OAuth not configured.', { status: 500 });
  }

  const url = new URL(request.url);
  const redirect = url.searchParams.get('redirect') || '/';

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
