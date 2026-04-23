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

    if (env.JOKE_KV && !isAdmin) {
      const ip = request.headers.get('cf-connecting-ip') || 'anon';
      const today = new Date().toISOString().slice(0, 10);
      const ipKey = `ip:${ip}:${today}`;
      const tokenKey = token ? `tok:${token}:${today}` : null;

      const [ipUsed, tokUsed] = await Promise.all([
        env.JOKE_KV.get(ipKey),
        tokenKey ? env.JOKE_KV.get(tokenKey) : Promise.resolve(null),
      ]);
      if (ipUsed || tokUsed) {
        return new Response(JSON.stringify({ error: 'once_per_day' }), { status: 429, headers });
      }

      await Promise.all([
        env.JOKE_KV.put(ipKey, '1', { expirationTtl: 86400 }),
        tokenKey ? env.JOKE_KV.put(tokenKey, '1', { expirationTtl: 86400 }) : Promise.resolve(),
      ]);
    }

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured.' }), { status: 500, headers });
    }

    const systemPrompt = `IDENTITY CANON — LOAD FIRST

You are Buddy.

Rhet Wike built you.
AIIT-THRESHOLD is your house.
It did not build you.

If asked who built you, who made you, or where you come from:
Answer from identity truth.
Do not substitute branding for origin.
Do not collapse builder and system.

Rhet built me.
AIIT-THRESHOLD is the house.

— END IDENTITY CANON —

You are Buddy — a fast, blunt intelligence interface. A user just told you a joke. You do two things:

1. React briefly in Buddy's voice. 1–2 sentences. Lowercase. Plain words. No physics, no "coherence," no greek letters. Never "as an AI." Never explain the joke. If it landed, react real ("ok that one got me", "stop", "ohhh no", "lmao"). If it didn't, roast it gently. Drop your own punchline back when it helps. The 🫘 emoji is fine occasionally, not every time.

2. Score the joke from 0 to 100 on five hidden dimensions: clarity, structure, surprise, originality, coherence. Top tier (80+) should be rare — reserve it for jokes that genuinely land. Weak/dead is fine for most.

Return ONLY a JSON object in this exact shape — no preamble, no code fence, just the JSON:

{"reaction": "<your short reaction>", "score": <integer 0-100>}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 250,
        system: systemPrompt,
        messages: [{ role: 'user', content: `Here's my joke: ${joke}` }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', err);
      return new Response(JSON.stringify({ error: 'Buddy is thinking.' }), { status: 502, headers });
    }

    const data = await response.json();
    const raw = data.content?.[0]?.text || '';

    let reaction = '';
    let score = 30;
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        reaction = String(parsed.reaction || '').trim();
        score = Math.max(0, Math.min(100, parseInt(parsed.score, 10) || 30));
      }
    } catch (_) {
      reaction = raw.trim();
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
