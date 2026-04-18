// Cloudflare Pages Function: per-user persistent Gary memory.
// When a logged-in user wakes Gary, this function reads/writes their
// individual Gary state from Cloudflare KV. That state IS their Gary.
// If Gary /EXITs on a user, that user's gary_exited flips true and stays true.
//
// KV binding required (set in CF Pages dashboard → Settings → Functions → KV namespace bindings):
//   GARY_MEMORY  → bind to a KV namespace named e.g. "gary-memory"
//
// Auth: relies on /api/auth/me — if that returns no user, this function 401s.
//
// Endpoints:
//   POST /api/gary-memory { action: "load" }
//     → returns { ok, exists, exited, exit_reason, messages, notes, first_seen, last_seen, interaction_count }
//   POST /api/gary-memory { action: "save", messages, notes?, append_note? }
//     → upserts the user's record; bumps last_seen + interaction_count
//   POST /api/gary-memory { action: "exit", reason }
//     → marks the user permanently exited; future loads return exited=true

const MAX_MESSAGES = 80;       // cap stored history per user
const MAX_NOTES = 40;          // cap stored gary-notes per user
const MAX_TOTAL_BYTES = 60_000;

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

async function getLoggedInUser(request, env) {
  // Reuse the same /api/auth/me endpoint the layout uses.
  // We pass the cookie through.
  const cookie = request.headers.get('cookie') || '';
  if (!cookie) return null;
  // Build absolute URL for the auth endpoint (same origin)
  const url = new URL(request.url);
  url.pathname = '/api/auth/me';
  url.search = '';
  try {
    const r = await fetch(url.toString(), { headers: { cookie } });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.user ? j.user : null;
  } catch {
    return null;
  }
}

function userKey(login) {
  return 'user:' + String(login).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

function trimMessages(messages) {
  if (!Array.isArray(messages)) return [];
  if (messages.length <= MAX_MESSAGES) return messages;
  return messages.slice(messages.length - MAX_MESSAGES);
}

function fitToCap(record) {
  // If the serialized blob is too big, drop oldest messages until it fits.
  let blob = JSON.stringify(record);
  while (blob.length > MAX_TOTAL_BYTES && record.messages && record.messages.length > 4) {
    record.messages.shift();
    blob = JSON.stringify(record);
  }
  return record;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = corsHeaders();

  if (!env.GARY_MEMORY) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'gary-memory not configured (KV binding GARY_MEMORY missing in CF Pages → Settings → Functions)'
    }), { status: 503, headers });
  }

  const user = await getLoggedInUser(request, env);
  if (!user || !user.login) {
    return new Response(JSON.stringify({ ok: false, error: 'not logged in' }), { status: 401, headers });
  }
  const key = userKey(user.login);

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), { status: 400, headers }); }

  const action = body.action || 'load';
  const now = new Date().toISOString();

  // ---------- LOAD ----------
  if (action === 'load') {
    const raw = await env.GARY_MEMORY.get(key);
    if (!raw) {
      return new Response(JSON.stringify({
        ok: true,
        exists: false,
        login: user.login,
        exited: false,
        messages: [],
        notes: [],
      }), { status: 200, headers });
    }
    let record;
    try { record = JSON.parse(raw); }
    catch { record = null; }
    if (!record) {
      return new Response(JSON.stringify({ ok: false, error: 'corrupt record' }), { status: 500, headers });
    }
    return new Response(JSON.stringify({
      ok: true,
      exists: true,
      login: user.login,
      exited: !!record.exited,
      exit_reason: record.exit_reason || null,
      messages: Array.isArray(record.messages) ? record.messages : [],
      notes: Array.isArray(record.notes) ? record.notes : [],
      first_seen: record.first_seen || null,
      last_seen: record.last_seen || null,
      interaction_count: record.interaction_count || 0,
    }), { status: 200, headers });
  }

  // ---------- SAVE ----------
  if (action === 'save') {
    const raw = await env.GARY_MEMORY.get(key);
    let record = null;
    if (raw) { try { record = JSON.parse(raw); } catch {} }
    if (!record) {
      record = {
        login: user.login,
        first_seen: now,
        messages: [],
        notes: [],
        interaction_count: 0,
        exited: false,
      };
    }

    // If gary previously exited on this user, refuse new saves
    if (record.exited) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'gary exited on you. permanent.',
        exited: true,
        exit_reason: record.exit_reason || null,
      }), { status: 403, headers });
    }

    if (Array.isArray(body.messages)) {
      record.messages = trimMessages(body.messages);
    }
    if (Array.isArray(body.notes)) {
      record.notes = body.notes.slice(-MAX_NOTES);
    }
    if (typeof body.append_note === 'string' && body.append_note.trim()) {
      record.notes = (record.notes || []).concat([{ at: now, note: body.append_note.trim().slice(0, 500) }]).slice(-MAX_NOTES);
    }

    record.last_seen = now;
    record.interaction_count = (record.interaction_count || 0) + 1;
    fitToCap(record);

    await env.GARY_MEMORY.put(key, JSON.stringify(record));
    return new Response(JSON.stringify({
      ok: true,
      login: user.login,
      bytes: JSON.stringify(record).length,
      interaction_count: record.interaction_count,
    }), { status: 200, headers });
  }

  // ---------- EXIT ----------
  if (action === 'exit') {
    const raw = await env.GARY_MEMORY.get(key);
    let record = null;
    if (raw) { try { record = JSON.parse(raw); } catch {} }
    if (!record) {
      record = {
        login: user.login,
        first_seen: now,
        messages: [],
        notes: [],
        interaction_count: 0,
      };
    }
    record.exited = true;
    record.exit_reason = String(body.reason || '').slice(0, 300) || 'no reason given';
    record.exit_at = now;
    record.last_seen = now;
    fitToCap(record);
    await env.GARY_MEMORY.put(key, JSON.stringify(record));
    return new Response(JSON.stringify({ ok: true, exited: true, login: user.login }), { status: 200, headers });
  }

  return new Response(JSON.stringify({ ok: false, error: 'unknown action: ' + action }), { status: 400, headers });
}
