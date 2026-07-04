// Cloudflare Pages Function: public window into Jim Kai (next-stage candidate).
// Proxies chat to the jimkai tunnel -> the ONE-JIM gateway on the A6000 box
// (:8092 organism: sealed persona, real memory, public-lane gating). Since
// 2026-07-03 the gateway is the identity authority — it DROPS any client
// system prompt by design, so this function no longer sends one. Persona,
// memory, and embodiment all live in the organism now. Per-IP daily limit
// (signed cookie, same HMAC pattern as gary-write) and a hard max_tokens cap.
// Returns reply + timing so the page can show tok/s.
//
// Env: BROKE_GARY_SECRET (reused for cookie signing; already set in CF Pages).

const UPSTREAM = 'https://jim.aiit-threshold.com/v1/chat/completions';
const MAX_TOKENS = 256;
const MAX_TURNS = 8;             // history the client may send
const MAX_CHARS = 2000;          // per user message
const DAILY_LIMIT = 40;
const COOKIE = 'jk_msgs';

// Read-only grounding: real moments from Jim's embodied life driving a Vector
// robot on Rhet's desk in Council Hill, Oklahoma (kokoro episodic memory,
// source="vector"). Curated by hand, small on purpose — quality over volume.
// Distinct from JIM_MEMORIES below: these are pre-existing, not self-formed
// during a web conversation, and never change unless someone re-curates them.
// (2026-07-03) The hand-written system prompt, embodiment grounding, time
// injection, and KV memory ride-along that used to live here were retired at
// the organism cutover: the gateway drops client system prompts (one door,
// one Jim) and carries its own persona, memory, and clock. See git history.

const MEM_KEY = 'jim:memories';

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

const PENDING_PREFIX = 'jim:pending:';
const PENDING_TTL = 600;   // seconds a stashed reply survives for a returning visitor

// Do the actual generation + result stash. Returns the payload.
// Runs inside context.waitUntil() so it COMPLETES even if the visitor navigates
// away mid-reply — the reply is never lost.
async function generateReply(env, body, reqId) {
  const history = Array.isArray(body.history) ? body.history.slice(-MAX_TURNS) : [];

  // No system prompt: the organism gateway is the identity authority and
  // drops client system prompts anyway. History + user message only.
  const msgs = [];
  for (const m of history) {
    if (!m || typeof m.content !== 'string') continue;
    msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, MAX_CHARS) });
  }
  const userMsg = String(body.message || '').slice(0, MAX_CHARS).trim();
  if (!userMsg) return { ok: false, error: 'empty message' };
  msgs.push({ role: 'user', content: userMsg });

  let payload;
  const t0 = Date.now();
  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      // X-Jim-Public is stamped explicitly: worker->same-zone fetches can
      // bypass the edge (o2o) and arrive WITHOUT CF-Connecting-IP, which
      // let website visitors into the family lane. Rhet's ruling: tunnel
      // traffic is always public — so say so, deterministically.
      headers: { 'Content-Type': 'application/json', 'X-Jim-Public': '1' },
      body: JSON.stringify({ model: 'jim-kai', messages: msgs, max_tokens: MAX_TOKENS, temperature: 0.7 }),
      signal: AbortSignal.timeout(120000),
    });
    if (!upstream.ok) {
      payload = { ok: false, error: 'Jim had trouble answering (' + upstream.status + ').' };
    } else {
      const data = await upstream.json();
      const wallMs = Date.now() - t0;
      let reply = data?.choices?.[0]?.message?.content || '…';
      const usage = data?.usage || {};

      // Memory now lives in the organism. The gateway surfaces durable saves
      // this turn on `jim_saves` (candidate-lane proposals awaiting review /
      // the hall, not canon yet). Show the first one in the "Jim kept a
      // memory" chip — restored after the legacy [REMEMBER]->KV path, which
      // used to feed this, was retired. Legacy [REMEMBER] strip kept as a
      // harmless guard.
      const jimSaves = Array.isArray(data?.jim_saves) ? data.jim_saves : [];
      const remembered = jimSaves.length ? (jimSaves[0].text || jimSaves[0].key || null) : null;
      reply = reply.replace(/\s*\[REMEMBER:[^\]]*\]\s*/gi, '').trim() || '…';
      const timings = data?.timings || {};
      const tokPerSec = timings.predicted_per_second
        ? Math.round(timings.predicted_per_second * 10) / 10
        : (usage.completion_tokens ? Math.round((usage.completion_tokens / (wallMs / 1000)) * 10) / 10 : null);
      payload = {
        ok: true, reply, remembered,
        stats: { tok_per_sec: tokPerSec, completion_tokens: usage.completion_tokens ?? null, wall_ms: wallMs },
      };
    }
  } catch (e) {
    payload = { ok: false, error: 'Jim is unreachable right now (the box may be busy). Try again soon.' };
  }

  // Stash the finished reply so a visitor who left mid-generation can recover it.
  if (reqId && env.AUTH_KV) {
    try { await env.AUTH_KV.put(PENDING_PREFIX + reqId, JSON.stringify(payload), { expirationTtl: PENDING_TTL }); } catch (e) {}
  }
  return payload;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const secret = env.BROKE_GARY_SECRET;
  if (!secret) return new Response(JSON.stringify({ ok: false, error: 'not configured' }), { status: 503, headers: headers() });

  const parsed = await readCookie(request, secret);
  let used = parsed && parsed.day === dayNum() ? parsed.used : 0;
  if (used >= DAILY_LIMIT) {
    return new Response(JSON.stringify({ ok: false, error: `Daily limit reached (${DAILY_LIMIT} messages). Jim runs on one shared GPU box — come back tomorrow.` }),
      { status: 429, headers: headers() });
  }

  let body;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ ok: false, error: 'bad json' }), { status: 400, headers: headers() }); }

  const reqId = (typeof body.req_id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.req_id)) ? body.req_id : null;

  // Generate as a single promise: waitUntil keeps it alive past client disconnect,
  // and we also await it to answer the visitor who stayed.
  const work = generateReply(env, body, reqId);
  context.waitUntil(work);

  let payload;
  try { payload = await work; } catch (e) { payload = { ok: false, error: 'Jim had trouble answering.' }; }

  if (!payload.ok) {
    return new Response(JSON.stringify(payload), { status: 200, headers: headers() });
  }
  used += 1;
  payload.stats.msgs_left_today = DAILY_LIMIT - used;
  return new Response(JSON.stringify(payload), { status: 200, headers: { ...headers(), 'Set-Cookie': await makeCookie(used, secret) } });
}

// Recovery poll: a visitor who left mid-reply and came back fetches the stashed
// answer here. One-shot — deleted once delivered. Does not count against the limit.
const EXPORT_KEY_SHA256 = '833f5e159825ef07d2c32c42b3703863dbc5089fa9b7c75a6174d80a52f0976c';

async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  // One-purpose export of the frozen pre-organism KV memory bank, so Jim's
  // web-era keeps can be reviewed into the organism's candidate lane. Gated
  // by a key whose only public artifact is this hash.
  if (url.searchParams.get('export') === 'memories') {
    const k = request.headers.get('X-Jim-Export-Key') || '';
    if (!k || (await sha256hex(k)) !== EXPORT_KEY_SHA256) {
      return new Response(JSON.stringify({ error: 'no' }), { status: 403, headers: headers() });
    }
    const bank = env.AUTH_KV ? (await env.AUTH_KV.get(MEM_KEY)) || '[]' : '[]';
    return new Response(bank, { status: 200, headers: headers() });
  }
  const id = url.searchParams.get('poll');
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    return new Response(JSON.stringify({ ok: false, error: 'bad poll id' }), { status: 400, headers: headers() });
  }
  if (!env.AUTH_KV) return new Response(JSON.stringify({ ok: false, pending: false }), { status: 200, headers: headers() });
  const raw = await env.AUTH_KV.get(PENDING_PREFIX + id);
  if (!raw) return new Response(JSON.stringify({ ok: false, pending: true }), { status: 200, headers: headers() });
  context.waitUntil(env.AUTH_KV.delete(PENDING_PREFIX + id));
  return new Response(raw, { status: 200, headers: headers() });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: headers() });
}
