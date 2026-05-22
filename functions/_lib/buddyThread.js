const MAX_THREAD_MESSAGES = 80;
const MAX_MESSAGE_LEN = 3000;
const MAX_RECORD_BYTES = 120_000;
const TEXT_ENCODER = new TextEncoder();

export function parseSessionFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';').map(s => s.trim());
  for (const part of parts) {
    if (part.startsWith('aiit_session=')) return part.slice('aiit_session='.length);
  }
  return null;
}

export async function getLoggedInUser(request, env) {
  if (!env || !env.AUTH_KV) return null;
  const session = parseSessionFromCookie(request.headers.get('cookie'));
  if (!session) return null;
  const raw = await env.AUTH_KV.get(`session:${session}`);
  if (!raw) return null;
  try {
    const user = JSON.parse(raw);
    return user && (user.login || user.id) ? user : null;
  } catch {
    return null;
  }
}

export function cleanLogin(user) {
  return String((user && (user.login || user.id)) || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .slice(0, 80);
}

export function buddyThreadKey(user, threadId = 'primary') {
  const cleanThread = String(threadId || 'primary').replace(/[^a-z0-9_-]/gi, '_').slice(0, 50) || 'primary';
  return `buddy-thread:${cleanLogin(user)}:${cleanThread}`;
}

export function buddyThreadSessionId(user, threadId = 'primary') {
  const cleanThread = String(threadId || 'primary').replace(/[^a-z0-9_-]/gi, '_').slice(0, 50) || 'primary';
  return `buddy-thread:${cleanLogin(user)}:${cleanThread}:v1`;
}

export async function getBuddyThreadSessionId(env, user, threadId = 'primary') {
  const record = await loadBuddyThread(env, user, threadId);
  const cleanThread = String(threadId || 'primary').replace(/[^a-z0-9_-]/gi, '_').slice(0, 50) || 'primary';
  const epoch = String(record.session_epoch || 'v1').replace(/[^a-z0-9_-]/gi, '_').slice(0, 50) || 'v1';
  return `buddy-thread:${cleanLogin(user)}:${cleanThread}:${epoch}`;
}

function emptyRecord(user, threadId = 'primary', now = new Date().toISOString()) {
  return {
    login: user && user.login || null,
    user_id: user && user.id || null,
    thread_id: threadId,
    first_seen: now,
    last_seen: now,
    messages: [],
    turn_count: 0,
    cleared_at: null,
    session_epoch: 'v1',
  };
}

function normalizeMessage(message) {
  const role = message && message.role === 'buddy' ? 'buddy' : 'user';
  const text = String((message && message.text) || '').trim().slice(0, MAX_MESSAGE_LEN);
  if (!text) return null;
  return {
    role,
    text,
    at: String((message && message.at) || new Date().toISOString()).slice(0, 40),
    request_id: message && message.request_id ? String(message.request_id).slice(0, 100) : null,
  };
}

function trimRecord(record) {
  if (!Array.isArray(record.messages)) record.messages = [];
  if (record.messages.length > MAX_THREAD_MESSAGES) {
    record.messages = record.messages.slice(-MAX_THREAD_MESSAGES);
  }

  let blob = JSON.stringify(record);
  while (TEXT_ENCODER.encode(blob).length > MAX_RECORD_BYTES && record.messages.length > 8) {
    record.messages.shift();
    blob = JSON.stringify(record);
  }
  return record;
}

export async function loadBuddyThread(env, user, threadId = 'primary') {
  if (!env || !env.AUTH_KV || !user) return emptyRecord(user, threadId);
  const raw = await env.AUTH_KV.get(buddyThreadKey(user, threadId));
  if (!raw) return emptyRecord(user, threadId);
  try {
    const record = JSON.parse(raw);
    return {
      ...emptyRecord(user, threadId, record.first_seen || undefined),
      ...record,
      login: record.login || user.login || null,
      user_id: record.user_id || user.id || null,
      thread_id: record.thread_id || threadId,
      messages: Array.isArray(record.messages) ? record.messages.map(normalizeMessage).filter(Boolean) : [],
      turn_count: Number(record.turn_count || 0),
      session_epoch: String(record.session_epoch || 'v1').slice(0, 50),
    };
  } catch {
    return emptyRecord(user, threadId);
  }
}

export async function saveBuddyThread(env, user, record, threadId = 'primary') {
  const next = trimRecord(record);
  await env.AUTH_KV.put(buddyThreadKey(user, threadId), JSON.stringify(next));
  return next;
}

export async function appendBuddyThreadTurn(env, user, { question, answer, requestId, threadId = 'primary', questionAt, answerAt }) {
  if (!env || !env.AUTH_KV || !user) return null;
  const now = new Date().toISOString();
  const record = await loadBuddyThread(env, user, threadId);

  if (requestId && record.messages.some(m => m.request_id === requestId)) {
    return record;
  }

  const userMessage = normalizeMessage({ role: 'user', text: question, at: questionAt || now, request_id: requestId });
  const buddyMessage = normalizeMessage({ role: 'buddy', text: answer, at: answerAt || now, request_id: requestId });
  if (userMessage) record.messages.push(userMessage);
  if (buddyMessage) record.messages.push(buddyMessage);
  record.last_seen = now;
  record.turn_count = Number(record.turn_count || 0) + (userMessage && buddyMessage ? 1 : 0);
  record.cleared_at = null;

  return saveBuddyThread(env, user, record, threadId);
}

export async function clearBuddyThread(env, user, threadId = 'primary') {
  const now = new Date().toISOString();
  const record = emptyRecord(user, threadId, now);
  record.cleared_at = now;
  record.session_epoch = Date.now().toString(36);
  await env.AUTH_KV.put(buddyThreadKey(user, threadId), JSON.stringify(record));
  return record;
}

export function publicBuddyThread(record) {
  return {
    thread_id: record.thread_id || 'primary',
    login: record.login || null,
    first_seen: record.first_seen || null,
    last_seen: record.last_seen || null,
    cleared_at: record.cleared_at || null,
    turn_count: Number(record.turn_count || 0),
    message_count: Array.isArray(record.messages) ? record.messages.length : 0,
    messages: Array.isArray(record.messages) ? record.messages : [],
    session_epoch: record.session_epoch || 'v1',
  };
}
