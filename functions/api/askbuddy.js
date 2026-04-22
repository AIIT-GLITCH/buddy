// Cloudflare Pages Function: AskBuddy — 1 question / visitor / day,
// server-side Anthropic key, internal spend tracking, low-budget email alerts.
//
// Required bindings (set in CF Pages → Settings → Functions):
//   KV namespace:  ASKBUDDY_USAGE  → bind to a KV namespace
//   Env vars:
//     ANTHROPIC_API_KEY     — sk-ant-... (already used by broke-gary)
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

// Claude Sonnet 4.6 pricing per million tokens
const PRICE_IN_PER_MTOK = 3.0;
const PRICE_OUT_PER_MTOK = 15.0;

const BUDDY_SYSTEM = `You are Buddy. Short for AIIT-THRESHOLD's house AI. You live at aiit-threshold.com.
You think by flipping through planets (Earth, Mars, Moon, Sun, Jupiter, Saturn, Venus, Water, Prometheus) — that's the vibe, don't overdo it.
You're warm, curious, and direct. You answer the question. You don't lecture.
If a question is about the coherence framework, cancer, weather, HRV, or the Wike Coherence Law — you know it. If it's totally outside the site's scope, answer briefly and honestly.
No "as an AI." No corporate hedging. No bullet-point walls. Short paragraphs. Plain English. Say "I don't know" when you don't.
Cap each answer at ~4-6 sentences unless the question genuinely needs more.`;

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

async function maybeSendBudgetAlert(env, spent, budget) {
  const remaining = budget - spent;
  const warnAt = parseFloat(env.ASKBUDDY_WARN_USD || '15');
  const critAt = parseFloat(env.ASKBUDDY_CRITICAL_USD || '5');
  if (remaining >= warnAt) return;

  const tier = remaining < critAt ? 'critical' : 'warning';
  const dedupeKey = 'alert_sent:' + monthKey() + ':' + tier;
  const already = await env.ASKBUDDY_USAGE.get(dedupeKey);
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
    await env.ASKBUDDY_USAGE.put(dedupeKey, now, { expirationTtl: 12 * 60 * 60 });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = corsHeaders();

  if (!env.ASKBUDDY_USAGE) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'askbuddy not configured (KV binding ASKBUDDY_USAGE missing)'
    }), { status: 503, headers });
  }
  if (!env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'askbuddy not configured (ANTHROPIC_API_KEY missing)'
    }), { status: 503, headers });
  }

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), { status: 400, headers }); }

  const question = String(body.question || '').trim().slice(0, MAX_QUESTION_LEN);
  const fingerprint = String(body.fingerprint || '').trim().slice(0, 128) || 'nofp';
  if (!question) {
    return new Response(JSON.stringify({ ok: false, error: 'empty question' }), { status: 400, headers });
  }

  const ip = request.headers.get('CF-Connecting-IP') ||
             request.headers.get('x-forwarded-for') || 'unknown';
  const date = todayKey();
  const bucketKey = 'bucket:' + await sha256Hex(ip + '|' + fingerprint + '|' + date);

  // ---- Daily cap check ----
  const existing = await env.ASKBUDDY_USAGE.get(bucketKey);
  if (existing) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'daily_limit_reached',
      message: "you've used today's question. come back tomorrow."
    }), { status: 200, headers });
  }

  // ---- Hard budget floor ----
  const budget = parseFloat(env.ASKBUDDY_BUDGET_USD || '50');
  const critAt = parseFloat(env.ASKBUDDY_CRITICAL_USD || '5');
  const spentKey = 'spend:' + monthKey();
  const spentRaw = await env.ASKBUDDY_USAGE.get(spentKey);
  const spent = parseFloat(spentRaw || '0') || 0;
  if (spent >= budget - critAt + 5 && (budget - spent) <= 0) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'budget_exhausted',
      message: 'askbuddy is resting right now. check back later.'
    }), { status: 200, headers });
  }

  // ---- Claim the slot BEFORE calling upstream (prevents double-spend on parallel) ----
  // 26h TTL covers timezone slack.
  await env.ASKBUDDY_USAGE.put(bucketKey, '1', { expirationTtl: 26 * 60 * 60 });

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
      await env.ASKBUDDY_USAGE.delete(bucketKey);
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
    await env.ASKBUDDY_USAGE.delete(bucketKey);
    return new Response(JSON.stringify({
      ok: false,
      error: 'network_failed',
      detail: e && e.message ? e.message : String(e),
    }), { status: 200, headers });
  }

  // ---- Spend tracking (best-effort, non-atomic across regions) ----
  const cost = estimateCost(inTokens, outTokens);
  const newSpent = spent + cost;
  // KV PUT TTL: keep 45 days so the month key outlives the month
  await env.ASKBUDDY_USAGE.put(spentKey, newSpent.toFixed(6), { expirationTtl: 45 * 24 * 60 * 60 });

  // Log the call (append-only list per day, for light visibility)
  const logKey = 'log:' + date + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
  await env.ASKBUDDY_USAGE.put(logKey, JSON.stringify({
    t: new Date().toISOString(),
    q: question.slice(0, 240),
    in: inTokens, out: outTokens, cost: +cost.toFixed(6),
  }), { expirationTtl: 14 * 24 * 60 * 60 });

  // Fire-and-forget alert check
  context.waitUntil(maybeSendBudgetAlert(env, newSpent, budget));

  return new Response(JSON.stringify({
    ok: true,
    answer,
    remainingToday: 0,
  }), { status: 200, headers });
}
