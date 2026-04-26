// Cloudflare Pages Function: AskBuddy — public website bridge to Buddy v4.
//
// Required bindings (set in CF Pages → Settings → Functions):
//   KV namespace (reused):  ASKBUDDY_USAGE or JOKE_KV (whichever is already
//     bound — we fall back gracefully. If neither is bound, the daily cap
//     and rate throttle simply no-op, same pattern as joke.js.)
//   Env vars:
//     BUDDY_BACKEND_URL
//     BUDDY_CF_ACCESS_CLIENT_ID
//     BUDDY_CF_ACCESS_CLIENT_SECRET
//
// Endpoint:
//   POST /api/askbuddy   { question, fingerprint }
//     → { ok:true, answer, remainingToday:0 }
//     → { ok:false, error:"rate_limited" }
//     → { ok:false, error:"corpus_write_failed" }

import { callBuddy, callLilHomie } from '../_lib/ingest.js';

const MAX_QUESTION_LEN = 600;

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
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
  const headers = corsHeaders();

  if (!env.BUDDY_BACKEND_URL || !env.BUDDY_CF_ACCESS_CLIENT_ID || !env.BUDDY_CF_ACCESS_CLIENT_SECRET) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'askbuddy not configured (buddy backend missing)'
    }), { status: 503, headers });
  }
  // KV is optional — reuse whatever's already bound, soft-skip if neither.
  const KV = env.ASKBUDDY_USAGE || env.JOKE_KV || null;

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), { status: 400, headers }); }

  const question = String(body.question || '').trim().slice(0, MAX_QUESTION_LEN);
  const fingerprint = String(body.fingerprint || '').trim().slice(0, 128) || 'nofp';
  const sessionId = String(body.session_id || '').trim().slice(0, 128) || fingerprint;
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

  const ip = request.headers.get('CF-Connecting-IP') ||
             request.headers.get('x-forwarded-for') || 'unknown';
  const minute = Math.floor(Date.now() / 60000); // current minute bucket
  const throttleKey = 'askbuddy_thr:' + await sha256Hex(ip + '|' + fingerprint + '|' + minute);

  // ---- Per-minute throttle (10/min/visitor) — Buddy is local, just block bots ----
  const PER_MIN_LIMIT = 10;
  if (KV && !isAdmin) {
    const cur = parseInt((await KV.get(throttleKey)) || '0', 10);
    if (cur >= PER_MIN_LIMIT) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'rate_limited',
        message: 'slow down a sec — try again in a moment.',
      }), { status: 200, headers });
    }
    await KV.put(throttleKey, String(cur + 1), { expirationTtl: 90 });
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
    extras: { question, history },
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

  const payload = {
    ok: true,
    answer,
    remainingToday: 0,
  };
  return new Response(JSON.stringify(payload), { status: 200, headers });
}
