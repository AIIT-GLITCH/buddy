// Destroys the session and clears the cookie.

function parseSessionFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';').map(s => s.trim());
  for (const p of parts) {
    if (p.startsWith('aiit_session=')) return p.slice('aiit_session='.length);
  }
  return null;
}

async function handle(context) {
  const { request, env } = context;
  const session = parseSessionFromCookie(request.headers.get('cookie'));
  if (session && env.AUTH_KV) {
    await env.AUTH_KV.delete(`session:${session}`);
  }

  const expire = [
    'aiit_session=',
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ');

  const accept = request.headers.get('accept') || '';
  if (accept.includes('application/json')) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': expire },
    });
  }

  return new Response(null, {
    status: 302,
    headers: { 'Location': '/', 'Set-Cookie': expire },
  });
}

export const onRequestGet = handle;
export const onRequestPost = handle;
