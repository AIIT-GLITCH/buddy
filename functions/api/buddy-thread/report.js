// Cloudflare Pages Function: Buddy Thread report endpoint.
// Stores user-submitted reports in AUTH_KV. Reports are review material only —
// not auto-published, not auto-promoted into Buddy's memory, not used as
// training data unless manually promoted later.
//
// KV binding required: AUTH_KV (same namespace as auth system)
// Optional env:
//   REPORTS_TO   comma-separated report recipients; defaults to reports@aiitcorp.com
//   REPORTS_FROM sender address; defaults to NOTIFY_FROM or sales@aiit-threshold.com
//   CF_EMAIL_API_TOKEN or CLOUDFLARE_EMAIL_API_TOKEN sends through Cloudflare Email Sending
//   CLOUDFLARE_ACCOUNT_ID account id for Cloudflare Email Sending
//   MAILCHANNELS_API_KEY sends through the current MailChannels Email API
//
// Endpoint:
//   POST /api/buddy-thread/report
//     Requires login (aiit_session cookie).
//     Body: { note, categories, include_recent, recent_messages, thread_id, url }
//     → { ok: true }

import { getLoggedInUser } from '../../_lib/buddyThread.js';

const ALLOWED_CATEGORIES = [
  'forgot_context',
  'wrong_memory',
  'overconnected',
  'strange_answer',
  'stuck_loop',
  'unsafe',
  'other',
];

const MAX_NOTE_LEN = 2000;
const MAX_RECENT_MESSAGES = 10;
const MAX_MESSAGE_LEN = 1000;
const DEFAULT_REPORTS_TO = 'reports@aiitcorp.com';
const DEFAULT_REPORTS_FROM = 'sales@aiit-threshold.com';
const DEFAULT_CLOUDFLARE_ACCOUNT_ID = '09fdab2a6d6080eca61a1046ab69a57a';

function responseHeaders(request) {
  const origin = request?.headers?.get('origin') || '';
  const allowed = /^https:\/\/(www\.)?aiit-threshold\.com$/i.test(origin)
    || /^https:\/\/[-a-z0-9]+\.buddy-bb4\.pages\.dev$/i.test(origin)
    || /^https?:\/\/localhost(:\d+)?$/i.test(origin)
    || /^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin);
  return {
    'Content-Type': 'application/json',
    ...(allowed ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
    } : {}),
  };
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: responseHeaders(context.request) });
}

function randomId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function reportRecipients(env) {
  const raw = env.REPORTS_TO || DEFAULT_REPORTS_TO;
  return raw
    .split(',')
    .map(addr => addr.trim())
    .filter(Boolean);
}

function formatRecentMessages(messages) {
  if (!messages.length) return 'No recent messages included.';
  return messages
    .map((m, i) => {
      const role = m.role || 'unknown';
      const text = m.text || '';
      return `${i + 1}. ${role}:\n${text}`;
    })
    .join('\n\n');
}

function buildReportEmail(report, rid, kvKey) {
  const categories = report.categories.length ? report.categories.join(', ') : 'none selected';
  return [
    `Buddy Thread report receipt: ${rid}`,
    '',
    `Login: ${report.login}`,
    `User ID: ${report.user_id || 'unknown'}`,
    `Created: ${report.created_at}`,
    `Thread: ${report.thread_id}`,
    `URL: ${report.url || 'unknown'}`,
    `Categories: ${categories}`,
    `Include recent messages: ${report.include_recent ? 'yes' : 'no'}`,
    `KV key: ${kvKey}`,
    '',
    'What happened:',
    report.note,
    '',
    'Recent messages:',
    formatRecentMessages(report.recent_messages),
    '',
    'Reports are review material only. They do not auto-promote into Buddy memory.',
  ].join('\n');
}

async function sendViaCloudflareEmail(env, recipients, fromAddr, subject, body) {
  const token = env.CF_EMAIL_API_TOKEN || env.CLOUDFLARE_EMAIL_API_TOKEN;
  if (!token) return null;

  const accountId = env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_CLOUDFLARE_ACCOUNT_ID;
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: recipients.length === 1 ? recipients[0] : recipients,
      from: { address: fromAddr, name: 'Buddy Reports' },
      subject,
      text: body,
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.success) {
    const err = data?.errors?.map(e => `${e.code}:${e.message}`).join('; ') || `cloudflare_email_${res.status}`;
    throw new Error(err);
  }

  return { ok: true, provider: 'cloudflare_email' };
}

async function sendViaMailChannels(env, recipients, fromAddr, subject, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (env.MAILCHANNELS_API_KEY) headers['X-Api-Key'] = env.MAILCHANNELS_API_KEY;

  const settled = await Promise.allSettled(recipients.map(async (to) => {
    const msg = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromAddr, name: 'Buddy Reports' },
      subject,
      content: [{ type: 'text/plain', value: body }],
    };

    const res = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers,
      body: JSON.stringify(msg),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`mailchannels_${res.status}${text ? `:${text.slice(0, 200)}` : ''}`);
    }
  }));

  const failed = settled.filter(r => r.status === 'rejected');
  if (failed.length) {
    throw new Error(failed.map(f => f.reason?.message || String(f.reason)).join('; '));
  }

  return { ok: true, provider: 'mailchannels' };
}

async function sendReportEmail(env, report, rid, kvKey) {
  const recipients = reportRecipients(env);
  if (!recipients.length) return { ok: false, error: 'no_recipients' };

  const fromAddr = env.REPORTS_FROM || env.NOTIFY_FROM || DEFAULT_REPORTS_FROM;
  const subject = `Buddy report ${rid} from ${report.login}`;
  const body = buildReportEmail(report, rid, kvKey);

  try {
    const cloudflareEmail = await sendViaCloudflareEmail(env, recipients, fromAddr, subject, body);
    if (cloudflareEmail) return cloudflareEmail;
  } catch (e) {
    console.error('buddy report Cloudflare Email failed:', e?.message || e);
    return { ok: false, error: 'cloudflare_email_send_failed' };
  }

  try {
    return await sendViaMailChannels(env, recipients, fromAddr, subject, body);
  } catch (e) {
    console.error('buddy report MailChannels email failed:', e?.message || e);
    return { ok: false, error: 'mailchannels_email_send_failed' };
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const h = responseHeaders(request);

  if (!env.AUTH_KV) {
    return new Response(JSON.stringify({ ok: false, error: 'kv_not_bound' }), { status: 500, headers: h });
  }

  const user = await getLoggedInUser(request, env);
  if (!user) {
    return new Response(JSON.stringify({ ok: false, error: 'login_required' }), { status: 401, headers: h });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), { status: 400, headers: h });
  }

  const note = String(body.note || '').trim().slice(0, MAX_NOTE_LEN);
  if (!note) {
    return new Response(JSON.stringify({ ok: false, error: 'note_required' }), { status: 400, headers: h });
  }

  let categories = [];
  if (Array.isArray(body.categories)) {
    categories = body.categories.filter(c => ALLOWED_CATEGORIES.includes(c));
  }

  let recentMessages = [];
  if (body.include_recent && Array.isArray(body.recent_messages)) {
    recentMessages = body.recent_messages
      .slice(-MAX_RECENT_MESSAGES)
      .map(m => ({
        role: String(m.role || '').slice(0, 20),
        text: String(m.text || '').slice(0, MAX_MESSAGE_LEN),
      }));
  }

  const login = (user.login || user.id || 'unknown').toString().toLowerCase();
  const now = new Date().toISOString();
  const ts = Date.now();
  const rid = randomId();
  const kvKey = `buddy-thread-report:${login}:${ts}:${rid}`;

  const report = {
    login,
    user_id: user.id || null,
    note,
    categories,
    include_recent: !!body.include_recent,
    recent_messages: recentMessages,
    thread_id: String(body.thread_id || 'primary').slice(0, 50),
    url: String(body.url || '').slice(0, 200),
    created_at: now,
  };

  try {
    await env.AUTH_KV.put(kvKey, JSON.stringify(report), {
      expirationTtl: 60 * 60 * 24 * 365,
    });
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'report_write_failed' }), { status: 500, headers: h });
  }

  const email = await sendReportEmail(env, report, rid, kvKey);

  return new Response(JSON.stringify({
    ok: true,
    report_id: rid,
    created_at: now,
    email_sent: email.ok,
    ...(email.ok ? { email_provider: email.provider } : { email_error: email.error }),
  }), { status: 200, headers: h });
}
