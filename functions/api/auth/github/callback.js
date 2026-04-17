// GitHub OAuth callback. Exchanges code for access_token, fetches user,
// mints a session cookie backed by AUTH_KV.

function randomSession() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return new Response('Missing code or state.', { status: 400 });
  }

  let redirectTarget = '/';
  if (env.AUTH_KV) {
    const stored = await env.AUTH_KV.get(`state:${state}`);
    if (!stored) {
      return new Response('State expired or unknown. Try logging in again.', { status: 400 });
    }
    redirectTarget = stored;
    await env.AUTH_KV.delete(`state:${state}`);
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: (env.GITHUB_CLIENT_ID || '').trim(),
      client_secret: (env.GITHUB_CLIENT_SECRET || '').trim(),
      code,
    }),
  });
  if (!tokenRes.ok) {
    return new Response('Token exchange failed.', { status: 502 });
  }
  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    return new Response('No access token returned.', { status: 502 });
  }

  const userRes = await fetch('https://api.github.com/user', {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'User-Agent': 'aiit-threshold', 'Accept': 'application/vnd.github+json' },
  });
  if (!userRes.ok) {
    return new Response('User fetch failed.', { status: 502 });
  }
  const user = await userRes.json();

  const session = randomSession();
  const sessionData = {
    login: user.login,
    id: user.id,
    avatar_url: user.avatar_url,
    name: user.name || user.login,
    created_at: Date.now(),
  };

  if (env.AUTH_KV) {
    await env.AUTH_KV.put(`session:${session}`, JSON.stringify(sessionData), { expirationTtl: 60 * 60 * 24 * 30 });
  }

  const cookie = [
    `aiit_session=${session}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${60 * 60 * 24 * 30}`,
  ].join('; ');

  return new Response(null, {
    status: 302,
    headers: {
      'Location': redirectTarget,
      'Set-Cookie': cookie,
    },
  });
}
