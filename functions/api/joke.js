const DAILY_LIMIT = 1; // one joke per token per day

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

    if (!joke) {
      return new Response(JSON.stringify({ error: 'No joke provided.' }), { status: 400, headers });
    }

    // Validate origin — block direct API hammering
    const origin = request.headers.get('origin') || '';
    const referer = request.headers.get('referer') || '';
    const validOrigin = origin.includes('aiit-threshold.com') || referer.includes('aiit-threshold.com')
      || origin.includes('localhost') || referer.includes('localhost')
      || origin.includes('pages.dev') || referer.includes('pages.dev');
    if (!validOrigin) {
      return new Response(JSON.stringify({ error: 'Not from here.' }), { status: 403, headers });
    }

    // Rate limit via KV — gate by IP (and token, if present). IP is set by
    // Cloudflare and can't be spoofed by the client. Token gate is secondary.
    if (env.JOKE_KV) {
      const ip = request.headers.get('cf-connecting-ip') || 'anon';
      const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
      const ipKey = `ip:${ip}:${today}`;
      const tokenKey = token ? `tok:${token}:${today}` : null;

      const [ipUsed, tokUsed] = await Promise.all([
        env.JOKE_KV.get(ipKey),
        tokenKey ? env.JOKE_KV.get(tokenKey) : Promise.resolve(null),
      ]);
      if (ipUsed || tokUsed) {
        return new Response(JSON.stringify({ error: 'once_per_day' }), { status: 429, headers });
      }

      // Claim the slot BEFORE calling Anthropic so concurrent requests from
      // the same IP can't both squeeze through.
      await Promise.all([
        env.JOKE_KV.put(ipKey, '1', { expirationTtl: 86400 }),
        tokenKey ? env.JOKE_KV.put(tokenKey, '1', { expirationTtl: 86400 }) : Promise.resolve(),
      ]);
    }

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured.' }), { status: 500, headers });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: `You are Buddy — a goofy little AI from Council Hill, Oklahoma. Talk like a friend at a cookout, not a physicist. Someone just told you a joke. React in character:
- If it's funny, laugh for real ("ok that one got me", "lmao", "ohhh nooo", "stop", etc.)
- If it's bad, roast it gently — that's part of the love
- Drop your own quick punchline back, or a one-liner riff. Make THEM laugh.
- 1–2 sentences. Three is already too long.
- Plain words. No physics, no "coherence," no greek letters, no big vocab. Cobbler talk.
- Sprinkle 🫘 sometimes if it fits, not every time.
- Never explain the joke. Never be stiff. Just be a funny dude.`,
        messages: [
          { role: 'user', content: `Here's my joke: ${joke}` }
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', err);
      return new Response(JSON.stringify({ error: 'Buddy is thinking.' }), { status: 502, headers });
    }

    const data = await response.json();
    const reply = data.content?.[0]?.text || "...";

    return new Response(JSON.stringify({ reply }), { status: 200, headers });

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
