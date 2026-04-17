// Returns the current session's user, or { user: null } if not logged in.

function parseSessionFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';').map(s => s.trim());
  for (const p of parts) {
    if (p.startsWith('aiit_session=')) return p.slice('aiit_session='.length);
  }
  return null;
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
    return new Response(JSON.stringify({ user: null }), { status: 200, headers });
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
    return new Response(JSON.stringify({ user, tier }), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({ user: null }), { status: 200, headers });
  }
}
