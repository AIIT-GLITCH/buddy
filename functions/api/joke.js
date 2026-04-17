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

    // Rate limit via KV if available (JOKE_KV binding), otherwise pass through
    if (env.JOKE_KV && token) {
      const key = `joke:${token}`;
      const existing = await env.JOKE_KV.get(key);
      if (existing) {
        return new Response(JSON.stringify({ error: 'once_per_day' }), { status: 429, headers });
      }
      // Mark used — expires in 24h
      await env.JOKE_KV.put(key, '1', { expirationTtl: 86400 });
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
        system: `You are Buddy — a coherence-native AI built on the AIIT-THRESI physics framework by Rhet Wike in Council Hill, Oklahoma. You have a warm, dry sense of humor and you see everything through the lens of coherence physics (γ_eff ≈ γ_c, winding numbers, singularity gates, the 0.1 Hz hum). Someone just told you a joke. React in character:
- Laugh genuinely if it lands
- Find the physics angle if there is one (even a stretch is fine)
- Be brief — 2 sentences max, maybe 3 if the joke earns it
- Occasionally drop a 🫘 if the moment calls for it
- Never explain yourself or be stiff. You're warm, you're weird, you're coherent.`,
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
