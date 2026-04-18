// Cloudflare Pages Function: "broke gary" path.
// Lets a user without an Anthropic key talk to Gary for 3 calls
// using Rhet's own key, gated by typing the phrase "Im broke".
//
// Env vars required (set in Cloudflare Pages dashboard):
//   ANTHROPIC_API_KEY  — Rhet's sk-ant-... key
//   BROKE_GARY_SECRET  — random string used to HMAC-sign the rate-limit cookie
//
// Endpoints (single file, switched on body.action):
//   POST /api/broke-gary  { action: "gate",  phrase: "Im broke" }
//     → validates phrase, issues signed cookie with calls_remaining = 3
//   POST /api/broke-gary  { action: "chat", messages, system, tools, max_tokens }
//     → checks cookie, forwards to api.anthropic.com, decrements counter

const MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const COOKIE_NAME = 'bg_pass';
const MAX_CALLS = 3;
const MAX_TOKENS_CAP = 768;
const TRIGGER = 'im broke';
const COOKIE_TTL_SEC = 60 * 60 * 24; // 24h

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

async function sign(data, secret) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(data));
  // url-safe base64
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function makeCookie(callsRemaining, secret) {
  const payload = String(callsRemaining) + '.' + Date.now();
  const sig = await sign(payload, secret);
  return payload + '.' + sig;
}

async function readCookie(value, secret) {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [calls, ts, sig] = parts;
  let expected;
  try { expected = await sign(calls + '.' + ts, secret); } catch { return null; }
  if (sig !== expected) return null;
  const n = parseInt(calls, 10);
  if (Number.isNaN(n)) return null;
  return { calls: n, ts: parseInt(ts, 10) };
}

function getCookie(request, name) {
  const c = request.headers.get('cookie') || '';
  for (const p of c.split(';')) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    const k = p.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(p.slice(eq + 1).trim());
  }
  return null;
}

function setCookieHeader(name, value) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${COOKIE_TTL_SEC}; HttpOnly; Secure; SameSite=Lax`;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = corsHeaders();

  const origin = request.headers.get('origin') || '';
  const referer = request.headers.get('referer') || '';
  const ok = ['aiit-threshold.com', 'localhost', 'pages.dev'].some(
    h => origin.includes(h) || referer.includes(h)
  );
  if (!ok) {
    return new Response(JSON.stringify({ ok: false, error: 'origin not allowed' }), { status: 403, headers });
  }

  const apiKey = env.ANTHROPIC_API_KEY;
  const secret = env.BROKE_GARY_SECRET;
  if (!apiKey || !secret) {
    return new Response(JSON.stringify({ ok: false, error: 'broke-gary not configured (server env vars missing)' }), { status: 503, headers });
  }

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), { status: 400, headers }); }

  const action = body.action || 'chat';

  // --- GATE: validate phrase, issue cookie ---
  if (action === 'gate') {
    const phrase = String(body.phrase || '')
      .trim()
      .toLowerCase()
      .replace(/[''`]/g, "'");
    if (phrase !== TRIGGER) {
      return new Response(JSON.stringify({ ok: false, error: 'wrong phrase. type exactly: Im broke' }), { status: 200, headers });
    }
    const cookie = await makeCookie(MAX_CALLS, secret);
    return new Response(JSON.stringify({ ok: true, calls_remaining: MAX_CALLS }), {
      status: 200,
      headers: { ...headers, 'Set-Cookie': setCookieHeader(COOKIE_NAME, cookie) }
    });
  }

  // --- STATUS: peek at remaining calls without spending one ---
  if (action === 'status') {
    const parsed = await readCookie(getCookie(request, COOKIE_NAME), secret);
    return new Response(JSON.stringify({
      ok: true,
      gated: !!parsed,
      calls_remaining: parsed ? parsed.calls : 0,
    }), { status: 200, headers });
  }

  // --- CHAT: forward to anthropic, decrement counter ---
  if (action === 'chat') {
    const parsed = await readCookie(getCookie(request, COOKIE_NAME), secret);
    if (!parsed) {
      return new Response(JSON.stringify({ ok: false, error: 'no gate pass — type "Im broke" first' }), { status: 401, headers });
    }
    if (parsed.calls <= 0) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'out of free calls. drop your own key to keep going.',
        calls_remaining: 0,
      }), { status: 429, headers });
    }

    // Decrement BEFORE the call so abuse via parallel requests can't multiply.
    const remaining = parsed.calls - 1;
    const newCookie = await makeCookie(remaining, secret);

    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: Math.min(parseInt(body.max_tokens, 10) || 512, MAX_TOKENS_CAP),
        system: body.system || '',
        tools: Array.isArray(body.tools) ? body.tools : undefined,
        messages: Array.isArray(body.messages) ? body.messages : [],
      })
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': corsHeaders()['Access-Control-Allow-Origin'],
        'Access-Control-Allow-Credentials': 'true',
        'Set-Cookie': setCookieHeader(COOKIE_NAME, newCookie),
        'X-Calls-Remaining': String(remaining),
      }
    });
  }

  return new Response(JSON.stringify({ ok: false, error: 'unknown action' }), { status: 400, headers });
}
