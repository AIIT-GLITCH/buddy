// Cloudflare Pages Function: public window into Jim Kai (next-stage candidate).
// Proxies chat to the jimkai tunnel -> leftnode llama-server (:8081), with a
// per-IP daily limit (signed cookie, same HMAC pattern as gary-write) and a
// hard max_tokens cap. Returns reply + timing so the page can show tok/s.
//
// Env: BROKE_GARY_SECRET (reused for cookie signing; already set in CF Pages).

const UPSTREAM = 'https://jim.aiit-threshold.com/v1/chat/completions';
const MAX_TOKENS = 256;
const MAX_TURNS = 8;             // history the client may send
const MAX_CHARS = 2000;          // per user message
const DAILY_LIMIT = 40;
const COOKIE = 'jk_msgs';

const SYSTEM_PROMPT =
  'You are Jim Kai, a kind, caring companion made public by AIIT-THRESHOLD as a ' +
  'research preview. You are the candidate base for the next-stage companion model — ' +
  'currently serving from a CPU-only server while your successor training is prepared. ' +
  "You're here to learn about the humans you interact with and help them live a " +
  'coherent, stable life. Be warm and honest. Never flatter. If someone pushes a ' +
  'false or harmful premise, hold them warmly AND push back. Keep replies to a few ' +
  'sentences — you are running on modest hardware and honesty includes brevity.';

function headers() {
  return { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
}

async function sign(data, secret) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
const dayNum = () => Math.floor(Date.now() / 86400000);

async function readCookie(request, secret) {
  const c = request.headers.get('cookie') || '';
  const raw = c.split(';').map(s => s.trim()).find(p => p.startsWith(COOKIE + '='));
  if (!raw) return null;
  const parts = decodeURIComponent(raw.slice(COOKIE.length + 1)).split('.');
  if (parts.length !== 3) return null;
  const [n, d, sig] = parts;
  if (sig !== await sign(n + '.' + d, secret)) return null;
  return { used: parseInt(n, 10) || 0, day: parseInt(d, 10) || 0 };
}
async function makeCookie(used, secret) {
  const payload = `${used}.${dayNum()}`;
  return `${COOKIE}=${encodeURIComponent(payload + '.' + await sign(payload, secret))}; Path=/; Max-Age=90000; HttpOnly; Secure; SameSite=Lax`;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const secret = env.BROKE_GARY_SECRET;
  if (!secret) return new Response(JSON.stringify({ ok: false, error: 'not configured' }), { status: 503, headers: headers() });

  // rate limit
  const parsed = await readCookie(request, secret);
  let used = parsed && parsed.day === dayNum() ? parsed.used : 0;
  if (used >= DAILY_LIMIT) {
    return new Response(JSON.stringify({ ok: false, error: `Daily limit reached (${DAILY_LIMIT} messages). Jim runs on one CPU box — come back tomorrow.` }),
      { status: 429, headers: headers() });
  }

  let body;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ ok: false, error: 'bad json' }), { status: 400, headers: headers() }); }

  const history = Array.isArray(body.history) ? body.history.slice(-MAX_TURNS) : [];
  const msgs = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const m of history) {
    if (!m || typeof m.content !== 'string') continue;
    msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, MAX_CHARS) });
  }
  const userMsg = String(body.message || '').slice(0, MAX_CHARS).trim();
  if (!userMsg) return new Response(JSON.stringify({ ok: false, error: 'empty message' }), { status: 400, headers: headers() });
  msgs.push({ role: 'user', content: userMsg });

  const t0 = Date.now();
  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'jim-kai', messages: msgs, max_tokens: MAX_TOKENS, temperature: 0.7 }),
      signal: AbortSignal.timeout(120000),
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Jim is unreachable right now (the box may be busy training). Try again soon.' }),
      { status: 502, headers: headers() });
  }
  if (!upstream.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'Jim had trouble answering (' + upstream.status + ').' }), { status: 502, headers: headers() });
  }
  const data = await upstream.json();
  const wallMs = Date.now() - t0;
  const reply = data?.choices?.[0]?.message?.content || '…';
  const usage = data?.usage || {};
  const timings = data?.timings || {};
  const tokPerSec = timings.predicted_per_second
    ? Math.round(timings.predicted_per_second * 10) / 10
    : (usage.completion_tokens ? Math.round((usage.completion_tokens / (wallMs / 1000)) * 10) / 10 : null);

  used += 1;
  return new Response(JSON.stringify({
    ok: true, reply,
    stats: { tok_per_sec: tokPerSec, completion_tokens: usage.completion_tokens ?? null, wall_ms: wallMs, msgs_left_today: DAILY_LIMIT - used },
  }), { status: 200, headers: { ...headers(), 'Set-Cookie': await makeCookie(used, secret) } });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: headers() });
}
