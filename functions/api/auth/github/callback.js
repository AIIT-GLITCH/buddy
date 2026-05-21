// GitHub OAuth callback. Exchanges code for access_token, fetches user,
// mints a session cookie backed by AUTH_KV.

function randomSession() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 90;
const OAUTH_REPLAY_TTL_SECONDS = 15 * 60;

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

function sessionCookie(session) {
  const expires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toUTCString();
  return [
    `aiit_session=${session}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    `Expires=${expires}`,
    'Priority=High',
  ].join('; ');
}

function parseStateRecord(stored, origin) {
  if (!stored) return null;
  try {
    const record = JSON.parse(stored);
    return {
      redirectTarget: normalizeRedirectTarget(record.redirect || record.redirectTarget || '/', origin),
      consumed: !!record.consumed,
      session: record.session ? String(record.session).replace(/[^a-f0-9]/gi, '').slice(0, 128) : '',
    };
  } catch {
    return {
      redirectTarget: normalizeRedirectTarget(stored, origin),
      consumed: false,
      session: '',
    };
  }
}

function restartLogin(url) {
  const retry = new URL('/api/auth/github/login', url.origin);
  retry.searchParams.set('redirect', '/ask-buddy/?thread=1');
  retry.searchParams.set('retry', 'state');
  return new Response(null, {
    status: 302,
    headers: {
      'Location': retry.pathname + retry.search,
      'Cache-Control': 'no-store',
    },
  });
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
  let stateRecord = null;
  if (env.AUTH_KV) {
    const stored = await env.AUTH_KV.get(`state:${state}`);
    if (!stored) {
      return restartLogin(url);
    }
    stateRecord = parseStateRecord(stored, url.origin);
    if (stateRecord && stateRecord.consumed && stateRecord.session) {
      return new Response(null, {
        status: 302,
        headers: {
          'Location': stateRecord.redirectTarget,
          'Set-Cookie': sessionCookie(stateRecord.session),
          'Cache-Control': 'no-store',
        },
      });
    }
    redirectTarget = stateRecord ? stateRecord.redirectTarget : '/';
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
    await env.AUTH_KV.put(`state:${state}`, JSON.stringify({
      redirectTarget,
      consumed: true,
      session,
      consumed_at: Date.now(),
    }), { expirationTtl: OAUTH_REPLAY_TTL_SECONDS });
  }

  const cookie = sessionCookie(session);

  return new Response(null, {
    status: 302,
    headers: {
      'Location': redirectTarget,
      'Set-Cookie': cookie,
    },
  });
}
