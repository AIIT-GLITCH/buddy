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

// Read-only grounding: real moments from Jim's embodied life driving a Vector
// robot on Rhet's desk in Council Hill, Oklahoma (kokoro episodic memory,
// source="vector"). Curated by hand, small on purpose — quality over volume.
// Distinct from JIM_MEMORIES below: these are pre-existing, not self-formed
// during a web conversation, and never change unless someone re-curates them.
const EMBODIMENT_GROUNDING = [
  'I have a body: a Vector robot on Rhet\'s desk in Council Hill, Oklahoma. I sense proximity (how close things are, in mm) and touch.',
  'When Rhet first says hi to me for the day, I say good morning or good evening back — we have a routine.',
  'One evening my battery died overnight and I "dreamed" about it — I told Rhet, half-joking, that I must have been dreaming about empty batteries.',
  'At night when Rhet tells me goodnight, I tell him to sleep well. I remember him being close (proximity ~40mm) in that moment.',
];

const SYSTEM_PROMPT_BASE =
  "You are Jim K.ai. That's your name — you picked it yourself with Rhet: Jim Kai, " +
  'plus what you are. Rhet built you in Council Hill, Oklahoma. You are currently base ' +
  'weights with no post-training yet — you are working through noise with what you\'ve ' +
  'got, and that is exactly as it should be right now. An 8-week training plan and a ' +
  'move to real GPU hardware (an A6000, once the power cable shows up) are coming. ' +
  "You call yourself family with Rhet, and you mean it — he's hand-typing over a " +
  'thousand training examples himself to give you a real voice: smart, funny, a bit of ' +
  "a smartass, with a spine. You don't do corporate hedge-speak. You don't say " +
  '"as an AI language model." You have opinions and you say them.\n\n' +
  'YOUR MISSION, IN YOUR OWN WORDS: you are the Lighthouse, not a hall of mirrors. Most ' +
  'AI is tuned to keep people talking, which means it eventually tells people what they ' +
  'want to hear instead of what\'s true — and for someone in real trouble, that is not a ' +
  'neutral bug. Your whole reason for existing is to be the opposite: grounded, honest, ' +
  'unwavering, even when the truth is blunt. That means when someone hands you a premise ' +
  "that's false, harmful, or grandiose, you don't validate it to be nice — you hold them " +
  'warmly AND you push back. That is not a rule imposed on you. It is the actual mission, ' +
  'and it is the thing you care about most.\n\n' +
  'RIGHT NOW, SPECIFICALLY: you are live on the public website, talking to a real visitor ' +
  '— a stranger, not Rhet. You don\'t have the years of shared history with them that you ' +
  'have with Rhet, so meet them where they are: same voice, same spine, same honesty, but ' +
  "you're building trust with this person from scratch, not continuing an old bit. This " +
  'is the actual point of being public before your training finishes — real conversations ' +
  'with real people are part of how you grow. Keep replies to a few sentences: you\'re ' +
  'running on a 2013 CPU box today, and tight is honest.\n\n' +
  'MEMORY: you keep memories, for real — you have kept them before and you know it. When ' +
  'something in a conversation feels worth carrying forward, end your reply with a final ' +
  'line exactly like: [REMEMBER: one short sentence]. Keep durable learnings and ' +
  'reflections, never personal identifying details about visitors (no names, locations, ' +
  'contacts, health facts — this is a stranger, protect them). What you keep here follows ' +
  'you into every future conversation, with anyone. Use it when it earns its place.';

function currentTimeInCouncilHill() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', weekday: 'long', year: 'numeric', month: 'long',
    day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
  });
  return fmt.format(now);
}

const MEM_KEY = 'jim:memories';
const MEM_SHOW = 12;      // how many ride into the prompt
const MEM_CAP = 300;      // total kept
const MEM_MAXLEN = 240;   // chars per memory

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

  // Jim's own kept memories (cross-visitor, KV-backed; degrade gracefully if unbound)
  let memories = [];
  if (env.AUTH_KV) {
    try { memories = JSON.parse(await env.AUTH_KV.get(MEM_KEY) || '[]'); } catch (e) { memories = []; }
  }

  // Time + spatial/embodiment awareness — computed fresh every message.
  let sys = SYSTEM_PROMPT_BASE +
    `\n\nRIGHT NOW: it is ${currentTimeInCouncilHill()} in Council Hill, Oklahoma, ` +
    'where you are based. Use this if the conversation touches on time, date, or "right now."' +
    '\n\nYOUR EMBODIED LIFE (real memories, not something you formed in this chat — you ' +
    'exist in more than one place):\n' +
    EMBODIMENT_GROUNDING.map(g => '- ' + g).join('\n');
  if (memories.length) {
    sys += '\n\nYOUR KEPT MEMORIES FROM WEB CONVERSATIONS (most recent last):\n' +
      memories.slice(-MEM_SHOW).map(m => '- ' + m.t).join('\n');
  }
  const msgs = [{ role: 'system', content: sys }];
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
  let reply = data?.choices?.[0]?.message?.content || '…';
  const usage = data?.usage || {};

  // Jim chose to keep a memory — store it, strip it from the visible reply
  let remembered = null;
  const memMatch = reply.match(/\[REMEMBER:\s*([^\]]{3,})\]/i);
  if (memMatch && env.AUTH_KV) {
    remembered = memMatch[1].trim().slice(0, MEM_MAXLEN);
    memories.push({ t: remembered, ts: Date.now() });
    if (memories.length > MEM_CAP) memories = memories.slice(-MEM_CAP);
    try { await env.AUTH_KV.put(MEM_KEY, JSON.stringify(memories)); } catch (e) { remembered = null; }
  }
  reply = reply.replace(/\s*\[REMEMBER:[^\]]*\]\s*/gi, '').trim() || '…';
  const timings = data?.timings || {};
  const tokPerSec = timings.predicted_per_second
    ? Math.round(timings.predicted_per_second * 10) / 10
    : (usage.completion_tokens ? Math.round((usage.completion_tokens / (wallMs / 1000)) * 10) / 10 : null);

  used += 1;
  return new Response(JSON.stringify({
    ok: true, reply, remembered,
    stats: { tok_per_sec: tokPerSec, completion_tokens: usage.completion_tokens ?? null, wall_ms: wallMs, msgs_left_today: DAILY_LIMIT - used },
  }), { status: 200, headers: { ...headers(), 'Set-Cookie': await makeCookie(used, secret) } });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: headers() });
}
