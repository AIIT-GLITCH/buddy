// GitHub OAuth callback. Exchanges code for access_token, fetches user,
// mints a session cookie backed by AUTH_KV.

function randomSession() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 90;

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
    redirectTarget = normalizeRedirectTarget(stored, url.origin);
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
    await env.AUTH_KV.put(`session:${session}`, JSON.stringify(sessionData), { expirationTtl: SESSION_TTL_SECONDS });
  }

  const expires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toUTCString();
  const cookie = [
    `aiit_session=${session}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    `Expires=${expires}`,
    'Priority=High',
  ].join('; ');

  return new Response(null, {
    status: 302,
    headers: {
      'Location': redirectTarget,
      'Set-Cookie': cookie,
    },
  });
}
