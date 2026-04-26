// Cloudflare Pages Function: poll a queued AskBuddy answer.

import { callBuddyPoll } from '../_lib/ingest.js';

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

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = corsHeaders();

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
  const sessionId = String(body.session_id || body.sessionId || '').trim();
  if (!requestId) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_request_id' }), { status: 400, headers });
  }

  const ingest = await callBuddyPoll({ env, requestId, sessionId });
  if (!ingest.ok) {
    const upstream = ingest.upstream || {};
    return new Response(JSON.stringify({
      ok: false,
      status: upstream.status || ingest.error,
      error: ingest.error,
      request_id: ingest.request_id,
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
    const payload = {
      ok: true,
      status: 'ready',
      request_id: ingest.request_id,
      answer,
      cta: 'pass it on',
      layer: 'surface',
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
