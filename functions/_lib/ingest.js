// functions/_lib/ingest.js
//
// THE INGESTION GATE.
//
// This module is the ONLY path Cloudflare Functions are allowed to use
// to reach the Buddy-family backends. Every public surface that produces a
// Buddy or Lil Homie response MUST go through this module.
//
// Forbidden in CF route handlers:
//   - Direct fetch('https://api.anthropic.com/...') for any Buddy/LilHomie flow
//   - Direct fetch(env.LIL_HOMIE_URL + ...) anywhere except this file
//   - Direct fetch(env.BUDDY_BACKEND_URL + ...) anywhere except this file
//   - Any "just this one surface" shortcut
//
// Contract with the Buddy-family backend:
//
//   Request (POST endpoint):
//     {
//       request_id:  string        // UUID, assigned by this helper
//       timestamp:   string        // ISO, assigned by this helper
//       surface:     string        // 'ask' | 'joke' | future
//       session_id:  string | null // stable per-visitor thread id
//       user_input:  string        // raw input that produced this turn
//       ...extras                  // endpoint-specific fields (history, joke, etc.)
//     }
//
//   Response (success):
//     {
//       corpus_written: true       // REQUIRED. Confirms the turn was
//                                   // written to the conversation corpus,
//                                   // anomaly index updated, judge-eligible
//                                   // flag set BEFORE this response returned.
//       ...payload                 // surface-specific answer fields
//     }
//
//   If corpus_written is absent or not strictly === true, the helper
//   treats the turn as an ingestion failure and returns { ok: false,
//   error: 'corpus_write_failed' }. Route handlers MUST NOT synthesize
//   a success response when this happens.
//
// Strategy: STRICT FAIL-CLOSED.
//   Cloudflare Workers have no persistent disk. A KV-backed recovery
//   spool adds complexity without real durability guarantees (KV is
//   also remote, and a spooled turn sitting in KV isn't yet in the
//   corpus). Fail-closed + honest "backend offline" message + natural
//   user-initiated retry is the safest practical option. If a surface
//   later needs best-effort behavior, it must be an explicit, reviewed
//   opt-in — not a silent default.

const DEFAULT_URL = 'https://lilhomie.aiit-threshold.com';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_BUDDY_TIMEOUT_MS = 30_000;

function newRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/**
 * The sole CF→Lil Homie bridge. Returns a structured result; never throws.
 *
 * @param {object} args
 * @param {object} args.env          Cloudflare env bindings
 * @param {string} args.endpoint     path on the Lil Homie backend, e.g. '/ask'
 * @param {string} args.surface      'ask' | 'joke' | etc. (used for corpus tagging)
 * @param {string} args.userInput    raw user-provided text
 * @param {string|null} [args.sessionId]  stable per-visitor thread id, if any
 * @param {object} [args.extras]     additional surface-specific body fields
 * @param {number} [args.timeoutMs]  request timeout
 * @returns {Promise<{ok:true, request_id:string, data:object} | {ok:false, error:string, request_id:string, status?:number, upstream?:object}>}
 */
export async function callLilHomie({
  env,
  endpoint,
  surface,
  userInput,
  sessionId = null,
  extras = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const request_id = newRequestId();

  if (!env || !env.LIL_HOMIE_TOKEN) {
    return { ok: false, error: 'lilhomie_not_configured', request_id };
  }
  if (!surface || typeof surface !== 'string') {
    return { ok: false, error: 'ingest_misconfigured_surface', request_id };
  }
  if (!endpoint || typeof endpoint !== 'string') {
    return { ok: false, error: 'ingest_misconfigured_endpoint', request_id };
  }

  const LIL_HOMIE_URL = env.LIL_HOMIE_URL || DEFAULT_URL;
  const body = {
    request_id,
    timestamp: new Date().toISOString(),
    surface,
    session_id: sessionId || null,
    user_input: String(userInput || ''),
    ...extras,
  };

  let r;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    r = await fetch(LIL_HOMIE_URL + endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + env.LIL_HOMIE_TOKEN,
        'x-request-id': request_id,
        'x-surface': surface,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch (e) {
    return { ok: false, error: 'lilhomie_offline', request_id };
  }

  if (!r.ok) {
    return { ok: false, error: 'lilhomie_offline', request_id, status: r.status };
  }

  let data;
  try {
    data = await r.json();
  } catch {
    return { ok: false, error: 'lilhomie_bad_response', request_id };
  }

  if (data && data.corpus_written === true) {
    return { ok: true, request_id, data };
  }

  // Strict fail-closed. Backend did not confirm corpus ingestion.
  return {
    ok: false,
    error: 'corpus_write_failed',
    request_id,
    upstream: data,
  };
}

/**
 * CF→Buddy v4 bridge. Returns a structured result; never throws.
 *
 * Buddy v4 is exposed only through Cloudflare Tunnel + Access. The backend
 * must confirm corpus_written:true before public routes may return success.
 *
 * @param {object} args
 * @param {object} args.env
 * @param {string} [args.endpoint]    path on Buddy v4, defaults to '/ask'
 * @param {string} args.surface
 * @param {string} args.userInput
 * @param {string|null} [args.sessionId]
 * @param {object} [args.extras]
 * @param {number} [args.timeoutMs]
 * @returns {Promise<{ok:true, request_id:string, data:object} | {ok:false, error:string, request_id:string|null, status?:number, upstream?:object}>}
 */
export async function callBuddy({
  env,
  endpoint = '/ask',
  surface,
  userInput,
  sessionId = null,
  extras = {},
  timeoutMs = DEFAULT_BUDDY_TIMEOUT_MS,
}) {
  if (
    !env ||
    !env.BUDDY_BACKEND_URL ||
    !env.BUDDY_CF_ACCESS_CLIENT_ID ||
    !env.BUDDY_CF_ACCESS_CLIENT_SECRET
  ) {
    return { ok: false, error: 'buddy_not_configured', request_id: null };
  }
  if (!surface || typeof surface !== 'string') {
    return { ok: false, error: 'ingest_misconfigured_surface', request_id: null };
  }
  if (!endpoint || typeof endpoint !== 'string') {
    return { ok: false, error: 'ingest_misconfigured_endpoint', request_id: null };
  }

  const request_id = newRequestId();
  const baseUrl = String(env.BUDDY_BACKEND_URL).replace(/\/+$/, '');
  const body = {
    request_id,
    timestamp: new Date().toISOString(),
    userInput: String(userInput || ''),
    sessionId: sessionId || null,
    surface,
    extras,
  };

  let r;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const headers = {
      'content-type': 'application/json',
      'CF-Access-Client-Id': env.BUDDY_CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': env.BUDDY_CF_ACCESS_CLIENT_SECRET,
      'x-request-id': request_id,
      'x-surface': surface,
    };
    if (env.BUDDY_BACKEND_TOKEN) {
      headers.authorization = 'Bearer ' + env.BUDDY_BACKEND_TOKEN;
    }
    r = await fetch(baseUrl + endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch {
    return { ok: false, error: 'buddy_offline', request_id };
  }

  if (!r.ok) {
    return { ok: false, error: 'buddy_offline', request_id, status: r.status };
  }

  let data;
  try {
    data = await r.json();
  } catch {
    return { ok: false, error: 'buddy_bad_response', request_id };
  }

  const upstreamRequestId = data && data.request_id ? data.request_id : request_id;
  if (data && data.corpus_written === true) {
    return { ok: true, request_id: upstreamRequestId, data };
  }

  return {
    ok: false,
    error: data && data.error ? data.error : 'corpus_write_failed',
    request_id: upstreamRequestId,
    upstream: data,
  };
}

/**
 * CF→Buddy v4 pending-answer poll. This intentionally bypasses callBuddy's
 * corpus_written requirement because pending poll responses do not write new
 * corpus data; ready responses must still carry corpus_written:true.
 *
 * @param {object} args
 * @param {object} args.env
 * @param {string} args.requestId
 * @param {string|null} [args.sessionId]
 * @param {number} [args.timeoutMs]
 * @returns {Promise<{ok:true, request_id:string, data:object} | {ok:false, error:string, request_id:string|null, status?:number, upstream?:object}>}
 */
export async function callBuddyPoll({
  env,
  requestId,
  sessionId = null,
  timeoutMs = DEFAULT_BUDDY_TIMEOUT_MS,
}) {
  if (
    !env ||
    !env.BUDDY_BACKEND_URL ||
    !env.BUDDY_CF_ACCESS_CLIENT_ID ||
    !env.BUDDY_CF_ACCESS_CLIENT_SECRET
  ) {
    return { ok: false, error: 'buddy_not_configured', request_id: requestId || null };
  }

  const cleanRequestId = String(requestId || '').trim();
  if (!cleanRequestId) {
    return { ok: false, error: 'missing_request_id', request_id: null };
  }

  const baseUrl = String(env.BUDDY_BACKEND_URL).replace(/\/+$/, '');
  let r;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const headers = {
      'content-type': 'application/json',
      'CF-Access-Client-Id': env.BUDDY_CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': env.BUDDY_CF_ACCESS_CLIENT_SECRET,
      'x-request-id': cleanRequestId,
      'x-surface': 'ask_poll',
    };
    if (env.BUDDY_BACKEND_TOKEN) {
      headers.authorization = 'Bearer ' + env.BUDDY_BACKEND_TOKEN;
    }
    r = await fetch(baseUrl + '/ask_poll', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        request_id: cleanRequestId,
        sessionId: sessionId || null,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch {
    return { ok: false, error: 'buddy_offline', request_id: cleanRequestId };
  }

  if (!r.ok) {
    return { ok: false, error: 'buddy_offline', request_id: cleanRequestId, status: r.status };
  }

  let data;
  try {
    data = await r.json();
  } catch {
    return { ok: false, error: 'buddy_bad_response', request_id: cleanRequestId };
  }

  const upstreamRequestId = data && data.request_id ? data.request_id : cleanRequestId;
  if (data && data.ok === true && data.status === 'pending') {
    return { ok: true, request_id: upstreamRequestId, data };
  }
  if (data && data.ok === true && data.status === 'ready' && data.corpus_written === true) {
    return { ok: true, request_id: upstreamRequestId, data };
  }

  return {
    ok: false,
    error: data && data.error ? data.error : 'buddy_poll_failed',
    request_id: upstreamRequestId,
    upstream: data,
  };
}
