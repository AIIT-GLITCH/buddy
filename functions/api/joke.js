// Joke endpoint — returns first-output shape:
//   { answer, observation?, result?, cta, layer }
//
// Observation is a short cognitive-recognition line injected at ~30% rate.
// A separate ~8% rare breadcrumb says "this is running on the surface model."
// These are mutually exclusive per response (substrate wins if both roll).

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

    const lilHomieToken = env.LIL_HOMIE_TOKEN;
    if (!lilHomieToken) {
      return new Response(JSON.stringify({ error: 'lil homie token not configured.' }), { status: 500, headers });
    }
    const lilHomieUrl = env.LIL_HOMIE_URL || 'https://lilhomie.aiit-threshold.com';

    // Call the real local 3B brain via cloudflared tunnel. No Anthropic fallback.
    let reaction = '';
    let score = 30;
    try {
      const response = await fetch(lilHomieUrl + '/joke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + lilHomieToken,
        },
        body: JSON.stringify({ joke }),
      });
      if (!response.ok) {
        return new Response(JSON.stringify({ error: 'lil homie is offline. try again.' }), { status: 200, headers });
      }
      const data = await response.json();
      reaction = String(data.reaction || '').trim();
      score = Math.max(0, Math.min(100, parseInt(data.score, 10) || 30));
    } catch (_) {
      return new Response(JSON.stringify({ error: 'lil homie is offline. try again.' }), { status: 200, headers });
    }
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
