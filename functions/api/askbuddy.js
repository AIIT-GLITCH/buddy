// Cloudflare Pages Function: AskBuddy — public website bridge to Buddy v4.
//
// Required bindings (set in CF Pages → Settings → Functions):
//   KV namespace (reused):  ASKBUDDY_USAGE or JOKE_KV when available.
//   Env vars:
//     BUDDY_BACKEND_URL
//     BUDDY_CF_ACCESS_CLIENT_ID
//     BUDDY_CF_ACCESS_CLIENT_SECRET
//     BUDDY_BACKEND_TOKEN (optional until the Pages secret is configured)
//
// Endpoint:
//   POST /api/askbuddy   { question, fingerprint }
//     → { ok:true, answer, remainingToday:0 }
//     → { ok:false, error:"rate_limited" }
//     → { ok:false, error:"corpus_write_failed" }

import { callBuddy } from '../_lib/ingest.js';
import { appendBuddyThreadTurn, getBuddyThreadSessionId, getLoggedInUser } from '../_lib/buddyThread.js';

const MAX_QUESTION_LEN = 600;
const BUDDY_SITE_MAX_TOKENS = 128;
const PRIMARY_ORIGIN = 'https://aiit-threshold.com';
const QUEUED_MESSAGE = 'WOAH! more people are talking to buddy than we were ready for! please be patient and he will get you your answer!';
const SURGE_MESSAGE = 'WOAH! more people are talking to buddy than we were ready for! please try again in a minute so he can keep answering cleanly.';
const PER_MIN_LIMIT = 4;
const GLOBAL_PER_MIN_LIMIT = 24;
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/(www\.)?aiit-threshold\.com$/i,
  /^https:\/\/[a-f0-9]+\.buddy-bb4\.pages\.dev$/i,
  /^https:\/\/[-a-z0-9]+\.buddy-bb4\.pages\.dev$/i,
  /^https?:\/\/localhost(?::\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i,
  /^capacitor:\/\/localhost$/i,
  /^ionic:\/\/localhost$/i,
];

// First-output shape helpers (see DEV_ARCHITECTURE.md → Response Shape)
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
  if (r < 0.38) return { text: pick(OBSERVATIONS),          kind: 'recognition' };
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

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function todayKey() {
  // UTC date, fine for daily buckets
  return new Date().toISOString().slice(0, 10);
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
      error: 'askbuddy not configured (buddy backend missing)'
    }), { status: 503, headers });
  }
  const KV = env.ASKBUDDY_USAGE || env.JOKE_KV || null;

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), { status: 400, headers }); }

  const question = String(body.question || '').trim().slice(0, MAX_QUESTION_LEN);
  const fingerprint = String(body.fingerprint || '').trim().slice(0, 128) || 'nofp';
  const browserSessionId = String(body.session_id || '').trim().slice(0, 128) || fingerprint;
  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const history = rawHistory.slice(-6).map(t => ({
    q: String(t && t.q || '').slice(0, MAX_QUESTION_LEN),
    a: String(t && t.a || '').slice(0, 2000),
  })).filter(t => t.q && t.a);
  const adminToken = String(body.admin || request.headers.get('x-dev-bypass') || '').trim();
  const isAdmin = !!env.DEV_BYPASS && adminToken === env.DEV_BYPASS;
  if (!question) {
    return new Response(JSON.stringify({ ok: false, error: 'empty question' }), { status: 400, headers });
  }

  const loggedInUser = await getLoggedInUser(request, env);
  const accountThread = !!(loggedInUser && (loggedInUser.login || loggedInUser.id));
  const sessionId = accountThread ? await getBuddyThreadSessionId(env, loggedInUser, 'primary') : browserSessionId;

  const ip = request.headers.get('CF-Connecting-IP') ||
             request.headers.get('x-forwarded-for') || 'unknown';
  const minute = Math.floor(Date.now() / 60000); // current minute bucket
  const throttleKey = 'askbuddy_thr:' + await sha256Hex(ip + '|' + fingerprint + '|' + minute);
  const globalThrottleKey = 'askbuddy_global:' + minute;

  // ---- Cloudflare edge throttle — Buddy is a single local GPU, protect intake. ----
  if (KV && !isAdmin) {
    const cur = parseInt((await KV.get(throttleKey)) || '0', 10);
    if (cur >= PER_MIN_LIMIT) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'rate_limited',
        message: SURGE_MESSAGE,
      }), { status: 200, headers });
    }
    await KV.put(throttleKey, String(cur + 1), { expirationTtl: 90 });

    const globalCur = parseInt((await KV.get(globalThrottleKey)) || '0', 10);
    if (globalCur >= GLOBAL_PER_MIN_LIMIT) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'traffic_surge',
        message: SURGE_MESSAGE,
      }), { status: 200, headers });
    }
    await KV.put(globalThrottleKey, String(globalCur + 1), { expirationTtl: 90 });
  }

  // ---- Route through the ingestion gate (see functions/_lib/ingest.js). ----
  // The gate is the ONLY permitted path from CF Functions to Buddy v4.
  // Fail-closed: if the backend does not confirm corpus_written:true, the
  // visitor gets an honest failure message. No direct Anthropic fallback.
  const ingest = await callBuddy({
    env,
    endpoint: '/ask',
    surface: 'ask',
    userInput: question,
    sessionId,
    extras: {
      question,
      history,
      max_tokens: BUDDY_SITE_MAX_TOKENS,
      temperature: 0.25,
      account_thread: accountThread,
      thread_id: 'primary',
      user: accountThread ? { login: loggedInUser.login || null, id: loggedInUser.id || null } : null,
    },
  });

  if (!ingest.ok) {
    const msg = ingest.error === 'corpus_write_failed'
      ? 'buddy tripped on the write path. try again.'
      : 'buddy is offline. try again.';
    return new Response(JSON.stringify({
      ok: false,
      error: ingest.error,
      request_id: ingest.request_id,
      message: msg,
    }), { status: 200, headers });
  }

  if (ingest.data && ingest.data.ok === false) {
    const pressureErrors = new Set(['queue_full', 'too_many_pending', 'rate_limited', 'traffic_surge']);
    return new Response(JSON.stringify({
      ok: false,
      error: ingest.data.error || 'buddy_unavailable',
      request_id: ingest.request_id,
      message: pressureErrors.has(ingest.data.error) ? SURGE_MESSAGE : (ingest.data.message || 'buddy is offline. try again.'),
    }), { status: 200, headers });
  }

  if (ingest.data && ingest.data.status === 'pending') {
    return new Response(JSON.stringify({
      ok: true,
      status: 'pending',
      request_id: ingest.request_id,
      session_id: sessionId,
      message: QUEUED_MESSAGE,
      cta: 'pass it on',
      layer: 'surface',
      thread: { enabled: accountThread, saved: false },
    }), { status: 200, headers });
  }

  const answer = String((ingest.data && ingest.data.answer) || '').trim();
  if (!answer) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'buddy_empty_answer',
      request_id: ingest.request_id,
      message: 'buddy is offline. try again.',
    }), { status: 200, headers });
  }

  // ---- Logging only (no spend — Buddy runs on Rhet's GPU, $0 per call) ----
  if (KV) {
    const logKey = 'askbuddy_log:' + todayKey() + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
    await KV.put(logKey, JSON.stringify({
      t: new Date().toISOString(),
      q: question.slice(0, 240),
      backend: 'buddy_v4',
    }), { expirationTtl: 14 * 24 * 60 * 60 });
  }

  // First-output shape: answer + optional observation + cta + layer.
  // Keeps `ok` and `answer` for back-compat with the current ask-buddy frontend.
  const obs = rollObservation();
  let threadSaved = false;
  if (accountThread) {
    try {
      await appendBuddyThreadTurn(env, loggedInUser, {
        question,
        answer,
        requestId: ingest.request_id,
        threadId: 'primary',
      });
      threadSaved = true;
    } catch {}
  }
  const payload = {
    ok: true,
    answer,
    cta: 'pass it on',
    layer: 'surface',
    remainingToday: 0,
    thread: { enabled: accountThread, saved: threadSaved },
  };
  if (obs) {
    payload.observation = obs.text;
    payload.observation_kind = obs.kind;
  }
  return new Response(JSON.stringify(payload), { status: 200, headers });
}
