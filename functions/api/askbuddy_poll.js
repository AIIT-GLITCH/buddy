// Cloudflare Pages Function: poll a queued AskBuddy answer.

import { callBuddyPoll } from '../_lib/ingest.js';
import { appendBuddyThreadTurn, getBuddyThreadSessionId, getLoggedInUser } from '../_lib/buddyThread.js';

const PRIMARY_ORIGIN = 'https://aiit-threshold.com';
const SURGE_MESSAGE = 'WOAH! more people are talking to buddy than we were ready for! please try again in a minute so he can keep answering cleanly.';
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/(www\.)?aiit-threshold\.com$/i,
  /^https:\/\/[a-f0-9]+\.buddy-bb4\.pages\.dev$/i,
  /^https:\/\/[-a-z0-9]+\.buddy-bb4\.pages\.dev$/i,
  /^https?:\/\/localhost(?::\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i,
  /^capacitor:\/\/localhost$/i,
  /^ionic:\/\/localhost$/i,
];

const OBSERVATIONS = [
  'you moved on that before you fully explained it.',
  'you knew where that was going early.',
  'you felt that before you understood it.',
  'you recognized that faster than you verified it.',
  'something in that landed before your brain got involved.',
  'you caught the shape before the words.',
];
const SUBSTRATE_BREADCRUMBS = [
  'this is running on the surface model.',
  "the underlying system isn't this.",
];
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rollObservation() {
  const r = Math.random();
  if (r < 0.08) return { text: pick(SUBSTRATE_BREADCRUMBS), kind: 'substrate' };
  if (r < 0.38) return { text: pick(OBSERVATIONS), kind: 'recognition' };
  return null;
}

function isAllowedOrigin(value) {
  if (!value || value === 'null') return false;
  return ALLOWED_ORIGIN_PATTERNS.some(re => re.test(value));
}

function isAllowedReferer(value) {
  if (!value) return false;
  try {
    return isAllowedOrigin(new URL(value).origin);
  } catch {
    return false;
  }
}

function requestFromAllowedSurface(request) {
  const origin = request.headers.get('origin') || '';
  const referer = request.headers.get('referer') || '';

  // Browser traffic must come from an allowed surface. Direct server-side calls
  // usually have neither header; leave those to IP/KV throttling instead of
  // breaking health checks or native wrappers.
  if (!origin && !referer) return true;
  return isAllowedOrigin(origin) || isAllowedReferer(referer);
}

function corsHeaders(request) {
  const origin = request.headers.get('origin') || '';
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : PRIMARY_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Dev-Bypass',
    'Vary': 'Origin',
  };
}

function normalizedIso(value) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = corsHeaders(request);

  if (!requestFromAllowedSurface(request)) {
    return new Response(JSON.stringify({ ok: false, error: 'forbidden_origin' }), { status: 403, headers });
  }

  if (!env.BUDDY_BACKEND_URL || !env.BUDDY_CF_ACCESS_CLIENT_ID || !env.BUDDY_CF_ACCESS_CLIENT_SECRET) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'askbuddy not configured (buddy backend missing)',
    }), { status: 503, headers });
  }

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), { status: 400, headers }); }

  const requestId = String(body.request_id || body.requestId || '').trim();
  const incomingSessionId = String(body.session_id || body.sessionId || '').trim();
  const question = String(body.question || '').trim().slice(0, 600);
  const askedAt = normalizedIso(body.asked_at);
  const wantsAccountThread = body.account_thread === true;
  if (!requestId) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_request_id' }), { status: 400, headers });
  }

  const loggedInUser = await getLoggedInUser(request, env);
  const accountThread = wantsAccountThread && !!(loggedInUser && (loggedInUser.login || loggedInUser.id));
  const sessionId = accountThread ? await getBuddyThreadSessionId(env, loggedInUser, 'primary') : incomingSessionId;

  const ingest = await callBuddyPoll({ env, requestId, sessionId });
  if (!ingest.ok) {
    const upstream = ingest.upstream || {};
    return new Response(JSON.stringify({
      ok: false,
      status: upstream.status || ingest.error,
      error: ingest.error,
      request_id: ingest.request_id,
      message: ['queue_full', 'too_many_pending', 'rate_limited', 'traffic_surge'].includes(ingest.error) ? SURGE_MESSAGE : undefined,
    }), { status: 200, headers });
  }

  if (ingest.data.status === 'pending') {
    return new Response(JSON.stringify({
      ok: true,
      status: 'pending',
      request_id: ingest.request_id,
    }), { status: 200, headers });
  }

  const answer = String(ingest.data.answer || '').trim();
  if (ingest.data.status === 'ready' && answer) {
    const obs = rollObservation();
    let threadSaved = false;
    const answerAt = new Date().toISOString();
    if (accountThread && question) {
      try {
        await appendBuddyThreadTurn(env, loggedInUser, {
          question,
          answer,
          requestId: ingest.request_id,
          threadId: 'primary',
          questionAt: askedAt,
          answerAt,
        });
        threadSaved = true;
      } catch {}
    }
    const payload = {
      ok: true,
      status: 'ready',
      request_id: ingest.request_id,
      answer,
      cta: 'pass it on',
      layer: 'surface',
      thread: { enabled: accountThread, saved: threadSaved, question_at: askedAt, answer_at: answerAt },
    };
    if (obs) {
      payload.observation = obs.text;
      payload.observation_kind = obs.kind;
    }
    return new Response(JSON.stringify(payload), { status: 200, headers });
  }

  return new Response(JSON.stringify({
    ok: false,
    status: 'unknown',
    error: 'unknown',
    request_id: ingest.request_id,
  }), { status: 200, headers });
}
