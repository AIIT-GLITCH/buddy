// Cloudflare Pages Function: visible Buddy Thread account record.
//
// This is the user-facing thread store behind export/clear. It does not rewrite
// Buddy's corpus, Kokoro memory, reports, or trained behavior.

import {
  clearBuddyThread,
  getLoggedInUser,
  loadBuddyThread,
  publicBuddyThread,
} from '../../_lib/buddyThread.js';

function responseHeaders(request) {
  const origin = request?.headers?.get('origin') || '';
  const allowed = /^https:\/\/(www\.)?aiit-threshold\.com$/i.test(origin)
    || /^https:\/\/[a-f0-9]+\.buddy-bb4\.pages\.dev$/i.test(origin)
    || /^https:\/\/[-a-z0-9]+\.buddy-bb4\.pages\.dev$/i.test(origin)
    || /^https?:\/\/localhost(:\d+)?$/i.test(origin)
    || /^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin);
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...(allowed ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
      'Vary': 'Origin',
    } : {}),
  };
}

function json(request, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: responseHeaders(request) });
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: responseHeaders(context.request) });
}

async function requireUser(request, env) {
  if (!env.AUTH_KV) return { error: 'auth_kv_missing', status: 503 };
  const user = await getLoggedInUser(request, env);
  if (!user) return { error: 'login_required', status: 401 };
  return { user };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireUser(request, env);
  if (auth.error) return json(request, { ok: false, error: auth.error }, auth.status);

  try {
    const record = await loadBuddyThread(env, auth.user, 'primary');
    return json(request, {
      ok: true,
      user: {
        login: auth.user.login || null,
        id: auth.user.id || null,
        avatar_url: auth.user.avatar_url || null,
      },
      thread: publicBuddyThread(record),
    });
  } catch (err) {
    return json(request, {
      ok: false,
      error: err && err.message ? err.message : 'failed_to_load_buddy_thread',
    }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const auth = await requireUser(request, env);
  if (auth.error) return json(request, { ok: false, error: auth.error }, auth.status);

  try {
    const record = await clearBuddyThread(env, auth.user, 'primary');
    return json(request, {
      ok: true,
      user: {
        login: auth.user.login || null,
        id: auth.user.id || null,
        avatar_url: auth.user.avatar_url || null,
      },
      thread: publicBuddyThread(record),
    });
  } catch (err) {
    return json(request, {
      ok: false,
      error: err && err.message ? err.message : 'failed_to_clear_buddy_thread',
      user: {
        login: auth.user.login || null,
        id: auth.user.id || null,
        avatar_url: auth.user.avatar_url || null,
      },
    }, 500);
  }
}
