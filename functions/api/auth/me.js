// Returns the current session's user, or { user: null } if not logged in.

function parseSessionFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';').map(s => s.trim());
  for (const p of parts) {
    if (p.startsWith('aiit_session=')) return p.slice('aiit_session='.length);
  }
  return null;
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 90;

function persistentSessionCookie(session) {
  const clean = String(session || '').replace(/[^a-f0-9]/gi, '').slice(0, 128);
  if (!clean) return null;
  const expires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toUTCString();
  return [
    `aiit_session=${clean}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    `Expires=${expires}`,
    'Priority=High',
  ].join('; ');
}

function expireSessionCookie() {
  return [
    'aiit_session=',
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ].join('; ');
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };

  const session = parseSessionFromCookie(request.headers.get('cookie'));
  if (!session || !env.AUTH_KV) {
    return new Response(JSON.stringify({ user: null }), { status: 200, headers });
  }

  const raw = await env.AUTH_KV.get(`session:${session}`);
  if (!raw) {
    return new Response(JSON.stringify({ user: null }), {
      status: 200,
      headers: { ...headers, 'Set-Cookie': expireSessionCookie() },
    });
  }

  try {
    const user = JSON.parse(raw);
    let tier = 'free';
    const proRaw = await env.AUTH_KV.get(`pro:${(user.login || '').toLowerCase()}`);
    if (proRaw) {
      try {
        const pro = JSON.parse(proRaw);
        if (pro.status === 'active' || pro.status === 'trialing') tier = 'pro';
      } catch {}
    }
    const cookie = persistentSessionCookie(session);
    return new Response(JSON.stringify({ user, tier }), {
      status: 200,
      headers: cookie ? { ...headers, 'Set-Cookie': cookie } : headers,
    });
  } catch {
    return new Response(JSON.stringify({ user: null }), {
      status: 200,
      headers: { ...headers, 'Set-Cookie': expireSessionCookie() },
    });
  }
}
