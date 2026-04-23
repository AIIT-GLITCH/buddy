// Joke endpoint — returns first-output shape:
//   { answer, observation?, result?, cta, layer }
//
// Observation is a short cognitive-recognition line injected at ~30% rate.
// A separate ~8% rare breadcrumb says "this is running on the surface model."
// These are mutually exclusive per response (substrate wins if both roll).
//
// Routes through functions/_lib/ingest.js. No direct Lil Homie fetches.

import { callLilHomie } from '../_lib/ingest.js';

const DAILY_LIMIT = 1;

const OBSERVATIONS = [
  'you moved on that before you fully explained it.',
  'you knew where that was going early.',
  'you felt that before you understood it.',
  'you chose that faster than you could explain it.',
  'you moved before you explained it.',
  'you recognized that faster than you verified it.',
  'something in that landed before your brain got involved.',
  'you caught the shape before the words.',
];

const SUBSTRATE_BREADCRUMBS = [
  'this is running on the surface model.',
  'the underlying system isn\'t this.',
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function rollObservation() {
  const r = Math.random();
  if (r < 0.08) return { text: pick(SUBSTRATE_BREADCRUMBS), kind: 'substrate' };
  if (r < 0.38) return { text: pick(OBSERVATIONS),          kind: 'recognition' };
  return null;
}

function scoreToLabel(score) {
  if (score >= 80) return 'he laughed';
  if (score >= 60) return 'solid';
  if (score >= 40) return 'almost';
  if (score >= 20) return 'weak';
  return 'dead';
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://aiit-threshold.com',
  };

  try {
    const body = await request.json();
    const joke = (body.joke || '').trim().slice(0, 500);
    const token = (body.token || '').trim();
    const sessionId = String(body.session_id || '').trim().slice(0, 128) || token || null;
    const rawHistory = Array.isArray(body.history) ? body.history : [];
    const history = rawHistory.slice(-6).map(t => ({
      q: String((t && t.q) || '').slice(0, 500),
      a: String((t && t.a) || '').slice(0, 2000),
    })).filter(t => t.q && t.a);
    const adminToken = String(body.admin || request.headers.get('x-dev-bypass') || '').trim();
    const isAdmin = !!env.DEV_BYPASS && adminToken === env.DEV_BYPASS;

    if (!joke) {
      return new Response(JSON.stringify({ error: 'No joke provided.' }), { status: 400, headers });
    }

    const origin = request.headers.get('origin') || '';
    const referer = request.headers.get('referer') || '';
    const validOrigin = origin.includes('aiit-threshold.com') || referer.includes('aiit-threshold.com')
      || origin.includes('localhost') || referer.includes('localhost')
      || origin.includes('pages.dev') || referer.includes('pages.dev');
    if (!validOrigin) {
      return new Response(JSON.stringify({ error: 'Not from here.' }), { status: 403, headers });
    }

    // Per-minute throttle (10/min/visitor) — Lil Homie is free, just block bots
    if (env.JOKE_KV && !isAdmin) {
      const ip = request.headers.get('cf-connecting-ip') || 'anon';
      const minute = Math.floor(Date.now() / 60000);
      const fp = token || 'anon';
      const throttleKey = `joke_thr:${ip}:${fp}:${minute}`;
      const cur = parseInt((await env.JOKE_KV.get(throttleKey)) || '0', 10);
      if (cur >= 10) {
        return new Response(JSON.stringify({ error: 'rate_limited', message: 'slow down a sec — try again in a moment.' }), { status: 200, headers });
      }
      await env.JOKE_KV.put(throttleKey, String(cur + 1), { expirationTtl: 90 });
    }

    // Route through the ingestion gate. Fail-closed: no corpus write, no response.
    const ingest = await callLilHomie({
      env,
      endpoint: '/joke',
      surface: 'joke',
      userInput: joke,
      sessionId,
      extras: { joke, history },
    });
    if (!ingest.ok) {
      const msg = ingest.error === 'corpus_write_failed'
        ? 'buddy tripped on the write path. try again.'
        : 'lil homie is offline. try again.';
      return new Response(JSON.stringify({
        error: ingest.error,
        request_id: ingest.request_id,
        message: msg,
      }), { status: 200, headers });
    }
    let reaction = String((ingest.data && ingest.data.reaction) || '').trim();
    const score = Math.max(0, Math.min(100, parseInt(ingest.data && ingest.data.score, 10) || 30));
    if (!reaction) reaction = '...';

    const label = scoreToLabel(score);
    const obs = rollObservation();

    const payload = {
      answer: reaction,
      result: label,
      cta: 'pass it on',
      layer: 'surface',
      // Back-compat for existing frontends
      reply: reaction,
    };
    if (obs) {
      payload.observation = obs.text;
      payload.observation_kind = obs.kind;
    }

    return new Response(JSON.stringify(payload), { status: 200, headers });

  } catch (err) {
    console.error('Function error:', err);
    return new Response(JSON.stringify({ error: 'Something collapsed.' }), { status: 500, headers });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
