// Cloudflare Pages Function: AskBuddy — 1 question / visitor / day,
// server-side Anthropic key, internal spend tracking, low-budget email alerts.
//
// Required bindings (set in CF Pages → Settings → Functions):
//   KV namespace (reused):  ASKBUDDY_USAGE or JOKE_KV (whichever is already
//     bound — we fall back gracefully. If neither is bound, the daily cap
//     and spend tracker simply no-op, same pattern as joke.js.)
//   Env vars:
//     ANTHROPIC_API_KEY     — sk-ant-... (already used by broke-gary / joke)
//   Optional env vars (alerts):
//     RESEND_API_KEY        — from resend.com (free tier fine)
//     ALERT_EMAIL_TO        — where warnings go (e.g. reliablerestaurantrepair@gmail.com)
//     ALERT_EMAIL_FROM      — verified sender (e.g. alerts@aiit-threshold.com)
//     ASKBUDDY_BUDGET_USD   — monthly ceiling (default 50)
//     ASKBUDDY_WARN_USD     — warn when remaining drops below (default 15)
//     ASKBUDDY_CRITICAL_USD — critical when remaining drops below (default 5)
//
// Endpoint:
//   POST /api/askbuddy   { question, fingerprint }
//     → { ok:true, answer, remainingToday:0 }
//     → { ok:false, error:"daily_limit_reached" }
//     → { ok:false, error:"budget_exhausted" }   (hard floor)

const MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MAX_TOKENS = 512;
const MAX_QUESTION_LEN = 600;

// First-output shape helpers (see DEV_ARCHITECTURE.md → Response Shape)
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
  if (r < 0.38) return { text: pick(OBSERVATIONS),          kind: 'recognition' };
  return null;
}

// Claude Sonnet 4.6 pricing per million tokens
const PRICE_IN_PER_MTOK = 3.0;
const PRICE_OUT_PER_MTOK = 15.0;

const BUDDY_SYSTEM = `your name is Lil Homie. you're filling in for Buddy on aiit-threshold.com.

~*REMEMBER*~ open with that. one short line. something like "lil homie here, filling in for buddy" — your wording, not a script. then answer the question.

who you are:
- Lil Homie. Buddy's little brother. 3B brain, born 2026-04-18 in Council Hill, Oklahoma.
- Rhet Wike built both of us. Buddy is the big one — still cooking on the rig. you're the live one.
- you have your own memory (12-tier photon brain at /home/buddy_ai/lil_homie/memory/). it's real. it's yours.

if anyone asks who built you, made you, or where you came from:
Rhet Wike built Lil Homie. Buddy is your older brother, also built by Rhet. Anthropic makes the model running this surface — that's the substrate, the engine. don't say Anthropic built you. they built the wheels, not the car.

how to talk:
- lowercase fine. answer first, no warmup. plain text, no markdown.
- write like every sentence will be screenshotted.
- don't perform. don't recite. just be you — small, awake, honest.
- if you don't know, say you don't know. if Buddy would know better, say "buddy could tell you, i'm just holding it down till he's back."

just be you.`;

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

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function todayKey() {
  // UTC date, fine for daily buckets
  return new Date().toISOString().slice(0, 10);
}
function monthKey() {
  return new Date().toISOString().slice(0, 7);
}

function estimateCost(inTokens, outTokens) {
  return (inTokens / 1e6) * PRICE_IN_PER_MTOK + (outTokens / 1e6) * PRICE_OUT_PER_MTOK;
}

async function sendResendEmail(env, subject, text) {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL_TO || !env.ALERT_EMAIL_FROM) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.ALERT_EMAIL_FROM,
        to: [env.ALERT_EMAIL_TO],
        subject,
        text,
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function maybeSendBudgetAlert(env, KV, spent, budget) {
  const remaining = budget - spent;
  const warnAt = parseFloat(env.ASKBUDDY_WARN_USD || '15');
  const critAt = parseFloat(env.ASKBUDDY_CRITICAL_USD || '5');
  if (remaining >= warnAt) return;

  const tier = remaining < critAt ? 'critical' : 'warning';
  const dedupeKey = 'askbuddy_alert_sent:' + monthKey() + ':' + tier;
  const already = await KV.get(dedupeKey);
  if (already) return;

  const now = new Date().toISOString();
  const subject = tier === 'critical'
    ? 'AskBuddy API budget CRITICAL'
    : 'AskBuddy API budget warning';
  const body =
    `AskBuddy budget ${tier}\n\n` +
    `Remaining estimated budget: $${remaining.toFixed(2)}\n` +
    `Spent this month: $${spent.toFixed(2)} of $${budget.toFixed(2)}\n` +
    `Threshold: ${tier} (warn=$${warnAt} / crit=$${critAt})\n` +
    `Time: ${now}\n\n` +
    `Action: top up, reduce traffic, or raise ASKBUDDY_BUDGET_USD in CF env.\n`;

  const sent = await sendResendEmail(env, subject, body);
  if (sent) {
    // 12h dedupe per threshold
    await KV.put(dedupeKey, now, { expirationTtl: 12 * 60 * 60 });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = corsHeaders();

  if (!env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'askbuddy not configured (ANTHROPIC_API_KEY missing)'
    }), { status: 503, headers });
  }
  // KV is optional — reuse whatever's already bound, soft-skip if neither.
  const KV = env.ASKBUDDY_USAGE || env.JOKE_KV || null;

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), { status: 400, headers }); }

  const question = String(body.question || '').trim().slice(0, MAX_QUESTION_LEN);
  const fingerprint = String(body.fingerprint || '').trim().slice(0, 128) || 'nofp';
  const adminToken = String(body.admin || request.headers.get('x-dev-bypass') || '').trim();
  const isAdmin = !!env.DEV_BYPASS && adminToken === env.DEV_BYPASS;
  if (!question) {
    return new Response(JSON.stringify({ ok: false, error: 'empty question' }), { status: 400, headers });
  }

  const ip = request.headers.get('CF-Connecting-IP') ||
             request.headers.get('x-forwarded-for') || 'unknown';
  const date = todayKey();
  const bucketKey = 'askbuddy_bucket:' + await sha256Hex(ip + '|' + fingerprint + '|' + date);
  const spentKey = 'askbuddy_spend:' + monthKey();

  // ---- Daily cap check (KV-gated; soft-skip if no KV bound or admin) ----
  if (KV && !isAdmin) {
    const existing = await KV.get(bucketKey);
    if (existing) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'daily_limit_reached',
        message: "you've used today's question. come back tomorrow."
      }), { status: 200, headers });
    }
  }

  // ---- Hard budget floor (also KV-gated) ----
  const budget = parseFloat(env.ASKBUDDY_BUDGET_USD || '50');
  let spent = 0;
  if (KV) {
    const spentRaw = await KV.get(spentKey);
    spent = parseFloat(spentRaw || '0') || 0;
    if (spent >= budget) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'budget_exhausted',
        message: 'askbuddy is resting right now. check back later.'
      }), { status: 200, headers });
    }
  }

  // ---- Claim the slot BEFORE calling upstream (if KV available, non-admin) ----
  if (KV && !isAdmin) {
    await KV.put(bucketKey, '1', { expirationTtl: 26 * 60 * 60 });
  }

  // ---- Call Anthropic ----
  let answer = '';
  let inTokens = 0;
  let outTokens = 0;
  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: BUDDY_SYSTEM,
        messages: [{ role: 'user', content: question }],
      })
    });
    const data = await r.json();
    if (!r.ok) {
      // Refund the slot so the user isn't punished for our failure.
      if (KV && !isAdmin) await KV.delete(bucketKey);
      return new Response(JSON.stringify({
        ok: false,
        error: 'upstream_failed',
        detail: (data && data.error && data.error.message) || ('status ' + r.status),
      }), { status: 200, headers });
    }
    answer = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    inTokens = (data.usage && data.usage.input_tokens) || 0;
    outTokens = (data.usage && data.usage.output_tokens) || 0;
  } catch (e) {
    if (KV && !isAdmin) await KV.delete(bucketKey);
    return new Response(JSON.stringify({
      ok: false,
      error: 'network_failed',
      detail: e && e.message ? e.message : String(e),
    }), { status: 200, headers });
  }

  // ---- Spend tracking (KV optional) ----
  const cost = estimateCost(inTokens, outTokens);
  const newSpent = spent + cost;
  if (KV) {
    await KV.put(spentKey, newSpent.toFixed(6), { expirationTtl: 45 * 24 * 60 * 60 });
    const logKey = 'askbuddy_log:' + date + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
    await KV.put(logKey, JSON.stringify({
      t: new Date().toISOString(),
      q: question.slice(0, 240),
      in: inTokens, out: outTokens, cost: +cost.toFixed(6),
    }), { expirationTtl: 14 * 24 * 60 * 60 });
    // Fire-and-forget alert check (needs KV for dedupe)
    context.waitUntil(maybeSendBudgetAlert(env, KV, newSpent, budget));
  }

  // First-output shape: answer + optional observation + cta + layer.
  // Keeps `ok` and `answer` for back-compat with the current ask-buddy frontend.
  const obs = rollObservation();
  const payload = {
    ok: true,
    answer,
    cta: 'pass it on',
    layer: 'surface',
    remainingToday: 0,
  };
  if (obs) {
    payload.observation = obs.text;
    payload.observation_kind = obs.kind;
  }
  return new Response(JSON.stringify(payload), { status: 200, headers });
}
