const MAX_SLUGS = 300;
const MAX_SLUG_LEN = 80;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]?$/i;
const SESSION_COOKIE = 'aiit_' + 'session';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function getCookieValue(header, name) {
  if (!header) return null;
  for (const part of header.split(';').map(s => s.trim())) {
    if (part.startsWith(name + '=')) return part.slice(name.length + 1);
  }
  return null;
}

function cleanSlugs(value) {
  const input = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    const slug = String(raw || '').trim().toLowerCase().slice(0, MAX_SLUG_LEN);
    if (!slug || !SLUG_RE.test(slug) || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
    if (out.length >= MAX_SLUGS) break;
  }
  return out;
}

function mergeSlugs(a, b) {
  return cleanSlugs([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]);
}

function userKey(user) {
  return 'paper-game:collection:' + String(user.login || user.id).toLowerCase();
}

async function getUser(request, env) {
  if (!env.AUTH_KV) return null;
  const sid = getCookieValue(request.headers.get('cookie'), SESSION_COOKIE);
  if (!sid) return null;
  const raw = await env.AUTH_KV.get('session:' + sid);
  if (!raw) return null;
  try {
    const user = JSON.parse(raw);
    if (!user || (!user.login && !user.id)) return null;
    return user;
  } catch {
    return null;
  }
}

async function readCollection(env, user) {
  const raw = await env.AUTH_KV.get(userKey(user));
  if (!raw) return { collected_slugs: [], updated_at: null };
  try {
    const parsed = JSON.parse(raw);
    return {
      collected_slugs: cleanSlugs(parsed.collected_slugs),
      updated_at: parsed.updated_at || null,
    };
  } catch {
    return { collected_slugs: [], updated_at: null };
  }
}

async function writeCollection(env, user, slugs) {
  const payload = {
    login: user.login || null,
    user_id: user.id || null,
    collected_slugs: cleanSlugs(slugs),
    updated_at: new Date().toISOString(),
  };
  await env.AUTH_KV.put(userKey(user), JSON.stringify(payload));
  return payload;
}

function isSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function onRequestGet({ request, env }) {
  const user = await getUser(request, env);
  if (!user) return json({ ok: true, user: null, collected_slugs: [] });
  const collection = await readCollection(env, user);
  return json({
    ok: true,
    user: { login: user.login, id: user.id, avatar_url: user.avatar_url || null },
    collected_slugs: collection.collected_slugs,
    updated_at: collection.updated_at,
  });
}

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) return json({ ok: false, error: 'forbidden_origin' }, 403);
  const user = await getUser(request, env);
  if (!user) return json({ ok: false, error: 'login_required' }, 401);
  if (!env.AUTH_KV) return json({ ok: false, error: 'auth_kv_missing' }, 503);

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const incoming = cleanSlugs(body.collected_slugs || body.slugs || []);
  const existing = await readCollection(env, user);
  const merged = mergeSlugs(existing.collected_slugs, incoming);
  const saved = await writeCollection(env, user, merged);

  return json({
    ok: true,
    user: { login: user.login, id: user.id, avatar_url: user.avatar_url || null },
    collected_slugs: saved.collected_slugs,
    updated_at: saved.updated_at,
  });
}
