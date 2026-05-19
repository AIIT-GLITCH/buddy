// Cloudflare Pages Function: Buddy Thread report endpoint.
// Stores user-submitted reports in AUTH_KV. Reports are review material only —
// not auto-published, not auto-promoted into Buddy's memory, not used as
// training data unless manually promoted later.
//
// KV binding required: AUTH_KV (same namespace as auth system)
//
// Endpoint:
//   POST /api/buddy-thread/report
//     Requires login (aiit_session cookie).
//     Body: { note, categories, include_recent, recent_messages, thread_id, url }
//     → { ok: true }

import { getLoggedInUser } from '../../_lib/buddyThread.js';

const ALLOWED_CATEGORIES = [
  'forgot_context',
  'wrong_memory',
  'overconnected',
  'strange_answer',
  'stuck_loop',
  'unsafe',
  'other',
];

const MAX_NOTE_LEN = 2000;
const MAX_RECENT_MESSAGES = 10;
const MAX_MESSAGE_LEN = 1000;

function responseHeaders(request) {
  const origin = request?.headers?.get('origin') || '';
  const allowed = /^https:\/\/(www\.)?aiit-threshold\.com$/i.test(origin)
    || /^https:\/\/[-a-z0-9]+\.buddy-bb4\.pages\.dev$/i.test(origin)
    || /^https?:\/\/localhost(:\d+)?$/i.test(origin);
  return {
    'Content-Type': 'application/json',
    ...(allowed ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
    } : {}),
  };
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: responseHeaders(context.request) });
}

function randomId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const h = responseHeaders(request);

  if (!env.AUTH_KV) {
    return new Response(JSON.stringify({ ok: false, error: 'kv_not_bound' }), { status: 500, headers: h });
  }

  const user = await getLoggedInUser(request, env);
  if (!user) {
    return new Response(JSON.stringify({ ok: false, error: 'login_required' }), { status: 401, headers: h });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), { status: 400, headers: h });
  }

  const note = String(body.note || '').trim().slice(0, MAX_NOTE_LEN);
  if (!note) {
    return new Response(JSON.stringify({ ok: false, error: 'note_required' }), { status: 400, headers: h });
  }

  let categories = [];
  if (Array.isArray(body.categories)) {
    categories = body.categories.filter(c => ALLOWED_CATEGORIES.includes(c));
  }

  let recentMessages = [];
  if (body.include_recent && Array.isArray(body.recent_messages)) {
    recentMessages = body.recent_messages
      .slice(-MAX_RECENT_MESSAGES)
      .map(m => ({
        role: String(m.role || '').slice(0, 20),
        text: String(m.text || '').slice(0, MAX_MESSAGE_LEN),
      }));
  }

  const login = (user.login || user.id || 'unknown').toString().toLowerCase();
  const now = new Date().toISOString();
  const ts = Date.now();
  const rid = randomId();
  const kvKey = `buddy-thread-report:${login}:${ts}:${rid}`;

  const report = {
    login,
    user_id: user.id || null,
    note,
    categories,
    include_recent: !!body.include_recent,
    recent_messages: recentMessages,
    thread_id: String(body.thread_id || 'primary').slice(0, 50),
    url: String(body.url || '').slice(0, 200),
    created_at: now,
  };

  await env.AUTH_KV.put(kvKey, JSON.stringify(report), {
    expirationTtl: 60 * 60 * 24 * 365,
  });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: h });
}
