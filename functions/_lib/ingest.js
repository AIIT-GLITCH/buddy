// functions/_lib/ingest.js
//
// THE INGESTION GATE.
//
// This module is the ONLY path Cloudflare Functions are allowed to use
// to reach the Lil Homie backend. Every public surface that produces a
// Buddy or Lil Homie response MUST go through `callLilHomie`.
//
// Forbidden in CF route handlers:
//   - Direct fetch('https://api.anthropic.com/...') for any Buddy/LilHomie flow
//   - Direct fetch(env.LIL_HOMIE_URL + ...) anywhere except this file
//   - Any "just this one surface" shortcut
//
// Contract with the Lil Homie backend:
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
